import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  taskNodeProof, taskPacketWasPrecompletedOperation
} from "../runtime/evidence/proof-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-task-node-proof-"));
const runRoot = join(root, "proof-run");
const resultPath = join(root, "task-result.json");
const id = "task-proof";
const node = {
  id: "task:T1", kind: "task", lifecycle: "build", repository: "root",
  paths: ["src/**"], claims: ["claim-1"], resources: ["workspace:root"],
  outputSchema: { name: "result", version: 1 }
};
const graph = {
  revision: 3, identity: "graph-identity", claims: [], nodes: [node]
};
const state = { graphExecutionVersion: 2, contractRevision: 4 };
const validResult = {
  taskId: "T1", repository: "root", graphRevision: 3,
  graphIdentity: "graph-identity", contractRevision: 4,
  paths: ["src/**"], claimIds: ["claim-1"],
  outputSchema: { name: "result", version: 1 }, status: "observed",
  planDigest: "plan-digest", workspaceHash: "workspace-hash", leaseId: "lease-1",
  fencingGeneration: 1, executionAttempt: 1,
  observedWrites: ["src/implemented.js"]
};
writeFileSync(resultPath, `${JSON.stringify({ value: validResult }, null, 2)}\n`);

const fileDigest = (path) => createHash("sha256")
  .update(readFileSync(path)).digest("hex");
const pathCovered = (path, scopes) => scopes.some((scope) => {
  const prefix = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
  return scope === "*" || path === prefix || path.startsWith(`${prefix}/`);
});
const fail = (message) => { throw new Error(message); };
const dependencies = (overrides = {}) => ({
  root, fileDigest, legacyExecutionPolicy: null, taskPacketWasPrecompleted: null,
  taskResult: null, savedAgentPlan: null, pathCovered, fail, ...overrides
});

try {
  const packetPath = join(root, "tasks.md");
  writeFileSync(packetPath, "done\n");
  const packetDependencies = {
    loadRuntime: () => ({ workspace: { packetSnapshot: { "tasks.md": fileDigest(packetPath) } } }),
    activeChangePath: () => root, exists: () => true, fileDigest
  };
  assert.equal(taskPacketWasPrecompletedOperation(packetDependencies, id), true);
  assert.equal(taskPacketWasPrecompletedOperation({
    ...packetDependencies, exists: () => false
  }, id), false);
  assert.equal(taskPacketWasPrecompletedOperation({
    ...packetDependencies, loadRuntime: () => ({})
  }, id), false);

  assert.equal(taskNodeProof(dependencies(), id, node, graph, {}, runRoot).source,
    "legacy-upgrade");
  assert.equal(taskNodeProof(dependencies({ legacyExecutionPolicy: () => true }),
    id, node, graph, state, runRoot).source, "legacy-policy");
  assert.equal(taskNodeProof(dependencies({
    legacyExecutionPolicy: () => false,
    taskPacketWasPrecompleted: (changeId) => changeId === id
  }), id, node, graph, state, runRoot).source, "precompleted-at-isolation");

  const eligible = taskNodeProof(dependencies(), id, node, graph, state, runRoot);
  assert.equal(eligible.source, "single-agent-observed");

  const ineligibleNode = { ...node, resources: ["shared-database"] };
  const ineligibleGraph = { ...graph, nodes: [ineligibleNode] };
  assert.throws(() => taskNodeProof(dependencies(), id, ineligibleNode,
    ineligibleGraph, state, runRoot), /lacks an accepted lease result/);

  const savedPlan = () => ({
    taskExecution: {
      T1: {
        mode: "single-agent-observed", graphRevision: 3, graphIdentity: "graph-identity"
      }
    }
  });
  assert.equal(taskNodeProof(dependencies({ savedAgentPlan: savedPlan }), id,
    ineligibleNode, ineligibleGraph, state, runRoot).source, "single-agent-observed");
  const stalePlan = () => ({
    taskExecution: {
      T1: { mode: "worker", graphRevision: 2, graphIdentity: "stale" }
    }
  });
  assert.throws(() => taskNodeProof(dependencies({ savedAgentPlan: stalePlan }), id,
    ineligibleNode, ineligibleGraph, state, runRoot), /lacks an accepted lease result/);

  const accepted = taskNodeProof(dependencies({
    taskResult: () => ({ path: resultPath, value: structuredClone(validResult) })
  }), id, node, graph, state, runRoot);
  assert.equal(accepted.source, "accepted-lease-result");
  assert.equal(accepted.resultAuthority.leaseId, "lease-1");
  assert.equal(accepted.resultAuthority.sha256,
    fileDigest(join(runRoot, "nodes", "T1.json")));
  assert.equal(accepted.resultAuthority.size > 0, true);

  const invalidResult = {
    taskId: "wrong", repository: "other", graphRevision: 1,
    graphIdentity: "wrong", contractRevision: 1,
    paths: ["other/**"], claimIds: ["other-claim"],
    outputSchema: { name: "wrong", version: 9 }, status: "claimed",
    planDigest: "", workspaceHash: null, leaseId: "",
    fencingGeneration: 0, executionAttempt: "bad",
    observedWrites: ["outside/file.js", "outside/file.js"]
  };
  assert.throws(() => taskNodeProof(dependencies({
    legacyExecutionPolicy: () => false,
    taskPacketWasPrecompleted: () => false,
    taskResult: () => ({ path: resultPath, value: invalidResult })
  }), id, node, graph, state, runRoot), (error) => {
    for (const field of [
      "taskId", "repository", "graphRevision", "graphIdentity", "contractRevision",
      "paths", "claimIds", "outputSchema", "status", "planDigest", "workspaceHash",
      "leaseId", "fencingGeneration", "executionAttempt", "observedWrites"
    ]) assert.match(error.message, new RegExp(field));
    return true;
  });

  const nullishNode = { ...node, repository: undefined };
  const nullishGraph = {
    ...graph, revision: undefined, identity: undefined, nodes: [nullishNode]
  };
  const nullishResult = {
    ...validResult, taskId: undefined, repository: undefined,
    graphRevision: undefined, graphIdentity: undefined, contractRevision: undefined
  };
  assert.throws(() => taskNodeProof(dependencies({
    taskResult: () => ({ path: resultPath, value: nullishResult })
  }), id, nullishNode, nullishGraph,
  { graphExecutionVersion: 2, contractRevision: undefined }, runRoot), /taskId/);

  const defaultedResult = {
    ...validResult,
    paths: undefined, claimIds: undefined, outputSchema: undefined,
    observedWrites: undefined
  };
  const defaultedNode = {
    ...node, paths: undefined, claims: undefined, outputSchema: undefined
  };
  assert.equal(taskNodeProof(dependencies({
    taskResult: () => ({ path: resultPath, value: defaultedResult })
  }), id, defaultedNode, { ...graph, nodes: [defaultedNode] }, state, runRoot).status, "pass");

  console.log("task node proof tests: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
