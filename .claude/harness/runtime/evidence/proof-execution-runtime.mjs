export function createProofExecutionRuntime({
  proofReadinessValue, relevantSnapshot, loadRuntime, saveRuntime, now,
  requiredProviders, receiptValidity, rebindReusableReceipt, executionNodes,
  collectableExecutionNodes, startRequiredServices, runExecutionDag,
  durableArtifact, pendingTasks, proofPreflight, prove, proofAudit,
  readJson, proofPath, die, markBlocked = () => {}
}) {
  // Services outlive the run that started them unless something reclaims
  // them: die() is process.exit, which runs no finally block, and a signal
  // runs nothing at all. A server left holding its port answers the next
  // run's readiness probe, so the leak is not merely untidy — it hands a
  // different change a green suite.
  const liveSessions = new Set();
  let reclaimInstalled = false;

  function stopSession(session) {
    if (!liveSessions.delete(session)) return null;
    try { return session.stop(); } catch { return null; }
  }

  function stopAll(sessions) {
    return [...sessions].reverse().map(stopSession).filter(Boolean);
  }

  function installReclaim() {
    if (reclaimInstalled) return;
    reclaimInstalled = true;
    const reclaim = () => [...liveSessions].reverse().forEach(stopSession);
    process.on("exit", reclaim);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.on(signal, () => { reclaim(); process.exit(130); });
  }

  async function startTrackedServices(id, nodes, proofRunId) {
    installReclaim();
    const sessions = await startRequiredServices(id, nodes, proofRunId);
    sessions.forEach((session) => liveSessions.add(session));
    return sessions;
  }

  function clearActiveProofRun(id) {
    const current = loadRuntime(id);
    delete current.activeProofRun;
    saveRuntime(current);
  }

  async function proofCollect(id) {
    const readiness = proofReadinessValue(id, "prove");
    if (!["READY", "NEEDS_USER_DECISION"].includes(readiness.status)) {
      console.log(JSON.stringify({
        ...readiness,
        command: "proof collect",
        completed: false
      }, null, 2));
      markBlocked();
      process.exitCode = 2;
      return readiness;
    }
    const snapshot = relevantSnapshot(id, null, true);
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
      const { nodes, unavailable } = executionNodes(id, snapshot.workspaceHash);
      // Throw rather than die: die() is process.exit, so it would skip the
      // catch that stops services and the cleanup that clears activeProofRun.
      if (unavailable.length)
        throw new Error(`provider environment unavailable: ${unavailable.join(", ")}; run doctor --stage prove --change ${id}`);
      const collectable = collectableExecutionNodes(id, nodes, snapshot.workspaceHash);
      sessions = await startTrackedServices(id, collectable.nodes, proofRunId);
      const outcomes = collectable.nodes.length
        ? await runExecutionDag(id, collectable.nodes, proofRunId)
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
      console.log(JSON.stringify(outcome, null, 2));
      return outcome;
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
  
  async function proofExecute(id) {
    proofPreflight(id, "prove", true);
    const pending = pendingTasks(id);
    if (pending.length) die(`${pending.length} implementation task(s) remain unchecked`);
    const snapshot = relevantSnapshot(id, null, true);
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
      const { nodes, unconfigured, unavailable } = executionNodes(id, hash);
      if (unconfigured.length)
        throw new Error(`missing executable adapter for provider(s): ${unconfigured.join(", ")}; record external receipts or configure evidence v2`);
      if (unavailable.length)
        throw new Error(`provider environment unavailable: ${unavailable.join(", ")}; run doctor --stage prove --change ${id}`);
      sessions = await startTrackedServices(id, nodes, proofRunId);
      if (nodes.length) await runExecutionDag(id, nodes, proofRunId);
      else console.log(`EXECUTION ${proofRunId}: all receipts reused`);
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
      prove(id, proofRunId);
    } catch (error) {
      stopAll(sessions);
      clearActiveProofRun(id);
      die(error.message);
    } finally {
      clearActiveProofRun(id);
    }
  }
  
  async function proofRun(id) {
    const readiness = proofReadinessValue(id, "prove");
    if (readiness.status !== "READY") {
      console.log(JSON.stringify({
        ...readiness,
        command: "proof run",
        completed: false
      }, null, 2));
      markBlocked();
      process.exitCode = 2;
      return readiness;
    }
    await proofExecute(id);
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
    console.log(JSON.stringify(outcome, null, 2));
    return outcome;
  }

  return { proofCollect, proofExecute, proofRun };
}
