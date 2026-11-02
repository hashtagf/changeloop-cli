import { scopeAllowsPath, singleAgentExecutionEligible } from "./graph-execution.mjs";

function sorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function taskDependencies(node) {
  return sorted((node.dependsOn || []).filter((dependency) =>
    String(dependency).startsWith("task:")));
}

export function taskNodeAuthorityShape(node = {}) {
  return {
    id: node.id || null,
    kind: node.kind || null,
    repository: node.repository || null,
    required: node.required !== false,
    dependsOn: taskDependencies(node),
    paths: sorted(node.paths),
    contracts: sorted(node.contracts),
    resources: sorted(node.resources),
    claims: sorted(node.claims),
    inputSchema: node.inputSchema || null,
    outputSchema: node.outputSchema || null,
    lifecycle: node.lifecycle || null,
    authorityDigest: node.authorityDigest || null
  };
}

function taskNodes(graph = {}) {
  return (graph.nodes || []).filter((node) => node.kind === "task");
}

function legacySingleSessionEligible(graph = {}) {
  const tasks = taskNodes(graph);
  return tasks.length > 0 &&
    new Set(tasks.map((task) => task.repository)).size === 1 &&
    !(graph.claims || []).some((claim) => (claim.repositories || []).length > 1) &&
    !tasks.some((task) => (task.resources || [])
      .some((resource) => !String(resource).startsWith("workspace:")));
}

function taskNode(graph, taskId) {
  return taskNodes(graph).find((node) => node.id === `task:${taskId}`) || null;
}

function sameTaskAuthority(savedGraph, currentGraph, taskId) {
  return JSON.stringify(taskNodeAuthorityShape(taskNode(savedGraph, taskId) || {})) ===
    JSON.stringify(taskNodeAuthorityShape(taskNode(currentGraph, taskId) || {}));
}

function taskClaimsShape(claims = [], claimIds) {
  return claims.filter((claim) => claimIds.has(claim.id))
    .map((claim) => ({
      id: claim.id || null,
      scenario: String(claim.scenario || ""),
      impact: claim.impact || null,
      capabilities: sorted(claim.capabilities),
      repositories: sorted(claim.repositories)
    })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function sameTaskClaims(savedGraph, currentGraph, taskId) {
  const claimIds = new Set([
    ...(taskNode(savedGraph, taskId)?.claims || []),
    ...(taskNode(currentGraph, taskId)?.claims || [])
  ]);
  return JSON.stringify(taskClaimsShape(savedGraph.claims, claimIds)) ===
    JSON.stringify(taskClaimsShape(currentGraph.claims, claimIds));
}

// What one task's result is bound to: its own node (text digest, repository,
// paths, claims, dependencies, schemas) and the claims it proves. An
// amendment elsewhere in the graph leaves this unchanged, so it no longer
// sends every completed task back for verification.
export function taskAuthorityShape(graph = {}, taskId) {
  const node = taskNode(graph, taskId);
  if (!node) return null;
  return {
    task: taskNodeAuthorityShape(node),
    claims: taskClaimsShape(graph.claims, new Set(node.claims || []))
  };
}

export function legacySingleSessionCompatibility({
  id, taskId, state = {}, savedPlan = {}, currentGraph = {}, currentContractFingerprint
}) {
  const savedGraph = savedPlan.graph || {};
  const execution = savedPlan.taskExecution?.[taskId];
  const savedTasks = taskNodes(savedGraph);
  const everyTaskObserved = savedTasks.every((node) => {
    const entry = savedPlan.taskExecution?.[String(node.id).replace(/^task:/, "")];
    return entry?.mode === "single-agent-observed" &&
      entry.graphRevision === savedGraph.revision &&
      entry.graphIdentity === savedGraph.identity;
  });
  const valid = savedGraph.version === 2 && currentGraph.version === 3 &&
    savedPlan.changeId === id && String(savedPlan.planDigest || "").length > 0 &&
    savedPlan.graphRevision === savedGraph.revision &&
    savedPlan.graphIdentity === savedGraph.identity &&
    execution?.mode === "single-agent-observed" &&
    execution.graphRevision === savedGraph.revision &&
    execution.graphIdentity === savedGraph.identity && everyTaskObserved &&
    Number(savedPlan.contractRevision) === Number(state.contractRevision) &&
    savedPlan.contractFingerprint === currentContractFingerprint &&
    legacySingleSessionEligible(savedGraph) &&
    legacySingleSessionEligible(currentGraph) &&
    sameTaskAuthority(savedGraph, currentGraph, taskId) &&
    sameTaskClaims(savedGraph, currentGraph, taskId);
  return valid ? {
    valid: true,
    witness: {
      kind: "graph-v2-single-session",
      priorGraphRevision: savedGraph.revision,
      priorGraphIdentity: savedGraph.identity,
      priorPlanDigest: savedPlan.planDigest
    }
  } : { valid: false };
}

export function taskResultMismatches(result, taskId, node, graph, state) {
  const mismatches = [];
  const expect = (field, actual, expected) => {
    if (String(actual ?? "") !== String(expected ?? "")) mismatches.push(field);
  };
  expect("taskId", result?.taskId, taskId);
  expect("repository", result?.repository, node?.repository);
  // A result that recorded its own task authority is judged by that alone;
  // older results keep the whole-graph binding they were written under.
  if (result?.taskAuthority) {
    if (JSON.stringify(result.taskAuthority) !== JSON.stringify(taskAuthorityShape(graph, taskId)))
      mismatches.push("taskAuthority");
  } else {
    expect("graphRevision", result?.graphRevision, graph?.revision);
    expect("graphIdentity", result?.graphIdentity, graph?.identity);
    expect("contractRevision", result?.contractRevision, state?.contractRevision);
  }
  if (JSON.stringify(sorted(result?.paths)) !== JSON.stringify(sorted(node?.paths)))
    mismatches.push("paths");
  if (JSON.stringify(sorted(result?.claimIds)) !== JSON.stringify(sorted(node?.claims)))
    mismatches.push("claimIds");
  if (JSON.stringify(result?.outputSchema || null) !==
      JSON.stringify(node?.outputSchema || null)) mismatches.push("outputSchema");
  if (result?.status !== "observed") mismatches.push("status");
  for (const field of ["planDigest", "workspaceHash", "leaseId"])
    if (!String(result?.[field] || "")) mismatches.push(field);
  for (const field of ["fencingGeneration", "executionAttempt"])
    if (!Number.isInteger(Number(result?.[field])) || Number(result?.[field]) < 1)
      mismatches.push(field);
  const unexpectedWrites = (result?.observedWrites || []).filter((path) => {
    if (!(node?.paths || []).length) return false;
    return !(node.paths || []).some((scope) => scopeAllowsPath(scope, path));
  });
  if (unexpectedWrites.length) mismatches.push("observedWrites");
  return [...new Set(mismatches)];
}

export function resolveTaskExecutionAuthority({
  id, taskId, node, graph, state = {}, savedPlan = {}, resultRecord = null,
  taskLease = null, currentContractFingerprint = null
}) {
  if (taskLease?.leaseId) return {
    status: "verification-required", reason: "task lease requires current verification"
  };
  if (resultRecord?.value) {
    const mismatches = taskResultMismatches(
      resultRecord.value, taskId, node, graph, state);
    return mismatches.length ? {
      status: "verification-required",
      reason: `stale or invalid result authority: ${mismatches.join(", ")}`,
      mismatches
    } : { status: "accepted-lease-result", resultRecord };
  }
  const execution = savedPlan.taskExecution?.[taskId];
  const tasks = taskNodes(graph);
  const currentObserved = execution?.mode === "single-agent-observed" &&
    execution.graphRevision === graph.revision && execution.graphIdentity === graph.identity;
  if (currentObserved || singleAgentExecutionEligible(tasks, graph.claims))
    return { status: "single-agent-observed" };
  const historicalPlan = savedPlan.legacyExecutionAuthority || savedPlan;
  const compatibility = legacySingleSessionCompatibility({
    id, taskId, state, savedPlan: historicalPlan,
    currentGraph: graph, currentContractFingerprint
  });
  if (compatibility.valid) return {
    status: "compatible-legacy-single-session",
    compatibility: compatibility.witness
  };
  return {
    status: "verification-required",
    reason: "task lacks current or compatible historical execution authority"
  };
}
