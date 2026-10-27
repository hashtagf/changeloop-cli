import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { guardSandboxRemoval, sandboxDescriptors } from "./sandbox-preservation.mjs";

// Archive cleanup runs only once the change is recorded archived; every other
// caller (abandon, a rolled-back creation) is discarding work.
function cleanupPurpose(state, options) {
  return options?.purpose || (state?.status === "archived" ? "archive" : "discard");
}

// No guard injected means a caller that predates preservation (unit doubles).
function guardedRemoval(guardRemoval, id, state, descriptor, options) {
  if (!guardRemoval || !descriptor) return { proceed: true, backup: null };
  return guardRemoval(id, descriptor, cleanupPurpose(state, options));
}

function withBackup(result, backup) {
  return backup ? { ...result, backup } : result;
}

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
  removePath,
  guardRemoval = null,
  describe = () => null
}, id, state, options = {}) {
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
    const guard = guardedRemoval(guardRemoval, id, state, describe(id, state), options);
    if (!guard.proceed) return guard.result;
    try {
      removePath(path, { recursive: true });
      return withBackup({ status: "removed", path }, guard.backup);
    } catch (error) {
      return withBackup({ status: "failed", path, reason: error.message }, guard.backup);
    }
  }
  if (state.workspace.mode === "worktree") {
    const expected = resolve(root, ".foundation", "sandboxes", id);
    if (resolve(path) !== expected)
      return {
        status: "refused", path,
        reason: "worktree path is outside the expected sandbox location"
      };
    const guard = guardedRemoval(guardRemoval, id, state, describe(id, state), options);
    if (!guard.proceed) return guard.result;
    const removed = git(["worktree", "remove", "--force", path], root);
    if (removed.status !== 0)
      return withBackup({ status: "failed", path, reason: removed.stderr.trim() }, guard.backup);
    git(["worktree", "prune"], root);
    return withBackup({ status: "removed", path }, guard.backup);
  }
  return { status: "not-needed", path };
}

export function createSandboxCleanup({
  root, canonicalPath, git, now = () => new Date().toISOString(), guard = null
}) {
  // One timestamp per change and process, so the backups of a change's shared
  // and repository sandboxes land in one directory.
  const stamps = new Map();
  const guardRemoval = guard || ((id, descriptor, purpose) => {
    if (!stamps.has(id)) stamps.set(id, String(now()).replace(/[^0-9A-Za-z]/g, "-"));
    return guardSandboxRemoval({ root, id, descriptor, purpose, now, stamp: stamps.get(id) });
  });
  const describe = (id, state, repositoryId = "root") =>
    sandboxDescriptors(root, id, state)
      .find((descriptor) => descriptor.repositoryId === repositoryId) || null;
  const cleanupAppliedSandbox = cleanupAppliedSandboxOperation.bind(null, {
    root,
    canonicalPath,
    git,
    pathExists: existsSync,
    removePath: rmSync,
    guardRemoval,
    describe
  });

  function cleanupRepositorySandboxes(id, state, options = {}) {
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
      const guard = guardedRemoval(guardRemoval, id, state,
        describe(id, state, repositoryId), options);
      if (!guard.proceed) {
        results[repositoryId] = guard.result;
        continue;
      }
      const removed = git(["worktree", "remove", "--force", runtime.path], runtime.targetPath);
      if (removed.status !== 0) {
        results[repositoryId] = withBackup(
          { status: "failed", reason: removed.stderr.trim() }, guard.backup);
        continue;
      }
      git(["worktree", "prune"], runtime.targetPath);
      results[repositoryId] = withBackup({ status: "removed" }, guard.backup);
    }
    return results;
  }

  return { cleanupAppliedSandbox, cleanupRepositorySandboxes };
}
