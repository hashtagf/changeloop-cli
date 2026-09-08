import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { measuredNumber } from "../core/measured-number.mjs";
import { createModelDriftInspector } from "./host-execution-contract.mjs";
import { commandProfile, operationPhaseRows } from "./operation-profile.mjs";

export function runtimeSourceDigest(directory) {
  const digest = createHash("sha256");
  const visit = (absolute, relative = "") => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childAbsolute = join(absolute, entry.name);
      if (entry.isDirectory()) {
        digest.update(`directory\0${childRelative}\0`);
        visit(childAbsolute, childRelative);
      } else if (entry.isSymbolicLink()) {
        digest.update(`symlink\0${childRelative}\0${readlinkSync(childAbsolute)}\0`);
      } else if (entry.isFile()) {
        digest.update(`file\0${childRelative}\0`);
        digest.update(readFileSync(childAbsolute));
        digest.update("\0");
      }
    }
  };
  visit(directory);
  return `sha256:${digest.digest("hex")}`;
}

export function createSourceCohortProvider({
  runtimeVersion,
  protocolBundle,
  directory,
  scope = ".claude/harness",
  digest = runtimeSourceDigest
}) {
  let cached;
  return () => {
    if (cached) return cached;
    try {
      cached = Object.freeze({
        version: 1, runtimeVersion, protocolBundle,
        contentDigest: digest(directory), scope,
        basis: "sorted-relative-path-and-file-bytes",
        availability: "available", reason: null
      });
    } catch {
      cached = Object.freeze({
        version: 1, runtimeVersion, protocolBundle,
        contentDigest: null, scope,
        basis: "sorted-relative-path-and-file-bytes",
        availability: "unavailable", reason: "source-read-failed"
      });
    }
    return cached;
  };
}

export function evidenceObservationGroups(providers = {}) {
  const groups = new Map();
  for (const [provider, row] of Object.entries(providers)) {
    if (!row.commandExecutionId) continue;
    const current = groups.get(row.commandExecutionId) || [];
    current.push(provider);
    groups.set(row.commandExecutionId, current);
  }
  return [...groups].map(([commandExecutionId, names]) => ({
    commandExecutionId,
    providers: names.sort(),
    independent: names.length === 1
  })).sort((left, right) =>
    left.commandExecutionId.localeCompare(right.commandExecutionId));
}

export function lifecycleStageMetrics(operations = []) {
  const result = {};
  for (const span of operations.flatMap((row) => Array.isArray(row.stageSpans)
    ? row.stageSpans : [])) {
    if (!span?.stage || !Number.isFinite(Number(span.durationMs))) continue;
    const current = result[span.stage] ||= { calls: 0, durationMs: 0, failures: 0 };
    current.calls += 1;
    current.durationMs += Number(span.durationMs);
    if (span.status === "failed") current.failures += 1;
  }
  return result;
}

export function lifecycleSchedulerMetrics(operations = []) {
  const result = {};
  for (const event of operations.flatMap((row) => Array.isArray(row.schedulerEvents)
    ? row.schedulerEvents : [])) {
    if (!event?.scheduler) continue;
    const current = result[event.scheduler] ||= {
      waves: 0, readyNodes: 0, executedNodes: 0, reusedNodes: null,
      queueingMs: null, peakConcurrency: 0
    };
    current.waves += 1;
    for (const field of ["readyNodes", "executedNodes"])
      if (Number.isFinite(Number(event[field]))) current[field] += Number(event[field]);
    for (const field of ["reusedNodes", "queueingMs"])
      if (event[field] !== null && event[field] !== undefined &&
          Number.isFinite(Number(event[field])))
        current[field] = Number(current[field] || 0) + Number(event[field]);
    if (Number.isFinite(Number(event.peakConcurrency)))
      current.peakConcurrency = Math.max(current.peakConcurrency,
        Number(event.peakConcurrency));
  }
  return result;
}

export function eventUsageRecoveryActions(classification, correlatedHosts, changeId) {
  const recoveryActions = [];
  if (["correlation-missing", "partial-measurement"].includes(classification)) {
    if (correlatedHosts.includes("codex")) recoveryActions.push({
      type: "import-codex-events",
      command: `claude-foundation telemetry import ${changeId} <events.jsonl> --format codex`
    });
    if (correlatedHosts.includes("claude-code")) recoveryActions.push({
      type: "sync-claude-transcript",
      command: `claude-foundation telemetry sync ${changeId} [transcript.jsonl]`
    });
    if (correlatedHosts.includes("generic-host")) recoveryActions.push({
      type: "import-generic-events",
      command: `claude-foundation telemetry import ${changeId} <events.jsonl> --format generic`
    });
  }
  if (classification === "partial-measurement" &&
      correlatedHosts.includes("claude-code")) recoveryActions.push({
    type: "import-host-execution",
    command: `claude-foundation telemetry host-import ${changeId} <claude-result.json>`
  });
  if (classification === "source-unsupported") recoveryActions.push({
    type: "import-generic-events",
    command: `claude-foundation telemetry import ${changeId} <events.jsonl> --format generic`
  });
  return recoveryActions;
}

export function normalizedTelemetryHost(event = {}) {
  const source = String(event.source || "").toLowerCase();
  if (source === "codex") return "codex";
  if (source === "claude" || source === "claude-transcript") return "claude-code";
  if (["generic", "otel", "cursor"].includes(source)) return "generic-host";
  if (!["host-execution", "host-execution-contract"].includes(source)) return null;
  const host = String(event.agentId || event.host || "").toLowerCase();
  if (host.includes("codex")) return "codex";
  if (host.includes("claude")) return "claude-code";
  return host ? "generic-host" : null;
}

export function usageAvailability(events = [], phaseContextRows = [], changeId = "<change>") {
  if (events.length) {
    const correlatedHosts = [...new Set(events.map(normalizedTelemetryHost)
      .filter(Boolean))].sort();
    const usageFields = [
      "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens",
      "cacheTokens", "cost"
    ];
    const finite = (value) => measuredNumber(value) !== null;
    const observedValues = events.flatMap((event) => usageFields
      .map((field) => event[field]).filter(finite));
    const completeEvents = events.filter((event) =>
      finite(event.inputTokens) && finite(event.outputTokens));
    const allUsageZero = completeEvents.length === events.length &&
      completeEvents.every((event) =>
        measuredNumber(event.inputTokens) === 0 && measuredNumber(event.outputTokens) === 0 &&
        usageFields.filter((field) => !["inputTokens", "outputTokens"].includes(field))
          .filter((field) => finite(event[field]))
          .every((field) => measuredNumber(event[field]) === 0));
    const claudeCostMissing = correlatedHosts.includes("claude-code") &&
      !allUsageZero && !events.some((event) => finite(event.cost));
    const measuredDimensions = {
      tokens: completeEvents.length === events.length,
      cost: events.every((event) => finite(event.cost)),
      model: events.every((event) => Boolean(String(event.modelId || "").trim()))
    };
    const classification = !correlatedHosts.length ? "source-unsupported"
      : !observedValues.length ? "correlation-missing"
        : completeEvents.length !== events.length || claudeCostMissing ? "partial-measurement"
          : allUsageZero ? "no-usage"
            : "measured";
    const recoveryActions = eventUsageRecoveryActions(
      classification, correlatedHosts, changeId);
    return {
      status: "measured",
      classification,
      reason: classification === "measured" || classification === "no-usage"
        ? null : classification,
      correlatedHosts,
      measuredDimensions,
      recoveryActions
    };
  }
  const correlatedHosts = [...new Set(phaseContextRows
    .filter((row) => row.sessionId)
    .map((row) => row.telemetryHost || "unknown"))].sort();
  const recoveryActions = [];
  if (correlatedHosts.includes("codex")) recoveryActions.push({
    type: "import-codex-events",
    command: `claude-foundation telemetry import ${changeId} <events.jsonl> --format codex`
  });
  if (correlatedHosts.includes("claude-code")) recoveryActions.push({
    type: "sync-claude-transcript",
    command: `claude-foundation telemetry sync ${changeId} [transcript.jsonl]`
  });
  recoveryActions.push({
    type: "import-host-execution",
    command: `claude-foundation telemetry host-import ${changeId} <result.json>`
  });
  if (!correlatedHosts.includes("codex")) recoveryActions.push({
    type: "import-generic-events",
    command: `claude-foundation telemetry import ${changeId} <events.jsonl> --format generic`
  });
  return {
    status: "unavailable",
    classification: "not-ingested",
    reason: correlatedHosts.length
      ? "correlation-without-usage-events" : "host-telemetry-not-ingested",
    correlatedHosts,
    measuredDimensions: { tokens: false, cost: false, model: false },
    recoveryActions
  };
}

export function createMetricsRuntime({
  logs,
  receipts,
  readJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  ensureBudgetState,
  budgetDecision,
  calibrationForState = null,
  instructionManifests = null,
  activeChangePath = null,
  policy = null,
  taskBlocks = null,
  taskMetadata = null,
  metricsSchemaVersion = 6,
  sourceCohort = null,
  output = console.log
}) {
  // Absent join inputs report as unknown drift rather than suppressing the
  // section, so a partially wired install is visible instead of silent.
  const modelDrift = createModelDriftInspector({
    logs, instructionManifests, activeChangePath, policy, taskBlocks, taskMetadata
  });
  function contextMetricState(id) {
    const rows = readJsonLinesTolerant(join(logs, id, "context.jsonl"));
    const dir = join(logs, id, "context-events");
    if (existsSync(dir))
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const row = readJson(join(dir, entry.name), {});
        if (row.kind && measuredNumber(row.bytes) !== null) rows.push(row);
      }
    const rollup = readJson(join(logs, id, "context-rollup.json"), {
      count: 0, totalBytes: 0, byKind: {}
    });
    return { rows, rollup };
  }

  function sumKnown(rows, field) {
    const values = rows.map((row) => measuredNumber(row[field]))
      .filter((value) => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  function groupUsage(events, field) {
    const result = {};
    for (const event of events) {
      const key = event[field] || "unknown";
      result[key] ||= {
        requests: 0, inputTokens: null, outputTokens: null,
        cacheTokens: null, cost: null
      };
      const row = result[key];
      row.requests += 1;
      for (const metric of ["inputTokens", "outputTokens", "cacheTokens", "cost"]) {
        const value = measuredNumber(event[metric]);
        if (value !== null) row[metric] = Number(row[metric] || 0) + value;
      }
    }
    return result;
  }

  function contextSummary(contextRows, contextRollup) {
    const contextByKind = {};
    for (const row of contextRows) {
      const bytes = measuredNumber(row.bytes);
      if (!row.kind || bytes === null) continue;
      contextByKind[row.kind] ||= [];
      contextByKind[row.kind].push(bytes);
    }
    const context = Object.fromEntries(Object.entries(contextByKind)
      .map(([kind, values]) => {
        const sorted = [...values].sort((left, right) => left - right);
        const percentile = (ratio) => sorted[Math.min(
          sorted.length - 1, Math.floor((sorted.length - 1) * ratio)
        )] || 0;
        return [kind, {
          count: values.length,
          totalBytes: values.reduce((sum, value) => sum + value, 0),
          medianBytes: percentile(0.5),
          p95Bytes: percentile(0.95),
          maxBytes: sorted.at(-1) || 0
        }];
      }));
    for (const [kind, archived] of Object.entries(contextRollup.byKind || {})) {
      const archivedCount = measuredNumber(archived.count);
      const archivedTotalBytes = measuredNumber(archived.totalBytes);
      const archivedMaxBytes = measuredNumber(archived.maxBytes);
      // A rollup row is one aggregate measurement. If any component is junk,
      // skip the row instead of mixing a trustworthy count with invented bytes.
      if ([archivedCount, archivedTotalBytes, archivedMaxBytes]
        .some((value) => value === null)) continue;
      const summary = context[kind] ||= {
        count: 0, totalBytes: 0, medianBytes: null, p95Bytes: null, maxBytes: 0
      };
      summary.count += archivedCount;
      summary.totalBytes += archivedTotalBytes;
      summary.maxBytes = Math.max(summary.maxBytes || 0, archivedMaxBytes);
      summary.archivedCount = archivedCount;
    }
    return context;
  }

  function phaseEntry(phases, name) {
    return (phases[name] ||= {
      operations: 0, durationMs: 0, failed: 0, blocked: 0, requests: 0,
      inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
      spendTokens: null,
      contextMode: null, contextCarryInTokens: null, contextCarryCostTokens: null,
      loggedContextMode: undefined
    });
  }

  function addOperationPhases(phases, operations) {
    for (const operation of operations) {
      const seen = new Set();
      for (const span of operationPhaseRows(operation)) {
        const name = span.phase || operation.operation || "unknown";
        const phase = phaseEntry(phases, name);
        if (!seen.has(name)) phase.operations += 1;
        seen.add(name);
        phase.durationMs += Number(span.durationMs || 0);
        if (span.status === "blocked") phase.blocked += 1;
        else if (span.status !== "completed") phase.failed += 1;
      }
    }
  }

  function addEventUsage(phase, event) {
    for (const field of
      ["inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens"]) {
      const value = measuredNumber(event[field]);
      if (value !== null) phase[field] = Number(phase[field] || 0) + value;
    }
    const cacheTotal = measuredNumber(event.cacheTokens);
    const cacheRead = measuredNumber(event.cacheReadTokens);
    const derivedCacheWrite = cacheTotal !== null && cacheRead !== null
      ? measuredNumber(cacheTotal - cacheRead) : null;
    const cacheWrite = measuredNumber(event.cacheCreationTokens) ?? derivedCacheWrite;
    if (cacheWrite !== null)
      phase.cacheWriteTokens = Number(phase.cacheWriteTokens || 0) + cacheWrite;
    const carryIn = measuredNumber(event.cacheReadTokens);
    if (phase.contextCarryInTokens === null && carryIn !== null)
      phase.contextCarryInTokens = carryIn;
  }

  function addEventPhases(phases, events) {
    const phaseFirstEvent = new Map();
    for (const event of events) {
      const name = event.operationId || "unknown";
      const phase = phaseEntry(phases, name);
      phase.requests += 1;
      addEventUsage(phase, event);
      if (!phaseFirstEvent.has(name))
        phaseFirstEvent.set(name, { at: Date.parse(event.timestamp), session: event.sessionId });
    }
    return phaseFirstEvent;
  }

  function addLoggedContextModes(phases, phaseContextRows) {
    for (const row of phaseContextRows)
      if (row.phase && phases[row.phase] && phases[row.phase].loggedContextMode === undefined)
        phases[row.phase].loggedContextMode = row.contextMode || "unknown";
  }

  function classifyPhaseContext(phases, phaseFirstEvent) {
    const seenSessions = new Set();
    for (const [name, entry] of [...phaseFirstEvent.entries()]
      .sort((left, right) => (left[1].at || 0) - (right[1].at || 0))) {
      const retained = Boolean(entry.session) && seenSessions.has(entry.session);
      if (entry.session) seenSessions.add(entry.session);
      phases[name].contextMode = retained ? "retained" : "initial";
    }
  }

  function finalizePhaseMetrics(phases) {
    for (const phase of Object.values(phases)) {
      phase.contextCarryCostTokens = phase.contextCarryInTokens === null
        ? null : phase.contextCarryInTokens * phase.requests;
      const spend = [phase.inputTokens, phase.outputTokens, phase.cacheWriteTokens]
        .filter((value) => measuredNumber(value) !== null);
      phase.spendTokens = spend.length
        ? spend.reduce((sum, value) => sum + Number(value), 0) : null;
    }
    return Object.values(phases)
      .filter((phase) => phase.contextMode === "retained")
      .map((phase) => phase.contextCarryCostTokens)
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
  }

  function phaseMetrics(operations, events, phaseContextRows) {
    const phases = {};
    addOperationPhases(phases, operations);
    const phaseFirstEvent = addEventPhases(phases, events);
    addLoggedContextModes(phases, phaseContextRows);
    classifyPhaseContext(phases, phaseFirstEvent);
    const retainedCarryTokens = finalizePhaseMetrics(phases);
    return { phases, retainedCarryTokens };
  }

  function providerMetrics(id) {
    const providers = {};
    const executions = new Map();
    const receiptDir = join(receipts, id);
    if (existsSync(receiptDir))
      for (const entry of readdirSync(receiptDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "proof.json")
          continue;
        const receipt = readJson(join(receiptDir, entry.name));
        providers[receipt.provider || entry.name.replace(/\.json$/, "")] = {
          status: receipt.status,
          adapter: receipt.adapter || "external",
          durationMs: receipt.durationMs ?? null,
          proofRunId: receipt.proofRunId || null,
          commandExecutionId: receipt.commandExecutionId || receipt.executionId || null
        };
        const commandExecutionId = receipt.commandExecutionId || receipt.executionId;
        const durationMs = measuredNumber(receipt.durationMs);
        if (commandExecutionId && durationMs !== null)
          executions.set(commandExecutionId,
            Math.max(executions.get(commandExecutionId) || 0, durationMs));
      }
    return { providers, executions };
  }

  function usageTotals(events) {
    const tokenFields = ["inputTokens", "outputTokens", "cacheTokens"];
    const tokenTotal = tokenFields.map((field) => sumKnown(events, field))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const orchestratorEvents = events.filter((event) =>
      event.agentId === "orchestrator" || event.operationId === "orchestrator");
    const orchestratorTokens = tokenFields
      .map((field) => sumKnown(orchestratorEvents, field))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    return {
      tokenTotal, orchestratorEvents, orchestratorTokens,
      totalCost: sumKnown(events, "cost"),
      orchestratorCost: sumKnown(orchestratorEvents, "cost")
    };
  }

  function aggregateContextMetrics(contextRows, contextRollup) {
    const context = contextSummary(contextRows, contextRollup);
    const currentContextValues = contextRows.map((row) => measuredNumber(row.bytes))
      .filter((value) => value !== null);
    const currentContextBytes = currentContextValues.reduce((sum, value) => sum + value, 0);
    const archivedContextCount = measuredNumber(contextRollup.count);
    const archivedContextBytes = measuredNumber(contextRollup.totalBytes);
    const hasArchivedContext = archivedContextCount !== null && archivedContextCount > 0;
    const contextBytes = hasArchivedContext && archivedContextBytes === null
      ? null
      : currentContextValues.length || hasArchivedContext
        ? currentContextBytes + (archivedContextBytes || 0) : null;
    return { context, currentContextValues, archivedContextCount, contextBytes };
  }

  function activeTimingMetrics(operations, executions) {
    const externalRows = operations.filter((row) => row.operation === "exec");
    const harnessRows = operations.filter((row) => row.operation !== "exec");
    const operationActiveTimeMs = harnessRows.length
      ? harnessRows.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) : null;
    const externalExecutionTimeMs = externalRows.length
      ? externalRows.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) : null;
    const evidenceExecutionTimeMs = executions.size
      ? [...executions.values()].reduce((sum, value) => sum + value, 0) : null;
    const activeTimeMs = operationActiveTimeMs === null
      ? evidenceExecutionTimeMs
      : evidenceExecutionTimeMs === null
        ? operationActiveTimeMs
        : Math.max(operationActiveTimeMs, evidenceExecutionTimeMs);
    const wallTimeMs = operations.length
      ? Math.max(...operations.map((row) => Date.parse(row.finishedAt))) -
        Math.min(...operations.map((row) => Date.parse(row.startedAt))) : null;
    return { wallTimeMs, activeTimeMs, externalExecutionTimeMs, evidenceExecutionTimeMs };
  }

  function authorityWaitSpans(operations) {
    const spans = [];
    for (let index = 0; index < operations.length; index += 1) {
      if (operations[index].operation !== "authority-request") continue;
      const answered = operations.slice(index + 1)
        .find((row) => row.operation === "authority-record");
      if (!answered) continue;
      const from = Date.parse(operations[index].finishedAt);
      const to = Date.parse(answered.startedAt);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from)
        spans.push({
          from: operations[index].finishedAt, to: answered.startedAt,
          ms: to - from, sources: ["authority"]
        });
    }
    return spans;
  }

  function transcriptWaitSpans(events, userTransitions) {
    const spans = [];
    for (const transition of userTransitions) {
      // v1 transitions did not distinguish real user input from Claude tool
      // results, so they cannot support a truthful human-wait measurement.
      if (transition.kind !== "human-message") continue;
      const to = Date.parse(transition.timestamp);
      const preceding = events
        .filter((event) => event.agentId === "orchestrator" &&
          event.sessionId && event.sessionId === transition.sessionId &&
          Number.isFinite(Date.parse(event.timestamp)) && Date.parse(event.timestamp) < to)
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
      if (!preceding || !Number.isFinite(to)) continue;
      const from = Date.parse(preceding.timestamp);
      spans.push({
        from: preceding.timestamp, to: transition.timestamp,
        ms: to - from, sources: ["transcript"]
      });
    }
    return spans;
  }

  function mergeWaitSpans(spans) {
    return spans.sort((left, right) => Date.parse(left.from) - Date.parse(right.from))
      .reduce((merged, span) => {
        const previous = merged.at(-1);
        const spanFrom = Date.parse(span.from);
        const spanTo = Date.parse(span.to);
        if (!previous || spanFrom > Date.parse(previous.to)) {
          merged.push({ ...span });
          return merged;
        }
        if (spanTo > Date.parse(previous.to)) previous.to = span.to;
        previous.ms = Date.parse(previous.to) - Date.parse(previous.from);
        previous.sources = [...new Set([...previous.sources, ...span.sources])];
        return merged;
      }, []);
  }

  function timingMetrics(operations, events, userTransitions, executions) {
    const active = activeTimingMetrics(operations, executions);
    const humanWaitSpans = mergeWaitSpans([
      ...authorityWaitSpans(operations), ...transcriptWaitSpans(events, userTransitions)
    ]);
    const humanWaitMs = humanWaitSpans.length
      ? humanWaitSpans.reduce((sum, span) => sum + span.ms, 0) : null;
    return { ...active, humanWaitSpans, humanWaitMs };
  }

  function metricsValue(id) {
    const state = loadRuntime(id);
    const budget = ensureBudgetState(state);
    const operations = readJsonLines(join(logs, id, "operations.jsonl"));
    const inspections = readJsonLines(join(logs, id, "inspections.jsonl"));
    const events = readJsonLines(join(logs, id, "events.jsonl"));
    const userTransitions = readJsonLines(join(logs, id, "user-transitions.jsonl"));
    const { rows: contextRows, rollup: contextRollup } = contextMetricState(id);
    const phaseContextRows = readJsonLines(join(logs, id, "phase-context.jsonl"));
    const reuseRows = readJsonLines(join(logs, id, "reuse.jsonl"));
    const { phases, retainedCarryTokens } = phaseMetrics(
      operations, events, phaseContextRows);
    const { providers, executions } = providerMetrics(id);
    const {
      tokenTotal, orchestratorTokens, totalCost, orchestratorCost
    } = usageTotals(events);
    const {
      context, currentContextValues, archivedContextCount, contextBytes
    } = aggregateContextMetrics(contextRows, contextRollup);
    const {
      wallTimeMs, activeTimeMs, externalExecutionTimeMs, evidenceExecutionTimeMs,
      humanWaitSpans, humanWaitMs
    } = timingMetrics(operations, events, userTransitions, executions);
    const contextModes = {};
    for (const row of phaseContextRows)
      contextModes[row.contextMode || "unknown"] =
        Number(contextModes[row.contextMode || "unknown"] || 0) + 1;
    const hostAttemptEvents = events.filter((event) => event.attempt !== null && event.attempt !== undefined);
    const byAttemptStatus = hostAttemptEvents.reduce((result, event) => {
      const status = event.attemptStatus || "unknown";
      result[status] = Number(result[status] || 0) + 1;
      return result;
    }, {});
    const producingSourceCohort = typeof sourceCohort === "function"
      ? sourceCohort() : sourceCohort;
    const value = {
      version: metricsSchemaVersion, changeId: id,
      sourceCohort: producingSourceCohort,
      wallTimeMs,
      activeTimeMs,
      unattributedWaitMs: wallTimeMs === null || activeTimeMs === null
        ? null : Math.max(0, wallTimeMs - activeTimeMs),
      humanWaitMs,
      humanWaitSpans,
      humanWaitBasis: "authority-request to authority-record intervals, plus " +
        "orchestrator-answer to next verified human-message intervals from the host " +
        "transcript; overlapping spans are merged, so this is elapsed wait " +
        "rather than the sum of observations. Waits in a session whose " +
        "transcript was never ingested remain inside unattributedWaitMs",
      phases, providers,
      stages: lifecycleStageMetrics(operations),
      schedulers: lifecycleSchedulerMetrics(operations),
      evidenceObservationGroups: evidenceObservationGroups(providers),
      evidenceExecutionTimeMs,
      externalExecutionTimeMs,
      // No host events means no request observation. Lifecycle operations are
      // known, but they cannot establish how many model requests occurred.
      requests: events.length ? events.length : null,
      usageMeasurement: events.length ? "host-events" : "unavailable",
      usageAvailability: usageAvailability(events, phaseContextRows, id),
      inputTokens: sumKnown(events, "inputTokens"),
      outputTokens: sumKnown(events, "outputTokens"),
      cacheCreationTokens: sumKnown(events, "cacheCreationTokens"),
      cacheReadTokens: sumKnown(events, "cacheReadTokens"),
      cacheTokens: sumKnown(events, "cacheTokens"),
      cost: totalCost,
      byModel: groupUsage(events, "modelId"),
      byRepository: groupUsage(events, "repositoryId"),
      byTask: groupUsage(events, "taskId"),
      hostExecution: {
        attempts: hostAttemptEvents.length,
        fallbacks: hostAttemptEvents.filter((event) => event.fallbackReason).length,
        byAttemptStatus,
        instructionManifestDigests: [...new Set(events
          .map((event) => event.instructionManifestDigest).filter(Boolean))].sort()
      },
      modelDrift: modelDrift.changeDrift(id),
      budget: {
        lifetime: budget.lifetime,
        window: budget.window,
        decision: budgetDecision(state),
        calibration: calibrationForState ? calibrationForState(state) : null
      },
      context: {
        totalBytes: contextBytes,
        estimatedTokens: contextBytes === null ? null : Math.ceil(contextBytes / 4),
        measurement: "emitted-plan-and-packet-bytes-only",
        estimateBasis: "four-bytes-per-token",
        excluded: [
          "always-on-rules", "loaded-skills", "artifact-reads",
          "tool-results", "conversation-history"
        ],
        byKind: context,
        retainedEvents: currentContextValues.length,
        archivedEvents: archivedContextCount,
        phaseTransitions: phaseContextRows,
        modes: contextModes,
        carryover: {
          retainedPhaseTokens: retainedCarryTokens,
          measurement: "first-request-cache-read-per-phase",
          estimateBasis: "carry-in-tokens-times-phase-requests",
          note: "tokens spent re-reading context inherited across a phase boundary that did not reset"
        }
      },
      evidenceReuse: {
        count: reuseRows.length,
        byReason: reuseRows.reduce((result, row) => {
          const reason = row.reason || "unknown";
          result[reason] = Number(result[reason] || 0) + 1;
          return result;
        }, {}),
        recent: reuseRows.slice(-20).map((row) => ({
          timestamp: row.timestamp || null,
          provider: row.provider || null,
          reason: row.reason || "unknown",
          fromWorkspaceHash: row.fromWorkspaceHash || null,
          toWorkspaceHash: row.toWorkspaceHash || null,
          inputFingerprint: row.inputFingerprint || null
        }))
      },
      rework: {
        expectedStops: operations.filter((row) => row.status === "blocked").length,
        unexpectedFailures: operations.filter((row) => row.status === "failed").length,
        failedOperations: operations.filter((row) => row.status === "failed").length,
        providerRebindings: reuseRows.length
      },
      commandProfile: commandProfile(operations, inspections),
      orchestratorTokenShare: tokenTotal > 0 ? orchestratorTokens / tokenTotal : null,
      orchestratorCostShare: totalCost > 0 && orchestratorCost !== null
        ? orchestratorCost / totalCost : null,
      measurement: events.length
        ? (operations.length ? "operations-and-host-events" : "host-events-only")
        : (operations.length ? "operations-only" : "receipts-only")
    };
    return value;
  }

  function showMetrics(id) {
    const value = metricsValue(id);
    output(JSON.stringify(value, null, 2));
    return value;
  }

  return { metricsValue, showMetrics };
}
