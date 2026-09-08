import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  compileExecutionGraph, conflictKeysForTask, conflictKeysOverlap,
  compileLandPreparation, dependentClosure, landPreparationMatches,
  schemasCompatible, scheduleReadyBatch, singleAgentExecutionEligible, validateNodeResult
} from "../runtime/core/graph-execution.mjs";

import { createLeaseRuntime } from "../runtime/workflow/lease-runtime.mjs";

const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");

test("execution graph requires the shared stable hash implementation", () => {
  assert.throws(() => compileExecutionGraph({}), /requires stableHash/);
});

function fixture(overrides = {}) {
  return {
    changeId: "graph-change",
    contractRevision: 1,
    workspaceHash: "workspace-1",
    repositories: [
      { id: "api", mode: "write", dependsOn: [] },
      { id: "web", mode: "write", dependsOn: ["api"] },
      { id: "mobile", mode: "write", dependsOn: ["api"] }
    ],
    tasks: [
      { id: "T001", repository: "api", paths: ["src/api/**"], claims: ["api-contract"] },
      { id: "T002", repository: "web", paths: ["src/web/**"], claims: ["web-ui"], dependsOn: ["T001"] },
      { id: "T003", repository: "mobile", paths: ["src/mobile/**"], claims: ["mobile-ui"], dependsOn: ["T001"] }
    ],
    claims: [
      { id: "api-contract", capabilities: ["test"] },
      { id: "web-ui", capabilities: ["test"] },
      { id: "mobile-ui", capabilities: ["test"] }
    ],
    providers: [{ id: "test", capability: "test", resources: ["suite"] }],
    stableHash,
    ...overrides
  };
}

test("identity: identical artifacts compile to the same graph", () => {
  assert.equal(compileExecutionGraph(fixture()).identity,
    compileExecutionGraph(fixture()).identity);
});

test("identity: contract changes graph identity while workspace state stays edge authority", () => {
  const base = compileExecutionGraph(fixture());
  assert.equal(base.identity,
    compileExecutionGraph(fixture({ workspaceHash: "workspace-2" })).identity);
  assert.notEqual(base.identity,
    compileExecutionGraph(fixture({ contractRevision: 2 })).identity);
  const changed = fixture();
  changed.tasks[0].text = "changed task authority";
  assert.notEqual(base.identity, compileExecutionGraph(changed).identity);
});

test("identity: graph refuses an unknown dependency", () => {
  const value = fixture();
  value.tasks[1].dependsOn = ["T999"];
  assert.throws(() => compileExecutionGraph(value), /unknown node/);
});

test("identity: graph refuses a concrete cycle", () => {
  const value = fixture();
  value.tasks[0].dependsOn = ["T002"];
  assert.throws(() => compileExecutionGraph(value), /dependency cycle/);
});

test("contract: compatible schema versions cross an edge", () => {
  assert.equal(schemasCompatible(
    { name: "contract", version: 1 },
    { name: "contract", version: 2, accepts: [1] }), true);
});

test("contract: string schema mismatches return false without throwing", () => {
  assert.equal(schemasCompatible("api@2", "api@1"), false);
  assert.equal(schemasCompatible("api@1", "api@1"), true);
});

test("cross-repo: explicit read dependencies remain in identity without Land nodes", () => {
  const value = fixture();
  value.repositories.push({ id: "contracts", mode: "read", dependsOn: [] });
  value.repositories[0].dependsOn = ["contracts"];
  const graph = compileExecutionGraph(value);
  assert.ok(!graph.nodes.some((row) => row.id === "land:contracts"));
  assert.ok(graph.edges.some((row) => row.id === "land:api->land:web"));
  value.repositories[0].dependsOn = [];
  assert.notEqual(graph.identity, compileExecutionGraph(value).identity);
  value.repositories[0].dependsOn = ["missing"];
  assert.throws(() => compileExecutionGraph(value), /unknown node/);
});

test("contract: an implicit input schema rejects a different producer version", () => {
  assert.equal(schemasCompatible(
    { name: "foundation.node-data", version: 2 }, null), false);
});

test("contract: incompatible producer and consumer block compilation", () => {
  const value = fixture();
  value.tasks[0].outputSchema = "api@1";
  value.tasks[1].inputSchema = "api@2";
  assert.throws(() => compileExecutionGraph(value), /incompatible graph edge/);
});

test("cross-repo: independent web and mobile nodes share the API predecessor", () => {
  const graph = compileExecutionGraph(fixture());
  assert.ok(graph.edges.some((edge) => edge.id === "task:T001->task:T002"));
  assert.ok(graph.edges.some((edge) => edge.id === "task:T001->task:T003"));
  assert.ok(graph.nodes.some((node) => node.id === "land:web"));
  assert.ok(graph.nodes.some((node) => node.id === "land:mobile"));
});

test("cross-repo: a spanning provider gates writable repositories but creates no read Land node", () => {
  const value = fixture({
    ...fixture(),
    repositories: [
      ...fixture().repositories,
      { id: "contracts", mode: "read", dependsOn: [] }
    ],
    providers: [{
      id: "integration", capability: "test", repository: "api",
      repositories: ["api", "web", "mobile", "contracts"], resources: ["suite"]
    }]
  });
  const graph = compileExecutionGraph(value);
  const provider = graph.nodes.find((node) => node.id === "provider:integration");
  assert.deepEqual(provider.repositories, ["api", "contracts", "mobile", "web"]);
  assert.ok(graph.edges.some((edge) => edge.id === "provider:integration->land:api"));
  assert.ok(graph.edges.some((edge) => edge.id === "provider:integration->land:web"));
  assert.ok(graph.edges.some((edge) => edge.id === "provider:integration->land:mobile"));
  assert.ok(!graph.nodes.some((node) => node.id === "land:contracts"));
});

test("failure: dependent closure preserves an independent branch", () => {
  const graph = compileExecutionGraph(fixture({
    ...fixture(),
    repositories: [...fixture().repositories, { id: "docs", mode: "write", dependsOn: [] }],
    tasks: [...fixture().tasks, { id: "T004", repository: "docs", paths: ["docs/**"], claims: [] }]
  }));
  const affected = dependentClosure(graph, ["task:T003"]);
  assert.ok(affected.includes("provider:test"));
  assert.ok(affected.includes("land:mobile"));
  assert.ok(!affected.includes("task:T004"));
});

test("scope: disjoint path keys do not conflict", () => {
  assert.equal(conflictKeysOverlap("path:root:src/api", "path:root:src/web"), false);
});

test("scope: parent and child path keys conflict", () => {
  assert.equal(conflictKeysOverlap("path:root:src", "path:root:src/api"), true);
});

test("scope: repository fallback conflicts with every path in that repository", () => {
  assert.equal(conflictKeysOverlap("repo:root", "path:root:src/api"), true);
  assert.deepEqual(conflictKeysForTask({ repository: "root", paths: [] }), ["repo:root"]);
});

test("authority: multiple single-repository tasks use planned dispatch", () => {
  const tasks = Array.from({ length: 5 }, (_, index) => ({
    repository: "root", resources: ["workspace:root"], id: `T00${index + 1}`
  }));
  assert.equal(singleAgentExecutionEligible(tasks, []), false);
  assert.equal(singleAgentExecutionEligible([tasks[0]], []), true);
  assert.equal(singleAgentExecutionEligible([
    ...tasks, { repository: "api", resources: ["workspace:api"], id: "T006" }
  ], []), false);
  assert.equal(singleAgentExecutionEligible([
    { ...tasks[0], resources: ["workspace:root", "dev-server"] }
  ], []), false);
  assert.equal(singleAgentExecutionEligible(tasks, [
    { repositories: ["root", "contracts"] }
  ]), false);
});

test("scheduler: longest ready dependency chain wins before deterministic siblings", () => {
  const nodes = [
    { id: "short", dependsOn: [], resources: [] },
    { id: "long", dependsOn: [], resources: [] },
    { id: "middle", dependsOn: ["long"], resources: [] },
    { id: "end", dependsOn: ["middle"], resources: [] }
  ];
  const result = scheduleReadyBatch(nodes, new Set(), { maxParallel: 1 });
  assert.deepEqual(result.selected.map((row) => row.id), ["long"]);
});

test("scheduler: capacity and resource conflicts bound a ready wave", () => {
  const nodes = [
    { id: "a", dependsOn: [], resources: ["db"] },
    { id: "b", dependsOn: [], resources: ["db"] },
    { id: "c", dependsOn: [], resources: ["browser"] }
  ];
  const result = scheduleReadyBatch(nodes, new Set(), {
    maxParallel: 2,
    conflicts: (left, right) => left.resources.some((value) => right.resources.includes(value))
  });
  assert.deepEqual(result.selected.map((row) => row.id), ["a", "c"]);
  assert.deepEqual(scheduleReadyBatch(nodes, new Set(["a"]), { maxParallel: 3 })
    .selected.map((row) => row.id), ["b", "c"]);
});

test("graph: setup and service nodes gate tasks and providers", () => {
  const value = fixture();
  value.repositories[0].setupCommand = "npm ci";
  value.services = [{ id: "api", resources: ["port:3000"] }];
  value.providers[0].service = "api";
  const graph = compileExecutionGraph(value);
  assert.ok(graph.edges.some((edge) => edge.id === "setup:api->task:T001"));
  assert.ok(graph.edges.some((edge) => edge.id === "service:api->provider:test"));
});

const authority = {
  graphRevision: "g1", planDigest: "p1", contractRevision: 1,
  workspaceHash: "w1", leaseId: "l1", fencingGeneration: 4,
  executionAttempt: 2, repository: "root", paths: ["src/api/**"],
  claimIds: ["api"], outputSchema: { name: "foundation.node-data", version: 1 }
};

test("authority: matching fenced result and observed writes advance", () => {
  const result = validateNodeResult(authority, {
    ...authority, claimIds: ["api"], outputSchema: authority.outputSchema
  }, ["src/api/index.mjs"]);
  assert.equal(result.valid, true);
});

test("authority: a late worker generation is rejected", () => {
  const result = validateNodeResult(authority, {
    ...authority, fencingGeneration: 3, claimIds: ["api"], outputSchema: authority.outputSchema
  }, []);
  assert.equal(result.valid, false);
  assert.deepEqual(result.mismatches, ["fencingGeneration"]);
});

test("authority: observed writes override an incomplete worker report", () => {
  const result = validateNodeResult(authority, {
    ...authority, claimIds: ["api"], outputSchema: authority.outputSchema
  }, ["src/web/undeclared.mjs"]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.unexpectedWrites, ["src/web/undeclared.mjs"]);
});

test("authority: an undeclared path scope grants whole-tree write authority", () => {
  const wholeTree = { ...authority, paths: [] };
  const result = validateNodeResult(wholeTree, {
    ...wholeTree, claimIds: ["api"], outputSchema: wholeTree.outputSchema
  }, ["src/anywhere/index.mjs"]);
  assert.equal(result.valid, true);
});

function json(path, fallback = {}) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

test("lease: disjoint keys acquire atomically with increasing fencing", () => {
  const root = mkdtempSync(join(tmpdir(), "graph-lease-"));
  const plans = new Map([
    ["T001", { id: "T001", dependsOn: [], leaseKeys: ["path:root:src/api"], paths: ["src/api/**"], claims: [], repository: "root" }],
    ["T002", { id: "T002", dependsOn: [], leaseKeys: ["path:root:src/web"], paths: ["src/web/**"], claims: [], repository: "root" }],
    ["T003", { id: "T003", dependsOn: [], leaseKeys: ["path:root:src"], paths: ["src/**"], claims: [], repository: "root" }]
  ]);
  const runtime = createLeaseRuntime({
    leases: root, stableHash,
    agentPlanValue: () => ({
      dispatchable: true, planDigest: "p", graphRevision: "g", graphIdentity: "gi",
      contractRevision: 1, workspaceHash: "w", tasks: [...plans.values()],
      graph: { nodes: [] }
    }),
    policy: () => ({ execution: { leaseMinutes: 45 } }),
    readJson: json,
    writeJson: (path, value) => {
      const { mkdirSync, writeFileSync } = awaitImportFs;
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    now: () => "2026-08-18T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  runtime.acquire("c", "T001", { owner: "a" });
  plans.get("T001").leaseKeys = ["path:root:src/changed"];
  assert.throws(() => runtime.acquire("c", "T001", { owner: "a" }),
    /stale lease authority/);
  plans.get("T001").leaseKeys = ["path:root:src/api"];
  runtime.acquire("c", "T002", { owner: "b" });
  const one = json(join(root, "tasks", "c", "T001.json"));
  const two = json(join(root, "tasks", "c", "T002.json"));
  assert.ok(one.fencingGeneration < two.fencingGeneration);
  assert.equal(one.executionAttempt, 1);
  assert.equal(two.executionAttempt, 1);
  assert.ok(existsSync(join(root, "tasks", "c", "T001.json")));
  assert.throws(() => runtime.acquire("c", "T003", { owner: "c" }), /conflicts with/);
  assert.equal(existsSync(join(root, "tasks", "c", "T003.json")), false);
  runtime.release("c", "T002", { owner: "b" });
  assert.equal(existsSync(join(root, "tasks", "c", "T002.json")), false,
    "a first attempt stays generation-compatible even when the global fence is above one");
});

// Kept local to avoid a helper dependency in the shipped test fixture.
import * as awaitImportFs from "node:fs";

test("lease: a takeover under the same owner rejects the superseded generation's release, accepts the current one", () => {
  const root = mkdtempSync(join(tmpdir(), "graph-lease-takeover-"));
  const plan = {
    dispatchable: true, planDigest: "p", graphRevision: "g", graphIdentity: "gi",
    contractRevision: 1, workspaceHash: "w",
    tasks: [{ id: "T001", dependsOn: [], leaseKeys: ["path:root:src"], paths: ["src/**"], claims: [], repository: "root" }],
    graph: { nodes: [] }
  };
  const runtime = createLeaseRuntime({
    leases: root, stableHash,
    agentPlanValue: () => plan,
    policy: () => ({ execution: { leaseMinutes: 45 } }),
    readJson: json,
    writeJson: (path, value) => {
      const { mkdirSync, writeFileSync } = awaitImportFs;
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    now: () => "2026-08-18T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });

  // `owner` is stable per (changeId, graphRevision, taskId) — a redispatch
  // after a restart recomputes the same string, so a takeover can happen
  // under an unchanged owner name.
  runtime.acquire("c", "T001", { owner: "dispatch-t001" });
  const taskIndex = join(root, "tasks", "c", "T001.json");
  const before = json(taskIndex);
  const past = "2020-01-01T00:00:00.000Z";
  awaitImportFs.writeFileSync(taskIndex, `${JSON.stringify({ ...before, expiresAt: past })}\n`);
  for (const key of before.resources || []) {
    const path = runtime.leasePath(key);
    const descriptor = json(path);
    awaitImportFs.writeFileSync(path, `${JSON.stringify({ ...descriptor, expiresAt: past })}\n`);
  }

  runtime.acquire("c", "T001", { owner: "dispatch-t001" });
  const after = json(taskIndex);
  assert.ok(after.fencingGeneration > before.fencingGeneration);
  assert.notEqual(after.leaseId, before.leaseId);

  assert.throws(() => runtime.release("c", "T001", {
    owner: "dispatch-t001"
  }), /lease id is required/);
  assert.ok(existsSync(taskIndex), "a generation-less release must not clear a takeover");

  // The straggler from the superseded generation presents the lease id it
  // was actually granted; owner equality alone must not be enough.
  assert.throws(() => runtime.release("c", "T001", {
    owner: "dispatch-t001", "lease-id": before.leaseId
  }), /stale lease result/);
  assert.ok(existsSync(taskIndex), "the current generation's lease must survive a stale release");

  runtime.release("c", "T001", { owner: "dispatch-t001", "lease-id": after.leaseId });
  assert.equal(existsSync(taskIndex), false);
});

test("lease: force recovery preserves task-local fencing across reacquisition", () => {
  const root = mkdtempSync(join(tmpdir(), "graph-lease-force-takeover-"));
  const plan = {
    dispatchable: true, planDigest: "p", graphRevision: "g", graphIdentity: "gi",
    contractRevision: 1, workspaceHash: "w",
    tasks: [{ id: "T001", dependsOn: [], leaseKeys: ["path:root:src"],
      paths: ["src/**"], claims: [], repository: "root" }],
    graph: { nodes: [] }
  };
  const runtime = createLeaseRuntime({
    leases: root, stableHash,
    agentPlanValue: () => plan,
    policy: () => ({ execution: { leaseMinutes: 45 } }),
    readJson: json,
    writeJson: (path, value) => {
      const { mkdirSync, writeFileSync } = awaitImportFs;
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    now: () => "2026-08-18T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });

  runtime.acquire("c", "T001", { owner: "dispatch-t001" });
  const taskIndex = join(root, "tasks", "c", "T001.json");
  const before = json(taskIndex);
  runtime.release("c", "T001", {
    owner: "recovery-host", force: true, "decision-ref": "fixture://takeover"
  });
  const tombstone = json(taskIndex);
  assert.equal(tombstone.status, "taken-over");
  assert.equal(tombstone.executionAttempt, 1);
  assert.throws(() => runtime.release("c", "T001", { owner: "dispatch-t001" }),
    /prior lease was taken over/);
  assert.throws(() => runtime.release("c", "T001", {
    owner: "dispatch-t001", "lease-id": before.leaseId
  }), /prior lease was taken over/);
  assert.equal(existsSync(taskIndex), true, "stale release must preserve the fencing tombstone");
  assert.equal(existsSync(join(root, "results", "c", "T001.json")), false,
    "a stale executor must not create an observed result after force recovery");

  runtime.acquire("c", "T001", { owner: "dispatch-t001" });
  const after = json(taskIndex);
  assert.equal(after.executionAttempt, 2);
  assert.notEqual(after.leaseId, before.leaseId);
  assert.throws(() => runtime.release("c", "T001", { owner: "dispatch-t001" }),
    /lease id is required/);
  assert.throws(() => runtime.release("c", "T001", {
    owner: "dispatch-t001", "lease-id": before.leaseId
  }), /stale lease result/);
  runtime.release("c", "T001", {
    owner: "dispatch-t001", "lease-id": after.leaseId
  });
  assert.equal(existsSync(taskIndex), false);
});

function leaseRuntimeFixture(root, task, surfaces) {
  let call = 0;
  return createLeaseRuntime({
    leases: root, stableHash,
    agentPlanValue: () => ({
      dispatchable: true, planDigest: "p", graphRevision: "g", graphIdentity: "gi",
      contractRevision: 1, workspaceHash: "w", tasks: [task], graph: { nodes: [] }
    }),
    policy: () => ({ execution: { leaseMinutes: 45 } }),
    readJson: json,
    writeJson: (path, value) => {
      const { mkdirSync, writeFileSync } = awaitImportFs;
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    now: () => "2026-08-18T00:00:00.000Z",
    observedTaskSurface: () => surfaces[Math.min(call++, surfaces.length - 1)],
    fail: (message) => { throw new Error(message); }
  });
}

test("release: a write outside the granted path scope is not accepted", () => {
  const root = mkdtempSync(join(tmpdir(), "graph-lease-authority-"));
  const task = { id: "T001", dependsOn: [], leaseKeys: ["path:root:src/api"], paths: ["src/api/**"], claims: [], repository: "root" };
  const runtime = leaseRuntimeFixture(root, task, [
    [], [{ path: "src/web/undeclared.mjs", identity: "sha:1" }]
  ]);
  runtime.acquire("c", "T001", { owner: "a" });
  assert.throws(() => runtime.release("c", "T001", { owner: "a" }),
    /changed outside granted scope/);
});

test("release: an undeclared path scope grants whole-tree write authority", () => {
  const root = mkdtempSync(join(tmpdir(), "graph-lease-authority-"));
  const task = { id: "T001", dependsOn: [], leaseKeys: ["repo:root"], claims: [], repository: "root" };
  const runtime = leaseRuntimeFixture(root, task, [
    [], [{ path: "src/anywhere/index.mjs", identity: "sha:1" }]
  ]);
  runtime.acquire("c", "T001", { owner: "a" });
  runtime.release("c", "T001", { owner: "a" });
  const record = json(join(root, "results", "c", "T001.json"));
  assert.deepEqual(record.observedWrites, ["src/anywhere/index.mjs"]);
});

test("upgrade: graph state is derived and requires no authored graph file", () => {
  const graph = compileExecutionGraph(fixture());
  assert.equal(graph.version, 3);
  assert.match(graph.revision, /^graph-v3-/);
});

test("land: target drift invalidates a prepared remote wave", () => {
  const base = {
    changeId: "c", graphRevision: "g1", graphIdentity: "gi",
    aggregateProofRunId: "proof-1", aggregateProofIdentity: "gi",
    workspaceHash: "w", stableHash, preparedAt: "now",
    repositories: [{
      id: "api", mode: "write", authorizedCommit: "commit-1", ci: "pass",
      targetHead: "target-1", status: "child-landed", recoveryDisposition: "forward-fix"
    }]
  };
  const prepared = compileLandPreparation(base);
  const drifted = compileLandPreparation({
    ...base,
    repositories: [{ ...base.repositories[0], targetHead: "target-2" }]
  });
  assert.equal(prepared.status, "prepared");
  assert.equal(landPreparationMatches(prepared, drifted), false);
});
