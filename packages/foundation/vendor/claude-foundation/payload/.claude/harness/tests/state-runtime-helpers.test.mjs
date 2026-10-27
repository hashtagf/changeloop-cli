import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createStateRuntime } from "../runtime/core/state-runtime.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-state-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, ".state");
  const runtime = join(stateRoot, "runtime");
  const changes = join(root, "openspec", "changes");
  const receipts = join(stateRoot, "receipts");
  const evidenceVault = join(stateRoot, "evidence");
  const snapshots = join(stateRoot, "snapshots");
  for (const path of [runtime, changes, receipts, evidenceVault, snapshots])
    mkdirSync(path, { recursive: true });
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value)}\n`);
  };
  const state = createStateRuntime({
    root, runtime, changes, receipts, evidenceVault, snapshots,
    excludedWorkspaceDirs: new Set([".git", ".state"]),
    readJson, writeJson, canonicalPath: (path) => path,
    now: () => "2026-08-27T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  return { root, runtime, changes, snapshots, state, writeJson };
}

test("state paths resolve active, isolated, and archived change packets", (t) => {
  const f = fixture(t);
  const id = "change-a";
  const current = join(f.changes, id);
  mkdirSync(current);
  assert.equal(f.state.runtimePath(id), join(f.runtime, `${id}.json`));
  assert.equal(f.state.changePath(id), current);
  assert.match(f.state.receiptPath(id, "tests"), /change-a\/tests\.json$/);
  assert.match(f.state.proofPath(id), /change-a\/proof\.json$/);
  assert.match(f.state.proofRunRoot(id, "run-a"), /change-a\/run-a$/);
  assert.match(f.state.snapshotPath(id), /change-a\.json$/);
  assert.equal(f.state.currentChangeRelativePath(id), "openspec/changes/change-a");
  assert.equal(f.state.isCurrentChangePath("openspec/changes/change-a/tasks.md", id), true);
  assert.equal(f.state.activeChangePath(id, { status: "change" }), current);

  const workspace = join(f.root, "sandbox");
  const isolated = join(workspace, "openspec", "changes", id);
  mkdirSync(isolated, { recursive: true });
  const isolatedState = { status: "building", workspace: { mode: "copy", path: workspace } };
  assert.equal(f.state.activeChangePath(id, isolatedState), isolated);
  assert.equal(f.state.activeChangePath(id, {
    ...isolatedState, workspace: { mode: "current", path: workspace }
  }), current);

  const archivedRelative = "openspec/changes/archive/2026-08-27-change-a";
  const archived = join(f.root, archivedRelative);
  mkdirSync(archived, { recursive: true });
  assert.equal(f.state.activeChangePath(id, {
    ...isolatedState, status: "archived", archivedChangePath: archivedRelative
  }), archived);
});

test("archive lookup, slugging, and runtime recovery reject ambiguous state", (t) => {
  const f = fixture(t);
  assert.equal(f.state.archivedChangeRelativePath("fix-login"), null);
  const archive = join(f.changes, "archive");
  for (const name of [
    "quick-fix-login", "2026-08-26-fix-login", "2026-08-27-2-fix-login", "exact"
  ]) mkdirSync(join(archive, name), { recursive: true });
  assert.equal(f.state.archivedChangeRelativePath("fix-login"),
    "openspec/changes/archive/2026-08-27-2-fix-login");
  assert.equal(f.state.archivedChangeRelativePath("exact"),
    "openspec/changes/archive/exact");
  assert.equal(f.state.slugify("  Hello, WORLD!  "), "hello-world");
  assert.equal(f.state.slugify("!!!"), "change");
  assert.equal(f.state.slugify("x".repeat(80)).length, 64);

  assert.throws(() => f.state.loadRuntime("missing"), /unknown change/);
  assert.throws(() => f.state.loadRuntime("missing", { recoverable: true }),
    /unknown change/);
  mkdirSync(join(f.changes, "recover"));
  assert.equal(f.state.loadRuntime("recover", { recoverable: true }).recoveredState,
    "missing");
  writeFileSync(f.state.runtimePath("recover"), "{");
  assert.throws(() => f.state.loadRuntime("recover"), /invalid JSON/);
  assert.equal(f.state.loadRuntime("recover", { recoverable: true }).recoveredState,
    "corrupt");
  f.writeJson(f.state.runtimePath("recover"), { id: "recover", status: "change" });
  assert.equal(f.state.loadRuntime("recover").id, "recover");
  const saved = { id: "recover", status: "building" };
  f.state.saveRuntime(saved);
  assert.equal(saved.updatedAt, "2026-08-27T00:00:00.000Z");
});

test("active and orphan runtime inventories classify valid and corrupt records", (t) => {
  const f = fixture(t);
  for (const id of ["b", "a", "archive"]) mkdirSync(join(f.changes, id));
  assert.deepEqual(f.state.activeChanges(), ["a", "b"]);
  f.writeJson(f.state.runtimePath("a"), { status: "change" });
  f.writeJson(f.state.runtimePath("archived"), { status: "archived" });
  f.writeJson(f.state.runtimePath("orphan"), { schema: "3", status: "building" });
  writeFileSync(f.state.runtimePath("broken"), "{");
  writeFileSync(join(f.runtime, "ignored.txt"), "text");
  assert.deepEqual(f.state.orphanRuntimeChanges(), [
    { id: "broken", schema: "unknown", reason: "invalid-runtime-json" },
    { id: "orphan", schema: "3", reason: "missing-active-change" }
  ]);
  rmSync(f.runtime, { recursive: true });
  assert.deepEqual(f.state.orphanRuntimeChanges(), []);
});

test("filesystem identities, deterministic hashes, and compact lists cover all shapes", (t) => {
  const f = fixture(t);
  const tree = join(f.root, "tree");
  mkdirSync(join(tree, "nested"), { recursive: true });
  const regular = join(tree, "regular.txt");
  const executable = join(tree, "nested", "run.sh");
  writeFileSync(regular, "alpha");
  writeFileSync(executable, "echo ok\n");
  chmodSync(executable, 0o755);
  symlinkSync("regular.txt", join(tree, "link"));
  assert.match(f.state.filesystemEntryIdentity(regular), /^file:regular:/);
  assert.match(f.state.filesystemEntryIdentity(executable), /^file:executable:/);
  assert.equal(f.state.filesystemEntryIdentity(join(tree, "link")),
    "symlink:regular.txt");
  assert.match(f.state.filesystemEntryIdentity(tree), /^unsupported:/);
  assert.equal(f.state.codepointOrder("a", "b"), -1);
  assert.equal(f.state.codepointOrder("b", "a"), 1);
  assert.equal(f.state.codepointOrder("same", "same"), 0);
  const visited = [];
  f.state.walk(tree, (path) => visited.push(path));
  assert.equal(visited.length, 3);
  f.state.walk(join(f.root, "absent"), assert.fail);
  const before = f.state.directoryHash(tree);
  writeFileSync(regular, "beta");
  assert.notEqual(f.state.directoryHash(tree), before);

  assert.deepEqual(f.state.compactList([1, 2], 2), [1, 2]);
  const compact = f.state.compactList([1, 2, 3], 2, (value) => value * 2);
  assert.deepEqual(compact.preview, [2, 4]);
  assert.equal(compact.count, 3);
  assert.match(compact.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.state.compactStrings([1, true]), ["1", "true"]);
  assert.deepEqual(f.state.expandList([1]), [1]);
  assert.deepEqual(f.state.expandList(compact), [2, 4]);
  assert.deepEqual(f.state.expandList({}), []);
  assert.equal(f.state.listCount([1, 2]), 2);
  assert.equal(f.state.listCount(compact), 3);
  assert.equal(f.state.listCount({ count: "3" }), 0);
  assert.equal(f.state.serializedJson({ a: 1 }), "{\"a\":1}\n");
  assert.match(f.state.serializedJson({ a: 1 }, true), /\n  \"a\": 1\n/);
});

test("snapshot invalidation, porcelain parsing, and dirty baselines are deterministic", (t) => {
  const f = fixture(t);
  const id = "snapshot";
  mkdirSync(join(f.changes, id), { recursive: true });
  writeFileSync(join(f.changes, id, "tasks.md"), "- [ ] task\n");
  writeFileSync(join(f.root, "ignore-me.txt"), "ignored snapshot input\n");
  f.writeJson(f.state.runtimePath(id), {
    id, status: "change", contractRevision: 0,
    workspace: { mode: "current", path: f.root }
  });
  const first = f.state.singleRelevantSnapshot(id);
  assert.strictEqual(f.state.singleRelevantSnapshot(id), first);
  assert.notStrictEqual(f.state.singleRelevantSnapshot(id, null, true), first);
  assert.notEqual(f.state.singleRelevantSnapshot(
    id, null, true, ["ignore-me.txt"]).workspaceHash,
    first.workspaceHash);
  assert.throws(() => f.state.singleRelevantSnapshot(
    id, join(f.root, "missing-workspace")), (error) =>
    error.code === "FOUNDATION_WORKSPACE_MISSING" &&
      error.message.includes(`sandbox create ${id} --all`));
  const cleared = [];
  f.state.registerPolicyCacheClearer((changeId) => cleared.push(changeId));
  f.state.clearSnapshotCache(id);
  assert.notStrictEqual(f.state.singleRelevantSnapshot(id), first);
  f.state.clearSnapshotCache();
  assert.deepEqual(cleared, [id, null]);

  assert.deepEqual(f.state.porcelainStatusRecords(
    " M ordinary.txt\0R  renamed.txt\0old.txt\0C  copied.txt\0source.txt\0"
  ), [
    { status: " M", path: "ordinary.txt", origPath: null },
    { status: "R ", path: "renamed.txt", origPath: "old.txt" },
    { status: "C ", path: "copied.txt", origPath: "source.txt" }
  ]);

  const workspace = join(f.root, "git-workspace");
  mkdirSync(workspace);
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  writeFileSync(join(workspace, "tracked.txt"), "before\n");
  writeFileSync(join(workspace, "deleted.txt"), "delete me\n");
  execFileSync("git", ["add", "tracked.txt", "deleted.txt"], { cwd: workspace });
  writeFileSync(join(workspace, "tracked.txt"), "after\n");
  rmSync(join(workspace, "deleted.txt"));
  writeFileSync(join(workspace, "untracked.txt"), "new\n");
  mkdirSync(join(workspace, "directory"));
  const dirty = f.state.preexistingDirty(workspace);
  assert.deepEqual(Object.keys(dirty).sort(), ["tracked.txt", "untracked.txt"]);
  assert.equal(dirty["tracked.txt"], f.state.fileDigest(join(workspace, "tracked.txt")));
  assert.equal(lstatSync(join(workspace, "directory")).isDirectory(), true);
  assert.equal(f.state.preexistingDirty(join(f.root, "not-a-repository"))
    instanceof Object, true);
  const gitSnapshot = f.state.singleRelevantSnapshot(
    id, workspace, true, ["untracked.txt"]);
  assert.equal(gitSnapshot.workspace, workspace);
  assert.equal(gitSnapshot.fileCount, 2);
});
