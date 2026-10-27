import { join } from "node:path";

// Diff-scoped review input. The configured reviewer receives the changed
// hunks and the agreement's requirements instead of being told to open whole
// files. Everything here is derived from the dispatched scope rows and the
// bound contract workspace, so the packet digest binds exactly what was shown.
export const REVIEW_DIFF_LIMITS = Object.freeze({
  fileBytes: 12 * 1024, totalBytes: 40 * 1024, agreementBytes: 12 * 1024
});

function clip(text, limit) {
  const value = String(text || "");
  if (Buffer.byteLength(value) <= limit) return { text: value, truncated: false };
  let cut = value.slice(0, limit);
  while (Buffer.byteLength(cut) > limit) cut = cut.slice(0, -1);
  const newline = cut.lastIndexOf("\n");
  return { text: newline > 0 ? cut.slice(0, newline + 1) : cut, truncated: true };
}

// `git` is the injected runner `(args, cwd) => spawnSync result`. External diff
// drivers and textconv filters are disabled: repository config must not run
// programs or rewrite what the reviewer sees.
export function reviewRowDiff({ git, pathExists }, row, workspacePath, baseHead) {
  if (!workspacePath || !baseHead) return { status: "unavailable" };
  const base = ["-c", "core.quotepath=off", "diff", "--no-color", "--no-ext-diff",
    "--no-textconv", "--no-renames", "-U3"];
  const tracked = git([...base, baseHead, "--", row.path], workspacePath);
  if (tracked.status !== 0) return { status: "unavailable" };
  if (String(tracked.stdout || "").trim()) return { status: "diff", diff: String(tracked.stdout) };
  if (!pathExists(join(workspacePath, row.path))) return { status: "unchanged" };
  const inBase = git(["cat-file", "-e", `${baseHead}:${row.path}`], workspacePath);
  if (inBase.status === 0) return { status: "unchanged" };
  // Untracked additions are invisible to `diff <base>`; show them as new files.
  const added = git([...base, "--no-index", "--", "/dev/null", row.path], workspacePath);
  return [0, 1].includes(added.status) && String(added.stdout || "").trim()
    ? { status: "diff", diff: String(added.stdout) } : { status: "unavailable" };
}

export function reviewDiffValue(context, rows, inspection, limits = REVIEW_DIFF_LIMITS) {
  const locations = new Map((inspection || []).map((entry) => [entry.repositoryId, entry]));
  let remaining = limits.totalBytes;
  const files = (rows || []).filter((row) => row.kind !== "contract-artifact")
    .map((row) => {
      const path = `${row.repositoryId}/${row.path}`;
      if (row.identity === "reverted-to-base") return { path, status: "reverted-to-base" };
      if (remaining <= 0) return { path, status: "omitted" };
      const location = locations.get(row.repositoryId) || {};
      let value;
      try {
        value = reviewRowDiff(context, row,
          row.workspacePath || location.workspacePath || null, location.baseHead || null);
      } catch { value = { status: "unavailable" }; }
      if (value.status !== "diff") return { path, status: value.status };
      const budget = Math.min(limits.fileBytes, remaining);
      const clipped = clip(value.diff, budget);
      // Clipping against the shared budget exhausts it; a per-file clip does not.
      remaining = clipped.truncated && budget === remaining
        ? 0 : remaining - Buffer.byteLength(clipped.text);
      return { path, status: clipped.truncated ? "truncated" : "diff", diff: clipped.text };
    });
  return { version: 1, files };
}

function specFiles(context, directory, prefix = "specs") {
  let names;
  try { names = context.readDirectory(join(directory, prefix)).sort(); }
  catch { return []; }
  return names.flatMap((name) => {
    const relativePath = `${prefix}/${name}`;
    if (context.isDirectory(join(directory, relativePath)))
      return specFiles(context, directory, relativePath);
    return relativePath.endsWith(".md") ? [relativePath] : [];
  });
}

// The agreement summary: claim scenarios, the acceptance decision, and the
// delta requirements with their scenarios. Specs are the canonical agreement;
// their identities are already in the dispatched manifest.
export function reviewAgreementValue(context, packet, limits = REVIEW_DIFF_LIMITS) {
  const directory = packet?.contractWorkspacePath;
  let remaining = limits.agreementBytes;
  const requirements = directory ? specFiles(context, directory).map((path) => {
    if (remaining <= 0) return { path: `contract/${path}`, status: "omitted" };
    let content;
    try { content = context.readFile(join(directory, path), "utf8"); }
    catch { return { path: `contract/${path}`, status: "unavailable" }; }
    const clipped = clip(content, remaining);
    remaining -= Buffer.byteLength(clipped.text);
    return { path: `contract/${path}`, status: clipped.truncated ? "truncated" : "included",
      text: clipped.text };
  }) : [];
  return {
    version: 1,
    intent: packet?.intent || null,
    claims: packet?.claims ?? null,
    acceptance: packet?.acceptance ?? null,
    requirements
  };
}

// Only the risk tier decides review depth. Low risk before any delivered AI
// attempt reviews the diff alone on the fast model tier; a promoted second
// round, medium, high, and legacy routing keep the configured depth and model.
export function reviewDepthForTier(tier, deliveredAiCount = 0) {
  return tier === "low" && Number(deliveredAiCount) === 0 ? "diff-only" : "diff-first";
}

export function reviewModelTierForDepth(depth) {
  return depth === "diff-only" ? "fast" : "configured";
}

// Which model class a review round runs on. Classes: `fast` (the reviewer's
// `fastModelId`, else the `models.fast.family` alias, at medium effort),
// `standard` (`standardModelId`, else `models.standard.family`, at the
// configured effort), and `configured` (the strongest configured model).
// Defaults by risk tier: low first round `fast`, medium first round
// `standard`, high and every later round `configured`. `review.modelByTier`
// maps `low` and `medium` to a class (`high` is never weakened);
// `review.lowRiskModel: "configured"` is the older low-tier opt-out. A medium
// change that carries a security or required-review trigger, or a declared
// review, keeps `configured`; an unrecognized class or trigger fails closed
// to `configured`. Tier assignment itself never changes here.
export const REVIEW_MODEL_CLASSES = Object.freeze(["fast", "standard", "configured"]);
export const DEFAULT_REVIEW_MODEL_BY_TIER = Object.freeze({
  low: "fast", medium: "standard", high: "configured"
});
// Medium-tier triggers that only describe how much changed or how it couples;
// any other trigger (access-control, authorization-or-secrets, risk-capability,
// risk-semantics, covered-by-review:*, multi-repository-claim, critical-*, a
// diversity waiver, or one added later) pins the configured model.
export const MEDIUM_TIER_SPEED_SAFE_TRIGGERS = Object.freeze([
  "medium-impact-or-coupling", "review-risk", "declared-medium-risk", "input-domain",
  "independence-waived-self-review"
]);

export function reviewModelClass({
  tier, deliveredAiCount = 0, triggers = [], declaredReview = false, settings = {}
} = {}) {
  if (!["low", "medium"].includes(tier) || Number(deliveredAiCount) > 0)
    return "configured";
  let chosen = DEFAULT_REVIEW_MODEL_BY_TIER[tier];
  if (tier === "low" && settings?.lowRiskModel === "configured") chosen = "configured";
  const mapped = settings?.modelByTier;
  if (mapped && typeof mapped === "object" && Object.hasOwn(mapped, tier))
    chosen = mapped[tier];
  if (!REVIEW_MODEL_CLASSES.includes(chosen)) return "configured";
  if (tier === "medium" && chosen !== "configured" && (declaredReview ||
      !Array.isArray(triggers) || triggers.length === 0 ||
      triggers.some((trigger) => !MEDIUM_TIER_SPEED_SAFE_TRIGGERS.includes(trigger))))
    return "configured";
  return chosen;
}

// Scenario coverage checklist (N8). One item per agreement scenario so the
// reviewer states, per scenario, whether the diff backs it with a test or code.
// Pure and deterministic: callers inject file access (the same shape as the
// review diff context), and item order follows sorted spec paths.
export const REVIEW_CHECKLIST_LIMITS = Object.freeze({ items: 40, bytes: 8 * 1024 });
export const SCENARIO_COVERAGE_STATUSES = Object.freeze(
  ["covered-by-test", "covered-by-code-only", "missing", "unsure"]);

function checklistSlug(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function checklistFiles(access, directory, prefix) {
  const list = access.readDirectory || access.listDir;
  let names;
  try { names = [...list(join(directory, prefix))].map(String).sort(); }
  catch { return []; }
  return names.flatMap((name) => {
    const relativePath = `${prefix}/${name}`;
    let nested;
    try {
      nested = access.isDirectory ? access.isDirectory(join(directory, relativePath))
        : (list(join(directory, relativePath)), true);
    } catch { nested = false; }
    if (nested) return checklistFiles(access, directory, relativePath);
    return relativePath.endsWith(".md") ? [relativePath] : [];
  });
}

function readText(access, path) {
  try {
    if (access.exists && !access.exists(path)) return null;
    return String(access.readFile(path, "utf8"));
  } catch { return null; }
}

// OpenSpec delta markdown: `### Requirement:` blocks holding `#### Scenario:`
// cases with GIVEN/WHEN/THEN/AND bullets. AND extends the preceding clause.
// REMOVED requirements carry no behavior to back and are skipped.
export function parseSpecScenarios(markdown) {
  const scenarios = [];
  let removed = false;
  let requirement = null;
  let scenario = null;
  let clause = null;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const section = line.match(/^##\s+(.+?)\s*$/);
    if (section) {
      removed = /^removed\b/i.test(section[1]);
      requirement = null; scenario = null;
      continue;
    }
    const heading = line.match(/^###\s+Requirement:\s*(.+?)\s*$/i);
    if (heading) { requirement = heading[1]; scenario = null; continue; }
    if (/^#{1,3}\s/.test(line)) { requirement = null; scenario = null; continue; }
    const title = line.match(/^####\s+Scenario:\s*(.+?)\s*$/i);
    if (title) {
      scenario = null;
      if (!requirement || removed) continue;
      scenario = { requirement, scenario: title[1], given: [], when: [], then: [] };
      scenarios.push(scenario);
      clause = null;
      continue;
    }
    if (/^#{4,}\s/.test(line)) { scenario = null; continue; }
    if (!scenario) continue;
    const bullet = line.match(/^\s*[-*]\s*(?:\*\*)?(GIVEN|WHEN|THEN|AND)(?:\*\*)?[:\s]\s*(.*?)\s*$/i);
    if (!bullet) continue;
    const keyword = bullet[1].toLowerCase();
    if (keyword !== "and") clause = keyword;
    if (clause && bullet[2]) scenario[clause].push(bullet[2]);
  }
  return scenarios.map((row) => ({
    requirement: row.requirement,
    scenario: row.scenario,
    ...(row.given.length ? { given: row.given.join("; ") } : {}),
    when: row.when.join("; ") || null,
    then: row.then.join("; ") || null
  }));
}

function evidenceClaims(access, directory) {
  const content = readText(access, join(directory, "evidence.yaml"));
  if (content == null) return [];
  try {
    const claims = JSON.parse(content)?.claims;
    return Array.isArray(claims) ? claims.filter((claim) => claim && typeof claim === "object") : [];
  } catch { return []; }
}

// Stable ids: the compiled claim id whose scenario names this case (the same
// id findings already bind), else requirement slug plus 1-based scenario index.
function assignChecklistIds(rows, claims) {
  const byScenario = new Map();
  for (const claim of claims) {
    const name = String(claim.scenario || "").trim();
    if (name && claim.id && !byScenario.has(name)) byScenario.set(name, String(claim.id));
  }
  const used = new Set();
  const perRequirement = new Map();
  return rows.map((row) => {
    const requirementSlug = checklistSlug(row.requirement) || "requirement";
    const index = (perRequirement.get(requirementSlug) || 0) + 1;
    perRequirement.set(requirementSlug, index);
    let id = byScenario.get(String(row.scenario || "").trim()) || `${requirementSlug}-s${index}`;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${id.replace(/~\d+$/, "")}~${suffix}`;
    used.add(id);
    return { id, ...row };
  });
}

function capChecklist(items, limits) {
  const kept = [];
  let bytes = 2;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (kept.length >= limits.items || bytes + size > limits.bytes) break;
    kept.push(item);
    bytes += size;
  }
  return { items: kept, truncated: kept.length < items.length };
}

export function reviewScenarioChecklist(access, limits = REVIEW_CHECKLIST_LIMITS) {
  const directory = access?.packetDir;
  if (!directory) return { items: [], source: "none", truncated: false };
  const claims = evidenceClaims(access, directory);
  let source = "none";
  let rows = [];
  const specs = checklistFiles(access, directory, "specs");
  if (specs.length) {
    rows = specs.flatMap((path) => parseSpecScenarios(readText(access, join(directory, path))));
    if (rows.length) source = "specs";
  }
  if (!rows.length) {
    rows = parseSpecScenarios(readText(access, join(directory, "proposal.md")));
    if (rows.length) source = "proposal";
  }
  if (!rows.length && claims.length) {
    // A compiled rapid packet renders no scenarios into proposal.md; its
    // evidence claims carry the requirement key and scenario statement.
    rows = claims.filter((claim) => String(claim.scenario || "").trim()).map((claim) => ({
      requirement: String(claim.requirementKey || claim.id || ""),
      scenario: String(claim.scenario).trim(), when: null, then: null
    }));
    if (rows.length) source = "claims";
  }
  const capped = capChecklist(assignChecklistIds(rows, claims), limits);
  return { items: capped.items, source, truncated: capped.truncated };
}

export function reviewChecklistInstruction(items, { truncated = false } = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "";
  const lines = rows.map((item) => {
    const parts = [item.given && `GIVEN ${item.given}`, item.when && `WHEN ${item.when}`,
      item.then && `THEN ${item.then}`].filter(Boolean).join(" ");
    return `- ${item.id}: [${item.requirement}] ${item.scenario}${parts ? ` — ${parts}` : ""}`;
  });
  return [
    "SCENARIO COVERAGE CHECKLIST. For every scenario below decide from the diff whether it is " +
      "covered-by-test (a changed or existing test exercises it), covered-by-code-only " +
      "(implemented but no test exercises it), missing (nothing in the diff implements it), " +
      "or unsure. Do not guess coverage; answer unsure when you cannot tell. Report every " +
      "missing or unsure scenario as a finding bound to that scenario's id.",
    ...lines,
    ...(truncated ? ["(Checklist truncated; the agreement holds further scenarios. " +
      "Review those too, but only the listed ids go in scenarioCoverage.)"] : []),
    "End your report with exactly one JSON block of this shape, one entry per listed id:",
    "```json",
    '{"scenarioCoverage":[{"id":"<id>","status":"covered-by-test|covered-by-code-only|missing|unsure","evidence":"path:line or null"}]}',
    "```"
  ].join("\n");
}

// Extract the balanced JSON object that starts at `start`, string-aware.
function balancedObject(text, start) {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function coverageCandidates(text) {
  const found = [];
  const key = /"scenarioCoverage"\s*:/g;
  for (let match = key.exec(text); match; match = key.exec(text)) {
    // The key sits at most a few objects deep; bound the walk-back so a large
    // brace-heavy report stays linear.
    let attempts = 4;
    for (let open = text.lastIndexOf("{", match.index); open >= 0 && attempts-- > 0;
      open = open > 0 ? text.lastIndexOf("{", open - 1) : -1) {
      const body = balancedObject(text, open);
      if (!body || open + body.length <= match.index) continue;
      try {
        const value = JSON.parse(body);
        if (Array.isArray(value?.scenarioCoverage)) { found.push(value); break; }
      } catch {}
    }
  }
  return found;
}

// Spec gaps are partitions or scenarios the change plausibly needs but the
// agreement does not name. The checklist can only test what the agreement
// states, so they are advisory: recorded and reported, never findings, and
// never a reason to block. Malformed rows are dropped; the list is bounded.
export const SPEC_GAP_LIMITS = Object.freeze({ items: 10, chars: 400 });

export function parseSpecGaps(review) {
  const rows = review && typeof review === "object" && Array.isArray(review.specGaps)
    ? review.specGaps : [];
  const gaps = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const scenario = String(row.scenario ?? "").trim().slice(0, SPEC_GAP_LIMITS.chars);
    const reason = String(row.reason ?? "").trim().slice(0, SPEC_GAP_LIMITS.chars);
    if (!scenario || seen.has(scenario)) continue;
    seen.add(scenario);
    gaps.push({ scenario, reason: reason || null });
    if (gaps.length === SPEC_GAP_LIMITS.items) break;
  }
  return gaps;
}

// Tolerant parse of the reviewer's coverage block (fenced or bare JSON, or an
// already-structured object). Returns null when no block exists. Unknown or
// malformed statuses stay null and count as unsure; with `expectedIds`, an id
// the reviewer did not answer is unsure too. Coverage is never inferred.
export function parseScenarioCoverage(review, { expectedIds } = {}) {
  let block = null;
  if (review && typeof review === "object" && Array.isArray(review.scenarioCoverage)) block = review;
  else if (typeof review === "string") block = coverageCandidates(review).at(-1) || null;
  if (!block) return null;
  const seen = new Map();
  for (const entry of block.scenarioCoverage) {
    const id = entry && typeof entry === "object" ? String(entry.id ?? "").trim() : "";
    if (!id || seen.has(id)) continue;
    const status = String(entry.status ?? "").trim().toLowerCase();
    const evidence = typeof entry.evidence === "string" && entry.evidence.trim() &&
      !/^null$/i.test(entry.evidence.trim()) ? entry.evidence.trim() : null;
    seen.set(id, { id, status: SCENARIO_COVERAGE_STATUSES.includes(status) ? status : null,
      evidence });
  }
  if (Array.isArray(expectedIds))
    for (const id of expectedIds.map(String))
      if (!seen.has(id)) seen.set(id, { id, status: null, evidence: null });
  const items = [...seen.values()];
  return {
    items,
    missing: items.filter((item) => item.status === "missing").map((item) => item.id),
    unsure: items.filter((item) => item.status === "unsure" || item.status === null)
      .map((item) => item.id)
  };
}
