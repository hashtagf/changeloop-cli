import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compositeSnapshotHash,
  createRepositorySnapshot,
  repositorySnapshotEntries,
  snapshotChildPaths
} from "../runtime/workflow/repository-snapshot.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-repository-snapshot-"));
const runtimeFile = join(root, "runtime.json");
const snapshotFile = join(root, "snapshot.json");
const calls = [];
const writes = [];
const selection = [
  { id: "z", path: "/repo/z", workspacePath: "/workspace/z", relativePath: "services/z" },
  { id: "root" },
  { id: "a", path: "/repo/a", relativePath: "../outside", baseHead: "base-a" },
  { id: "dot", path: "/repo/dot", relativePath: "." }
];
const snapshotFor = (workspace) => ({
  id: `id-${workspace || "default"}`,
  workspaceHash: `workspace-${workspace || "default"}`,
  codeHash: `code-${workspace || "default"}`,
  reviewHash: `review-${workspace || "default"}`,
  packetReviewHash: `packet-${workspace || "default"}`,
  workspace: workspace || root,
  fileCount: 4
});
const singleRelevantSnapshot = (id, workspace, force, childPaths) => {
  calls.push({ id, workspace, force, childPaths });
  return snapshotFor(workspace);
};
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const context = {
  root,
  runtimePath: () => runtimeFile,
  snapshotPath: () => snapshotFile,
  readJson: () => JSON.parse(readFileSync(runtimeFile, "utf8")),
  writeJson: (path, value) => { writes.push({ path, value }); },
  singleRelevantSnapshot,
  selectedRepositories: () => selection,
  gitHead: (path) => `head-${path}`,
  stableHash,
  now: () => "now"
};

try {
  assert.deepEqual(snapshotChildPaths(selection), ["services/z"]);
  assert.deepEqual(snapshotChildPaths([
    { id: "root", relativePath: "root" },
    { id: "x", relativePath: null }
  ]), []);

  const entries = repositorySnapshotEntries({
    root, id: "c", selection, control: snapshotFor(root), force: true,
    singleRelevantSnapshot, gitHead: context.gitHead
  });
  assert.equal(entries.root.baseHead, `head-${root}`);
  assert.equal(entries.a.baseHead, "base-a");
  assert.equal(entries.z.baseHead, "head-/repo/z");
  assert.equal(entries.z.workspace, "/workspace/z");
  assert.equal(entries.a.workspace, "/repo/a");

  const composition = {
    stableHash: (value) => value,
    contractRevision: 3,
    control: { codeHash: "control" },
    repositories: { z: { codeHash: "z" }, a: { codeHash: "a" } }
  };
  assert.deepEqual(compositeSnapshotHash(composition, "codeHash").repositories, [
    { repository: "a", workspaceHash: "a" },
    { repository: "z", workspaceHash: "z" }
  ]);

  const store = createRepositorySnapshot(context);
  calls.length = 0;
  assert.deepEqual(store.relevantSnapshot("c"), snapshotFor(null));
  assert.deepEqual(calls[0], { id: "c", workspace: null, force: false, childPaths: undefined });
  calls.length = 0;
  assert.equal(store.relevantHash("c", "/override", true), "workspace-/override");
  assert.deepEqual(calls[0], { id: "c", workspace: "/override", force: true, childPaths: undefined });

  writeFileSync(runtimeFile, JSON.stringify({
    contractRevision: 2,
    workspace: { mode: "current", path: "/control" }
  }));
  calls.length = 0;
  const currentComposite = store.relevantSnapshot("c", null, true);
  assert.equal(currentComposite.version, 3,
    "declared multi-repository selection must not collapse to a root-only snapshot before isolation");
  assert.deepEqual(Object.keys(currentComposite.repositories).sort(), ["a", "dot", "root", "z"]);

  writeFileSync(runtimeFile, JSON.stringify({
    contractRevision: 3,
    revision: 99,
    workspace: { path: "/control" },
    repositories: { root: {}, z: {}, a: {}, dot: {} }
  }));
  calls.length = 0;
  const value = store.relevantSnapshot("c", null, true);
  assert.equal(value.version, 3);
  assert.equal(value.changeId, "c");
  assert.equal(value.revision, 3);
  assert.equal(value.createdAt, "now");
  assert.equal(value.packetReviewHash, "packet-/control");
  assert.equal(value.fileCount, 4);
  assert.match(value.id, /^snapshot-[a-f0-9]{20}$/);
  assert.deepEqual(calls[0], {
    id: "c", workspace: "/control", force: true, childPaths: ["services/z"]
  });
  assert.equal(writes.at(-1).path, snapshotFile);
  assert.equal(writes.at(-1).value, value);
  assert.notEqual(value.workspaceHash, value.codeHash);
  assert.notEqual(value.codeHash, value.reviewHash);
} finally {
  rmSync(root, { recursive: true, force: true });
}
