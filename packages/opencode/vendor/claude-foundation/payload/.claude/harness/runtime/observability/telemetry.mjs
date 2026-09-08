import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { measuredNumber } from "../core/measured-number.mjs";

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
  const known = values.map(measuredNumber).filter((value) => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

export function runtimeSessionId(env = process.env) {
  return String(env.FOUNDATION_SESSION_ID || env.CODEX_THREAD_ID || "").trim() || null;
}

function firstTruthy(...values) {
  const value = values.find(Boolean);
  return value === undefined ? null : value;
}

function firstPresent(...values) {
  const value = values.find((candidate) => candidate !== null && candidate !== undefined);
  return value === undefined ? null : value;
}

function telemetryUsage(format, row, message, attributes) {
  if (format === "claude") return message.usage;
  if (format === "codex" && row.type === "event_msg" &&
      row.payload?.type === "token_count") {
    const native = row.payload?.info?.last_token_usage || {};
    const input = measuredNumber(native.input_tokens);
    const cached = measuredNumber(native.cached_input_tokens);
    // Native Codex input_tokens includes cached input. The canonical event
    // contract stores fresh input separately because budget spend excludes
    // cache reads and metrics report the two dimensions independently.
    return {
      ...native,
      input_tokens: input === null ? null
        : Math.max(0, input - (cached ?? 0))
    };
  }
  if (format === "otel") return {
    input_tokens: firstPresent(
      attributes["gen_ai.usage.input_tokens"], attributes["llm.usage.input_tokens"]),
    output_tokens: firstPresent(
      attributes["gen_ai.usage.output_tokens"], attributes["llm.usage.output_tokens"]),
    cache_tokens: attributes["gen_ai.usage.cache_read_tokens"]
  };
  return firstTruthy(row.usage, row.token_usage, {});
}

function telemetryRequestId(format, row, message) {
  if (format === "claude")
    return firstTruthy(row.requestId, row.request_id, message.id, row.uuid);
  if (format === "otel")
    return firstTruthy(row.requestId, row.traceId, row.trace_id, row.spanId, row.span_id);
  return firstTruthy(row.requestId, row.request_id, row.id, row.uuid);
}

function telemetryCacheReadTokens(format, row, usage) {
  return measuredNumber(firstPresent(
    row.cacheReadTokens,
    usage.cached_input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_tokens,
    format === "claude" ? null : row.cacheTokens
  ));
}

function sourcePathDigest(path) {
  if (!path) return null;
  return createHash("sha256").update(path).digest("hex");
}

export function normalizeTelemetryRow(id, row, format, context = {}, timestamp = null) {
  const message = row.message && typeof row.message === "object" ? row.message : {};
  const attributes = row.attributes && typeof row.attributes === "object" ? row.attributes : {};
  if (format === "claude" &&
      (row.type !== "assistant" || !message.usage || message.role !== "assistant"))
    return null;
  const usage = telemetryUsage(format, row, message, attributes);
  const codexTotal = format === "codex" && row.type === "event_msg" &&
      row.payload?.type === "token_count"
    ? row.payload?.info?.total_token_usage : null;
  const requestId = codexTotal
    ? `codex:${context.sessionId || "unknown"}:${[
      codexTotal.input_tokens,
      codexTotal.cached_input_tokens,
      codexTotal.output_tokens,
      codexTotal.total_tokens
    ].map((value) => measuredNumber(value) ?? "unknown").join(":")}`
    : telemetryRequestId(format, row, message);
  if (!requestId) return null;
  const cacheCreationTokens = measuredNumber(firstPresent(
    row.cacheCreationTokens, usage.cache_creation_input_tokens,
    usage.cache_write_input_tokens));
  const cacheReadTokens = telemetryCacheReadTokens(format, row, usage);
  const explicitCacheTokens = measuredNumber(row.cacheTokens);
  const cacheTokens = explicitCacheTokens ?? nullableSum(cacheCreationTokens, cacheReadTokens);
  const snapshot = context.snapshot || {};
  return {
    version: 2,
    runId: firstTruthy(row.runId, row.run_id, context.sessionId, id),
    operationId: firstTruthy(
      row.operationId, row.operation_id, row.phase, context.operationId, "unknown"),
    agentId: firstTruthy(
      row.agentId, row.agent_id, row.agent, context.agentId,
      format === "claude" ? "orchestrator" : null),
    modelId: firstTruthy(
      row.modelId, row.model_id, row.model, message.model, context.modelId,
      attributes["gen_ai.request.model"], attributes["llm.request.model"]),
    requestId,
    messageId: firstTruthy(message.id, row.messageId),
    sessionId: firstTruthy(row.sessionId, row.session_id, context.sessionId),
    parentRequestId: firstTruthy(row.parentRequestId, row.parent_request_id),
    timestamp: firstTruthy(row.timestamp, row.created_at, timestamp, new Date().toISOString()),
    inputTokens: measuredNumber(
      firstPresent(row.inputTokens, usage.inputTokens, usage.input_tokens, usage.input)),
    outputTokens: measuredNumber(
      firstPresent(row.outputTokens, usage.outputTokens, usage.output_tokens, usage.output)),
    cacheCreationTokens,
    cacheReadTokens,
    cacheTokens,
    cost: measuredNumber(firstPresent(row.cost, row.cost_usd, usage.cost_usd)),
    durationMs: measuredNumber(firstPresent(row.durationMs, row.duration_ms)),
    tool: firstTruthy(row.tool),
    repositoryId: firstTruthy(row.repositoryId, row.repository_id, row.repository),
    taskId: firstTruthy(row.taskId, row.task_id, row.task),
    workspaceHash: firstTruthy(row.workspaceHash, snapshot.workspaceHash),
    workspaceSnapshotId: firstTruthy(row.workspaceSnapshotId, snapshot.id),
    changeId: id,
    source: format === "claude" ? "claude-transcript" : format,
    instructionManifestDigest: firstTruthy(row.instructionManifestDigest),
    attempt: firstPresent(row.attempt),
    attemptStatus: firstTruthy(row.attemptStatus),
    fallbackReason: firstTruthy(row.fallbackReason),
    failureClass: firstTruthy(row.failureClass),
    sourcePathHash: sourcePathDigest(context.sourcePath)
  };
}

// Claude writes tool results as role=user rows. Only actual user-authored text
// is a human transition; treating tool results as people turns an unattended
// `claude -p` run into minutes of invented human wait. Keep only opaque identity
// and timing metadata — never retain the prompt text itself.
export function normalizeClaudeUserTransition(id, row, context = {}, timestamp = null) {
  const message = row.message && typeof row.message === "object" ? row.message : {};
  if (row.type !== "user" && message.role !== "user") return null;
  if (row.isMeta === true) return null;
  const content = message.content ?? row.content;
  const humanAuthored = typeof content === "string" ? Boolean(content.trim())
    : Array.isArray(content) &&
      !content.some((block) => block?.type === "tool_result") &&
      content.some((block) => block?.type === "text" && String(block.text || "").trim());
  if (!humanAuthored) return null;
  const rowAt = row.timestamp || row.created_at || null;
  const at = rowAt || timestamp;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  const sessionId = row.sessionId || row.session_id || context.sessionId || null;
  const sourcePathHash = context.sourcePath
    ? createHash("sha256").update(context.sourcePath).digest("hex") : null;
  // Identity may use only row content: the import-time fallback differs per
  // sync, so including it would re-mint the transition on every cursor rescan.
  const identity = [id, sessionId, row.uuid || row.id || "", rowAt ?? "", sourcePathHash]
    .map((value) => value ?? "").join("\0");
  return {
    version: 2,
    kind: "human-message",
    transitionId: createHash("sha256").update(identity).digest("hex"),
    sessionId,
    timestamp: at,
    sourcePathHash
  };
}
