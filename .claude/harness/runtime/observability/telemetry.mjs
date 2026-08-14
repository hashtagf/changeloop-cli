import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

export function createJsonlReader({ root, fail }) {
  function readJsonLines(path) {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); }
      catch (error) { fail(`invalid JSONL: ${relative(root, path)} (${error.message})`); }
    });
  }

  function readJsonLinesTolerant(path) {
    if (!existsSync(path)) return [];
    const rows = [];
    for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
      try { rows.push(JSON.parse(line)); }
      catch {
        if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
          console.error(`WARNING: skipped invalid telemetry row in ${relative(root, path)}`);
      }
    }
    return rows;
  }

  return { readJsonLines, readJsonLinesTolerant };
}

function nullableSum(...values) {
  const known = values.filter((value) =>
    value !== null && value !== undefined && Number.isFinite(Number(value)));
  return known.length ? known.reduce((sum, value) => sum + Number(value), 0) : null;
}

export function runtimeSessionId(env = process.env) {
  return String(env.FOUNDATION_SESSION_ID || env.CODEX_THREAD_ID || "").trim() || null;
}

export function normalizeTelemetryRow(id, row, format, context = {}, timestamp = null) {
  const message = row.message && typeof row.message === "object" ? row.message : {};
  const attributes = row.attributes && typeof row.attributes === "object" ? row.attributes : {};
  if (format === "claude" &&
      (row.type !== "assistant" || !message.usage || message.role !== "assistant"))
    return null;
  const usage = format === "claude"
    ? message.usage
    : format === "otel" ? {
      input_tokens: attributes["gen_ai.usage.input_tokens"] ?? attributes["llm.usage.input_tokens"],
      output_tokens: attributes["gen_ai.usage.output_tokens"] ?? attributes["llm.usage.output_tokens"],
      cache_tokens: attributes["gen_ai.usage.cache_read_tokens"]
    } : (row.usage || row.token_usage || {});
  const requestId = format === "claude"
    ? (row.requestId || row.request_id || message.id || row.uuid)
    : format === "otel" ? (row.requestId || row.traceId || row.trace_id || row.spanId || row.span_id)
    : (row.requestId || row.request_id || row.id || row.uuid);
  if (!requestId) return null;
  const cacheCreationTokens = row.cacheCreationTokens ??
    usage.cache_creation_input_tokens ?? null;
  const cacheReadTokens = row.cacheReadTokens ??
    usage.cache_read_input_tokens ?? usage.cache_tokens ??
    (format === "claude" ? null : row.cacheTokens) ?? null;
  const cacheTokens = row.cacheTokens ?? nullableSum(cacheCreationTokens, cacheReadTokens);
  const snapshot = context.snapshot || {};
  return {
    version: 2,
    runId: row.runId || row.run_id || context.sessionId || id,
    operationId: row.operationId || row.operation_id || row.phase ||
      context.operationId || "unknown",
    agentId: row.agentId || row.agent_id || row.agent ||
      context.agentId || (format === "claude" ? "orchestrator" : null),
    modelId: row.modelId || row.model_id || row.model || message.model ||
      attributes["gen_ai.request.model"] || attributes["llm.request.model"] || null,
    requestId,
    messageId: message.id || row.messageId || null,
    sessionId: row.sessionId || row.session_id || context.sessionId || null,
    parentRequestId: row.parentRequestId || row.parent_request_id || null,
    timestamp: row.timestamp || row.created_at || timestamp || new Date().toISOString(),
    inputTokens: row.inputTokens ?? usage.inputTokens ?? usage.input_tokens ?? usage.input ?? null,
    outputTokens: row.outputTokens ?? usage.outputTokens ?? usage.output_tokens ?? usage.output ?? null,
    cacheCreationTokens,
    cacheReadTokens,
    cacheTokens,
    cost: row.cost ?? row.cost_usd ?? usage.cost_usd ?? null,
    durationMs: row.durationMs ?? row.duration_ms ?? null,
    tool: row.tool || null,
    repositoryId: row.repositoryId || row.repository_id || row.repository || null,
    taskId: row.taskId || row.task_id || row.task || null,
    workspaceHash: row.workspaceHash || snapshot.workspaceHash || null,
    workspaceSnapshotId: row.workspaceSnapshotId || snapshot.id || null,
    changeId: id,
    source: format === "claude" ? "claude-transcript" : format,
    instructionManifestDigest: row.instructionManifestDigest || null,
    attempt: row.attempt ?? null,
    attemptStatus: row.attemptStatus || null,
    fallbackReason: row.fallbackReason || null,
    failureClass: row.failureClass || null,
    sourcePathHash: context.sourcePath
      ? createHash("sha256").update(context.sourcePath).digest("hex") : null
  };
}

// Claude transcript user rows are useful for timing even though they must never
// enter the token-event stream. Keep only an opaque identity and timestamp: in
// particular, do not retain message.content or any other prompt material.
export function normalizeClaudeUserTransition(id, row, context = {}, timestamp = null) {
  const message = row.message && typeof row.message === "object" ? row.message : {};
  if (row.type !== "user" && message.role !== "user") return null;
  const at = row.timestamp || row.created_at || timestamp;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  const sessionId = row.sessionId || row.session_id || context.sessionId || null;
  const sourcePathHash = context.sourcePath
    ? createHash("sha256").update(context.sourcePath).digest("hex") : null;
  const identity = [id, sessionId, row.uuid || row.id || "", at, sourcePathHash]
    .map((value) => value ?? "").join("\0");
  return {
    version: 1,
    kind: "user-message",
    transitionId: createHash("sha256").update(identity).digest("hex"),
    sessionId,
    timestamp: at,
    sourcePathHash
  };
}
