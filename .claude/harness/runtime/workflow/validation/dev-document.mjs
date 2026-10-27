import { leasePathIsAllowed } from "../lease-runtime.mjs";
import { BEHAVIOR_NEUTRAL_WORK, LIGHT_WORK, OBJECT_FIELDS, draftWorkTypes } from "./design-blueprints.mjs";
import { isSemanticV4Plus } from "./draft-version.mjs";
import { REQUIRED_ANSWERS } from "./work-type-fields.mjs";
import { hasAuthoredProposalProse } from "../draft-folder.mjs";

// The dev document: what a Change hands to Build and to the person approving
// it. Readers need to see what they get, what changes, and how it will be
// built and proven; Build needs a plan it can execute. The harness derives
// everything mechanical (folder tree, plan, file map, test map, work type) and
// asks the agent only for content that takes judgment (flows, contracts,
// models, states, failures).

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

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" && value.trim() !== "";
}

// A scope like `src/**` or `src/*.js` names its directory; a file stays a file.
function scopePath(scope) {
  return text(scope).replace(/\/\*\*(?:\/\*)?$/, "/").replace(/\/\*[^/]*$/, "/")
    .replace(/^\.\//, "");
}

function draftPaths(draft) {
  return [
    ...(Array.isArray(draft?.fileMap) ? draft.fileMap.map((row) => text(row?.path)) : []),
    ...(draft?.tasks || []).flatMap((task) => strings(task?.paths))
  ].map(scopePath).filter(Boolean);
}

const UI_FILE = /\.(?:tsx|jsx|vue|svelte|css|scss|sass|less|html)$/i;
// Prompts and evals are model behavior even when written as markdown or tests.
const ML_PATH = /(?:^|\/)(?:prompts|evals)\//i;
// A pipeline definition is pipeline work only: a `config.yml` inside .circleci
// is not application configuration.
const CICD_PATH = /(?:^|\/)\.github\/workflows\/|(?:^|\/)\.gitlab-ci\.ya?ml$|(?:^|\/)Jenkinsfile$|(?:^|\/)azure-pipelines\.ya?ml$|(?:^|\/)\.circleci\//;
const PATH_TYPES = [
  ["ui", /(?:^|\/)(?:components?|pages|views|screens|ui|layouts?)\//i],
  ["api", /\.(?:proto|graphql|gql)$|openapi|swagger|(?:^|\/)(?:api|routes?|controllers?|handlers?|endpoints?|resolvers?)\//i],
  ["data", /\.(?:sql|prisma)$|(?:^|\/)(?:migrations?|db|database|models?|schema|schemas|entities|repositories)\//i],
  ["async", /(?:^|\/)(?:jobs?|workers?|queues?|consumers?|producers?|schedulers?|cron)\//i],
  ["config", /(?:^|\/)config\/|(?:^|\/|\.)config\.[\w.]+$|\.env\.example$/i],
  ["infra", /\.tf(?:vars)?$|(?:^|\/)(?:terraform|helm|k8s|kubernetes)\/|^charts\/|(?:^|\/)Chart\.ya?ml$|(?:^|\/)Dockerfile(?:\.[\w.-]+)?$/],
  ["observability", /(?:^|\/)(?:dashboards|alerts)\/|(?:^|\/)monitoring\/(?:[^/]+\/)*[^/]+\.rules\.ya?ml$/i],
  ["cicd", CICD_PATH],
  ["ml", ML_PATH]
];
// Paths that carry no product code of their own: package manifests and
// lockfiles (dependency work), documentation, tests, and repository
// housekeeping. A change made only of these infers its kind from them.
const LIGHT_PATHS = [
  ["dependency", /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|go\.(?:mod|sum)|Cargo\.(?:toml|lock)|requirements(?:[-.][\w-]+)?\.txt|Pipfile(?:\.lock)?|poetry\.lock|uv\.lock|Gemfile(?:\.lock)?|composer\.(?:json|lock))$/],
  ["docs", /\.(?:md|mdx|rst|txt)$|(?:^|\/)docs?\//i],
  ["test", /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[\w]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|py)$/i],
  ["chore", /(?:^|\/)(?:\.gitignore|\.gitattributes|\.editorconfig|CODEOWNERS|LICENSE(?:\.\w+)?)$/]
];

// "dependency", "docs", "test", "chore", or "" for product code. Prove's test
// discrimination classifies changed paths the same way work-type inference does.
export function lightKind(path) {
  return LIGHT_PATHS.find(([, pattern]) => pattern.test(path))?.[0] || "";
}

// A UI file under routes/ or api/ (a page component) is UI, not an endpoint.
function pathTypes(path) {
  if (CICD_PATH.test(path)) return ["cicd"];
  if (UI_FILE.test(path)) return ["ui"];
  return PATH_TYPES.filter(([, pattern]) => pattern.test(path)).map(([type]) => type);
}

// Declared work types win. Otherwise the paths the change touches say what
// kind of work it is, so the agent never has to classify its own change.
export function inferWorkTypes(draft) {
  const declared = draftWorkTypes(draft);
  if (declared.length) return declared;
  const paths = draftPaths(draft);
  if (!paths.length) return [];
  const product = paths.filter((path) => !lightKind(path) || ML_PATH.test(path));
  if (!product.length) return [...new Set(paths.map(lightKind))];
  const found = new Set(product.flatMap(pathTypes));
  const inferred = PATH_TYPES.map(([type]) => type).filter((type) => found.has(type));
  // Unclassified code owes only the common sections; a declared feature also
  // owes its user flow.
  return inferred.length ? inferred : ["code"];
}

// Declared docs-only work that adds no behavior to an existing requirement.
// README wording is not system behavior, so a rapid docs change writes no
// delta spec and Land merges nothing into openspec/specs. Only a declared
// workType counts: a markdown path may itself be product behavior (a prompt
// or a skill), so inference never drops a spec.
export function docsOnlyDraft(draft) {
  const types = draftWorkTypes(draft);
  return types.length > 0 && types.every((type) => type === "docs") &&
    (draft?.specs || []).every((spec) =>
      String(spec?.operation || "added").toLowerCase() === "added");
}

// The work types a compiled change states: the "## Work type" section of
// design.md (standard) or proposal.md (rapid), else a refactor section, else
// what its tasks' [paths:] infer — so a change compiled before work types were
// rendered still classifies the same way its draft did.
export function packetWorkTypes({ design = "", proposal = "", tasks = "" } = {}) {
  for (const document of [design, proposal]) {
    const line = String(document || "").match(/^## Work type[ \t]*\n+([^\n]+)/m)?.[1];
    if (line) return [...new Set(line.replace(/\(.*$/, "").split(",")
      .map((type) => type.trim().toLowerCase()).filter(Boolean))];
  }
  const documents = `${design || ""}\n${proposal || ""}`;
  if (/^## Refactor invariants/m.test(documents) && !/^## Bugfix analysis/m.test(documents))
    return ["refactor"];
  const paths = [...String(tasks || "").matchAll(/\[paths:([^\]]*)\]/g)]
    .flatMap((match) => match[1].split(",")).map(text).filter(Boolean);
  return inferWorkTypes({ tasks: [{ paths }] });
}

export function workTypesInferred(draft) {
  return !draftWorkTypes(draft).length && inferWorkTypes(draft).length > 0;
}

// Sections the reader and Build need per kind of work (the work type catalog
// in change-doc-outline.md). File map, test map, folder tree, and plan are
// derived by the harness, so they are never asked for. Docs, test, and chore
// owe only a summary. Kept minimal: a type asks only for what its catalog row
// names, so an author is never slowed by sections the work does not need.
const REQUIRED_BY_TYPE = {
  feature: ["userFlow"],
  bugfix: ["bugfix"],
  refactor: ["refactor", "componentMap"],
  api: ["apiContracts", "boundaries"],
  library: ["libraryContract"],
  ui: ["userFlow", "uiStates", "componentMap"],
  data: ["dataModel"],
  migration: ["migrationPlan", "rollout"],
  async: ["jobContract", "diagrams"],
  integration: ["integrations"],
  config: ["configContract"],
  performance: ["nfr", "performanceAnalysis"],
  dependency: ["dependencyChange"],
  deprecation: ["deprecationPlan"],
  infra: ["infraPlan", "rollout"],
  observability: ["observability"],
  privacy: ["privacyAssessment", "threatModel"],
  experiment: ["experimentDesign", "rollout"],
  "client-release": ["releasePlan"],
  ml: ["modelCard"],
  "data-fix": ["dataFix"],
  security: ["threatModel", "hardening"],
  cicd: ["pipelinePlan"]
};
// A bugfix variant adds the detail its kind of fix owes.
const BUGFIX_VARIANT_SECTIONS = {
  security: ["bugfix.disclosure"],
  hotfix: ["bugfix.incident", "bugfix.backport"]
};
// Work a user or consumer sees announces itself in a release note.
const USER_VISIBLE_WORK = new Set(["feature", "api", "library", "ui", "deprecation", "client-release"]);
// A required section any of whose fields satisfies it ("A or B").
const SECTION_ALTERNATIVES = {
  uiStates: ["uiStates", "ui"],
  jobContract: ["jobContract", "eventContracts"]
};
// Behavior-neutral work tells its failure story in its own section: a refactor
// proves unchanged behavior through its invariants and characterization, and a
// config change states each value's validation. A separate failure matrix
// would restate them.
const NO_FAILURE_MATRIX = BEHAVIOR_NEUTRAL_WORK;

// Each entry names the field, its exact shape, and a short example, so a
// missing-section repair is fixed in one pass.
const SECTION_HELP = {
  summary: "'why' (or 'summary'): 1-3 plain sentences on what the user gets and what changes",
  failureMatrix: "'failureMatrix': [{ failure, userSees, recovery }] for each way this can fail " +
    "(e.g. { \"failure\": \"invalid input\", \"userSees\": \"400 naming the field\", " +
    "\"recovery\": \"resend valid input\" }), or add a requirement scenario with \"kind\": " +
    "\"failure\" (optional \"recovery\"); the harness derives the matrix from it",
  userFlow: "'userFlow': { purpose, source } with a Mermaid flowchart of the user's path, including the error path",
  uiStates: "'uiStates' (or 'ui'): [{ screen, states: [loading, empty, error, success…], accessibility }] " +
    "(e.g. { \"screen\": \"Board\", \"states\": [\"loading\", \"empty\", \"error\", \"success\"], " +
    "\"accessibility\": \"keyboard reachable\" }); 'ui': { entryInfo, states, i18n, accessibility, validation } also satisfies it",
  componentMap: "'componentMap': [{ component, responsibility, files }] mapping each component to its files",
  apiContracts: "'apiContracts': [{ method, path, auth, request, response, errors }] " +
    "(e.g. { \"method\": \"POST\", \"path\": \"/api/cards\", \"auth\": \"Signed-in user\", " +
    "\"request\": { \"title\": \"string\" }, \"response\": { \"id\": \"string\", \"title\": \"string\" }, " +
    "\"errors\": [{ \"status\": 400, \"when\": \"Title is empty\" }] })",
  boundaries: "'boundaries': [{ from, to, mode: sync|async, why, timeout (sync), retry, consistency, " +
    "staleness (eventual), owner }] (e.g. { \"from\": \"api\", \"to\": \"billing\", \"mode\": \"sync\", " +
    "\"why\": \"price at checkout\", \"timeout\": \"2s\", \"retry\": \"none\", \"consistency\": \"strong\", " +
    "\"owner\": \"payments\" })",
  libraryContract: "'libraryContract': { exports: [{ symbol, signature }], errors, semver: major|minor|patch, " +
    "runtimes, deprecation, changelog } (e.g. { \"exports\": [{ \"symbol\": \"parse\", " +
    "\"signature\": \"parse(text: string): Ast\" }], \"semver\": \"minor\", \"changelog\": \"Adds parse\" }); " +
    "a CLI lists commands, flags, exit codes, and its stdout/stderr contract",
  dataModel: "'dataModel': [{ entity, fields, migration, rollback }]",
  migrationPlan: "'migrationPlan': { from, to, seam, dualRun, parity: { check, tolerance }, cutover, " +
    "rollbackWindow, decommission } (e.g. { \"from\": \"v1 jobs\", \"to\": \"queue service\", " +
    "\"seam\": \"JobPort\", \"parity\": { \"check\": \"same results\", \"tolerance\": \"0\" }, " +
    "\"cutover\": \"7 days parity\", \"rollbackWindow\": \"14 days\", \"decommission\": \"T009\" })",
  rollout: "'rollout': { strategy, rollback, deployOrder?, gates?, enablement? { mechanism, " +
    "defaultChanges, canDisable, reenable, downtime, test }, rollbackProof (required when impact is " +
    "high), versionSkew?, upgradeSteps? } (e.g. { \"strategy\": \"flag new-search at 10% then 100%\", " +
    "\"rollback\": \"disable the flag\", \"deployOrder\": [\"db\", \"api\"], " +
    "\"rollbackProof\": \"enable, disable, enable test passes\" })",
  configContract: "'configContract': [{ key, default, validation }]",
  jobContract: "'jobContract' (or 'eventContracts'): [{ key, states, retry, timeout, idempotency }] " +
    "(e.g. { \"key\": \"sync-invoices\", \"states\": [\"queued\", \"done\", \"failed\"], " +
    "\"retry\": \"3x backoff\", \"timeout\": \"30s\", \"idempotency\": \"invoice id\" }); " +
    "'eventContracts': [{ name, producer, consumers, payload, ordering, delivery }] also satisfies it",
  diagrams: "'diagrams': a Mermaid sequence or state diagram that includes the failure path",
  integrations: "'integrations': each external system with its documentation and concerns",
  nfr: "'nfr': [{ key, characteristic (ISO 25010), stimulus, response, measure }] " +
    "(e.g. { \"key\": \"search-latency\", \"characteristic\": \"time behaviour\", " +
    "\"stimulus\": \"100 rps search\", \"response\": \"results returned\", \"measure\": \"p95 < 200ms\" })",
  performanceAnalysis: "'performanceAnalysis': { baseline: { value, method }, profile, hypothesis, target, " +
    "benchmark: { runs, variance, environment }, tradeoffs, regressionBudget } (e.g. { \"baseline\": " +
    "{ \"value\": \"p95 480ms\", \"method\": \"k6 5 runs\" }, \"hypothesis\": \"N+1 query\", " +
    "\"target\": \"p95 < 200ms\" })",
  dependencyChange: "'dependencyChange': [{ package, from, to, breaking, cves, license, transitive, " +
    "rollbackPin, provenance, sbom }] (e.g. { \"package\": \"express\", \"from\": \"4.19.2\", " +
    "\"to\": \"4.21.0\", \"breaking\": \"none in changelog\", \"cves\": \"fixes CVE-2024-43796\", " +
    "\"rollbackPin\": \"4.19.2\", \"provenance\": \"npm provenance attested\", " +
    "\"sbom\": \"sbom.cdx.json regenerated\" })",
  deprecationPlan: "'deprecationPlan': { what, replacement, consumers, announce, warning, usageMetric, " +
    "removalCondition } (e.g. { \"what\": \"GET /v1/items\", \"replacement\": \"GET /v2/items\", " +
    "\"warning\": \"Deprecation header\", \"removalCondition\": \"usage zero for 30 days\" })",
  infraPlan: "'infraPlan': { planDiff, environments, capacity, costDelta, blastRadius, secrets, " +
    "provisioningOrder, drift } (e.g. { \"planDiff\": \"+1 aws_sqs_queue\", \"environments\": " +
    "[\"staging\", \"prod\"], \"costDelta\": \"+$4/month\", \"blastRadius\": \"jobs only\" })",
  observability: "'observability': { rows: [{ failure, signal, sli, slo, alert, runbook, owner }], usage, " +
    "correlation } (e.g. rows: [{ \"failure\": \"queue backlog\", \"signal\": \"queue_depth\", " +
    "\"sli\": \"age < 60s\", \"slo\": \"99%\", \"alert\": \"age > 300s 10m\", " +
    "\"runbook\": \"docs/runbooks/queue.md\", \"owner\": \"platform\" }])",
  privacyAssessment: "'privacyAssessment': { data: [{ field, class }], purpose, lawfulBasis, minimization, " +
    "retention, deletion, subjectRequests, transfers } (e.g. { \"data\": [{ \"field\": \"email\", " +
    "\"class\": \"personal\" }], \"purpose\": \"login\", \"retention\": \"account life + 30 days\" })",
  threatModel: "'threatModel': { assets, trustBoundaries, threats: [{ key, stride, threat, likelihood, " +
    "impact, control, residual }] } (e.g. \"assets\": [\"customer exports\"], \"trustBoundaries\": " +
    "[\"browser to api\"], \"threats\": [{ \"key\": \"t1\", \"stride\": \"information disclosure\", " +
    "\"threat\": \"export leaks another tenant\", \"likelihood\": \"low\", \"impact\": \"high\", " +
    "\"control\": \"tenant filter\", \"residual\": \"low\" }])",
  experimentDesign: "'experimentDesign': { hypothesis, primaryMetric, guardrails, unit, allocation, " +
    "sampleSize, stopRules, exposureLogging, decisionRule, cleanup } (e.g. { \"hypothesis\": " +
    "\"one-step checkout lifts conversion\", \"primaryMetric\": \"checkout conversion\", " +
    "\"allocation\": \"50/50 by user\", \"decisionRule\": \"ship if +1% at 95%\", " +
    "\"guardrails\": [\"error rate\"], \"stopRules\": [\"stop if errors double\"] }); guardrails and " +
    "stopRules are required: a list, or 'unknown: <reason>' when they are not yet known",
  releasePlan: "'releasePlan': { minimumVersion, coexistence, serverWindow, storeReview, stagedRollout, " +
    "forcedUpgrade, crashGate } (e.g. { \"minimumVersion\": \"5.2\", \"stagedRollout\": " +
    "[\"1%\", \"10%\", \"100%\"], \"crashGate\": \"crash-free >= 99.5%\" })",
  modelCard: "'modelCard': { intendedUse, outOfScope, model: { provider, version }, dataSource, " +
    "evaluation: { set, thresholds }, limitations, oversight, cost, monitoring, fallback } " +
    "(e.g. { \"intendedUse\": \"summarize tickets\", \"model\": { \"provider\": \"anthropic\", " +
    "\"version\": \"pinned id\" }, \"fallback\": \"show the raw ticket\", \"evaluation\": { \"set\": " +
    "\"200 labelled tickets\", \"thresholds\": [{ \"metric\": \"accuracy\", \"threshold\": \">= 0.9\" }] } }); " +
    "evaluation is required: the object, or 'unknown: <reason>' when there is no evaluation yet",
  dataFix: "'dataFix': { scope, snapshot, dryRun, rerunSafe, rollback } for a one-off change to production " +
    "data (e.g. { \"scope\": \"1,204 rows in refunds\", \"snapshot\": \"table copy refunds_bak\", " +
    "\"dryRun\": \"count and diff on staging\", \"rerunSafe\": \"yes, keyed by id\", " +
    "\"rollback\": \"restore from refunds_bak\" }); any field may be 'unknown: <reason>' or 'none: <reason>'",
  hardening: "'hardening': { weakness, control, verification } for a security improvement with no single bug " +
    "(e.g. { \"weakness\": \"sessions never expire\", \"control\": \"8 hour expiry\", " +
    "\"verification\": \"test with an expired token\" }); pair it with 'threatModel'",
  pipelinePlan: "'pipelinePlan': { changes, permissions, blastRadius, rollback } for a CI/CD or build change " +
    "(e.g. { \"changes\": \"add a deploy job\", \"permissions\": \"id-token write, no secrets\", " +
    "\"blastRadius\": \"staging deploys only\", \"rollback\": \"revert the workflow file\" })",
  releaseNote: "'releaseNote': 1-3 sentences a user or consumer reads in the changelog " +
    "(e.g. \"Search now filters by tag.\")",
  bugfix: "'bugfix': { reproduction, rootCause, regression }",
  "bugfix.disclosure": "'bugfix.disclosure' (security fix): { class, affectedVersions, exploitability, " +
    "owner, embargo, advisory, backports } (e.g. { \"class\": \"IDOR\", \"affectedVersions\": \"<2.4.1\", " +
    "\"owner\": \"security\", \"advisory\": \"GHSA pending\" })",
  "bugfix.incident": "'bugfix.incident' (hotfix): { link, mitigation, minimumScope, followUp } " +
    "(e.g. { \"link\": \"INC-212\", \"mitigation\": \"flag off\", \"followUp\": \"full fix change\" })",
  "bugfix.backport": "'bugfix.backport' (hotfix): the branches that receive the fix " +
    "(e.g. [\"release/2.3\", \"release/2.4\"])",
  refactor: "'refactor': { invariants, characterization }"
};

export function requiredDevSections(draft) {
  const types = inferWorkTypes(draft);
  if (!types.length || types.every((type) => LIGHT_WORK.has(type))) return ["summary"];
  const failures = types.some((type) => !NO_FAILURE_MATRIX.has(type)) ? ["failureMatrix"] : [];
  const variant = text(draft?.bugfix?.variant).toLowerCase();
  const variants = types.includes("bugfix") ? BUGFIX_VARIANT_SECTIONS[variant] || [] : [];
  const releaseNote = types.some((type) => USER_VISIBLE_WORK.has(type)) ? ["releaseNote"] : [];
  return [...new Set(["summary", ...failures,
    ...types.flatMap((type) => REQUIRED_BY_TYPE[type] || []), ...variants, ...releaseNote])];
}

function userFlowSource(value) {
  return typeof value === "string" ? text(value) : text(value?.source);
}

const NO_SEPARATE_RECOVERY = "No separate step; the outcome is the handling";

// Scenarios the author did not classify are read as failures only when their
// own words say so: an error status first, or a rejection/error verb. An
// explicit kind (success, boundary...) is never second-guessed.
const FAILURE_STATUS = /^\s*[45]\d\d\b/;
const FAILURE_WORDS = new RegExp("\\b(?:reject\\w*|invalid|malformed|errors?|fail(?:s|ed|ure|ures)?|" +
  "den(?:y|ies|ied)|forbidden|unauthori[sz]ed|not found|throws?|refus\\w*)\\b", "i");

function scenarioList(requirement) {
  return Array.isArray(requirement?.scenarios) ? requirement.scenarios
    : requirement?.scenario !== undefined ? [requirement.scenario] : [];
}

function scenarioFailureKind(row) {
  if (!row || typeof row !== "object") return "";
  const kind = text(row.kind).toLowerCase();
  if (kind) return kind === "failure" ? "explicit" : "";
  return FAILURE_STATUS.test(text(row.then)) ||
    FAILURE_WORDS.test([row.name, row.when, row.then].map(text).join(" ")) ? "inferred" : "";
}

// A scenario's kind for the acceptance table: the authored kind (success is
// "happy", boundary is "edge"), else failure when its own words say so, else
// "unclassified". Nothing else is inferred.
export function scenarioKindLabel(row) {
  const kind = text(row?.kind).toLowerCase();
  if (kind) return kind === "success" ? "happy" : kind === "boundary" ? "edge" : kind;
  return scenarioFailureKind(row) ? "failure" : "unclassified";
}

function failureScenarios(draft) {
  const found = (Array.isArray(draft?.requirements) ? draft.requirements : [])
    .flatMap((requirement) => scenarioList(requirement).map((scenario) => ({
      requirement: text(requirement?.key), scenario, how: scenarioFailureKind(scenario)
    })).filter((row) => row.how));
  // Authored failure scenarios are authoritative; words are only a fallback.
  return found.some((row) => row.how === "explicit")
    ? found.filter((row) => row.how === "explicit") : found;
}

// Failures are written once. An authored matrix is authoritative; without one,
// each requirement scenario of kind 'failure' (or, unclassified, one that
// states a rejection or error) becomes a row.
export function derivedFailureMatrix(draft) {
  if (present(draft?.failureMatrix)) return draft.failureMatrix;
  return failureScenarios(draft).map(({ requirement, scenario }) => ({
    failure: text(scenario.name) || text(scenario.when) || text(scenario.scenario),
    userSees: text(scenario.then) || text(scenario.outcome),
    recovery: text(scenario.recovery) || NO_SEPARATE_RECOVERY,
    ...(requirement ? { covers: [requirement] } : {})
  })).filter((row) => row.failure && row.userSees);
}

// What the harness filled in, so a reader can tell it from authored text: the
// reason (the intent states it), the failure matrix (read from scenarios), and
// evidence capabilities defaulted to the lane's plain check.
export function derivedByHarness(draft, { standard = true } = {}) {
  const notes = [];
  if (!isSemanticV4Plus(draft?.version) || !standard) return notes;
  const required = requiredDevSections(draft);
  if (!text(draft.summary) && !text(draft.why) &&
    !hasAuthoredProposalProse(draft, "summary") && !hasAuthoredProposalProse(draft, "why"))
    notes.push("**Why:** not authored separately; the intent above states it.");
  if (required.includes("failureMatrix") && !present(draft.failureMatrix)) {
    const rows = failureScenarios(draft);
    if (rows.length)
      notes.push(`**Failure matrix:** read from ${rows.some((row) => row.how === "inferred")
        ? "scenarios that state a rejection or error" : "the failure scenarios"} ` +
        `(${rows.length}); recovery is "${NO_SEPARATE_RECOVERY}" where unstated.`);
  }
  if (Array.isArray(draft._defaultedEvidence) && draft._defaultedEvidence.length)
    notes.push("**Evidence capabilities:** defaulted to `test` (`static-analysis` for " +
      `docs/chore) for ${draft._defaultedEvidence.join(", ")}.`);
  return notes;
}

function sectionValue(draft, key) {
  if (key === "userFlow") return userFlowSource(draft?.userFlow);
  // The intent already states the outcome; a draft with no separate reason is
  // not sent back for one (derivedByHarness records it).
  if (key === "summary") return text(draft?.summary) || text(draft?.why) || text(draft?.intent);
  if (key === "failureMatrix") return derivedFailureMatrix(draft);
  if (SECTION_ALTERNATIVES[key])
    return SECTION_ALTERNATIVES[key].map((field) => draft?.[field]).find(present);
  return key.split(".").reduce((value, part) => value?.[part], draft);
}

// A standard change is approved and built from its dev document, so each
// section its kind of work needs is an agent repair before compilation —
// never a user question and never a refusal of the edit itself.
// `lane` names why the draft is standard when the harness derived it.
export function devDocumentIssues(draft, { standard = true, lane = "" } = {}) {
  if (!isSemanticV4Plus(draft?.version) || !standard) return [];
  const issues = [];
  const types = inferWorkTypes(draft);
  const label = (workTypesInferred(draft)
    ? `${types.join(", ")}, inferred from paths; or declare workType to override`
    : types.join(", ") || "change") + (lane ? `; standard lane: ${lane}` : "");
  for (const key of requiredDevSections(draft)) {
    const value = sectionValue(draft, key);
    if (!present(value)) issues.push(`dev document (${label}) needs ${SECTION_HELP[key]}; add it to change.json`);
  }
  return issues;
}

// The same required sections as devDocumentIssues, one row each, for a reader
// who needs to see what is present and what is missing. A draft whose work
// type cannot be inferred owes no sections, so nothing is listed.
// A section made of named fields (bugfix, refactor, and the sections that must
// answer fixed fields) is present only when each of those fields is, and the
// row lists the ones that are not.
export function devDocumentChecklist(draft) {
  if (!inferWorkTypes(draft).length) return [];
  return requiredDevSections(draft).map((key) => {
    const missingFields = present(sectionValue(draft, key))
      ? [...(OBJECT_FIELDS[key] || []), ...(REQUIRED_ANSWERS[key] || [])]
        .filter((field) => !present(sectionValue(draft, key)?.[field]))
      : [];
    return { key, present: present(sectionValue(draft, key)) && missingFields.length === 0, missingFields };
  });
}

// Shape brackets around a node label: [x], [[x]], [(x)], ([x]), {x}, {{x}},
// [/x/]. The opening and closing pair belong to the shape, not the label.
const NODE_OPEN = /(?<![\w"'])([A-Za-z_][\w-]*)(\(\[|\[\[|\[\(|\[\/|\{\{|\[|\{)/g;
const NODE_CLOSE = { "([": "])", "[[": "]]", "[(": ")]", "[/": "/]", "{{": "}}", "[": "]", "{": "}" };

function nodeLabels(line) {
  return [...line.matchAll(NODE_OPEN)].flatMap((match) => {
    const start = match.index + match[0].length;
    const close = NODE_CLOSE[match[2]];
    // A quoted label may hold the closing bracket; it ends at the closing quote.
    const quoted = line[start] === '"' ? line.indexOf('"', start + 1) : -1;
    const end = line.indexOf(close, quoted >= 0 ? quoted : start);
    return end < 0 ? [] : [{ id: match[1], open: match[2], close, content: line.slice(start, end) }];
  });
}

// mermaid@11 rejects `A[mean(values)]`: an unquoted parenthesis or quote
// inside a flowchart node label ends the label early. Quoting the label
// (`A["mean(values)"]`) is the documented fix. Only flowcharts are checked;
// sequence and state diagrams use brackets differently.
export function mermaidLabelIssues(source, label) {
  const body = text(source);
  if (!/^(?:flowchart|graph)\b/i.test(body)) return [];
  const issues = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(?:%%|classDef\b|style\b|click\b|linkStyle\b)/.test(line)) continue;
    for (const { id, open, close, content: raw } of nodeLabels(line)) {
      const content = raw.trim();
      if (/^".*"$/.test(content) || !/[()"]/.test(content)) continue;
      issues.push(`semantic draft ${label} node label '${id}${open}${raw}${close}' has an unquoted ( ) or "; ` +
        `quote it: ${id}${open}"${content.replaceAll('"', "#quot;")}"${close}`);
    }
  }
  return issues;
}

function mermaidSources(draft) {
  const sources = [];
  if (userFlowSource(draft?.userFlow)) sources.push(["userFlow", userFlowSource(draft.userFlow)]);
  const overview = typeof draft?.diagram === "string" ? draft.diagram : draft?.diagram?.source;
  if (text(overview)) sources.push(["diagram", overview]);
  (Array.isArray(draft?.diagrams) ? draft.diagrams : []).forEach((diagram, index) => {
    if (text(diagram?.source) && (!diagram.type || diagram.type === "mermaid"))
      sources.push([`diagrams[${index}]`, diagram.source]);
  });
  return sources;
}

// Typed declarations that name a work type the draft must also declare.
// Prose is never read; only these fields decide.
const WORK_TYPE_SIGNALS = Object.freeze([
  ["integration", (draft) => (Array.isArray(draft?.integrations) && draft.integrations.length > 0) ||
    riskSignalsOf(draft).includes("external-integration"), "integrations or riskSignals external-integration"],
  ["performance", (draft) => riskSignalsOf(draft).includes("performance-slo"), "riskSignals performance-slo"]
]);

function riskSignalsOf(draft) {
  return Array.isArray(draft?.riskSignals) ? draft.riskSignals.map(String) : [];
}

// A declared workType that omits a type its typed signals require would skip
// that type's sections (an integration declared as feature had no
// integration contract). Undeclared work keeps path inference.
export function workTypeSignalIssues(draft) {
  const declared = draftWorkTypes(draft);
  if (!declared.length) return [];
  return WORK_TYPE_SIGNALS.filter(([type, applies]) => applies(draft) && !declared.includes(type))
    .map(([type, , because]) => `semantic draft workType [${declared.join(", ")}] lacks '${type}', ` +
      `which ${because} requires; add '${type}' to workType and copy its block from workTypeExamples`);
}

export function devDocumentShapeIssues(draft) {
  const issues = [...workTypeSignalIssues(draft)];
  if (draft?.userFlow !== undefined && !userFlowSource(draft.userFlow))
    issues.push("semantic draft userFlow needs Mermaid source (a string or { purpose, source })");
  for (const [label, source] of mermaidSources(draft)) issues.push(...mermaidLabelIssues(source, label));
  if (draft?.componentMap !== undefined) {
    if (!Array.isArray(draft.componentMap))
      issues.push("semantic draft componentMap must be an array");
    else draft.componentMap.forEach((row, index) => {
      if (!text(row?.component)) issues.push(`semantic draft componentMap[${index}].component is required`);
      if (!text(row?.responsibility))
        issues.push(`semantic draft componentMap[${index}].responsibility is required`);
    });
  }
  return issues;
}

function taskIdsFor(path, tasks) {
  const target = scopePath(path).replace(/\/$/, "");
  return (tasks || []).filter((task) => strings(task?.paths).some((scope) =>
    leasePathIsAllowed(target, [scope]) || scopePath(scope).replace(/\/$/, "") === target))
    .map((task) => task.id).filter(Boolean);
}

const CHANGE_MARK = [
  [/^(?:add|new|create)/i, "+"],
  [/^(?:delete|remove)/i, "-"]
];

function changeMark(change) {
  return CHANGE_MARK.find(([pattern]) => pattern.test(text(change)))?.[1] || "~";
}

const ROOT_REPOSITORY = "root";

function repositoryOf(owner) {
  return text(owner?.repository) || ROOT_REPOSITORY;
}

// A root path keys as itself and another repository's as `repo::path`, so the
// same path in two repositories never collides.
function pathKey(repository, path) {
  return repository === ROOT_REPOSITORY ? path : `${repository}::${path}`;
}

// Paths the change's base does not have yet (recorded by withNewPaths), so a
// task path that creates a file reads as an addition without a file map.
function newPaths(draft) {
  return new Set(strings(draft?._newPaths).map((entry) => {
    const split = entry.indexOf("::");
    return split < 0 ? scopePath(entry) : `${entry.slice(0, split)}::${scopePath(entry.slice(split + 2))}`;
  }));
}

// Record which task paths do not exist at their repository's base. `exists`
// answers for a path relative to that repository's root (the repository id is
// the second argument for a non-root task); a throw means the root is unknown.
export function withNewPaths(draft, exists) {
  if (typeof exists !== "function") return draft;
  const fresh = new Set();
  for (const task of draft?.tasks || []) {
    const repository = repositoryOf(task);
    for (const scope of strings(task?.paths)) {
      const path = scopePath(scope);
      if (!path || /[*?[]/.test(path) || path.startsWith("../") || path.startsWith("/")) continue;
      try {
        const bare = path.replace(/\/$/, "");
        const present = repository === ROOT_REPOSITORY ? exists(bare) : exists(bare, repository);
        if (!present) fresh.add(pathKey(repository, path));
      } catch { /* unknown is never reported as an addition */ }
    }
  }
  return fresh.size ? { ...draft, _newPaths: [...fresh] } : draft;
}

// A tree of every path the change touches, marked + add, ~ change, - remove.
// Directory scopes end in `/`; the reader sees the shape of the change at once.
// Rendered inside design.md's file map, which already lists the paths.
// A change that names a repository gets one titled tree per repository.
export function renderFileTree(draft) {
  const fresh = newPaths(draft);
  const repositories = new Map();
  const marksOf = (repository) => {
    if (!repositories.has(repository)) repositories.set(repository, new Map());
    return repositories.get(repository);
  };
  for (const row of Array.isArray(draft?.fileMap) ? draft.fileMap : []) {
    const path = scopePath(row?.path);
    const repository = repositoryOf(row);
    if (path) marksOf(repository).set(path,
      text(row?.change) ? changeMark(row.change) : fresh.has(pathKey(repository, path)) ? "+" : "~");
  }
  for (const task of draft?.tasks || [])
    for (const scope of strings(task?.paths)) {
      const path = scopePath(scope);
      const repository = repositoryOf(task);
      if (path && !marksOf(repository).has(path))
        marksOf(repository).set(path, fresh.has(pathKey(repository, path)) ? "+" : "~");
    }
  const named = [...repositories.keys()].some((repository) => repository !== ROOT_REPOSITORY);
  const blocks = [...repositories.entries()]
    .sort(([left], [right]) => (left === ROOT_REPOSITORY ? -1 : right === ROOT_REPOSITORY ? 1
      : left.localeCompare(right)))
    .map(([repository, marks]) => {
      const block = "```text\n" + treeLines(marks) + "\n```";
      return named ? `**${repository}**\n\n${block}` : block;
    });
  return blocks.length ? "`+` add · `~` change · `-` remove\n\n" + blocks.join("\n\n") : "";
}

function treeLines(marks) {
  const root = new Map();
  for (const [path, mark] of [...marks.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const parts = path.replace(/\/$/, "").split("/");
    let node = root;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      const name = last && path.endsWith("/") ? `${part}/` : last ? part : `${part}/`;
      if (!node.has(name)) node.set(name, { children: new Map(), mark: null });
      if (last) node.get(name).mark = mark;
      node = node.get(name).children;
    });
  }
  const lines = ["."];
  const walk = (node, prefix) => {
    const entries = [...node.entries()];
    entries.forEach(([name, value], index) => {
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? "└── " : "├── "}${value.mark ? `${value.mark} ` : ""}${name}`);
      walk(value.children, `${prefix}${last ? "    " : "│   "}`);
    });
  };
  walk(root, "");
  return lines.join("\n");
}

function requirementsByTask(draft) {
  const claimToKey = new Map((draft?.claims || []).map((claim) => [claim.id, claim.requirementKey]));
  return new Map((draft?.tasks || []).map((task) => [task.id,
    [...new Set((task.claims || []).map((claim) => claimToKey.get(claim)).filter(Boolean))]]));
}

// Without an authored file map, each task scope is one row owned by its tasks.
// A task's outcome lives only in tasks.md, so a derived row refers to it by task
// id and never copies the text.
export function derivedFileMap(draft) {
  if (present(draft?.fileMap)) return draft.fileMap;
  const fresh = newPaths(draft);
  const rows = new Map();
  for (const task of draft?.tasks || [])
    for (const scope of strings(task?.paths)) {
      const path = scopePath(scope);
      if (!path) continue;
      const repository = repositoryOf(task);
      const key = pathKey(repository, path);
      const row = rows.get(key) ||
        { path, ...(repository === ROOT_REPOSITORY ? {} : { repository }),
          change: fresh.has(key) ? "add" : "change", responsibility: "", tasks: [] };
      row.tasks = [...new Set([...row.tasks, task.id].filter(Boolean))];
      rows.set(key, row);
    }
  return [...rows.values()];
}

// Scenario names per requirement key, from the compiled specs.
function scenarioNamesByRequirement(draft) {
  const keys = Array.isArray(draft?._requirementKeys) ? draft._requirementKeys : [];
  return new Map((draft?.specs || []).map((spec, index) => [keys[index],
    (spec?.scenarios || []).map((scenario) => text(scenario?.name)).filter(Boolean)]));
}

// Without an authored test map, each task's check proves the scenarios of the
// requirements it implements; the check is a command, not a file.
export function derivedTestMap(draft) {
  if (present(draft?.testMap)) return draft.testMap;
  const requirements = requirementsByTask(draft);
  const scenarios = scenarioNamesByRequirement(draft);
  return (draft?.tasks || []).filter((task) => text(task.verify)).map((task) => {
    const names = [...new Set((requirements.get(task.id) || []).flatMap((key) =>
      scenarios.get(key)?.length ? scenarios.get(key) : [key]))];
    return {
      // The task's outcome lives in tasks.md; with no linked scenario, point at it.
      scenario: names.join("; ") || `see ${task.id} in tasks.md`,
      level: "task check",
      check: `\`${text(task.verify)}\``,
      task: task.id
    };
  });
}

export function renderUserFlow(draft) {
  const source = userFlowSource(draft?.userFlow);
  if (!source) return "";
  const purpose = typeof draft.userFlow === "object" ? text(draft.userFlow?.purpose) : "";
  return `## User flow\n\n${purpose ? `${purpose}\n\n` : ""}\`\`\`mermaid\n${source}\n\`\`\``;
}

export function renderComponentMap(draft) {
  const rows = Array.isArray(draft?.componentMap) ? draft.componentMap : [];
  if (!rows.length) return "";
  return "## Component map\n\n| Component | Responsibility | Files | Tasks |\n|---|---|---|---|\n" +
    rows.map((row) => {
      const files = strings(Array.isArray(row?.files) ? row.files : [row?.files]);
      const tasks = strings(row?.tasks).length ? strings(row.tasks)
        : [...new Set(files.flatMap((file) => taskIdsFor(file, draft.tasks)))];
      return `| ${cell(row.component)} | ${cell(row.responsibility)} | ${cell(files)} | ${cell(tasks)} |`;
    }).join("\n");
}
