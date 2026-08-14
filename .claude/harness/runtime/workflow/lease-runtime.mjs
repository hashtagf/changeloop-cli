import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync,
  renameSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

export function createLeaseRuntime({
  leases,
  stableHash,
  agentPlanValue,
  policy,
  readJson,
  writeJson,
  now,
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
    const acquired = [];
    const created = [];
    try {
      for (const resource of task.resources) {
        const path = leasePath(resource);
        mkdirSync(dirname(path), { recursive: true });
        if (existsSync(path)) {
          const current = readJson(path, {});
          // A descriptor with no expiry is a lease nothing can ever release:
          // the expiry branch never fires and every ownership-guarded delete
          // needs a changeId an empty file cannot carry. It is the residue of
          // a create that succeeded and a write that did not, so treat it the
          // same as expired.
          if (!current.expiresAt || Date.parse(current.expiresAt) <= Date.now())
            reapExpiredLease(path);
          else if (current.changeId === id && current.taskId === task.id &&
                   current.owner === owner) {
            writeJson(path, { ...current, expiresAt, renewedAt: now() });
            acquired.push(path);
            continue;
          } else {
            throw new Error(`resource '${resource}' is leased by ${current.changeId || "unknown"}/${current.taskId || "unknown"}`);
          }
        }
        const descriptor = {
          version: 1, resource, changeId: id, taskId: task.id, owner,
          planDigest: plan.planDigest, acquiredAt: now(), expiresAt
        };
        // Record ownership before the write, not after: a write that fails
        // here would otherwise leave a file this process created and no longer
        // claims, and the rollback below would skip it.
        let handle;
        try {
          handle = openSync(path, "wx");
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          // A contender won the takeover between the expiry check and here.
          const winner = readJson(path, {});
          throw new Error(`resource '${resource}' is leased by ${
            winner.changeId || "unknown"}/${winner.taskId || "unknown"}`);
        }
        created.push(path);
        try { writeFileSync(handle, `${JSON.stringify(descriptor, null, 2)}\n`); }
        finally { closeSync(handle); }
        acquired.push(path);
      }
    } catch (error) {
      for (const path of created) {
        if (!existsSync(path)) continue;
        const current = readJson(path, {});
        // An empty descriptor is one this loop created and failed to fill in.
        if (!current.changeId ||
            (current.changeId === id && current.taskId === task.id && current.owner === owner))
          rmSync(path);
      }
      fail(error.message);
    }
    writeJson(join(leases, "tasks", id, `${task.id}.json`), {
      version: 1, changeId: id, taskId: task.id, owner,
      resources: task.resources, planDigest: plan.planDigest, expiresAt
    });
    console.log(`LEASE ACQUIRED ${id}/${task.id}\n  owner: ${owner}\n  expires: ${expiresAt}`);
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
    for (const resource of taskLease.resources || []) {
      const path = leasePath(resource);
      if (!existsSync(path)) continue;
      const current = readJson(path, {});
      if (!current.expiresAt ||
          (current.changeId === id && current.taskId === taskLease.taskId &&
            (current.owner === owner || force))) rmSync(path);
    }
    rmSync(index);
    console.log(`LEASE RELEASED ${id}/${taskLease.taskId}${
      taskLease.owner === owner ? "" : `\n  taken over from: ${taskLease.owner}`}`);
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
  }

  return { leasePath, acquire, release, active, cleanup };
}
