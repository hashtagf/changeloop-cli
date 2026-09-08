import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReadOnlyReplayClean,
  manuallyRebasedMovement,
  prepareWorktreeReplay,
  rejectedPaths,
  replayContext,
  replayStagingCleanup,
  stageReplayWorkspace
} from "../runtime/workflow/sandbox-runtime.mjs";

const fail = (message) => { throw new Error(message); };
const ok = { status: 0, stdout: "", stderr: "" };

test("rejectedPaths prefers genuine merge conflicts and sorts patch failures", () => {
  assert.deepEqual(rejectedPaths("U z.js\nU a.js\nerror: patch failed: ignored.js:1"),
    ["a.js", "z.js"]);
  assert.deepEqual(rejectedPaths([
    "error: patch failed: b.js:2", "error: a.js: patch does not apply",
    "error: c.js: does not exist in index",
    "error: d.js: already exists in working directory"
  ].join("\n")), ["a.js", "b.js", "c.js", "d.js"]);
  assert.deepEqual(rejectedPaths(null), []);
});

test("read-only replay precheck rejects dirty and unreadable sandboxes", () => {
  assert.doesNotThrow(() => assertReadOnlyReplayClean("api", { access: "write" },
    () => { throw new Error("unused"); }, fail));
  assert.doesNotThrow(() => assertReadOnlyReplayClean("api", { access: "read", path: "/box" },
    () => ok, fail));
  assert.throws(() => assertReadOnlyReplayClean("api", { access: "read", path: "/box" },
    () => ({ status: 0, stdout: " M file.js", stderr: "" }), fail), /M file\.js/);
  assert.throws(() => assertReadOnlyReplayClean("api", { access: "read", path: "/box" },
    () => ({ status: 1, stdout: "", stderr: "broken" }), fail), /broken/);
});

test("replayContext identifies moved bases and root submodule pathspecs", () => {
  const candidate = {
    repository: "root", targetPath: "/target",
    record: { path: "/box", baseHead: "base", access: "write" }
  };
  const context = replayContext({
    id: "c", state: {}, candidate, gitHead: () => "head",
    selectedRepositories: () => [
      { type: "submodule", relativePath: "vendor/api" }, { type: "root" }
    ]
  });
  assert.deepEqual(context.movement, {
    repository: "root", from: "base", to: "head", rebased: false, conflicts: []
  });
  assert.equal(context.staging, "/box.rebase");
  assert.ok(context.pathspec.some((entry) => entry.includes("vendor/api")));
  for (const changed of [
    { ...candidate, targetPath: null },
    { ...candidate, record: { ...candidate.record, baseHead: null } }
  ]) assert.equal(replayContext({
    id: "c", state: {}, candidate: changed, gitHead: () => "head",
    selectedRepositories: () => []
  }), null);
  assert.equal(replayContext({
    id: "c", state: {}, candidate, gitHead: () => "base", selectedRepositories: () => []
  }), null);
});

test("a manually rebased sandbox can advance its recorded base safely", () => {
  const candidate = {
    repository: "root", targetPath: "/target",
    record: { path: "/box", baseHead: "old" }
  };
  const heads = new Map([["/target", "new"], ["/box", "new"]]);
  assert.deepEqual(manuallyRebasedMovement(candidate, (path) => heads.get(path)), {
    repository: "root", from: "old", to: "new", rebased: true,
    conflicts: [], manuallyRebased: true
  });
  heads.set("/box", "other");
  assert.equal(manuallyRebasedMovement(candidate, (path) => heads.get(path)), null);
});

test("staging and cleanup perform the durable worktree lifecycle", () => {
  const calls = [];
  const removed = [];
  const context = {
    repository: "api", record: { access: "write" }, targetPath: "/target",
    currentHead: "head", staging: "/box.rebase", patch: "/box.patch"
  };
  const dependencies = {
    git: (args, cwd) => { calls.push([args, cwd]); return ok; },
    remove: (path, options) => removed.push([path, options]), fail
  };
  stageReplayWorkspace(context, dependencies);
  replayStagingCleanup(context, dependencies)();
  replayStagingCleanup(context, dependencies, false)();
  assert.equal(calls.filter(([args]) => args[0] === "worktree").length, 4);
  assert.ok(removed.some(([path]) => path === "/box.patch"));
  const broken = { ...dependencies, git: (args) => args[1] === "add"
    ? { status: 1, stderr: "cannot add" } : ok };
  assert.throws(() => stageReplayWorkspace(context, broken), /rebase worktree: cannot add/);
  assert.throws(() => stageReplayWorkspace({
    ...context, record: { access: "read" }
  }, broken), /read-only worktree refresh/);
});

function replayFixture({ access = "write", diff = Buffer.from("patch"), apply = ok } = {}) {
  const calls = [];
  const writes = [];
  const options = {
    id: "c", state: {},
    candidate: {
      repository: "api", targetPath: "/target",
      record: { path: "/box", baseHead: "base", access }
    },
    gitHead: () => "head", selectedRepositories: () => [], fail,
    git: (args, cwd) => {
      calls.push([args, cwd]);
      if (args[0] === "apply") return apply;
      return ok;
    },
    gitBuffer: () => ({ status: 0, stdout: diff, stderr: Buffer.from("") }),
    write: (path, value) => writes.push([path, value]),
    remove: () => {}
  };
  return { options, calls, writes };
}

test("prepareWorktreeReplay handles read-only, empty, successful and conflicting diffs", () => {
  const readOnly = replayFixture({ access: "read" });
  const refreshed = prepareWorktreeReplay(readOnly.options);
  assert.equal(refreshed.movement.from, "base");
  refreshed.discardStaging();
  assert.equal(readOnly.calls.some(([args]) => args[0] === "apply"), false);

  const empty = replayFixture({ diff: Buffer.alloc(0) });
  assert.deepEqual(prepareWorktreeReplay(empty.options).movement.conflicts, []);
  assert.equal(empty.writes.length, 0);

  const success = replayFixture();
  assert.deepEqual(prepareWorktreeReplay(success.options).movement.conflicts, []);
  assert.equal(success.writes[0][0], "/box.rebase.patch");

  const conflict = replayFixture({ apply: {
    status: 1, stderr: "error: patch failed: src/a.js:4", stdout: "U src/b.js"
  } });
  assert.deepEqual(prepareWorktreeReplay(conflict.options).movement.conflicts, ["src/b.js"]);
  const unnamed = replayFixture({ apply: { status: 1, stderr: "unknown", stdout: "" } });
  assert.deepEqual(prepareWorktreeReplay(unnamed.options).movement.conflicts, ["."]);
});

test("prepareWorktreeReplay preserves early exits and diff read failures", () => {
  const stationary = replayFixture();
  stationary.options.gitHead = () => "base";
  assert.equal(prepareWorktreeReplay(stationary.options), null);
  const broken = replayFixture();
  broken.options.gitBuffer = () => ({
    status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("bad diff")
  });
  assert.throws(() => prepareWorktreeReplay(broken.options), /bad diff/);
});
