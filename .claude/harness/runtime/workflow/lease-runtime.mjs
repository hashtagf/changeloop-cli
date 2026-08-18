import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync,
  renameSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { conflictKeysOverlap } from "../core/graph-execution.mjs";
import { acquireProcessLock } from "../core/process-lock.mjs";

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
  function reapExpiredLease(path) {
    const lock = `${path}.reap`;
    try {
      // A reaper that crashed between create and remove would deadlock every
      // later takeover; the lock only ever lives for milliseconds. Claimed by
      // rename, not deleted in place: two contenders both observing it stale
      // would otherwise race the delete, and the loser's delete would remove
      // the winner's *fresh* lock — both inside the critical section.
      if (Date.now() - lstatSync(lock).mtimeMs > 60_000) {
        const tombstone = `${lock}.${process.pid}.stale`;
        renameSync(lock, tombstone);
        rmSync(tombstone, { force: true });
      }
    } catch {
      // No lock on disk, or another contender claimed the stale one first.
    }
    let handle;
    try {
      handle = openSync(lock, "wx");
    } catch {
      return; // Another contender is mid-takeover; the `wx` create below decides.
    }
    try {
      const current = readJson(path, {});
      // An expiryless descriptor is usually crashed-create residue — but for
      // the first few seconds it is indistinguishable from a winner's `wx`
      // create whose write has not landed yet, and deleting that re-opens the
      // double-hold. Residue is old; a mid-create file is milliseconds old.
      const residue = !current.expiresAt &&
        Date.now() - lstatSync(path).mtimeMs > 10_000;
      if (residue || (current.expiresAt && Date.parse(current.expiresAt) <= Date.now()))
        rmSync(path, { force: true });
    } catch {
      // The descriptor vanished between the caller's existsSync and here —
      // the takeover already happened; the `wx` create below decides.
    } finally {
      closeSync(handle);
      rmSync(lock, { force: true });
    }
  }

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
    const owner = flags.owner;
    if (!taskId || !owner || !/^[a-zA-Z0-9._-]+$/.test(owner))
      fail("agents acquire requires <change> <task> --owner <agent-id>");
    const plan = agentPlanValue(id);
    if (!plan.dispatchable) fail(`change '${id}' conflicts with active repository work`);
    const task = plan.tasks.find((candidate) => candidate.id === taskId.toUpperCase());
    if (!task) fail(`unknown pending task '${taskId}'`);
    const pendingIds = new Set(plan.tasks.map((candidate) => candidate.id));
    const blockedBy = task.dependsOn.filter((dependency) => pendingIds.has(dependency));
    if (blockedBy.length)
      fail(`task '${task.id}' is blocked by pending task(s): ${blockedBy.join(", ")}`);
    const durationMs = Number(policy().execution.leaseMinutes) * 60 * 1000;
    const expiresAt = new Date(Date.now() + durationMs).toISOString();
    const keys = [...new Set(task.leaseKeys || task.resources || [])].sort();
    const taskLeasePath = join(leases, "tasks", id, `${task.id}.json`);
    const prior = existsSync(taskLeasePath) ? readJson(taskLeasePath, {}) : {};
    const result = withAcquisitionLock(() => {
      const descriptors = resourceDescriptors();
      const renewal = descriptors.filter(({ descriptor }) =>
        descriptor.changeId === id && descriptor.taskId === task.id && descriptor.owner === owner);
      const conflicts = [];
      for (const key of keys)
        for (const { descriptor } of descriptors) {
          if (descriptor.changeId === id && descriptor.taskId === task.id && descriptor.owner === owner)
            continue;
          const held = descriptor.key || descriptor.resource;
          if (conflictKeysOverlap(key, held)) conflicts.push({ key, held, descriptor });
        }
      if (conflicts.length) {
        const conflict = conflicts[0];
        throw new Error(`scope '${conflict.key}' conflicts with '${conflict.held}' held by ${
          conflict.descriptor.changeId || "unknown"}/${conflict.descriptor.taskId || "unknown"}`);
      }
      const renewalKeys = renewal.map(({ descriptor }) => descriptor.key || descriptor.resource)
        .sort();
      const sameRenewalAuthority = JSON.stringify(renewalKeys) === JSON.stringify(keys) &&
        prior.owner === owner && prior.graphRevision === plan.graphRevision &&
        prior.graphIdentity === plan.graphIdentity &&
        Number(prior.contractRevision) === Number(plan.contractRevision);
      if (renewal.length && !sameRenewalAuthority)
        throw new Error(`stale lease authority for '${id}/${task.id}'; release or take over the prior lease before reacquiring`);
      if (sameRenewalAuthority) {
        for (const row of renewal) writeJson(row.path, {
          ...row.descriptor, expiresAt, renewedAt: now()
        });
        const renewed = { ...prior, expiresAt, renewedAt: now() };
        writeJson(taskLeasePath, renewed);
        return renewed;
      }
      const counterPath = join(leases, "fencing.json");
      const fencingGeneration = Number(readJson(counterPath, { generation: 0 }).generation || 0) + 1;
      writeJson(counterPath, { version: 1, generation: fencingGeneration, updatedAt: now() });
      const executionAttempt = Number(prior.executionAttempt || 0) + 1;
      const acquiredAt = now();
      const leaseId = stableHash({ id, taskId: task.id, owner, fencingGeneration, acquiredAt });
      const created = [];
      try {
        for (const key of keys) {
          const path = leasePath(key);
          mkdirSync(dirname(path), { recursive: true });
          const descriptor = {
            version: 2, key, resource: key, changeId: id, taskId: task.id, owner,
            leaseId, fencingGeneration, executionAttempt,
            graphRevision: plan.graphRevision, graphIdentity: plan.graphIdentity,
            planDigest: plan.planDigest, acquiredAt, expiresAt
          };
          let handle = openSync(path, "wx");
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
        outputSchema: plan.graph?.nodes?.find((entry) => entry.id === `task:${task.id}`)?.outputSchema,
        resources: keys, baselineSurface: observedTaskSurface(id, task),
        acquiredAt, expiresAt
      };
      writeJson(taskLeasePath, lease);
      return lease;
    });
    console.log(`LEASE ACQUIRED ${id}/${task.id}\n  owner: ${owner}\n  lease: ${result.leaseId}\n  generation: ${result.fencingGeneration}\n  attempt: ${result.executionAttempt}\n  expires: ${expiresAt}`);
  }

  function release(id, taskId, flags) {
    const owner = flags.owner;
    if (!taskId || !owner)
      fail("agents release requires <change> <task> --owner <agent-id>");
    const index = join(leases, "tasks", id, `${taskId.toUpperCase()}.json`);
    if (!existsSync(index)) {
      console.log(`LEASE ABSENT ${id}/${taskId.toUpperCase()}`);
      return;
    }
    const taskLease = readJson(index);
    const force = Boolean(flags.force);
    const expired = Date.parse(taskLease.expiresAt || "") <= Date.now();
    // A crashed worker leaves a lease nobody can release, and readiness then
    // tells the user to release it. Takeover is allowed, but a lease that has
    // not expired may still have a live process behind it, so that case costs
    // an explicit decision.
    if (taskLease.owner !== owner) {
      if (!force)
        fail(`lease owner mismatch for '${id}/${taskLease.taskId}'; it belongs to '${taskLease.owner}' and expires ${taskLease.expiresAt}. Re-run with --force to take it over.`);
      if (!expired && !String(flags["decision-ref"] || "").trim())
        fail(`lease '${id}/${taskLease.taskId}' has not expired (expires ${taskLease.expiresAt}); forcing it requires --decision-ref <host-user-decision> because another worker may still be running it`);
    }
    let observedWrites = [];
    if (!force) {
      const currentPlan = agentPlanValue(id);
      if (currentPlan.graphRevision !== taskLease.graphRevision ||
          currentPlan.graphIdentity !== taskLease.graphIdentity ||
          Number(currentPlan.contractRevision) !== Number(taskLease.contractRevision))
        fail(`stale result authority for '${id}/${taskLease.taskId}': graph or contract changed after lease acquisition`);
      const baseline = new Map((taskLease.baselineSurface || []).map((row) => [row.path, row.identity]));
      const currentRows = observedTaskSurface(id, taskLease);
      const current = new Map(currentRows.map((row) => [row.path, row.identity]));
      observedWrites = [...new Set([...baseline.keys(), ...current.keys()])]
        .filter((path) => baseline.get(path) !== current.get(path)).sort();
      const allowed = taskLease.paths || [];
      const outside = observedWrites.filter((path) => !allowed.some((scope) => {
        const prefix = String(scope).replace(/\/\*\*?$/, "").replace(/\/$/, "");
        return scope === "*" || path === prefix || path.startsWith(`${prefix}/`);
      }));
      if (outside.length)
        fail(`task '${taskLease.taskId}' changed outside granted scope: ${outside.join(", ")}; result and proof were not accepted`);
    }
    withAcquisitionLock(() => {
      for (const resource of taskLease.resources || []) {
        const path = leasePath(resource);
        if (!existsSync(path)) continue;
        const current = readJson(path, {});
        if (!force && (current.leaseId !== taskLease.leaseId ||
            Number(current.fencingGeneration) !== Number(taskLease.fencingGeneration)))
          fail(`stale lease result for '${id}/${taskLease.taskId}': generation ${
            taskLease.fencingGeneration} no longer owns '${resource}'`);
        if (!current.expiresAt ||
            (current.changeId === id && current.taskId === taskLease.taskId &&
              (current.owner === owner || force))) rmSync(path);
      }
      if (!force) writeJson(join(leases, "results", id, `${taskLease.taskId}.json`), {
        version: 1, ...taskLease, status: "observed", observedWrites, acceptedAt: now()
      });
      rmSync(index);
    });
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

  function cleanup(id) {
    const resources = join(leases, "resources");
    if (existsSync(resources))
      for (const entry of readdirSync(resources, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(resources, entry.name);
        if (readJson(path, {}).changeId === id) rmSync(path);
      }
    const tasks = join(leases, "tasks", id);
    if (existsSync(tasks)) rmSync(tasks, { recursive: true });
    const results = join(leases, "results", id);
    if (existsSync(results)) rmSync(results, { recursive: true });
  }

  return { leasePath, acquire, release, active, cleanup };
}
