import { behaviorChangingWork } from "../../evidence/test-discrimination.mjs";
import { BEHAVIOR_NEUTRAL_WORK } from "./design-blueprints.mjs";
import { lightKind, scenarioKindLabel, inferWorkTypes } from "./dev-document.mjs";

// What every change's proposal states once: who and which lane, the scope,
// how each requirement is accepted, what "done" means, and how success is
// judged. Everything here is a view over data the compiler already holds (ids
// and paths, never a second copy of scenario text) and policy values the
// harness enforces, so the agent authors nothing for it and it cannot drift
// from the rules it describes.

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function cell(value) {
  const flat = Array.isArray(value) ? value.join(", ") : value;
  return String(flat ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|") || "—";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const PREVIEW = 6;
function preview(values, quote = "") {
  const shown = values.slice(0, PREVIEW).map((value) => `${quote}${value}${quote}`).join(", ");
  return values.length > PREVIEW ? `${shown}, … +${values.length - PREVIEW} more` : shown;
}

// Why the change is in its lane, as one short phrase from the same predicate
// that chose it (the strongest cause). The risk values themselves stay in
// Impact; the phrase never nests parentheses inside the Lane line.
export function laneReason(draft, rapid) {
  if (rapid) return "low risk";
  const plain = (value) => value.replace(/[()]/g, "");
  const triggers = strings(draft?.securityTriggers).map(plain);
  if (triggers.length) return `security triggers: ${triggers.join(", ")}`;
  if ((text(draft?.impact) || "low") !== "low" || (text(draft?.coupling) || "isolated") !== "isolated")
    return "impact or coupling above the rapid limit";
  if (draft?.reviewRequired) return "review required";
  if (draft?.acceptance?.required) return "user acceptance required";
  return "carries design content";
}

// The review tier a proposal header names, from the policy's own route label:
// "risk-tiered AI review (high tier, fast model)" reads "high tier".
export function reviewTier(label) {
  const value = text(label);
  if (!value) return "";
  if (/^not required\b/i.test(value)) return "not required";
  const tier = value.match(/\b(low|medium|high) tier\b/i)?.[0];
  return tier || value.replace(/\s*\(.*$/, "").trim() || value;
}

// Only facts that stay true after approval: change id, lane and its reason,
// review tier, owner, and created date. Status, approvers, and evidence
// freshness change after approval, so `claude-foundation changes` reports
// them instead of the packet. Absent facts are left out; an unknown owner
// says so.
export function renderPacketHeader(draft, state = {}, { reviewLabel = "" } = {}) {
  const rapid = state.schema === "foundation-rapid";
  const lane = state.schema
    ? `**Lane:** ${rapid ? "rapid" : "standard"} (${laneReason(draft, rapid)})` : "";
  const first = [state.id ? `**Change:** \`${state.id}\`` : "", lane].filter(Boolean).join(" · ");
  const created = String(state.createdAt || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const tier = reviewTier(reviewLabel);
  const second = [
    tier ? `**Review:** ${tier}` : "",
    `**Owner:** ${text(state.owner) || "unassigned"}`,
    created ? `**Created:** ${created}` : ""
  ].filter(Boolean).join(" · ");
  return [first, second].filter(Boolean).map((line) => `- ${line}`).join("\n");
}

function requirementRows(draft) {
  const keys = Array.isArray(draft?._requirementKeys) ? draft._requirementKeys : [];
  return (Array.isArray(draft?.specs) ? draft.specs : []).map((spec, index) => ({
    key: text(keys[index]), title: text(spec?.requirement), operation: text(spec?.operation) || "added",
    scenarios: Array.isArray(spec?.scenarios) ? spec.scenarios : []
  }));
}

function taskPathsOf(draft) {
  return unique((Array.isArray(draft?.tasks) ? draft.tasks : []).flatMap((task) => strings(task?.paths)));
}

// One capability is named here (the living spec the change joins); several
// are indexed by the Capabilities table instead.
function capabilityLabel(draft) {
  const names = unique((Array.isArray(draft?.specs) ? draft.specs : []).map((spec) => text(spec?.name)));
  return names.length === 1 ? ` (\`${names[0]}\`)` : "";
}

export function renderScope(draft, { unselectedRepositories = [] } = {}) {
  // The behavior each requirement adds: the draft's own change list (authored,
  // else derived from the requirements), so Scope states it once.
  const changes = unique(strings(draft?.changes));
  const inScope = changes.length ? changes : unique(requirementRows(draft).map((row) => {
    const title = row.title || row.key;
    return title && row.operation !== "added" ? `${title} (${row.operation})` : title;
  }));
  const out = [];
  const paths = taskPathsOf(draft);
  if (paths.length) out.push(`edits outside ${preview(paths, "`")}`);
  if (unselectedRepositories.length)
    out.push(`repositories not selected: ${unselectedRepositories.join(", ")}`);
  if (strings(draft?.nonGoals).length) out.push("the authored Non-goals below");
  if (!inScope.length && !out.length) return "";
  return "## Scope\n\n" + [
    inScope.length ? `- **In scope${capabilityLabel(draft)}:** ${inScope.join("; ")}` : "",
    out.length ? `- **Out of scope:** ${out.join("; ")}` : ""].filter(Boolean).join("\n");
}

function testFilesFor(draft, claim, taskIds, scenarioName) {
  const rows = (Array.isArray(draft?.testMap) ? draft.testMap : []).filter((row) => text(row?.file));
  const authored = rows.filter((row) =>
    taskIds.includes(text(row.task)) ||
    (scenarioName && text(row.scenario).toLowerCase() === scenarioName.toLowerCase()) ||
    text(row.scenario) === claim.id).map((row) => text(row.file));
  const fromPaths = (Array.isArray(draft?.tasks) ? draft.tasks : [])
    .filter((task) => taskIds.includes(task.id)).flatMap((task) => strings(task.paths))
    .filter((path) => lightKind(path) === "test");
  return unique([...authored, ...fromPaths]);
}

// The access outcome a scenario asserts, when it states one: "allow"/"deny",
// optionally for a named actor ({ actor|role, effect|result|decision }).
function accessLabel(scenario) {
  const access = scenario?.access;
  if (typeof access === "string") return text(access).toLowerCase();
  if (!access || typeof access !== "object") return "";
  const effect = text(access.effect || access.result || access.decision || access.outcome).toLowerCase();
  const actor = text(access.actor || access.role || access.subject);
  return effect ? (actor ? `${effect}: ${actor}` : effect) : "";
}

// One row per claim: requirement -> scenario (its name and kind) -> task ->
// evidence capabilities -> test files. Claim ids stay machine keys; readers
// see the requirement title and the scenario name.
export function traceabilityRows(draft) {
  const claims = Array.isArray(draft?.claims) ? draft.claims : [];
  const tasks = Array.isArray(draft?.tasks) ? draft.tasks : [];
  const requirements = requirementRows(draft);
  const rows = [];
  const seen = new Set();
  const taskIdsOf = (claim) => tasks.filter((task) => (task.claims || []).includes(claim.id)).map((task) => task.id);
  for (const requirement of requirements) {
    const own = claims.filter((claim) => text(claim?.requirementKey) === requirement.key);
    const aligned = own.length === requirement.scenarios.length;
    own.forEach((claim, index) => {
      const scenario = aligned ? requirement.scenarios[index] : null;
      const taskIds = taskIdsOf(claim);
      seen.add(claim.id);
      rows.push({
        requirement: requirement.key, title: requirement.title || requirement.key, claim: claim.id,
        scenario: text(scenario?.name) || text(claim.scenario),
        kind: scenario ? scenarioKindLabel(scenario) : "unclassified", access: accessLabel(scenario),
        tasks: taskIds, evidence: strings(claim.capabilities),
        tests: testFilesFor(draft, claim, taskIds, text(claim.scenario))
      });
    });
  }
  for (const claim of claims) {
    if (!claim?.id || seen.has(claim.id)) continue;
    const taskIds = taskIdsOf(claim);
    rows.push({
      requirement: text(claim.requirementKey), title: text(claim.requirementKey), claim: claim.id,
      scenario: text(claim.scenario), kind: "unclassified", access: "",
      tasks: taskIds, evidence: strings(claim.capabilities),
      tests: testFilesFor(draft, claim, taskIds, text(claim.scenario))
    });
  }
  return rows;
}

// Reader order inside a requirement: success, boundary, failure, then
// anything unclassified; authored order breaks ties.
const KIND_ORDER = { happy: 0, edge: 1, failure: 2 };
const KIND_NAME = { happy: "success", edge: "boundary" };
const TRACE_LABELS = {
  en: { requirement: "Requirement", scenario: "Scenario", kind: "Kind", task: "Task", check: "Check",
    decision: "Decision", intro: "Tasks: `tasks.md`; scenarios: the specs." },
  th: { requirement: "Requirement", scenario: "Scenario", kind: "ชนิด", task: "Task", check: "Check",
    decision: "Decision", intro: "Task: `tasks.md`; scenario: ใน specs" }
};

function governingDecisions(draft, key) {
  return unique((Array.isArray(draft?.decisions) ? draft.decisions : [])
    .filter((decision) => strings(decision?.requirements).includes(key))
    .map((decision) => text(decision?.id) || text(decision?.key)));
}

// Grouped by requirement: its title and its check (evidence capabilities and
// test files) appear once on the group's first row; each scenario is named,
// never shown by claim id. Evidence freshness is volatile and stays in
// `claude-foundation changes`, not here.
export function renderTraceability(draft, { language = draft?.language } = {}) {
  const rows = traceabilityRows(draft);
  if (!rows.length) return "";
  const label = TRACE_LABELS[language === "th" ? "th" : "en"];
  const groups = new Map();
  for (const row of rows) {
    const key = row.requirement || row.claim;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const lines = [];
  for (const [key, group] of groups) {
    const ordered = group.map((row, index) => ({ row, index })).sort((a, b) =>
      ((KIND_ORDER[a.row.kind] ?? 3) - (KIND_ORDER[b.row.kind] ?? 3)) || a.index - b.index).map(({ row }) => row);
    const capabilities = unique(group.flatMap((row) => row.evidence));
    const tests = unique(group.flatMap((row) => row.tests));
    const check = [capabilities.join(", "), tests.map((file) => `\`${file}\``).join(", ")].filter(Boolean).join(": ");
    const decisions = governingDecisions(draft, key);
    ordered.forEach((row, index) => {
      const kind = (KIND_NAME[row.kind] || row.kind) + (row.access ? ` (${row.access})` : "");
      lines.push(`| ${index ? "" : cell(row.title)} | ${cell(row.scenario)} | ${kind} | ${cell(row.tasks)} | ` +
        `${index ? "" : cell(check)} | ${index ? "" : cell(decisions)} |`);
    });
  }
  return "## Acceptance traceability\n\n" + `${label.intro}\n\n` +
    `| ${label.requirement} | ${label.scenario} | ${label.kind} | ${label.task} | ${label.check} | ${label.decision} |\n` +
    "|---|---|---|---|---|---|\n" + lines.join("\n");
}

function hasSuccessSignal(draft) {
  return Boolean(text(draft?.successMeasure) ||
    (Array.isArray(draft?.successCriteria) && draft.successCriteria.length));
}

// The authored measure; authored success criteria already have their own
// section, so a draft with those only points at it. Nothing is invented.
export function successMeasureText(draft) {
  if (text(draft?.successMeasure)) return text(draft.successMeasure).replace(/\s+/g, " ");
  if (Array.isArray(draft?.successCriteria) && draft.successCriteria.length)
    return "the Success criteria above hold";
  return "acceptance scenarios above pass";
}

const BOUNDARY_WORDS = new RegExp("\\b(?:empty|blank|zero|none|null|missing|max(?:imum)?|min(?:imum)?|" +
  "limit|boundary|duplicate|already|exceed\\w*|large|first|last|concurrent|twice|overflow)\\b",
  "i");

// Advisory only: never a repair for the agent, never a new EDIT.
export function coverageNotes(draft) {
  const notes = [];
  const rows = traceabilityRows(draft);
  const types = inferWorkTypes(draft || {});
  const light = types.length > 0 && types.every((type) => BEHAVIOR_NEUTRAL_WORK.has(type));
  if (rows.length && !light) {
    if (!rows.some((row) => row.kind === "failure")) notes.push("no failure scenario");
    const scenarios = requirementRows(draft).flatMap((row) => row.scenarios);
    const signal = scenarios.some((scenario) => scenarioKindLabel(scenario) === "edge" ||
      BOUNDARY_WORDS.test([scenario?.name, scenario?.given, scenario?.when, scenario?.then]
        .flat().map(text).join(" ")));
    if (!signal) notes.push("no edge/boundary scenario");
  }
  if (!hasSuccessSignal(draft)) notes.push("no success measure stated (optional 'successMeasure')");
  return notes;
}

export function coverageNoteLine(draft) {
  const notes = coverageNotes(draft);
  return notes.length ? `coverage (advisory, no repair needed): ${notes.join("; ")}` : "";
}

// The rules the harness actually enforces for this change, stated from the
// same policy values: evidence freshness, test discrimination (behavior
// changes only), the review route, acceptance, and Land.
export function definitionOfDoneLines(draft, { reviewLabel = "" } = {}) {
  const claims = Array.isArray(draft?.claims) ? draft.claims.length : 0;
  const lines = [`Fresh evidence for every claim${claims ? ` (${claims})` : ""}.`];
  if (behaviorChangingWork(inferWorkTypes(draft || {})))
    lines.push("Changed tests fail on the original code.");
  if (text(reviewLabel)) lines.push(`Review: ${text(reviewLabel)}.`);
  if (draft?.acceptance?.required) lines.push("User acceptance is recorded.");
  lines.push("Land archives it; Land never commits.");
  lines.push(`Success: ${successMeasureText(draft)}.`);
  return lines;
}

export function renderDefinitionOfDone(draft, options = {}) {
  return "## Definition of done\n\n" +
    definitionOfDoneLines(draft, options).map((line) => `- ${line}`).join("\n");
}
