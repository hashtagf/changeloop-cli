import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireLeaseUnderLock,
  cleanupLeaseOperation,
  leaseAcquisitionRequest,
  leaseDescriptorIsOwned,
  leasePathIsAllowed,
  leaseReleaseIdentity,
  leaseRenewalRows,
  leaseResourceConflicts,
  observedLeaseWrites,
  reapExpiredLeaseOperation,
  releaseLeaseUnderLock,
  sameLeaseRenewalAuthority,
  taskNodeOutputSchema
} from "../runtime/workflow/lease-runtime.mjs";

const owned = {
  changeId: "change-a", taskId: "T001", owner: "agent-a",
  key: "path:root:src/api"
};

test("lease ownership requires matching change, task, and owner", () => {
  assert.equal(leaseDescriptorIsOwned(owned, "change-a", "T001", "agent-a"), true);
  assert.equal(leaseDescriptorIsOwned({ ...owned, changeId: "other" },
    "change-a", "T001", "agent-a"), false);
  assert.equal(leaseDescriptorIsOwned({ ...owned, taskId: "T002" },
    "change-a", "T001", "agent-a"), false);
  assert.equal(leaseDescriptorIsOwned({ ...owned, owner: "agent-b" },
    "change-a", "T001", "agent-a"), false);
});

test("lease renewal rows retain only descriptors held by the same authority", () => {
  const rows = [
    { path: "one", descriptor: owned },
    { path: "two", descriptor: { ...owned, owner: "agent-b" } }
  ];
  assert.deepEqual(leaseRenewalRows(
    rows, "change-a", "T001", "agent-a"), [rows[0]]);
  assert.deepEqual(leaseRenewalRows([], "change-a", "T001", "agent-a"), []);
});

test("lease resource conflicts skip renewal rows and preserve legacy resource keys", () => {
  const rows = [{ descriptor: owned }, {
    descriptor: {
      changeId: "other", taskId: "T002", owner: "agent-b",
      resource: "path:root:src"
    }
  }, {
    descriptor: {
      changeId: "other", taskId: "T003", owner: "agent-c",
      key: "path:root:docs"
    }
  }];
  const conflicts = leaseResourceConflicts(
    ["path:root:src/api"], rows, "change-a", "T001", "agent-a",
    (requested, held) => requested.startsWith(held));
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].held, "path:root:src");
  assert.deepEqual(leaseResourceConflicts(
    [], rows, "change-a", "T001", "agent-a"), []);
});

test("lease renewal authority binds keys, owner, graph, and contract revision", () => {
  const renewal = [{ descriptor: owned }];
  const keys = [owned.key];
  const prior = {
    owner: "agent-a", graphRevision: "rev-1",
    graphIdentity: "graph-1", contractRevision: 2
  };
  const plan = {
    graphRevision: "rev-1", graphIdentity: "graph-1", contractRevision: "2"
  };
  assert.equal(sameLeaseRenewalAuthority(
    renewal, keys, prior, "agent-a", plan), true);
  const variants = [
    [[], keys, prior, "agent-a", plan],
    [renewal, ["other"], prior, "agent-a", plan],
    [renewal, keys, prior, "agent-b", plan],
    [renewal, keys, prior, "agent-a", { ...plan, graphRevision: "rev-2" }],
    [renewal, keys, prior, "agent-a", { ...plan, graphIdentity: "graph-2" }],
    [renewal, keys, prior, "agent-a", { ...plan, contractRevision: 3 }]
  ];
  for (const args of variants)
    assert.equal(sameLeaseRenewalAuthority(...args), false);
});

test("task output schema is selected without callback-only coverage", () => {
  const schema = { type: "object" };
  assert.equal(taskNodeOutputSchema({
    graph: { nodes: [{ id: "task:T001", outputSchema: schema }] }
  }, "T001"), schema);
  assert.equal(taskNodeOutputSchema({ graph: { nodes: [] } }, "T001"), undefined);
  assert.equal(taskNodeOutputSchema({}, "T001"), undefined);
});

function requestContext(plan, overrides = {}) {
  return {
    agentPlanValue: () => plan,
    policy: () => ({ execution: { leaseMinutes: 30 } }),
    leases: "/leases",
    exists: () => false,
    readJson: () => ({}),
    nowMs: () => Date.parse("2026-08-27T00:00:00.000Z"),
    fail: (message) => { throw new Error(message); },
    ...overrides
  };
}

test("lease acquisition request validates dispatch, task, dependencies, and owner", () => {
  const task = {
    id: "T001", dependsOn: [], resources: ["repo:root"], repository: "root"
  };
  const plan = { dispatchable: true, tasks: [task] };
  assert.throws(() => leaseAcquisitionRequest(
    requestContext(plan), "change-a", "T001", {}), /requires/);
  assert.throws(() => leaseAcquisitionRequest(
    requestContext(plan), "change-a", "T001", { owner: "bad owner" }), /requires/);
  assert.throws(() => leaseAcquisitionRequest(
    requestContext({ ...plan, dispatchable: false }),
    "change-a", "T001", { owner: "agent-a" }), /conflicts/);
  assert.throws(() => leaseAcquisitionRequest(
    requestContext(plan), "change-a", "missing", { owner: "agent-a" }), /unknown/);
  assert.throws(() => leaseAcquisitionRequest(requestContext({
    ...plan,
    tasks: [{ ...task, dependsOn: ["T002"] }, { id: "T002", dependsOn: [] }]
  }), "change-a", "T001", { owner: "agent-a" }), /blocked by/);

  const result = leaseAcquisitionRequest(requestContext(plan, {
    exists: () => true,
    readJson: () => ({ owner: "prior" })
  }), "change-a", "t001", { owner: "agent-a" });
  assert.deepEqual(result.keys, ["repo:root"]);
  assert.equal(result.prior.owner, "prior");
  assert.equal(result.expiresAt, "2026-08-27T00:30:00.000Z");
});

function lockedContext(overrides = {}) {
  const writes = [];
  const context = {
    id: "change-a",
    task: { id: "T001", repository: "root" },
    owner: "agent-a",
    keys: [],
    prior: {},
    plan: {
      graphRevision: "rev-1", graphIdentity: "graph-1", planDigest: "plan-1",
      contractRevision: 1, workspaceHash: "workspace-1", graph: { nodes: [] }
    },
    expiresAt: "2026-08-27T01:00:00.000Z",
    taskLeasePath: "/leases/tasks/change-a/T001.json",
    leases: "/leases",
    resourceDescriptors: () => [],
    writeJson: (...args) => writes.push(args),
    now: () => "2026-08-27T00:00:00.000Z",
    readJson: () => ({ generation: 0 }),
    stableHash: () => "lease-id",
    leasePath: (key) => `/leases/resources/${key}.json`,
    observedTaskSurface: () => [],
    ...overrides
  };
  return { context, writes };
}

test("lease transaction renews matching authority and rejects conflicts or stale renewal", () => {
  const renewal = { path: "/resource", descriptor: owned };
  const renewed = lockedContext({
    keys: [owned.key],
    prior: {
      owner: "agent-a", graphRevision: "rev-1", graphIdentity: "graph-1",
      contractRevision: 1
    },
    resourceDescriptors: () => [renewal]
  });
  assert.equal(acquireLeaseUnderLock(renewed.context).owner, "agent-a");
  assert.equal(renewed.writes.length, 2);

  const stale = lockedContext({
    keys: [owned.key], prior: { owner: "other" },
    resourceDescriptors: () => [renewal]
  });
  assert.throws(() => acquireLeaseUnderLock(stale.context), /stale lease authority/);

  const conflict = lockedContext({
    keys: ["repo:root"],
    resourceDescriptors: () => [{ descriptor: { key: "repo:root" } }]
  });
  assert.throws(() => acquireLeaseUnderLock(conflict.context),
    /held by unknown\/unknown/);
});

test("lease transaction creates default authority and rolls back partial resources", () => {
  const created = lockedContext({
    plan: {
      graphRevision: "rev-1", graphIdentity: "graph-1", planDigest: "plan-1",
      contractRevision: 1, workspaceHash: "workspace-1",
      graph: { nodes: [{ id: "task:T001", outputSchema: { type: "object" } }] }
    }
  });
  const lease = acquireLeaseUnderLock(created.context);
  assert.equal(lease.fencingGeneration, 1);
  assert.equal(lease.executionAttempt, 1);
  assert.deepEqual(lease.paths, []);
  assert.deepEqual(lease.claimIds, []);
  assert.deepEqual(lease.outputSchema, { type: "object" });

  const root = mkdtempSync(join(tmpdir(), "foundation-lease-rollback-"));
  try {
    const first = join(root, "first.json");
    const second = join(root, "second.json");
    writeFileSync(second, "occupied");
    const rollback = lockedContext({
      keys: ["first", "second"],
      leasePath: (key) => key === "first" ? first : second
    });
    assert.throws(() => acquireLeaseUnderLock(rollback.context), /EEXIST/);
    assert.equal(existsSync(first), false);
    assert.equal(existsSync(second), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expired lease reaping serializes stale locks, residue, and active contenders", () => {
  const removed = [];
  const renamed = [];
  const closed = [];
  reapExpiredLeaseOperation({
    nowMs: () => 100_000, pid: 7,
    lstat: (path) => ({ mtimeMs: path.endsWith(".reap") ? 0 : 90_000 }),
    rename: (...args) => renamed.push(args),
    remove: (...args) => removed.push(args),
    open: () => 11, close: (handle) => closed.push(handle),
    readJson: () => ({ expiresAt: "1970-01-01T00:00:00.000Z" })
  }, "/lease.json");
  assert.deepEqual(renamed, [["/lease.json.reap", "/lease.json.reap.7.stale"]]);
  assert.ok(removed.some(([path]) => path === "/lease.json"));
  assert.deepEqual(closed, [11]);

  let opened = 0;
  reapExpiredLeaseOperation({
    nowMs: () => 100_000, pid: 7,
    lstat: () => { throw new Error("missing"); }, rename: assert.fail, remove: assert.fail,
    open: () => { opened += 1; throw new Error("busy"); }, close: assert.fail,
    readJson: assert.fail
  }, "/lease.json");
  assert.equal(opened, 1);

  const residueRemoved = [];
  reapExpiredLeaseOperation({
    nowMs: () => 100_000, pid: 7,
    lstat: (path) => {
      if (path.endsWith(".reap")) throw new Error("missing");
      return { mtimeMs: 80_000 };
    },
    rename: assert.fail, remove: (path) => residueRemoved.push(path),
    open: () => 12, close: () => {}, readJson: () => ({})
  }, "/lease.json");
  assert.deepEqual(residueRemoved, ["/lease.json", "/lease.json.reap"]);

  const freshRemoved = [];
  reapExpiredLeaseOperation({
    nowMs: () => 100_000, pid: 7,
    lstat: (path) => {
      if (path.endsWith(".reap")) throw new Error("missing");
      return { mtimeMs: 99_999 };
    },
    rename: assert.fail, remove: (path) => freshRemoved.push(path),
    open: () => 13, close: () => {}, readJson: () => ({})
  }, "/lease.json");
  assert.deepEqual(freshRemoved, ["/lease.json.reap"]);
});

function releaseFail(message) { throw new Error(message); }

test("release identity validates absence, owner, generation, and takeover decisions", () => {
  const logs = [];
  const base = {
    leases: "/leases", exists: () => false, readJson: () => ({}),
    nowMs: () => Date.parse("2026-08-27T00:00:00Z"), fail: releaseFail,
    log: (message) => logs.push(message)
  };
  assert.throws(() => leaseReleaseIdentity(base, "change", "T001", {}), /requires/);
  assert.deepEqual(leaseReleaseIdentity(base, "change", "t001", { owner: "agent" }), {
    absent: true
  });
  assert.match(logs[0], /LEASE ABSENT change\/T001/);

  const live = {
    taskId: "T001", owner: "other", leaseId: "lease-2", executionAttempt: 2,
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
  const present = { ...base, exists: () => true, readJson: () => live };
  assert.throws(() => leaseReleaseIdentity(present, "change", "T001", { owner: "agent" }),
    /lease id is required/);
  assert.throws(() => leaseReleaseIdentity(present, "change", "T001", {
    owner: "agent", "lease-id": "stale"
  }), /stale lease result/);
  assert.throws(() => leaseReleaseIdentity(present, "change", "T001", {
    owner: "agent", "lease-id": "lease-2"
  }), /owner mismatch/);
  assert.throws(() => leaseReleaseIdentity(present, "change", "T001", {
    owner: "agent", force: true
  }), /requires --decision-ref/);
  assert.equal(leaseReleaseIdentity(present, "change", "T001", {
    owner: "agent", force: true, "decision-ref": "host://decision"
  }).force, true);
});

test("observed release writes enforce graph authority and granted path scopes", () => {
  assert.equal(leasePathIsAllowed("src/app.mjs", ["*"]), true);
  assert.equal(leasePathIsAllowed("src", ["src/**"]), true);
  assert.equal(leasePathIsAllowed("src/app.mjs", ["src/"]), true);
  assert.equal(leasePathIsAllowed("docs/readme.md", ["src/**"]), false);
  const lease = {
    taskId: "T001", graphRevision: "g", graphIdentity: "gi", contractRevision: 1,
    baselineSurface: [
      { path: "src/a.mjs", identity: "old" },
      { path: "src/same.mjs", identity: "same" }
    ],
    paths: ["src/**"]
  };
  const context = {
    agentPlanValue: () => ({
      graphRevision: "g", graphIdentity: "gi", contractRevision: "1"
    }),
    observedTaskSurface: () => [
      { path: "src/a.mjs", identity: "new" },
      { path: "src/same.mjs", identity: "same" },
      { path: "src/new.mjs", identity: "new" }
    ],
    fail: releaseFail
  };
  assert.deepEqual(observedLeaseWrites(context, "change", lease, false), [
    "src/a.mjs", "src/new.mjs"
  ]);
  assert.deepEqual(observedLeaseWrites(context, "change", lease, true), []);
  assert.throws(() => observedLeaseWrites({
    ...context, agentPlanValue: () => ({
      graphRevision: "changed", graphIdentity: "gi", contractRevision: 1
    })
  }, "change", lease, false), /graph or contract changed/);
  assert.throws(() => observedLeaseWrites({
    ...context, observedTaskSurface: () => [{ path: "docs/readme.md", identity: "new" }]
  }, "change", lease, false), /outside granted scope/);
});

test("locked release fences resources and persists observed or takeover results", () => {
  const writes = [];
  const removed = [];
  const taskLease = {
    taskId: "T001", owner: "agent", leaseId: "lease", fencingGeneration: 2,
    executionAttempt: 0, resources: ["missing", "owned"]
  };
  const base = {
    id: "change", owner: "agent", index: "/index", taskLease,
    observedWrites: ["src/a.mjs"], leases: "/leases",
    leasePath: (resource) => `/${resource}`,
    exists: (path) => path !== "/missing",
    readJson: () => ({
      leaseId: "lease", fencingGeneration: 2, changeId: "change", taskId: "T001",
      owner: "agent", expiresAt: null
    }),
    fail: releaseFail, remove: (path) => removed.push(path),
    writeJson: (...args) => writes.push(args), now: () => "now"
  };
  releaseLeaseUnderLock({ ...base, force: false });
  assert.deepEqual(removed, ["/owned", "/index"]);
  assert.equal(writes[0][1].status, "observed");

  writes.length = 0;
  removed.length = 0;
  releaseLeaseUnderLock({ ...base, force: true });
  assert.equal(writes[0][0], "/index");
  assert.equal(writes[0][1].status, "taken-over");
  assert.equal(writes[0][1].executionAttempt, 1);

  assert.throws(() => releaseLeaseUnderLock({
    ...base, force: false, readJson: () => ({ leaseId: "stale", fencingGeneration: 1 })
  }), /generation/);
});

test("lease cleanup removes only matching resources plus task and result trees", () => {
  const removed = [];
  const entries = [
    { name: "keep.txt", isFile: () => true },
    { name: "directory.json", isFile: () => false },
    { name: "other.json", isFile: () => true },
    { name: "owned.json", isFile: () => true }
  ];
  cleanupLeaseOperation({
    leases: "/leases", exists: () => true, readDirectory: () => entries,
    readJson: (path) => ({ changeId: path.endsWith("owned.json") ? "change" : "other" }),
    remove: (...args) => removed.push(args)
  }, "change");
  assert.deepEqual(removed, [
    ["/leases/resources/owned.json"],
    ["/leases/tasks/change", { recursive: true }],
    ["/leases/results/change", { recursive: true }]
  ]);
  cleanupLeaseOperation({
    leases: "/leases", exists: () => false,
    readDirectory: assert.fail, readJson: assert.fail, remove: assert.fail
  }, "change");
});
