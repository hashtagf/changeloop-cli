import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { measuredNumber } from "../core/measured-number.mjs";
import {
  normalizeClaudeUserTransition,
  normalizeTelemetryRow,
  runtimeSessionId
} from "./telemetry.mjs";
import { usageAvailability } from "./metrics-runtime.mjs";

export function commandTelemetryStatus(code, blocked) {
  return code === 0 ? "completed" : blocked ? "blocked" : "failed";
}

const BLOCKER_KINDS = Object.freeze([
  {
    code: "budget-exhausted", classification: "budget",
    pattern: /budget|token|request limit|allowance/i,
    summary: "Measured execution allowance requires an explicit continuation decision",
    recovery: (id) => `claude-foundation budget checkpoint ${id}`
  },
  {
    code: "authority-required", classification: "authority",
    pattern: /authority|approval|acceptance|review receipt|decision-ref/i,
    summary: "Required external authority has not been recorded",
    recovery: (id) => `claude-foundation authority status ${id}`
  },
  {
    code: "resource-conflict", classification: "resource-conflict",
    pattern: /conflict|lease|already active|scope path|resource/i,
    summary: "Another active operation owns a conflicting resource",
    recovery: (id) => `claude-foundation agents plan ${id} --pretty`
  },
  {
    code: "workspace-boundary", classification: "workspace",
    pattern: /workspace|sandbox|base move|outside.*scope|undeclared path/i,
    summary: "The isolated workspace or declared write boundary is not ready",
    recovery: (id) => `claude-foundation sandbox sync ${id}`
  },
  {
    code: "contract-invalid", classification: "contract",
    pattern: /protocol|provider|adapter|criticalcase|critical case|evidence|claim|contract/i,
    summary: "The executable change or evidence contract is incomplete",
    recovery: (id) => `claude-foundation change validate ${id}`
  }
]);

function safeChangeId(value) {
  const id = String(value || "");
  return /^[a-z0-9][a-z0-9-]*$/.test(id) ? id : "<change>";
}

function safeLifecyclePhase(value) {
  const phase = String(value || "").toLowerCase();
  return ["change", "build", "prove", "review", "land"].includes(phase)
    ? phase : "build";
}

export function blockerTelemetryValue(message, context = {}) {
  const source = String(message || "");
  const matches = BLOCKER_KINDS.filter((candidate) => candidate.pattern.test(source));
  const kind = matches.length === 1 ? matches[0] : {
    code: "policy-guard", classification: "policy",
    summary: "A Change Loop policy guard stopped the operation",
    recovery: (id) => `claude-foundation packet ${id} --phase ${safeLifecyclePhase(context.phase)}`
  };
  const operation = String(context.operationName || "unknown")
    .replace(/[^a-z0-9-]/gi, "-").slice(0, 64) || "unknown";
  return {
    code: kind.code,
    classification: kind.classification,
    summary: kind.summary,
    recovery: kind.recovery(safeChangeId(context.changeId)),
    fingerprint: `sha256:${createHash("sha256")
      .update(`${kind.code}\0${operation}`).digest("hex")}`
  };
}

export function commandTelemetryDetails(context) {
  return {
    ...(context.stageSpans ? { stageSpans: context.stageSpans } : {}),
    ...(context.schedulerEvents?.length ? { schedulerEvents: context.schedulerEvents } : {})
  };
}

export function commandTelemetryRow(context, code) {
  const inspection = context.readOnlyOperations.has(context.operationName);
  const status = commandTelemetryStatus(code, context.blocked);
  return {
    version: 5,
    changeId: context.changeId,
    operation: context.operationName,
    kind: inspection ? "inspection" : "lifecycle",
    phase: context.publicOperation || context.operationPhase || null,
    status,
    blocker: status === "blocked"
      ? context.blocker || blockerTelemetryValue("", context) : null,
    exitCode: code,
    startedAt: new Date(context.operationStartedAt).toISOString(),
    finishedAt: context.now(),
    durationMs: context.timestamp() - context.operationStartedAt,
    ...(context.phaseSpans ? { phaseSpans: context.phaseSpans } : {}),
    ...commandTelemetryDetails(context),
    requests: null,
    inputTokens: null,
    outputTokens: null,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    cacheTokens: null,
    cost: null,
    inputFingerprint: context.operationInputFingerprint || null,
    inputMeasurement: context.operationInputFingerprint
      ? "command-args+runtime-state+change-content+policy" : "unavailable",
    measurement: "command-observed; model usage requires host telemetry ingestion"
  };
}

export function commandTelemetryEligible(context) {
  if (context.telemetryDisabled || !context.changeId || !context.operationName)
    return false;
  return context.operationStatusAtStart !== "archived";
}

export function recordCommandTelemetry(context, code) {
  if (!commandTelemetryEligible(context)) return false;
  try {
    const ledger = context.readOnlyOperations.has(context.operationName)
      ? "inspections.jsonl" : "operations.jsonl";
    const path = join(context.logs, context.changeId, ledger);
    context.mkdir(dirname(path), { recursive: true });
    context.append(path, `${JSON.stringify(commandTelemetryRow(context, code))}\n`);
    return true;
  } catch (error) {
    if (context.telemetryDebug)
      context.warn(`WARNING: telemetry unavailable: ${error.message}`);
    return false;
  }
}

// Retain one invocation row, with disjoint child phase intervals. Readers use
// the intervals for phase attribution and the parent for command accounting.
export function createCommandPhaseRecorder(context, record = recordCommandTelemetry) {
  let phase = null;
  let startedAt = null;
  const spans = [];
  const stageSpans = [];
  const schedulerEvents = [];
  const measuredStage = (stage, operation) => {
    const started = context().timestamp();
    try {
      const value = operation();
      stageSpans.push({ stage, durationMs: context().timestamp() - started, status: "completed" });
      return value;
    } catch (error) {
      stageSpans.push({ stage, durationMs: context().timestamp() - started, status: "failed" });
      throw error;
    }
  };
  const close = (at, status) => spans.push({
    phase, startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(at).toISOString(), durationMs: at - startedAt, status
  });
  return {
    measure: measuredStage,
    scheduler(event = {}) {
      schedulerEvents.push({
        scheduler: String(event.scheduler || "unknown"),
        wave: Number(event.wave || 0),
        readyNodes: Number(event.readyNodes || 0),
        executedNodes: Number(event.executedNodes || 0),
        reusedNodes: event.reusedNodes === null || event.reusedNodes === undefined
          ? null : Number(event.reusedNodes),
        queueingMs: event.queueingMs === null || event.queueingMs === undefined
          ? null : Number(event.queueingMs),
        peakConcurrency: Number(event.peakConcurrency || 0)
      });
    },
    async measureAsync(stage, operation) {
      const started = context().timestamp();
      try {
        const value = await operation();
        stageSpans.push({ stage, durationMs: context().timestamp() - started, status: "completed" });
        return value;
      } catch (error) {
        stageSpans.push({ stage, durationMs: context().timestamp() - started, status: "failed" });
        throw error;
      }
    },
    transition(next) {
      const base = context();
      if (base.operationName !== "advance" || phase === next ||
          !["change", "build", "prove", "land"].includes(next)) return;
      const at = base.timestamp();
      if (phase) close(at, "completed");
      startedAt = phase ? at : base.operationStartedAt;
      phase = next;
    },
    finish(code) {
      const base = context();
      if (!phase) return record({ ...base, stageSpans, schedulerEvents }, code);
      const at = base.timestamp();
      close(at, commandTelemetryStatus(code, base.blocked));
      return record({ ...base, phaseSpans: spans, stageSpans, schedulerEvents,
        now: () => new Date(at).toISOString(), timestamp: () => at,
        ...(spans.length === 1 ? { operationPhase: phase, publicOperation: phase } : {})
      }, code);
    }
  };
}

export function validateTelemetryEventFlags(context, id, state, flags) {
  if (flags.repo) context.repositoryById(id, flags.repo, state);
  if (flags.task) {
    const taskId = String(flags.task).toUpperCase();
    const known = context.taskBlocks(context.readFile(
      join(context.activeChangePath(id), "tasks.md"), "utf8"))
      .some((task) => task.id === taskId);
    if (!known) context.fail(`event references unknown task '${flags.task}'`);
    flags.task = taskId;
  }
  for (const field of ["input", "output", "cache", "cache-create", "cost", "duration"])
    if (flags[field] !== undefined && measuredNumber(flags[field]) === null)
      context.fail(`event --${field} must be numeric`);
}

export function telemetryCacheUsage(flags) {
  // `--cache` is the read. A separate write input is required so cache-write
  // spend remains billable instead of collapsing structurally to zero.
  const cacheReadTokens = measuredNumber(flags.cache);
  const cacheCreationTokens = flags["cache-create"] === undefined
    ? null : measuredNumber(flags["cache-create"]);
  const measured = [cacheReadTokens, cacheCreationTokens]
    .filter((value) => value !== null);
  return {
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens: measured.length
      ? measured.reduce((sum, value) => sum + value, 0)
      : null
  };
}

export function buildTelemetryEvent(context, id, flags, snapshot) {
  return {
    version: 2,
    runId: flags.run || process.env.FOUNDATION_RUN_ID ||
      process.env.FOUNDATION_CLAUDE_SESSION_ID || id,
    operationId: flags.operation || "unknown",
    agentId: flags.agent || null,
    modelId: flags.model || null,
    requestId: flags.request || null,
    parentRequestId: flags.parent || null,
    timestamp: context.now(),
    inputTokens: measuredNumber(flags.input),
    outputTokens: measuredNumber(flags.output),
    ...telemetryCacheUsage(flags),
    cost: measuredNumber(flags.cost),
    durationMs: measuredNumber(flags.duration),
    tool: flags.tool || null,
    repositoryId: flags.repo || null,
    taskId: flags.task || null,
    workspaceHash: snapshot.workspaceHash || null,
    workspaceSnapshotId: snapshot.snapshotId || snapshot.id || null,
    changeId: id,
    source: "host-execution-contract"
  };
}

export function assertUniqueTelemetryRequest(context, path, requestId) {
  if (!existsSync(path)) return;
  const duplicate = context.readFile(path, "utf8").split("\n")
    .filter(Boolean).some((line) => {
      try { return JSON.parse(line).requestId === requestId; }
      catch { context.fail(`invalid telemetry ledger: ${relative(context.root, path)}`); }
    });
  if (duplicate) context.fail(`duplicate telemetry request '${requestId}'`);
}

export function recordTelemetryEvent(context, id, flags) {
  const state = context.loadRuntime(id);
  validateTelemetryEventFlags(context, id, state, flags);
  const snapshot = state.activeProofRun || context.readJson(context.snapshotPath(id), {});
  const event = buildTelemetryEvent(context, id, flags, snapshot);
  if (!event.requestId) context.fail("event requires --request for unique telemetry identity");
  const path = join(context.logs, id, "events.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  assertUniqueTelemetryRequest(context, path, event.requestId);
  context.append(path, `${JSON.stringify(event)}\n`);
  context.synchronizeBudgetUsage(
    state, context.readJsonLines(path), event.runId, "external-events", 1);
  context.saveRuntime(state);
  context.reportBudget(id, state);
}

export function normalizeTelemetryBatch({
  id, rows, format, context, known, knownTransitions, now,
  normalizeEvent = normalizeTelemetryRow,
  normalizeTransition = normalizeClaudeUserTransition
}) {
  const normalized = [];
  const transitions = [];
  const rollingContext = { ...context };
  for (const row of rows) {
    if (format === "codex" && row.type === "session_meta") {
      rollingContext.sessionId ||= String(row.payload?.id || "").trim() || null;
      rollingContext.cwd = row.payload?.cwd || rollingContext.cwd;
    }
    if (format === "codex" && row.type === "turn_context") {
      rollingContext.modelId = row.payload?.model || rollingContext.modelId;
      rollingContext.cwd = row.payload?.cwd || rollingContext.cwd;
    }
    const rowTime = Date.parse(row.timestamp || row.created_at || "");
    const since = Date.parse(rollingContext.since || "");
    if (Number.isFinite(rowTime) && Number.isFinite(since) && rowTime < since)
      continue;
    if (format === "claude") {
      const transition = normalizeTransition(id, row, rollingContext, now());
      if (transition && !knownTransitions.has(transition.transitionId)) {
        knownTransitions.add(transition.transitionId);
        transitions.push(transition);
      }
    }
    const event = normalizeEvent(id, row, format, rollingContext, now());
    if (!event || known.has(event.requestId)) continue;
    known.add(event.requestId);
    normalized.push(event);
  }
  return { normalized, transitions };
}

export function appendTelemetryJsonLines(path, rows, options = {}) {
  const { makeDirectory = mkdirSync, append = appendFileSync } = options;
  if (!rows.length) return false;
  makeDirectory(dirname(path), { recursive: true });
  append(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return true;
}

export function replaceTelemetryJsonLines(path, rows, options = {}) {
  const { makeDirectory = mkdirSync, write = writeFileSync,
    rename = renameSync } = options;
  makeDirectory(dirname(path), { recursive: true });
  const temporary = `${path}.replacement-${process.pid}`;
  write(temporary, rows.length
    ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "");
  rename(temporary, path);
  return true;
}

export function rebindTelemetryWindow(events, changeId, windowId) {
  if (!windowId) return;
  for (const event of events)
    if (event.runId === changeId) event.runId = windowId;
}

export function activeTelemetryRunId(events, context, changeId) {
  return events.at(-1)?.runId || context.sessionId || changeId;
}

export function phaseTelemetryHost(host, sessionId, env = process.env) {
  if (host) return "claude-code";
  if (env.CODEX_THREAD_ID) return "codex";
  return sessionId ? "generic-host" : "unknown";
}

export function phaseTelemetryMode(host, sessionId) {
  if (host) return "automatic-transcript";
  return sessionId ? "explicit-import" : "unavailable";
}

export function recommendedPhaseModelTier(phase) {
  return { change: "deep", build: "standard", prove: "fast", land: "fast" }[phase] ||
    "standard";
}

export function phaseContextMode(prior, sessionId) {
  if (!sessionId) return "unavailable";
  if (!prior?.sessionId) return "initial";
  return prior.sessionId === sessionId ? "retained" : "fresh";
}

export function buildPhaseContextRow({
  id, phase, prior, host, sessionId, env = process.env, timestamp
}) {
  return {
    version: 1,
    changeId: id,
    phase,
    sessionId,
    telemetryHost: phaseTelemetryHost(host, sessionId, env),
    telemetryMode: phaseTelemetryMode(host, sessionId),
    contextMode: phaseContextMode(prior, sessionId),
    recommendedModelTier: recommendedPhaseModelTier(phase),
    actualModel: env.FOUNDATION_MODEL_ID || null,
    trigger: env.FOUNDATION_PHASE_TRIGGER || null,
    priorPhase: prior?.phase || null,
    priorSessionId: prior?.sessionId || null,
    timestamp
  };
}

export const TELEMETRY_IMPORT_FORMATS = Object.freeze([
  "generic", "codex", "cursor", "otel", "claude"
]);

export function validSourceOffset(source, size) {
  const offset = Number(source?.offset || 0);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= size ? offset : null;
}

export function sourceCursorIdentityComplete(source) {
  return source?.device !== undefined && source?.inode !== undefined &&
    source?.anchorStart !== undefined && Boolean(source?.anchorHash);
}

export function sourceCursorIdentityMatches(current, source) {
  return current.device === String(source.device) &&
    current.inode === String(source.inode) &&
    current.anchorStart === Number(source.anchorStart) &&
    current.anchorHash === source.anchorHash;
}

export function sourceReadOffsetOperation(context, path, source) {
  const offset = validSourceOffset(source, context.stat(path).size);
  if (offset === null || !sourceCursorIdentityComplete(source)) return 0;
  return sourceCursorIdentityMatches(context.cursorIdentity(path, offset), source) ? offset : 0;
}

export function parseTelemetryImportRows({ fail, output = console }, source, text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const rows = [];
    let unparseable = 0;
    for (const line of text.split("\n").filter(Boolean)) {
      try { rows.push(JSON.parse(line)); }
      catch { unparseable += 1; }
    }
    if (!rows.length) fail(`telemetry source is neither JSON nor JSONL: ${source}`);
    if (unparseable)
      output.error(`WARNING: skipped ${unparseable} unparseable telemetry line(s) in ${source}`);
    return rows;
  }
}

export function validateTelemetryImportRows({ fail }, format, rows) {
  if (format === "claude" && !rows.some((row) =>
    row.type === "assistant" && row.message?.role === "assistant" && row.message?.usage))
    fail("Claude telemetry source has no assistant.message.usage records");
  if (format === "codex" && !rows.some((row) =>
    (row.type === "event_msg" && row.payload?.type === "token_count" &&
      row.payload?.info?.last_token_usage) ||
    (telemetryRequestLike(row) && telemetryUsageLike(row))))
    fail("Codex telemetry source has no supported token_count or request usage records");
}

function telemetryRequestLike(row) {
  return Boolean(row?.requestId || row?.request_id || row?.id || row?.uuid);
}

function telemetryUsageLike(row) {
  return Boolean(row?.usage || row?.token_usage);
}

export function importTelemetryOperation(context, id, values) {
  const { flags, rest } = context.parseFlags(values);
  const source = rest[0];
  if (!source) context.fail("telemetry import requires a JSON or JSONL file");
  const format = flags.format || "generic";
  if (!TELEMETRY_IMPORT_FORMATS.includes(format))
    context.fail("telemetry --format must be generic|codex|cursor|otel|claude");
  const path = context.resolvePath(context.cwd(), source);
  if (!context.pathExists(path)) context.fail(`telemetry source not found: ${source}`);
  const rows = parseTelemetryImportRows(context, source, context.readFile(path, "utf8").trim());
  validateTelemetryImportRows(context, format, rows);
  const state = context.loadRuntime(id);
  const snapshot = context.readJson(context.snapshotPath(id), {});
  const imported = context.appendTelemetryRows(id, rows, format, {
    snapshot,
    sessionId: format === "codex" ? context.runtimeSessionId() : null,
    sourcePath: path,
    since: state.createdAt || null,
    replaceSource: format === "codex"
  });
  context.output.log(`TELEMETRY ${id}: imported ${imported}; skipped ${rows.length - imported}`);
}

export function syncClaudeTelemetrySource(context, {
  id, path, host, session, snapshot, options
}) {
  const key = context.sourceKey(path);
  const source = session.sources[key] || { path, offset: 0 };
  let chunk;
  let nextSource;
  try {
    chunk = context.readCompleteJsonLines(path, context.sourceReadOffset(path, source));
    nextSource = context.sourceCursor(path, chunk.nextOffset);
  } catch (error) {
    if (!options.quiet) context.fail(error.message);
    context.output.error(
      `WARNING: skipped unreadable Claude transcript ${context.basename(path)}: ${error.message}`);
    return { imported: 0, scanned: 0 };
  }
  const rows = chunk.rows.filter(context.belongsToThisProject);
  const imported = context.appendTelemetryRows(id, rows, "claude", {
    sessionId: host.sessionId,
    operationId: session.operationId || "unknown",
    agentId: path !== host.transcriptPath
      ? context.basename(path).replace(/^agent-/, "").replace(/\.jsonl$/, "")
      : "orchestrator",
    sourcePath: path,
    snapshot
  });
  session.sources[key] = nextSource;
  return { imported, scanned: chunk.rows.length };
}

export function syncClaudeTelemetryOperation(context, id, options = {}) {
  context.loadRuntime(id);
  const host = context.claudeHostContext(options.source || null);
  if (!host) {
    if (!options.quiet)
      context.output.log(`TELEMETRY ${id}: Claude transcript unavailable; imported 0`);
    return { imported: 0, scanned: 0 };
  }
  const { cursors, session } = context.bindClaudeSession(id, options.operationId || null, {
    source: options.source || null,
    fromStart: Boolean(options.source)
  });
  const snapshot = context.readJson(context.snapshotPath(id), {});
  const totals = { imported: 0, scanned: 0 };
  for (const path of context.collectClaudeSources(host.transcriptPath)) {
    const result = syncClaudeTelemetrySource(context, {
      id, path, host, session, snapshot, options
    });
    totals.imported += result.imported;
    totals.scanned += result.scanned;
  }
  session.updatedAt = context.now();
  context.saveClaudeCursors(id, cursors);
  if (!options.quiet)
    context.output.log(`TELEMETRY ${id}: imported ${totals.imported}; scanned ${totals.scanned}; source claude-transcript`);
  return totals;
}

export const CLAUDE_CURSOR_ANCHOR_BYTES = 4096;

export function telemetrySha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function claudeCursorIdentityOperation(context, path, offset) {
  const metadata = context.stat(path);
  const boundedOffset = Math.max(0, Math.min(Number(offset) || 0, metadata.size));
  const anchorStart = Math.max(0, boundedOffset - context.anchorBytes);
  const buffer = Buffer.alloc(boundedOffset - anchorStart);
  if (buffer.length) {
    const descriptor = context.open(path, "r");
    try {
      let consumed = 0;
      while (consumed < buffer.length) {
        const count = context.read(
          descriptor, buffer, consumed, buffer.length - consumed, anchorStart + consumed);
        if (count === 0) break;
        consumed += count;
      }
      if (consumed !== buffer.length)
        throw new Error(`Claude transcript changed while its cursor was inspected`);
    } finally {
      context.close(descriptor);
    }
  }
  return {
    device: String(metadata.dev),
    inode: String(metadata.ino),
    anchorStart,
    anchorHash: context.hash(buffer)
  };
}

export const claudeCursorIdentity = claudeCursorIdentityOperation.bind(null, {
  stat: statSync,
  open: openSync,
  read: readSync,
  close: closeSync,
  hash: telemetrySha256,
  anchorBytes: CLAUDE_CURSOR_ANCHOR_BYTES
});

export function belongsToProjectValue(rootPath, row, canonicalPath) {
  const cwd = row?.cwd || row?.workingDirectory || row?.projectPath;
  if (typeof cwd !== "string" || !cwd) return true;
  const inside = relative(canonicalPath(rootPath), canonicalPath(cwd));
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

export function belongsToProjectOperation({ rootPath, canonicalPath }, row) {
  return belongsToProjectValue(rootPath(), row, canonicalPath);
}

export function collectClaudeSourcesOperation({
  pathExists = existsSync,
  readDirectory = readdirSync,
  realpath = realpathSync
}, transcriptPath) {
  const sources = [transcriptPath];
  const sessionArtifacts = join(dirname(transcriptPath),
    basename(transcriptPath).replace(/\.jsonl$/, ""), "subagents");
  function collect(path) {
    if (!pathExists(path)) return;
    for (const entry of readDirectory(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) collect(child);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        sources.push(realpath(child));
    }
  }
  collect(sessionArtifacts);
  return [...new Set(sources)];
}

export function bindClaudeSessionOperation(context, id, operationId, options = {}) {
  const host = context.claudeHostContext(options.source || null);
  if (!host) return null;
  const cursors = context.loadClaudeCursors(id);
  let session = cursors.sessions[host.sessionId];
  if (!session) {
    session = {
      sessionId: host.sessionId,
      transcriptPath: host.transcriptPath,
      operationId: operationId || "unknown",
      boundAt: context.now(),
      sources: {}
    };
    for (const path of context.collectClaudeSources(host.transcriptPath)) {
      session.sources[context.sourceKey(path)] = context.sourceCursor(
        path, options.fromStart ? 0 : context.stat(path).size);
    }
    cursors.sessions[host.sessionId] = session;
  } else {
    session.transcriptPath = host.transcriptPath;
    if (operationId) session.operationId = operationId;
  }
  session.updatedAt = context.now();
  context.saveClaudeCursors(id, cursors);
  return { context: host, cursors, session };
}

export function readCompleteJsonLinesOperation({
  stat = statSync,
  open = openSync,
  read = readSync,
  close = closeSync
}, path, offset) {
  const size = stat(path).size;
  const start = offset >= 0 && offset <= size ? offset : 0;
  if (start === size) return { rows: [], nextOffset: start };
  const buffer = Buffer.alloc(size - start);
  const descriptor = open(path, "r");
  try {
    read(descriptor, buffer, 0, buffer.length, start);
  } finally {
    close(descriptor);
  }
  const newline = buffer.lastIndexOf(10);
  if (newline < 0) return { rows: [], nextOffset: start };
  const text = buffer.subarray(0, newline + 1).toString("utf8");
  const rows = text.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        `invalid Claude transcript record in ${basename(path)} (${error.message})`);
    }
  });
  return { rows, nextOffset: start + newline + 1 };
}

export function normalizedContextRollup(id, loaded) {
  const rollup = {
    version: 1,
    changeId: id,
    count: measuredNumber(loaded.count) ?? 0,
    totalBytes: measuredNumber(loaded.totalBytes) ?? 0,
    byKind: {}
  };
  const archivedKinds = loaded.byKind && typeof loaded.byKind === "object"
    ? Object.entries(loaded.byKind) : [];
  for (const [kind, archived] of archivedKinds) {
    const count = measuredNumber(archived?.count);
    const totalBytes = measuredNumber(archived?.totalBytes);
    const maxBytes = measuredNumber(archived?.maxBytes);
    if (count === null || totalBytes === null || maxBytes === null) continue;
    rollup.byKind[kind] = { count, totalBytes, maxBytes };
  }
  return rollup;
}

export function createTelemetryRuntime({
  root,
  logs,
  contextEventSchemaVersion,
  stableHash,
  now,
  readJson,
  writeJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  saveRuntime,
  synchronizeBudgetUsage,
  reportBudget,
  snapshotPath,
  parseFlags,
  activeChangePath,
  repositoryById,
  taskBlocks,
  fail
}) {
  function recordContextMetric(id, kind, bytes, details = {}) {
    try {
      const dir = join(logs, id, "context-events");
      mkdirSync(dir, { recursive: true });
      const event = {
        version: Number(contextEventSchemaVersion),
        changeId: id,
        kind,
        bytes,
        ...details,
        timestamp: now()
      };
      const name = `${Date.now()}-${process.pid}-${stableHash(event).slice(0, 12)}.json`;
      writeJson(join(dir, name), event);
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
      if (entries.length <= 1000) return;

      const lockPath = join(logs, id, "context-rollup.lock");
      let lock = null;
      try {
        try {
          lock = openSync(lockPath, "wx");
        } catch {
          if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 300000) {
            rmSync(lockPath, { force: true });
            lock = openSync(lockPath, "wx");
          }
        }
        if (lock === null) return;
        const rollupPath = join(logs, id, "context-rollup.json");
        // A re-read rollup is external input: a non-numeric counter would
        // concatenate or NaN-poison every later drain, and a missing byKind
        // threw before any file was folded in, so the drain failed on every
        // retry while pending events accumulated past the threshold forever.
        // Rebuild from measured components; a junk byKind row restarts from
        // the fresh measurements, matching the skip rule metrics-runtime
        // applies when it reads the rollup back.
        const loaded = readJson(rollupPath, {});
        const rollup = normalizedContextRollup(id, loaded);
        for (const entry of entries.slice(0, 500)) {
          const path = join(dir, entry);
          const row = readJson(path, {});
          const bytes = measuredNumber(row.bytes);
          if (row.kind && bytes !== null) {
            rollup.count += 1;
            rollup.totalBytes += bytes;
            const summary = rollup.byKind[row.kind] ||= {
              count: 0,
              totalBytes: 0,
              maxBytes: 0
            };
            summary.count += 1;
            summary.totalBytes += bytes;
            summary.maxBytes = Math.max(summary.maxBytes, bytes);
          }
          rmSync(path, { force: true });
        }
        rollup.updatedAt = now();
        writeJson(rollupPath, rollup);
      } finally {
        if (lock !== null) closeSync(lock);
        if (lock !== null) rmSync(lockPath, { force: true });
      }
    } catch (error) {
      if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
        console.error(`WARNING: context telemetry unavailable: ${error.message}`);
    }
  }

  function telemetryCursorPath(id) {
    return join(logs, id, "claude-cursors.json");
  }

  function sourceKey(path) {
    return createHash("sha256").update(path).digest("hex").slice(0, 24);
  }

  const cursorIdentity = claudeCursorIdentity;

  function sourceCursor(path, offset) {
    return { path, offset, ...cursorIdentity(path, offset) };
  }

  const sourceReadOffset = sourceReadOffsetOperation.bind(null, {
    stat: statSync,
    cursorIdentity
  });

  // The session bound works; the project bound did not exist. A transcript is
  // resolved purely from the environment, so a sibling agent working in a
  // different repository — same host, same session id space — had its requests
  // and cache reads counted against this project's change, and reached the
  // user's cost numbers. Rows that name a working directory must name one
  // inside this project; rows that name none are kept, since dropping them
  // would silently under-report rather than mis-attribute.
  function canonicalPathOrSelf(path) {
    try { return realpathSync(path); } catch { return resolve(path); }
  }

  let canonicalRootCache = null;
  function canonicalRoot() {
    canonicalRootCache ||= canonicalPathOrSelf(root);
    return canonicalRootCache;
  }

  const belongsToThisProject = belongsToProjectOperation.bind(null, {
    rootPath: canonicalRoot,
    canonicalPath: canonicalPathOrSelf
  });

  function claudeHostContext(sourceOverride = null) {
    const transcriptPath = sourceOverride || process.env.FOUNDATION_CLAUDE_TRANSCRIPT_PATH;
    if (!transcriptPath) return null;
    const path = resolve(transcriptPath);
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    return {
      sessionId: sourceOverride
        ? basename(path).replace(/\.jsonl$/, "")
        : (process.env.FOUNDATION_CLAUDE_SESSION_ID || basename(path).replace(/\.jsonl$/, "")),
      transcriptPath: realpathSync(path)
    };
  }

  function recordPhaseContext(id, phase) {
    try {
      const path = join(logs, id, "phase-context.jsonl");
      const prior = readJsonLinesTolerant(path).at(-1) || null;
      const host = claudeHostContext();
      const sessionId = host?.sessionId || runtimeSessionId();
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(buildPhaseContextRow({
        id, phase, prior, host, sessionId, timestamp: now()
      }))}\n`);
    } catch (error) {
      if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
        console.error(`WARNING: phase telemetry unavailable: ${error.message}`);
    }
  }

  const collectClaudeSources = collectClaudeSourcesOperation.bind(null, {});

  function loadClaudeCursors(id) {
    return readJson(telemetryCursorPath(id), { version: 1, sessions: {} });
  }

  function saveClaudeCursors(id, cursors) {
    writeJson(telemetryCursorPath(id), cursors);
  }

  // Whether any model-usage row was ever imported for this change. Archive
  // consults this to warn — not block — when the record is sealed with empty
  // cost columns.
  function modelUsageRecorded(id) {
    const path = join(logs, id, "events.jsonl");
    try { return existsSync(path) && statSync(path).size > 0; }
    catch { return false; }
  }

  function telemetryReadiness(id) {
    return usageAvailability(
      readJsonLinesTolerant(join(logs, id, "events.jsonl")),
      readJsonLinesTolerant(join(logs, id, "phase-context.jsonl")),
      id
    );
  }

  const bindClaudeSession = bindClaudeSessionOperation.bind(null, {
    claudeHostContext,
    loadClaudeCursors,
    collectClaudeSources,
    sourceKey,
    sourceCursor,
    stat: statSync,
    now,
    saveClaudeCursors
  });

  const readCompleteJsonLines = readCompleteJsonLinesOperation.bind(null, {});

  function appendTelemetryRows(id, rows, format, context = {}) {
    const target = join(logs, id, "events.jsonl");
    const transitionTarget = join(logs, id, "user-transitions.jsonl");
    const existing = readJsonLines(target);
    const sourcePathHash = context.sourcePath
      ? createHash("sha256").update(context.sourcePath).digest("hex") : null;
    const replacesSource = Boolean(context.replaceSource && sourcePathHash);
    const retained = replacesSource
      ? existing.filter((row) => row.sourcePathHash !== sourcePathHash)
      : existing;
    const removedCount = existing.length - retained.length;
    const known = new Set(retained.map((row) => row.requestId));
    const knownTransitions = new Set(readJsonLines(transitionTarget)
      .map((row) => row.transitionId));
    const { normalized, transitions } = normalizeTelemetryBatch({
      id, rows, format, context, known, knownTransitions, now
    });
    appendTelemetryJsonLines(transitionTarget, transitions);
    if (normalized.length || removedCount) {
      // Loading runtime state can normalize it, so it stays inside this branch:
      // an import that adds nothing must leave the change untouched.
      const state = loadRuntime(id);
      // A budget window represents one real run. Rows that carry a genuine run
      // or session identity may rotate it. Rows that fell back to the change id
      // carry no identity at all — attribute those to the run already active,
      // or every external import opens a window and discards the current one
      // along with its targets.
      const windowId = state.budget?.window?.id || null;
      rebindTelemetryWindow(normalized, id, windowId);
      if (replacesSource)
        replaceTelemetryJsonLines(target, [...retained, ...normalized]);
      else
        appendTelemetryJsonLines(target, normalized);
      const allEvents = readJsonLines(target);
      const activeRunId = activeTelemetryRunId(normalized, context, id);
      if (removedCount &&
          !readJsonLines(join(logs, id, "budget-events.jsonl")).length &&
          state.budget?.window?.mode === "operator-required") {
        state.budget.window.mode = "normal";
        state.budget.window.exhaustedAt = null;
      }
      synchronizeBudgetUsage(state, allEvents, activeRunId, format === "claude"
        ? "claude-transcript" : `host-events:${format}`,
      replacesSource ? 0 : normalized.length);
      saveRuntime(state);
      reportBudget(id, state, true);
    }
    return normalized.length;
  }

  const syncClaudeTelemetry = syncClaudeTelemetryOperation.bind(null, {
    loadRuntime,
    claudeHostContext,
    bindClaudeSession,
    readJson,
    snapshotPath,
    collectClaudeSources,
    sourceKey,
    sourceReadOffset,
    readCompleteJsonLines,
    sourceCursor,
    belongsToThisProject,
    appendTelemetryRows,
    saveClaudeCursors,
    now,
    fail,
    basename,
    output: console
  });

  function prepareClaudeTelemetry(id, operationId) {
    const context = claudeHostContext();
    if (!context) return;
    const cursors = loadClaudeCursors(id);
    if (cursors.sessions[context.sessionId]) syncClaudeTelemetry(id, { quiet: true });
    bindClaudeSession(id, operationId);
  }

  const importTelemetry = importTelemetryOperation.bind(null, {
    parseFlags,
    fail,
    resolvePath: resolve,
    cwd: process.cwd,
    pathExists: existsSync,
    readFile: readFileSync,
    readJson,
    loadRuntime,
    snapshotPath,
    appendTelemetryRows,
    runtimeSessionId,
    output: console
  });

  const recordEvent = recordTelemetryEvent.bind(null, {
    root, logs, now, loadRuntime, readJson, snapshotPath, repositoryById,
    activeChangePath, taskBlocks, fail,
    readFile: readFileSync,
    append: appendFileSync,
    readJsonLines,
    synchronizeBudgetUsage,
    saveRuntime,
    reportBudget
  });

  return {
    appendTelemetryRows,
    bindClaudeSession,
    claudeHostContext,
    importTelemetry,
    modelUsageRecorded,
    telemetryReadiness,
    prepareClaudeTelemetry,
    recordContextMetric,
    recordEvent,
    recordPhaseContext,
    syncClaudeTelemetry
  };
}
