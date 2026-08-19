import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  compileExecutionGraph, conflictKeysForTask, conflictKeysOverlap,
  compileLandPreparation, dependentClosure, landPreparationMatches,
  schemasCompatible, singleAgentExecutionEligible, validateNodeResult
} from "../runtime/core/graph-execution.mjs";
import { createLeaseRuntime } from "../runtime/workflow/lease-runtime.mjs";

const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");

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

test("authority: a single-repository host session remains valid beyond two tasks", () => {
  const tasks = Array.from({ length: 5 }, (_, index) => ({
    repository: "root", resources: ["workspace:root"], id: `T00${index + 1}`
  }));
  assert.equal(singleAgentExecutionEligible(tasks, []), true);
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
  assert.ok(existsSync(join(root, "tasks", "c", "T001.json")));
  assert.throws(() => runtime.acquire("c", "T003", { owner: "c" }), /conflicts with/);
  assert.equal(existsSync(join(root, "tasks", "c", "T003.json")), false);
});

// Kept local to avoid a helper dependency in the shipped test fixture.
import * as awaitImportFs from "node:fs";

test("upgrade: graph state is derived and requires no authored graph file", () => {
  const graph = compileExecutionGraph(fixture());
  assert.equal(graph.version, 2);
  assert.match(graph.revision, /^graph-v2-/);
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
