import { createHash } from "node:crypto";

const SENSITIVE_FLAGS = new Set([
  "--decision-ref", "--reason", "--token", "--secret", "--password", "--key"
]);

export const REPEATABLE_CHECK_OPERATIONS = new Set([
  "validate", "proof-plan", "proof-readiness", "proof-preflight",
  "proof-audit", "land-check", "evidence-doctor", "quality-doctor"
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sanitizedCommandArgs(values = []) {
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = String(values[index]);
    const sensitiveAssignment = [...SENSITIVE_FLAGS]
      .some((flag) => value.startsWith(`${flag}=`));
    if (sensitiveAssignment) {
      result.push(`${value.slice(0, value.indexOf("="))}=<redacted>`);
      continue;
    }
    result.push(value);
    if (SENSITIVE_FLAGS.has(value) && index + 1 < values.length) {
      result.push("<redacted>");
      index += 1;
    }
  }
  return result;
}

function stateProjection(state = {}) {
  const activeProof = state.activeProofRun || {};
  const workspace = state.workspace || {};
  const budgetWindow = state.budget?.window || {};
  return {
    status: state.status ?? null,
    schema: state.schema ?? null,
    contractRevision: state.contractRevision ?? null,
    impact: state.impact ?? null,
    size: state.size ?? null,
    coupling: state.coupling ?? null,
    workspaceHash: activeProof.workspaceHash ?? workspace.relevantHash ?? null,
    budgetWindow: budgetWindow.id ?? null,
    budgetExtension: budgetWindow.extensionNumber ?? null
  };
}

export function operationInputFingerprint({
  operation, values = [], state = {}, changeDigest = null,
  foundationConfigDigest = null, projectPolicyDigest = null
}) {
  if (!operation) return null;
  const projection = {
    operation,
    values: sanitizedCommandArgs(values),
    state: stateProjection(state),
    changeDigest,
    foundationConfigDigest,
    projectPolicyDigest
  };
  return `sha256:${createHash("sha256").update(stableJson(projection)).digest("hex")}`;
}

function measured(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function operationSpan(row) {
  const from = Date.parse(row.startedAt);
  const to = Date.parse(row.finishedAt);
  return Number.isFinite(from) && Number.isFinite(to) && to >= from
    ? { from, to } : null;
}

export function operationPhaseRows(row) {
  const parent = operationSpan(row);
  if (![4, 5].includes(row.version) || !parent || !Array.isArray(row.phaseSpans) || !row.phaseSpans.length)
    return [row];
  let end = parent.from;
  for (const span of row.phaseSpans) {
    if (!span || typeof span !== "object") return [row];
    const interval = operationSpan(span);
    if (!interval || interval.from !== end || interval.to > parent.to ||
        !["change", "build", "prove", "land"].includes(span.phase) ||
        !["completed", "blocked", "failed"].includes(span.status) ||
        typeof span.durationMs !== "number" || span.durationMs !== interval.to - interval.from)
      return [row];
    end = interval.to;
  }
  return end === parent.to ? row.phaseSpans : [row];
}

function unionDuration(spans) {
  const ordered = spans.filter(Boolean).sort((left, right) => left.from - right.from);
  let total = 0;
  let active = null;
  for (const span of ordered) {
    if (!active || span.from > active.to) {
      if (active) total += active.to - active.from;
      active = { ...span };
    } else active.to = Math.max(active.to, span.to);
  }
  return total + (active ? active.to - active.from : 0);
}

function unavailableProfile() {
  return {
    measurement: "unavailable", totalInvocations: null, lifecycleInvocations: null,
    inspectionInvocations: null, failed: null, blocked: null,
    observedSpanMs: null, observedActiveUnionMs: null,
    sameInputCheckCandidates: null, candidateDurationMs: null,
    fingerprintCoverage: null, byCommand: {}, topCommands: []
  };
}

function commandSummary(byCommand, row) {
  const name = row.operation || "unknown";
  const summary = byCommand[name] ||= {
    calls: 0, lifecycle: 0, inspections: 0, failed: 0, blocked: 0,
    durationMs: 0, sameInputCheckCandidates: 0
  };
  summary.calls += 1;
  summary[row.kind === "inspection" ? "inspections" : "lifecycle"] += 1;
  if (row.status === "failed") summary.failed += 1;
  if (row.status === "blocked") summary.blocked += 1;
  summary.durationMs += measured(row.durationMs) ?? 0;
  return { name, summary };
}

function repeatCandidate(repeated, name, fingerprint) {
  if (!REPEATABLE_CHECK_OPERATIONS.has(name) || !fingerprint) return false;
  const key = `${name}\0${fingerprint}`;
  const seen = repeated.get(key) || 0;
  repeated.set(key, seen + 1);
  return seen > 0;
}

export function commandProfile(lifecycleRows = [], inspectionRows = []) {
  const rows = [
    ...lifecycleRows.map((row) => ({ ...row, kind: row.kind || "lifecycle" })),
    ...inspectionRows.map((row) => ({ ...row, kind: row.kind || "inspection" }))
  ];
  if (!rows.length) return unavailableProfile();
  const byCommand = {};
  const repeated = new Map();
  let fingerprinted = 0;
  let sameInputCheckCandidates = 0;
  let candidateDurationMs = 0;
  for (const row of rows) {
    const { name, summary } = commandSummary(byCommand, row);
    const fingerprint = typeof row.inputFingerprint === "string"
      ? row.inputFingerprint : null;
    if (!fingerprint) continue;
    fingerprinted += 1;
    if (repeatCandidate(repeated, name, fingerprint)) {
      sameInputCheckCandidates += 1;
      candidateDurationMs += measured(row.durationMs) ?? 0;
      summary.sameInputCheckCandidates += 1;
    }
  }
  const spans = rows.map(operationSpan).filter(Boolean);
  const observedSpanMs = spans.length
    ? Math.max(...spans.map((span) => span.to)) - Math.min(...spans.map((span) => span.from))
    : null;
  return {
    measurement: fingerprinted === rows.length ? "measured" : "partial",
    totalInvocations: rows.length,
    lifecycleInvocations: rows.filter((row) => row.kind !== "inspection").length,
    inspectionInvocations: rows.filter((row) => row.kind === "inspection").length,
    failed: rows.filter((row) => row.status === "failed").length,
    blocked: rows.filter((row) => row.status === "blocked").length,
    observedSpanMs,
    observedActiveUnionMs: spans.length ? unionDuration(spans) : null,
    sameInputCheckCandidates,
    candidateDurationMs,
    fingerprintCoverage: rows.length ? fingerprinted / rows.length : null,
    byCommand,
    topCommands: Object.entries(byCommand)
      .map(([operation, summary]) => ({ operation, ...summary }))
      .sort((left, right) => right.durationMs - left.durationMs ||
        left.operation.localeCompare(right.operation)).slice(0, 10)
  };
}
