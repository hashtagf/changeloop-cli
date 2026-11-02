import { acquireProcessLock } from "../core/process-lock.mjs";
import {
  effectiveReviewAttemptLimit, reviewClosureWaveAvailable
} from "../core/authority-policy.mjs";
import {
  compareGateProgress,
  gateProgressValue,
  gateRepairPlan,
  noProgressDecision,
  noProgressRepair
} from "../core/convergent-gate.mjs";
import { createServiceSessions } from "./proof-execution/service-sessions.mjs";
import { derivedReviewRepairGraph } from "./repair-runtime.mjs";
import { blockedOutcomeStop } from "../core/blocked-decision.mjs";
import { authorityRunCommand, authorityStatusCommand } from "../core/authority-run-command.mjs";

export function requestSummary(id, request) {
  if (!request) return null;
  const requestId = request.requestId || null;
  return {
    requestId,
    type: request.type || null,
    provider: request.provider || null,
    status: request.status || null,
    workspaceHash: request.workspaceHash || null,
    expiresAt: request.expiresAt || null,
    packetDigest: request.packetDigest || null,
    attemptDigest: request.dispatch?.attemptDigest || null,
    scopeMode: request.dispatch?.scope?.mode || null,
    packetCommand: requestId
      ? `claude-foundation authority status ${id} --request ${requestId}` : null,
    statusCommand: requestId
      ? `claude-foundation authority status ${id} --request ${requestId} --template` : null
  };
}

export function prepareProofExecution(context, id, options = {}) {
  if (options.preflight !== false) context.proofPreflight(id, "prove", true);
  const pending = context.pendingTasks(id);
  if (pending.length)
    context.die(`${pending.length} implementation task(s) remain unchecked`);
  const snapshot = options.snapshot || context.relevantSnapshot(id, null, true);
  const state = context.loadRuntime(id);
  const proofRunId = `proof-${Date.now()}`;
  state.activeProofRun = {
    id: proofRunId,
    snapshotId: snapshot.id,
    workspaceHash: snapshot.workspaceHash,
    startedAt: context.now()
  };
  context.saveRuntime(state);
  for (const provider of context.requiredProviders(id)) {
    const row = context.receiptValidity(id, provider, snapshot.workspaceHash);
    if (row.validity === "reusable-inputs")
      context.rebindReusableReceipt(id, row, snapshot, proofRunId);
    else if (row.validity === "reusable-diff")
      context.rebindDiffBoundReceipt(id, row, snapshot, proofRunId);
  }
  return { snapshot, proofRunId };
}

export function executionAvailabilityError(execution, id) {
  if (execution.unconfigured.length)
    return `missing executable adapter for provider(s): ${execution.unconfigured.join(", ")}; record external receipts or configure evidence v2`;
  if (execution.unavailable.length)
    return `provider environment unavailable: ${execution.unavailable.join(", ")}; run doctor --stage prove --change ${id}`;
  return null;
}

export function assertExecutionAvailable(execution, id) {
  const error = executionAvailabilityError(execution, id);
  if (error) throw new Error(error);
}

export function proofExecutionAdvanceValue(id, options, snapshot, proofRunId, nodes, audit) {
  if (options.manageReservation === false || !nodes.length) return null;
  return {
    version: 1,
    changeId: id,
    command: options.command || "proof execute",
    status: audit.valid ? "PASS" : "ACTION_REQUIRED",
    stage: audit.valid ? "complete" : "proof-invalid",
    completed: audit.valid,
    proofRunId,
    workspaceHash: snapshot.workspaceHash,
    providers: audit.valid ? (audit.proof.providers || []) : [],
    requests: [],
    executedProviders: nodes.map((node) => node.provider),
    next: audit.valid ? [{
      kind: "land",
      command: `claude-foundation advance ${id} --through archived`
    }] : []
  };
}

export async function runProofExecutionNodes(context, id, nodes, proofRunId, options) {
  if (nodes.length)
    await context.runExecutionDag(id, nodes, proofRunId, { quiet: options.quiet });
  else if (!options.quiet)
    context.log(`EXECUTION ${proofRunId}: all receipts reused`);
}

export function writeProofExecutionAdvance(
  context, id, options, snapshot, proofRunId, nodes, audit
) {
  const advance = proofExecutionAdvanceValue(
    id, options, snapshot, proofRunId, nodes, audit);
  if (advance) context.writeAdvance(id, advance);
}

// Identifies one gate pass's cursor. Every pass bumps `repairCycle` or writes a
// new fingerprint, so a caller that read a different token decided to run
// before another pass recorded this one.
export function proofCursorToken(cursor) {
  return `${Number(cursor?.repairCycle || 0)}:${cursor?.progressFingerprint || ""}:${
    cursor?.updatedAt || ""}`;
}

export function proofExecutionResult(audit, proofRunId) {
  return { status: audit.valid ? "PASS" : "ACTION_REQUIRED", proofRunId };
}

export function proofRunExecutionStops(result) {
  return result?.stage === "execution-indeterminate" ||
    result?.status === "ACTION_REQUIRED";
}

export function stopProofRun(context, readiness, options = {}) {
  const stopped = {
    ...readiness,
    command: "proof run",
    completed: false
  };
  if (!options.quiet) context.printOutcome(stopped);
  context.markBlocked(blockedOutcomeStop(stopped));
  context.runtimeProcess.exitCode = 2;
  return readiness;
}

export function proofRunOutcome(id, proof) {
  return {
    version: 1,
    changeId: id,
    command: "proof run",
    status: "PASS",
    completed: true,
    proofRunId: proof.proofRunId || null,
    workspaceHash: proof.workspaceHash,
    providers: proof.providers || []
  };
}

export function stopProofCollection(context, readiness, options = {}) {
  const stopped = {
    ...readiness,
    command: "proof collect",
    completed: false
  };
  if (!options.quiet) context.printOutcome(stopped);
  context.markBlocked(blockedOutcomeStop(stopped));
  context.runtimeProcess.exitCode = 2;
  return readiness;
}

export function beginProofCollection(context, id, snapshot, explicitRunId = null) {
  const state = context.loadRuntime(id);
  const proofRunId = explicitRunId || `collect-${context.timestamp()}`;
  state.activeProofRun = {
    id: proofRunId,
    snapshotId: snapshot.id,
    workspaceHash: snapshot.workspaceHash,
    startedAt: context.now(),
    mode: "collect"
  };
  context.saveRuntime(state);
  return proofRunId;
}

export function rebindProofCollectionReceipts(
  context, id, snapshot, proofRunId
) {
  for (const provider of context.requiredProviders(id)) {
    const row = context.receiptValidity(id, provider, snapshot.workspaceHash);
    if (row.validity === "reusable-inputs")
      context.rebindReusableReceipt(id, row, snapshot, proofRunId);
    else if (row.validity === "reusable-diff")
      context.rebindDiffBoundReceipt(id, row, snapshot, proofRunId);
  }
}

export function assertProofCollectionOutcomes(outcomes) {
  const failed = outcomes.filter((row) => row.status !== "pass");
  if (failed.length) {
    const summary = failed.map((row) =>
      `${row.provider}:${row.status}${row.detail ? ` (${row.detail})` : ""}`).join(", ");
    const critical = failed.flatMap((row) => (row.observations || [])
      .filter((observation) => observation.kind === "critical-case" &&
        !["pass", "passed", "success", "ok"].includes(observation.status))
      .map((observation) => `${observation.id}=${observation.status}`));
    const recovery = critical.length
      ? `; critical cases non-passing: ${critical.join(", ")}; ` +
        "tag each covering test title with its literal [case-id] and rerun proof advance"
      : "";
    throw new Error(`evidence collection failed: ${summary}${recovery}`);
  }
}

export function persistProofCollectionArtifacts(
  context, id, proofRunId, sessions
) {
  const serviceArtifacts = context.stopAll(sessions)
    .map((artifact) => context.durableArtifact(id, "service", proofRunId, {
      path: artifact.path,
      type: "service-log",
      required: true
    }));
  // Not on activeProofRun: the caller clears that before `prove` reads it.
  // This key survives the clear; finalize consumes and removes it.
  const state = context.loadRuntime(id);
  state.collectedServiceArtifacts = serviceArtifacts;
  context.saveRuntime(state);
}

export function proofCollectionOutcome(
  id, snapshot, proofRunId, outcomes, collectable, readiness
) {
  return {
    version: 1,
    changeId: id,
    command: "proof collect",
    status: readiness.status,
    completed: true,
    proofFinalized: false,
    proofRunId,
    workspaceHash: snapshot.workspaceHash,
    executedProviders: outcomes.map((row) => row.provider),
    blockedExecutableProviders: collectable.blocked,
    remainingExternalProviders: readiness.externalProviders
  };
}

export function settleProofCollection(context, id, outcome, readiness, options) {
  const settled = options.manageReservation === false ? outcome : context.writeAdvance(id, {
    ...outcome,
    stage: "evidence-collected",
    providers: [],
    requests: []
  });
  if (!options.quiet) context.printOutcome(settled);
  return options.includeReadiness ? { ...settled, readiness } : settled;
}

export function createProofExecutionRuntime({
  proofReadinessValue, relevantSnapshot, loadRuntime, saveRuntime, now,
  requiredProviders, receiptValidity, rebindReusableReceipt,
  rebindDiffBoundReceipt, executionNodes,
  collectableExecutionNodes, startRequiredServices, runExecutionDag,
  durableArtifact, pendingTasks, proofPreflight, prove, proofAudit,
  readJson, writeJson = () => {}, proofPath, proofAdvancePath = () => null,
  proofAdvanceLockPath = () => null, providerCapability = (provider) => provider,
  providerConfig = () => null, providerWorkspaceHash = () => null,
  reviewPolicy = () => ({ tier: "low", requiresHumanFinal: false }),
  deliveredAiAttempts = () => [], recordDeterministicReviewClosure = () => null,
  authorityStatusValue = () => ({ requests: [] }), requestAuthority = () => null,
  // (id, request, command) => Promise | null. Starts the harness-runnable
  // configured review in the foreground; null means the route is a handoff.
  startConcurrentReview = null,
  stableHash = (value) => JSON.stringify(value), die, markBlocked = () => {},
  // Brings the change's sandboxes current (the root sandbox's nested
  // repository paths) before any provider runs in them.
  prepareWorkspace = () => {},
  // (id, workspaceHash) => { status: pass|fail|not-applicable, findings }.
  // Whether the change's tests fail on the base source (test-discrimination.mjs).
  testDiscrimination = null,
  // (id, provider) => finding | null. The performance-regression finding a
  // failed benchmark receipt carries (benchmark-runtime.mjs).
  performanceRegression = () => null
}) {
  const memoryAdvance = new Map();
  const activeAdvance = new Set();
  let quietAdvanceOutput = false;
  const { startTrackedServices, stopAll } = createServiceSessions({ startRequiredServices });
  const prepareProofExecutionFor = prepareProofExecution.bind(null, {
    proofPreflight, pendingTasks, die, relevantSnapshot, loadRuntime, saveRuntime,
    now, requiredProviders, receiptValidity, rebindReusableReceipt,
    rebindDiffBoundReceipt
  });

  // `proof advance` may be invoked by two agents at the same time. The
  // authority store already serializes request mutations, but that is too late
  // to prevent both agents from starting the same executable provider. This
  // process-owned lock covers the complete transition and is recoverable after
  // a killed process. A live holder is normal work, not a blocker: the second
  // caller receives IN_PROGRESS with exit zero and does not poll or execute.
  async function withProofAdvanceLock(id, operation) {
    if (activeAdvance.has(id)) return { acquired: false, owner: { pid: process.pid } };
    const path = proofAdvanceLockPath(id);
    if (!path) {
      activeAdvance.add(id);
      try { return { acquired: true, value: await operation() }; }
      finally { activeAdvance.delete(id); }
    }
    const lock = acquireProcessLock(path, { now });
    if (!lock.acquired) return { acquired: false, owner: lock.owner };
    activeAdvance.add(id);
    try { return { acquired: true, value: await operation() }; }
    finally {
      activeAdvance.delete(id);
      lock.release();
    }
  }

  function readAdvance(id) {
    const path = proofAdvancePath(id);
    return path ? readJson(path, {}) : (memoryAdvance.get(id) || {});
  }

  // Merges one scheduler event into a RUNNING record's progress: the wave's
  // providers while they run, and each finished provider with its status and
  // duration. Status, stage, and workspaceHash stay untouched for recovery.
  function recordProofProgress(id, event) {
    const record = readAdvance(id);
    if (record.status !== "RUNNING") return;
    const prior = record.progress || {};
    const progress = { startedAt: prior.startedAt || now(), wave: prior.wave || 0,
      running: [...(prior.running || [])], finished: [...(prior.finished || [])] };
    if (event.event === "wave") Object.assign(progress, { wave: event.wave, running: [...event.providers] });
    else if (event.event === "provider") {
      progress.running = progress.running.filter((provider) => provider !== event.provider);
      progress.finished.push({ provider: event.provider, status: event.status, durationMs: event.durationMs });
    } else return;
    const path = proofAdvancePath(id);
    const next = { ...record, progress };
    if (path) writeJson(path, next); else memoryAdvance.set(id, next);
  }

  // The progress a waiting caller sees, with the elapsed time since start.
  function proofProgressView(id) {
    const progress = readAdvance(id).progress;
    if (!progress) return null;
    const started = Date.parse(progress.startedAt);
    return { ...progress, elapsedMs: Number.isFinite(started) ? Math.max(0, Date.now() - started) : null };
  }

  function writeAdvance(id, outcome) {
    const requestIds = (outcome.requests || [])
      .map((request) => request.requestId).filter(Boolean).sort();
    const next = {
      version: 1,
      changeId: id,
      workspaceHash: outcome.workspaceHash || null,
      status: outcome.cursorStatus || outcome.status,
      stage: outcome.stage || null,
      requestIds,
      // Providers are durable only for a RUNNING reservation (crash recovery)
      // or an external-evidence wait. `executedProviders` is per invocation;
      // persisting it would make the next unchanged wait look like progress.
      providers: [...(outcome.providers || [])].sort(),
      subjectHash: outcome.subjectHash || null,
      recoveryDecisionRef: outcome.recoveryDecisionRef || null,
      progressFingerprint: outcome.progressFingerprint || null,
      repairCycle: Number(outcome.repairCycle || 0),
      repairPlanDigest: outcome.repairPlanDigest || null,
      route: outcome.route || null,
      decision: outcome.decision || null,
      next: outcome.next || [],
      repairPlan: outcome.repairPlan || null,
      repairGraph: outcome.repairGraph || null,
      invalidation: outcome.invalidation || null,
      attemptedStrategies: outcome.attemptedStrategies || [],
      // Advisory only: excluded from `comparable`, so it never counts as
      // lifecycle progress or changes recovery.
      ...(outcome.progress ? { progress: outcome.progress } : {}),
      updatedAt: now()
    };
    const prior = readAdvance(id);
    const comparable = (value) => JSON.stringify({
      workspaceHash: value.workspaceHash || null,
      status: value.status || null,
      stage: value.stage || null,
      requestIds: [...(value.requestIds || [])].sort(),
      providers: [...(value.providers || [])].sort(),
      subjectHash: value.subjectHash || null,
      recoveryDecisionRef: value.recoveryDecisionRef || null,
      progressFingerprint: value.progressFingerprint || null,
      repairCycle: Number(value.repairCycle || 0),
      repairPlanDigest: value.repairPlanDigest || null,
      route: value.route || null,
      decision: value.decision || null,
      next: value.next || [],
      repairPlan: value.repairPlan || null,
      repairGraph: value.repairGraph || null,
      invalidation: value.invalidation || null,
      attemptedStrategies: value.attemptedStrategies || []
    });
    const progressed = comparable(prior) !== comparable(next);
    const path = proofAdvancePath(id);
    if (path) writeJson(path, next); else memoryAdvance.set(id, next);
    const { cursorStatus: _cursorStatus, ...publicOutcome } = outcome;
    return {
      ...publicOutcome,
      requests: (outcome.requests || []).map((request) => requestSummary(id, request)),
      progressed,
      cursor: next
    };
  }

  function printOutcome(outcome) {
    if (!quietAdvanceOutput) console.log(JSON.stringify(outcome, null, 2));
    return outcome;
  }

  function reserveProviderExecution(id, command, workspaceHash, providers, options = {}) {
    if (!providers.length || options.manageReservation === false) return null;
    const prior = readAdvance(id);
    if (["RUNNING", "INDETERMINATE"].includes(prior.status) &&
        prior.stage === "execution-running" &&
        prior.workspaceHash === workspaceHash) {
      const outcome = writeAdvance(id, {
        version: 1,
        changeId: id,
        command,
        status: "ACTION_REQUIRED",
        cursorStatus: "INDETERMINATE",
        stage: "execution-indeterminate",
        completed: false,
        workspaceHash,
        providers: prior.providers || providers,
        recoveryDecisionRef: prior.recoveryDecisionRef || null,
        requests: [],
        executedProviders: [],
        next: [{
          kind: "decide-indeterminate-execution",
          reason: "A prior command stopped after reserving provider execution but before proving its receipt. Inspect side effects before retrying.",
          command: `claude-foundation advance ${id} --through proven`
        }]
      });
      markBlocked(blockedOutcomeStop(outcome));
      process.exitCode = 2;
      if (!options.quiet) printOutcome(outcome);
      return outcome;
    }
    writeAdvance(id, {
      version: 1,
      changeId: id,
      command,
      status: "RUNNING",
      stage: "execution-running",
      workspaceHash,
      providers,
      requests: [],
      recoveryDecisionRef: null
    });
    return null;
  }

  function clearActiveProofRun(id) {
    const current = loadRuntime(id);
    delete current.activeProofRun;
    saveRuntime(current);
  }

  async function proofCollectUnlocked(id, options = {}) {
    const readiness = options.readiness || proofReadinessValue(id, "prove");
    if (!["READY", "NEEDS_USER_DECISION"].includes(readiness.status))
      return stopProofCollection(
        { printOutcome, markBlocked, runtimeProcess: process }, readiness, options);
    prepareWorkspace(id);
    const snapshot = options.snapshot || relevantSnapshot(id, null, true);
    const execution = options.execution || executionNodes(id, snapshot.workspaceHash);
    const { nodes, unavailable } = execution;
    if (unavailable.length)
      die(`provider environment unavailable: ${unavailable.join(", ")}; run doctor --stage prove --change ${id}`);
    const collectable = options.collectable ||
      collectableExecutionNodes(id, nodes, snapshot.workspaceHash);
    const reservation = reserveProviderExecution(
      id, "proof collect", snapshot.workspaceHash,
      collectable.nodes.map((node) => node.provider), options);
    if (reservation) return reservation;
    const proofRunId = beginProofCollection(
      { loadRuntime, saveRuntime, now, timestamp: Date.now }, id, snapshot,
      options.proofRunId);
    rebindProofCollectionReceipts({
      requiredProviders, receiptValidity, rebindReusableReceipt,
      rebindDiffBoundReceipt
    }, id, snapshot, proofRunId);
    let sessions = [];
    try {
      sessions = await startTrackedServices(id, collectable.nodes, proofRunId);
      const outcomes = collectable.nodes.length
        ? await runExecutionDag(id, collectable.nodes, proofRunId, {
            quiet: options.quiet,
            onProgress: (event) => recordProofProgress(id, event)
          })
        : [];
      try { assertProofCollectionOutcomes(outcomes); } catch (error) {
        // An open merge of another change's landed edit explains a failing
        // check better than the run itself: the sandbox no longer carries
        // that change's work, which only the agent's merge can restore.
        const open = loadRuntime(id).workspace?.landedConflicts || {};
        if (Object.keys(open).length) Object.assign(error, {
          owner: "agent", boundary: "conflict",
          message: `${error.message}; the sandbox still has an open merge of earlier landed ` +
            `work in ${Object.keys(open).sort().join(", ")}: merge onto the target's bytes, ` +
            "keeping every landed and user edit, then resume",
          details: { conflicts: Object.entries(open).map(([path, row]) =>
            ({ repository: "root", path, landedBy: row.landedBy })) }
        });
        throw error;
      }
      persistProofCollectionArtifacts({
        stopAll, durableArtifact, loadRuntime, saveRuntime
      }, id, proofRunId, sessions);
      sessions = [];
      const after = proofReadinessValue(id, "prove");
      const outcome = proofCollectionOutcome(
        id, snapshot, proofRunId, outcomes, collectable, after);
      return settleProofCollection(
        { writeAdvance, printOutcome }, id, outcome, after, options);
    } catch (error) {
      stopAll(sessions);
      // Before die(), not after: a stale activeProofRun makes the next receipt
      // bind the pre-failure workspace hash and land in a dead run directory.
      clearActiveProofRun(id);
      die(error.message, 1, error.owner ? { owner: error.owner, boundary: error.boundary,
        details: error.details } : undefined);
    } finally {
      clearActiveProofRun(id);
    }
  }
  
  async function proofExecuteUnlocked(id, options = {}) {
    prepareWorkspace(id);
    const { snapshot, proofRunId } = prepareProofExecutionFor(id, options);
    let sessions = [];
    try {
      const hash = snapshot.workspaceHash;
      const execution = options.execution || executionNodes(id, hash);
      const { nodes } = execution;
      assertExecutionAvailable(execution, id);
      const reservation = reserveProviderExecution(
        id, options.command || "proof execute", snapshot.workspaceHash,
        nodes.map((node) => node.provider), options);
      if (reservation) {
        clearActiveProofRun(id);
        return reservation;
      }
      sessions = await startTrackedServices(id, nodes, proofRunId);
      await runProofExecutionNodes(
        { runExecutionDag, log: console.log }, id, nodes, proofRunId, options);
      const serviceArtifacts = stopAll(sessions)
        .map((artifact) => durableArtifact(id, "service", proofRunId, {
          path: artifact.path,
          type: "service-log",
          required: true
        }));
      const withServices = loadRuntime(id);
      withServices.activeProofRun.serviceArtifacts = serviceArtifacts;
      saveRuntime(withServices);
      sessions = [];
      prove(id, proofRunId, { quiet: options.quiet });
      const audit = proofAudit(id, true);
      writeProofExecutionAdvance(
        { writeAdvance }, id, options, snapshot, proofRunId, nodes, audit);
      return proofExecutionResult(audit, proofRunId);
    } catch (error) {
      stopAll(sessions);
      clearActiveProofRun(id);
      die(error.message, 1, error.owner ? { owner: error.owner, boundary: error.boundary,
        details: error.details } : undefined);
    } finally {
      clearActiveProofRun(id);
    }
  }
  
  async function proofRunUnlocked(id, options = {}) {
    const readiness = options.readiness || proofReadinessValue(id, "prove");
    if (readiness.status !== "READY")
      return stopProofRun({ printOutcome, markBlocked, runtimeProcess: process },
        readiness, options);
    const executionResult = await proofExecuteUnlocked(id, {
      preflight: false,
      snapshot: options.snapshot,
      quiet: options.quiet,
      command: "proof run",
      manageReservation: options.manageReservation
    });
    if (proofRunExecutionStops(executionResult)) return executionResult;
    const audit = proofAudit(id, true);
    if (!audit.valid)
      die(`proof run audit failed: ${audit.reason}`);
    const proof = readJson(proofPath(id));
    const outcome = proofRunOutcome(id, proof);
    if (!options.quiet) printOutcome(outcome);
    return outcome;
  }

  function currentProviderHash(id, provider, workspaceHash) {
    return providerWorkspaceHash(id, provider, workspaceHash) || workspaceHash;
  }

  function reviewRepairBatch(id) {
    const latestReview = deliveredAiAttempts(id).at(-1) || null;
    const findings = (latestReview?.findings || [])
      .filter((finding) => ["blocker", "major"].includes(finding.severity));
    return findings.length ? {
      version: 1,
      kind: "review-findings",
      attemptDigest: latestReview.digest,
      workspaceHash: latestReview.workspaceHash,
      findingIds: findings.map((finding) => finding.id).sort(),
      findings: findings.slice(0, 8)
    } : null;
  }

  function writeConvergentRepairStop(id, readiness, advanceStart, {
    gate, stage, findings, failures = [], requests = [], executedProviders = [],
    repairBatch = null, strategy, workspaceHash = readiness.workspaceHash,
    route = "AUTO_REPAIR", nextReason
  }) {
    const repairPlan = gateRepairPlan(findings, { phase: "prove", gate });
    const progress = gateProgressValue({
      phase: "prove", gate, findings,
      evidence: failures.map(({ provider, validity }) => ({ provider, validity })),
      strategy: { route: strategy }, workspaceHash
    });
    const progressComparison = compareGateProgress(
      advanceStart.progressFingerprint
        ? { fingerprint: advanceStart.progressFingerprint } : null,
      progress);
    const noProgress = advanceStart.stage === stage && !progressComparison.progressed;
    // An unchanged coding repair cycle is a strategy change for the agent, not
    // a user decision; the advance recovery ladder counts repetitions.
    const stall = noProgress ? noProgressRepair({
      changeId: id,
      phase: "prove",
      gate,
      progress,
      findings,
      attemptedStrategies: [{
        id: strategy,
        repairPlanDigest: repairPlan.digest,
        result: "same-findings-and-inputs"
      }],
      resumeCommand: `claude-foundation packet ${id} --phase build`
    }) : null;
    const written = writeAdvance(id, {
      version: 1,
      changeId: id,
      command: "proof advance",
      status: "ACTION_REQUIRED",
      // The caller's route stands: a contract decision it already raised stays one.
      route,
      stage,
      completed: false,
      workspaceHash: readiness.workspaceHash,
      ...(gate === "review" ? { subjectHash: workspaceHash } : {}),
      progressFingerprint: progress.fingerprint,
      repairCycle: Number(advanceStart.repairCycle || 0) + 1,
      repairPlanDigest: repairPlan.digest,
      failures,
      requests,
      repairBatch,
      repairPlan,
      ...(repairBatch ? { repairGraph: derivedReviewRepairGraph(
        deliveredAiAttempts(id).at(-1), stableHash
      ) } : {}),
      ...(stall ? { noProgress: {
        reason: stall.reason,
        progressFingerprint: stall.progressFingerprint,
        findingIds: stall.next[0].findingIds
      }, attemptedStrategies: stall.attemptedStrategies } : {}),
      executedProviders,
      next: noProgress ? stall.next : [{
        kind: gate === "review" ? "correct-workspace" : "correct-failed-evidence",
        // Lead with the first finding's own diagnosis so the agent can act on
        // the returned envelope instead of reading receipts.
        reason: [nextReason, (findings.find((finding) => finding?.message || finding?.reason) || {})
          .message || (findings.find((finding) => finding?.reason) || {}).reason]
          .filter(Boolean).join(": "),
        command: `claude-foundation packet ${id} --phase build`
      }]
    });
    return noProgress ? { ...written, progressed: false } : written;
  }

  function writeReviewRepairStop(id, readiness, advanceStart, {
    requests = [], failures = [], executedProviders = []
  } = {}) {
    const reviewProvider = requiredProviders(id).find((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === "review") || "review";
    const subjectHash = currentProviderHash(id, reviewProvider, readiness.workspaceHash);
    const repairBatch = reviewRepairBatch(id);
    // Review findings and executable failures at the same workspace are one
    // repair batch; neither hides the other.
    const findings = repairBatch ? [...repairBatch.findings, ...evidenceFailureFindings(
      failures.filter((failure) => failure.capability && failure.capability !== "review"))]
      : failures.map((failure) => ({
      id: `${failure.provider || "review"}:${failure.validity || "invalid"}`,
      provider: failure.provider || reviewProvider,
      classification: failure.validity === "unavailable" ? "infrastructure" : "product",
      severity: "error",
      rootCause: failure.reason || failure.validity || "review-failed",
      message: failure.reason || `review evidence is ${failure.validity || "invalid"}`
    }));
    return writeConvergentRepairStop(id, readiness, advanceStart, {
      gate: "review", stage: "review-rejected", findings, failures, requests,
      executedProviders, repairBatch, workspaceHash: subjectHash,
      strategy: repairBatch ? "repair-in-contract-findings" : "diagnose-review",
      route: repairBatch ? "AUTO_REPAIR" : "CONTRACT_DECISION_REQUIRED",
      nextReason: repairBatch
        ? "Repair every blocker/major finding in the dependency-ordered batch; the Build packet carries the same repair context. Continue the same gate loop until it passes."
        : "The review was inconclusive or errored. Repair its infrastructure or make a contract decision before another request."
    });
  }

  function evidenceFailureFindings(failures) {
    return failures.map((failure) => ({
      id: `${failure.provider || "evidence"}:${failure.validity || "invalid"}`,
      provider: failure.provider || null,
      classification: failure.validity === "unavailable"
        ? "infrastructure" : "product",
      severity: "error",
      rootCause: failure.reason || failure.validity || "evidence-failed",
      message: failure.reason || `${failure.provider || "evidence"} is ${
        failure.validity || "invalid"}`,
      claimIds: failure.claimIds || [],
      criticalCaseIds: failure.criticalCaseIds || []
    }));
  }

  // Executable evidence passed, but for behavior-changing work no new or
  // modified test fails on the base source: the suite cannot tell the change
  // from the original code. The agent strengthens the tests; this is the same
  // convergent evidence gate, so changed tests are progress and an unchanged
  // rerun reaches the existing no-progress boundary.
  async function discriminationRepairStop(id, readiness, advanceStart, executedProviders,
    early = null) {
    if (!testDiscrimination || !["READY", "NEEDS_USER_DECISION"].includes(readiness.status))
      return null;
    // A result computed beside the concurrent review binds to the hash it ran
    // on; any other hash is evaluated again.
    const result = early?.workspaceHash === readiness.workspaceHash
      ? early.result : await testDiscrimination(id, readiness.workspaceHash);
    if (result?.status !== "fail" || !result.findings?.length) return null;
    return stopProofAdvance(writeConvergentRepairStop(id, readiness, advanceStart, {
      gate: "evidence", stage: "tests-not-discriminating", findings: result.findings,
      failures: result.findings.map((finding) => ({
        provider: finding.provider, repositoryId: finding.repositoryId,
        validity: "passes-on-base", reason: finding.message
      })),
      executedProviders,
      strategy: "strengthen-discriminating-tests",
      nextReason: "The change's tests pass on the original code, so they do not verify the change. Add or strengthen a test that fails without the change and passes with it, then resume this same gate"
    }));
  }

  function writeEvidenceRepairStop(id, readiness, advanceStart, failures) {
    // A benchmark whose head ran cleanly but slower than its threshold is a
    // performance repair with its measured medians, not a generic failure.
    const regressions = failures.filter((failure) => failure.validity === "fail")
      .map((failure) => performanceRegression(id, failure.provider)).filter(Boolean);
    const regressed = new Set(regressions.map((finding) => finding.provider));
    const findings = [...regressions, ...evidenceFailureFindings(
      failures.filter((failure) => !regressed.has(failure.provider)))];
    if (regressions.length && regressions.length === failures.length)
      return writeConvergentRepairStop(id, readiness, advanceStart, {
        gate: "evidence", stage: "performance-regression", findings, failures,
        strategy: "repair-performance-regression",
        nextReason: "Head is slower than base beyond the benchmark threshold. Remove the slowdown in product code, then resume this same gate; base and head are measured again"
      });
    return writeConvergentRepairStop(id, readiness, advanceStart, {
      gate: "evidence", stage: "evidence-failed", findings, failures,
      strategy: "repair-failed-evidence",
      nextReason: "Repair every failed evidence finding in the dependency-ordered batch, then resume this same gate. The controller will reuse unaffected current receipts."
    });
  }

  function missingByCapability(id, readiness, capability) {
    // Capability order is policy, not lexical provider order. In particular,
    // validation sorts names and therefore returns `acceptance` before
    // `review`; basing the transition on externalProviders[0] asks a person to
    // accept work that has not passed review. Receipt validity is the gate and
    // the capability determines the stage.
    return requiredProviders(id).filter((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === capability &&
      receiptValidity(id, provider, readiness.workspaceHash).validity !== "valid");
  }

  function statusRequests(id) {
    return authorityStatusValue(id)?.requests || [];
  }

  function terminalEvidence(id, readiness) {
    const executableRetryStates = new Set([
      "missing", "stale", "provider-inputs-stale", "contract-stale",
      "provider-fingerprint-stale", "provider-version-stale",
      "adapter-version-stale", "invalid-artifacts", "execution-log-missing"
    ]);
    const externalRetryStates = new Set([
      "missing", "stale", "provider-inputs-stale", "contract-stale",
      "provider-fingerprint-stale", "provider-version-stale",
      "adapter-version-stale", "review-version-stale", "acceptance-version-stale"
    ]);
    return requiredProviders(id).map((provider) => {
      const config = providerConfig(id, provider);
      return {
        provider,
        capability: providerCapability(provider, config),
        adapter: config?.adapter || "external",
        ...receiptValidity(id, provider, readiness.workspaceHash)
      };
    }).filter((row) => {
      if (["valid", "reusable-inputs", "reusable-diff"].includes(row.validity)) return false;
      const automatic = row.adapter === "external"
        ? externalRetryStates : executableRetryStates;
      return !automatic.has(row.validity);
    });
  }

  function currentRequests(id, providers, workspaceHash, statuses, requests = null) {
    const providerSet = new Set(providers);
    return (requests || statusRequests(id)).filter((request) =>
      providerSet.has(request.provider) && statuses.includes(request.status) &&
      request.workspaceHash === currentProviderHash(
        id, request.provider, workspaceHash));
  }

  function authorityNext(id, stage, requests) {
    // `authority run` dispatches an AI wave, and the wave cap refuses it once
    // every allotted wave is delivered — prescribing it then hands the agent a
    // command guaranteed to block. Route the exhausted case to the external
    // recording template (a human verdict) instead.
    const delivered = deliveredAiAttempts(id);
    return requests.map((request) => {
      const maxAiAttempts = stage === "review" && request.status === "requested"
        ? effectiveReviewAttemptLimit(reviewPolicy(id), delivered, request.workspaceHash).maxAiAttempts
        : null;
      const runnable = maxAiAttempts !== null && delivered.length < maxAiAttempts;
      return {
        requestId: request.requestId,
        provider: request.provider,
        status: request.status,
        // Distinguishes "every AI wave is used" (a user decision) from "no
        // reviewer can start" (a wait) for the advance router.
        ...(maxAiAttempts !== null && !runnable
          ? { aiReviewExhausted: { delivered: delivered.length, maxAiAttempts } } : {}),
        owner: request.status === "infrastructure-exhausted" ? "harness" :
          stage === "review" ? "harness" : "external",
        ...(() => {
          if (!runnable)
            return { command: authorityStatusCommand(id, request.requestId) };
          const run = authorityRunCommand(id, request);
          return { command: run.command,
            ...(run.placeholders.length ? { placeholders: run.placeholders } : {}),
            ...(run.unresolved.length ? { unresolved: run.unresolved } : {}) };
        })()
      };
    });
  }

  function requestMissingAuthority(id, providers, type, workspaceHash, knownRequests) {
    const openStatuses = [
      "requested", "dispatched", "pending", "infrastructure-exhausted"
    ];
    const existing = currentRequests(
      id, providers, workspaceHash, openStatuses, knownRequests);
    const byProvider = new Map(existing.map((request) => [request.provider, request]));
    for (const provider of providers) {
      if (byProvider.has(provider)) continue;
      const config = providerConfig(id, provider);
      const request = requestAuthority(id, {
        type,
        ...(config?.repository ? { repo: config.repository } : {})
      }, { quiet: true });
      byProvider.set(provider, request);
    }
    return providers.map((provider) => byProvider.get(provider)).filter(Boolean);
  }

  function stopProofAdvance(outcome) {
    markBlocked(blockedOutcomeStop(outcome));
    process.exitCode = 2;
    return printOutcome(outcome);
  }

  // During `advance --through proven|archived`, a required configured review
  // that the harness can run starts beside the executable providers for the
  // same workspace hash. Anything else (handoff routes, external reviewers,
  // the bounded-closure route, several review providers) keeps the serial
  // path. The returned promise never rejects: an unsettled review stays an
  // open request that the next pass routes exactly as before.
  function startAdvanceReview(id, flags, snapshot, readiness, authorityRequests,
    proofRunId) {
    if (!flags.concurrentReview || !startConcurrentReview) return null;
    if (readiness.status !== "NEEDS_USER_DECISION" ||
        snapshot.workspaceHash !== readiness.workspaceHash) return null;
    const reviewProviders = missingByCapability(id, readiness, "review");
    if (reviewProviders.length !== 1) return null;
    const subjectHash = currentProviderHash(id, reviewProviders[0], readiness.workspaceHash);
    const delivered = deliveredAiAttempts(id);
    // A failed final wave first tries deterministic closure in this pass; its
    // closure review, if still needed, is requested only after that.
    if (delivered.length >= 2 && delivered.at(-1)?.resultStatus === "fail") return null;
    if (delivered.length >= effectiveReviewAttemptLimit(
      reviewPolicy(id), delivered, subjectHash).maxAiAttempts) return null;
    const known = authorityRequests.length ? authorityRequests : statusRequests(id);
    if (currentRequests(id, reviewProviders, readiness.workspaceHash,
      ["dispatched", "pending", "infrastructure-exhausted", "rejected"], known).length)
      return null;
    let request = null;
    let running = null;
    try {
      [request] = requestMissingAuthority(
        id, reviewProviders, "review", readiness.workspaceHash, known);
      if (request?.status !== "requested" || request.mainSessionFallback ||
          request.workspaceHash !== subjectHash) return null;
      // The receipt binds this pass's run and snapshot explicitly; reading
      // activeProofRun when the review finishes would depend on whether the
      // providers had already cleared it.
      running = startConcurrentReview(
        id, request, authorityNext(id, "review", [request])[0]?.command, {
          proofRunId, workspaceSnapshotId: snapshot.id || null,
          workspaceHash: subjectHash
        });
    } catch { return null; }
    return running ? Promise.resolve(running).then(() => true, () => false) : null;
  }

  // Executable evidence failed while the concurrent review rejected the same
  // workspace: report both in one repair stop instead of the provider error.
  function concurrentFailureStop(id, advanceStart) {
    const readiness = proofReadinessValue(id, "prove");
    const failed = terminalEvidence(id, readiness);
    if (!failed.some((row) => row.capability === "review") ||
        !failed.some((row) => row.capability !== "review")) return null;
    return stopProofAdvance(writeReviewRepairStop(
      id, readiness, advanceStart, { failures: failed }));
  }

  async function discriminationBesideReview(id, readiness, review) {
    let discrimination = null;
    try {
      if (["READY", "NEEDS_USER_DECISION"].includes(readiness.status) &&
          testDiscrimination) {
        discrimination = {
          workspaceHash: readiness.workspaceHash,
          result: await testDiscrimination(id, readiness.workspaceHash)
        };
      }
    } finally {
      // Recovery must never return while this pass still owns a reviewer.
      await review;
    }
    return discrimination;
  }

  async function collectAdvanceExecution(id, flags, snapshot, readiness,
    authorityRequests, advanceStart = {}) {
    const execution = executionNodes(id, snapshot.workspaceHash);
    const collectable = collectableExecutionNodes(
      id, execution.nodes, snapshot.workspaceHash);
    let executedProviders = [];
    if (!collectable.nodes.length) {
      // Build may already have supplied every executable receipt. Review can
      // still overlap the base-source check without rerunning those providers.
      const review = startAdvanceReview(id, flags, snapshot, readiness,
        authorityRequests, `review-${Date.now()}`);
      if (!review) return { readiness, authorityRequests, executedProviders };
      const discrimination = await discriminationBesideReview(id, readiness, review);
      readiness = proofReadinessValue(id, "prove");
      authorityRequests = readiness.status === "NEEDS_USER_DECISION" ? statusRequests(id) : [];
      return { readiness, authorityRequests, executedProviders, discrimination };
    }

    const priorAdvance = readAdvance(id);
    const retryIndeterminate = Boolean(flags["retry-indeterminate"]);
    const decisionRef = String(flags["decision-ref"] || "").trim();
    if (["RUNNING", "INDETERMINATE"].includes(priorAdvance.status) &&
        priorAdvance.stage === "execution-running" &&
        priorAdvance.workspaceHash === readiness.workspaceHash &&
        !retryIndeterminate) {
      const outcome = writeAdvance(id, {
        version: 1,
        changeId: id,
        command: "proof advance",
        status: "ACTION_REQUIRED",
        cursorStatus: "INDETERMINATE",
        stage: "execution-indeterminate",
        completed: false,
        workspaceHash: readiness.workspaceHash,
        providers: priorAdvance.providers || collectable.nodes.map((node) => node.provider),
        recoveryDecisionRef: priorAdvance.recoveryDecisionRef || null,
        requests: [],
        executedProviders: [],
        next: [{
          kind: "decide-indeterminate-execution",
          reason: "A prior controller stopped after reserving provider execution but before proving its receipt. Inspect side effects before retrying.",
          command: `claude-foundation advance ${id} --through proven`
        }]
      });
      return { outcome: stopProofAdvance(outcome) };
    }
    if (retryIndeterminate && !decisionRef)
      die("proof advance --retry-indeterminate requires --decision-ref");
    if (retryIndeterminate && priorAdvance.recoveryDecisionRef &&
        priorAdvance.recoveryDecisionRef === decisionRef)
      die("proof advance retry decision was already consumed by an interrupted attempt; inspect side effects again and provide a new --decision-ref");
    writeAdvance(id, {
      version: 1,
      changeId: id,
      status: "RUNNING",
      stage: "execution-running",
      workspaceHash: readiness.workspaceHash,
      providers: collectable.nodes.map((node) => node.provider),
      requests: [],
      recoveryDecisionRef: decisionRef || null,
      progress: { startedAt: now(), wave: 0, running: [], finished: [] }
    });
    const proofRunId = `collect-${Date.now()}`;
    const review = startAdvanceReview(
      id, flags, snapshot, readiness, authorityRequests, proofRunId);
    let collection;
    try {
      collection = await proofCollectUnlocked(id, {
        proofRunId,
        readiness,
        snapshot,
        execution,
        collectable,
        quiet: true,
        includeReadiness: true,
        manageReservation: false
      });
    } catch (error) {
      if (!review) throw error;
      await review;
      const combined = concurrentFailureStop(id, advanceStart);
      if (combined) return { outcome: combined };
      throw error;
    }
    executedProviders = collection.executedProviders || [];
    readiness = collection.readiness;
    // The base-source discrimination run is read-only on the workspace (it
    // builds its own scratch tree), so its async child runs beside the review
    // without blocking reviewer preparation or result collection.
    const discrimination = review
      ? await discriminationBesideReview(id, readiness, review) : null;
    // Join before classifying: the review verdict is bound to this same
    // workspace hash and belongs to this pass's readiness.
    if (review) {
      readiness = proofReadinessValue(id, "prove");
    }
    authorityRequests = readiness.status === "NEEDS_USER_DECISION"
      ? statusRequests(id) : [];
    if (!["READY", "NEEDS_USER_DECISION"].includes(readiness.status)) {
      const outcome = writeAdvance(id, {
        ...readiness,
        command: "proof advance",
        completed: false,
        stage: "blocked",
        requests: [],
        executedProviders
      });
      return { outcome: stopProofAdvance(outcome) };
    }
    return { readiness, authorityRequests, executedProviders, discrimination };
  }

  async function finishProofAdvance(id, advanceStart, readiness,
    authorityRequests, executedProviders) {
    if (readiness.status === "READY") {
      const outcome = await proofRunUnlocked(id, {
        readiness,
        quiet: true,
        manageReservation: false
      });
      return printOutcome(writeAdvance(id, {
        ...outcome,
        command: "proof advance",
        stage: "complete",
        requests: [],
        executedProviders,
        reused: false,
        next: [{ kind: "land", command: `claude-foundation advance ${id} --through archived` }]
      }));
    }

    const reviewProviders = missingByCapability(id, readiness, "review");
    if (reviewProviders.length) {
      const terminal = currentRequests(
        id, reviewProviders, readiness.workspaceHash,
        ["rejected"], authorityRequests);
      if (terminal.length) {
        const outcome = writeReviewRepairStop(id, readiness, advanceStart, {
          requests: terminal, executedProviders
        });
        return stopProofAdvance(outcome);
      }
      const requests = requestMissingAuthority(
        id, reviewProviders, "review", readiness.workspaceHash, authorityRequests);
      return printOutcome(writeAdvance(id, {
        version: 1,
        changeId: id,
        command: "proof advance",
        status: "WAITING_EXTERNAL",
        stage: "review",
        completed: false,
        workspaceHash: readiness.workspaceHash,
        requests,
        executedProviders,
        next: authorityNext(id, "review", requests)
      }));
    }

    const acceptanceProviders = missingByCapability(id, readiness, "acceptance");
    const otherExternal = (readiness.externalProviders || []).filter((provider) => {
      const capability = providerCapability(provider, providerConfig(id, provider));
      return capability !== "review" && capability !== "acceptance";
    });
    if (otherExternal.length) {
      return printOutcome(writeAdvance(id, {
        version: 1,
        changeId: id,
        command: "proof advance",
        status: "WAITING_EXTERNAL",
        stage: "external-evidence",
        completed: false,
        workspaceHash: readiness.workspaceHash,
        providers: otherExternal,
        requests: [],
        executedProviders,
        next: readiness.next || []
      }));
    }
    if (acceptanceProviders.length) {
      const terminal = currentRequests(
        id, acceptanceProviders, readiness.workspaceHash,
        ["rejected"], authorityRequests);
      if (terminal.length) {
        const outcome = writeAdvance(id, {
          version: 1,
          changeId: id,
          command: "proof advance",
          status: "ACTION_REQUIRED",
          stage: "acceptance-rejected",
          completed: false,
          workspaceHash: readiness.workspaceHash,
          requests: terminal,
          executedProviders,
          next: [{
            kind: "revise-after-acceptance",
            reason: "Acceptance failed, was inconclusive, or errored for this workspace. Revise the result before another request.",
            command: `claude-foundation packet ${id} --phase build`
          }]
        });
        return stopProofAdvance(outcome);
      }
      const requests = requestMissingAuthority(
        id, acceptanceProviders, "acceptance", readiness.workspaceHash,
        authorityRequests);
      return printOutcome(writeAdvance(id, {
        version: 1,
        changeId: id,
        command: "proof advance",
        status: "WAITING_EXTERNAL",
        stage: "acceptance",
        completed: false,
        workspaceHash: readiness.workspaceHash,
        requests,
        executedProviders,
        next: authorityNext(id, "acceptance", requests)
      }));
    }

    die(`proof advance could not classify readiness for '${id}'`);
  }

  // Every allowed AI wave is delivered, the last one still raised findings the
  // agent has since repaired, current non-review proof passes, and no declared
  // critical case can close those findings deterministically. Only a person
  // can end this: the same review-exhausted gate `REVIEW_ROUTE_COMPLETE`
  // names, never a REPAIR the agent cannot satisfy.
  function writeReviewExhaustedStop(id, readiness, exhausted, executedProviders) {
    const delivered = deliveredAiAttempts(id);
    const findingIds = [...new Set(exhausted.flatMap((row) => row.findingIds || []))].sort();
    const findings = (delivered.at(-1)?.findings || [])
      .filter((finding) => findingIds.includes(finding.id));
    const progress = gateProgressValue({
      phase: "prove", gate: "review", findings,
      strategy: { route: "review-route-exhausted" },
      workspaceHash: readiness.workspaceHash
    });
    const decision = noProgressDecision({
      changeId: id,
      phase: "prove",
      gate: "review",
      progress,
      findings,
      attemptedStrategies: [{
        id: "repair-final-review-findings",
        result: "repaired-without-remaining-review-wave"
      }],
      recommended: "human-verdict",
      options: [{
        id: "human-verdict",
        outcome: "A person reviews the final repair; request a review, dispatch it to them, then record the verdict they gave.",
        command: `claude-foundation authority request ${id} --type review`
      }, {
        id: "one-more-ai-attempt",
        outcome: "Allow one more AI review wave on the user's recorded decision; advance then runs it.",
        command: `claude-foundation authority extend-review ${id} --decision-ref <user-decision>`
      }, {
        id: "revise-agreement",
        outcome: "Amend the agreement to declare a critical case that proves the repaired findings, then resume."
      }, {
        id: "pause",
        outcome: "Preserve the change and all completed work."
      }],
      resumeCommand: `claude-foundation advance ${id} --through proven`
    });
    return writeAdvance(id, {
      version: 1,
      changeId: id,
      command: "proof advance",
      status: "NEEDS_USER_DECISION",
      route: "NO_PROGRESS_DECISION",
      stage: "review-repair-closure",
      completed: false,
      workspaceHash: readiness.workspaceHash,
      progressFingerprint: progress.fingerprint,
      closures: exhausted,
      decision: {
        ...decision.decision,
        kind: "review-route-exhausted",
        summary: `All ${delivered.length} AI review wave(s) are delivered and the last one raised ${findingIds.join(", ") || "findings"}. The repair is in place and current tests pass, but no review wave or declared critical case remains to close those findings.`
      },
      attemptedStrategies: decision.attemptedStrategies,
      requests: [],
      executedProviders,
      next: [{
        kind: "review-route-exhausted",
        reason: "Report the repaired findings, passing checks, and the unreviewed final repair; let the user choose a human verdict, one more AI wave, a revised agreement, or a pause.",
        command: `claude-foundation authority extend-review ${id} --decision-ref <user-decision>`
      }, ...decision.next]
    });
  }

  function closeBoundedReviewAttempts(id, readiness, authorityRequests,
    executedProviders) {
    const delivered = deliveredAiAttempts(id);
    const boundedReviewProviders = missingByCapability(id, readiness, "review");
    if (!(delivered.length >= 2 && delivered.at(-1)?.resultStatus === "fail" &&
        boundedReviewProviders.length))
      return { readiness, authorityRequests };

    const closureProviders = new Map();
    const closures = boundedReviewProviders.map((provider) => {
      const closure = recordDeterministicReviewClosure(id, provider,
        currentProviderHash(id, provider, readiness.workspaceHash));
      if (closure) closureProviders.set(closure, provider);
      return closure;
    })
      .filter(Boolean);
    const blockedClosures = closures.filter((row) => !row.closed);
    if (blockedClosures.length) {
      const exhausted = blockedClosures.filter((row) =>
        row.route === "REVIEW_ROUTE_EXHAUSTED");
      if (exhausted.length && !blockedClosures.some((row) =>
        row.route === "CONTRACT_DECISION_REQUIRED")) {
        // The repaired final delta gets one closure review before any person
        // is asked to accept it unreviewed.
        // A user-granted extra wave reviews it the same way.
        if (exhausted.every((row) => reviewClosureWaveAvailable(delivered,
          currentProviderHash(id, closureProviders.get(row), readiness.workspaceHash))) ||
            delivered.length < effectiveReviewAttemptLimit(
              reviewPolicy(id), delivered, null).maxAiAttempts)
          return { readiness, authorityRequests };
        return { outcome: stopProofAdvance(
          writeReviewExhaustedStop(id, readiness, exhausted, executedProviders)) };
      }
      const outcome = writeAdvance(id, {
        version: 1,
        changeId: id,
        command: "proof advance",
        status: "ACTION_REQUIRED",
        route: blockedClosures.some((row) =>
          row.route === "CONTRACT_DECISION_REQUIRED")
          ? "CONTRACT_DECISION_REQUIRED" : "AUTO_REPAIR",
        stage: "review-repair-closure",
        completed: false,
        workspaceHash: readiness.workspaceHash,
        closures: blockedClosures,
        requests: [],
        executedProviders,
        next: [{
          kind: "repair-final-review-findings",
          // The closure's own reason names what is still unmet (unchanged
          // workspace, failing proof, or a contract decision).
          reason: ["Repair the final finding batch inside the locked contract; do not dispatch another AI or open a generic choice interview",
            ...new Set(blockedClosures.map((row) => row.reason).filter(Boolean))]
            .join(": "),
          command: `claude-foundation packet ${id} --phase build`
        }]
      });
      return { outcome: stopProofAdvance(outcome) };
    }
    if (closures.some((row) => row.closed)) {
      readiness = proofReadinessValue(id, "prove");
      authorityRequests = readiness.status === "NEEDS_USER_DECISION"
        ? statusRequests(id) : [];
    }
    return { readiness, authorityRequests };
  }

  function refreshedAdvanceReadiness(id) {
    const advanceStart = readAdvance(id);
    let readiness = proofReadinessValue(id, "prove");
    const audit = proofAudit(id, true);
    let forcedSnapshot = null;
    // A pass that will run providers (or a concurrent review) binds to the
    // forced snapshot, so a readiness hash read from a snapshot cached before
    // the latest edits is re-derived here, not discovered mid-pass.
    if ((readiness.status === "READY" && audit.valid) ||
        readiness.status === "NEEDS_USER_DECISION") {
      // Audit authenticates the copied evidence, while this forced snapshot
      // establishes that it still belongs to the current workspace.
      forcedSnapshot = relevantSnapshot(id, null, true);
      if (readiness.workspaceHash !== forcedSnapshot.workspaceHash)
        readiness = proofReadinessValue(id, "prove");
    }
    return { advanceStart, readiness, audit, forcedSnapshot };
  }

  function initialAdvanceStop(id, advanceStart, readiness) {
    if (!["READY", "NEEDS_USER_DECISION"].includes(readiness.status)) {
      return { outcome: stopProofAdvance(writeAdvance(id, {
        ...readiness,
        command: "proof advance",
        completed: false,
        stage: "blocked",
        requests: [],
        executedProviders: []
      })) };
    }

    const failedEvidence = terminalEvidence(id, readiness);
    if (failedEvidence.length) {
      const capabilities = new Set(failedEvidence.map((row) => row.capability));
      const stage = capabilities.has("review") ? "review-rejected"
        : capabilities.has("acceptance") ? "acceptance-rejected" : "evidence-failed";
      const outcome = capabilities.has("review")
        ? writeReviewRepairStop(id, readiness, advanceStart, {
            failures: failedEvidence
          })
        : capabilities.has("acceptance")
          ? writeAdvance(id, {
              version: 1,
              changeId: id,
              command: "proof advance",
              status: "NEEDS_USER_DECISION",
              stage,
              completed: false,
              workspaceHash: readiness.workspaceHash,
              failures: failedEvidence,
              requests: [],
              executedProviders: [],
              next: [{
                kind: "revise-after-acceptance",
                reason: "Acceptance evidence is terminal or invalid for this workspace. Resolve the behavior decision, then resume the same change.",
                command: `claude-foundation packet ${id} --phase build`
              }]
            })
          : writeEvidenceRepairStop(id, readiness, advanceStart, failedEvidence);
      return { outcome: stopProofAdvance(outcome) };
    }

    const reviewProviders = missingByCapability(id, readiness, "review");
    const authorityRequests = readiness.status === "NEEDS_USER_DECISION"
      ? statusRequests(id) : [];
    const rejected = currentRequests(
      id, reviewProviders, readiness.workspaceHash,
      ["rejected"], authorityRequests);
    if (rejected.length) {
      return { outcome: stopProofAdvance(writeReviewRepairStop(
        id, readiness, advanceStart, { requests: rejected })) };
    }
    const earlyAcceptanceProviders = missingByCapability(
      id, readiness, "acceptance");
    const rejectedAcceptance = currentRequests(
      id, earlyAcceptanceProviders, readiness.workspaceHash,
      ["rejected"], authorityRequests);
    if (!reviewProviders.length && rejectedAcceptance.length) {
      return { outcome: stopProofAdvance(writeAdvance(id, {
        version: 1,
        changeId: id,
        command: "proof advance",
        status: "ACTION_REQUIRED",
        stage: "acceptance-rejected",
        completed: false,
        workspaceHash: readiness.workspaceHash,
        requests: rejectedAcceptance,
        executedProviders: [],
        next: [{
          kind: "revise-after-acceptance",
          reason: "Acceptance is terminal or its receipt is invalid for this workspace. Revise the result before another request.",
          command: `claude-foundation packet ${id} --phase build`
        }]
      })) };
    }
    return { authorityRequests };
  }

  async function advanceUnlocked(id, flags = {}) {
    const refreshed = refreshedAdvanceReadiness(id);
    const { advanceStart, audit, forcedSnapshot } = refreshed;
    let { readiness } = refreshed;
    // Another process recorded a gate pass after this caller chose to run:
    // the same findings are not "no progress", since nobody has repaired yet.
    if (Object.hasOwn(flags, "cursor-token") &&
        flags["cursor-token"] !== proofCursorToken(advanceStart))
      advanceStart.progressFingerprint = null;
    // A user who answered the no-progress decision chose to repair again:
    // compare this pass with nothing, once, instead of asking again.
    if (flags["reset-progress"]) {
      if (!flags["decision-ref"]) die("proof advance --reset-progress requires --decision-ref");
      advanceStart.progressFingerprint = null;
    }
    if (readiness.status === "READY" && audit.valid && forcedSnapshot &&
        audit.proof.workspaceHash === forcedSnapshot.workspaceHash &&
        readiness.workspaceHash === forcedSnapshot.workspaceHash) {
      return printOutcome(writeAdvance(id, {
        version: 1,
        changeId: id,
        command: "proof advance",
        status: "PASS",
        stage: "complete",
        completed: true,
        reused: true,
        proofRunId: audit.proof.proofRunId || null,
        workspaceHash: readiness.workspaceHash,
        providers: audit.proof.providers || [],
        requests: [],
        executedProviders: [],
        next: []
      }));
    }
    const initial = initialAdvanceStop(id, advanceStart, readiness);
    if (initial.outcome) return initial.outcome;
    let { authorityRequests } = initial;

    const snapshot = forcedSnapshot || relevantSnapshot(id, null, true);
    const reusable = requiredProviders(id)
      .map((provider) => receiptValidity(id, provider, snapshot.workspaceHash))
      .filter((row) => ["reusable-inputs", "reusable-diff"].includes(row.validity));
    if (reusable.length) {
      const reuseRunId = `advance-reuse-${Date.now()}`;
      for (const row of reusable)
        (row.validity === "reusable-inputs"
          ? rebindReusableReceipt : rebindDiffBoundReceipt)(id, row, snapshot, reuseRunId);
      readiness = proofReadinessValue(id, "prove");
      authorityRequests = readiness.status === "NEEDS_USER_DECISION"
        ? statusRequests(id) : [];
      if (!["READY", "NEEDS_USER_DECISION"].includes(readiness.status)) {
        const outcome = writeAdvance(id, {
          ...readiness,
          command: "proof advance",
          completed: false,
          stage: "blocked",
          requests: [],
          executedProviders: [],
          reusedProviders: reusable.map((row) => row.provider)
        });
        markBlocked(blockedOutcomeStop(outcome));
        process.exitCode = 2;
        return printOutcome(outcome);
      }
    }
    const executionResult = await collectAdvanceExecution(
      id, flags, snapshot, readiness, authorityRequests, advanceStart);
    if (executionResult.outcome) return executionResult.outcome;
    ({ readiness, authorityRequests } = executionResult);
    const { executedProviders } = executionResult;
    const discrimination = await discriminationRepairStop(
      id, readiness, advanceStart, executedProviders, executionResult.discrimination);
    if (discrimination) return discrimination;

    // Two delivered AI waves are the end of the open-review route, not the
    // beginning of a human/third-AI loop. If the final delta found an
    // in-contract defect, its structured claim/case bindings let current
    // executable evidence close only those IDs. This operation is a durable
    // hash-chained deterministic attempt; it cannot invent a pass while any
    // non-review provider is stale or failing.
    const closureResult = closeBoundedReviewAttempts(
      id, readiness, authorityRequests, executedProviders);
    if (closureResult.outcome) return closureResult.outcome;
    ({ readiness, authorityRequests } = closureResult);

    return finishProofAdvance(
      id, advanceStart, readiness, authorityRequests, executedProviders);
  }

  function mutationInProgress(id, command, locked) {
    const recovery = locked.owner?.recoverableAfter ? [{
      kind: "retry-after-lock-initialization",
      reason: "The lock descriptor is still being initialized. Retry once after the recovery grace period; do not run the provider directly.",
      recoverableAfter: locked.owner.recoverableAfter,
      retryAfterMs: locked.owner.retryAfterMs
    }] : [];
    return printOutcome({
      version: 1,
      changeId: id,
      command,
      status: "IN_PROGRESS",
      stage: "controller",
      completed: false,
      progressed: false,
      // Keep the lock's state and grace period so a caller can tell an
      // initializing owner from a dead one.
      owner: locked.owner ? {
        pid: locked.owner.pid ?? null,
        ...(locked.owner.state ? { state: locked.owner.state } : {}),
        ...(locked.owner.recoverableAfter ? { recoverableAfter: locked.owner.recoverableAfter } : {})
      } : null,
      // Where the running proof is, so a waiting caller need not poll blind.
      ...(proofProgressView(id) ? { progress: proofProgressView(id) } : {}),
      next: recovery
    });
  }

  async function runProofMutation(id, command, operation) {
    const locked = await withProofAdvanceLock(id, operation);
    return locked.acquired ? locked.value : mutationInProgress(id, command, locked);
  }

  async function guardProofMutation(id, command, operation) {
    return runProofMutation(id, command, operation);
  }

  async function proofCollect(id) {
    return runProofMutation(id, "proof collect", () => proofCollectUnlocked(id));
  }

  async function proofExecute(id) {
    return runProofMutation(id, "proof execute", () => proofExecuteUnlocked(id));
  }

  async function proofRun(id) {
    return runProofMutation(id, "proof run", () => proofRunUnlocked(id));
  }

  async function proofFinalize(id) {
    return runProofMutation(id, "proof finalize", async () => prove(id));
  }

  async function proofAdvance(id, flags = {}) {
    const priorQuiet = quietAdvanceOutput;
    quietAdvanceOutput = Boolean(flags.quiet);
    try {
      const locked = await withProofAdvanceLock(id, () => advanceUnlocked(id, flags));
      if (locked.acquired) return locked.value;
      return mutationInProgress(id, "proof advance", locked);
    } finally {
      quietAdvanceOutput = priorQuiet;
    }
  }

  return {
    authorityNext,
    guardProofMutation,
    proofAdvance,
    proofCollect,
    proofExecute,
    proofFinalize,
    proofRun
  };
}
