import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export function recognisedCopySandbox(root, id, canonical, canonicalPath) {
  const expected = resolve(root, ".foundation", "sandboxes", id);
  const legacyTempRoots = [
    canonicalPath(tmpdir()), "/tmp", "/var/folders", "/private/var/folders"
  ];
  const legacyRecognised = basename(canonical).startsWith(`foundation-${id}-`) &&
    legacyTempRoots.some((tempRoot) =>
      canonical === tempRoot || canonical.startsWith(`${tempRoot}/`));
  return resolve(canonical) === expected || legacyRecognised;
}

export function cleanupAppliedSandboxOperation({
  root,
  canonicalPath,
  git,
  pathExists,
  removePath
}, id, state) {
  const path = state.workspace?.sandboxPath || state.workspace?.path;
  if (!path || resolve(path) === resolve(root) || !pathExists(path))
    return { status: "not-needed", path: path || null };
  if (state.workspace.mode === "copy") {
    const canonical = canonicalPath(path);
    if (!recognisedCopySandbox(root, id, canonical, canonicalPath))
      return {
        status: "refused", path,
        reason: "copy path is neither the Foundation sandbox location nor a Foundation temp copy"
      };
    try {
      removePath(path, { recursive: true });
      return { status: "removed", path };
    } catch (error) {
      return { status: "failed", path, reason: error.message };
    }
  }
  if (state.workspace.mode === "worktree") {
    const expected = resolve(root, ".foundation", "sandboxes", id);
    if (resolve(path) !== expected)
      return {
        status: "refused", path,
        reason: "worktree path is outside the expected sandbox location"
      };
    const removed = git(["worktree", "remove", "--force", path], root);
    if (removed.status !== 0)
      return { status: "failed", path, reason: removed.stderr.trim() };
    git(["worktree", "prune"], root);
    return { status: "removed", path };
  }
  return { status: "not-needed", path };
}

export function createSandboxCleanup({ root, canonicalPath, git }) {
  const cleanupAppliedSandbox = cleanupAppliedSandboxOperation.bind(null, {
    root,
    canonicalPath,
    git,
    pathExists: existsSync,
    removePath: rmSync
  });

  function cleanupRepositorySandboxes(id, state) {
    const results = {};
    for (const [repositoryId, runtime] of Object.entries(state.repositories || {})) {
      if (repositoryId === "root" || runtime.mode !== "worktree" ||
          !runtime.path || !existsSync(runtime.path)) {
        results[repositoryId] = { status: "not-needed" };
        continue;
      }
      const expected = resolve(root, ".foundation", "repository-sandboxes", id, repositoryId);
      if (resolve(runtime.path) !== expected) {
        results[repositoryId] = {
          status: "refused", reason: "repository sandbox path is outside the expected location"
        };
        continue;
      }
      const removed = git(["worktree", "remove", "--force", runtime.path], runtime.targetPath);
      if (removed.status !== 0) {
        results[repositoryId] = { status: "failed", reason: removed.stderr.trim() };
        continue;
      }
      git(["worktree", "prune"], runtime.targetPath);
      results[repositoryId] = { status: "removed" };
    }
    return results;
  }

  return { cleanupAppliedSandbox, cleanupRepositorySandboxes };
}
