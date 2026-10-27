import { acquireProcessLock } from "../core/process-lock.mjs";
import { effectiveReviewAttemptLimit } from "../core/authority-policy.mjs";
import {
  compareGateProgress,
  gateProgressValue,
  gateRepairPlan,
  noProgressDecision
} from "../core/convergent-gate.mjs";
import { createServiceSessions } from "./proof-execution/service-sessions.mjs";
import { derivedReviewRepairGraph } from "./repair-runtime.mjs";

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
      command: `claude-foundation land check ${id}`
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
  context.markBlocked();
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
  context.markBlocked();
  context.runtimeProcess.exitCode = 2;
  return readiness;
}

export function beginProofCollection(context, id, snapshot) {
  const state = context.loadRuntime(id);
  const proofRunId = `collect-${context.timestamp()}`;
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
    const summary = failed.map((row) => `${row.provider}:${row.status}`).join(", ");
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
  stableHash = (value) => JSON.stringify(value), die, markBlocked = () => {}
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
          command: `claude-foundation proof advance ${id} --retry-indeterminate --decision-ref <host-decision-reference>`
        }]
      });
      markBlocked();
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
      { loadRuntime, saveRuntime, now, timestamp: Date.now }, id, snapshot);
    rebindProofCollectionReceipts({
      requiredProviders, receiptValidity, rebindReusableReceipt,
      rebindDiffBoundReceipt
    }, id, snapshot, proofRunId);
    let sessions = [];
    try {
      sessions = await startTrackedServices(id, collectable.nodes, proofRunId);
      const outcomes = collectable.nodes.length
        ? await runExecutionDag(id, collectable.nodes, proofRunId, {
            quiet: options.quiet
          })
        : [];
      assertProofCollectionOutcomes(outcomes);
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
      die(error.message);
    } finally {
      clearActiveProofRun(id);
    }
  }
  
  async function proofExecuteUnlocked(id, options = {}) {
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
      die(error.message);
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
    const decision = noProgress ? noProgressDecision({
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
      status: noProgress ? "NEEDS_USER_DECISION" : "ACTION_REQUIRED",
      route: noProgress ? "NO_PROGRESS_DECISION" : route,
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
      ...(decision ? { decision: decision.decision,
        attemptedStrategies: decision.attemptedStrategies } : {}),
      executedProviders,
      next: noProgress ? decision.next : [{
        kind: gate === "review" ? "correct-workspace" : "correct-failed-evidence",
        reason: nextReason,
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
    const findings = repairBatch?.findings || failures.map((failure) => ({
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

  function writeEvidenceRepairStop(id, readiness, advanceStart, failures) {
    const findings = evidenceFailureFindings(failures);
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
    return requests.map((request) => ({
      requestId: request.requestId,
      provider: request.provider,
      status: request.status,
      owner: request.status === "infrastructure-exhausted" ? "harness" :
        stage === "review" ? "harness" : "external",
      command: stage === "review" && request.status === "requested" &&
          delivered.length < effectiveReviewAttemptLimit(
            reviewPolicy(id), delivered, request.workspaceHash).maxAiAttempts &&
          request.mainSessionFallback
        ? `claude-foundation authority run ${id} --request ${request.requestId} --subject-actor ${request.mainSessionFallback.subject?.identity || "<implementer>"} --main-session-model-family <family> --main-session-model <model>`
        : stage === "review" && request.status === "requested" &&
            delivered.length < effectiveReviewAttemptLimit(
              reviewPolicy(id), delivered, request.workspaceHash).maxAiAttempts
          ? `claude-foundation authority run ${id} --request ${request.requestId} --subject-actor implementation-agent`
        : `claude-foundation authority status ${id} --request ${request.requestId} --template`
    }));
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
    markBlocked();
    process.exitCode = 2;
    return printOutcome(outcome);
  }

  async function collectAdvanceExecution(id, flags, snapshot, readiness,
    authorityRequests) {
    const execution = executionNodes(id, snapshot.workspaceHash);
    const collectable = collectableExecutionNodes(
      id, execution.nodes, snapshot.workspaceHash);
    let executedProviders = [];
    if (!collectable.nodes.length)
      return { readiness, authorityRequests, executedProviders };

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
          command: `claude-foundation proof advance ${id} --retry-indeterminate --decision-ref <host-decision-reference>`
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
      recoveryDecisionRef: decisionRef || null
    });
    const collection = await proofCollectUnlocked(id, {
      readiness,
      snapshot,
      execution,
      collectable,
      quiet: true,
      includeReadiness: true,
      manageReservation: false
    });
    executedProviders = collection.executedProviders || [];
    readiness = collection.readiness;
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
    return { readiness, authorityRequests, executedProviders };
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
        next: [{ kind: "land", command: `claude-foundation land check ${id}` }]
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

  function closeBoundedReviewAttempts(id, readiness, authorityRequests,
    executedProviders) {
    const delivered = deliveredAiAttempts(id);
    const boundedReviewProviders = missingByCapability(id, readiness, "review");
    if (!(delivered.length >= 2 && delivered.at(-1)?.resultStatus === "fail" &&
        boundedReviewProviders.length))
      return { readiness, authorityRequests };

    const closures = boundedReviewProviders.map((provider) =>
      recordDeterministicReviewClosure(id, provider,
        currentProviderHash(id, provider, readiness.workspaceHash)))
      .filter(Boolean);
    const blockedClosures = closures.filter((row) => !row.closed);
    if (blockedClosures.length) {
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
          reason: "Repair the final finding batch inside the locked contract and bind each blocker to a current declared critical case; do not dispatch another AI or open a generic choice interview.",
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
    if (readiness.status === "READY" && audit.valid) {
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
        markBlocked();
        process.exitCode = 2;
        return printOutcome(outcome);
      }
    }
    const executionResult = await collectAdvanceExecution(
      id, flags, snapshot, readiness, authorityRequests);
    if (executionResult.outcome) return executionResult.outcome;
    ({ readiness, authorityRequests } = executionResult);
    const { executedProviders } = executionResult;

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
      owner: locked.owner?.pid ? { pid: locked.owner.pid } : null,
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
