import assert from "node:assert/strict";
import test from "node:test";
import {
  changeDiffCandidatePlan,
  changeDiffCandidateRow,
  changeDiffCandidates,
  changeDiffIdentityOperation,
  combinedDiffIdentity,
  normalizedDiffDigest
} from "../runtime/workflow/sandbox-runtime.mjs";

const writable = {
  mode: "worktree", access: "write", baseHead: "base", path: "/box"
};

test("diff candidates preserve single-root fallback and worktree repository targets", () => {
  const state = { workspace: writable };
  assert.deepEqual(changeDiffCandidates("/root", state), [{
    repository: "root", record: writable, targetPath: "/root"
  }]);
  assert.deepEqual(changeDiffCandidates("/root", {
    repositories: {
      root: { ...writable },
      api: { ...writable, targetPath: "/api" },
      worker: { ...writable },
      docs: { mode: "copy", path: "/docs" }
    }
  }).map(({ repository, targetPath }) => ({ repository, targetPath })), [
    { repository: "root", targetPath: "/root" },
    { repository: "api", targetPath: "/api" },
    { repository: "worker", targetPath: null }
  ]);
});

function planContext(overrides = {}) {
  return {
    pathExists: () => true,
    selectedRepositories: () => [
      { type: "submodule", relativePath: "vendor/api" },
      { type: "root", relativePath: "." }
    ],
    codePathspec: (id, nested) => [id, ...nested],
    pid: 42,
    environment: { LANG: "C" },
    ...overrides
  };
}

test("diff candidate planning skips ineligible records and rejects incomplete worktrees", () => {
  for (const record of [null, { ...writable, mode: "copy" },
    { ...writable, access: "read" }]) {
    assert.equal(changeDiffCandidatePlan(planContext(), "c", {}, {
      repository: "api", record
    }).status, "skip");
  }
  for (const record of [{ ...writable, baseHead: "" }, { ...writable, path: "" }]) {
    assert.equal(changeDiffCandidatePlan(planContext(), "c", {}, {
      repository: "api", record
    }).status, "invalid");
  }
  assert.equal(changeDiffCandidatePlan(planContext({ pathExists: () => false }),
    "c", {}, { repository: "api", record: writable }).status, "invalid");
});

test("diff candidate planning isolates root submodules and temporary index state", () => {
  const rootPlan = changeDiffCandidatePlan(planContext(), "change", {}, {
    repository: "root", record: writable
  });
  assert.deepEqual(rootPlan.pathspec, ["change", "vendor/api"]);
  assert.equal(rootPlan.indexFile, "/box.diff-identity-index.42");
  assert.deepEqual(rootPlan.env, {
    LANG: "C", GIT_INDEX_FILE: "/box.diff-identity-index.42"
  });
  assert.deepEqual(changeDiffCandidatePlan(planContext(), "change", {}, {
    repository: "api", record: writable
  }).pathspec, ["change"]);
});

function rowFixture(results) {
  const calls = [];
  const removed = [];
  const context = {
    remove: (path, options) => removed.push([path, options]),
    spawn: (command, args, options) => {
      calls.push([command, args, options]);
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    diffDigest: (buffer) => `digest:${buffer.toString("hex")}`
  };
  const plan = {
    repository: "api", record: writable, pathspec: [":(top)", "src"],
    indexFile: "/box.index", env: { GIT_INDEX_FILE: "/box.index" }
  };
  return { context, plan, calls, removed };
}

test("candidate row seeds, stages, diffs binary content, and always cleans its index", () => {
  const fixture = rowFixture([
    { status: 0 }, { status: 0 }, { status: 0, stdout: Buffer.from([0, 255]) }
  ]);
  assert.equal(changeDiffCandidateRow(fixture.context, fixture.plan),
    "api\0digest:00ff");
  assert.deepEqual(fixture.calls.map(([, args]) => args[0]), [
    "read-tree", "-c", "-c"
  ]);
  assert.deepEqual(fixture.calls[0][1], ["read-tree", "base"]);
  assert.ok(fixture.calls[1][1].includes("add"));
  assert.deepEqual(fixture.calls[2][1].slice(-4), ["base", "--", ":(top)", "src"]);
  assert.equal(fixture.calls[2][2].encoding, undefined);
  assert.equal(fixture.removed.length, 2);
  assert.deepEqual(fixture.removed[0], ["/box.index", { force: true }]);
});

test("candidate row returns null at each Git failure and cleans thrown failures", () => {
  for (const results of [
    [{ status: 1 }],
    [{ status: 0 }, { status: 1 }],
    [{ status: 0 }, { status: 0 }, { status: 1 }]
  ]) {
    const fixture = rowFixture(results);
    assert.equal(changeDiffCandidateRow(fixture.context, fixture.plan), null);
    assert.equal(fixture.removed.length, 2);
  }
  const thrown = rowFixture([new Error("spawn failed")]);
  assert.throws(() => changeDiffCandidateRow(thrown.context, thrown.plan), /spawn failed/);
  assert.equal(thrown.removed.length, 2);
});

test("normalized diff digest ignores blob ids and hunk coordinates only", () => {
  const first = Buffer.from([
    "diff --git a/a b/a", "index 111..222 100644", "@@ -1,2 +8,9 @@ heading",
    " unchanged", "-old", "+new", ""
  ].join("\n"), "latin1");
  const moved = Buffer.from([
    "diff --git a/a b/a", "index aaa..bbb 100644", "@@ -30,2 +90,9 @@ heading",
    " unchanged", "-old", "+new", ""
  ].join("\n"), "latin1");
  assert.equal(normalizedDiffDigest(first), normalizedDiffDigest(moved));
  assert.notEqual(normalizedDiffDigest(first), normalizedDiffDigest(
    Buffer.from(moved.toString("latin1").replace("+new", "+different"), "latin1")));
  assert.notEqual(normalizedDiffDigest(Buffer.from([0, 255])),
    normalizedDiffDigest(Buffer.from([0, 254])));
});

test("combined identity is order-independent, non-mutating, and version tagged", () => {
  const rows = ["z\0two", "a\0one"];
  const before = [...rows];
  assert.equal(combinedDiffIdentity(rows), combinedDiffIdentity([...rows].reverse()));
  assert.deepEqual(rows, before);
  assert.equal(combinedDiffIdentity(rows),
    "3768969b68699572e3a8346170ec6b46d82536fa268f618d4da3f5d668e84702");
});

test("identity operation distinguishes skips, invalid plans, row failures, and success", () => {
  const candidates = [{ id: "skip" }, { id: "a" }, { id: "b" }];
  const calls = [];
  const context = {
    candidates: () => candidates,
    plan: (id, state, candidate) => {
      calls.push([id, state, candidate.id]);
      return candidate.id === "skip" ? { status: "skip" } : {
        status: "ready", id: candidate.id
      };
    },
    row: (plan) => `${plan.id}-row`,
    combine: (rows) => rows.join("|")
  };
  const state = { id: "state" };
  assert.equal(changeDiffIdentityOperation(context, "change", state), "a-row|b-row");
  assert.deepEqual(calls[0], ["change", state, "skip"]);
  assert.equal(changeDiffIdentityOperation({
    ...context, candidates: () => [{ id: "skip" }]
  }, "change", state), null);
  assert.equal(changeDiffIdentityOperation({
    ...context, candidates: () => [{ id: "invalid" }],
    plan: () => ({ status: "invalid" }), row: assert.fail
  }, "change", state), null);
  assert.equal(changeDiffIdentityOperation({
    ...context, candidates: () => [{ id: "a" }], row: () => null,
    combine: assert.fail
  }, "change", state), null);
});
