import { createHash } from "node:crypto";
import { sortedJson, sortedValue as stableValue } from "./trust.mjs";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sortedStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(String(value || ""))).filter(Boolean))].sort();
}

export function gateDigest(value) {
  return createHash("sha256").update(sortedJson(value)).digest("hex");
}

export function normalizeGateFinding(finding = {}, defaults = {}) {
  const path = text(finding.path || defaults.path);
  return {
    id: text(finding.id || finding.code || defaults.id) || "unidentified-finding",
    phase: text(finding.phase || defaults.phase) || "unknown",
    gate: text(finding.gate || defaults.gate) || "unknown",
    classification: text(finding.classification || finding.failureClass ||
      defaults.classification) || "product",
    severity: text(finding.severity || defaults.severity).toLowerCase() || "error",
    provider: text(finding.provider || defaults.provider) || null,
    rootCause: text(finding.rootCause || finding.reason || defaults.rootCause) || null,
    message: text(finding.message || finding.reason || defaults.message) ||
      "No diagnostic message was provided",
    paths: sortedStrings([...(finding.paths || []), ...(path ? [path] : [])]),
    claimIds: sortedStrings(finding.claimIds || finding.claims),
    criticalCaseIds: sortedStrings(
      finding.criticalCaseIds || finding.verificationCaseIds || finding.caseIds),
    dependencies: sortedStrings(finding.dependencies)
  };
}

export function normalizeGateFindings(findings = [], defaults = {}) {
  const normalized = findings.map((finding) => normalizeGateFinding(finding, defaults));
  return [...new Map(normalized.map((finding) => [gateDigest(finding), finding])).values()]
    .sort((left, right) => gateDigest(left).localeCompare(gateDigest(right)));
}

export function gateProgressValue({
  phase = "unknown", gate = "unknown", findings = [], changedPaths = [],
  completedTasks = [], evidence = [], strategy = null, workspaceHash = null
} = {}) {
  const normalizedFindings = normalizeGateFindings(findings, { phase, gate });
  const value = {
    phase,
    gate,
    workspaceHash: workspaceHash || null,
    findings: normalizedFindings,
    changedPaths: sortedStrings(changedPaths),
    completedTasks: sortedStrings(completedTasks),
    evidence: [...(Array.isArray(evidence) ? evidence : [])].map(stableValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    strategy: strategy ? stableValue(strategy) : null
  };
  return { ...value, fingerprint: gateDigest(value) };
}

export function compareGateProgress(prior, current) {
  const previousFingerprint = prior?.fingerprint || null;
  const currentFingerprint = current?.fingerprint || null;
  return {
    progressed: !previousFingerprint || previousFingerprint !== currentFingerprint,
    previousFingerprint,
    currentFingerprint
  };
}

export function gateRepairPlan(findings = [], { phase = "unknown", gate = "unknown" } = {}) {
  const normalized = normalizeGateFindings(findings, { phase, gate });
  const groups = new Map();
  for (const finding of normalized) {
    const key = finding.rootCause || `${finding.classification}:${finding.provider || "local"}`;
    const group = groups.get(key) || {
      rootCause: finding.rootCause,
      classification: finding.classification,
      findingIds: [],
      claimIds: [],
      criticalCaseIds: [],
      paths: [],
      dependencies: []
    };
    group.findingIds.push(finding.id);
    group.claimIds.push(...finding.claimIds);
    group.criticalCaseIds.push(...finding.criticalCaseIds);
    group.paths.push(...finding.paths);
    group.dependencies.push(...finding.dependencies);
    groups.set(key, group);
  }
  const tasks = [...groups.values()].map((group, index) => ({
    id: `repair-${String(index + 1).padStart(3, "0")}`,
    ...group,
    findingIds: sortedStrings(group.findingIds),
    claimIds: sortedStrings(group.claimIds),
    criticalCaseIds: sortedStrings(group.criticalCaseIds),
    paths: sortedStrings(group.paths),
    dependencies: sortedStrings(group.dependencies)
  })).sort((left, right) => left.id.localeCompare(right.id));
  const value = { version: 1, phase, gate, tasks };
  return { ...value, digest: gateDigest(value) };
}

// A coding gate that returned the same findings for unchanged inputs is still
// agent work, not a user decision: the harness never blocks before Land. The
// stall is handed back as an automatic repair whose next step is a different
// in-scope strategy, carrying exactly what the gate returned. Counting how
// often the same stall repeats belongs to the advance recovery ladder.
// Genuine user-authority choices keep using `noProgressDecision`.
export function noProgressRepair({
  changeId, phase, gate, progress, findings = [], attemptedStrategies = [],
  resumeCommand, reason = null
}) {
  const normalized = normalizeGateFindings(findings, { phase, gate });
  const lead = normalized.find((finding) => finding.message &&
    finding.message !== "No diagnostic message was provided")?.message || null;
  return {
    status: "ACTION_REQUIRED",
    route: "AUTO_REPAIR",
    reason: "NO_PROGRESS",
    progressFingerprint: progress?.fingerprint || null,
    findings: normalized,
    attemptedStrategies: [...(attemptedStrategies || [])].map(stableValue),
    next: [{
      kind: "change-strategy",
      reason: [reason ||
        `The ${gate} gate returned the same findings for unchanged inputs; ` +
        "the previous repair strategy did not change the result, so choose a different in-scope repair",
      lead].filter(Boolean).join(": "),
      unchanged: true,
      progressFingerprint: progress?.fingerprint || null,
      findingIds: normalized.map((finding) => finding.id).filter(Boolean),
      findings: normalized.slice(0, 8),
      attemptedStrategies: [...(attemptedStrategies || [])].map(stableValue),
      ...(resumeCommand ? { command: resumeCommand } : {})
    }]
  };
}

export function noProgressDecision({
  changeId, phase, gate, progress, findings = [], attemptedStrategies = [],
  resumeCommand, recommended = "change-strategy", options = []
}) {
  const normalized = normalizeGateFindings(findings, { phase, gate });
  const defaultOptions = [
    {
      id: "change-strategy",
      outcome: "Choose a different in-scope repair strategy and resume the same change."
    },
    {
      id: "revise-agreement",
      outcome: "Revise contradictory behavior or scope, then invalidate only affected evidence."
    },
    {
      id: "resolve-external-boundary",
      outcome: "Supply the missing authority, configuration, conflict resolution, or infrastructure."
    },
    {
      id: "split-change",
      outcome: "Split independent or incompatible work while preserving the current record."
    },
    {
      id: "pause",
      outcome: "Preserve the same change and all completed work until a decision can be made."
    },
    {
      id: "abandon",
      outcome: "Explicitly retire the change when completing it is no longer desired."
    }
  ];
  const choices = options.length ? options : defaultOptions;
  return {
    version: 1,
    changeId,
    status: "NEEDS_USER_DECISION",
    completed: false,
    phase,
    gate,
    reason: "NO_PROGRESS",
    progressFingerprint: progress?.fingerprint || null,
    findings: normalized,
    attemptedStrategies: [...(attemptedStrategies || [])].map(stableValue),
    decision: {
      kind: "repair-no-progress",
      summary: "The gate produced the same findings without measurable progress; choose how to resume the preserved change.",
      recommended,
      options: choices
    },
    next: resumeCommand ? [{
      kind: "resume-after-decision",
      command: resumeCommand
    }] : []
  };
}
