import { findCyclePath } from "./graph.mjs";

export const EXECUTION_GRAPH_VERSION = 3;
export const NODE_DATA_SCHEMA = Object.freeze({ name: "foundation.node-data", version: 1 });

// A single host session is valid execution authority only for one Build task
// confined to one repository with no cross-repository claim or shared external
// resource. Multiple ready tasks use the planner even in one repository so
// disjoint paths can execute concurrently under leases.
export function singleAgentExecutionEligible(tasks = [], claims = []) {
  return tasks.length === 1 &&
    new Set(tasks.map((task) => task.repository)).size === 1 &&
    !claims.some((claim) => (claim.repositories || []).length > 1) &&
    !tasks.some((task) => (task.resources || [])
      .some((resource) => !resource.startsWith("workspace:")));
}

export function criticalPathDepths(nodes = []) {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const children = new Map(nodes.map((entry) => [entry.id, []]));
  for (const entry of nodes)
    for (const dependency of entry.dependsOn || [])
      if (children.has(dependency)) children.get(dependency).push(entry.id);
  const memo = new Map();
  const visiting = new Set();
  const depth = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) throw new Error(`execution graph dependency cycle at '${id}'`);
    visiting.add(id);
    let childDepth = 0;
    for (const child of children.get(id) || []) childDepth = Math.max(childDepth, depth(child));
    const value = 1 + childDepth;
    visiting.delete(id);
    memo.set(id, value);
    return value;
  };
  for (const id of byId.keys()) depth(id);
  return memo;
}

// Pure, deterministic scheduling primitive shared by Build and Prove. It
// prioritizes the longest remaining dependency chain, then fills capacity with
// nodes whose declared resources do not conflict.
export function scheduleReadyBatch(nodes = [], completed = new Set(), {
  maxParallel = 1,
  conflicts = () => false
} = {}) {
  const capacity = Math.max(1, Number(maxParallel) || 1);
  const depths = criticalPathDepths(nodes);
  const ready = nodes.filter((entry) => !completed.has(entry.id) &&
    (entry.dependsOn || []).every((dependency) => completed.has(dependency)))
    .sort((left, right) =>
      (depths.get(right.id) || 0) - (depths.get(left.id) || 0) ||
      left.id.localeCompare(right.id));
  const selected = [];
  for (const entry of ready) {
    if (selected.length >= capacity) break;
    if (selected.every((candidate) => !conflicts(candidate, entry))) selected.push(entry);
  }
  return { ready, selected, depths };
}

function sorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function schema(value, fallback = NODE_DATA_SCHEMA) {
  if (!value) return { ...fallback, accepts: sorted(fallback.accepts) };
  if (typeof value === "string") {
    const match = value.match(/^(.+?)(?:@|\/v)(\d+)$/);
    return match ? { name: match[1], version: Number(match[2]), accepts: [] }
      : { name: value, version: 1, accepts: [] };
  }
  return {
    name: String(value.name || fallback.name),
    version: Number(value.version || fallback.version),
    accepts: sorted((value.accepts || []).map(Number))
  };
}

export function schemasCompatible(output, input) {
  const produced = schema(output);
  const consumed = schema(input);
  return produced.name === consumed.name &&
    (produced.version === consumed.version || consumed.accepts.includes(produced.version));
}

function node(value) {
  return {
    id: String(value.id),
    kind: String(value.kind),
    repository: value.repository || null,
    repositories: sorted(value.repositories),
    required: value.required !== false,
    dependsOn: sorted(value.dependsOn),
    paths: sorted(value.paths),
    contracts: sorted(value.contracts),
    resources: sorted(value.resources),
    claims: sorted(value.claims),
    inputSchema: schema(value.inputSchema),
    outputSchema: schema(value.outputSchema),
    lifecycle: String(value.lifecycle || "build"),
    authorityDigest: value.authorityDigest || null
  };
}

function providerClaims(provider, claims) {
  if (Array.isArray(provider.claims)) return sorted(provider.claims);
  const capability = provider.capability || provider.id;
  return sorted(claims.filter((claim) =>
    (claim.capabilities || []).includes(capability) ||
    (capability === "discovery" && (claim.capabilities || []).includes("test")))
    .map((claim) => claim.id));
}

function taskDependencies(task, repository, tasks) {
  if ((task.dependsOn || []).length) return [...task.dependsOn];
  return (repository.dependsOn || []).flatMap((dependencyRepository) =>
    tasks.filter((candidate) => candidate.repository === dependencyRepository)
      .map((candidate) => candidate.id));
}

// Pure compiler: durable artifacts remain authoritative and this value can be
// deleted and reconstructed. Callers supply stableHash so graph identity uses
// the same canonical hash implementation as the rest of Foundation.
export function compileExecutionGraph({
  changeId, contractRevision = 0, workspaceHash = null,
  repositories = [], tasks = [], claims = [], providers = [], services = [], stableHash
}) {
  assertStableHash(stableHash);
  const repositoryMap = new Map(repositories.map((repository) => [repository.id, repository]));
  const setupNodes = repositories.filter((repository) => repository.setupCommand)
    .map((repository) => node({
      id: `setup:${repository.id}`, kind: "setup", repository: repository.id,
      resources: [`setup:${repository.id}`], lifecycle: "build",
      authorityDigest: stableHash({ command: repository.setupCommand })
    }));
  const setupIds = new Set(setupNodes.map((entry) => entry.repository));
  const serviceNodes = services.map((service) => node({
    id: `service:${service.id}`, kind: "service",
    dependsOn: (service.dependsOn || []).map((id) => `service:${id}`),
    resources: [...(service.resources || []), ...(service.port ? [`port:${service.port}`] : [])],
    lifecycle: "prove", authorityDigest: stableHash(service)
  }));
  const serviceIds = new Set(serviceNodes.map((entry) => entry.id));
  const taskNodes = tasks.map((task) => {
    const repository = repositoryMap.get(task.repository);
    if (!repository) throw new Error(`graph task '${task.id}' references unknown repository '${task.repository}'`);
    const dependencies = taskDependencies(task, repository, tasks);
    return node({
      id: `task:${task.id}`, kind: "task", repository: task.repository,
      required: task.required !== false, dependsOn: [
        ...dependencies.map((id) => `task:${id}`),
        ...(setupIds.has(task.repository) ? [`setup:${task.repository}`] : [])
      ],
      paths: task.paths, contracts: task.contracts,
      resources: task.resources, claims: task.claims,
      inputSchema: task.inputSchema, outputSchema: task.outputSchema,
      authorityDigest: task.authorityDigest || stableHash({
        text: task.text || null,
        kind: task.kind || null,
        paths: sorted(task.paths),
        resources: sorted(task.resources),
        claims: sorted(task.claims)
      }),
      lifecycle: "build"
    });
  });
  const providerNodes = providers.map((provider) => {
    const covered = providerClaims(provider, claims);
    const taskDependencies = tasks.filter((task) =>
      (task.claims || []).some((claim) => covered.includes(claim)))
      .map((task) => `task:${task.id}`);
    return node({
      id: `provider:${provider.id}`, kind: "provider",
      repository: provider.repository || null, required: provider.required !== false,
      repositories: provider.repositories || [],
      dependsOn: [
        ...(provider.dependsOn || []).map((id) => `provider:${id}`),
        ...(provider.service && serviceIds.has(`service:${provider.service}`)
          ? [`service:${provider.service}`] : []),
        ...taskDependencies
      ],
      resources: provider.resources, claims: covered,
      inputSchema: provider.inputSchema, outputSchema: provider.outputSchema,
      authorityDigest: provider.configurationIdentity || stableHash(provider),
      lifecycle: "prove"
    });
  });
  const requiredProviders = providerNodes.filter((provider) => provider.required);
  const landNodes = repositories.filter((repository) => repository.mode === "write")
    .map((repository) => node({
      id: `land:${repository.id}`, kind: "land", repository: repository.id,
      dependsOn: [
        ...requiredProviders.filter((provider) =>
          (!provider.repositories.length && !provider.repository) ||
          provider.repositories.includes(repository.id) ||
          provider.repository === repository.id).map((provider) => provider.id),
        ...(repository.dependsOn || [])
          .filter((id) => repositoryMap.get(id)?.mode !== "read")
          .map((id) => `land:${id}`)
      ],
      resources: [`land:${repository.id}`], lifecycle: "land"
    }));
  const nodes = [...setupNodes, ...serviceNodes, ...taskNodes, ...providerNodes, ...landNodes]
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set(nodes.map((entry) => entry.id));
  if (ids.size !== nodes.length) throw new Error("execution graph contains duplicate node IDs");
  for (const entry of nodes) {
    const unknown = entry.dependsOn.filter((dependency) => !ids.has(dependency));
    if (unknown.length)
      throw new Error(`graph node '${entry.id}' depends on unknown node(s): ${unknown.join(", ")}`);
  }
  const cycle = findCyclePath(new Map(nodes.map((entry) => [entry.id, entry.dependsOn])));
  if (cycle) throw new Error(`execution graph dependency cycle: ${cycle.join(" -> ")}`);
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const edges = nodes.flatMap((consumer) => consumer.dependsOn.map((producerId) => {
    const producer = byId.get(producerId);
    if (!schemasCompatible(producer.outputSchema, consumer.inputSchema))
      throw new Error(`incompatible graph edge '${producerId}' -> '${consumer.id}': ${
        producer.outputSchema.name}@${producer.outputSchema.version} cannot satisfy ${
        consumer.inputSchema.name}@${consumer.inputSchema.version}`);
    return {
      id: `${producerId}->${consumer.id}`,
      from: producerId,
      to: consumer.id,
      outputSchema: producer.outputSchema,
      inputSchema: consumer.inputSchema,
      claims: sorted([...producer.claims, ...consumer.claims])
    };
  })).sort((left, right) => left.id.localeCompare(right.id));
  const identityInput = {
    version: EXECUTION_GRAPH_VERSION,
    changeId,
    contractRevision: Number(contractRevision),
    repositories: repositories.map((repository) => ({
      id: repository.id, mode: repository.mode, type: repository.type || null,
      relativePath: repository.relativePath || null,
      dependsOn: sorted(repository.dependsOn)
    })).sort((left, right) => left.id.localeCompare(right.id)),
    claims: claims.map((claim) => ({
      id: claim.id,
      scenario: String(claim.scenario || ""),
      impact: claim.impact || null,
      capabilities: sorted(claim.capabilities),
      repositories: sorted(claim.repositories)
    })).sort((left, right) => left.id.localeCompare(right.id)),
    nodes,
    edges
  };
  const identity = stableHash(identityInput);
  return {
    ...identityInput,
    inputWorkspaceHash: workspaceHash,
    identity,
    revision: `graph-v${EXECUTION_GRAPH_VERSION}-${identity.slice(0, 20)}`
  };
}

function assertStableHash(stableHash) {
  if (typeof stableHash !== "function") throw new Error("execution graph requires stableHash");
}

export function dependentClosure(graph, seeds) {
  const affected = new Set(seeds || []);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of graph.edges || [])
      if (affected.has(edge.from) && !affected.has(edge.to)) {
        affected.add(edge.to);
        expanded = true;
      }
  }
  return [...affected].sort();
}

function pathScope(value) {
  return String(value).replace(/[*?[].*$/, "").replace(/\/+$/, "");
}

export function conflictKeysForTask(task) {
  const repository = task.repository || "root";
  const paths = sorted(task.paths);
  const repositoryWide = !paths.length || paths.includes("*") ||
    /migration|repository/i.test(String(task.kind || ""));
  return sorted([
    ...(repositoryWide ? [`repo:${repository}`] : paths.map((path) =>
      `path:${repository}:${pathScope(path)}`).filter((key) => !key.endsWith(":"))),
    ...(task.contracts || task.claims || []).map((contract) => `contract:${contract}`),
    ...(task.resources || []).filter((resource) => !resource.startsWith("workspace:"))
      .map((resource) => `resource:${resource}`)
  ]);
}

// Which cross-change overlaps stop work. Path and repository scopes do not:
// every change builds and proves in its own workspace, and the change that
// lands later synchronizes onto the moved target, resolves any double edit,
// and re-proves — that is the concurrency model, not a lock. Pessimistic
// scope locks made two changes that both touched `src/lib` wait on each other
// until one was abandoned. Only an explicit `[resources:]` token names
// something two changes cannot use at once (a shared database, a deploy
// target), and those still serialize.
export function blockingConflictRows(rows) {
  return rows.filter((row) => /^resource:/.test(String(row.key || "")));
}

export function conflictKeysOverlap(left, right) {
  if (left === right) return true;
  const leftRepo = left.match(/^repo:(.+)$/)?.[1];
  const rightRepo = right.match(/^repo:(.+)$/)?.[1];
  const leftPath = left.match(/^path:([^:]+):(.*)$/);
  const rightPath = right.match(/^path:([^:]+):(.*)$/);
  if (leftRepo && rightPath?.[1] === leftRepo) return true;
  if (rightRepo && leftPath?.[1] === rightRepo) return true;
  if (leftPath && rightPath && leftPath[1] === rightPath[1]) {
    const a = leftPath[2];
    const b = rightPath[2];
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  }
  return false;
}

function pathMatches(path, scopes) {
  if (!(scopes || []).length || (scopes || []).includes("*")) return true;
  return (scopes || []).some((scope) => {
    const prefix = String(scope).replace(/\/\*\*?$/, "").replace(/\/$/, "");
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

export function validateNodeResult(authority, result, observedWrites = []) {
  const fields = [
    "graphRevision", "planDigest", "contractRevision", "workspaceHash",
    "leaseId", "fencingGeneration", "executionAttempt", "repository"
  ];
  const mismatches = fields.filter((field) => String(result?.[field] ?? "") !==
    String(authority?.[field] ?? ""));
  const allowedClaims = new Set(authority.claimIds || []);
  const unexpectedClaims = (result?.claimIds || []).filter((claim) => !allowedClaims.has(claim));
  const unexpectedWrites = observedWrites.filter((path) => !pathMatches(path, authority.paths || []));
  const valid = !mismatches.length && !unexpectedClaims.length && !unexpectedWrites.length &&
    schemasCompatible(result?.outputSchema, authority.outputSchema);
  return { valid, mismatches, unexpectedClaims, unexpectedWrites };
}

export function compileLandPreparation({
  changeId, graphRevision = null, graphIdentity = null,
  aggregateProofRunId = null, aggregateProofIdentity = null,
  workspaceHash, repositories = [], stableHash, preparedAt = null
}) {
  const normalized = repositories.map((repository) => ({
    id: repository.id,
    mode: repository.mode,
    dependsOn: sorted(repository.dependsOn),
    authorizedCommit: repository.authorizedCommit || null,
    ci: repository.ci || null,
    targetHead: repository.targetHead || null,
    status: repository.status || null,
    recoveryDisposition: repository.recoveryDisposition || "forward-fix"
  })).sort((left, right) => left.id.localeCompare(right.id));
  const incomplete = normalized.filter((repository) =>
    repository.mode === "write" && (!repository.authorizedCommit ||
      ["sandbox-missing", "ci-failed", "awaiting-ci"].includes(repository.status)));
  const identityInput = {
    version: 1, changeId, graphRevision, graphIdentity,
    aggregateProofRunId, aggregateProofIdentity, workspaceHash,
    repositories: normalized
  };
  return {
    ...identityInput,
    identity: stableHash(identityInput),
    status: incomplete.length ? "incomplete" : "prepared",
    incomplete: incomplete.map((repository) => repository.id),
    preparedAt
  };
}

export function landPreparationMatches(prepared, current) {
  return Boolean(prepared && current && prepared.status === "prepared" &&
    current.status === "prepared" && prepared.identity === current.identity);
}
