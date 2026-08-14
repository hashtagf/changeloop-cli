import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createModelDriftInspector } from "./host-execution-contract.mjs";

export function createMetricsRuntime({
  logs,
  receipts,
  readJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  ensureBudgetState,
  budgetDecision,
  instructionManifests = null,
  activeChangePath = null,
  policy = null,
  taskBlocks = null,
  taskMetadata = null,
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
        if (row.kind && Number.isFinite(Number(row.bytes))) rows.push(row);
      }
    const rollup = readJson(join(logs, id, "context-rollup.json"), {
      count: 0, totalBytes: 0, byKind: {}
    });
    return { rows, rollup };
  }

  function sumKnown(rows, field) {
    const values = rows.map((row) => row[field]).filter((value) =>
      value !== null && value !== undefined && Number.isFinite(Number(value)));
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
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
      for (const metric of ["inputTokens", "outputTokens", "cacheTokens", "cost"])
        if (event[metric] !== null && event[metric] !== undefined &&
            Number.isFinite(Number(event[metric])))
          row[metric] = Number(row[metric] || 0) + Number(event[metric]);
    }
    return result;
  }

  function contextSummary(contextRows, contextRollup) {
    const contextByKind = {};
    for (const row of contextRows) {
      contextByKind[row.kind] ||= [];
      contextByKind[row.kind].push(Number(row.bytes || 0));
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
      const summary = context[kind] ||= {
        count: 0, totalBytes: 0, medianBytes: null, p95Bytes: null, maxBytes: 0
      };
      summary.count += Number(archived.count || 0);
      summary.totalBytes += Number(archived.totalBytes || 0);
      summary.maxBytes = Math.max(summary.maxBytes || 0, Number(archived.maxBytes || 0));
      summary.archivedCount = Number(archived.count || 0);
    }
    return context;
  }

  function showMetrics(id) {
    const state = loadRuntime(id);
    const budget = ensureBudgetState(state);
    const operations = readJsonLines(join(logs, id, "operations.jsonl"));
    const events = readJsonLines(join(logs, id, "events.jsonl"));
    const userTransitions = readJsonLines(join(logs, id, "user-transitions.jsonl"));
    const { rows: contextRows, rollup: contextRollup } = contextMetricState(id);
    const phaseContextRows = readJsonLines(join(logs, id, "phase-context.jsonl"));
    const reuseRows = readJsonLines(join(logs, id, "reuse.jsonl"));
    const phases = {};
    const phaseEntry = (name) => (phases[name] ||= {
      operations: 0, durationMs: 0, failed: 0, blocked: 0, requests: 0,
      inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, spendTokens: null,
      contextMode: null, contextCarryInTokens: null, contextCarryCostTokens: null,
      loggedContextMode: undefined
    });
    for (const operation of operations) {
      // `operation.phase` is now written for every lifecycle command, whether
      // the call arrived through the public CLI wrapper or straight into the
      // runtime, so the fallback only catches rows from an older revision.
      const name = operation.phase || operation.operation || "unknown";
      const phase = phaseEntry(name);
      phase.operations += 1;
      phase.durationMs += Number(operation.durationMs || 0);
      // A typed stop and a failure have to read differently — the same
      // distinction `rework` draws below, and the one `model-drift` documents.
      // Collapsing them here reported six blocked lifecycle stops as six
      // failures on a change that had none.
      if (operation.status === "blocked") phase.blocked += 1;
      else if (operation.status !== "completed") phase.failed += 1;
    }
    const phaseFirstEvent = new Map();
    for (const event of events) {
      const name = event.operationId || "unknown";
      const phase = phaseEntry(name);
      phase.requests += 1;
      for (const field of
        ["inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens"])
        if (event[field] !== null && event[field] !== undefined &&
            Number.isFinite(Number(event[field])))
          phase[field] = Number(phase[field] || 0) + Number(event[field]);
      // `Number(null)` is 0 and 0 is finite, so an unknown cache read latched
      // this to a measured zero — and the `=== null` guard then stopped any
      // real value from ever correcting it.
      if (phase.contextCarryInTokens === null &&
          event.cacheReadTokens !== null && event.cacheReadTokens !== undefined &&
          Number.isFinite(Number(event.cacheReadTokens)))
        phase.contextCarryInTokens = Number(event.cacheReadTokens);
      if (!phaseFirstEvent.has(name))
        phaseFirstEvent.set(name, { at: Date.parse(event.timestamp), session: event.sessionId });
    }
    for (const row of phaseContextRows)
      if (row.phase && phases[row.phase] && phases[row.phase].loggedContextMode === undefined)
        phases[row.phase].loggedContextMode = row.contextMode || "unknown";
    const seenSessions = new Set();
    for (const [name, entry] of [...phaseFirstEvent.entries()]
      .sort((left, right) => (left[1].at || 0) - (right[1].at || 0))) {
      const retained = Boolean(entry.session) && seenSessions.has(entry.session);
      if (entry.session) seenSessions.add(entry.session);
      phases[name].contextMode = retained ? "retained" : "initial";
    }
    for (const phase of Object.values(phases)) {
      phase.contextCarryCostTokens = phase.contextCarryInTokens === null
        ? null : phase.contextCarryInTokens * phase.requests;
      // The budget measures spend as input + output + cache-write and excludes
      // cache reads. Without that sum per phase the numbers here could not be
      // compared against the budget window at all, which is why "what did build
      // cost against prove" had no answer.
      const spend = [phase.inputTokens, phase.outputTokens, phase.cacheCreationTokens]
        .filter((value) => value !== null && Number.isFinite(Number(value)));
      phase.spendTokens = spend.length
        ? spend.reduce((sum, value) => sum + Number(value), 0) : null;
    }
    const retainedCarryTokens = Object.values(phases)
      .filter((phase) => phase.contextMode === "retained")
      .map((phase) => phase.contextCarryCostTokens)
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
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
        if (commandExecutionId && Number.isFinite(Number(receipt.durationMs)))
          executions.set(commandExecutionId,
            Math.max(executions.get(commandExecutionId) || 0, Number(receipt.durationMs)));
      }
    const tokenTotal = ["inputTokens", "outputTokens", "cacheTokens"]
      .map((field) => sumKnown(events, field))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const orchestratorEvents = events.filter((event) =>
      event.agentId === "orchestrator" || event.operationId === "orchestrator");
    const orchestratorTokens = ["inputTokens", "outputTokens", "cacheTokens"]
      .map((field) => sumKnown(orchestratorEvents, field))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const totalCost = sumKnown(events, "cost");
    const orchestratorCost = sumKnown(orchestratorEvents, "cost");
    const context = contextSummary(contextRows, contextRollup);
    const currentContextBytes = contextRows.reduce(
      (sum, row) => sum + Number(row.bytes || 0), 0);
    const contextBytes = contextRows.length || Number(contextRollup.count || 0)
      ? currentContextBytes + Number(contextRollup.totalBytes || 0) : null;
    // `exec` rows time an external command (a build, an install), not a
    // harness operation, so they get their own bucket instead of inflating
    // operation time. They still count toward wall time below.
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
    // `authority-request` and `authority-record` are separate timestamped
    // operations bracketing a decision only a person can make. That is the
    // host/user transition signal this report used to declare missing — it was
    // on disk the whole time, just never read. Each request pairs with the next
    // record after it, so a request nobody answered contributes nothing rather
    // than swallowing the remainder of the run.
    const candidateHumanWaitSpans = [];
    for (let index = 0; index < operations.length; index += 1) {
      if (operations[index].operation !== "authority-request") continue;
      const answered = operations.slice(index + 1)
        .find((row) => row.operation === "authority-record");
      if (!answered) continue;
      const from = Date.parse(operations[index].finishedAt);
      const to = Date.parse(answered.startedAt);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from)
        candidateHumanWaitSpans.push({
          from: operations[index].finishedAt, to: answered.startedAt,
          ms: to - from, sources: ["authority"]
        });
    }
    // The transcript already contains the other explicit host/user transition:
    // an orchestrator answer followed by the user's next message. Only the
    // timestamp-only projection is retained; prompt content never reaches the
    // logs. Subagent answers are excluded because they do not hand control to
    // the user.
    for (const transition of userTransitions) {
      const to = Date.parse(transition.timestamp);
      const preceding = events
        .filter((event) => event.agentId === "orchestrator" &&
          event.sessionId && event.sessionId === transition.sessionId &&
          Number.isFinite(Date.parse(event.timestamp)) && Date.parse(event.timestamp) < to)
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
      if (!preceding || !Number.isFinite(to)) continue;
      const from = Date.parse(preceding.timestamp);
      candidateHumanWaitSpans.push({
        from: preceding.timestamp, to: transition.timestamp,
        ms: to - from, sources: ["transcript"]
      });
    }
    // Multiple authority requests can wait concurrently, and an authority wait
    // may cover the same interval as a transcript handoff. Report elapsed human
    // wait, not the sum of overlapping observations of that wait.
    const humanWaitSpans = candidateHumanWaitSpans
      .sort((left, right) => Date.parse(left.from) - Date.parse(right.from))
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
    const humanWaitMs = humanWaitSpans.length
      ? humanWaitSpans.reduce((sum, span) => sum + span.ms, 0) : null;
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
    output(JSON.stringify({
      version: 5, changeId: id,
      wallTimeMs,
      activeTimeMs,
      unattributedWaitMs: wallTimeMs === null || activeTimeMs === null
        ? null : Math.max(0, wallTimeMs - activeTimeMs),
      humanWaitMs,
      humanWaitSpans,
      humanWaitBasis: "authority-request to authority-record intervals, plus " +
        "orchestrator-answer to next-user-message intervals from the host " +
        "transcript; overlapping spans are merged, so this is elapsed wait " +
        "rather than the sum of observations. Waits in a session whose " +
        "transcript was never ingested remain inside unattributedWaitMs",
      phases, providers,
      evidenceExecutionTimeMs,
      externalExecutionTimeMs,
      // No host events means no request observation. Lifecycle operations are
      // known, but they cannot establish how many model requests occurred.
      requests: events.length ? events.length : null,
      usageMeasurement: events.length ? "host-events" : "unavailable",
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
        decision: budgetDecision(state)
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
        retainedEvents: contextRows.length,
        archivedEvents: Number(contextRollup.count || 0),
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
        }, {})
      },
      rework: {
        expectedStops: operations.filter((row) => row.status === "blocked").length,
        unexpectedFailures: operations.filter((row) => row.status === "failed").length,
        failedOperations: operations.filter((row) => row.status === "failed").length,
        providerRebindings: reuseRows.length
      },
      orchestratorTokenShare: tokenTotal > 0 ? orchestratorTokens / tokenTotal : null,
      orchestratorCostShare: totalCost > 0 && orchestratorCost !== null
        ? orchestratorCost / totalCost : null,
      measurement: events.length
        ? (operations.length ? "operations-and-host-events" : "host-events-only")
        : (operations.length ? "operations-only" : "receipts-only")
    }, null, 2));
  }

  return { showMetrics };
}
