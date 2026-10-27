export const EVIDENCE_RESULT_VERSION = 1;
export const EVIDENCE_STATUSES = Object.freeze([
  "pass", "inconclusive", "fail", "error"
]);

const STATUS_SEVERITY = Object.freeze({
  pass: 0, inconclusive: 1, fail: 2, error: 3
});

export function aggregateEvidenceStatus(values) {
  return values.reduce((worst, value) => {
    if (!(value in STATUS_SEVERITY))
      throw new Error(`invalid evidence status '${value}'`);
    return STATUS_SEVERITY[value] > STATUS_SEVERITY[worst] ? value : worst;
  }, "pass");
}

export function evidenceResultValue({ provider, status, observations = [] }) {
  if (typeof provider !== "string" || !provider.trim())
    throw new Error("evidence result requires provider");
  if (!EVIDENCE_STATUSES.includes(status))
    throw new Error(`invalid evidence status '${status}'`);
  if (!Array.isArray(observations))
    throw new Error("evidence result observations must be an array");
  return {
    version: EVIDENCE_RESULT_VERSION,
    provider,
    status,
    observations: observations.map((observation) => ({ ...observation }))
  };
}

export function parseJsonOutput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

export function parseTapOutput(value) {
  const text = String(value || "");
  if (!/^(TAP version|\s*(?:ok|not ok)\b)/m.test(text)) return null;
  const testsFooter = [...text.matchAll(/^# tests\s+(\d+)\s*$/gm)].at(-1);
  const passFooter = [...text.matchAll(/^# pass\s+(\d+)\s*$/gm)].at(-1);
  const failFooter = [...text.matchAll(/^# fail\s+(\d+)\s*$/gm)].at(-1);
  const plan = [...text.matchAll(/^\s*1\.\.(\d+)\s*$/gm)].at(-1);
  const totalTests = Number(testsFooter?.[1] ?? plan?.[1]);
  if (!Number.isInteger(totalTests) || totalTests < 0) return null;
  const criticalCases = [...text.matchAll(/^\s*(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/gm)]
    .map((match) => {
      const directive = match[2].match(/\s+#\s*(SKIP|TODO)\b/i);
      const id = directive ? match[2].slice(0, directive.index).trim() : match[2].trim();
      return {
        id,
        status: directive ? directive[1].toLowerCase()
          : match[1] === "ok" ? "pass" : "fail"
      };
    })
    .filter((row) => row.id);
  return {
    totalTests,
    passed: passFooter ? Number(passFooter[1]) : null,
    failed: failFooter ? Number(failFooter[1]) : null,
    format: "tap",
    criticalCases
  };
}

export function parseNodeTestSpecOutput(value) {
  const text = String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
  const testsFooter = [...text.matchAll(/^ℹ tests\s+(\d+)\s*$/gm)].at(-1);
  if (!testsFooter) return null;
  const number = (label) => {
    const match = [...text.matchAll(new RegExp(`^ℹ ${label}\\s+(\\d+)\\s*$`, "gm"))].at(-1);
    return match ? Number(match[1]) : null;
  };
  const criticalCases = [...text.matchAll(/^\s*([✔✖])\s+(.+?)\s*$/gm)]
    .map((match) => ({
      id: match[2].replace(/\s+\([\d.]+ms\)\s*$/, "").trim(),
      status: match[1] === "✔" ? "pass" : "fail"
    })).filter((row) => row.id);
  return {
    totalTests: Number(testsFooter[1]),
    passed: number("pass"),
    failed: number("fail"),
    format: "node-spec",
    criticalCases
  };
}

export function mutationProtocolResult(value) {
  const text = String(value || "");
  const line = text.match(
    /(?:^|\n)FOUNDATION_MUTATION_RESULT=(behavioral-kill|test-failure|survived|crash|timeout|not-applied)(?:\n|$)/
  );
  if (line) return line[1];
  const parsed = parseJsonOutput(text);
  const result = parsed?.foundationMutationResult || parsed?.mutationResult;
  return [
    "behavioral-kill", "test-failure", "survived", "crash", "timeout", "not-applied"
  ].includes(result) ? result : null;
}

export function numericReportValue(report, keys) {
  if (!report || typeof report !== "object") return null;
  for (const container of [report, report.summary, report.stats].filter((value) =>
    value && typeof value === "object" && !Array.isArray(value)))
    for (const key of keys) {
      const value = container[key];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    }
  return null;
}

export function playwrightAnnotationValues(annotations, type) {
  if (!Array.isArray(annotations)) return [];
  return annotations
    .filter((annotation) => annotation?.type === type && annotation.description)
    .map((annotation) => String(annotation.description));
}

export function playwrightAnnotationClaims(annotations) {
  return playwrightAnnotationValues(annotations, "claim");
}

export function playwrightAnnotationCriticalCases(annotations) {
  return playwrightAnnotationValues(annotations, "critical-case");
}

export function playwrightTestOutcome(results) {
  const statuses = results.map((result) => result?.status).filter(Boolean);
  const failed = statuses.some((status) =>
    ["failed", "timedOut", "interrupted"].includes(status));
  const skipped = !failed && statuses.length > 0 &&
    statuses.every((status) => status === "skipped");
  return { failed, skipped };
}

export function collectPlaywrightAttachments(attachments, destination) {
  if (!Array.isArray(attachments)) return;
  for (const attachment of attachments)
    if (attachment?.path) destination.add(String(attachment.path));
}

export function recordPlaywrightTest(results, carried, state) {
  if (!Array.isArray(results)) return;
  state.tests += 1;
  const outcome = playwrightTestOutcome(results);
  if (outcome.failed) state.failed += 1;
  else if (outcome.skipped) state.skipped += 1;
  const destination = outcome.skipped ? state.skippedClaims : state.claims;
  for (const claim of carried.claims) destination.add(claim);
  const caseStatus = outcome.failed ? "fail" : outcome.skipped ? "skipped" : "pass";
  const severity = new Map([["pass", 0], ["skipped", 1], ["fail", 2]]);
  for (const id of carried.criticalCases) {
    const current = state.criticalCases.get(id);
    if (!current || severity.get(caseStatus) > severity.get(current))
      state.criticalCases.set(id, caseStatus);
  }
}

export function visitPlaywrightChildren(value, carried, state, seen) {
  for (const child of Object.values(value)) {
    if (Array.isArray(child))
      child.forEach((item) => visitPlaywrightReport(item, carried, state, seen));
    else if (child && typeof child === "object")
      visitPlaywrightReport(child, carried, state, seen);
  }
}

export function visitPlaywrightReport(value, inherited, state, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const ownClaims = playwrightAnnotationClaims(value.annotations);
  const ownCriticalCases = playwrightAnnotationCriticalCases(value.annotations);
  const carried = ownClaims.length || ownCriticalCases.length ? {
    claims: [...inherited.claims, ...ownClaims],
    criticalCases: [...inherited.criticalCases, ...ownCriticalCases]
  } : inherited;
  collectPlaywrightAttachments(value.attachments, state.attachments);
  recordPlaywrightTest(value.results, carried, state);
  visitPlaywrightChildren(value, carried, state, seen);
}

export function playwrightReportSummary(report) {
  const state = {
    claims: new Set(), attachments: new Set(), skippedClaims: new Set(),
    criticalCases: new Map(), tests: 0, failed: 0, skipped: 0
  };
  // Annotations are carried down from suites to the tests they contain, and a
  // claim is credited only where a test actually ran. Playwright emits the
  // annotations of a `test.skip`/`test.fixme`/filtered-out test and still
  // exits 0, so harvesting them regardless recorded claims as proven by tests
  // that never executed.
  visitPlaywrightReport(report, { claims: [], criticalCases: [] }, state);
  return {
    claims: [...state.claims].sort(), attachments: [...state.attachments].sort(),
    skippedClaims: [...state.skippedClaims]
      .filter((claim) => !state.claims.has(claim)).sort(),
    criticalCases: [...state.criticalCases]
      .map(([id, status]) => ({ id, status }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    tests: state.tests, failed: state.failed, skipped: state.skipped
  };
}

export function configuredCommand(provider, config) {
  const [command, ...originalArgs] = config.command;
  const args = [...originalArgs];
  const directPlaywright = config.adapter === "playwright" &&
    ([command, ...args].some((part) =>
      part === "playwright" || part.endsWith("/playwright") || part === "@playwright/test"));
  if (directPlaywright) {
    if (config.project && !args.some((arg) => arg === "--project" || arg.startsWith("--project=")))
      args.push(`--project=${config.project}`);
    if (!args.some((arg) => arg === "--reporter" || arg.startsWith("--reporter=")))
      args.push("--reporter=json");
  }
  return { command, args, display: [command, ...args].join(" ") };
}

// Repo-qualified, the way the build planner already qualifies task resources.
// Unqualified defaults cut both ways: a Playwright provider in `api` and one
// in `app` both claimed the literal "dev-server" and serialized needlessly,
// while two providers in different repositories that genuinely share one
// database never conflicted at all. An explicit `resources` list stays verbatim
// — that is how an author declares real sharing across repositories.
export function adapterResources(provider, config, providerCapability) {
  if (Array.isArray(config.resources)) return [...new Set(config.resources)].sort();
  const scope = config.repository ? `:${config.repository}` : "";
  // Reads every declared side and writes nothing, so it never conflicts.
  if (config.adapter === "contract-digest") return ["workspace-read"];
  if (config.adapter === "playwright")
    return [`browser${scope}`, `dev-server${scope}`, "workspace-read"];
  if (providerCapability(provider, config) === "mutation")
    return [`workspace-write${scope}`];
  return ["workspace-read"];
}

export function resourcesConflict(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  // `workspace-write:api` still excludes every workspace user, so match on the
  // prefix rather than the exact token.
  const writes = (set) => [...set].some((item) => item.startsWith("workspace-write"));
  const touchesWorkspace = (set) => [...set].some((item) => item.startsWith("workspace-"));
  if (writes(a) && touchesWorkspace(b)) return true;
  if (writes(b) && touchesWorkspace(a)) return true;
  return [...a].some((item) => item !== "workspace-read" && b.has(item));
}
