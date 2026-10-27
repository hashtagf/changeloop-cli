// Resume is a view of today's contract and execution frontier, never a cache.
export function archivedResumeSource({
  id, state, version, root, references, tasks, externalOperations, stableHash
}) {
  const value = {
    version: Number(version), changeId: id, status: "archived",
    controlProjectRoot: root, workspacePath: null, workspaceHash: null,
    revision: state.revision, contractRevision: state.contractRevision,
    executionRevision: state.executionRevision,
    historicalWorkspaceHash: state.preArchiveWorkspaceHash || null,
    pendingTaskCount: tasks.filter((task) => !task.done).length,
    references, providers: [], evidenceAvailability: "retained-archive",
    evidenceReference: `claude-foundation proof audit ${id}`,
    externalOperations
  };
  return { ...value, packetDigest: stableHash(value) };
}

export function resumePacketValue({ packet, action, tasks, leases, stableHash, limit }) {
  const completed = new Set(tasks.filter((task) => task.done).map((task) => task.id));
  const frontier = tasks.filter((task) => !task.done &&
    (task.dependsOn || []).every((id) => completed.has(id)));
  const bounded = (rows, count) => ({
    count: rows.length, preview: rows.slice(0, count),
    truncated: rows.length > count, digest: stableHash(rows)
  });
  const value = {
    version: packet.version, packetType: "global", view: "resume",
    changeId: packet.changeId,
    controlProjectRoot: packet.controlProjectRoot,
    workspacePath: packet.workspacePath,
    status: packet.status,
    revision: packet.revision,
    contractRevision: packet.contractRevision,
    executionRevision: packet.executionRevision,
    workspaceHash: packet.compositeWorkspaceHash || packet.workspaceHash,
    historicalWorkspaceHash: packet.historicalWorkspaceHash || null,
    sourcePacketDigest: packet.packetDigest,
    pendingTaskCount: packet.pendingTaskCount,
    frontier: bounded(frontier.map(({ id, repository, dependsOn }) =>
      ({ id, repository, dependsOn })), 12),
    leases: bounded(leases.map(({ taskId, owner, leaseId, fencingGeneration, expiresAt }) =>
      ({ taskId, owner, leaseId, fencingGeneration, expiresAt })), 12),
    nextAction: {
      action: action.action, owner: action.owner, boundary: action.boundary,
      userState: action.userState, reached: action.reached || null,
      resume: action.resume || action.next || null,
      command: action.command || null
    },
    references: packet.references,
    decisions: {
      source: "compiled-agreement",
      reference: packet.references?.["design.md"] || packet.references?.["proposal.md"] || null,
      pending: action.decision || null
    },
    evidence: packet.providers,
    evidenceAvailability: packet.evidenceAvailability || "current-runtime-validity",
    evidenceReference: packet.evidenceReference || null,
    findings: packet.repairContext || null,
    externalOperations: packet.externalOperations,
    instruction: "Read the referenced agreement and relevant findings before editing. Active leases retain ownership. Use advance for execution; this packet grants no new authority."
  };
  const bytes = () => Buffer.byteLength(JSON.stringify(value));
  if (bytes() > limit - 100) {
    // Preserve identities and exact artifact routes; oversized prose is fetched
    // from its owner instead of silently losing it or widening packet budgets.
    value.evidence = { count: Array.isArray(packet.providers) ? packet.providers.length :
      packet.providers?.count || 0, reference: `claude-foundation packet ${packet.changeId}` };
    value.findings = packet.repairContext ? {
      attemptDigest: packet.repairContext.attemptDigest,
      findingDigest: packet.repairContext.findingDigest,
      reference: `claude-foundation packet ${packet.changeId}`, truncated: true
    } : null;
    value.decisions.pending = action.decision ? {
      reference: `claude-foundation advance ${packet.changeId} --inspect`, truncated: true
    } : null;
    value.externalOperations = {
      reference: `claude-foundation handoff status ${packet.changeId}`, truncated: true
    };
  }
  value.packetDigest = stableHash(value);
  if (bytes() > limit)
    throw new Error("resume packet exceeds configured global limit; inspect the scoped task packet");
  return value;
}
