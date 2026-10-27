import { leasePathIsAllowed } from "../lease-runtime.mjs";
import { ARCHITECTURE_FIELDS } from "./architecture-fields.mjs";
import { CONTRACT_FIELDS } from "./contract-fields.mjs";
import { QUALITY_FIELDS } from "./quality-fields.mjs";
import { DELIVERY_FIELDS } from "./delivery-fields.mjs";
import { WORK_TYPE_FIELDS } from "./work-type-fields.mjs";
import { PROCESS_FIELDS } from "./process-fields.mjs";
import { isSemanticV4Plus } from "./draft-version.mjs";
import { BEHAVIOR_NEUTRAL_WORK, LIGHT_WORK, WORK_TYPES } from "../../contracts/work-types.mjs";

// Design blueprints: the typed design sections a declared work type needs
// before implementation. A thin design.md let Builds guess endpoint shapes,
// UI states, and failure behavior. Shape errors block compilation; missing or
// thin sections only warn, so the agent completes them without a user gate.
// The single work-type list and light-work/behavior-neutral sets live in
// contracts so evidence modules share them; re-exported for existing importers.
export { WORK_TYPES, LIGHT_WORK, BEHAVIOR_NEUTRAL_WORK };

export const BLUEPRINT_KEYS = Object.freeze([
  "fileMap", "failureMatrix", "testMap", "apiContracts", "dataModel", "uiStates",
  "configContract", "jobContract", "bugfix", "refactor"
]);

const PLACEHOLDER = /(?:replace-with|needs clarification|\btodo\b|\btbd\b|<[^>]+>)/i;

const BY_WORK_TYPE = {
  api: ["apiContracts"],
  data: ["dataModel"],
  ui: ["uiStates"],
  config: ["configContract"],
  async: ["jobContract", "diagrams"],
  integration: ["integrations"],
  bugfix: ["bugfix"],
  refactor: ["refactor"]
};

// Required fields per list entry; an entry is thin when any is empty.
const ENTRY_FIELDS = {
  fileMap: ["path", "change", "responsibility"],
  failureMatrix: ["failure", "userSees", "recovery"],
  testMap: ["scenario", "level", "file", "task"],
  apiContracts: ["method", "path", "auth", "request", "response", "errors"],
  dataModel: ["entity", "fields", "migration"],
  uiStates: ["screen", "states", "accessibility"],
  configContract: ["key", "default", "validation"],
  jobContract: ["key", "states", "retry", "timeout", "idempotency"]
};
// Typed rows may name a required fact by its newer field (a data entity's
// columns are its fields; a model-level migration covers every entity).
const ENTRY_ALTERNATES = {
  dataModel: { entity: ["name"], fields: ["columns"] }
};

// The list a section's entries live in: the array itself, or the entities of
// the dataModel object form. Null when there is no list to check.
function entryRows(key, value) {
  if (Array.isArray(value)) return { rows: value, path: key };
  if (key === "dataModel" && value && typeof value === "object" && Array.isArray(value.entities)) {
    const modelMigration = present(value.migration);
    return {
      rows: modelMigration ? value.entities.map((row) => ({ migration: value.migration, ...row })) : value.entities,
      path: "dataModel.entities"
    };
  }
  return null;
}

// Exported so the approval page's checklist names the same missing fields.
export const OBJECT_FIELDS = {
  bugfix: ["reproduction", "rootCause", "regression"],
  refactor: ["invariants", "characterization"]
};

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "boolean" || typeof value === "number") return true;
  return typeof value === "string" && value.trim() !== "";
}

function flatText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flatText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flatText).join(" ");
  return "";
}

const WORK_TYPE_EXAMPLE = '"workType": ["feature","api"]';

export function draftWorkTypes(draft) {
  return Array.isArray(draft?.workType)
    ? [...new Set(draft.workType.map((value) => String(value).trim().toLowerCase()))]
    : [];
}

// Every typed field a draft may carry, keyed by field: { validate, render }.
// Design rows render through these; process fields render in the proposal.
export const DESIGN_FIELDS = Object.freeze({
  ...ARCHITECTURE_FIELDS, ...CONTRACT_FIELDS, ...QUALITY_FIELDS, ...DELIVERY_FIELDS, ...WORK_TYPE_FIELDS
});
const TYPED_FIELDS = Object.freeze({ ...DESIGN_FIELDS, ...PROCESS_FIELDS });

// The older list shape check; dataModel also accepts its object form.
function entryShapeIssue(key, value) {
  if (value === undefined || Array.isArray(value)) return "";
  if (key === "dataModel" && value && typeof value === "object") return "";
  return `semantic draft ${key} must be an array`;
}

function objectShapeIssue(key, value) {
  return value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))
    ? `semantic draft ${key} must be an object` : "";
}

// Blocking shape issues: a typo in workType would silently select nothing.
// A field that fails the coarse shape check reports that one message; one
// with the right shape is checked by its field module (path-prefixed issues).
// Rollout is checked against the draft's impact, so a high-impact change
// must say how its rollback was proven.
export function designBlueprintIssues(source) {
  const issues = [];
  if (source?.workType !== undefined) {
    if (!Array.isArray(source.workType) || !source.workType.length)
      issues.push(`semantic draft workType must be a non-empty array in change.json` +
        `${typeof source.workType === "string" ? ` (got the string "${source.workType}")` : ""}, ` +
        `e.g. ${WORK_TYPE_EXAMPLE}`);
    else for (const value of draftWorkTypes(source))
      if (!WORK_TYPES.includes(value))
        issues.push(`semantic draft workType '${value}' is unknown in change.json; ` +
          `use ${WORK_TYPES.join("|")}, e.g. ${WORK_TYPE_EXAMPLE}`);
  }
  const shaped = new Set();
  for (const key of Object.keys(ENTRY_FIELDS)) {
    const issue = entryShapeIssue(key, source?.[key]);
    if (issue) { issues.push(issue); shaped.add(key); }
  }
  for (const key of Object.keys(OBJECT_FIELDS)) {
    const issue = objectShapeIssue(key, source?.[key]);
    if (issue) { issues.push(issue); shaped.add(key); }
  }
  for (const [key, field] of Object.entries(TYPED_FIELDS)) {
    if (shaped.has(key) || source?.[key] === undefined || source?.[key] === null) continue;
    const options = key === "rollout" ? { impact: source?.impact } : undefined;
    for (const issue of field.validate(source[key], key, options))
      if (!issues.includes(issue)) issues.push(issue);
  }
  return issues;
}

export function requiredBlueprints(draft) {
  const types = draftWorkTypes(draft);
  if (!types.length || types.every((type) => LIGHT_WORK.has(type))) return [];
  const required = new Set(["fileMap", "failureMatrix", "testMap"]);
  for (const type of types) for (const key of BY_WORK_TYPE[type] || []) required.add(key);
  if (String(draft.coupling || "").toLowerCase() === "coupled") required.add("diagrams");
  return [...required];
}

const SMALL_DRAFT_ITEMS = 6;

// A rapid-lane draft (low impact, isolated, no security/review/acceptance) that
// is small: declared size xs|s, or no size and few requirements plus tasks.
// Asking it for missing sections was noise: a tiny feature's agent authored a
// file map and failure matrix it did not need.
export function lightweightDraft(draft) {
  const triggers = Array.isArray(draft?.securityTriggers) ? draft.securityTriggers : [];
  const rapidLane = String(draft?.impact || "low").toLowerCase() === "low" &&
    String(draft?.coupling || "isolated").toLowerCase() === "isolated" &&
    !triggers.some((trigger) => String(trigger).trim().toLowerCase() !== "none") &&
    !draft?.reviewRequired && !draft?.acceptance?.required;
  if (!rapidLane) return false;
  const size = String(draft?.size || "").trim().toLowerCase();
  if (size) return size === "xs" || size === "s";
  const count = (value) => (Array.isArray(value) ? value.length : 0);
  return count(draft?.requirements) + count(draft?.tasks) <= SMALL_DRAFT_ITEMS;
}

// Non-blocking findings. Each names the section and what makes it incomplete.
// Missing-section prompts apply only to work large or risky enough to need
// them; authored sections are still checked for thin or misplaced content.
export function designBlueprintWarnings(draft) {
  const warnings = [];
  // A v4 draft's work type is inferred and its missing sections are dev
  // document repairs (dev-document.mjs); only v3 is prompted here.
  const light = isSemanticV4Plus(draft?.version) || lightweightDraft(draft);
  if (!light) for (const key of requiredBlueprints(draft))
    if (!present(draft[key]))
      warnings.push(`workType ${draftWorkTypes(draft).join(",")} expects '${key}'; add it or state why it does not apply`);
  if (requiredBlueprints(draft).includes("diagrams") && draftWorkTypes(draft).includes("async") &&
      present(draft.diagrams) && !draft.diagrams.some((row) =>
        /sequenceDiagram|stateDiagram/.test(String(row?.source || ""))))
    warnings.push("workType async expects a sequence or state diagram that includes the failure path");
  for (const [key, fields] of Object.entries(ENTRY_FIELDS)) {
    const entries = entryRows(key, draft?.[key]);
    if (!entries) continue;
    const { rows, path } = entries;
    rows.forEach((row, index) => {
      const missing = fields.filter((field) => !present(row?.[field]) &&
        !(ENTRY_ALTERNATES[key]?.[field] || []).some((alternate) => present(row?.[alternate])));
      if (missing.length) warnings.push(`${path}[${index}] is missing ${missing.join(", ")}`);
      if (PLACEHOLDER.test(flatText(row))) warnings.push(`${path}[${index}] contains placeholder text`);
    });
  }
  for (const [key, fields] of Object.entries(OBJECT_FIELDS)) {
    if (!draft?.[key] || typeof draft[key] !== "object") continue;
    const missing = fields.filter((field) => !present(draft[key][field]));
    if (missing.length) warnings.push(`${key} is missing ${missing.join(", ")}`);
    if (PLACEHOLDER.test(flatText(draft[key]))) warnings.push(`${key} contains placeholder text`);
  }
  if (Array.isArray(draft?.uiStates))
    draft.uiStates.forEach((row, index) => {
      const states = (Array.isArray(row?.states) ? row.states : [])
        .map((state) => String(state?.state || state).toLowerCase());
      if (states.length && !states.some((state) => /error|fail/.test(state)))
        warnings.push(`uiStates[${index}] has no error state`);
    });
  // A file the design places outside every task scope fails Build at release.
  const taskPaths = (draft?.tasks || []).flatMap((task) => task?.paths || []);
  if (taskPaths.length && Array.isArray(draft?.fileMap))
    draft.fileMap.forEach((row, index) => {
      const path = String(row?.path || "").trim();
      if (path && String(row?.change || "").toLowerCase() !== "delete" &&
          !leasePathIsAllowed(path.replace(/\/\*\*?$/, ""), taskPaths))
        warnings.push(`fileMap[${index}] '${path}' is outside every task's paths`);
    });
  warnings.push(...taskTestOwnershipWarnings(draft));
  (draft?.decisions || []).forEach((decision, index) => {
    if (!present(decision?.consequences))
      warnings.push(`decisions[${index}] states no consequences`);
  });
  return warnings;
}

// Known runners whose default output carries no test result Prove can read.
// Advisory only: an unknown runner is never flagged, and a runner configured
// for a readable report is left alone. `go test` prints `ok <package>` or
// `ok <package> (cached)`; with -v each test prints `--- PASS`. Its -json
// stream is one JSON object per line, which no Prove parser counts either.
const UNCOUNTED_RUNNERS = Object.freeze([{
  runner: "go test",
  detect: /(?:^|[\s;&|(])go\s+test\b/,
  countable: /(?:^|\s)-(?:v|test\.v)(?:=true)?(?=\s|$)/,
  advice: "it prints only 'ok <package>' (or '(cached)'), which carries no test result, so " +
    "Prove's test discovery is inconclusive; use 'go test -v ./...' so each test prints " +
    "'--- PASS' (the rapid lane accepts that), and for a counted result print TAP ('1..N') " +
    "or a JSON totalTests summary"
}]);

export function verifyCountAdvisories(tasks) {
  const advisories = [];
  (Array.isArray(tasks) ? tasks : []).forEach((task, index) => {
    const verify = String(task?.verify || "");
    const name = String(task?.semanticKey || task?.key || task?.id || "").trim() || `#${index + 1}`;
    for (const row of UNCOUNTED_RUNNERS)
      if (row.detect.test(verify) && !row.countable.test(verify))
        advisories.push(`task '${name}' verify runs '${row.runner}' without a countable ` +
          `report: ${row.advice}`);
  });
  return advisories;
}

// A test path named in a task's verify command, e.g. `npx vitest
// tests/unit/card.spec.js`. Only file-shaped tokens with a test marker count.
const TEST_FILE = /(?:^|\s|["'=])((?:[\w.@-]+\/)*[\w.@-]+\.(?:spec|test)\.[a-z]+)(?=$|[\s"';:)])/gi;

function verifyTestFiles(verify) {
  return [...String(verify || "").matchAll(TEST_FILE)].map((match) => match[1]);
}

// A task that changes behavior must own the tests for it. A consumer plan kept
// every spec in a final test task, so the first behavior task could not update
// the spec it broke and Build refused the edit as outside the granted scope.
function taskTestOwnershipWarnings(draft) {
  const tasks = (draft?.tasks || []).filter((task) => Array.isArray(task?.paths) && task.paths.length);
  const byKey = new Map(tasks.map((task) => [String(task.key || task.id || ""), task]));
  const warnings = [];
  const seen = new Set();
  const check = (task, file) => {
    const key = String(task.key || task.id);
    if (seen.has(`${key}\0${file}`) || leasePathIsAllowed(file, task.paths)) return;
    seen.add(`${key}\0${file}`);
    const owner = tasks.find((other) => other !== task && leasePathIsAllowed(file, other.paths));
    warnings.push(`task '${key}' verifies with '${file}' outside its paths${
      owner ? ` (owned by '${owner.key || owner.id}')` : ""}; add it to the task that changes the behavior`);
  };
  for (const task of tasks) for (const file of verifyTestFiles(task.verify)) check(task, file);
  for (const row of Array.isArray(draft?.testMap) ? draft.testMap : []) {
    const task = byKey.get(String(row?.task || ""));
    if (task && row?.file) check(task, String(row.file));
  }
  return warnings;
}

function cell(value) {
  const text = Array.isArray(value)
    ? value.map((item) => (item && typeof item === "object" ? flatObject(item) : item)).join("; ")
    : value && typeof value === "object" ? flatObject(value) : value;
  return String(text ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|") || "—";
}

function flatObject(value) {
  return Object.entries(value).map(([key, item]) => `${key}: ${
    Array.isArray(item) ? item.join(", ") : item}`).join(", ");
}

// A column marked optional renders only when some row supplies it, so a
// reader never scans a column of dashes.
function table(headers, rows) {
  const shown = headers.filter(([, field, optional]) =>
    !optional || rows.some((row) => present(row?.[field])));
  return `| ${shown.map(([label]) => label).join(" | ")} |\n` +
    `|${shown.map(() => "---").join("|")}|\n` +
    rows.map((row) => `| ${shown.map(([, field]) => cell(row?.[field])).join(" | ")} |`).join("\n");
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => `- ${cell(item)}`).join("\n") : `- ${cell(value)}`;
}

function apiContract(row) {
  const errors = Array.isArray(row.errors)
    ? row.errors.map((error) => (error && typeof error === "object"
      ? `- \`${error.status ?? error.code ?? "?"}\` ${error.when || error.meaning || ""}`.trimEnd()
      : `- ${error}`)).join("\n")
    : `- ${cell(row.errors)}`;
  const block = (value) => (value && typeof value === "object"
    ? `\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`` : ` ${cell(value)}`);
  return `### ${cell(row.method)} ${cell(row.path)}\n\n` +
    (row.purpose ? `${row.purpose}\n\n` : "") +
    `- **Auth:** ${cell(row.auth)}` +
    (present(row.idempotency) ? `\n- **Idempotency:** ${cell(row.idempotency)}` : "") +
    (present(row.compatibility) ? `\n- **Compatibility:** ${cell(row.compatibility)}` : "") +
    `\n\n**Request:**${block(row.request)}\n\n**Response:**${block(row.response)}\n\n` +
    `**Errors:**\n\n${errors}`;
}

function dataEntity(row) {
  const fields = Array.isArray(row.fields) && row.fields.some((field) => field && typeof field === "object")
    ? table([["Field", "name"], ["Type", "type"], ["Constraints", "constraints"]], row.fields)
    : list(row.fields);
  return `### ${cell(row.entity)}\n\n${fields}` + facts([
    ["Invariants", row.invariants], ["Migration", row.migration], ["Rollback", row.rollback]
  ]);
}

// Labelled facts render only when supplied; an empty field is not a finding.
function facts(rows) {
  const lines = rows.filter(([, value]) => present(value))
    .map(([label, value]) => `- **${label}:** ${cell(value)}`);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

function uiScreen(row) {
  const states = Array.isArray(row.states) && row.states.some((state) => state && typeof state === "object")
    ? table([["State", "state"], ["Shows", "shows"], ["Actions", "actions"]], row.states)
    : list(row.states);
  return `### ${cell(row.screen)}\n\n${states}` +
    facts([["Accessibility", row.accessibility], ["Copy", row.copy]]);
}

function jobContract(row) {
  return `### ${cell(row.key)}` + facts([
    ["States", row.states], ["Transitions", row.transitions], ["Retry", row.retry],
    ["Timeout", row.timeout], ["Idempotency", row.idempotency], ["Cancellation", row.cancellation]
  ]);
}

// The work type a design states: declared, or inferred from the paths (said
// so, with how to override it).
export function renderWorkType(declared, inferred = []) {
  if (declared.length) return `## Work type\n\n${declared.join(", ")}`;
  return inferred.length
    ? `## Work type\n\n${inferred.join(", ")} (inferred from paths; declare workType to override)` : "";
}

// Sections render only when the draft supplies them, in reading order: what
// it exposes, how it fails, where code lands, and how it is proven.
export function renderDesignBlueprints(draft, { inferredWorkTypes = [], fileTree = "" } = {}) {
  const sections = [];
  const types = renderWorkType(draftWorkTypes(draft), inferredWorkTypes);
  if (types) sections.push(types);
  if (draft.bugfix) sections.push(`## Bugfix analysis\n\n` +
    `- **Reproduction:** ${cell(draft.bugfix.reproduction)}\n` +
    `- **Root cause:** ${cell(draft.bugfix.rootCause)}\n` +
    `- **Regression proof:** ${cell(draft.bugfix.regression)}`);
  if (draft.refactor) sections.push(`## Refactor invariants\n\n${list(draft.refactor.invariants)}\n\n` +
    `- **Characterization:** ${cell(draft.refactor.characterization)}`);
  if (present(draft.apiContracts))
    sections.push(`## API contracts\n\n${draft.apiContracts.map(apiContract).join("\n\n")}`);
  if (present(draft.dataModel)) sections.push(`## Data model\n\n${Array.isArray(draft.dataModel)
    ? draft.dataModel.map(dataEntity).join("\n\n") : DESIGN_FIELDS.dataModel.render(draft.dataModel)}`);
  if (present(draft.uiStates))
    sections.push(`## UI states\n\n${draft.uiStates.map(uiScreen).join("\n\n")}`);
  if (present(draft.configContract)) sections.push(`## Config contract\n\n` + table([
    ["Key", "key"], ["Default", "default"], ["Secret", "secret", true], ["Validation", "validation"],
    ["Scope", "scope", true]
  ], draft.configContract));
  if (present(draft.jobContract))
    sections.push(`## Job contract\n\n${draft.jobContract.map(jobContract).join("\n\n")}`);
  if (present(draft.failureMatrix)) sections.push(`## Failure matrix\n\n` + table([
    ["Failure", "failure"], ["User sees", "userSees"], ["Recovery", "recovery"], ["Covers", "covers", true]
  ], draft.failureMatrix));
  if (present(draft.fileMap)) sections.push(`## File map\n\n` + table([
    ["Repo", "repository", true], ["Path", "path"], ["Change", "change"],
    ["Responsibility", "responsibility"], ["Tasks", "tasks", true]
  ], draft.fileMap) + (fileTree ? `\n\n${fileTree}` : ""));
  // A derived row names the check command that proves it; an authored row
  // may name a test file. Either column shows only when used.
  if (present(draft.testMap)) sections.push(`## Test map\n\n` + table([
    ["Scenario", "scenario"], ["Level", "level"], ["File", "file", true], ["Check", "check", true],
    ["Task", "task"]
  ], draft.testMap));
  return sections.join("\n\n");
}

// Section bodies (no "## " heading) for design rows whose field has no typed
// module: the older uiStates and jobContract lists and the derived tables.
export function renderUiStatesBody(rows) {
  return present(rows) && Array.isArray(rows) ? rows.map(uiScreen).join("\n\n") : "";
}

export function renderJobContractBody(rows) {
  return present(rows) && Array.isArray(rows) ? rows.map(jobContract).join("\n\n") : "";
}

export function renderFailureMatrixBody(rows) {
  return present(rows) && Array.isArray(rows) ? table([
    ["Failure", "failure"], ["User sees", "userSees"], ["Recovery", "recovery"], ["Covers", "covers", true]
  ], rows) : "";
}

export function renderTestMapBody(rows) {
  return present(rows) && Array.isArray(rows) ? table([
    ["Scenario", "scenario"], ["Level", "level"], ["File", "file", true], ["Check", "check", true],
    ["Task", "task"]
  ], rows) : "";
}

function taskList(value) {
  return (Array.isArray(value) ? value : [value]).map((item) => String(item ?? "").trim()).filter(Boolean);
}

// An authored file map renders as given, one row per path. A derived one
// groups the paths that share a task responsibility, so each task's outcome
// is stated once with every path it owns; the tree below marks additions.
export function renderFileMapBody(rows, { derived = false, fileTree = "" } = {}) {
  if (!present(rows) || !Array.isArray(rows)) return "";
  let body;
  if (!derived) {
    body = table([
      ["Repo", "repository", true], ["Path", "path"], ["Change", "change"],
      ["Responsibility", "responsibility"], ["Tasks", "tasks", true]
    ], rows);
  } else {
    const groups = new Map();
    for (const row of rows) {
      const tasks = taskList(row?.tasks);
      const repository = String(row?.repository || "").trim();
      const key = `${repository}|${tasks.join(",")}`;
      const group = groups.get(key) || { repository, tasks, paths: [] };
      group.paths.push(String(row?.change || "").toLowerCase() === "add" ? `\`${row.path}\` (add)` : `\`${row.path}\``);
      groups.set(key, group);
    }
    body = table([["Repo", "repository", true], ["Tasks", "tasks", true], ["Paths", "paths"]],
      [...groups.values()].map((group) => ({ ...group, paths: group.paths.join(", ") })));
  }
  return body + (fileTree ? `\n\n${fileTree}` : "");
}

// Light work alone (docs, test, chore) never forces an otherwise empty design.md.
export function draftHasBlueprints(draft) {
  return draftWorkTypes(draft).some((type) => !LIGHT_WORK.has(type)) ||
    BLUEPRINT_KEYS.some((key) => present(draft?.[key]));
}
