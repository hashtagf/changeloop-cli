import { investigationCoverageIssues } from "./validation/investigation-coverage.mjs";
import { parseSpecDocument } from "../contracts/change-artifacts.mjs";
import {
  normalizeDiscovery, semanticIntakeIssues
} from "./validation/semantic-intake.mjs";
import { designBlueprintIssues } from "./validation/design-blueprints.mjs";
import { EXAMPLE_TYPES, scratchFieldIssues, scratchRequiredIssues } from "./scratch-fields.mjs";
import { undoIssues } from "./undo-plan.mjs";
import { readerGuideIssues } from "./validation/reader-guide.mjs";
import {
  devDocumentIssues, devDocumentShapeIssues, inferWorkTypes
} from "./validation/dev-document.mjs";
import { riskDerivationSummary } from "./validation/draft-risk.mjs";
import {
  FOLDER_DRAFT_VERSION, isFolderDraftVersion, isSemanticV4Plus, isSemanticVersion
} from "./validation/draft-version.mjs";
import { OUTLINE } from "./validation/outline-contract.mjs";

export {
  SEMANTIC_DRAFT_VERSIONS, isSemanticV4Plus, isSemanticVersion
} from "./validation/draft-version.mjs";

const OPERATIONS = new Set(["added", "modified", "removed"]);
const AUTHORITY_CAPABILITIES = new Set(["review", "acceptance", "semantic-acceptance"]);
const PLACEHOLDER = /(?:replace-with|needs clarification|\btodo\b|\btbd\b|<[^>]+>)/i;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function unique(values) {
  return [...new Set(values)];
}

function textList(value) {
  return typeof value === "string" ? [text(value)].filter(Boolean) : stringList(value);
}

// Readability limits for v4 requirement statements. A statement longer than
// this is almost always several requirements or scenario detail in one clause.
const STATEMENT_MAX_WORDS = 60;
const STATEMENT_MAX_CHARACTERS = 400;
const STATEMENT_MAX_SEMICOLONS = 2;
// Matches the slug limit, so a disambiguated claim ID is no longer than a derived one.
const CLAIM_ID_MAX_LENGTH = 64;

function placeholderIssue(value, label, issues) {
  if (PLACEHOLDER.test(text(value))) issues.push(`${label} contains unresolved placeholder text`);
}

function semanticScenarios(requirement) {
  const source = Array.isArray(requirement.scenarios)
    ? requirement.scenarios
    : requirement.scenario !== undefined ? [requirement.scenario] : [];
  return source.map((entry, index) => {
    const object = typeof entry === "string" ? { scenario: entry } : entry || {};
    const fallbackName = text(object.scenario) || text(object.when) ||
      `${text(requirement.key) || "scenario"}-${index + 1}`;
    const given = textList(object.given);
    const and = textList(object.and);
    return {
      key: text(object.key) || fallbackName,
      name: text(object.name) || fallbackName,
      ...(given.length ? { given } : {}),
      when: text(object.when) || text(object.scenario),
      then: text(object.then) || text(object.outcome) || text(requirement.outcome),
      ...(and.length ? { and } : {}),
      ...(text(object.kind) ? { kind: text(object.kind).toLowerCase() } : {}),
      ...(object.access !== undefined && object.access !== null ? { access: object.access } : {})
    };
  });
}

function rawScenarioEntries(requirement) {
  return Array.isArray(requirement?.scenarios) ? requirement.scenarios
    : requirement?.scenario !== undefined ? [requirement.scenario] : [];
}

function comparableLabel(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

// A v4 scenario reads as one titled case: a short name distinct from WHEN,
// preconditions in GIVEN, one trigger, and one outcome plus optional AND lines.
// A modified or amendment-revised requirement may name an existing scenario
// by its title alone, so only a new scenario must carry its own name.
function readableScenarioIssues(requirement, operation, label, issues) {
  for (const [index, entry] of rawScenarioEntries(requirement).entries()) {
    const scenario = typeof entry === "string" ? { when: entry } : entry || {};
    const at = `${label}.scenarios[${index}]`;
    const name = text(scenario.name);
    const when = text(scenario.when) || text(scenario.scenario);
    if (!name && operation !== "modified" && !requirement?._revision)
      issues.push(`${at}.name is required: give the scenario a short title; without one the heading repeats WHEN`);
    else if (name && comparableLabel(name) === comparableLabel(when))
      issues.push(`${at}.name repeats WHEN; use a short title and keep the trigger in 'when'`);
    else if (name && name.length > 80)
      issues.push(`${at}.name is longer than 80 characters; shorten it to a title`);
    const fields = [
      ["given", textList(scenario.given)], ["when", [when]],
      ["then", [text(scenario.then) || text(scenario.outcome)]], ["and", textList(scenario.and)]
    ];
    for (const [field, values] of fields)
      if (values.some((value) => value.includes(";")))
        issues.push(`${at}.${field} joins several cases with ';'; split them into separate ` +
          "scenarios, put preconditions in 'given', and extra outcomes in 'and'");
  }
}

function lowerFirst(value) {
  return value.replace(/^([A-Z])(?=[a-z])/, (letter) => letter.toLowerCase());
}

// v3 keeps its historical stem. v4 never glues an English stem onto a whole
// sentence: an explicit description wins, an outcome that already states
// SHALL/MUST is used as written, an English result clause becomes "The system
// SHALL ensure that <outcome>", an English verb phrase follows "The system
// SHALL", and any other language must supply the statement itself.
function requirementStatement(requirement, outcome, version, operation, label, issues) {
  const description = text(requirement?.description);
  if (!isSemanticV4Plus(version))
    return description || (outcome ? `The system SHALL ${outcome.replace(/[.]$/, "")}.` : "");
  let statement = description;
  if (!statement && outcome) {
    if (/\b(?:SHALL|MUST)\b/.test(outcome)) statement = outcome;
    else if (/[^\x00-\x7F]/.test(outcome))
      issues.push(`${label}.description is required: write the full statement in the ` +
        "document language and keep the SHALL marker");
    else {
      // A result clause ("The card appears", "a board renders") takes "ensure
      // that"; a verb phrase ("record one payment") follows SHALL directly.
      const body = outcome.replace(/[.]$/, "");
      statement = /^(?:[A-Z]|(?:a|an|the|each|every|no|all|any|its|their|this|these|those)\b)/
        .test(body)
        ? `The system SHALL ensure that ${lowerFirst(body)}.`
        : `The system SHALL ${body}.`;
    }
  }
  if (!statement || operation === "removed") return statement;
  if (!/\b(?:SHALL|MUST)\b/.test(statement))
    issues.push(`${label}.description must state the requirement with SHALL or MUST`);
  const words = statement.split(/\s+/).filter(Boolean).length;
  const semicolons = (statement.match(/;/g) || []).length;
  if (words > STATEMENT_MAX_WORDS || statement.length > STATEMENT_MAX_CHARACTERS ||
      semicolons > STATEMENT_MAX_SEMICOLONS)
    issues.push(`${label} statement is too long (${words} words, ${statement.length} characters, ` +
      `${semicolons} ';'); split it into separate requirements, move cases into scenarios, ` +
      "or list constraints in 'details'");
  return statement;
}

function canonicalScenarioDetails(body) {
  const scenarios = [];
  let current = null;
  for (const line of String(body || "").split("\n")) {
    const heading = line.match(/^####\s+Scenario:\s*(.+?)\s*$/i);
    if (heading) {
      current = { key: heading[1], name: heading[1], when: "", then: "" };
      scenarios.push(current);
      continue;
    }
    if (!current) continue;
    const given = line.match(/^\s*-\s*\*\*GIVEN\*\*\s+(.+?)\s*$/i);
    const when = line.match(/^\s*-\s*\*\*WHEN\*\*\s+(.+?)\s*$/i);
    const then = line.match(/^\s*-\s*\*\*THEN\*\*\s+(.+?)\s*$/i);
    const and = line.match(/^\s*-\s*\*\*AND\*\*\s+(.+?)\s*$/i);
    if (given) current.given = [...(current.given || []), given[1]];
    if (when) current.when = when[1];
    if (then) current.then = then[1];
    if (and) current.and = [...(current.and || []), and[1]];
  }
  return scenarios;
}

function mergeCanonicalScenarios(requirement, canonicalText, label, issues) {
  if (!canonicalText) {
    issues.push(`${label} is modified but canonical specification is unavailable`);
    return semanticScenarios(requirement);
  }
  const name = text(requirement?.requirement || requirement?.title) || text(requirement?.key);
  const current = parseSpecDocument(canonicalText).find((row) =>
    row.name.toLowerCase() === name.toLowerCase());
  if (!current) {
    // Naming the choices saves the round an agent spent reading the spec.
    const names = parseSpecDocument(canonicalText).map((row) => row.name);
    issues.push(`${label} cannot find canonical requirement '${name}' to modify` +
      (names.length ? `; set requirement to one of: ${names.join(", ")}` : ""));
    return semanticScenarios(requirement);
  }
  const canonical = canonicalScenarioDetails(current.body);
  const supplied = semanticScenarios(requirement);
  const suppliedByName = new Map(supplied.map((scenario) =>
    [scenario.name.toLowerCase(), scenario]));
  const merged = canonical.map((scenario) =>
    suppliedByName.get(scenario.name.toLowerCase()) || scenario);
  for (const scenario of supplied) {
    if (!canonical.some((row) => row.name.toLowerCase() === scenario.name.toLowerCase()))
      merged.push(scenario);
  }
  return merged;
}

function evidenceEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value));
}

function requiredIntegrationCapabilities(integration) {
  const concerns = new Set(stringList(integration.concerns).map((value) => value.toLowerCase()));
  const capabilities = ["integration"];
  if ([...concerns].some((value) =>
    /auth|credential|signature|webhook|secret|permission|ยืนยันตัวตน|ข้อมูลรับรอง|ลายเซ็น|เว็บฮุก|ความลับ|รหัสลับ|สิทธิ์/u
      .test(value)))
    capabilities.push("security-static");
  if ([...concerns].some((value) =>
    /retry|timeout|rate.limit|partial|degrad|recover/.test(value)))
    capabilities.push("resilience");
  if ([...concerns].some((value) =>
    /compat|version|schema|public.contract/.test(value)))
    capabilities.push("compatibility");
  return capabilities;
}

function securityTriggerList(source) {
  return [
    ...stringList(source?.securityTriggers),
    ...(Array.isArray(source?.integrations) ? source.integrations : [])
      .filter((integration) =>
        requiredIntegrationCapabilities(integration || {}).includes("security-static"))
      .map(() => "external-integration-authentication")
  ].filter((trigger) => trigger.toLowerCase() !== "none");
}

// Mirrors the rapid-lane test in change-lifecycle atomicStartPreflight.
export function semanticRapidCandidate(source) {
  return (text(source?.impact) || "low") === "low" &&
    (text(source?.coupling) || "isolated") === "isolated" &&
    !securityTriggerList(source).length && !source?.reviewRequired &&
    !source?.acceptance?.required;
}

// Omitted evidence capabilities default to the plain check in either lane. Only
// a declared security trigger keeps the choice with the author: which security
// capability proves the boundary is a judgment the compiler must not make.
export function semanticEvidenceDefaultable(source) {
  return !securityTriggerList(source).length;
}

// Alternatives the decision set aside. Only a decision that rejected one owes
// a reason; a settled fact with nothing to choose between does not.
function rejectedAlternatives(decision) {
  const choice = text(decision?.choice);
  const listed = decision?.rejected ?? decision?.alternatives;
  return (Array.isArray(listed) ? stringList(listed) : textList(listed))
    .filter((option) => option !== choice && !/^none$/i.test(option));
}

export const DECISION_STATUSES = Object.freeze(["proposed", "accepted", "superseded"]);

// A decision without a status keeps today's meaning: it is accepted.
export function decisionStatus(decision) {
  return text(decision?.status).toLowerCase() || "accepted";
}

// The optional ADR fields: drivers, options with pros and cons, how the
// decision is confirmed, what it supersedes, and which requirements a durable
// decision governs. Older decisions without them stay valid.
function decisionMetadataIssues(decision, label) {
  const issues = [];
  if (decision?.status !== undefined && !DECISION_STATUSES.includes(decisionStatus(decision)))
    issues.push(`${label}.status must be proposed, accepted, or superseded`);
  const stringArray = (value) => Array.isArray(value) && value.every((item) => text(item));
  if (decision?.drivers !== undefined && !stringArray(decision.drivers))
    issues.push(`${label}.drivers must be an array of non-empty strings`);
  if (decision?.requirements !== undefined && !stringArray(decision.requirements))
    issues.push(`${label}.requirements must be an array of requirement keys`);
  if (decision?.durable !== undefined && typeof decision.durable !== "boolean")
    issues.push(`${label}.durable must be true or false`);
  for (const field of ["confirmation", "supersedes"])
    if (decision?.[field] !== undefined && typeof decision[field] !== "string")
      issues.push(`${label}.${field} must be a string`);
  if (decision?.options !== undefined) {
    if (!Array.isArray(decision.options)) issues.push(`${label}.options must be an array`);
    else for (const [index, option] of decision.options.entries()) {
      if (typeof option === "string" ? !text(option) : !text(option?.option))
        issues.push(`${label}.options[${index}].option is required`);
      for (const list of ["pros", "cons"])
        if (option && typeof option === "object" && option[list] !== undefined &&
            !(typeof option[list] === "string" || stringArray(option[list])))
          issues.push(`${label}.options[${index}].${list} must be a string or an array of strings`);
    }
  }
  return issues;
}

// An accepted durable decision states its reason under each requirement it
// governs, so the reason survives archive into the living spec.
function applyDecisionRationale(source, requirements, issues) {
  for (const [index, decision] of (Array.isArray(source?.decisions) ? source.decisions : []).entries()) {
    const keys = Array.isArray(decision?.requirements) ? stringList(decision.requirements) : [];
    for (const key of keys)
      if (!requirements.some((row) => row.key === key))
        issues.push(`semantic draft decisions[${index}].requirements references unknown requirement '${key}'`);
    if (decision?.durable !== true || decisionStatus(decision) !== "accepted" || !text(decision?.choice))
      continue;
    const reason = authoredDecisionReason(decision);
    const line = `- **Rationale (${text(decision.id) || text(decision.key)}):** ${text(decision.choice)}` +
      (reason ? ` — ${reason}` : "");
    for (const row of requirements.filter((requirement) => keys.includes(requirement.key)))
      row.spec.rationale = [...(row.spec.rationale || []), line];
  }
}

export const SETTLED_REASON = "No alternative was open; recorded as settled";

// A default the agent chose without asking (stack, storage) is recorded, not
// approved: it is reported with the agreement but never forces design.md.
export function agentDecision(decision) {
  return text(decision?.decidedBy).toLowerCase() === "agent";
}

// The author's stated reason, without the compiler's settled-fact filler.
export function authoredDecisionReason(decision) {
  const reason = text(decision?.reason) || text(decision?.why);
  return reason === SETTLED_REASON ? "" : reason;
}

// A benchmark provider compares head with base over alternating runs; fewer
// than three runs per side gives no usable median. Omitted values take the
// runtime defaults (5 runs, 10% regression).
const BENCHMARK_MIN_RUNS = 3;

function benchmarkProviderIssues(execution) {
  const providers = execution?.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return [];
  const issues = [];
  for (const [name, provider] of Object.entries(providers)) {
    if (text(provider?.adapter) !== "benchmark") continue;
    const label = `semantic draft execution.providers.${name}`;
    if (provider.runs !== undefined &&
        (!Number.isInteger(provider.runs) || provider.runs < BENCHMARK_MIN_RUNS))
      issues.push(`${label}.runs must be at least ${BENCHMARK_MIN_RUNS} (an integer; default 5)`);
    if (provider.maxRegressionPercent !== undefined &&
        (typeof provider.maxRegressionPercent !== "number" ||
          !Number.isFinite(provider.maxRegressionPercent) || provider.maxRegressionPercent < 0))
      issues.push(`${label}.maxRegressionPercent must be a number of at least 0 (default 10)`);
  }
  return issues;
}

function semanticDraftIssues(source, { defaultTestEvidence = false, requireScratch = false, requireUndo = false } = {}) {
  const issues = [];
  if (!isSemanticVersion(source?.version))
    issues.push("semantic draft version must be 3, 4, or 5");
  if (!text(source?.intent)) issues.push("semantic draft requires non-empty 'intent'");
  if (!Array.isArray(source?.requirements) || source.requirements.length === 0)
    issues.push("semantic draft requires a non-empty 'requirements' array");
  if (!Array.isArray(source?.tasks) || source.tasks.length === 0)
    issues.push("semantic draft requires a non-empty 'tasks' array");
  if (!(defaultTestEvidence && source?.evidence === undefined) &&
      (!source?.evidence || typeof source.evidence !== "object" || Array.isArray(source.evidence)))
    issues.push("semantic draft requires an 'evidence' object keyed by requirement key");
  if (source?.integrations !== undefined && !Array.isArray(source.integrations))
    issues.push("semantic draft integrations must be an array");
  if (source?.capabilityOverviews !== undefined && !Array.isArray(source.capabilityOverviews))
    issues.push("semantic draft capabilityOverviews must be an array of { capability, title, overview } or an object keyed by capability");
  if (source?.language !== undefined &&
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(text(source.language)))
    issues.push("semantic draft language must be a BCP 47 tag such as 'en' or 'th'");
  issues.push(...scratchFieldIssues(source));
  // Only a draft being started or revised owes the approval summary; an
  // amendment synthesizes a draft and a started change keeps the one it had.
  if (requireScratch) issues.push(...scratchRequiredIssues(source));
  // The same drafts owe a way to undo a High or Critical change (or a plain "none: why").
  if (requireUndo) issues.push(...undoIssues(source));
  if (source?.successMeasure !== undefined &&
      (typeof source.successMeasure !== "string" || !text(source.successMeasure) ||
        text(source.successMeasure).length > 240 || /\r?\n/.test(text(source.successMeasure))))
    issues.push("semantic draft successMeasure must be one line of at most 240 characters " +
      "(how you will know it worked, with a number or observable); omit it when unknown");
  if (source?.diagrams !== undefined && !Array.isArray(source.diagrams))
    issues.push("semantic draft diagrams must be an array");
  if (source?.decisions !== undefined && !Array.isArray(source.decisions))
    issues.push("semantic draft decisions must be an array");
  if (source?.risks !== undefined && !Array.isArray(source.risks))
    issues.push("semantic draft risks must be an array");
  if (source?.repositories !== undefined && !Array.isArray(source.repositories))
    issues.push("semantic draft repositories must be an array");
  if (source?.externalOperations !== undefined && !Array.isArray(source.externalOperations))
    issues.push("semantic draft externalOperations must be an array");
  if (source?.constraints !== undefined && (!Array.isArray(source.constraints) ||
      source.constraints.some((value) => !text(value))))
    issues.push("semantic draft constraints must be an array of non-empty strings");
  if (source?.fixes !== undefined && (!Array.isArray(source.fixes) ||
      source.fixes.some((value) => !text(value))))
    issues.push("semantic draft fixes must be an array of archived change ids");
  issues.push(...benchmarkProviderIssues(source?.execution));
  if (source?.prototypeSelection !== undefined) {
    if (!text(source.prototypeSelection?.reference))
      issues.push("semantic draft prototypeSelection.reference is required");
    if (!text(source.prototypeSelection?.selected))
      issues.push("semantic draft prototypeSelection.selected is required");
  }
  placeholderIssue(source?.intent, "semantic draft intent", issues);
  for (const [index, decision] of (source?.decisions || []).entries()) {
    if (!text(decision?.key)) issues.push(`semantic draft decisions[${index}].key is required`);
    if (!text(decision?.choice)) issues.push(`semantic draft decisions[${index}].choice is required`);
    if (!text(decision?.reason || decision?.why) && rejectedAlternatives(decision).length)
      issues.push(`semantic draft decisions[${index}].reason is required`);
    if (text(decision?.decidedBy) && !["user", "agent"].includes(text(decision.decidedBy).toLowerCase()))
      issues.push(`semantic draft decisions[${index}].decidedBy must be user|agent`);
    issues.push(...decisionMetadataIssues(decision, `semantic draft decisions[${index}]`));
  }
  const choices = new Map();
  for (const decision of source?.decisions || []) {
    const key = text(decision?.key);
    const choice = text(decision?.choice);
    if (!key) continue;
    if (choices.has(key) && choices.get(key) !== choice)
      issues.push(`semantic draft has contradictory decisions for '${key}'`);
    else if (choices.has(key)) issues.push(`semantic draft decision key '${key}' is duplicated`);
    choices.set(key, choice);
  }
  issues.push(...designBlueprintIssues(source));
  issues.push(...devDocumentShapeIssues(source));
  issues.push(...devDocumentIssues(source, {
    standard: !semanticRapidCandidate(source), lane: riskDerivationSummary(source)
  }));
  issues.push(...semanticIntakeIssues(source));
  return issues;
}

// Docs or chore work has no behavior for a test runner to count: its verify
// command (a grep, a link check) is proven by its exit code, so an omitted
// capability list means "static-analysis", never test discovery.
const STATIC_EVIDENCE_WORK = new Set(["docs", "chore"]);
export function defaultEvidenceCapability(source) {
  const types = inferWorkTypes(source || {});
  return types.length && types.every((type) => STATIC_EVIDENCE_WORK.has(type))
    ? "static-analysis" : "test";
}

function normalizeRequirements(source, slugify, issues, {
  loadCanonicalSpec = null, defaultTestEvidence = false, defaultedEvidence = [],
  reservedClaimIds = []
} = {}) {
  const evidence = evidenceEntries(source.evidence);
  const defaultCapability = defaultTestEvidence ? defaultEvidenceCapability(source) : "test";
  const requirements = [];
  const requirementKeys = new Set();
  const pendingClaims = [];
  let capabilityChoiceReported = false;
  const knownRequirementKeys = new Set((source.requirements || []).map((row) => text(row?.key)));
  for (const evidenceKey of evidence.keys())
    if (!knownRequirementKeys.has(evidenceKey))
      issues.push(`semantic draft evidence references unknown requirement '${evidenceKey}'`);

  for (const [index, requirement] of (source.requirements || []).entries()) {
    const label = `semantic draft requirements[${index}]`;
    const key = text(requirement?.key);
    if (!key) issues.push(`${label}.key is required`);
    else if (requirementKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    requirementKeys.add(key);
    const capability = text(requirement?.capability);
    if (!capability && Array.isArray(source._capabilityChoices)) {
      // One repair for the whole minimal draft, naming the real choices.
      if (!capabilityChoiceReported)
        issues.push("semantic draft 'capability' is required: no existing capability " +
          "matched this draft confidently; set 'capability' on each requirement to one " +
          `of: ${source._capabilityChoices.join(", ")} (or name a new capability)`);
      capabilityChoiceReported = true;
    } else if (!capability) issues.push(`${label}.capability is required`);
    const operation = text(requirement?.operation || "added").toLowerCase();
    if (!OPERATIONS.has(operation))
      issues.push(`${label}.operation must be added|modified|removed`);
    const outcome = text(requirement?.outcome);
    if (!outcome && operation !== "removed") issues.push(`${label}.outcome is required`);
    const scenarios = operation === "modified"
      ? mergeCanonicalScenarios(requirement,
        loadCanonicalSpec ? loadCanonicalSpec(capability) : null, label, issues)
      : semanticScenarios(requirement);
    if (!scenarios.length && operation !== "removed")
      issues.push(`${label}.scenario or .scenarios is required`);
    if (isSemanticV4Plus(source.version)) readableScenarioIssues(requirement, operation, label, issues);
    const statement = requirementStatement(
      requirement, outcome, source.version, operation, label, issues);
    const details = textList(requirement?.details);
    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      for (const field of ["name", "when", "then"])
        if (!scenario[field]) issues.push(`${label}.scenarios[${scenarioIndex}].${field} is required`);
    }
    if (operation === "removed" && !text(requirement?.migration))
      issues.push(`${label}.migration is required for removed requirements`);
    placeholderIssue(key, `${label}.key`, issues);
    placeholderIssue(capability, `${label}.capability`, issues);
    placeholderIssue(outcome, `${label}.outcome`, issues);

    const evidenceValue = evidence.get(key);
    const capabilities = unique([
      ...stringList(evidenceValue?.capabilities),
      ...stringList(requirement?.capabilities)
    ]);
    // A draft proves every requirement with its covering tasks' verify commands,
    // so an omitted capability list means exactly that: "test", or
    // "static-analysis" for docs/chore work. The proposal records the default.
    if (defaultTestEvidence && !capabilities.length &&
        evidenceValue?.capabilities === undefined && requirement?.capabilities === undefined) {
      capabilities.push(defaultCapability);
      defaultedEvidence.push(key);
    } else if (!evidenceValue && !requirement?.capabilities) {
      const derived = riskDerivationSummary(source);
      issues.push(`${label} requires evidence['${key}'].capabilities ` +
        "(a draft with security triggers must name them, e.g. [\"test\", \"security-static\"]; " +
        "without triggers an omitted list defaults to [\"test\"], or [\"static-analysis\"] " +
        "for docs/chore work" + (derived ? `; ${derived}` : "") + ")");
    }
    if (!capabilities.length)
      issues.push(`${label} requires at least one evidence capability`);

    const repositories = unique(stringList(requirement?.repositories));
    if (repositories.length > 1 && !capabilities.includes("cross-repo-contract"))
      capabilities.push("cross-repo-contract");
    const explicitKeys = new Set(rawScenarioEntries(requirement)
      .map((entry) => text(entry?.key)).filter(Boolean));
    const scenarioClaims = scenarios.map((scenario, scenarioIndex) => {
      // A title in a non-Latin script slugifies to nothing; its position keeps
      // the claim id stable instead.
      const rawSuffix = String(scenario.key || "");
      const suffix = /[a-z0-9]/i.test(rawSuffix) ? rawSuffix : String(scenarioIndex + 1);
      const id = slugify(scenarios.length === 1 ? key : `${key}-${suffix}`);
      if (!id) issues.push(`${label} cannot derive a stable claim ID`);
      // Only an explicit scenario key is an author-chosen claim suffix; IDs
      // from requirement keys and titles are slugged and truncated, so the
      // compiler owns their collisions.
      const explicit = scenarios.length > 1 && explicitKeys.has(scenario.key);
      pendingClaims.push({ label, explicit });
      return {
        id,
        requirementKey: key,
        scenario: scenario.name,
        impact: text(evidenceValue?.impact || requirement?.impact || source.impact || "low"),
        capabilities,
        ...(repositories.length ? { repositories } : {})
      };
    });
    requirements.push({
      key,
      claimIds: scenarioClaims.map((claim) => claim.id),
      claims: scenarioClaims,
      spec: {
        name: capability,
        operation,
        requirement: text(requirement?.requirement || requirement?.title) || key,
        description: statement,
        ...(details.length ? { details } : {}),
        scenarios,
        ...(operation === "removed" ? { migration: text(requirement.migration) } : {})
      }
    });
  }
  assignClaimIds(requirements, pendingClaims, reservedClaimIds, issues);
  return { requirements, requirementKeys };
}

// Claim IDs are compiler-owned. Author-chosen IDs (and IDs an active change
// already owns) keep their value; a derived ID that collides, e.g. two long
// scenario titles that share their first 64 slug characters, takes the first
// free numeric suffix in draft order, so recompiling the same draft yields the
// same IDs. Only two author-chosen scenario keys that collide are an error.
function assignClaimIds(requirements, pending, reservedClaimIds, issues) {
  const claims = requirements.flatMap((row) => row.claims);
  const explicit = new Set();
  claims.forEach((claim, index) => {
    if (!claim.id || !pending[index].explicit) return;
    if (explicit.has(claim.id))
      issues.push(`${pending[index].label} derives duplicate claim ID '${claim.id}'`);
    explicit.add(claim.id);
  });
  // Callers own collisions between author-chosen and reserved IDs.
  const taken = new Set([...reservedClaimIds, ...explicit]);
  claims.forEach((claim, index) => {
    if (!claim.id || pending[index].explicit) return;
    let id = claim.id;
    for (let counter = 2; taken.has(id); counter += 1) {
      const suffix = `-${counter}`;
      id = `${claim.id.slice(0, CLAIM_ID_MAX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    }
    claim.id = id;
    taken.add(id);
  });
  for (const row of requirements) row.claimIds = row.claims.map((claim) => claim.id);
}

// ---- Minimal v4 draft -------------------------------------------------------
// A draft without `version` whose shape is unambiguously the minimal v4 form
// (intent + requirements[{description, scenarios[{when, then}]}] +
// tasks[{outcome, verify, paths}]) is expanded here, before intake, into an
// ordinary v4 draft. Explicit drafts (any `version`) are never touched.

const MINIMAL_KEY_MAX = 48;
const MINIMAL_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "these", "those", "from", "into",
  "onto", "when", "then", "shall", "must", "not", "system", "are", "was", "were",
  "its", "their", "any", "all", "each", "every", "one", "has", "have", "can", "will",
  "src", "lib", "app", "test", "tests", "spec", "index", "mjs", "cjs", "js", "ts",
  "tsx", "jsx", "json", "md", "implement", "add", "update", "change", "make", "use"
]);

function shortSlug(value, max = MINIMAL_KEY_MAX) {
  const slug = text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const boundary = cut.lastIndexOf("-");
  return (boundary > max / 2 ? cut.slice(0, boundary) : cut).replace(/-+$/, "");
}

function uniqueKey(base, taken) {
  let key = base;
  for (let counter = 2; taken.has(key); counter += 1) {
    const suffix = `-${counter}`;
    key = `${base.slice(0, MINIMAL_KEY_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
  }
  taken.add(key);
  return key;
}

function significantWords(values) {
  return new Set(values.flatMap((value) =>
    text(value).toLowerCase().split(/[^a-z0-9]+/))
    .filter((word) => word.length >= 3 && !MINIMAL_STOPWORDS.has(word))
    .map((word) => word.replace(/(?:ies|es|s)$/, "")));
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A v5 folder's change.json may use the same minimal shape (the template's:
// no requirement or task keys); it keeps version 5. A keyed v5 draft is a full
// draft and keeps v4's full-draft semantics, such as unmarked decisions. The
// draft recorded from a minimal v5 start carries derived keys and the
// `_minimalDraft` marker, so a merge revision still expands as minimal.
const unkeyed = (rows) => rows.every((row) => !text(row?.key));

export function isMinimalSemanticDraft(source) {
  const minimalVersion = source?.version === undefined ||
    (isFolderDraftVersion(source?.version) && Array.isArray(source.requirements) &&
      Array.isArray(source.tasks) &&
      (source._minimalDraft === true || (unkeyed(source.requirements) && unkeyed(source.tasks))));
  return plainObject(source) && minimalVersion && Boolean(text(source.intent)) &&
    source.claims === undefined && source.specs === undefined &&
    Array.isArray(source.requirements) && source.requirements.length > 0 &&
    source.requirements.every((row) => plainObject(row) &&
      (text(row.description) || Array.isArray(row.scenarios))) &&
    Array.isArray(source.tasks) && source.tasks.length > 0 &&
    source.tasks.every((row) => plainObject(row) && (text(row.outcome) || text(row.verify)));
}

// Derived scenario titles read as headings: whole words, at most
// SCENARIO_NAME_MAX characters, no leading article, and never ending on a
// word that leaves the title hanging ("titled", "to the"). Deterministic, so
// recompiling the same draft yields the same names.
const SCENARIO_NAME_MAX = 60;
const SCENARIO_NAME_LIMIT = 80;
const LEADING_ARTICLE = /^(?:the|a|an)$/i;
const DANGLING_WORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "by", "from", "into",
  "onto", "via", "per", "as", "about", "after", "before", "over", "under", "between",
  "through", "within", "without", "and", "or", "but", "nor", "so", "if", "than", "then",
  "when", "while", "whether", "that", "which", "who", "whose", "titled", "named",
  "called", "labeled", "labelled", "is", "are", "was", "were", "be", "been", "its",
  "their", "his", "her", "my", "our", "your", "this", "these", "those", "not", "no"
]);

function scenarioClause(value) {
  return text(value).replace(/^when\s+/i, "").replace(/[\s.;:,!?]+$/u, "").trim();
}

function quoteOpen(words) {
  const joined = words.join(" ");
  if ((joined.match(/"/g) || []).length % 2) return true;
  if ((joined.match(/\u201c/g) || []).length !== (joined.match(/\u201d/g) || []).length) return true;
  const opened = words.filter((word) => /^['\u2018`]/.test(word)).length;
  const closed = words.filter((word) => /['\u2019`][^\p{L}\p{N}]*$/u.test(word)).length;
  return opened > closed;
}

function bareWord(word) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function wholeWordTitle(value, max = SCENARIO_NAME_MAX) {
  let words = scenarioClause(value).split(/\s+/).filter(Boolean);
  if (words.length > 1 && LEADING_ARTICLE.test(words[0])) words = words.slice(1);
  if (!words.length) return "";
  const kept = [];
  for (const word of words) {
    if ([...kept, word].join(" ").length > max) break;
    kept.push(word);
  }
  // A single token longer than the limit (a script written without spaces)
  // has no word boundary to cut at.
  if (!kept.length) return words[0].slice(0, max).trim();
  if (kept.length < words.length)
    while (kept.length > 1 && quoteOpen(kept)) kept.pop();
  while (kept.length > 1 && DANGLING_WORDS.has(bareWord(kept.at(-1)))) kept.pop();
  const title = kept.join(" ").replace(/[\s,;:\u2013\u2014-]+$/u, "");
  return title.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
}

// A trigger written as code (`sum([1, 2, 3]) is called`) cut at a word
// boundary reads as a broken fragment, so it never becomes a title.
function codeLikeTitle(title) {
  const count = (pattern) => (title.match(pattern) || []).length;
  return /^[^\s]*[([{=<>`]/.test(title) || count(/\(/g) !== count(/\)/g) ||
    count(/\[/g) !== count(/\]/g) || count(/\{/g) !== count(/\}/g);
}

function minimalScenarioName(scenario, index, requirementTitle = "") {
  const when = text(scenario.when);
  const repeatsWhen = (value) => comparableLabel(value) === comparableLabel(when);
  let name = wholeWordTitle(when);
  if (name && codeLikeTitle(name) && requirementTitle) return requirementTitle;
  // A short trigger with no leading article would repeat WHEN; the outcome
  // names the case instead.
  if (!name || repeatsWhen(name)) {
    const outcome = wholeWordTitle(scenario.then);
    if (outcome && !repeatsWhen(outcome)) name = outcome;
  }
  if (!name || repeatsWhen(name)) name = `${name || "Scenario"} (scenario ${index + 1})`;
  return name;
}

// Two derived titles in one requirement that read the same are told apart by
// what differs between the cases (the precondition, then the outcome), and
// only otherwise by a number.
function distinctScenarioName(name, scenario, taken) {
  if (!taken.has(comparableLabel(name))) return name;
  const budget = SCENARIO_NAME_LIMIT - name.length - 3;
  for (const clause of [...textList(scenario.given), text(scenario.then)]) {
    const detail = budget >= 8 ? wholeWordTitle(clause, budget) : "";
    const candidate = detail
      ? `${name} (${detail.replace(/^\p{Lu}(?=\p{Ll})/u, (letter) => letter.toLowerCase())})`
      : "";
    if (candidate && !taken.has(comparableLabel(candidate))) return candidate;
  }
  for (let counter = 2; ; counter += 1) {
    const candidate = `${name} (${counter})`;
    if (!taken.has(comparableLabel(candidate))) return candidate;
  }
}

function minimalScenarioNames(scenarios, requirementTitle = "") {
  const taken = new Set(scenarios.filter((scenario) => plainObject(scenario) && text(scenario.name))
    .map((scenario) => comparableLabel(scenario.name)));
  return scenarios.map((scenario, index) => {
    if (!plainObject(scenario) || text(scenario.name) || !text(scenario.when)) return scenario;
    const name = distinctScenarioName(minimalScenarioName(scenario, index, requirementTitle),
      scenario, taken);
    taken.add(comparableLabel(name));
    return { ...scenario, name };
  });
}

// Derived requirement keys and headings. Keys stay short, whole-word, and
// never end on a dangling word; the heading is the readable form of the same
// clause. Both are deterministic, so recompiling a draft yields the same ones.
const REQUIREMENT_KEY_WORDS = 5;
const REQUIREMENT_KEY_MAX = 40;
const REQUIREMENT_TITLE_MAX = 50;
const KEY_FILLER = new Set([
  "a", "an", "the", "its", "their", "his", "her", "our", "your", "my", "any", "each",
  "every", "whose", "that", "which", "is", "are", "be", "been"
]);
const ACTOR_LEAD = new RegExp("^(?:let|lets|allow|allows|enable|enables|permit|permits)\\s+" +
  "(?:(?:a|an|the|each|every|any)\\s+)?(?:users?|people|customers?|visitors?|admins?|" +
  "administrators?|operators?|members?)\\s+(?:to\\s+)?", "i");

// The behavior clause of a requirement statement: the text after SHALL/MUST,
// up to the first parenthetical, semicolon, colon, or dash aside.
function requirementClause(value) {
  return text(value).replace(/^.*?\b(?:SHALL|MUST)\b\s*/, "")
    .split(/\s*(?:[(;:]|\s[–—-]\s)/u)[0].replace(/[\s.,!?]+$/u, "").trim();
}

function conciseRequirementKey(clause) {
  const words = text(clause).replace(ACTOR_LEAD, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((word) => word && !KEY_FILLER.has(word));
  const kept = [];
  for (const word of words) {
    if (kept.length === REQUIREMENT_KEY_WORDS ||
        [...kept, word].join("-").length > REQUIREMENT_KEY_MAX) break;
    kept.push(word);
  }
  while (kept.length > 1 && DANGLING_WORDS.has(kept.at(-1))) kept.pop();
  if (kept.length === 1 && DANGLING_WORDS.has(kept[0])) return "";
  return kept.join("-") || shortSlug(clause, REQUIREMENT_KEY_MAX);
}

// Changes started before 3.5.30 derived keys this way; a pre-Build revise of
// such a change keeps them so its requirements are not re-identified.
function legacyRequirementKey(row, index) {
  const body = text(row.description).replace(/^.*?\b(?:SHALL|MUST)\b\s*/, "");
  return shortSlug(body) || shortSlug(row.outcome) || `requirement-${index + 1}`;
}

function derivedRequirementTitle(row, taken) {
  const title = wholeWordTitle(requirementClause(row.description) ||
    requirementClause(row.outcome), REQUIREMENT_TITLE_MAX);
  if (!title) return "";
  let candidate = title;
  for (let counter = 2; taken.has(candidate.toLowerCase()); counter += 1)
    candidate = `${title} (${counter})`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

// A capability name is the intent's object noun phrase: the intent is split
// at prepositions, conjunctions, and punctuation; each chunk loses its leading
// subject, modal, verb, and article words and its generic qualifiers; the
// chunk with the most remaining words (first on a tie) supplies its last
// CAPABILITY_WORDS words. "Users can manage tasks on a browser kanban board"
// becomes "kanban-board".
const CAPABILITY_WORDS = 3;
const CAPABILITY_BREAKS = new Set([
  "on", "in", "with", "for", "to", "of", "using", "via", "by", "from", "into", "onto",
  "at", "and", "or", "that", "which", "where", "so", "when", "while", "as", "without",
  "within", "through", "across", "per", "than", "then", "if",
  // A participle after the noun opens a modifier: "a board stored in ...".
  "stored", "saved", "kept", "persisted", "built", "powered", "backed", "hosted",
  "shown", "displayed", "written", "made", "called", "named"
]);
const CAPABILITY_MODALS = new Set([
  "can", "could", "should", "shall", "must", "will", "may", "might", "to"
]);
const CAPABILITY_LEAD = new Set([
  "a", "an", "the", "users", "user", "people", "customers", "customer", "visitors",
  "visitor", "admins", "admin", "administrators", "operators", "members", "developers",
  "we", "i", "you", "they", "it", "system", "can", "could", "should", "shall", "must",
  "will", "may", "might", "be", "able", "is", "are", "let", "lets", "allow", "allows",
  "enable", "enables", "provide", "provides", "add", "adds", "build", "builds", "create",
  "creates", "implement", "implements", "support", "supports", "make", "makes", "manage",
  "manages", "view", "views", "see", "sees", "show", "shows", "display", "displays",
  "edit", "edits", "track", "tracks", "use", "uses", "get", "gets", "give", "gives",
  "introduce", "introduces", "fix", "fixes", "update", "updates", "change", "changes",
  "improve", "improves", "ship", "ships", "set", "sets", "write", "writes", "render",
  "renders", "have", "has", "keep", "keeps", "offer", "offers", "deliver", "delivers",
  "expose", "exposes", "need", "needs", "want", "wants", "reject", "rejects", "validate",
  "validates", "handle", "handles", "persist", "persists", "store", "stores", "save",
  "saves", "delete", "deletes", "remove", "removes", "move", "moves", "organize",
  "organizes", "organise", "organises", "list", "lists", "browse", "browses", "open",
  "opens", "access", "accesses", "run", "runs"
]);
const CAPABILITY_FILLER = new Set([
  "a", "an", "the", "its", "their", "his", "her", "our", "your", "my", "any", "all",
  "each", "every", "some", "own", "new", "simple", "basic", "minimal", "small", "single",
  "browser", "web", "based", "local", "client", "side"
]);

export function capabilityFromIntent(intent) {
  const chunks = [[]];
  const tokens = text(intent).toLowerCase().replace(/[,.;:!?()[\]{}"]+/g, " | ")
    .replace(/[^a-z0-9|]+/g, " ").split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token === "|" || CAPABILITY_BREAKS.has(token)) chunks.push([]);
    else chunks.at(-1).push(token);
  }
  const phrases = chunks.map((chunk) => {
    // The word after a modal is the verb ("users can export reports").
    let start = 0;
    while (start < chunk.length && (CAPABILITY_LEAD.has(chunk[start]) ||
        (start > 0 && CAPABILITY_MODALS.has(chunk[start - 1])))) start += 1;
    return chunk.slice(start).filter((word) => !CAPABILITY_FILLER.has(word));
  });
  const best = phrases.reduce((winner, phrase) =>
    phrase.length > winner.length ? phrase : winner, []);
  return shortSlug(best.slice(-CAPABILITY_WORDS).join("-"), 40);
}

function minimalCapability(source) {
  // Used only when the repository has no canonical capability yet.
  const concise = capabilityFromIntent(source.intent);
  if (concise) return concise;
  const fromIntent = shortSlug(source.intent, 40);
  if (fromIntent) return fromIntent;
  for (const task of source.tasks)
    for (const path of stringList(task?.paths)) {
      const segment = path.split("/").map((part) => shortSlug(part.replace(/\.[^.]*$/, ""), 40))
        .find((part) => part && !MINIMAL_STOPWORDS.has(part));
      if (segment) return segment;
    }
  return "change";
}

// Coverage is inferred only where it is unambiguous: one task covers every
// requirement, or one requirement is covered by every task. Several tasks and
// several requirements need explicit `covers`; word overlap could silently
// assign a requirement to the wrong task.
function inferredCovers(requirements, tasks) {
  if (tasks.length === 1) return [requirements.map((row) => row.key)];
  if (requirements.length === 1) return tasks.map(() => [requirements[0].key]);
  return tasks.map(() => []);
}

function canonicalRequirementMatch(row, rows) {
  const name = text(row.requirement || row.title).toLowerCase();
  const description = text(row.description);
  return rows.find((spec) =>
    (name && spec.name.toLowerCase() === name) ||
    (description && spec.body.includes(description)));
}

const requirementSlug = (value) =>
  text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// A `modified` row that names no requirement: the paid regression-fix runs
// declared keys such as `loyalty-tiers` for "Loyalty tiers" and repaired the
// draft one to three times. Match a restated description, then the key's
// slug, then the capability's only requirement; anything else stays the
// author's to name (the repair lists the choices).
function modifiedRequirementMatch(row, rows) {
  const key = requirementSlug(row.key);
  return canonicalRequirementMatch(row, rows) ||
    (key && rows.find((spec) => requirementSlug(spec.name) === key)) ||
    (rows.length === 1 ? rows[0] : null);
}

function unnamedModifiedRow(row) {
  return text(row.operation).toLowerCase() === "modified" && !text(row.requirement || row.title);
}

// When the repository already has capabilities, a minimal draft belongs to
// one of them. A requirement that restates a canonical requirement decides it;
// otherwise the capability whose name and requirement titles share strictly
// the most significant words with the draft's text and task paths wins, with
// at least one capability-name word or two title words. Anything weaker is
// left to the author rather than inventing a parallel spec.
function existingCapability(source, names, canonicalRows) {
  const open = source.requirements.filter((row) => !text(row.capability));
  const exact = names.map((name) =>
    open.filter((row) => canonicalRequirementMatch(row, canonicalRows(name))).length);
  const bestExact = Math.max(0, ...exact);
  if (bestExact > 0 && exact.filter((count) => count === bestExact).length === 1)
    return names[exact.indexOf(bestExact)];
  const draftWords = significantWords([
    source.intent,
    ...open.flatMap((row) => [row.description, row.requirement, row.title,
      ...rawScenarioEntries(row).flatMap((scenario) => [scenario?.when, scenario?.then])]),
    ...source.tasks.flatMap((task) => [task.outcome, ...stringList(task.paths)])
  ]);
  const scores = names.map((name) => {
    const nameHits = [...significantWords([name])].filter((word) => draftWords.has(word)).length;
    const titleHits = [...significantWords(canonicalRows(name).map((row) => row.name))]
      .filter((word) => draftWords.has(word)).length;
    return nameHits * 2 + titleHits;
  });
  const best = Math.max(0, ...scores);
  return best >= 2 && scores.filter((score) => score === best).length === 1
    ? names[scores.indexOf(best)] : "";
}

// `priorRequirementKeys` and `priorCapabilities` describe the active change a
// pre-Build revise replaces: a requirement or capability that change already
// identified by the pre-3.5.30 derivation keeps that identity.
// The capability a requirement without its own joins: the named one, the
// existing living spec the draft matches, or one derived from the intent.
// No confident match among existing specs records the choices instead.
function draftCapabilityChoice(source, named, {
  loadCanonicalSpec = null, listCanonicalCapabilities = null, priorCapabilities = []
} = {}) {
  const canonical = new Map();
  const canonicalRows = (name) => {
    if (!canonical.has(name))
      canonical.set(name, loadCanonicalSpec ? parseSpecDocument(loadCanonicalSpec(name) || "") : []);
    return canonical.get(name);
  };
  const existing = unique(stringList(listCanonicalCapabilities ? listCanonicalCapabilities() : []));
  const legacyCapability = shortSlug(source.intent, 40);
  let capability = named || (stringList(priorCapabilities).includes(legacyCapability)
    ? legacyCapability : minimalCapability(source));
  let choices = null;
  if (!named && existing.length && source.requirements.some((row) => !text(row.capability))) {
    capability = existingCapability(source, existing, canonicalRows);
    if (!capability) choices = existing;
  }
  return { capability, choices, canonicalRows };
}

// A first scenario's result is a requirement's outcome when it states none.
// A scenario's expected text may quote a literal such as `<the path given>`;
// only the outcome the author wrote is checked for placeholders. A derived one
// skips placeholder-shaped text, else falls back to the requirement clause, so
// the agent is never asked to repair a field it did not write.
function derivedOutcome(row) {
  const thens = rawScenarioEntries(row).map((scenario) => text(scenario?.then)).filter(Boolean);
  return thens.find((then) => !PLACEHOLDER.test(then)) ||
    requirementClause(row.description) || thens[0] || "";
}

// A keyed v5 draft keeps full-draft semantics (its keys, decisions, and
// unmarked rows stay the agent's), yet still receives the capability and
// outcome a minimal draft derives. Without them every keyed v5 draft cost an
// extra repair round for fields the harness can fill.
function keyedFolderDraftDefaults(input, context) {
  if (!plainObject(input) || !isFolderDraftVersion(input.version) ||
      input.claims !== undefined || input.specs !== undefined ||
      !Array.isArray(input.requirements) || !input.requirements.length ||
      !input.requirements.every(plainObject) ||
      !input.requirements.some((row) => !text(row.capability) || unnamedModifiedRow(row) ||
        (!text(row.outcome) && text(row.operation).toLowerCase() !== "removed")))
    return input;
  const source = structuredClone(input);
  const { capability, choices, canonicalRows } =
    draftCapabilityChoice(source, text(source.capability), context);
  if (choices) source._capabilityChoices = choices;
  source.requirements = source.requirements.map((input) => {
    const row = { ...input };
    if (!text(row.capability) && capability) row.capability = capability;
    if (unnamedModifiedRow(row) && text(row.capability)) {
      const match = modifiedRequirementMatch(row, canonicalRows(text(row.capability)));
      if (match) row.requirement = match.name;
    }
    if (!text(row.outcome) && text(row.operation).toLowerCase() !== "removed") {
      const outcome = derivedOutcome(row);
      if (outcome) row.outcome = outcome;
    }
    return row;
  });
  return source;
}

export function expandMinimalSemanticDraft(input, {
  loadCanonicalSpec = null, listCanonicalCapabilities = null,
  priorRequirementKeys = [], priorCapabilities = []
} = {}) {
  if (!isMinimalSemanticDraft(input))
    return keyedFolderDraftDefaults(input,
      { loadCanonicalSpec, listCanonicalCapabilities, priorCapabilities });
  const source = structuredClone(input);
  source.version = isFolderDraftVersion(input.version) ? FOLDER_DRAFT_VERSION : 4;
  source._minimalDraft = true;
  // An optional top-level `capability` names the living spec for every
  // requirement that does not name its own.
  const named = text(source.capability);
  delete source.capability;
  const requirementKeys = new Set(source.requirements.map((row) => text(row.key)).filter(Boolean));
  const priorKeys = new Set(stringList(priorRequirementKeys));
  const { capability, choices, canonicalRows } = draftCapabilityChoice(source, named,
    { loadCanonicalSpec, listCanonicalCapabilities, priorCapabilities });
  if (choices) source._capabilityChoices = choices;
  const titles = new Map();
  const takenTitles = (name) => {
    if (!titles.has(name))
      titles.set(name, new Set([
        ...canonicalRows(name).map((row) => row.name.toLowerCase()),
        ...source.requirements.filter((row) => text(row.capability || capability) === name)
          .map((row) => text(row.requirement || row.title).toLowerCase()).filter(Boolean)
      ]));
    return titles.get(name);
  };
  source.requirements = source.requirements.map((input, index) => {
    const row = { ...input };
    let derivedKey = false;
    if (!text(row.key)) {
      const legacy = legacyRequirementKey(row, index);
      if (priorKeys.has(legacy) && !requirementKeys.has(legacy)) {
        row.key = legacy;
        requirementKeys.add(legacy);
      } else {
        row.key = uniqueKey(conciseRequirementKey(requirementClause(row.description)) ||
          conciseRequirementKey(requirementClause(row.outcome)) ||
          `requirement-${index + 1}`, requirementKeys);
        derivedKey = true;
      }
    }
    if (!text(row.capability) && capability) row.capability = capability;
    if (Array.isArray(row.scenarios))
      row.scenarios = minimalScenarioNames(row.scenarios, text(row.requirement || row.title) ||
        wholeWordTitle(requirementClause(row.description), REQUIREMENT_TITLE_MAX));
    if (!text(row.outcome)) {
      const outcome = derivedOutcome(row);
      if (outcome) row.outcome = outcome;
    }
    if (!text(row.operation) && text(row.capability)) {
      const match = canonicalRequirementMatch(row, canonicalRows(row.capability));
      row.operation = match ? "modified" : "added";
      if (match && !text(row.requirement || row.title)) row.requirement = match.name;
    } else if (unnamedModifiedRow(row) && text(row.capability)) {
      const match = modifiedRequirementMatch(row, canonicalRows(row.capability));
      if (match) row.requirement = match.name;
    }
    // A derived key reads as an identifier; the living spec's heading reads as
    // a title of the same clause.
    if (derivedKey && text(row.capability) && !text(row.requirement || row.title) &&
        text(row.operation || "added").toLowerCase() === "added") {
      const title = derivedRequirementTitle(row, takenTitles(text(row.capability)));
      if (title) row.requirement = title;
    }
    return row;
  });
  const taskKeys = new Set(source.tasks.map((row) => text(row.key)).filter(Boolean));
  source.tasks = source.tasks.map((task, index) => text(task.key) ? task
    : { ...task, key: uniqueKey(shortSlug(task.outcome) || `task-${index + 1}`, taskKeys) });
  // A minimal draft's decisions are the defaults the agent chose without
  // asking; a decision the user made says so with decidedBy: "user".
  if (Array.isArray(source.decisions))
    source.decisions = source.decisions.map((decision) =>
      plainObject(decision) && !text(decision.decidedBy) ? { ...decision, decidedBy: "agent" } : decision);
  const missing = source.tasks.map((task) => task.covers === undefined);
  if (missing.some(Boolean)) {
    const covers = inferredCovers(source.requirements, source.tasks);
    source.tasks = source.tasks.map((task, index) =>
      missing[index] && covers[index].length ? { ...task, covers: covers[index] } : task);
  }
  return source;
}

// ---- Partial revision ---------------------------------------------------------
// `change revise --merge` applies a patch to the draft the change was compiled
// from instead of requiring the whole draft again. Objects merge recursively
// and `null` deletes a key (JSON Merge Patch). An array whose base entries all
// carry an identity field (key, dimension, or name) merges by identity: a patch
// entry names its item by any of those fields every base entry has (the first
// it provides, in that order), merges into the matching entry, `"$remove":
// true` drops it, and any other entry is appended. A `$remove` that matches no
// entry is an error, never a silent no-op. Every other array is replaced.
const MERGE_IDENTITIES = ["key", "dimension", "name"];

function mergeIdentities(base) {
  if (!Array.isArray(base) || !base.length || !base.every(plainObject)) return [];
  return MERGE_IDENTITIES.filter((field) => base.every((row) => text(row[field])));
}

function mergeArray(base, patch) {
  const fields = mergeIdentities(base);
  if (!fields.length || !patch.every(plainObject)) return structuredClone(patch);
  const result = base.map((row) => structuredClone(row));
  for (const entry of patch) {
    const field = fields.find((name) => text(entry[name]));
    const identity = field ? text(entry[field]) : "";
    const index = identity ? result.findIndex((row) => text(row[field]) === identity) : -1;
    if (entry.$remove === true) {
      if (index < 0)
        throw new Error(identity
          ? `"$remove" names ${field} '${identity}', which matches no existing entry`
          : `"$remove" entry names no ${fields.join(" or ")} to identify what it removes`);
      result.splice(index, 1);
      continue;
    }
    const { $remove: _flag, ...value } = entry;
    if (index >= 0) result[index] = mergeValue(result[index], value);
    else result.push(structuredClone(value));
  }
  return result;
}

function mergeValue(base, patch) {
  if (Array.isArray(patch))
    return Array.isArray(base) ? mergeArray(base, patch) : structuredClone(patch);
  if (!plainObject(patch)) return patch;
  const result = plainObject(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergeValue(result[key], value);
  }
  return result;
}

function requirementKeySet(draft) {
  return new Set((Array.isArray(draft?.requirements) ? draft.requirements : [])
    .map((row) => text(row?.key)).filter(Boolean));
}

export function mergeSemanticDraft(base, patch) {
  if (!plainObject(base)) throw new Error("partial revision requires the change's prior draft");
  if (!plainObject(patch)) throw new Error("partial revision patch must be a JSON object");
  const merged = mergeValue(base, patch);
  // A removed requirement takes its evidence entry and task coverage with it;
  // the compiler owns those links. A task left covering nothing is reported.
  const kept = requirementKeySet(merged);
  const removed = [...requirementKeySet(base)].filter((key) => !kept.has(key));
  if (removed.length) {
    if (plainObject(merged.evidence))
      for (const key of removed) delete merged.evidence[key];
    if (Array.isArray(merged.tasks))
      merged.tasks = merged.tasks.map((task) => plainObject(task) && Array.isArray(task.covers)
        ? { ...task, covers: task.covers.filter((key) => !removed.includes(text(key))) }
        : task);
  }
  return merged;
}

// Authors naturally key overviews by capability:
// `{ "<capability>": { title, overview } }` or `{ "<capability>": "overview" }`.
// Normalize that map to the canonical array; any other shape stays as given so
// validation reports it.
export function capabilityOverviewList(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.entries(value).map(([capability, entry]) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? { ...entry, capability: text(entry.capability) || capability }
      : { capability, overview: entry });
}

// A capability overview gives its spec file a human title and a short
// orientation paragraph above the requirement deltas.
function applyCapabilityOverviews(source, requirements, slugify, issues) {
  if (!Array.isArray(source.capabilityOverviews)) return;
  const seen = new Set();
  for (const [index, entry] of source.capabilityOverviews.entries()) {
    const label = `semantic draft capabilityOverviews[${index}]`;
    const capability = slugify(text(entry?.capability));
    const specs = requirements.map((row) => row.spec)
      .filter((spec) => text(entry?.capability) && slugify(spec.name) === capability);
    if (!text(entry?.capability)) issues.push(`${label}.capability is required`);
    else if (!specs.length)
      issues.push(`${label}.capability '${entry.capability}' matches no requirement capability`);
    else if (seen.has(capability))
      issues.push(`${label}.capability '${entry.capability}' is duplicated`);
    seen.add(capability);
    if (!text(entry?.overview)) issues.push(`${label}.overview is required`);
    placeholderIssue(entry?.title, `${label}.title`, issues);
    placeholderIssue(entry?.overview, `${label}.overview`, issues);
    for (const spec of specs) {
      if (text(entry?.title)) spec.title = text(entry.title);
      if (text(entry?.overview)) spec.overview = text(entry.overview);
    }
  }
}

// OpenSpec 1.7 carries a delta's `## Purpose` into a brand-new living spec
// (and ignores it for an existing one), so every capability gets the Purpose
// its delta would state if it is new: the capability overview when one is
// given, else the intent as one sentence, followed by the requirement titles
// when that sentence alone is shorter than OpenSpec's strict minimum.
const PURPOSE_MIN_LENGTH = 50;
const PURPOSE_TITLES = 3;

export function derivedCapabilityPurpose(intent, titles = []) {
  const sentence = text(intent).replace(/\s+/g, " ").replace(/[\s.;:,!?]+$/u, "")
    .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
  const base = sentence ? `${sentence}.` : "";
  if (base.length >= PURPOSE_MIN_LENGTH) return base;
  const list = unique(titles.map(text).filter(Boolean)).slice(0, PURPOSE_TITLES).join("; ");
  return [base, list ? `Requirements: ${list}.` : ""].filter(Boolean).join(" ");
}

function applyCapabilityPurposes(source, requirements, slugify) {
  const groups = new Map();
  for (const { spec } of requirements) {
    const capability = slugify(text(spec.name));
    groups.set(capability, [...(groups.get(capability) || []), spec]);
  }
  for (const specs of groups.values()) {
    const purpose = text(specs.find((spec) => text(spec.overview))?.overview) ||
      derivedCapabilityPurpose(source.intent, specs.map((spec) => spec.requirement));
    for (const spec of specs) if (purpose) spec.purpose = purpose;
  }
}

function applyIntegrationRequirements(source, requirements, requirementKeys, issues) {
  const byKey = new Map(requirements.map((row) => [row.key, row]));
  for (const [index, integration] of (source.integrations || []).entries()) {
    const label = `semantic draft integrations[${index}]`;
    if (!text(integration?.key)) issues.push(`${label}.key is required`);
    if (!text(integration?.kind)) issues.push(`${label}.kind is required`);
    if (!text(integration?.documentation?.source))
      issues.push(`${label}.documentation.source is required`);
    if (!text(integration?.documentation?.version))
      issues.push(`${label}.documentation.version is required`);
    if (!Array.isArray(integration?.concerns) || !stringList(integration.concerns).length)
      issues.push(`${label}.concerns must name the integration risks to cover`);
    const relatesTo = stringList(integration?.relatesTo);
    if (!relatesTo.length) issues.push(`${label}.relatesTo must name at least one requirement`);
    const unknown = relatesTo.filter((key) => !requirementKeys.has(key));
    if (unknown.length) issues.push(`${label}.relatesTo references unknown requirement(s): ${unknown.join(", ")}`);
    const relatedScenarios = relatesTo.flatMap((key) => byKey.get(key)?.spec?.scenarios || []);
    for (const scenarioKind of ["success", "failure"])
      if (!relatedScenarios.some((scenario) => scenario.kind === scenarioKind))
        issues.push(`${label} requires a related scenario with kind '${scenarioKind}'`);
    const capabilities = requiredIntegrationCapabilities(integration);
    for (const key of relatesTo) {
      const requirement = byKey.get(key);
      if (!requirement) continue;
      for (const claim of requirement.claims)
        claim.capabilities = unique([...claim.capabilities, ...capabilities]);
    }
  }
}

// Every key a draft task may carry: what normalizeTasks and its readers use.
// Anything else is ignored, so it is reported (a misspelled `depends` once
// dropped a whole task order without a word).
export const TASK_FIELDS = Object.freeze([
  "key", "id", "title", "outcome", "covers", "claims", "paths", "verify", "dependsOn",
  "kind", "repository", "resources", "requestedModel", "model", "inputSchema",
  "outputSchema", "semanticKey"
]);
const TASK_FIELD_ALIASES = Object.freeze({
  depends: "dependsOn", depends_on: "dependsOn", dependson: "dependsOn", after: "dependsOn",
  path: "paths", test: "verify", check: "verify",
  requirement: "covers", requirements: "covers"
});

function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length];
}

function suggestedTaskField(field) {
  const alias = TASK_FIELD_ALIASES[field] || TASK_FIELD_ALIASES[field.toLowerCase()];
  if (alias) return alias;
  let best = null;
  let bestDistance = Infinity;
  for (const known of TASK_FIELDS) {
    const distance = editDistance(field.toLowerCase(), known.toLowerCase());
    if (distance < bestDistance) [best, bestDistance] = [known, distance];
  }
  // A short key is near everything; cap the distance at half its length.
  return bestDistance <= Math.min(3, Math.floor(field.length / 2)) ? best : null;
}

// Advisory, never blocking: compilation proceeds and ignores the field.
export function unknownTaskFieldWarnings(source) {
  const known = new Set(TASK_FIELDS);
  return (Array.isArray(source?.tasks) ? source.tasks : []).flatMap((task, index) =>
    plainObject(task) ? Object.keys(task).filter((field) => !known.has(field)).map((field) => {
      const suggestion = suggestedTaskField(field);
      return `tasks[${index}].${field} is not a known task field` +
        (suggestion ? `; did you mean ${suggestion}?` : "");
    }) : []);
}

function normalizeTasks(source, requirements, requirementKeys, issues) {
  const claimsByRequirement = new Map(requirements.map((row) => [row.key, row.claimIds]));
  const taskIds = new Map();
  for (const [index, task] of (source.tasks || []).entries()) {
    const key = text(task?.key) || `task-${index + 1}`;
    const id = text(task?.id) || `T${String(index + 1).padStart(3, "0")}`;
    if (taskIds.has(key)) issues.push(`semantic draft tasks[${index}].key '${key}' is duplicated`);
    if ([...taskIds.values()].includes(id)) issues.push(`semantic draft tasks[${index}].id '${id}' is duplicated`);
    taskIds.set(key, id);
    placeholderIssue(key, `semantic draft tasks[${index}].key`, issues);
  }

  const covered = new Set();
  const tasks = (source.tasks || []).map((task, index) => {
    const label = `semantic draft tasks[${index}]`;
    const key = text(task?.key) || `task-${index + 1}`;
    const covers = stringList(task?.covers);
    if (!text(task?.outcome)) issues.push(`${label}.outcome is required`);
    if (!text(task?.verify)) issues.push(`${label}.verify is required`);
    if (!covers.length) issues.push(`${label}.covers must name at least one requirement` +
      (source._minimalDraft ? " (several tasks and requirements: name the requirement keys " +
        `this task implements; keys: ${[...requirementKeys].join(", ")})` : ""));
    const unknown = covers.filter((value) => !requirementKeys.has(value));
    if (unknown.length) issues.push(`${label}.covers references unknown requirement(s): ${unknown.join(", ")}`);
    covers.forEach((value) => covered.add(value));
    const dependencyKeys = stringList(task?.dependsOn);
    const unknownDependencies = dependencyKeys.filter((value) => !taskIds.has(value));
    if (unknownDependencies.length)
      issues.push(`${label}.dependsOn references unknown task(s): ${unknownDependencies.join(", ")}`);
    const dependsOn = dependencyKeys.map((value) => taskIds.get(value)).filter(Boolean);
    placeholderIssue(task?.outcome, `${label}.outcome`, issues);
    placeholderIssue(task?.verify, `${label}.verify`, issues);
    return {
      id: taskIds.get(key),
      semanticKey: key,
      outcome: text(task?.outcome),
      verify: text(task?.verify),
      repository: text(task?.repository) || undefined,
      kind: text(task?.kind) || "implementation",
      paths: stringList(task?.paths),
      dependsOn,
      resources: stringList(task?.resources),
      claims: unique(covers.flatMap((value) => claimsByRequirement.get(value) || [])),
      requestedModel: text(task?.requestedModel || task?.model) || undefined,
      inputSchema: text(task?.inputSchema) || undefined,
      outputSchema: text(task?.outputSchema) || undefined
    };
  });
  const uncovered = [...requirementKeys].filter((key) => !covered.has(key));
  if (uncovered.length)
    issues.push(`semantic draft requirements have no implementation task: ${uncovered.join(", ")}` +
      (source._minimalDraft ? "; name each in one task's 'covers'" : ""));
  const graph = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((graph.get(id) || []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (tasks.some((task) => visit(task.id)))
    issues.push("semantic draft task dependencies contain a cycle");
  return tasks;
}

function repositoryPath(row) {
  return String(row?.relativePath ?? row?.path ?? "").replaceAll("\\", "/")
    .replace(/^\.\//, "").replace(/\/+$/, "") || ".";
}

// Whether `inner` lies strictly inside `outer` (a superproject contains its
// submodules). Sibling repositories (`../x`) are never contained.
function repositoryContains(outer, inner) {
  if (inner === "." || inner === ".." || inner.startsWith("../") || inner === outer) return false;
  return outer === "." || inner.startsWith(`${outer}/`);
}

/**
 * Cross-repository task order the compiler derives so the author need not.
 * A task consumes another selected repository when its own repository
 * contains that repository's path (the root superproject builds and tests its
 * submodules), or, for a task without authored edges, when its repository
 * declares `dependsOn` on it (the edge the runtime already infers, made
 * explicit so an added edge never hides it). The consuming task depends on
 * every same-change task in the consumed repository. An edge that would close
 * a cycle is not added and is reported instead. `repositories` are catalog
 * rows ({id, relativePath, dependsOn}); `selection` is the draft's
 * `repositories`, whose `dependsOn` overrides the catalog's. `consumers`, when
 * given, limits which task ids may receive edges (an amendment's added tasks).
 */
export function deriveRepositoryTaskDependencies(tasks, {
  repositories = [], selection, consumers = null
} = {}) {
  const rows = (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task, dependsOn: [...(task?.dependsOn || [])]
  }));
  const repositoryOf = (task) => text(task.repository) || "root";
  const catalog = new Map((Array.isArray(repositories) ? repositories : [])
    .filter((row) => row?.id).map((row) => [String(row.id), row]));
  const selected = new Map((Array.isArray(selection) ? selection : [])
    .map((entry) => typeof entry === "string" ? { id: entry } : entry)
    .filter((entry) => entry?.id).map((entry) => [String(entry.id), entry]));
  const pathOf = (id) => id === "root" ? "." : catalog.has(id) ? repositoryPath(catalog.get(id)) : null;
  const declaredDependencies = (id) => stringList(
    selected.get(id)?.dependsOn ?? catalog.get(id)?.dependsOn);
  const taskRepositories = unique(rows.map(repositoryOf));
  const label = (task) => task.semanticKey || task.id;
  const graph = new Map(rows.map((task) => [task.id, task.dependsOn]));
  const reaches = (from, to) => {
    const seen = new Set();
    const pending = [from];
    while (pending.length) {
      const current = pending.pop();
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...(graph.get(current) || []));
    }
    return false;
  };
  const derived = [];
  const issues = [];
  for (const task of rows) {
    if (consumers && !consumers.has(task.id)) continue;
    const own = repositoryOf(task);
    const ownPath = pathOf(own);
    const consumed = [
      ...(task.dependsOn.length ? [] : declaredDependencies(own).map((id) =>
        [id, `repository '${own}' dependsOn '${id}'`])),
      ...taskRepositories.filter((id) => id !== own && ownPath !== null && pathOf(id) !== null &&
        repositoryContains(ownPath, pathOf(id)))
        .map((id) => [id, `repository '${own}' contains repository '${id}' at ${pathOf(id)}`])
    ];
    for (const [id, reason] of consumed) {
      for (const provider of rows.filter((candidate) =>
        candidate.id !== task.id && repositoryOf(candidate) === id)) {
        if (task.dependsOn.includes(provider.id)) continue;
        if (reaches(provider.id, task.id)) {
          issues.push(`task '${label(task)}' (repository '${own}') must follow ` +
            `'${label(provider)}' because ${reason}, but '${label(provider)}' already depends ` +
            `on '${label(task)}'; remove that dependency or move the shared work into one repository`);
          continue;
        }
        task.dependsOn.push(provider.id);
        derived.push({ taskId: task.id, dependsOn: provider.id, reason });
      }
    }
  }
  return { tasks: rows, derived, issues: unique(issues) };
}

// The provider command for a list of task verifies, and the verifies as
// `segments` when there are several, so test discrimination can rerun only
// the segment that names a changed test instead of the whole chain.
export function verifyChain(commands) {
  return commands.length === 1
    ? { command: ["sh", "-c", commands[0]] }
    : { command: ["sh", "-c", commands.map((value) => `(${value})`).join(" && ")],
        segments: [...commands] };
}

function derivedExecution(source, claims, tasks) {
  if (source.execution) return source.execution;
  const commands = unique(tasks.map((task) => task.verify).filter(Boolean));
  const { command, segments } = verifyChain(commands);
  const capabilities = unique(claims.flatMap((claim) => claim.capabilities));
  // Build runs each task's verify in its repository's sandbox, so a command
  // derived from those verifies runs there too. Only a single non-root
  // repository is unambiguous; tasks spread across repositories keep the
  // root-workspace provider they had.
  const repositories = unique(tasks.map((task) => text(task.repository) || "root"));
  const repository = repositories.length === 1 && repositories[0] !== "root"
    ? { repository: repositories[0] } : {};
  const providers = {};
  for (const capability of capabilities) {
    if (capability === "discovery") continue;
    if (AUTHORITY_CAPABILITIES.has(capability)) {
      providers[capability] = { adapter: "external", capability, claims: "declared" };
      continue;
    }
    providers[capability] = capability === "test"
      ? {
          adapter: "test-discovery", command, ...(segments ? { segments } : {}), minimum: 1,
          reportFormat: "auto", claims: "declared", ...repository
        }
      : { adapter: "command", capability, command, claims: "declared", ...repository };
  }
  return { version: 1, providers, services: {} };
}

export function normalizeSemanticDraft(input, slugify, options = {}) {
  const source = input?.capabilityOverviews === undefined ? input
    : { ...input, capabilityOverviews: capabilityOverviewList(input.capabilityOverviews) };
  const defaultTestEvidence = Boolean(options.defaultRapidEvidence) &&
    semanticEvidenceDefaultable(source);
  const defaultedEvidence = [];
  const issues = [...semanticDraftIssues(source, { defaultTestEvidence, requireScratch: Boolean(options.requireScratch), requireUndo: Boolean(options.requireUndo) }),
    ...investigationCoverageIssues(source)];
  const { requirements, requirementKeys } = normalizeRequirements(
    source, slugify, issues, { ...options, defaultTestEvidence, defaultedEvidence });
  applyIntegrationRequirements(source, requirements, requirementKeys, issues);
  applyCapabilityOverviews(source, requirements, slugify, issues);
  applyCapabilityPurposes(source, requirements, slugify);
  applyDecisionRationale(source, requirements, issues);
  let tasks = normalizeTasks(source, requirements, requirementKeys, issues);
  // Cross-repository order is derived only when a repository binding exists.
  if (Array.isArray(options.repositories) || Array.isArray(source.repositories)) {
    const ordered = deriveRepositoryTaskDependencies(tasks, {
      repositories: options.repositories, selection: source.repositories
    });
    tasks = ordered.tasks;
    issues.push(...ordered.issues.map((issue) => `semantic draft ${issue}`));
  }
  issues.push(...readerGuideIssues(source, requirementKeys));
  const claims = requirements.flatMap((row) => row.claims);
  const acceptance = source.acceptance || { required: false, reason: null, claimIds: [] };
  const acceptanceRequirements = stringList(acceptance.requirements);
  const acceptanceClaimIds = acceptanceRequirements.flatMap((key) => {
    const row = requirements.find((requirement) => requirement.key === key);
    if (!row) issues.push(`semantic draft acceptance references unknown requirement '${key}'`);
    return row?.claimIds || [];
  });
  const securityTriggers = unique([
    ...stringList(source.securityTriggers),
    ...(source.integrations || []).flatMap((integration) =>
      requiredIntegrationCapabilities(integration).includes("security-static")
        ? ["external-integration-authentication"] : [])
  ]);
  const draft = {
    ...source,
    _semanticVersion: source.version,
    _derivedExecution: !source.execution,
    ...(defaultedEvidence.length ? { _defaultedEvidence: defaultedEvidence } : {}),
    // No stated reason stays empty: repeating the intent under "Why" says
    // nothing the title does not.
    why: text(source.why),
    currentState: text(source.currentState) || "none",
    compatibility: text(source.compatibility) || "none",
    changes: stringList(source.changes).length
      ? stringList(source.changes)
      : unique((source.requirements || []).map(whatChanges).filter(Boolean)),
    nonGoals: stringList(source.nonGoals),
    ...(Array.isArray(source.constraints) ? { constraints: stringList(source.constraints) } : {}),
    ...(Array.isArray(source.fixes) ? { fixes: unique(stringList(source.fixes)) } : {}),
    decisions: Array.isArray(source.decisions)
      ? source.decisions.map((decision) =>
        text(decision?.reason || decision?.why) ? decision : { ...decision, why: SETTLED_REASON })
      : [],
    risks: Array.isArray(source.risks) ? source.risks : [],
    domainLanguage: Array.isArray(source.domainLanguage) ? source.domainLanguage : [],
    impact: text(source.impact) || "low",
    coupling: text(source.coupling) || "isolated",
    securityTriggers,
    acceptance: {
      required: Boolean(acceptance.required),
      reason: acceptance.required ? text(acceptance.reason) : null,
      claimIds: unique([
        ...stringList(acceptance.claimIds),
        ...acceptanceClaimIds
      ])
    },
    tasks,
    claims,
    specs: requirements.map((row) => row.spec),
    _requirementKeys: requirements.map((row) => row.key),
    execution: derivedExecution(source, claims, tasks),
    externalOperations: Array.isArray(source.externalOperations)
      ? source.externalOperations : undefined,
    repositories: Array.isArray(source.repositories) ? source.repositories : undefined
  };
  if (isSemanticV4Plus(source.version)) draft.discovery = normalizeDiscovery(source);
  return { draft, issues, warnings: unknownTaskFieldWarnings(source) };
}

// "What changes" names the behavior a requirement adds, not one example of
// it: an authored outcome, else the requirement heading, else its statement.
// An outcome copied from the first scenario ("it returns 6") is an example.
function whatChanges(row) {
  const outcome = text(row?.outcome);
  const first = rawScenarioEntries(row || {}).find((scenario) =>
    text(scenario?.then) || text(scenario?.outcome));
  if (outcome && outcome !== (text(first?.then) || text(first?.outcome))) return outcome;
  const heading = text(row?.requirement || row?.title);
  if (heading && heading !== text(row?.key)) return heading;
  const statement = text(row?.description).replace(/^.*?\b(?:SHALL|MUST)\b\s*/, "")
    .replace(/[\s.]+$/u, "");
  return statement ? statement.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase()) : outcome;
}

// One renderer for start, revise, and amendments. Structural keywords stay
// English so OpenSpec parses them; everything between them is document prose.
export function renderScenarioMarkdown(scenario) {
  return [
    `#### Scenario: ${scenario.name}`, "",
    ...textList(scenario.given).map((value) => `- **GIVEN** ${value}`),
    `- **WHEN** ${scenario.when}`,
    `- **THEN** ${scenario.then}`,
    ...textList(scenario.and).map((value) => `- **AND** ${value}`)
  ].join("\n");
}

export function renderRequirementMarkdown(spec, scenarios = spec.scenarios || []) {
  const details = textList(spec.details).map((value) => `- ${value}`).join("\n");
  const migration = String(spec.operation || "added").toLowerCase() === "removed"
    ? `\n\n**Migration:** ${spec.migration}` : "";
  const rendered = scenarios.map(renderScenarioMarkdown).join("\n\n");
  const rationale = textList(spec.rationale).join("\n");
  return `### Requirement: ${spec.requirement}\n\n${spec.description}` +
    (rationale ? `\n\n${rationale}` : "") + (details ? `\n\n${details}` : "") + migration + (rendered ? `\n\n${rendered}` : "");
}

// A delta for a capability with no living spec yet states its Purpose, which
// OpenSpec archive writes into the new spec (the overview is that Purpose).
export function renderSpecHeading(spec, { newCapability = false } = {}) {
  const title = text(spec?.title) || text(spec?.name);
  if (newCapability && text(spec?.purpose))
    return `# ${title}\n\n## Purpose\n\n${text(spec.purpose)}`;
  return `# ${title}` + (text(spec?.overview) ? `\n\n${text(spec.overview)}` : "");
}

// The smallest draft the compiler accepts: omit `version` and it infers keys,
// capability, operation, scenario names, covers, and rapid defaults. Optional
// `decisions[{key, choice, reason?}]` records defaults the agent chose
// without asking; the template leaves it out so it is never copied verbatim.
export function minimalSemanticDraftTemplate() {
  return {
    intent: "Describe one observable outcome",
    requirements: [{
      description: "The system SHALL provide the observable behavior",
      scenarios: [{ when: "One triggering input or event", then: "One observable result" }]
    }],
    tasks: [{
      outcome: "Implement and verify the bounded outcome",
      verify: "npm test",
      paths: ["src/**"]
    }]
  };
}

// The minimal v5 folder the template leads with: typed fields with a declared
// work type in change.json, and the reason as proposal.md prose. The v4
// minimal JSON above stays valid for existing drafts.
export function minimalDraftFolderTemplate() {
  const { intent, requirements, tasks } = minimalSemanticDraftTemplate();
  return {
    "change.json": { version: 5, language: "en", intent, workType: ["feature"], requirements, tasks },
    "proposal.md": "## Why\n\nSay in 1-3 plain sentences what changes, who benefits, and why.\n"
  };
}

export function semanticDraftTemplate() {
  return {
    version: 4,
    intent: "Describe one observable outcome",
    why: "Say in 1-3 plain sentences what changes, who benefits, and why",
    userStories: [{
      priority: "P1", asA: "a named user", iWant: "the observable outcome",
      soThat: "the benefit", covers: ["observable-outcome"]
    }],
    successCriteria: ["State how the result is judged, with a measurable threshold"],
    successMeasure: "Optional one line: the number or observable that shows it worked",
    // The first four lines are required at medium or high; undo and who are optional.
    scratch: {
      get: "Required for impact medium or high: what the approver gets, in one plain line",
      asIs: "Required for impact medium or high: how it works today, with a count when known",
      toBe: "Required for impact medium or high: how it works after the change",
      ifFail: "Required for impact medium or high: what the user sees when it fails and how it recovers",
      undo: "Optional: how to undo this change if it is approved and turns out wrong",
      who: "Optional: who is affected, in plain words"
    },
    examples: [{
      type: "examples", title: "Optional: concrete examples with real values",
      rules: [{ rule: "One rule in plain words", rows: [
        { name: "Main case", kind: "success", when: "One real input", then: "The exact result" }] }]
    }],
    impact: "low",
    coupling: "isolated",
    workType: ["feature"],
    userFlow: {
      purpose: "The user's path through the change, including the error path",
      // Quote a label that holds ( ) or ", e.g. A["mean(values)"].
      source: "flowchart LR\n  A[\"User acts\"] --> B{\"Valid?\"}\n  B -->|yes| C[\"Result shown\"]\n" +
        "  B -->|no| D[\"Error shown\"]"
    },
    requirements: [{
      key: "observable-outcome",
      capability: "change",
      operation: "added",
      description: "The system SHALL provide the observable behavior",
      outcome: "Describe the observable result",
      scenarios: [{
        name: "Short scenario title",
        kind: "success",
        given: "The precondition or state before the trigger",
        when: "One triggering input or event",
        then: "One observable result",
        and: ["Another result of the same case, if any"]
      }, {
        name: "One way it fails",
        kind: "failure",
        when: "The failing input or event",
        then: "What the user sees",
        recovery: "How the user or system recovers"
      }]
    }],
    tasks: [{
      key: "implement-outcome",
      outcome: "Implement and verify the bounded outcome",
      covers: ["observable-outcome"],
      paths: ["src/**"],
      verify: "npm test"
    }],
    evidence: {
      "observable-outcome": { capabilities: ["test"] }
    },
    discovery: {
      // Rows only for what the draft cannot state: affected actor, desired,
      // success, failure, and verification coverage derive from userStories,
      // requirements, scenario kinds, and tasks with evidence.
      coverage: [
        { dimension: "current-behavior", status: "needs-investigation" },
        { dimension: "input-boundary", status: "needs-user-decision" },
        { dimension: "compatibility", status: "needs-investigation" },
        { dimension: "non-goals", status: "needs-user-decision" }
      ],
      decisions: []
    },
    // Shapes only: copy the block for the work type you have into the draft
    // top level. The compiler ignores this key, and the rows hold no
    // placeholder text, so a copied row compiles once its facts are true.
    workTypeExamples: workTypeExamples(),
    draftFolderV5: draftFolderV5()
  };
}

// Writing limits for a reader-sized draft; `change start --template` shows
// them beside the minimal draft so the first draft needs no length repair.
export const MINIMAL_DRAFT_WRITING = Object.freeze({
  intent: "One line of at most 70 characters naming the observable outcome",
  why: "At most 3 plain sentences: what changes, who benefits, and why now",
  decisions: "One decision per entry: one choice and its reason, never a list of choices",
  scope: "Scope items (changes, nonGoals) are short phrases, not paragraphs",
  language: "Write in the user's language; keep field names, keys, and SHALL/WHEN/THEN in English",
  sections: "Fill only the sections your work type needs (workTypeExamples); leave the rest out",
  scratch: "Required when impact is medium or high, optional for low: scratch.get, asIs, toBe, ifFail are one plain line each " +
    "(at most 240 characters) for an approver who does not read code; put counts in asIs when known; " +
    "scratch.undo and scratch.who are optional lines for how to undo it and who is affected",
  scenarios: "Write one scenario per rule, limit, endpoint, or error that the request or its referenced documents state, " +
    "not one per heading; add each rule's failure and boundary cases (empty, minimum, maximum, wrong type, unauthorized). " +
    "Every scenario becomes a test, so a thin spec yields thin tests",
  examples: "Optional typed examples with real values from the request, code, or data, never invented: " +
    `each { type, title, why?, postBuild?, capability? } where type is one of ${EXAMPLE_TYPES.join(", ")}`,
  limits: Object.freeze({ intentMaxCharacters: 70, whyMaxSentences: 3 })
});

const USER_FLOW_EXAMPLE = Object.freeze({
  purpose: "The user's path through the change, including the error path",
  source: "flowchart LR\n  A[\"User searches\"] --> B{\"Results?\"}\n  B -->|yes| C[\"List shown\"]\n" +
    "  B -->|no| D[\"Empty state shown\"]"
});

// One block per work type with exactly the sections that type requires
// (and releaseNote when users or consumers see the change). Bugfix variants
// add the detail their kind of fix owes.
function workTypeExamples() {
  const userFlow = () => structuredClone(USER_FLOW_EXAMPLE);
  return {
    use: "Copy the block for each of your work types to the draft top level; every key " +
      "in a block is required for that type and nothing else is",
    feature: { userFlow: userFlow(), releaseNote: "Search now filters by tag." },
    bugfix: {
      bugfix: {
        reproduction: "Open a board with 0 cards; the page crashes",
        rootCause: "The empty list is read as undefined",
        regression: "A test renders an empty board"
      }
    },
    "bugfix-security": {
      bugfix: {
        variant: "security",
        reproduction: "Request another user's invoice by id; it is returned",
        rootCause: "The handler skips the owner check",
        regression: "A test requests a foreign invoice and gets 404",
        disclosure: {
          class: "IDOR", affectedVersions: "<2.4.1", exploitability: "Signed-in user only",
          owner: "security", embargo: "Until 2.4.1 ships", advisory: "GHSA pending",
          backports: ["release/2.3"]
        }
      }
    },
    "bugfix-hotfix": {
      bugfix: {
        variant: "hotfix",
        reproduction: "Checkout returns 500 for carts over 50 items",
        rootCause: "The price batch exceeds the gateway limit",
        regression: "A test checks out a 60-item cart",
        incident: { link: "INC-212", mitigation: "Flag off", minimumScope: "Batch price calls",
          followUp: "Full fix change" },
        backport: ["release/2.3", "release/2.4"]
      }
    },
    refactor: {
      refactor: {
        invariants: ["Every public export keeps its signature and result"],
        characterization: "Snapshot tests of the current outputs pass before and after"
      },
      componentMap: [{ component: "Parser", responsibility: "Turns text into an AST",
        files: ["src/parser.ts"] }]
    },
    api: {
      apiContracts: [{
        method: "POST", path: "/api/cards", auth: "Signed-in user",
        request: { title: "string" }, response: { id: "string", title: "string" },
        errors: [{ status: 400, when: "Title is empty" }]
      }],
      boundaries: [{
        from: "api", to: "billing", mode: "sync", why: "Price at checkout", timeout: "2s",
        retry: "none", consistency: "strong", owner: "payments"
      }],
      releaseNote: "POST /api/cards creates a card."
    },
    library: {
      libraryContract: {
        exports: [{ symbol: "parse", signature: "parse(text: string): Ast" }],
        semver: "minor", changelog: "Adds parse"
      },
      releaseNote: "The library exports parse()."
    },
    ui: {
      userFlow: userFlow(),
      uiStates: [{
        screen: "Board",
        states: [{ state: "loading", shows: "Skeleton cards" },
          { state: "empty", shows: "Add your first card" },
          { state: "error", shows: "Could not load cards, with Retry" },
          { state: "success", shows: "Cards by column" }],
        accessibility: "Columns are lists; cards are reachable by keyboard"
      }],
      componentMap: [{
        component: "Board", responsibility: "Lays out columns and cards",
        files: ["src/components/Board.tsx"]
      }],
      releaseNote: "The board shows cards by column."
    },
    data: {
      dataModel: [{ entity: "Card", fields: ["id", "title", "createdAt"],
        migration: "Add table cards", rollback: "Drop table cards" }]
    },
    migration: {
      migrationPlan: {
        from: "v1 jobs", to: "queue service", seam: "JobPort",
        parity: { check: "Same results", tolerance: "0" },
        cutover: "7 days parity", rollbackWindow: "14 days", decommission: "T009"
      },
      rollout: {
        strategy: "Flag queue-jobs at 10%, then 100%", rollback: "Turn the flag off",
        deployOrder: ["queue", "api"], rollbackProof: "Flag-off test runs the v1 path"
      }
    },
    async: {
      jobContract: [{ key: "sync-invoices", states: ["queued", "done", "failed"],
        retry: "3x backoff", timeout: "30s", idempotency: "Invoice id" }],
      diagrams: [{ key: "sync-flow", type: "mermaid", purpose: "Job states with the failure path",
        source: "stateDiagram-v2\n  [*] --> queued\n  queued --> done\n  queued --> failed\n" +
          "  failed --> queued: retry" }]
    },
    integration: {
      // relatesTo names your requirement; it needs a success and a failure scenario.
      integrations: [{
        key: "stripe-charges", kind: "external-api",
        documentation: { source: "https://docs.stripe.com/api", version: "2024-06-20" },
        concerns: ["authentication", "timeout", "retry", "idempotency"],
        relatesTo: ["observable-outcome"]
      }]
    },
    config: {
      configContract: [{ key: "CARD_LIMIT", default: "100", validation: "Integer from 1 to 1000" }]
    },
    performance: {
      nfr: [{ key: "search-latency", characteristic: "time behaviour", stimulus: "100 rps search",
        response: "Results returned", measure: "p95 < 200ms" }],
      performanceAnalysis: {
        baseline: { value: "p95 480ms", method: "k6 5 runs" }, hypothesis: "N+1 query",
        target: "p95 < 200ms"
      }
    },
    dependency: {
      dependencyChange: [{
        package: "express", from: "4.19.2", to: "4.21.0", breaking: "None in changelog",
        cves: "Fixes CVE-2024-43796", rollbackPin: "4.19.2",
        provenance: "npm provenance attested", sbom: "sbom.cdx.json regenerated"
      }]
    },
    deprecation: {
      deprecationPlan: {
        what: "GET /v1/items", replacement: "GET /v2/items", warning: "Deprecation header",
        removalCondition: "Usage zero for 30 days"
      },
      releaseNote: "GET /v1/items is deprecated; use GET /v2/items."
    },
    infra: {
      infraPlan: {
        planDiff: "+1 aws_sqs_queue", environments: ["staging", "prod"], costDelta: "+$4/month",
        blastRadius: "Jobs only"
      },
      rollout: {
        strategy: "Apply staging, then prod", rollback: "Apply the previous plan",
        deployOrder: ["staging", "prod"], rollbackProof: "Previous plan re-applied in staging"
      }
    },
    observability: {
      observability: {
        rows: [{ failure: "Queue backlog", signal: "queue_depth", sli: "age < 60s", slo: "99%",
          alert: "age > 300s for 10m", runbook: "docs/runbooks/queue.md", owner: "platform" }]
      }
    },
    privacy: {
      privacyAssessment: {
        data: [{ field: "email", class: "personal" }], purpose: "Login",
        retention: "Account life + 30 days"
      },
      threatModel: {
        assets: ["User emails"], trustBoundaries: ["Browser to API"],
        threats: [{ key: "t1", stride: "information disclosure",
          threat: "Export leaks another tenant", likelihood: "low", impact: "high",
          control: "Tenant filter", residual: "low" }]
      }
    },
    experiment: {
      experimentDesign: {
        hypothesis: "One-step checkout lifts conversion", primaryMetric: "Checkout conversion",
        allocation: "50/50 by user", decisionRule: "Ship if +1% at 95%",
        guardrails: ["Error rate"], stopRules: ["Stop if errors double"]
      },
      rollout: {
        strategy: "Experiment flag at 50%", rollback: "Stop the experiment; control stays live",
        rollbackProof: "Flag-off test runs the control path"
      }
    },
    "client-release": {
      releasePlan: {
        minimumVersion: "5.2", stagedRollout: ["1%", "10%", "100%"],
        crashGate: "crash-free >= 99.5%"
      },
      releaseNote: "Version 5.3 adds offline drafts."
    },
    ml: {
      modelCard: {
        intendedUse: "Summarize tickets", model: { provider: "anthropic", version: "pinned id" },
        fallback: "Show the raw ticket",
        evaluation: { set: "200 labelled tickets", thresholds: [{ metric: "accuracy", threshold: ">= 0.9" }] }
      }
    },
    "data-fix": {
      dataFix: {
        scope: "1,204 rows in refunds", snapshot: "Table copy refunds_bak",
        dryRun: "Count and diff on staging", rerunSafe: "Yes, keyed by id",
        rollback: "Restore from refunds_bak"
      }
    },
    security: {
      threatModel: {
        assets: ["User sessions"], trustBoundaries: ["Browser to API"],
        threats: [{ key: "t1", stride: "spoofing", threat: "Stolen token reused", likelihood: "medium",
          impact: "high", control: "8 hour expiry", residual: "low" }]
      },
      hardening: {
        weakness: "Sessions never expire", control: "8 hour expiry",
        verification: "Test with an expired token"
      }
    },
    cicd: {
      pipelinePlan: {
        changes: "Add a deploy job", permissions: "id-token write, no secrets",
        blastRadius: "Staging deploys only", rollback: "Revert the workflow file"
      }
    }
  };
}

// The v5 draft layout: typed fields in change.json, prose under outline
// headings in proposal.md and design.md. The harness writes derived sections.
function draftFolderV5() {
  return {
    layout: "A folder .foundation/drafts/<id>/ with change.json (typed fields, version 5), " +
      "proposal.md, and design.md; start it with claude-foundation change start " +
      ".foundation/drafts/<id>",
    headings: "Use only '## ' headings from the outline, in outline order, in English or Thai. " +
      "Never write a heading the harness derives (Change, Capabilities, Acceptance traceability, " +
      "Definition of done, Work type, File map, Test map); no TODO, TBD, or empty section",
    proposalHeadings: outlineAuthorHeadings("proposal"),
    designHeadings: outlineAuthorHeadings("design"),
    example: {
      "change.json": {
        version: 5, language: "en", intent: "Filter search results by tag",
        requirements: [{
          description: "The system SHALL return only results with the chosen tag",
          scenarios: [{ when: "A user filters by tag 'red'", then: "Only red results are listed" }]
        }],
        tasks: [{ outcome: "Filter search by tag", verify: "npm test", paths: ["src/search/**"] }]
      },
      "proposal.md": "## Why\n\nUsers with many results cannot find tagged items.\n\n" +
        "## Scope\n\n- Tag filter on search\n",
      "design.md": "## Current state\n\nSearch matches titles only.\n\n" +
        "## Decisions\n\n- Filter in the query, not in the client.\n"
    }
  };
}

function outlineAuthorHeadings(document) {
  return OUTLINE[document].filter((row) => row.owner === "author")
    .map((row) => `${row.heading.en} | ${row.heading.th}`);
}
