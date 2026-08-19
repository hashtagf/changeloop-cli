import { acquireProcessLock } from "../core/process-lock.mjs";
import { createServiceSessions } from "./proof-execution/service-sessions.mjs";

export function createProofExecutionRuntime({
  proofReadinessValue, relevantSnapshot, loadRuntime, saveRuntime, now,
  requiredProviders, receiptValidity, rebindReusableReceipt, executionNodes,
  collectableExecutionNodes, startRequiredServices, runExecutionDag,
  durableArtifact, pendingTasks, proofPreflight, prove, proofAudit,
  readJson, writeJson = () => {}, proofPath, proofAdvancePath = () => null,
  proofAdvanceLockPath = () => null, providerCapability = (provider) => provider,
  providerConfig = () => null, providerWorkspaceHash = () => null,
  reviewPolicy = () => ({ tier: "low", requiresHumanFinal: false }),
  deliveredAiAttempts = () => [], recordDeterministicReviewClosure = () => null,
  authorityStatusValue = () => ({ requests: [] }), requestAuthority = () => null,
  die, markBlocked = () => {}
}) {
  const memoryAdvance = new Map();
  const activeAdvance = new Set();
  const { startTrackedServices, stopAll } = createServiceSessions({ startRequiredServices });

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

  function requestSummary(id, request) {
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
      recoveryDecisionRef: value.recoveryDecisionRef || null
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
    console.log(JSON.stringify(outcome, null, 2));
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
    if (!["READY", "NEEDS_USER_DECISION"].includes(readiness.status)) {
      const stopped = {
        ...readiness,
        command: "proof collect",
        completed: false
      };
      if (!options.quiet) printOutcome(stopped);
      markBlocked();
      process.exitCode = 2;
      return readiness;
    }
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
    const state = loadRuntime(id);
    const proofRunId = `collect-${Date.now()}`;
    state.activeProofRun = {
      id: proofRunId,
      snapshotId: snapshot.id,
      workspaceHash: snapshot.workspaceHash,
      startedAt: now(),
      mode: "collect"
    };
    saveRuntime(state);
    for (const provider of requiredProviders(id)) {
      const row = receiptValidity(id, provider, snapshot.workspaceHash);
      if (row.validity === "reusable-inputs")
        rebindReusableReceipt(id, row, snapshot, proofRunId);
    }
    let sessions = [];
    try {
      sessions = await startTrackedServices(id, collectable.nodes, proofRunId);
      const outcomes = collectable.nodes.length
        ? await runExecutionDag(id, collectable.nodes, proofRunId, {
            quiet: options.quiet
          })
        : [];
      const failed = outcomes.filter((row) => row.status !== "pass");
      if (failed.length)
        throw new Error(`evidence collection failed: ${failed.map((row) => `${row.provider}:${row.status}`).join(", ")}`);
      const serviceArtifacts = stopAll(sessions)
        .map((artifact) => durableArtifact(id, "service", proofRunId, {
          path: artifact.path,
          type: "service-log",
          required: true
        }));
      // Not on activeProofRun: the finally below clears that before `prove`
      // ever reads it, so service logs collected here silently vanished from
      // the proof manifest. This key survives the clear; finalize consumes and
      // removes it.
      const withServices = loadRuntime(id);
      withServices.collectedServiceArtifacts = serviceArtifacts;
      saveRuntime(withServices);
      sessions = [];
      const after = proofReadinessValue(id, "prove");
      const outcome = {
        version: 1,
        changeId: id,
        command: "proof collect",
        status: after.status,
        completed: true,
        proofFinalized: false,
        proofRunId,
        workspaceHash: snapshot.workspaceHash,
        executedProviders: outcomes.map((row) => row.provider),
        blockedExecutableProviders: collectable.blocked,
        remainingExternalProviders: after.externalProviders
      };
      const settled = options.manageReservation === false ? outcome : writeAdvance(id, {
        ...outcome,
        stage: "evidence-collected",
        providers: [],
        requests: []
      });
      if (!options.quiet) printOutcome(settled);
      return options.includeReadiness ? { ...settled, readiness: after } : settled;
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
    if (options.preflight !== false) proofPreflight(id, "prove", true);
    const pending = pendingTasks(id);
    if (pending.length) die(`${pending.length} implementation task(s) remain unchecked`);
    const snapshot = options.snapshot || relevantSnapshot(id, null, true);
    const state = loadRuntime(id);
    const proofRunId = `proof-${Date.now()}`;
    state.activeProofRun = {
      id: proofRunId,
      snapshotId: snapshot.id,
      workspaceHash: snapshot.workspaceHash,
      startedAt: now()
    };
    saveRuntime(state);
    for (const provider of requiredProviders(id)) {
      const row = receiptValidity(id, provider, snapshot.workspaceHash);
      if (row.validity === "reusable-inputs")
        rebindReusableReceipt(id, row, snapshot, proofRunId);
    }
    let sessions = [];
    try {
      const hash = snapshot.workspaceHash;
      const { nodes, unconfigured, unavailable } =
        options.execution || executionNodes(id, hash);
      if (unconfigured.length)
        throw new Error(`missing executable adapter for provider(s): ${unconfigured.join(", ")}; record external receipts or configure evidence v2`);
      if (unavailable.length)
        throw new Error(`provider environment unavailable: ${unavailable.join(", ")}; run doctor --stage prove --change ${id}`);
      const reservation = reserveProviderExecution(
        id, options.command || "proof execute", snapshot.workspaceHash,
        nodes.map((node) => node.provider), options);
      if (reservation) {
        clearActiveProofRun(id);
        return reservation;
      }
      sessions = await startTrackedServices(id, nodes, proofRunId);
      if (nodes.length) await runExecutionDag(id, nodes, proofRunId, {
        quiet: options.quiet
      });
      else if (!options.quiet)
        console.log(`EXECUTION ${proofRunId}: all receipts reused`);
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
      if (options.manageReservation !== false && nodes.length) {
        writeAdvance(id, {
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
        });
      }
      return { status: audit.valid ? "PASS" : "ACTION_REQUIRED", proofRunId };
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
    if (readiness.status !== "READY") {
      const stopped = {
        ...readiness,
        command: "proof run",
        completed: false
      };
      if (!options.quiet) printOutcome(stopped);
      markBlocked();
      process.exitCode = 2;
      return readiness;
    }
    const executionResult = await proofExecuteUnlocked(id, {
      preflight: false,
      snapshot: options.snapshot,
      quiet: options.quiet,
      command: "proof run",
      manageReservation: options.manageReservation
    });
    if (executionResult?.stage === "execution-indeterminate" ||
        executionResult?.status === "ACTION_REQUIRED") return executionResult;
    const audit = proofAudit(id, true);
    if (!audit.valid)
      die(`proof run audit failed: ${audit.reason}`);
    const proof = readJson(proofPath(id));
    const outcome = {
      version: 1,
      changeId: id,
      command: "proof run",
      status: "PASS",
      completed: true,
      proofRunId: proof.proofRunId || null,
      workspaceHash: proof.workspaceHash,
      providers: proof.providers || []
    };
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

  function writeReviewRepairStop(id, readiness, advanceStart, {
    requests = [], failures = [], executedProviders = []
  } = {}) {
    const reviewProvider = requiredProviders(id).find((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === "review") || "review";
    const subjectHash = currentProviderHash(
      id, reviewProvider, readiness.workspaceHash);
    const repairBatch = reviewRepairBatch(id);
    const noProgress = advanceStart.stage === "review-rejected" &&
      advanceStart.subjectHash === subjectHash;
    return writeAdvance(id, {
      version: 1,
      changeId: id,
      command: "proof advance",
      status: noProgress ? "REPAIR_NOT_PROGRESSING" : "ACTION_REQUIRED",
      route: repairBatch ? "AUTO_REPAIR" : "CONTRACT_DECISION_REQUIRED",
      stage: "review-rejected",
      completed: false,
      workspaceHash: readiness.workspaceHash,
      subjectHash,
      failures,
      requests,
      repairBatch,
      executedProviders,
      next: noProgress ? [] : [{
        kind: "correct-workspace",
        reason: repairBatch
          ? "Repair the bounded blocker/major finding batch; the Build packet carries the same repair context."
          : "The review was inconclusive or errored. Repair its infrastructure or make a contract decision before another request.",
        command: `claude-foundation packet ${id} --phase build`
      }]
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
      if (["valid", "reusable-inputs"].includes(row.validity)) return false;
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
    return requests.map((request) => ({
      requestId: request.requestId,
      provider: request.provider,
      command: stage === "review" && request.status === "requested" &&
          request.mainSessionFallback
        ? `claude-foundation authority run ${id} --request ${request.requestId} --subject-actor ${request.mainSessionFallback.subject?.identity || "<implementer>"} --main-session-model-family <family> --main-session-model <model>`
        : stage === "review" && request.status === "requested"
          ? `claude-foundation authority run ${id} --request ${request.requestId} --subject-actor <implementer> [AI subject provenance options]`
        : `claude-foundation authority status ${id} --request ${request.requestId} --template`
    }));
  }

  function requestMissingAuthority(id, providers, type, workspaceHash, knownRequests) {
    const openStatuses = ["requested", "dispatched", "pending"];
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

  async function advanceUnlocked(id, flags = {}) {
    const advanceStart = readAdvance(id);
    let readiness = proofReadinessValue(id, "prove");
    const audit = proofAudit(id, true);
    let forcedSnapshot = null;
    if (readiness.status === "READY" && audit.valid) {
      // Audit proves the copied evidence was not tampered with; it does not
      // prove that evidence still belongs to the current files. Force one
      // snapshot before reuse so neither a cached relevant hash nor an intact
      // stale proof can turn into a false PASS.
      forcedSnapshot = relevantSnapshot(id, null, true);
      if (readiness.workspaceHash !== forcedSnapshot.workspaceHash)
        readiness = proofReadinessValue(id, "prove");
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
    if (!["READY", "NEEDS_USER_DECISION"].includes(readiness.status)) {
      const outcome = writeAdvance(id, {
        ...readiness,
        command: "proof advance",
        completed: false,
        stage: "blocked",
        requests: [],
        executedProviders: []
      });
      markBlocked();
      process.exitCode = 2;
      return printOutcome(outcome);
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
        : writeAdvance(id, {
        version: 1,
        changeId: id,
        command: "proof advance",
        status: "ACTION_REQUIRED",
        stage,
        completed: false,
        workspaceHash: readiness.workspaceHash,
        failures: failedEvidence,
        requests: [],
        executedProviders: [],
        next: [{
          kind: "correct-failed-evidence",
          reason: "A provider returned or retained a terminal invalid result. Correct the implementation, evidence, or authority provenance before advancing again.",
          command: `claude-foundation packet ${id} --phase build`
        }]
        });
      markBlocked();
      process.exitCode = 2;
      return printOutcome(outcome);
    }

    let reviewProviders = missingByCapability(id, readiness, "review");
    let authorityRequests = readiness.status === "NEEDS_USER_DECISION"
      ? statusRequests(id) : [];
    const rejected = currentRequests(
      id, reviewProviders, readiness.workspaceHash,
      ["rejected"], authorityRequests);
    if (rejected.length) {
      const outcome = writeReviewRepairStop(id, readiness, advanceStart, {
        requests: rejected
      });
      markBlocked();
      process.exitCode = 2;
      return printOutcome(outcome);
    }
    const earlyAcceptanceProviders = missingByCapability(
      id, readiness, "acceptance");
    const rejectedAcceptance = currentRequests(
      id, earlyAcceptanceProviders, readiness.workspaceHash,
      ["rejected"], authorityRequests);
    if (!reviewProviders.length && rejectedAcceptance.length) {
      const outcome = writeAdvance(id, {
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
      });
      markBlocked();
      process.exitCode = 2;
      return printOutcome(outcome);
    }

    const snapshot = forcedSnapshot || relevantSnapshot(id, null, true);
    const reusable = requiredProviders(id)
      .map((provider) => receiptValidity(id, provider, snapshot.workspaceHash))
      .filter((row) => row.validity === "reusable-inputs");
    if (reusable.length) {
      const reuseRunId = `advance-reuse-${Date.now()}`;
      for (const row of reusable)
        rebindReusableReceipt(id, row, snapshot, reuseRunId);
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
    const execution = executionNodes(id, snapshot.workspaceHash);
    const collectable = collectableExecutionNodes(
      id, execution.nodes, snapshot.workspaceHash);
    let executedProviders = [];
    if (collectable.nodes.length) {
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
        markBlocked();
        process.exitCode = 2;
        return printOutcome(outcome);
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
        markBlocked();
        process.exitCode = 2;
        return printOutcome(outcome);
      }
    }

    // Two delivered AI waves are the end of the open-review route, not the
    // beginning of a human/third-AI loop. If the final delta found an
    // in-contract defect, its structured claim/case bindings let current
    // executable evidence close only those IDs. This operation is a durable
    // hash-chained deterministic attempt; it cannot invent a pass while any
    // non-review provider is stale or failing.
    const delivered = deliveredAiAttempts(id);
    const boundedReviewProviders = missingByCapability(id, readiness, "review");
    if (delivered.length >= 2 && delivered.at(-1)?.resultStatus === "fail" &&
        boundedReviewProviders.length) {
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
        markBlocked();
        process.exitCode = 2;
        return printOutcome(outcome);
      }
      if (closures.some((row) => row.closed)) {
        readiness = proofReadinessValue(id, "prove");
        authorityRequests = readiness.status === "NEEDS_USER_DECISION"
          ? statusRequests(id) : [];
      }
    }

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

    reviewProviders = missingByCapability(id, readiness, "review");
    if (reviewProviders.length) {
      const terminal = currentRequests(
        id, reviewProviders, readiness.workspaceHash,
        ["rejected"], authorityRequests);
      if (terminal.length) {
        const outcome = writeReviewRepairStop(id, readiness, advanceStart, {
          requests: terminal, executedProviders
        });
        markBlocked();
        process.exitCode = 2;
        return printOutcome(outcome);
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
        markBlocked();
        process.exitCode = 2;
        return printOutcome(outcome);
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

    // NEEDS_USER_DECISION without a classified external provider is an
    // invariant violation in readiness; surface it instead of spinning.
    die(`proof advance could not classify readiness for '${id}'`);
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
    const locked = await withProofAdvanceLock(id, () => advanceUnlocked(id, flags));
    if (locked.acquired) return locked.value;
    return mutationInProgress(id, "proof advance", locked);
  }

  return {
    guardProofMutation,
    proofAdvance,
    proofCollect,
    proofExecute,
    proofFinalize,
    proofRun
  };
}
