import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Repository selection describes the agreement. Runtime records bind that
// agreement to concrete workspaces and immutable base revisions.
export function isolatedRepositoryState(state) {
  return ["worktree", "copy"].includes(state?.workspace?.mode);
}

export function compositeRepositorySelection(repositories = []) {
  return repositories.some((repository) => repository.id !== "root");
}

export function repositoryBaseHead(repository, state) {
  const recorded = state.repositories?.[repository.id]?.baseHead ||
    (repository.id === "root" ? state.workspace?.baseHead : null);
  if (recorded) return recorded;
  if (repository.id === "root") return null;
  // Before isolation, selection may bind to the live source head. Once the
  // control workspace is isolated, that fallback would escape the sandbox.
  return !isolatedRepositoryState(state) ? repository.baseHead || null : null;
}

export function repositoryGitDirectory(repositoryPath) {
  const marker = resolve(repositoryPath, ".git");
  if (!existsSync(marker)) return null;
  try {
    if (statSync(marker).isDirectory()) return realpathSync(marker);
    const pointer = readFileSync(marker, "utf8").match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    return pointer ? realpathSync(resolve(repositoryPath, pointer)) : null;
  } catch {
    return null;
  }
}

export function repositoryCommonGitDirectory(repositoryPath) {
  const gitDirectory = repositoryGitDirectory(repositoryPath);
  if (!gitDirectory) return null;
  const commonPointer = resolve(gitDirectory, "commondir");
  try {
    return existsSync(commonPointer)
      ? realpathSync(resolve(gitDirectory,
        readFileSync(commonPointer, "utf8").trim()))
      : realpathSync(gitDirectory);
  } catch {
    return null;
  }
}

// A valid Git worktree is not sufficient: it must be registered by the
// repository selected in the agreement. Comparing common Git directories
// works for ordinary repositories, submodules, and linked worktrees without
// executing a program resolved through PATH.
export function worktreeOwnedByTarget(worktreePath, targetPath) {
  const worktreeOwner = repositoryCommonGitDirectory(worktreePath);
  const targetOwner = repositoryCommonGitDirectory(targetPath);
  return Boolean(worktreeOwner && targetOwner && worktreeOwner === targetOwner);
}
