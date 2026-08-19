import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { validityRecovery } from "./receipt-validity.mjs";
import { singleAgentExecutionEligible } from "../core/graph-execution.mjs";

export function createProofRuntime({
  root, protocolVersion, loadRuntime, saveRuntime, validate, changedSurfaceIssues,
  activeChangeLeases, pendingTasks, clearSnapshotCache, relevantSnapshot,
  requiredProviders, advisoryCapabilities, receiptValidity, proofRunRoot, receiptPath, fileDigest,
  protocolDescriptor, contractFingerprint, executionFingerprint, proofPath,
  writeJson, readJson, pathInside, validateArtifact, instructionProvenance,
  agentPlanValue = null, savedAgentPlan = null, taskResult = null,
  taskPacketWasPrecompleted = null, legacyExecutionPolicy = null,
  selectedRepositories = () => [], git = null, now, fail
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

  function pathCovered(path, scopes) {
    return (scopes || []).some((scope) => {
      const prefix = String(scope).replace(/\/\*\*?$/, "").replace(/\/$/, "");
      return scope === "*" || path === prefix || path.startsWith(`${prefix}/`);
    });
  }

  function taskNodeProof(id, node, graph, state, runRoot) {
    const taskId = node.id.replace(/^task:/, "");
    if (!state.graphExecutionVersion) return {
      nodeId: node.id, lifecycle: node.lifecycle, status: "pass",
      source: "legacy-upgrade", claims: node.claims
    };
    if (legacyExecutionPolicy?.()) return {
      nodeId: node.id, lifecycle: node.lifecycle, status: "pass",
      source: "legacy-policy", claims: node.claims
    };
    if (taskPacketWasPrecompleted?.(id)) return {
      nodeId: node.id, lifecycle: node.lifecycle, status: "pass",
      source: "precompleted-at-isolation", claims: node.claims
    };
    const resultRecord = taskResult?.(id, taskId) || null;
    const result = resultRecord?.value || null;
    if (result) {
      const mismatches = [];
      const expect = (field, actual, expected) => {
        if (String(actual ?? "") !== String(expected ?? "")) mismatches.push(field);
      };
      expect("taskId", result.taskId, taskId);
      expect("repository", result.repository, node.repository);
      expect("graphRevision", result.graphRevision, graph.revision);
      expect("graphIdentity", result.graphIdentity, graph.identity);
      expect("contractRevision", result.contractRevision, state.contractRevision);
      if (JSON.stringify([...(result.paths || [])].sort()) !==
          JSON.stringify([...(node.paths || [])].sort())) mismatches.push("paths");
      if (JSON.stringify([...(result.claimIds || [])].sort()) !==
          JSON.stringify([...(node.claims || [])].sort())) mismatches.push("claimIds");
      if (JSON.stringify(result.outputSchema || null) !==
          JSON.stringify(node.outputSchema || null)) mismatches.push("outputSchema");
      if (result.status !== "observed") mismatches.push("status");
      for (const field of ["planDigest", "workspaceHash", "leaseId"])
        if (!String(result[field] || "")) mismatches.push(field);
      for (const field of ["fencingGeneration", "executionAttempt"])
        if (!Number.isInteger(Number(result[field])) || Number(result[field]) < 1)
          mismatches.push(field);
      const unexpectedWrites = (result.observedWrites || [])
        .filter((path) => !pathCovered(path, node.paths));
      if (unexpectedWrites.length) mismatches.push("observedWrites");
      if (mismatches.length)
        fail(`task node '${node.id}' has stale or invalid result authority: ${[
          ...new Set(mismatches)].join(", ")}`);
      const destination = join(runRoot, "nodes", `${taskId}.json`);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(resultRecord.path, destination);
      return {
        nodeId: node.id, lifecycle: node.lifecycle, status: "pass",
        source: "accepted-lease-result", claims: node.claims,
        resultAuthority: {
          planDigest: result.planDigest, workspaceHash: result.workspaceHash,
          leaseId: result.leaseId, fencingGeneration: result.fencingGeneration,
          executionAttempt: result.executionAttempt,
          path: relative(root, destination).replaceAll("\\", "/"),
          sha256: fileDigest(destination), size: statSync(destination).size
        }
      };
    }
    const execution = savedAgentPlan?.(id)?.taskExecution?.[taskId];
    const taskNodes = graph.nodes.filter((entry) => entry.kind === "task");
    const singleAgentEligible = singleAgentExecutionEligible(taskNodes, graph.claims);
    const savedSingleAgent = execution?.mode === "single-agent-observed" &&
      execution.graphRevision === graph.revision && execution.graphIdentity === graph.identity;
    if (!savedSingleAgent && !singleAgentEligible)
      fail(`task node '${node.id}' lacks an accepted lease result; resume /build for its bounded repair scope`);
    return {
      nodeId: node.id, lifecycle: node.lifecycle, status: "pass",
      source: "single-agent-observed", claims: node.claims
    };
  }

  function finalize(id, requestedProofRunId = null, options = {}) {
    const stateBefore = loadRuntime(id);
    if (stateBefore.status === "archived") fail(`change '${id}' is already archived`);
    validate(id, "active", { quiet: true });
    const surfaceIssues = changedSurfaceIssues(id);
    if (surfaceIssues.length) fail(`changed-surface authority failed: ${surfaceIssues.join("; ")}`);
    assertReadRepositoriesUnchanged(id, stateBefore);
    const leases = activeChangeLeases(id);
    if (leases.length)
      fail(`active agent leases block proof: ${leases.map((lease) => lease.taskId).join(", ")}`);
    const pending = pendingTasks(id);
    if (pending.length) fail(`${pending.length} implementation task(s) remain unchecked`);
    clearSnapshotCache(id);
    const snapshot = relevantSnapshot(id, null, true);
    const hash = snapshot.workspaceHash;
    const checks = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
    const blockers = checks.filter((row) => row.validity !== "valid");
    if (blockers.length) {
      const summary = blockers.map((row) => `${row.provider}:${row.validity}`).join(", ");
      // Two blocked states are unreadable on their own, and both were reached
      // by following the documented route. Name the cause, not just the code.
      const executedHash = stateBefore.activeProofRun?.workspaceHash;
      // Providers ran in this same operation and the workspace moved under
      // them: something written during execution is inside the hashed surface,
      // so the run invalidated the receipts it had just produced.
      if (executedHash && executedHash !== hash &&
          blockers.every((row) => row.validity === "stale"))
        fail(`${summary} — the workspace hash changed while providers ran (${
          executedHash.slice(0, 12)} to ${hash.slice(0, 12)}), so a provider wrote inside the hashed surface. Reports and artifacts must be written to a directory excluded from the surface, such as test-results/`);
      // Nothing has executed yet. `prove` finalizes from receipts that already
      // exist; the operation that produces them is `proof run`.
      if (blockers.every((row) => row.validity === "missing"))
        fail(`${summary} — no evidence has been executed for this workspace; next: claude-foundation proof run ${id}`);
      // Every other mixture used to stop at the code list alone. Each code has a
      // route; printing them together is the difference between a diagnosis and
      // an instruction.
      fail(`${summary}\n${blockers.map((row) =>
        `  ${row.provider}: ${validityRecovery(row.validity, id, row.provider)}`).join("\n")}`);
    }
    const proofRunId = requestedProofRunId || stateBefore.activeProofRun?.id || `proof-${Date.now()}`;
    const runRoot = proofRunRoot(id, proofRunId);
    const receiptEntries = checks.map((row) => {
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
    const graph = agentPlanValue?.(id)?.graph || null;
    const proofNodes = (graph?.nodes || []).filter((node) =>
      node.required && node.lifecycle !== "land");
    const nodeProofs = proofNodes.map((node) => node.kind === "task"
      ? taskNodeProof(id, node, graph, stateBefore, runRoot)
      : {
          nodeId: node.id, lifecycle: node.lifecycle, status: "pass",
          source: "provider-receipt", claims: node.claims,
          repositories: node.repositories || (node.repository ? [node.repository] : [])
        });
    const proofEdges = (graph?.edges || []).filter((edge) =>
      proofNodes.some((node) => node.id === edge.to));
    const aggregateGraphProof = graph ? {
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
    const proof = {
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
      nodeProofs,
      aggregateGraphProof,
      providers: checks.map((row) => row.provider),
      advisories: advisoryCapabilities?.(id) || [],
      receipts: receiptEntries,
      // The execute path carries service logs on activeProofRun; the collect →
      // record-external-receipts → finalize path cleared activeProofRun long
      // before this runs, so its logs arrive via collectedServiceArtifacts.
      artifacts: stateBefore.activeProofRun?.serviceArtifacts ||
        stateBefore.collectedServiceArtifacts || [],
      instructionProvenance: instructionProvenance?.(id) || null,
      createdAt: now()
    };
    writeJson(proofPath(id), proof);
    writeJson(join(runRoot, "manifest.json"), proof);
    const state = loadRuntime(id);
    // No `provenHash` mirror here. Freshness is decided from
    // `proof.workspaceHash` against the current relevant hash, and the mirror
    // was read by nothing while three separate modules paid to invalidate it —
    // a field that looked authoritative and answered no question.
    state.status = "proven";
    // Consumed into the proof above; leaving it would attach this run's
    // service logs to a future, unrelated proof.
    delete state.collectedServiceArtifacts;
    saveRuntime(state);
    if (!options.quiet)
      console.log(`PROVEN ${id}\n  workspace: ${hash}\n  providers: ${proof.providers.join(", ")}\n  next: /land ${id}`);
  }

  function audit(id, quiet = false) {
    const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
    if (!proof || proof.status !== "pass") return { valid: false, reason: "missing-proof" };
    if (String(proof.proofProtocolVersion || "") !== protocolVersion)
      return { valid: false, reason: "proof-version-stale" };
    if (!Array.isArray(proof.receipts) || proof.receipts.length === 0)
      return { valid: false, reason: "missing-receipt-manifest" };
    if (proof.aggregateGraphProof) {
      const aggregate = proof.aggregateGraphProof;
      if (aggregate.status !== "pass" || aggregate.graphIdentity !== proof.graphIdentity ||
          aggregate.graphRevision !== proof.graphRevision ||
          aggregate.workspaceHash !== proof.workspaceHash)
        return { valid: false, reason: "aggregate-graph-proof-identity" };
      if ((aggregate.requiredNodes || []).some((id) =>
        !(aggregate.coveredNodes || []).includes(id)) ||
          (aggregate.requiredEdges || []).some((id) =>
            !(aggregate.coveredEdges || []).includes(id)))
        return { valid: false, reason: "aggregate-graph-proof-incomplete" };
      const nodeProofs = new Map((proof.nodeProofs || []).map((row) => [row.nodeId, row]));
      if ((aggregate.requiredNodes || []).some((id) =>
        nodeProofs.get(id)?.status !== "pass"))
        return { valid: false, reason: "aggregate-node-proof-missing" };
      for (const row of nodeProofs.values()) {
        if (row.source !== "accepted-lease-result") continue;
        const authority = row.resultAuthority || {};
        const path = resolve(root, authority.path || "");
        if (!pathInside(proofRunRoot(id, proof.proofRunId), path) ||
            !existsSync(path) || !statSync(path).isFile() ||
            fileDigest(path) !== authority.sha256 ||
            statSync(path).size !== Number(authority.size))
          return { valid: false, reason: `node-result-tampered:${row.nodeId || "unknown"}` };
      }
    }
    for (const entry of proof.receipts) {
      const path = resolve(root, entry.path || "");
      if (!pathInside(proofRunRoot(id, proof.proofRunId), path) ||
          !existsSync(path) || !statSync(path).isFile() ||
          fileDigest(path) !== entry.sha256 || statSync(path).size !== Number(entry.size))
        return { valid: false, reason: `receipt-tampered:${entry.provider || "unknown"}` };
      const receipt = readJson(path);
      const invalidArtifact = (receipt.artifacts || []).find((artifact) =>
        artifact.required !== false && !validateArtifact(artifact));
      if (invalidArtifact)
        return { valid: false, reason: `artifact-tampered:${entry.provider || "unknown"}` };
    }
    if ((proof.artifacts || []).some((artifact) =>
      artifact.required !== false && !validateArtifact(artifact)))
      return { valid: false, reason: "proof-artifact-tampered" };
    if (!quiet) console.log(`PROOF AUDIT ${id}: valid\n  run: ${proof.proofRunId}`);
    return { valid: true, proof };
  }

  return { finalize, audit };
}
