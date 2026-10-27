import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { validityRecovery } from "./receipt-validity.mjs";
import { proofRolloutGates } from "./provider-catalog.mjs";
import { resolveTaskExecutionAuthority } from "../core/task-execution-authority.mjs";
import { transitionLifecycleState } from "../core/lifecycle-reducer.mjs";

export function taskPacketWasPrecompletedOperation({
  loadRuntime, activeChangePath, exists, fileDigest
}, id) {
  const state = loadRuntime(id);
  // Before isolation, a checked task is necessarily pre-existing packet state.
  // Once a workspace exists, require its captured digest and fail closed when
  // the snapshot is absent or the packet changed.
  if (!state.workspace || (state.workspace.mode === "current" &&
      !state.workspace.packetSnapshot)) return true;
  const expected = state.workspace?.packetSnapshot?.["tasks.md"] || null;
  const path = join(activeChangePath(id), "tasks.md");
  return Boolean(expected && exists(path) && fileDigest(path) === expected);
}

function passingTaskNode(node, source, resultAuthority) {
  return {
    nodeId: node.id, lifecycle: node.lifecycle, status: "pass", source, claims: node.claims,
    ...(resultAuthority ? { resultAuthority } : {})
  };
}
function acceptedTaskResultProof(root, fileDigest, resultRecord, result, node, taskId, runRoot) {
  const destination = join(runRoot, "nodes", `${taskId}.json`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(resultRecord.path, destination);
  return passingTaskNode(node, "accepted-lease-result", {
    planDigest: result.planDigest, workspaceHash: result.workspaceHash, leaseId: result.leaseId,
    fencingGeneration: result.fencingGeneration, executionAttempt: result.executionAttempt,
    path: relative(root, destination).replaceAll("\\", "/"),
    sha256: fileDigest(destination), size: statSync(destination).size
  });
}
// Every task node passes only through task execution authority. The review
// circuit governs review dispatch, never Build verification, and a change
// created before graph execution existed is re-verified by `advance` (its
// ticked tasks lack execution authority) rather than trusted unchecked.
export function taskNodeProof({ root, fileDigest, taskPacketWasPrecompleted,
  taskResult, savedAgentPlan, contractFingerprint, taskLease, fail
}, id, node, graph, state, runRoot) {
  const taskId = node.id.replace(/^task:/, "");
  if (taskPacketWasPrecompleted?.(id))
    return passingTaskNode(node, "precompleted-at-isolation");
  const resultRecord = taskResult?.(id, taskId) || null;
  const authority = resolveTaskExecutionAuthority({
    id, taskId, node, graph, state, savedPlan: savedAgentPlan?.(id) || {},
    resultRecord, taskLease: taskLease?.(id, taskId) || null,
    currentContractFingerprint: contractFingerprint?.(id) || null
  });
  if (authority.status === "accepted-lease-result")
    return acceptedTaskResultProof(root, fileDigest, resultRecord,
      resultRecord.value, node, taskId, runRoot);
  if (authority.status === "single-agent-observed")
    return passingTaskNode(node, "single-agent-observed");
  if (authority.status === "compatible-legacy-single-session") return {
    ...passingTaskNode(node, "single-agent-observed"),
    compatibility: authority.compatibility
  };
  fail(`task node '${node.id}' requires current Build verification: ${authority.reason}; ` +
    `next: claude-foundation advance ${id} --through proven`);
}

export function createProofRuntime({
  root, protocolVersion, loadRuntime, saveRuntime, validate, changedSurfaceIssues,
  activeChangeLeases, pendingTasks, clearSnapshotCache, relevantSnapshot,
  requiredProviders, advisoryCapabilities, receiptValidity, proofRunRoot, receiptPath, fileDigest,
  protocolDescriptor, contractFingerprint, executionFingerprint, proofPath,
  writeJson, readJson, pathInside, validateArtifact, instructionProvenance,
  agentPlanValue = null, savedAgentPlan = null, taskResult = null,
  taskLease = null, taskPacketWasPrecompleted = null,
  selectedRepositories = () => [], git = null, rolloutGates = () => [], now, fail
}) {
  function assertReadRepositoriesUnchanged(id, state) {
    if (!git) return;
    for (const repository of selectedRepositories(id, state)) {
      if (repository.mode !== "read" || state.repositories?.[repository.id]?.mode !== "worktree")
        continue;
      const changed = git(["status", "--porcelain"], repository.workspacePath);
      if (changed.status !== 0 || changed.stdout.trim())
        fail(`read-only repository '${repository.id}' changed inside its sandbox: ${
          changed.stdout.trim() || changed.stderr.trim() || "git status failed"}`);
    }
  }

  const taskNodeDependencies = { root, fileDigest, taskPacketWasPrecompleted,
    taskResult, savedAgentPlan, contractFingerprint, taskLease, fail };

  function assertProviderChecks(id, state, hash, checks) {
    const blockers = checks.filter((row) => row.validity !== "valid");
    if (!blockers.length) return;
    const summary = blockers.map((row) => `${row.provider}:${row.validity}`).join(", ");
    const executedHash = state.activeProofRun?.workspaceHash;
    if (executedHash && executedHash !== hash &&
        blockers.every((row) => row.validity === "stale"))
      fail(`${summary} — the workspace hash changed while providers ran (${
        executedHash.slice(0, 12)} to ${hash.slice(0, 12)}), so a provider wrote inside the hashed surface. Reports and artifacts must be written to a directory excluded from the surface, such as test-results/`);
    if (blockers.every((row) => row.validity === "missing"))
      fail(`${summary} — no evidence has been executed for this workspace; next: claude-foundation proof run ${id}`);
    fail(`${summary}\n${blockers.map((row) =>
      `  ${row.provider}: ${validityRecovery(row.validity, id, row.provider)}`).join("\n")}`);
  }

  function finalizeReadiness(id, state) {
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    validate(id, "active", { quiet: true });
    const surfaceIssues = changedSurfaceIssues(id);
    if (surfaceIssues.length) fail(`changed-surface authority failed: ${surfaceIssues.join("; ")}`);
    assertReadRepositoriesUnchanged(id, state);
    const leases = activeChangeLeases(id);
    if (leases.length)
      fail(`active agent leases block proof: ${leases.map((lease) => lease.taskId).join(", ")}`);
    const pending = pendingTasks(id);
    if (pending.length) fail(`${pending.length} implementation task(s) remain unchecked`);
    clearSnapshotCache(id);
    const snapshot = relevantSnapshot(id, null, true);
    const hash = snapshot.workspaceHash;
    const checks = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
    assertProviderChecks(id, state, hash, checks);
    return { snapshot, hash, checks };
  }

  function copyProofReceipts(id, runRoot, checks) {
    return checks.map((row) => {
      const source = receiptPath(id, row.provider);
      const destination = join(runRoot, "receipts", `${row.provider}.json`);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination);
      return {
        provider: row.provider,
        repositoryId: row.receipt?.repositoryId || null,
        repositoryIds: row.receipt?.repositoryIds || [],
        path: relative(root, destination).replaceAll("\\", "/"),
        sha256: fileDigest(destination),
        size: statSync(destination).size
      };
    });
  }

  function excludedProofReceipts(id, checks) {
    const requiredProviderNames = new Set(checks.map((row) => row.provider));
    const receiptDirectory = dirname(receiptPath(id, "__provider__"));
    const currentContractFingerprint = contractFingerprint(id);
    return existsSync(receiptDirectory)
      ? readdirSync(receiptDirectory).filter((name) => name.endsWith(".json") &&
        name !== "proof.json" && !requiredProviderNames.has(name.slice(0, -5)))
        .map((name) => {
          const provider = name.slice(0, -5);
          const receipt = readJson(join(receiptDirectory, name), {});
          return {
            provider,
            status: receipt.status || "unknown",
            validity: receipt.contractFingerprint !== currentContractFingerprint
              ? "contract-stale" : "not-required",
            contractFingerprint: receipt.contractFingerprint || null,
            currentContractFingerprint
          };
        }).sort((left, right) => left.provider.localeCompare(right.provider))
      : [];
  }

  function graphProofValue(id, graph, state, runRoot, hash) {
    const proofNodes = (graph?.nodes || []).filter((node) =>
      node.required && node.lifecycle !== "land");
    const nodeProofs = proofNodes.map((node) => node.kind === "task"
      ? taskNodeProof(taskNodeDependencies, id, node, graph, state, runRoot)
      : {
          nodeId: node.id, lifecycle: node.lifecycle, status: "pass",
          source: "provider-receipt", claims: node.claims,
          repositories: node.repositories || (node.repository ? [node.repository] : [])
        });
    const proofEdges = (graph?.edges || []).filter((edge) =>
      proofNodes.some((node) => node.id === edge.to));
    const aggregate = graph ? {
      version: 1,
      status: "pass",
      graphRevision: graph.revision,
      graphIdentity: graph.identity,
      workspaceHash: hash,
      requiredNodes: proofNodes.map((node) => node.id),
      coveredNodes: proofNodes.map((node) => node.id),
      requiredEdges: proofEdges.map((edge) => edge.id),
      coveredEdges: proofEdges.map((edge) => edge.id)
    } : null;
    return { nodeProofs, aggregate };
  }

  function finalizedProof(id, proofRunId, state, snapshot, hash, checks,
    receiptEntries, excludedReceipts, graph, graphProof) {
    return {
      version: 2,
      proofProtocolVersion: protocolVersion,
      protocols: protocolDescriptor(),
      changeId: id,
      proofRunId,
      status: "pass",
      workspaceHash: hash,
      workspaceSnapshotId: snapshot.id,
      repositories: snapshot.repositories || null,
      contractFingerprint: contractFingerprint(id),
      executionFingerprint: executionFingerprint(id),
      graphRevision: graph?.revision || null,
      graphIdentity: graph?.identity || null,
      nodeProofs: graphProof.nodeProofs,
      aggregateGraphProof: graphProof.aggregate,
      providers: checks.map((row) => row.provider),
      advisories: advisoryCapabilities?.(id) || [],
      rolloutGates: rolloutGates(id),
      receipts: receiptEntries,
      excludedReceipts,
      artifacts: state.activeProofRun?.serviceArtifacts ||
        state.collectedServiceArtifacts || [],
      instructionProvenance: instructionProvenance?.(id) || null,
      createdAt: now()
    };
  }

  function persistFinalizedProof(id, runRoot, proof) {
    writeJson(proofPath(id), proof);
    writeJson(join(runRoot, "manifest.json"), proof);
    const state = loadRuntime(id);
    transitionLifecycleState(state, "proven", "proof-finalized");
    delete state.collectedServiceArtifacts;
    saveRuntime(state);
  }

  function reportFinalizedProof(id, hash, proof, excludedReceipts, options) {
    if (!options.quiet)
      console.log(`PROVEN ${id}\n  workspace: ${hash}\n  providers: ${proof.providers.join(", ")}` +
        `${excludedReceipts.length ? `\n  excluded receipts: ${excludedReceipts.map((row) =>
          `${row.provider}:${row.validity}`).join(", ")}` : ""}${proofRolloutGates(proof, { deferred: true }).length
          ? `\n  rollout gates (deferred): ${proofRolloutGates(proof, { deferred: true }).map((row) =>
            row.capability).join(", ")}` : ""}\n  next: /land ${id}`);
  }

  function finalize(id, requestedProofRunId, suppliedOptions) {
    const options = Object.assign({}, suppliedOptions);
    const state = loadRuntime(id);
    const { snapshot, hash, checks } = finalizeReadiness(id, state);
    // The audit rejects a proof without receipts (`missing-receipt-manifest`),
    // so writing one would report PROVEN for a change Land cannot accept.
    if (!checks.length)
      fail(`missing-receipt-manifest: change '${id}' has no required evidence left, so its proof ` +
        "would carry no receipts and Land would refuse it. A recorded waiver may have withdrawn " +
        `every required capability: revoke it with claude-foundation change waive ${id} ` +
        "--capability <capability> --revoke --decision-ref <ref>, or amend the agreement");
    const proofRunId = requestedProofRunId || state.activeProofRun?.id || `proof-${Date.now()}`;
    const runRoot = proofRunRoot(id, proofRunId);
    const receiptEntries = copyProofReceipts(id, runRoot, checks);
    const excludedReceipts = excludedProofReceipts(id, checks);
    const graph = agentPlanValue?.(id)?.graph || null;
    const graphProof = graphProofValue(id, graph, state, runRoot, hash);
    const proof = finalizedProof(id, proofRunId, state, snapshot, hash, checks,
      receiptEntries, excludedReceipts, graph, graphProof);
    persistFinalizedProof(id, runRoot, proof);
    reportFinalizedProof(id, hash, proof, excludedReceipts, options);
  }

  function proofEnvelopeIssue(proof) {
    if (!proof || proof.status !== "pass") return { valid: false, reason: "missing-proof" };
    if (String(proof.proofProtocolVersion || "") !== protocolVersion)
      return { valid: false, reason: "proof-version-stale" };
    if (!Array.isArray(proof.receipts) || proof.receipts.length === 0)
      return { valid: false, reason: "missing-receipt-manifest" };
    return null;
  }

  function durableProofFileValid(id, proofRunId, entry) {
    const path = resolve(root, entry.path || "");
    return pathInside(proofRunRoot(id, proofRunId), path) &&
      existsSync(path) && statSync(path).isFile() &&
      fileDigest(path) === entry.sha256 && statSync(path).size === Number(entry.size);
  }

  function aggregateProofIssue(id, proof) {
    const aggregate = proof.aggregateGraphProof;
    if (!aggregate) return null;
    if (aggregate.status !== "pass" || aggregate.graphIdentity !== proof.graphIdentity ||
        aggregate.graphRevision !== proof.graphRevision ||
        aggregate.workspaceHash !== proof.workspaceHash)
      return { valid: false, reason: "aggregate-graph-proof-identity" };
    if ((aggregate.requiredNodes || []).some((nodeId) =>
      !(aggregate.coveredNodes || []).includes(nodeId)) ||
        (aggregate.requiredEdges || []).some((edgeId) =>
          !(aggregate.coveredEdges || []).includes(edgeId)))
      return { valid: false, reason: "aggregate-graph-proof-incomplete" };
    const nodeProofs = new Map((proof.nodeProofs || []).map((row) => [row.nodeId, row]));
    if ((aggregate.requiredNodes || []).some((nodeId) =>
      nodeProofs.get(nodeId)?.status !== "pass"))
      return { valid: false, reason: "aggregate-node-proof-missing" };
    for (const row of nodeProofs.values()) {
      if (row.source !== "accepted-lease-result") continue;
      if (!durableProofFileValid(id, proof.proofRunId, row.resultAuthority || {}))
        return { valid: false, reason: `node-result-tampered:${row.nodeId || "unknown"}` };
    }
    return null;
  }

  function receiptProofIssue(id, proof) {
    for (const entry of proof.receipts) {
      if (!durableProofFileValid(id, proof.proofRunId, entry))
        return { valid: false, reason: `receipt-tampered:${entry.provider || "unknown"}` };
      const path = resolve(root, entry.path || "");
      const receipt = readJson(path);
      const invalidArtifact = (receipt.artifacts || []).find((artifact) =>
        artifact.required !== false && !validateArtifact(artifact));
      if (invalidArtifact)
        return { valid: false, reason: `artifact-tampered:${entry.provider || "unknown"}` };
    }
    return null;
  }

  function proofArtifactIssue(proof) {
    if ((proof.artifacts || []).some((artifact) =>
      artifact.required !== false && !validateArtifact(artifact)))
      return { valid: false, reason: "proof-artifact-tampered" };
    return null;
  }

  function audit(id, quiet) {
    const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
    const issue = proofEnvelopeIssue(proof) || aggregateProofIssue(id, proof) ||
      receiptProofIssue(id, proof) || proofArtifactIssue(proof);
    if (issue) return issue;
    if (!quiet) console.log(`PROOF AUDIT ${id}: valid\n  run: ${proof.proofRunId}`);
    return { valid: true, proof };
  }

  return { finalize, audit };
}
