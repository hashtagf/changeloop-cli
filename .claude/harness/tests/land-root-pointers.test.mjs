import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRootPointerUpdates,
  controlHeadMovedStageDecision,
  eligibleRootPointerEntries,
  pendingRootPointers,
  restagedRootPointersDecision,
  rootPointerLandState,
  rootPointerSignature,
  stageRootPointersOperation,
  updateRootPointerIndex
} from "../runtime/workflow/land-runtime.mjs";

const fail = (message) => { throw new Error(message); };
const repository = {
  id: "api", type: "submodule", mode: "write", relativePath: "vendor/api"
};
const stateFor = (overrides = {}) => ({
  workspace: { path: "/sandbox", baseHead: "control-base" },
  repositories: {
    root: {},
    api: { baseHead: "api-base", land: { commit: "api-head", ci: "pass" } }
  },
  ...overrides
});

function entry(overrides = {}) {
  return {
    repository, commit: "api-head", sandboxBefore: "api-base",
    targetBefore: "api-base", ...overrides
  };
}

test("root-pointer entry selection validates land, CI and existing pointers", () => {
  const state = stateFor();
  const context = {
    root: "/root", orderedRepositories: () => [
      { id: "root", type: "root", mode: "write" }, repository,
      { id: "docs", type: "submodule", mode: "read" }
    ],
    repositoryCommitLanded: () => true,
    rootGitlink: (path) => path === "/root" ? "api-head" : "api-base",
    fail
  };
  assert.deepEqual(eligibleRootPointerEntries(context, "c", state), [{
    repository, commit: "api-head", sandboxBefore: "api-base", targetBefore: "api-head"
  }]);
  state.repositories.api.land.ciRequired = true;
  state.repositories.api.land.ci = "fail";
  assert.throws(() => eligibleRootPointerEntries(context, "c", state), /required CI/);
  state.repositories.api.land.ci = "pass";
  state.repositories.api.land.commit = null;
  assert.throws(() => eligibleRootPointerEntries(context, "c", state), /has not landed/);
  state.repositories.api.land.commit = "api-head";
  assert.throws(() => eligibleRootPointerEntries({
    ...context, rootGitlink: () => "unplanned"
  }, "c", state), /changed outside/);
});

test("pending pointers, signatures and state records are deterministic", () => {
  const entries = [
    entry(),
    entry({ repository: { ...repository, id: "app" }, commit: "app-head",
      sandboxBefore: "app-head", targetBefore: "app-head" })
  ];
  assert.deepEqual(pendingRootPointers(entries), [entries[0]]);
  assert.equal(rootPointerSignature(entries), "api:api-head,app:app-head");
  const state = stateFor({ land: { retained: true, pointerStagings: { old: "prior" } } });
  let tick = 0;
  const land = rootPointerLandState(state, entries, "signature", () => `t${tick += 1}`);
  assert.equal(land.retained, true);
  assert.equal(land.pointerStagings.old, "prior");
  assert.equal(land.pointerStagings.signature, "t1");
  assert.equal(land.pointersStagedAt, "t2");
});

test("pointer index updates roll back sandbox and prior repositories on failure", () => {
  const calls = [];
  const first = entry();
  const second = entry({ repository: { ...repository, id: "app", relativePath: "vendor/app" },
    commit: "app-head", sandboxBefore: "app-base", targetBefore: "app-base" });
  const git = (args, path) => {
    calls.push([args, path]);
    if (path === "/root" && args[2].includes("app-head"))
      return { status: 1, stderr: "target locked" };
    return { status: 0, stderr: "" };
  };
  assert.throws(() => applyRootPointerUpdates({
    git, root: "/root", workspacePath: "/sandbox", entries: [first, second], fail
  }), /target locked; root pointers rolled back/);
  assert.ok(calls.some(([args, path]) =>
    path === "/sandbox" && args[2].includes("app-base")));
  assert.ok(calls.some(([args, path]) =>
    path === "/root" && args[2].includes("api-base")));
  const direct = updateRootPointerIndex(() => ({ status: 0 }), "/root", first);
  assert.equal(direct.status, 0);
});

function operationContext(state, overrides = {}) {
  const calls = { saved: 0, cleared: 0, logs: [], decisions: [] };
  const context = {
    root: "/root", landCheck: () => {}, requirePreparedLand: () => {},
    loadRuntime: () => state, gitHead: () => "control-base",
    selectedRepositories: (_id, runtimeState) =>
      Object.hasOwn(runtimeState.repositories || {}, "api")
        ? [{ id: "root" }, repository] : [{ id: "root" }],
    orderedRepositories: () => [repository], repositoryCommitLanded: () => true,
    rootGitlink: (path) => path === "/root" ? "api-base" : "api-base",
    git: () => ({ status: 0, stderr: "" }), fail,
    blockWithDecision: (_id, code, decision) => {
      calls.decisions.push([code, decision]); throw new Error(code);
    },
    clearSnapshotCache: () => { calls.cleared += 1; },
    saveRuntime: () => { calls.saved += 1; },
    now: () => "now", log: (message) => calls.logs.push(message),
    ...overrides
  };
  return { context, calls };
}

test("stageRootPointersOperation handles no-op, decisions and successful staging", () => {
  const notMulti = operationContext({ workspace: { baseHead: "control-base" }, repositories: {} });
  assert.throws(() => stageRootPointersOperation(notMulti.context, "c"), /not multi-repository/);

  const moved = operationContext(stateFor(), { gitHead: () => "new-control" });
  assert.throws(() => stageRootPointersOperation(moved.context, "c"), /control-head-moved/);
  assert.equal(controlHeadMovedStageDecision(stateFor(), "head").currentHead, "head");
  assert.equal(controlHeadMovedStageDecision({}, "head").recordedBase, null);

  const none = operationContext(stateFor(), { orderedRepositories: () => [] });
  stageRootPointersOperation(none.context, "c");
  assert.match(none.calls.logs[0], /no submodule pointers required/);

  const already = operationContext(stateFor(), { rootGitlink: () => "api-head" });
  stageRootPointersOperation(already.context, "c");
  assert.match(already.calls.logs[0], /already staged/);

  const restagedState = stateFor({ land: { pointerStagings: { "api:api-head": "before" } } });
  const restaged = operationContext(restagedState);
  assert.throws(() => stageRootPointersOperation(restaged.context, "c"), /root-pointers-restaged/);
  assert.equal(restagedRootPointersDecision("before", [entry()]).stagedAt, "before");

  const state = stateFor();
  const success = operationContext(state);
  stageRootPointersOperation(success.context, "c");
  assert.equal(state.land.status, "root-pointers-staged");
  assert.equal(state.status, "building");
  assert.equal(success.calls.saved, 1);
  assert.equal(success.calls.cleared, 1);
});
