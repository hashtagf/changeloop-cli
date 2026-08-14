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
  rmSync,
  statSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  normalizeClaudeUserTransition,
  normalizeTelemetryRow,
  runtimeSessionId
} from "./telemetry.mjs";

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
        const rollup = readJson(rollupPath, {
          version: 1,
          changeId: id,
          count: 0,
          totalBytes: 0,
          byKind: {}
        });
        for (const entry of entries.slice(0, 500)) {
          const path = join(dir, entry);
          const row = readJson(path, {});
          if (row.kind && Number.isFinite(Number(row.bytes))) {
            rollup.count += 1;
            rollup.totalBytes += Number(row.bytes);
            const summary = rollup.byKind[row.kind] ||= {
              count: 0,
              totalBytes: 0,
              maxBytes: 0
            };
            summary.count += 1;
            summary.totalBytes += Number(row.bytes);
            summary.maxBytes = Math.max(summary.maxBytes, Number(row.bytes));
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

  // The session bound works; the project bound did not exist. A transcript is
  // resolved purely from the environment, so a sibling agent working in a
  // different repository — same host, same session id space — had its requests
  // and cache reads counted against this project's change, and reached the
  // user's cost numbers. Rows that name a working directory must name one
  // inside this project; rows that name none are kept, since dropping them
  // would silently under-report rather than mis-attribute.
  function belongsToThisProject(row) {
    const cwd = row?.cwd || row?.workingDirectory || row?.projectPath;
    if (typeof cwd !== "string" || !cwd) return true;
    const inside = relative(canonicalRoot(), canonicalPathOrSelf(cwd));
    return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
  }

  function canonicalPathOrSelf(path) {
    try { return realpathSync(path); } catch { return resolve(path); }
  }

  let canonicalRootCache = null;
  function canonicalRoot() {
    canonicalRootCache ||= canonicalPathOrSelf(root);
    return canonicalRootCache;
  }

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
      const recommendedTier = {
        change: "deep",
        build: "standard",
        prove: "fast",
        land: "fast"
      }[phase] || "standard";
      const contextMode = !sessionId ? "unavailable"
        : !prior?.sessionId ? "initial"
          : prior.sessionId === sessionId ? "retained" : "fresh";
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify({
        version: 1,
        changeId: id,
        phase,
        sessionId,
        contextMode,
        recommendedModelTier: recommendedTier,
        actualModel: process.env.FOUNDATION_MODEL_ID || null,
        trigger: process.env.FOUNDATION_PHASE_TRIGGER || null,
        priorPhase: prior?.phase || null,
        priorSessionId: prior?.sessionId || null,
        timestamp: now()
      })}\n`);
    } catch (error) {
      if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
        console.error(`WARNING: phase telemetry unavailable: ${error.message}`);
    }
  }

  function recordEvent(id, flags) {
    const state = loadRuntime(id);
    if (flags.repo) repositoryById(id, flags.repo, state);
    if (flags.task) {
      const taskId = String(flags.task).toUpperCase();
      const known = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
        .some((task) => task.id === taskId);
      if (!known) fail(`event references unknown task '${flags.task}'`);
      flags.task = taskId;
    }
    for (const field of ["input", "output", "cache", "cache-create", "cost", "duration"])
      if (flags[field] !== undefined && !Number.isFinite(Number(flags[field])))
        fail(`event --${field} must be numeric`);
    const snapshot = state.activeProofRun || readJson(snapshotPath(id), {});
    // `--cache` is the read. Without a separate write input, `cacheCreationTokens`
    // was hardcoded null and the budget derived cache-write as
    // `cacheTokens - cacheReadTokens` — structurally zero for every event
    // recorded through this path, so cache-write spend was unbillable.
    const cacheReadTokens = flags.cache === undefined ? null : Number(flags.cache);
    const cacheCreationTokens = flags["cache-create"] === undefined
      ? null : Number(flags["cache-create"]);
    const cacheTokens = [cacheReadTokens, cacheCreationTokens]
      .some((value) => value !== null)
      ? [cacheReadTokens, cacheCreationTokens]
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0)
      : null;
    const event = {
      version: 2,
      runId: flags.run || process.env.FOUNDATION_RUN_ID ||
        process.env.FOUNDATION_CLAUDE_SESSION_ID || id,
      operationId: flags.operation || "unknown",
      agentId: flags.agent || null,
      modelId: flags.model || null,
      requestId: flags.request || null,
      parentRequestId: flags.parent || null,
      timestamp: now(),
      inputTokens: flags.input === undefined ? null : Number(flags.input),
      outputTokens: flags.output === undefined ? null : Number(flags.output),
      cacheCreationTokens,
      cacheReadTokens,
      cacheTokens,
      cost: flags.cost === undefined ? null : Number(flags.cost),
      durationMs: flags.duration === undefined ? null : Number(flags.duration),
      tool: flags.tool || null,
      repositoryId: flags.repo || null,
      taskId: flags.task || null,
      workspaceHash: snapshot.workspaceHash || null,
      workspaceSnapshotId: snapshot.snapshotId || snapshot.id || null,
      changeId: id
    };
    if (!event.requestId) fail("event requires --request for unique telemetry identity");
    const path = join(logs, id, "events.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const duplicate = readFileSync(path, "utf8").split("\n").filter(Boolean).some((line) => {
        try {
          return JSON.parse(line).requestId === event.requestId;
        } catch {
          fail(`invalid telemetry ledger: ${relative(root, path)}`);
        }
      });
      if (duplicate) fail(`duplicate telemetry request '${event.requestId}'`);
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`);
    synchronizeBudgetUsage(state, readJsonLines(path), event.runId, "external-events", 1);
    saveRuntime(state);
    reportBudget(id, state);
  }

  function collectClaudeSources(transcriptPath) {
    const sources = [transcriptPath];
    const sessionArtifacts = join(dirname(transcriptPath),
      basename(transcriptPath).replace(/\.jsonl$/, ""), "subagents");
    function collect(path) {
      if (!existsSync(path)) return;
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) collect(child);
        else if (entry.isFile() && entry.name.endsWith(".jsonl"))
          sources.push(realpathSync(child));
      }
    }
    collect(sessionArtifacts);
    return [...new Set(sources)];
  }

  function loadClaudeCursors(id) {
    return readJson(telemetryCursorPath(id), { version: 1, sessions: {} });
  }

  function saveClaudeCursors(id, cursors) {
    writeJson(telemetryCursorPath(id), cursors);
  }

  function bindClaudeSession(id, operationId, options = {}) {
    const context = claudeHostContext(options.source || null);
    if (!context) return null;
    const cursors = loadClaudeCursors(id);
    let session = cursors.sessions[context.sessionId];
    if (!session) {
      session = {
        sessionId: context.sessionId,
        transcriptPath: context.transcriptPath,
        operationId: operationId || "unknown",
        boundAt: now(),
        sources: {}
      };
      for (const path of collectClaudeSources(context.transcriptPath)) {
        session.sources[sourceKey(path)] = {
          path,
          offset: options.fromStart ? 0 : statSync(path).size
        };
      }
      cursors.sessions[context.sessionId] = session;
    } else {
      session.transcriptPath = context.transcriptPath;
      if (operationId) session.operationId = operationId;
    }
    session.updatedAt = now();
    saveClaudeCursors(id, cursors);
    return { context, cursors, session };
  }

  function readCompleteJsonLines(path, offset) {
    const size = statSync(path).size;
    const start = offset >= 0 && offset <= size ? offset : 0;
    if (start === size) return { rows: [], nextOffset: start };
    const buffer = Buffer.alloc(size - start);
    const descriptor = openSync(path, "r");
    try {
      readSync(descriptor, buffer, 0, buffer.length, start);
    } finally {
      closeSync(descriptor);
    }
    const newline = buffer.lastIndexOf(10);
    if (newline < 0) return { rows: [], nextOffset: start };
    const text = buffer.subarray(0, newline + 1).toString("utf8");
    const rows = text.split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`invalid Claude transcript record in ${basename(path)} (${error.message})`);
      }
    });
    return { rows, nextOffset: start + newline + 1 };
  }

  function appendTelemetryRows(id, rows, format, context = {}) {
    const target = join(logs, id, "events.jsonl");
    const transitionTarget = join(logs, id, "user-transitions.jsonl");
    const known = new Set(readJsonLines(target).map((row) => row.requestId));
    const knownTransitions = new Set(readJsonLines(transitionTarget)
      .map((row) => row.transitionId));
    const normalized = [];
    const transitions = [];
    for (const row of rows) {
      if (format === "claude") {
        const transition = normalizeClaudeUserTransition(id, row, context, now());
        if (transition && !knownTransitions.has(transition.transitionId)) {
          knownTransitions.add(transition.transitionId);
          transitions.push(transition);
        }
      }
      const event = normalizeTelemetryRow(id, row, format, context, now());
      if (!event || known.has(event.requestId)) continue;
      known.add(event.requestId);
      normalized.push(event);
    }
    if (transitions.length) {
      mkdirSync(dirname(transitionTarget), { recursive: true });
      appendFileSync(transitionTarget,
        transitions.map((row) => JSON.stringify(row)).join("\n") + "\n");
    }
    if (normalized.length) {
      // Loading runtime state can normalize it, so it stays inside this branch:
      // an import that adds nothing must leave the change untouched.
      const state = loadRuntime(id);
      // A budget window represents one real run. Rows that carry a genuine run
      // or session identity may rotate it. Rows that fell back to the change id
      // carry no identity at all — attribute those to the run already active,
      // or every external import opens a window and discards the current one
      // along with its targets.
      const windowId = state.budget?.window?.id || null;
      if (windowId)
        for (const event of normalized)
          if (event.runId === id) event.runId = windowId;
      mkdirSync(dirname(target), { recursive: true });
      appendFileSync(target, normalized.map((row) => JSON.stringify(row)).join("\n") + "\n");
      const allEvents = readJsonLines(target);
      const activeRunId = normalized.at(-1)?.runId || context.sessionId || id;
      synchronizeBudgetUsage(state, allEvents, activeRunId, format === "claude"
        ? "claude-transcript" : `host-events:${format}`, normalized.length);
      saveRuntime(state);
      reportBudget(id, state, true);
    }
    return normalized.length;
  }

  function syncClaudeTelemetry(id, options = {}) {
    loadRuntime(id);
    const context = claudeHostContext(options.source || null);
    if (!context) {
      if (!options.quiet)
        console.log(`TELEMETRY ${id}: Claude transcript unavailable; imported 0`);
      return { imported: 0, scanned: 0 };
    }
    const { cursors, session } = bindClaudeSession(id, options.operationId || null, {
      source: options.source || null,
      fromStart: Boolean(options.source)
    });
    const snapshot = readJson(snapshotPath(id), {});
    let imported = 0;
    let scanned = 0;
    for (const path of collectClaudeSources(context.transcriptPath)) {
      const key = sourceKey(path);
      const source = session.sources[key] || { path, offset: 0 };
      const chunk = readCompleteJsonLines(path, Number(source.offset || 0));
      const isSubagent = path !== context.transcriptPath;
      const rows = chunk.rows.filter(belongsToThisProject);
      imported += appendTelemetryRows(id, rows, "claude", {
        sessionId: context.sessionId,
        operationId: session.operationId || "unknown",
        agentId: isSubagent
          ? basename(path).replace(/^agent-/, "").replace(/\.jsonl$/, "")
          : "orchestrator",
        sourcePath: path,
        snapshot
      });
      scanned += chunk.rows.length;
      session.sources[key] = { path, offset: chunk.nextOffset };
    }
    session.updatedAt = now();
    saveClaudeCursors(id, cursors);
    if (!options.quiet)
      console.log(`TELEMETRY ${id}: imported ${imported}; scanned ${scanned}; source claude-transcript`);
    return { imported, scanned };
  }

  function prepareClaudeTelemetry(id, operationId) {
    const context = claudeHostContext();
    if (!context) return;
    const cursors = loadClaudeCursors(id);
    if (cursors.sessions[context.sessionId]) syncClaudeTelemetry(id, { quiet: true });
    bindClaudeSession(id, operationId);
  }

  function importTelemetry(id, values) {
    const { flags, rest } = parseFlags(values);
    const source = rest[0];
    if (!source) fail("telemetry import requires a JSON or JSONL file");
    const format = flags.format || "generic";
    if (!["generic", "codex", "cursor", "otel", "claude"].includes(format))
      fail("telemetry --format must be generic|codex|cursor|otel|claude");
    const path = resolve(process.cwd(), source);
    if (!existsSync(path)) fail(`telemetry source not found: ${source}`);
    const text = readFileSync(path, "utf8").trim();
    let rows;
    try {
      const parsed = JSON.parse(text);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // A telemetry export is someone else's file, so a malformed line is an
      // expected input rather than an exceptional one. Parsing the JSONL
      // fallback with a bare `map` threw out of the command: the operator got a
      // Node stack trace with absolute runtime paths instead of a sentence, for
      // the ordinary case of a truncated or half-written export. Skipping is
      // already this command's vocabulary — it reports `imported N; skipped M` —
      // so unparseable lines join that count, and only a file with nothing
      // readable in it is an error.
      rows = [];
      let unparseable = 0;
      for (const line of text.split("\n").filter(Boolean)) {
        try { rows.push(JSON.parse(line)); }
        catch { unparseable += 1; }
      }
      if (!rows.length)
        fail(`telemetry source is neither JSON nor JSONL: ${source}`);
      if (unparseable)
        console.error(`WARNING: skipped ${unparseable} unparseable telemetry line(s) in ${source}`);
    }
    if (format === "claude" && !rows.some((row) =>
      row.type === "assistant" && row.message?.role === "assistant" && row.message?.usage))
      fail("Claude telemetry source has no assistant.message.usage records");
    const snapshot = readJson(snapshotPath(id), {});
    const imported = appendTelemetryRows(id, rows, format, {
      snapshot,
      sessionId: format === "codex" ? runtimeSessionId() : null
    });
    console.log(`TELEMETRY ${id}: imported ${imported}; skipped ${rows.length - imported}`);
  }

  return {
    appendTelemetryRows,
    bindClaudeSession,
    claudeHostContext,
    importTelemetry,
    prepareClaudeTelemetry,
    recordContextMetric,
    recordEvent,
    recordPhaseContext,
    syncClaudeTelemetry
  };
}
