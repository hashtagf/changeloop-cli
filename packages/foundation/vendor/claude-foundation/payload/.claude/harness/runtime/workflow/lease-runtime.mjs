import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync,
  renameSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { conflictKeysOverlap } from "../core/graph-execution.mjs";
import { acquireProcessLock } from "../core/process-lock.mjs";

export function leaseDescriptorIsOwned(descriptor, id, taskId, owner) {
  return descriptor.changeId === id && descriptor.taskId === taskId &&
    descriptor.owner === owner;
}

export function leaseRenewalRows(descriptors, id, taskId, owner) {
  return descriptors.filter(({ descriptor }) =>
    leaseDescriptorIsOwned(descriptor, id, taskId, owner));
}

export function leaseResourceConflicts(
  keys, descriptors, id, taskId, owner, overlap = conflictKeysOverlap
) {
  const conflicts = [];
  for (const key of keys) {
    for (const { descriptor } of descriptors) {
      if (leaseDescriptorIsOwned(descriptor, id, taskId, owner)) continue;
      const held = descriptor.key || descriptor.resource;
      if (overlap(key, held)) conflicts.push({ key, held, descriptor });
    }
  }
  return conflicts;
}

export function sameLeaseRenewalAuthority(
  renewal, keys, prior, owner, plan
) {
  const renewalKeys = renewal.map(({ descriptor }) =>
    descriptor.key || descriptor.resource).sort();
  return JSON.stringify(renewalKeys) === JSON.stringify(keys) &&
    prior.owner === owner && prior.graphRevision === plan.graphRevision &&
    prior.graphIdentity === plan.graphIdentity &&
    Number(prior.contractRevision) === Number(plan.contractRevision);
}

export function taskNodeOutputSchema(plan, taskId) {
  for (const node of plan.graph?.nodes || [])
    if (node.id === `task:${taskId}`) return node.outputSchema;
  return undefined;
}

export function leaseAcquisitionRequest(context, id, taskId, flags) {
  const owner = flags.owner;
  if (!taskId || !owner || !/^[a-zA-Z0-9._-]+$/.test(owner))
    context.fail("agents acquire requires <change> <task> --owner <agent-id>");
  const plan = context.agentPlanValue(id);
  if (!plan.dispatchable)
    context.fail(`change '${id}' conflicts with active repository work`);
  const normalizedTaskId = taskId.toUpperCase();
  let task = null;
  for (const candidate of plan.tasks)
    if (candidate.id === normalizedTaskId) task = candidate;
  if (!task) context.fail(`unknown pending task '${taskId}'`);
  const pendingIds = new Set(plan.tasks.map((candidate) => candidate.id));
  const blockedBy = task.dependsOn.filter((dependency) => pendingIds.has(dependency));
  if (blockedBy.length)
    context.fail(`task '${task.id}' is blocked by pending task(s): ${blockedBy.join(", ")}`);
  const durationMs = Number(context.policy().execution.leaseMinutes) * 60 * 1000;
  const expiresAt = new Date(context.nowMs() + durationMs).toISOString();
  const keys = [...new Set(task.leaseKeys || task.resources || [])].sort();
  const taskLeasePath = join(context.leases, "tasks", id, `${task.id}.json`);
  const prior = context.exists(taskLeasePath)
    ? context.readJson(taskLeasePath, {}) : {};
  return { id, task, owner, keys, prior, plan, expiresAt, taskLeasePath };
}

export function acquireLeaseUnderLock(context) {
  const {
    id, task, owner, keys, prior, plan, expiresAt, taskLeasePath
  } = context;
  const descriptors = context.resourceDescriptors();
  const renewal = leaseRenewalRows(descriptors, id, task.id, owner);
  const conflicts = leaseResourceConflicts(keys, descriptors, id, task.id, owner);
  if (conflicts.length) {
    const conflict = conflicts[0];
    throw new Error(`scope '${conflict.key}' conflicts with '${conflict.held}' held by ${
      conflict.descriptor.changeId || "unknown"}/${conflict.descriptor.taskId || "unknown"}`);
  }
  const sameRenewal = sameLeaseRenewalAuthority(
    renewal, keys, prior, owner, plan);
  if (renewal.length && !sameRenewal)
    throw new Error(`stale lease authority for '${id}/${task.id}'; release or take over the prior lease before reacquiring`);
  if (sameRenewal) {
    for (const row of renewal) context.writeJson(row.path, {
      ...row.descriptor, expiresAt, renewedAt: context.now()
    });
    const renewed = { ...prior, expiresAt, renewedAt: context.now() };
    context.writeJson(taskLeasePath, renewed);
    return renewed;
  }
  const counterPath = join(context.leases, "fencing.json");
  const fencingGeneration = Number(
    context.readJson(counterPath, { generation: 0 }).generation || 0) + 1;
  context.writeJson(counterPath, {
    version: 1, generation: fencingGeneration, updatedAt: context.now()
  });
  const executionAttempt = Number(prior.executionAttempt || 0) + 1;
  const acquiredAt = context.now();
  const leaseId = context.stableHash({
    id, taskId: task.id, owner, fencingGeneration, acquiredAt
  });
  const created = [];
  try {
    for (const key of keys) {
      const path = context.leasePath(key);
      mkdirSync(dirname(path), { recursive: true });
      const descriptor = {
        version: 2, key, resource: key, changeId: id, taskId: task.id, owner,
        leaseId, fencingGeneration, executionAttempt,
        graphRevision: plan.graphRevision, graphIdentity: plan.graphIdentity,
        planDigest: plan.planDigest, acquiredAt, expiresAt
      };
      const handle = openSync(path, "wx");
      created.push(path);
      try { writeFileSync(handle, `${JSON.stringify(descriptor, null, 2)}\n`); }
      finally { closeSync(handle); }
    }
  } catch (error) {
    for (const path of created) rmSync(path, { force: true });
    throw error;
  }
  const lease = {
    version: 2, changeId: id, taskId: task.id, owner, leaseId,
    fencingGeneration, executionAttempt,
    graphRevision: plan.graphRevision, graphIdentity: plan.graphIdentity,
    planDigest: plan.planDigest, contractRevision: plan.contractRevision,
    workspaceHash: plan.workspaceHash, repository: task.repository,
    paths: task.paths || [], claimIds: task.claims || [],
    outputSchema: taskNodeOutputSchema(plan, task.id),
    resources: keys, baselineSurface: context.observedTaskSurface(id, task),
    acquiredAt, expiresAt
  };
  context.writeJson(taskLeasePath, lease);
  return lease;
}

export function reapExpiredLeaseOperation(context, path) {
  const lock = `${path}.reap`;
  try {
    if (context.nowMs() - context.lstat(lock).mtimeMs > 60_000) {
      const tombstone = `${lock}.${context.pid}.stale`;
      context.rename(lock, tombstone);
      context.remove(tombstone, { force: true });
    }
  } catch {
    // No lock on disk, or another contender claimed the stale one first.
  }
  let handle;
  try {
    handle = context.open(lock, "wx");
  } catch {
    return;
  }
  try {
    const current = context.readJson(path, {});
    const residue = !current.expiresAt &&
      context.nowMs() - context.lstat(path).mtimeMs > 10_000;
    if (residue || (current.expiresAt && Date.parse(current.expiresAt) <= context.nowMs()))
      context.remove(path, { force: true });
  } catch {
    // The descriptor vanished between the caller's exists check and here.
  } finally {
    context.close(handle);
    context.remove(lock, { force: true });
  }
}

export function validateLeaseReleaseClaim(context, id, taskLease, force, flags) {
  const owner = context.owner;
  if (!force && taskLease.status === "taken-over")
    context.fail(`stale lease result for '${id}/${taskLease.taskId}': the prior lease was taken over; reacquire the task before releasing a result`);
  const claimedLeaseId = String(flags["lease-id"] || "").trim();
  if (!force && Number(taskLease.executionAttempt || 0) > 1 && !claimedLeaseId)
    context.fail(`lease id is required to release taken-over task '${id}/${taskLease.taskId}'`);
  if (!force && claimedLeaseId && claimedLeaseId !== taskLease.leaseId)
    context.fail(`stale lease result for '${id}/${taskLease.taskId}': lease '${
      claimedLeaseId}' no longer owns this task (current lease '${taskLease.leaseId}')`);
  const expired = Date.parse(taskLease.expiresAt || "") <= context.nowMs();
  if (taskLease.owner !== owner) {
    if (!force)
      context.fail(`lease owner mismatch for '${id}/${taskLease.taskId}'; it belongs to '${taskLease.owner}' and expires ${taskLease.expiresAt}. Re-run with --force to take it over.`);
    if (!expired && !String(flags["decision-ref"] || "").trim())
      context.fail(`lease '${id}/${taskLease.taskId}' has not expired (expires ${taskLease.expiresAt}); forcing it requires --decision-ref <host-user-decision> because another worker may still be running it`);
  }
}

export function leaseReleaseIdentity(context, id, taskId, flags) {
  const owner = flags.owner;
  if (!taskId || !owner)
    context.fail("agents release requires <change> <task> --owner <agent-id>");
  const normalizedTaskId = taskId.toUpperCase();
  const index = join(context.leases, "tasks", id, `${normalizedTaskId}.json`);
  if (!context.exists(index)) {
    context.log(`LEASE ABSENT ${id}/${normalizedTaskId}`);
    return { absent: true };
  }
  const taskLease = context.readJson(index);
  const force = Boolean(flags.force);
  validateLeaseReleaseClaim({ ...context, owner }, id, taskLease, force, flags);
  return { absent: false, owner, index, taskLease, force };
}

export function leasePathIsAllowed(path, allowed) {
  for (const scope of allowed) {
    const prefix = String(scope).replace(/\/\*\*?$/, "").replace(/\/$/, "");
    if (scope === "*" || path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export function observedLeaseWrites(context, id, taskLease, force) {
  if (force) return [];
  const currentPlan = context.agentPlanValue(id);
  if (currentPlan.graphRevision !== taskLease.graphRevision ||
      currentPlan.graphIdentity !== taskLease.graphIdentity ||
      Number(currentPlan.contractRevision) !== Number(taskLease.contractRevision))
    context.fail(`stale result authority for '${id}/${taskLease.taskId}': graph or contract changed after lease acquisition`);
  const baseline = new Map();
  for (const row of taskLease.baselineSurface || []) baseline.set(row.path, row.identity);
  const current = new Map();
  for (const row of context.observedTaskSurface(id, taskLease))
    current.set(row.path, row.identity);
  const observedWrites = [];
  for (const path of new Set([...baseline.keys(), ...current.keys()]))
    if (baseline.get(path) !== current.get(path)) observedWrites.push(path);
  observedWrites.sort();
  const allowed = taskLease.paths || [];
  if (allowed.length) {
    const outside = [];
    for (const path of observedWrites)
      if (!leasePathIsAllowed(path, allowed)) outside.push(path);
    if (outside.length)
      context.fail(`task '${taskLease.taskId}' changed outside granted scope: ${outside.join(", ")}; result and proof were not accepted`);
  }
  return observedWrites;
}

export function releaseLeaseUnderLock(context) {
  const { id, owner, index, taskLease, force, observedWrites } = context;
  for (const resource of taskLease.resources || []) {
    const path = context.leasePath(resource);
    if (!context.exists(path)) continue;
    const current = context.readJson(path, {});
    if (!force && (current.leaseId !== taskLease.leaseId ||
        Number(current.fencingGeneration) !== Number(taskLease.fencingGeneration)))
      context.fail(`stale lease result for '${id}/${taskLease.taskId}': generation ${
        taskLease.fencingGeneration} no longer owns '${resource}'`);
    if (!current.expiresAt ||
        (current.changeId === id && current.taskId === taskLease.taskId &&
          (current.owner === owner || force))) context.remove(path);
  }
  if (!force) context.writeJson(
    join(context.leases, "results", id, `${taskLease.taskId}.json`),
    { version: 1, ...taskLease, status: "observed", observedWrites, acceptedAt: context.now() }
  );
  if (force) context.writeJson(index, {
    ...taskLease, status: "taken-over", resources: [],
    executionAttempt: Math.max(1, Number(taskLease.executionAttempt || 0)),
    expiresAt: context.now(), releasedAt: context.now()
  });
  else context.remove(index);
}

export function cleanupLeaseOperation(context, id) {
  const resources = join(context.leases, "resources");
  if (context.exists(resources)) {
    for (const entry of context.readDirectory(resources, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(resources, entry.name);
      if (context.readJson(path, {}).changeId === id) context.remove(path);
    }
  }
  const tasks = join(context.leases, "tasks", id);
  if (context.exists(tasks)) context.remove(tasks, { recursive: true });
  const results = join(context.leases, "results", id);
  if (context.exists(results)) context.remove(results, { recursive: true });
}

export function createLeaseRuntime({
  leases,
  stableHash,
  agentPlanValue,
  policy,
  readJson,
  writeJson,
  now,
  observedTaskSurface = () => [],
  fail
}) {
  function leasePath(resource) {
    return join(leases, "resources", `${stableHash(resource)}.json`);
  }

  // Removing an expired descriptor and creating a fresh one are two steps, so
  // two contenders racing on the same expired lease could interleave them: B's
  // delete of the "expired" path removed the fresh lease A had just created,
  // and both then held the resource. The sidecar `wx` lock serializes the
  // takeover, and the re-read under the lock is what makes the delete safe —
  // by then the path may already hold the winner's fresh lease.
  const reapExpiredLease = reapExpiredLeaseOperation.bind(null, {
    nowMs: Date.now, lstat: lstatSync, pid: process.pid, rename: renameSync,
    remove: rmSync, open: openSync, close: closeSync, readJson
  });

  function withAcquisitionLock(action) {
    const path = join(leases, "acquire.lock");
    const lock = acquireProcessLock(path, { now });
    if (!lock.acquired) fail("lease acquisition is busy; retry the same command");
    try { return action(); }
    finally { lock.release(); }
  }

  function resourceDescriptors() {
    const root = join(leases, "resources");
    if (!existsSync(root)) return [];
    const rows = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(root, entry.name);
      const current = readJson(path, {});
      if (!current.expiresAt || Date.parse(current.expiresAt) <= Date.now()) {
        reapExpiredLease(path);
        if (!existsSync(path)) continue;
      }
      rows.push({ path, descriptor: readJson(path, {}) });
    }
    return rows;
  }

  function acquire(id, taskId, flags) {
    const request = leaseAcquisitionRequest({
      agentPlanValue, policy, leases, exists: existsSync, readJson,
      nowMs: Date.now, fail
    }, id, taskId, flags);
    const operation = acquireLeaseUnderLock.bind(null, {
      ...request,
      leases, resourceDescriptors, writeJson, now, readJson, stableHash,
      leasePath, observedTaskSurface
    });
    const result = withAcquisitionLock(operation);
    console.log(`LEASE ACQUIRED ${id}/${request.task.id}\n  owner: ${request.owner}\n  lease: ${result.leaseId}\n  generation: ${result.fencingGeneration}\n  attempt: ${result.executionAttempt}\n  expires: ${request.expiresAt}`);
  }

  function release(id, taskId, flags) {
    const identity = leaseReleaseIdentity({
      leases, exists: existsSync, readJson, nowMs: Date.now, fail, log: console.log
    }, id, taskId, flags);
    if (identity.absent) return;
    const { owner, index, taskLease, force } = identity;
    const observedWrites = observedLeaseWrites({
      agentPlanValue, observedTaskSurface, fail
    }, id, taskLease, force);
    const operation = releaseLeaseUnderLock.bind(null, {
      id, owner, index, taskLease, force, observedWrites,
      leases, leasePath, exists: existsSync, readJson, fail,
      remove: rmSync, writeJson, now
    });
    withAcquisitionLock(operation);
    console.log(`LEASE RELEASED ${id}/${taskLease.taskId}${
      taskLease.owner === owner ? "" : `\n  taken over from: ${taskLease.owner}`}${
      observedWrites.length ? `\n  observed writes: ${observedWrites.join(", ")}` : ""}`);
  }

  function active(id) {
    const root = join(leases, "tasks", id);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson(join(root, entry.name), {}))
      .filter((lease) => Date.parse(lease.expiresAt || "") > Date.now());
  }

  const cleanup = cleanupLeaseOperation.bind(null, {
    leases, exists: existsSync,
    readDirectory: readdirSync,
    readJson, remove: rmSync
  });

  return { leasePath, acquire, release, active, cleanup };
}
