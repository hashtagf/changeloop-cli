function boundedStrings(values, limit = 20) {
  return [...new Set((values || []).map((value) => String(value || "").trim())
    .filter(Boolean))].sort().slice(0, limit);
}

export function derivedReviewRepairGraph(attempt, stableHash) {
  const allFindings = (attempt?.findings || [])
    .filter((finding) => ["blocker", "major"].includes(finding.severity));
  const findings = allFindings.slice(0, 8);
  const nodes = findings.map((finding, index) => {
    const paths = boundedStrings(finding.path ? [finding.path] : finding.paths, 12);
    const priorConflicts = findings.slice(0, index).flatMap((prior, priorIndex) => {
      const priorPaths = boundedStrings(prior.path ? [prior.path] : prior.paths, 12);
      return paths.some((path) => priorPaths.includes(path))
        ? [`repair-${String(priorIndex + 1).padStart(3, "0")}`] : [];
    });
    return {
      id: `repair-${String(index + 1).padStart(3, "0")}`,
      findingIds: [String(finding.id)],
      severity: finding.severity,
      paths,
      claimIds: boundedStrings(finding.claimIds),
      criticalCaseIds: boundedStrings(finding.verificationCaseIds),
      dependencies: boundedStrings(priorConflicts),
      sourceAttemptDigest: attempt.digest,
      sourceWorkspaceHash: attempt.workspaceHash
    };
  });
  return {
    version: 1,
    kind: "review-repair-graph",
    sourceAttemptDigest: attempt?.digest || null,
    sourceWorkspaceHash: attempt?.workspaceHash || null,
    totalFindingIds: allFindings.map((finding) => String(finding.id)),
    truncated: allFindings.length > findings.length,
    nodes,
    digest: stableHash(nodes)
  };
}

export function repairActionForWorkspace(attempt, workspaceHash, stableHash) {
  const graph = derivedReviewRepairGraph(attempt, stableHash);
  if (!graph.nodes.length || attempt?.resultStatus !== "fail") return null;
  return {
    version: 1,
    action: graph.sourceWorkspaceHash === workspaceHash
      ? "EXECUTE_REPAIR_BATCH" : "RUN_INVALIDATED_EVIDENCE",
    repairGraph: graph
  };
}
