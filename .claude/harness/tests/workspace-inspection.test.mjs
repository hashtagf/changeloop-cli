import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSandboxRuntime,
  repositoryInspectionRows,
  workspaceIdentityValid,
  workspaceInspectionValue,
  workspaceIsolationKind,
  workspaceTargetDrift
} from "../runtime/workflow/sandbox-runtime.mjs";

const root = realpathSync(mkdtempSync(join(tmpdir(), "foundation-workspace-inspection-")));
const copyPath = join(root, "copy");
const worktreePath = join(root, "worktree");
const referencePath = join(root, "reference");
const targetHead = "a".repeat(40);
const baseHead = "b".repeat(40);
mkdirSync(copyPath);
mkdirSync(join(worktreePath, ".git"), { recursive: true });
mkdirSync(referencePath);
mkdirSync(join(root, ".git", "refs", "heads"), { recursive: true });
writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
writeFileSync(join(root, ".git", "refs", "heads", "main"), `${targetHead}\n`);

let loadedState = {};
const runtime = createSandboxRuntime({
  root,
  loadRuntime: () => loadedState,
  hostAttestation: {}
});

try {
  assert.equal(workspaceIsolationKind("worktree"), "git-worktree");
  assert.equal(workspaceIsolationKind("copy"), "filesystem-copy");
  assert.equal(workspaceIsolationKind("external"), "none");
  assert.equal(workspaceIdentityValid("git-worktree", "x", {
    gitMetadataPresent: () => true,
    directoryExists: () => false
  }), true);
  assert.equal(workspaceIdentityValid("filesystem-copy", "x", {
    gitMetadataPresent: () => false,
    directoryExists: () => true
  }), true);
  assert.equal(workspaceIdentityValid("none", null, {
    gitMetadataPresent: () => false,
    directoryExists: () => false
  }), true);
  assert.equal(workspaceTargetDrift("git-worktree", baseHead, targetHead), "target-moved");
  assert.equal(workspaceTargetDrift("git-worktree", targetHead, targetHead), "none");
  assert.equal(workspaceTargetDrift("filesystem-copy", baseHead, targetHead), "none");
  assert.equal(workspaceTargetDrift("git-worktree", null, targetHead), "none");

  const repositories = repositoryInspectionRows({
    z: { mode: "reference", path: referencePath, access: "read" },
    a: { mode: "worktree", path: worktreePath },
    c: { mode: "external" },
    b: { mode: "copy", path: copyPath }
  });
  assert.deepEqual(repositories.map(({ id, kind, status, access }) => ({ id, kind, status, access })), [
    { id: "a", kind: "git-worktree", status: "active", access: "write" },
    { id: "b", kind: "filesystem-copy", status: "active", access: "write" },
    { id: "c", kind: "none", status: "missing", access: "write" },
    { id: "z", kind: "reference", status: "active", access: "read" }
  ]);
  assert.deepEqual(repositoryInspectionRows(null), []);
  const complete = repositoryInspectionRows({
    api: { mode: "worktree", path: worktreePath, access: "write" },
    stale: { mode: "worktree", path: referencePath, access: "read" }
  }, [{ id: "api", mode: "write" }, { id: "missing", mode: "read" }], {
    directoryExists: (path) => existsSync(path),
    gitMetadataPresent: (path) => path === worktreePath
  });
  assert.deepEqual(complete.map(({ id, status }) => ({ id, status })), [
    { id: "api", status: "active" },
    { id: "missing", status: "missing-record" },
    { id: "stale", status: "unexpected-record" }
  ]);
  assert.deepEqual(repositoryInspectionRows({
    api: { mode: "worktree", path: worktreePath, access: "write" }
  }, [{ id: "api", mode: "write", path: join(root, "target-api") }], {
    directoryExists: () => true,
    gitMetadataPresent: () => true,
    worktreeOwnedByTarget: () => false
  }).map(({ id, status }) => ({ id, status })), [
    { id: "api", status: "invalid" }
  ]);

  loadedState = {};
  assert.deepEqual(runtime.workspaceInspection("c"), {
    kind: "none",
    status: "current",
    path: root,
    baseHead: null,
    targetHead,
    drift: "none",
    repositories: []
  });
  const copy = runtime.workspaceInspection("c", {
    workspace: { mode: "copy", path: copyPath, baseHead },
    repositories: { repo: { mode: "reference", path: referencePath } }
  });
  assert.equal(copy.kind, "filesystem-copy");
  assert.equal(copy.status, "active");
  assert.equal(copy.drift, "none");
  assert.equal(copy.repositories[0].kind, "reference");

  const worktree = runtime.workspaceInspection("c", {
    workspace: { mode: "worktree", path: worktreePath, baseHead }
  });
  assert.equal(worktree.kind, "git-worktree");
  assert.equal(worktree.status, "active");
  assert.equal(worktree.drift, "target-moved");
  assert.equal(runtime.workspaceInspection("c", {
    workspace: { mode: "worktree", path: join(root, "missing"), baseHead }
  }).status, "missing");

  assert.equal(workspaceInspectionValue({
    root,
    gitMetadataPresent: () => false,
    directoryExists: () => false,
    headOfRepository: () => null
  }, { workspace: { mode: "copy", path: "missing" } }).targetHead, null);
} finally {
  rmSync(root, { recursive: true, force: true });
}
