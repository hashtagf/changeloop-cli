import { lifecycleOutcome } from "../../core/lifecycle-outcome.mjs";
import { deriveDiscoveryCoverage, isDerivedCoverage } from "./derived-coverage.mjs";
import { isSemanticV4Plus } from "./draft-version.mjs";

const STATUSES = new Set([
  "covered", "not-applicable", "needs-investigation", "needs-user-decision"
]);

// Agents repairing a JSON draft reach for python, `sed -i`, or a heredoc to
// apply every fix in one batch, and the host refuses each of those shapes. The
// file tool is pre-allowed on `.foundation/drafts/**`, so the repair names it.
export const DRAFT_REPAIR_INSTRUCTION = "Apply every fix with the Edit tool on the draft " +
  "file (.foundation/drafts/** is pre-allowed), then rerun the same command. Do not " +
  "rewrite the draft through the shell (python, node -e, sed -i, jq, heredoc): the host " +
  "refuses those.";

export const CORE_DISCOVERY_DIMENSIONS = Object.freeze([
  "current-behavior",
  "affected-actor",
  "desired-behavior",
  "success-path",
  "failure-path",
  "input-boundary",
  "compatibility",
  "non-goals",
  "verification"
]);

export const CONDITIONAL_DISCOVERY_DIMENSIONS = Object.freeze([
  "security-privacy",
  "permission-rejection",
  "data-migration",
  "rollout-rollback",
  "recoverability",
  "integration-contract",
  "timeout-retry-idempotency",
  "operability",
  "performance-capacity-availability",
  "accessibility",
  "external-authority"
]);

const KNOWN_DIMENSIONS = new Set([
  ...CORE_DISCOVERY_DIMENSIONS, ...CONDITIONAL_DISCOVERY_DIMENSIONS
]);

const RISK_SIGNAL_DIMENSIONS = Object.freeze({
  "access-control": ["security-privacy", "permission-rejection"],
  "persisted-data-change": ["data-migration", "rollout-rollback", "recoverability"],
  "external-integration": [
    "integration-contract", "timeout-retry-idempotency", "operability", "recoverability"
  ],
  "performance-slo": ["performance-capacity-availability"],
  "user-interface": ["accessibility"],
  "high-operational-risk": ["operability", "recoverability"],
  "external-side-effect": ["external-authority"],
  // Money movement: a retried or partly applied charge must not duplicate or
  // strand funds, so the agreement names retry/idempotency and recovery.
  "financial": ["timeout-retry-idempotency", "recoverability"],
  // Behavior computed from caller-supplied values: the agreement must name the
  // adjacent partitions (type/representation, zero, negative, fractional,
  // empty, limits), not only the reported reproduction.
  "input-domain": ["input-boundary"]
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function unique(values) {
  return [...new Set(values)];
}

const unresolvedIssue = (issue) =>
  issue.includes(" remains unresolved with status '") ||
  issue.startsWith("semantic draft discovery has unresolved decisions;");

// Required coverage comes only from typed, declared signals. Free-text keyword
// matching misfired on ordinary words ("author", "uid") and on every modified
// requirement, forcing ceremony onto small changes. The nine core dimensions
// are mandatory only for declared high impact; elsewhere the requirements and
// scenarios themselves carry that coverage.
// The dimensions a declared `fixes` entry requires.
export const FIXES_DIMENSIONS = Object.freeze(["input-boundary"]);

// The coverage dimensions each typed risk signal requires, for the start
// template, so the guidance an agent copies cannot drift from this check.
export function riskSignalDimensions() {
  return RISK_SIGNAL_DIMENSIONS;
}

export function requiredDiscoveryDimensions(source = {}) {
  const highImpact = text(source.impact).toLowerCase() === "high";
  const required = highImpact ? [...CORE_DISCOVERY_DIMENSIONS] : [];
  const add = (...dimensions) => required.push(...dimensions);
  for (const signal of strings(source.riskSignals))
    add(...(RISK_SIGNAL_DIMENSIONS[signal.toLowerCase()] || []));
  // A regression fix names the boundaries next to the reported one; without
  // this, a fix that declares no input risk covers only the reproduction.
  if (strings(source.fixes).length) add(...FIXES_DIMENSIONS);

  if ((source.securityTriggers || []).length)
    add("security-privacy", "permission-rejection");
  if ((source.integrations || []).length)
    add("integration-contract", "timeout-retry-idempotency", "operability", "recoverability");
  if (highImpact) add("operability", "recoverability");
  if ((source.externalOperations || []).length) add("external-authority");

  return unique(required);
}

// Without an explicit status, only a recorded choice settles a decision. A
// row without a choice (even a bare question) is open, so it reaches the user
// frontier or names what an open decision still lacks; it never passes as
// settled with nothing decided.
export function decisionStatus(row) {
  const status = text(row?.status).toLowerCase();
  if (status) return status;
  return text(row?.choice) ? "resolved" : "open";
}

export function decisionFrontier(decisions = [], limit = 3) {
  const resolved = new Set(decisions
    .filter((row) => decisionStatus(row) === "resolved")
    .map((row) => text(row?.key)));
  return decisions.filter((row) => {
    if (decisionStatus(row) === "resolved") return false;
    return strings(row?.prerequisites).every((key) => resolved.has(key));
  }).slice(0, Math.max(1, Number(limit) || 3));
}

function decisionIssues(decisions = []) {
  const issues = [];
  const keys = new Set();
  for (const [index, decision] of decisions.entries()) {
    const label = `semantic draft discovery.decisions[${index}]`;
    const key = text(decision?.key);
    const status = decisionStatus(decision);
    const alternatives = strings(decision?.alternatives).length;
    if (!key) issues.push(`${label}.key is required`);
    else if (keys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    keys.add(key);
    if (!['open', 'resolved'].includes(status))
      issues.push(`${label}.status must be open|resolved`);
    if (decision?.prerequisites !== undefined && !Array.isArray(decision.prerequisites))
      issues.push(`${label}.prerequisites must be an array`);
    if (status === "open") {
      // An implicit open row may just be a settled fact missing its choice.
      const hint = text(decision?.status) ? ""
        : " (no 'choice' recorded, so it is open; add 'choice' if it is settled)";
      if (alternatives < 2)
        issues.push(`${label}.alternatives must name at least two choices${hint}`);
      if (!text(decision?.recommended)) issues.push(`${label}.recommended is required${hint}`);
      if (!text(decision?.question)) issues.push(`${label}.question is required${hint}`);
    }
    // A settled decision needs only its key and choice; a choice among real
    // alternatives also owes its reason.
    if (status === "resolved") {
      if (!text(decision?.choice)) issues.push(`${label}.choice is required`);
      if (alternatives >= 2 && !text(decision?.reason))
        issues.push(`${label}.reason is required`);
    }
    if (text(decision?.decidedBy) && !["user", "agent"].includes(text(decision.decidedBy).toLowerCase()))
      issues.push(`${label}.decidedBy must be user|agent`);
  }
  for (const [index, decision] of decisions.entries())
    for (const prerequisite of strings(decision?.prerequisites))
      if (!keys.has(prerequisite))
        issues.push(`semantic draft discovery.decisions[${index}].prerequisites references unknown decision '${prerequisite}'`);

  const graph = new Map(decisions.map((row) => [text(row?.key), strings(row?.prerequisites)]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) return true;
    if (visited.has(key) || !graph.has(key)) return false;
    visiting.add(key);
    if ((graph.get(key) || []).some(visit)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  if ([...graph.keys()].some(visit))
    issues.push("semantic draft discovery decision prerequisites contain a cycle");
  return issues;
}

// A coverage row waiting on user decisions is settled the moment every
// decision it links is resolved: the harness projects it to `covered`, sourced
// from those decisions, instead of handing the agent another draft edit.
export function projectResolvedDecisions(source = {}) {
  const discovery = source?.discovery;
  if (!isSemanticV4Plus(source?.version) || !discovery || !Array.isArray(discovery.coverage) ||
      !Array.isArray(discovery.decisions)) return source;
  const resolved = new Set(discovery.decisions
    .filter((row) => decisionStatus(row) === "resolved").map((row) => text(row?.key)));
  let changed = false;
  const coverage = discovery.coverage.map((row) => {
    const links = strings(row?.decisionKeys);
    if (text(row?.status).toLowerCase() !== "needs-user-decision" || !links.length ||
        !links.every((key) => resolved.has(key))) return row;
    changed = true;
    return { ...row, status: "covered",
      sources: unique([...strings(row?.sources), ...links.map((key) => `decision:${key}`)]) };
  });
  return changed ? { ...source, discovery: { ...discovery, coverage } } : source;
}

// The coverage the harness evaluates: authored rows, rows settled by resolved
// decisions, and required rows the draft content already covers.
export function projectDiscovery(input = {}) {
  const source = projectResolvedDecisions(input);
  return deriveDiscoveryCoverage(source, requiredDiscoveryDimensions(source));
}

const ACCESS_VALUES = ["allow", "deny"];

function scenarioEntries(requirement) {
  const list = Array.isArray(requirement?.scenarios) ? requirement.scenarios
    : requirement?.scenario !== undefined ? [requirement.scenario] : [];
  return list.map((row, index) => [index, row]).filter(([, row]) => row && typeof row === "object");
}

// An access-control change states both sides of its boundary as typed
// scenario tags: who is let through (allow) and who is refused (deny). Only
// the `access` field decides; scenario prose is never read for it.
function accessIssues(source) {
  const issues = [];
  const seen = new Set();
  for (const [index, requirement] of (Array.isArray(source.requirements)
    ? source.requirements : []).entries()) {
    for (const [scenarioIndex, scenario] of scenarioEntries(requirement)) {
      if (scenario.access === undefined) continue;
      const access = text(scenario.access).toLowerCase();
      if (ACCESS_VALUES.includes(access)) seen.add(access);
      else issues.push(`semantic draft requirements[${index}].scenarios[${scenarioIndex}].access must be allow or deny`);
    }
  }
  if (strings(source.riskSignals).some((signal) => signal.toLowerCase() === "access-control"))
    for (const access of ACCESS_VALUES)
      if (!seen.has(access))
        issues.push(`semantic draft riskSignals access-control requires at least one scenario with access '${access}'`);
  return issues;
}

export function semanticIntakeIssues(input = {}) {
  if (!isSemanticV4Plus(input.version)) return [];
  const source = projectDiscovery(input);
  const issues = [];
  // Omitted discovery or coverage is an empty record; required dimensions
  // below still name what a declared-risk change must cover.
  const discovery = source.discovery === undefined ? {} : source.discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery))
    return ["semantic draft discovery must be an object"];
  const coverage = discovery.coverage === undefined ? [] : discovery.coverage;
  if (!Array.isArray(coverage))
    return ["semantic draft discovery.coverage must be an array"];
  if (discovery.decisions !== undefined && !Array.isArray(discovery.decisions))
    issues.push("semantic draft discovery.decisions must be an array");
  if (source.riskSignals !== undefined && !Array.isArray(source.riskSignals))
    issues.push("semantic draft riskSignals must be an array");
  const unknownSignals = strings(source.riskSignals)
    .filter((signal) => !RISK_SIGNAL_DIMENSIONS[signal.toLowerCase()]);
  if (unknownSignals.length)
    issues.push(`semantic draft riskSignals contains unknown signal(s): ${unknownSignals.join(", ")} (known: ${Object.keys(RISK_SIGNAL_DIMENSIONS).join(", ")})`);
  issues.push(...accessIssues(source));

  const requirementKeys = new Set((source.requirements || []).map((row) => text(row?.key)));
  const requiredDimensions = requiredDiscoveryDimensions(source);
  const rows = new Map();
  for (const [index, row] of coverage.entries()) {
    const label = `semantic draft discovery.coverage[${index}]`;
    const dimension = text(row?.dimension).toLowerCase();
    const status = text(row?.status).toLowerCase();
    if (!dimension) issues.push(`${label}.dimension is required`);
    else if (!KNOWN_DIMENSIONS.has(dimension))
      issues.push(`${label}.dimension '${dimension}' is unknown`);
    else if (rows.has(dimension)) issues.push(`${label}.dimension '${dimension}' is duplicated`);
    rows.set(dimension, row);
    if (!STATUSES.has(status)) issues.push(`${label}.status is invalid`);
    const covers = strings(row?.covers);
    const unknown = covers.filter((key) => !requirementKeys.has(key));
    if (unknown.length)
      issues.push(`${label}.covers references unknown requirement(s): ${unknown.join(", ")}`);
    if (status === "covered" && !covers.length && !strings(row?.sources).length &&
        !isDerivedCoverage(row))
      issues.push(`${label} covered status requires covers or sources (covers: requirement keys; sources: paths read)`);
    if (status === "not-applicable" && !text(row?.rationale))
      issues.push(`${label} not-applicable status requires rationale`);
    if (["needs-investigation", "needs-user-decision"].includes(status))
      issues.push(`${label} remains unresolved with status '${status}'`);
  }

  for (const dimension of requiredDimensions)
    if (!rows.has(dimension))
      issues.push(`semantic draft discovery coverage is missing required dimension '${dimension}'`);

  const decisions = Array.isArray(discovery.decisions) ? discovery.decisions : [];
  const decisionKeys = new Set(decisions.map((row) => text(row?.key)).filter(Boolean));
  for (const [index, row] of coverage.entries()) {
    const label = `semantic draft discovery.coverage[${index}]`;
    const status = text(row?.status).toLowerCase();
    const links = strings(row?.decisionKeys);
    if (status === "needs-user-decision" && !links.length)
      issues.push(`${label}.decisionKeys must link needs-user-decision coverage to at least one decision`);
    const unknown = links.filter((key) => !decisionKeys.has(key));
    if (unknown.length)
      issues.push(`${label}.decisionKeys references unknown decision(s): ${unknown.join(", ")}`);
  }
  issues.push(...decisionIssues(decisions));
  if (decisions.some((row) => decisionStatus(row) !== "resolved")) {
    const frontier = decisionFrontier(decisions).map((row) => text(row?.key)).filter(Boolean);
    issues.push(`semantic draft discovery has unresolved decisions; ready frontier: ${frontier.join(", ") || "none"}`);
  }
  return issues;
}

// `userQuestion` ({ key, question, kind }) is one harness-routed user decision
// outside the requirement frontier (the compliance approver). It is asked once,
// after every agent repair, and the same resume route continues after it.
export function semanticIntakeAction(input = {}, {
  resume = null, additionalIssues = [], sourceFreshnessFindings = [], frontierLimit = 3,
  userQuestion = null
} = {}) {
  const source = projectDiscovery(input);
  if (!isSemanticV4Plus(source.version)) return lifecycleOutcome({
    action: "DONE", owner: "harness", boundary: "semantic-intake",
    reached: "intake-ready", reason: "The compatible semantic draft can be compiled.",
    resume
  });
  const issues = semanticIntakeIssues(source);
  const structural = unique([
    ...additionalIssues.map((issue) => text(issue)).filter(Boolean),
    ...issues.filter((issue) => !unresolvedIssue(issue))
  ]);
  if (structural.length) return lifecycleOutcome({
    action: "EDIT", owner: "agent", boundary: "draft-validation",
    reason: "The semantic draft structure must be repaired before intake can continue.",
    instruction: DRAFT_REPAIR_INSTRUCTION,
    intake: { kind: "repair-draft", issues: structural }, resume
  });

  if (sourceFreshnessFindings.length) return lifecycleOutcome({
    action: "EDIT", owner: "agent", boundary: "source-investigation",
    reason: "Grounded sources changed after semantic coverage was recorded.",
    intake: {
      kind: "refresh-source-coverage",
      findings: sourceFreshnessFindings.map((finding) => ({ ...finding }))
    },
    resume
  });

  const coverage = Array.isArray(source.discovery?.coverage)
    ? source.discovery.coverage : [];
  const investigations = coverage.filter((row) =>
    text(row?.status).toLowerCase() === "needs-investigation");
  if (investigations.length) return lifecycleOutcome({
    action: "EDIT", owner: "agent", boundary: "source-investigation",
    reason: "Repository-owned facts must be investigated before asking the user.",
    intake: {
      kind: "investigate-sources",
      dimensions: investigations.map((row) => ({
        dimension: text(row?.dimension).toLowerCase(),
        sources: unique(strings(row?.sources))
      }))
    },
    resume
  });

  if (text(userQuestion?.key) && text(userQuestion?.question)) return lifecycleOutcome({
    action: "ASK_USER", owner: "user", boundary: "consequential-semantics",
    reason: "One user decision is required before the change can be created.",
    decision: {
      kind: text(userQuestion.kind) || "user-decision",
      summary: `Record ${text(userQuestion.key)} in the draft, then resume.`,
      items: [{
        key: text(userQuestion.key), question: text(userQuestion.question),
        alternatives: [], recommended: ""
      }]
    },
    resume
  });

  const decisions = Array.isArray(source.discovery?.decisions)
    ? source.discovery.decisions : [];
  const frontier = decisionFrontier(decisions, frontierLimit);
  if (frontier.length) return lifecycleOutcome({
    action: "ASK_USER", owner: "user", boundary: "consequential-semantics",
    reason: "A bounded set of consequential requirement decisions is ready.",
    decision: {
      kind: "requirement-semantics",
      summary: "Resolve the current dependency-ready requirement frontier.",
      items: frontier.map((row) => ({
        key: text(row?.key),
        question: text(row?.question),
        alternatives: unique(strings(row?.alternatives)),
        recommended: text(row?.recommended)
      }))
    },
    resume
  });

  const unresolvedCoverage = coverage.filter((row) =>
    text(row?.status).toLowerCase() === "needs-user-decision");
  if (unresolvedCoverage.length) return lifecycleOutcome({
    action: "EDIT", owner: "agent", boundary: "draft-validation",
    reason: "Resolved decisions must be projected into coverage and agreement semantics.",
    instruction: DRAFT_REPAIR_INSTRUCTION,
    intake: {
      kind: "project-decisions",
      dimensions: unresolvedCoverage.map((row) => text(row?.dimension).toLowerCase())
    },
    resume
  });

  return lifecycleOutcome({
    action: "DONE", owner: "harness", boundary: "semantic-intake",
    reached: "intake-ready", reason: "Requirement discovery is complete and ready to compile.",
    resume
  });
}

export function normalizeDiscovery(input = {}) {
  if (!isSemanticV4Plus(input.version)) return undefined;
  const source = projectDiscovery(input);
  return {
    coverage: (source.discovery?.coverage || []).map((row) => ({
      dimension: text(row?.dimension).toLowerCase(),
      status: text(row?.status).toLowerCase(),
      covers: unique(strings(row?.covers)),
      sources: unique(strings(row?.sources)),
      decisionKeys: unique(strings(row?.decisionKeys)),
      rationale: text(row?.rationale) || undefined,
      ...(isDerivedCoverage(row) ? { derived: true, derivedFrom: [...row.derivedFrom] } : {})
    })),
    decisions: (source.discovery?.decisions || []).map((row) => ({
      key: text(row?.key),
      status: decisionStatus(row),
      prerequisites: unique(strings(row?.prerequisites)),
      alternatives: unique(strings(row?.alternatives)),
      question: text(row?.question) || undefined,
      recommended: text(row?.recommended) || undefined,
      choice: text(row?.choice) || undefined,
      reason: text(row?.reason) || undefined,
      decidedBy: text(row?.decidedBy).toLowerCase() || undefined,
      decisionRef: text(row?.decisionRef) || undefined
    }))
  };
}
