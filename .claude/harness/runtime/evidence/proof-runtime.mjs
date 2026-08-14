import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { validityRecovery } from "./receipt-validity.mjs";

export function createProofRuntime({
  root, protocolVersion, loadRuntime, saveRuntime, validate, changedSurfaceIssues,
  activeChangeLeases, pendingTasks, clearSnapshotCache, relevantSnapshot,
  requiredProviders, advisoryCapabilities, receiptValidity, proofRunRoot, receiptPath, fileDigest,
  protocolDescriptor, contractFingerprint, executionFingerprint, proofPath,
  writeJson, readJson, pathInside, validateArtifact, instructionProvenance, now, fail
}) {
  function finalize(id, requestedProofRunId = null) {
    const stateBefore = loadRuntime(id);
    if (stateBefore.status === "archived") fail(`change '${id}' is already archived`);
    validate(id, "active", { quiet: true });
    const surfaceIssues = changedSurfaceIssues(id);
    if (surfaceIssues.length) fail(`changed-surface authority failed: ${surfaceIssues.join("; ")}`);
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
        path: relative(root, destination).replaceAll("\\", "/"),
        sha256: fileDigest(destination),
        size: statSync(destination).size
      };
    });
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
      providers: checks.map((row) => row.provider),
      // Additive and optional, so it carries no protocol bump: a reader that
      // ignores it behaves exactly as before, and an older proof simply lacks
      // it. Bumping `proofProtocol` for an informational field would invalidate
      // every in-flight proof on upgrade — the same class of stuck state this
      // field exists to document.
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
    console.log(`PROVEN ${id}\n  workspace: ${hash}\n  providers: ${proof.providers.join(", ")}\n  next: /land ${id}`);
  }

  function audit(id, quiet = false) {
    const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
    if (!proof || proof.status !== "pass") return { valid: false, reason: "missing-proof" };
    if (String(proof.proofProtocolVersion || "") !== protocolVersion)
      return { valid: false, reason: "proof-version-stale" };
    if (!Array.isArray(proof.receipts) || proof.receipts.length === 0)
      return { valid: false, reason: "missing-receipt-manifest" };
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
