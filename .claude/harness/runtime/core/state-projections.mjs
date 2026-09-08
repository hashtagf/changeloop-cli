export const STATE_PROJECTION_VERSION = 1;

export function deriveChangeProjection({ state = {}, proof = null, currentHash = null }) {
  const proofCurrent = proof?.status === "pass" &&
    typeof currentHash === "string" && proof.workspaceHash === currentHash;
  const lifecycleStatus = state.status || "untracked";
  return {
    version: STATE_PROJECTION_VERSION,
    lifecycleStatus,
    readiness: proofCurrent ? "ready-to-land"
      : lifecycleStatus === "proven" ? "stale-proof" : lifecycleStatus,
    schema: state.schema || "unknown",
    proof: {
      status: proof?.status || "missing",
      runId: proof?.proofRunId || null,
      current: proofCurrent
    }
  };
}

export function deriveApplyProjection(state = {}, journal = null) {
  const mirror = state.workspace?.apply || null;
  if (!mirror?.transactionId)
    return { version: STATE_PROJECTION_VERSION, valid: false,
      reason: "missing-apply-transaction" };
  if (!journal)
    return { version: STATE_PROJECTION_VERSION, valid: false,
      reason: "missing-apply-journal", transactionId: mirror.transactionId };
  const projectionHash = journal.projectionHash || null;
  // Journals from the supported legacy format may omit the embedded ID because
  // their directory name is authoritative. Preserve that read compatibility;
  // an explicit conflicting ID still fails closed.
  const transactionId = journal.transactionId || mirror.transactionId;
  const transactionMatches = !journal.transactionId ||
    mirror.transactionId === journal.transactionId;
  return {
    version: STATE_PROJECTION_VERSION,
    valid: transactionMatches && mirror.projectionHash === projectionHash,
    reason: !transactionMatches
      ? "transaction-identity-mismatch"
      : mirror.projectionHash !== projectionHash
        ? "projection-identity-mismatch" : null,
    transactionId,
    projectionHash,
    status: journal.status || "unknown",
    touchedPaths: (journal.entries || []).map((entry) => entry.path)
  };
}
