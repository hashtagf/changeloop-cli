import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { classifyDrift, isBlockingDrift, isUnverifiedDrift } from "./model-drift.mjs";

export const HOST_EXECUTION_SCHEMA_VERSION = 1;
const DRIFT_KINDS = ["match", "fallback", "upgrade", "downgrade", "unknown"];
const STATUSES = new Set(["completed", "failed", "timeout", "cancelled", "error"]);
const ATTEMPT_STATUSES = new Set(["completed", "failed", "timeout", "cancelled", "error"]);

function nullableFinite(value, field, { nonNegative = true } = {}) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (nonNegative && number < 0))
    throw new Error(`${field} must be a ${nonNegative ? "non-negative " : ""}number or null`);
  return number;
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function nullableString(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string or null`);
  return value || null;
}

function nullableTimestamp(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error(`${field} must be an ISO timestamp or null`);
  return new Date(value).toISOString();
}

function normalizedUsage(usage = {}) {
  if (usage === null) usage = {};
  if (typeof usage !== "object" || Array.isArray(usage))
    throw new Error("usage must be an object or null");
  return {
    inputTokens: nullableFinite(usage.inputTokens ?? usage.input_tokens, "usage.inputTokens"),
    outputTokens: nullableFinite(usage.outputTokens ?? usage.output_tokens, "usage.outputTokens"),
    cacheTokens: nullableFinite(usage.cacheTokens ?? usage.cache_tokens, "usage.cacheTokens"),
    cost: nullableFinite(usage.cost ?? usage.cost_usd, "usage.cost")
  };
}

function nullableCount(value, field) {
  const count = nullableFinite(value, field);
  if (count !== null && !Number.isInteger(count)) throw new Error(`${field} must be an integer or null`);
  return count;
}

function normalizedAttempt(attempt, index) {
  const number = nullableFinite(attempt?.attempt ?? index + 1, `attempts[${index}].attempt`);
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`attempts[${index}].attempt must be a positive integer`);
  const status = requiredString(attempt?.status, `attempts[${index}].status`);
  if (!ATTEMPT_STATUSES.has(status))
    throw new Error(`attempts[${index}].status is unsupported`);
  return {
    attempt: number,
    model: nullableString(attempt.model, `attempts[${index}].model`),
    status,
    startedAt: nullableTimestamp(attempt.startedAt ?? attempt.started_at,
      `attempts[${index}].startedAt`),
    finishedAt: nullableTimestamp(attempt.finishedAt ?? attempt.finished_at,
      `attempts[${index}].finishedAt`),
    durationMs: nullableFinite(attempt.durationMs ?? attempt.duration_ms,
      `attempts[${index}].durationMs`),
    fallbackReason: nullableString(attempt.fallbackReason ?? attempt.fallback_reason,
      `attempts[${index}].fallbackReason`),
    failureClass: nullableString(attempt.failureClass ?? attempt.failure_class,
      `attempts[${index}].failureClass`),
    usage: normalizedUsage(attempt.usage)
  };
}

/**
 * Normalize a host result to the fields Foundation is allowed to persist.
 * Unknown fields and payload-shaped fields (prompt, messages, tool arguments,
 * output text) are ignored by construction rather than copied and redacted.
 */
export function normalizeHostExecution(input, { changeId = null, importedAt = null } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("host execution result must be an object");
  if (input.schemaVersion !== undefined && Number(input.schemaVersion) !== HOST_EXECUTION_SCHEMA_VERSION)
    throw new Error(`unsupported host execution schema: ${input.schemaVersion}`);
  const dispatchId = requiredString(input.dispatchId ?? input.dispatch_id, "dispatchId");
  const status = requiredString(input.result?.status ?? input.status, "result.status");
  if (!STATUSES.has(status)) throw new Error(`unsupported result.status: ${status}`);
  const attempts = (Array.isArray(input.attempts) ? input.attempts : [])
    .map(normalizedAttempt).sort((left, right) => left.attempt - right.attempt);
  if (new Set(attempts.map((attempt) => attempt.attempt)).size !== attempts.length)
    throw new Error("attempt numbers must be unique");

  return {
    schemaVersion: HOST_EXECUTION_SCHEMA_VERSION,
    dispatchId,
    changeId: nullableString(changeId || input.changeId || input.change_id, "changeId"),
    host: nullableString(input.host ?? input.source, "host"),
    requestedModel: nullableString(input.requestedModel ?? input.requested_model,
      "requestedModel"),
    actualModel: nullableString(input.actualModel ?? input.actual_model, "actualModel"),
    instructionManifestDigest: nullableString(
      input.instructionManifestDigest ?? input.instruction_manifest_digest,
      "instructionManifestDigest"),
    startedAt: nullableTimestamp(input.startedAt ?? input.started_at, "startedAt"),
    finishedAt: nullableTimestamp(input.finishedAt ?? input.finished_at, "finishedAt"),
    durationMs: nullableFinite(input.durationMs ?? input.duration_ms, "durationMs"),
    attempts,
    usage: normalizedUsage(input.usage),
    tools: {
      calls: nullableCount(input.tools?.calls, "tools.calls"),
      failures: nullableCount(input.tools?.failures, "tools.failures")
    },
    result: {
      status,
      failureClass: nullableString(
        input.result?.failureClass ?? input.result?.failure_class, "result.failureClass")
    },
    importedAt: nullableTimestamp(importedAt, "importedAt") || new Date().toISOString()
  };
}

export function hostExecutionTelemetryRows(execution) {
  // The schema declares a top-level `usage` block as first-class and sets no
  // minItems on `attempts`, so a host that reports its spend there — or that
  // reports attempts carrying no usage of their own — produced no telemetry
  // row at all: `imported 0`, a null cost, and a budget that never trips.
  const attemptUsage = execution.attempts.reduce((total, attempt) => ({
    inputTokens: sum(total.inputTokens, attempt.usage.inputTokens),
    outputTokens: sum(total.outputTokens, attempt.usage.outputTokens),
    cacheTokens: sum(total.cacheTokens, attempt.usage.cacheTokens),
    cost: sum(total.cost, attempt.usage.cost)
  }), { inputTokens: null, outputTokens: null, cacheTokens: null, cost: null });
  const declared = execution.usage || {};
  const unattributed = {
    inputTokens: remainder(declared.inputTokens, attemptUsage.inputTokens),
    outputTokens: remainder(declared.outputTokens, attemptUsage.outputTokens),
    cacheTokens: remainder(declared.cacheTokens, attemptUsage.cacheTokens),
    cost: remainder(declared.cost, attemptUsage.cost)
  };
  const rows = attemptRows(execution);
  if (Object.values(unattributed).every((value) => value === null)) return rows;
  // One synthetic row carries whatever the top-level block declared beyond
  // what the attempts already account for, so it is measured exactly once.
  rows.push({
    version: 2,
    runId: execution.dispatchId,
    operationId: "host-execution",
    agentId: execution.host,
    modelId: execution.actualModel,
    requestId: `${execution.dispatchId}:execution`,
    timestamp: execution.finishedAt || execution.startedAt || execution.importedAt,
    inputTokens: unattributed.inputTokens,
    outputTokens: unattributed.outputTokens,
    cacheTokens: unattributed.cacheTokens,
    cost: unattributed.cost,
    durationMs: execution.attempts.length ? null : execution.durationMs,
    changeId: execution.changeId,
    instructionManifestDigest: execution.instructionManifestDigest,
    attempt: null,
    attemptStatus: execution.result.status,
    fallbackReason: null,
    failureClass: execution.result.failureClass,
    source: "host-execution-contract"
  });
  return rows;
}

// Unknown is never zero: a null on either side leaves the sum unknown only
// when both are null, so a partially-reported total still measures what it can.
function sum(left, right) {
  if (left === null || left === undefined) return right ?? null;
  if (right === null || right === undefined) return left;
  return left + right;
}

// What the declared total claims over and above what the attempts accounted
// for. Null when nothing was declared, or when the attempts already cover it.
function remainder(declared, attributed) {
  if (declared === null || declared === undefined) return null;
  const rest = declared - (attributed ?? 0);
  return rest > 0 ? rest : null;
}

function attemptRows(execution) {
  return execution.attempts.map((attempt) => ({
    version: 2,
    runId: execution.dispatchId,
    operationId: "host-execution",
    agentId: execution.host,
    modelId: attempt.model || execution.actualModel,
    requestId: `${execution.dispatchId}:attempt:${attempt.attempt}`,
    timestamp: attempt.finishedAt || attempt.startedAt || execution.importedAt,
    inputTokens: attempt.usage.inputTokens,
    outputTokens: attempt.usage.outputTokens,
    cacheTokens: attempt.usage.cacheTokens,
    cost: attempt.usage.cost,
    durationMs: attempt.durationMs,
    changeId: execution.changeId,
    instructionManifestDigest: execution.instructionManifestDigest,
    attempt: attempt.attempt,
    attemptStatus: attempt.status,
    fallbackReason: attempt.fallbackReason,
    failureClass: attempt.failureClass,
    source: "host-execution-contract"
  }));
}

export function createHostExecutionStore({ root, now = () => new Date().toISOString() }) {
  function safeIdentifier(value, field) {
    const safe = requiredString(value, field);
    if (!/^[A-Za-z0-9._-]+$/.test(safe))
      throw new Error(`${field} contains unsafe characters`);
    return safe;
  }

  function executionPath(changeId, dispatchId) {
    const safeDispatch = safeIdentifier(dispatchId, "dispatchId");
    const safeChange = safeIdentifier(changeId, "changeId");
    return join(root, ".foundation", "logs", safeChange,
      "host-executions", `${safeDispatch}.json`);
  }

  function importExecution(changeId, input) {
    const execution = normalizeHostExecution(input, { changeId, importedAt: now() });
    const path = executionPath(changeId, execution.dispatchId);
    mkdirSync(dirname(path), { recursive: true });
    const existing = readExisting(path);
    if (existing) return { imported: false, duplicate: true, path, execution: existing };
    try {
      writeFileSync(path, `${JSON.stringify(execution, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return { imported: false, duplicate: true, path, execution: readExisting(path) };
    }
    return { imported: true, duplicate: false, path, execution };
  }

  function readExisting(path) {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  return { executionPath, importExecution };
}

/**
 * Model drift is derived from stored provenance at read time and is never read
 * from host-supplied fields: a host that graded its own run could otherwise
 * clear the finding. Every join step degrades to an "unknown" classification
 * rather than throwing, because a minimal install legitimately carries
 * executions with no instruction surface behind them.
 */
export function createModelDriftInspector({
  logs = null, instructionManifests = null, activeChangePath = null,
  policy = null, taskBlocks = null, taskMetadata = null
} = {}) {
  function safeJson(path) {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
  }

  function safeFiles(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name).sort();
    } catch { return []; }
  }

  function activePolicy() {
    try { return typeof policy === "function" ? policy() : policy; } catch { return null; }
  }

  /**
   * A manifest digest covers instruction content and requested tier but not the
   * scope it was written for, so sibling tasks sharing a tier share a digest.
   * The requested tier stays exact; the task attribution becomes a candidate set.
   */
  function manifestsByDigest(changeId) {
    const index = new Map();
    if (!instructionManifests) return index;
    const dir = join(instructionManifests, changeId);
    for (const name of safeFiles(dir)) {
      const manifest = safeJson(join(dir, name));
      const digest = manifest?.manifestDigest;
      if (typeof digest !== "string" || !digest) continue;
      const scope = name.replace(/\.json$/, "").split("-").slice(1).join("-");
      const entry = index.get(digest) ||
        { requestedModel: manifest.execution?.requestedModel ?? null, scopes: [] };
      if (scope && !entry.scopes.includes(scope)) entry.scopes.push(scope);
      index.set(digest, entry);
    }
    return index;
  }

  function taskKinds(changeId) {
    const index = new Map();
    if (!activeChangePath || !taskBlocks || !taskMetadata) return index;
    try {
      const content = readFileSync(join(activeChangePath(changeId), "tasks.md"), "utf8");
      for (const task of taskBlocks(content).map(taskMetadata))
        if (task?.id) index.set(String(task.id).toUpperCase(), task.kind || null);
    } catch { return index; }
    return index;
  }

  function storedExecutions(changeId) {
    if (!logs) return [];
    const dir = join(logs, changeId, "host-executions");
    return safeFiles(dir).map((name) => safeJson(join(dir, name)))
      .filter((value) => value && typeof value === "object" && !Array.isArray(value));
  }

  function driftRows(changeId) {
    const manifests = manifestsByDigest(changeId);
    const kinds = taskKinds(changeId);
    const selectedPolicy = activePolicy();
    const rows = [];
    for (const execution of storedExecutions(changeId)) {
      const digest = typeof execution.instructionManifestDigest === "string" &&
        execution.instructionManifestDigest ? execution.instructionManifestDigest : null;
      const manifest = digest ? manifests.get(digest) || null : null;
      const candidates = (manifest?.scopes || [])
        .map((scope) => ({ id: scope, kind: kinds.get(scope.toUpperCase()) ?? null }));
      const known = candidates.filter((candidate) => candidate.kind !== null);
      const provenance = !digest ? "no-digest"
        : !manifest ? "no-manifest"
          : candidates.length > 1 ? "ambiguous-scope"
            : known.length ? "task" : "non-task-scope";
      const attempts = Array.isArray(execution.attempts) && execution.attempts.length
        ? execution.attempts : [null];
      for (const attempt of attempts) {
        const actualModel = attempt?.model || execution.actualModel || null;
        const drift = classifyDrift({
          requestedTier: manifest?.requestedModel ?? null,
          actualModelId: actualModel,
          policy: selectedPolicy
        });
        const blocking = known.filter((candidate) => isBlockingDrift(drift.kind, candidate.kind));
        const unverified = known.filter((candidate) => isUnverifiedDrift(drift.kind, candidate.kind));
        rows.push({
          dispatchId: execution.dispatchId ?? null,
          attempt: attempt?.attempt ?? null,
          taskId: candidates.length === 1 ? candidates[0].id : null,
          taskKind: candidates.length === 1 ? candidates[0].kind : null,
          ...(candidates.length > 1
            ? { ambiguousTasks: candidates.map((candidate) => candidate.id) } : {}),
          requestedTier: drift.requestedTier,
          actualModel,
          actualTier: drift.actualTier,
          kind: drift.kind,
          blocking: blocking.length > 0,
          // Never blocks Land; exists so "could not be checked" stops reading
          // exactly like "checked and matched" on a risk-sensitive task.
          unverified: unverified.length > 0,
          ...(blocking.length && candidates.length > 1
            ? { blockingTasks: blocking.map((candidate) => candidate.id) } : {}),
          ...(unverified.length && candidates.length > 1
            ? { unverifiedTasks: unverified.map((candidate) => candidate.id) } : {}),
          provenance,
          reason: drift.reason
        });
      }
    }
    return rows;
  }

  function changeDrift(changeId) {
    const rows = driftRows(changeId);
    const byKind = Object.fromEntries(DRIFT_KINDS.map((kind) => [kind, 0]));
    const byProvenance = {};
    const unknownReasons = {};
    for (const row of rows) {
      byKind[row.kind] = Number(byKind[row.kind] || 0) + 1;
      byProvenance[row.provenance] = Number(byProvenance[row.provenance] || 0) + 1;
      if (row.kind === "unknown")
        unknownReasons[row.reason] = Number(unknownReasons[row.reason] || 0) + 1;
    }
    return {
      executions: new Set(rows.map((row) => row.dispatchId)).size,
      attempts: rows.length,
      byKind, byProvenance, unknownReasons,
      downgrades: rows.filter((row) => row.kind === "downgrade"),
      blocking: rows.filter((row) => row.blocking),
      unverified: rows.filter((row) => row.unverified),
      measurement: "derived-from-instruction-manifest-join"
    };
  }

  /** Gate input for Land. Empty array means nothing to answer for. */
  function blockingDrift(changeId) {
    return driftRows(changeId).filter((row) => row.blocking);
  }

  return { blockingDrift, changeDrift, driftRows };
}
