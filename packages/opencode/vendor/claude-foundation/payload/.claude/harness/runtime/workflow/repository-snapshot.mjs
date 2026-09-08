import { existsSync } from "node:fs";
import { compositeRepositorySelection } from "../core/repository-binding.mjs";

export function snapshotChildPaths(selection) {
  return selection.filter((repository) => repository.id !== "root" &&
    repository.relativePath && repository.relativePath !== "." &&
    !repository.relativePath.startsWith("../"))
    .map((repository) => repository.relativePath);
}

export function repositorySnapshotEntries({
  root,
  id,
  selection,
  control,
  force,
  singleRelevantSnapshot,
  gitHead
}) {
  const repositories = {};
  for (const repository of selection) {
    if (repository.id === "root") {
      repositories.root = {
        id: control.id,
        workspaceHash: control.workspaceHash,
        codeHash: control.codeHash,
        reviewHash: control.reviewHash,
        workspace: control.workspace,
        baseHead: repository.baseHead || gitHead(root)
      };
      continue;
    }
    const workspace = repository.workspacePath || repository.path;
    const snapshot = singleRelevantSnapshot(id, workspace, force);
    repositories[repository.id] = {
      id: snapshot.id,
      workspaceHash: snapshot.workspaceHash,
      codeHash: snapshot.codeHash,
      reviewHash: snapshot.reviewHash,
      workspace: snapshot.workspace,
      baseHead: repository.baseHead || gitHead(repository.path)
    };
  }
  return repositories;
}

export function compositeSnapshotHash({
  stableHash,
  contractRevision,
  control,
  repositories
}, field) {
  return stableHash({
    version: 2,
    contractRevision,
    control: control[field],
    repositories: Object.entries(repositories).sort(([left], [right]) =>
      left.localeCompare(right)).map(([repository, value]) => ({
      repository,
      workspaceHash: value[field]
    }))
  });
}

export function relevantSnapshotOperation({
  root,
  runtimePath,
  snapshotPath,
  readJson,
  writeJson,
  singleRelevantSnapshot,
  selectedRepositories,
  gitHead,
  stableHash,
  now
}, id, workspaceOverride = null, force = false) {
  const runtimePresent = existsSync(runtimePath(id));
  const state = runtimePresent ? readJson(runtimePath(id)) : {};
  const contractRevision = Number(state.contractRevision ?? 0);
  if (workspaceOverride || !runtimePresent)
    return singleRelevantSnapshot(id, workspaceOverride, force);
  const selection = selectedRepositories(id, state);
  if (!compositeRepositorySelection(selection))
    return singleRelevantSnapshot(id, null, force);
  const control = singleRelevantSnapshot(
    id, state.workspace?.path || root, force, snapshotChildPaths(selection));
  const repositories = repositorySnapshotEntries({
    root, id, selection, control, force, singleRelevantSnapshot, gitHead
  });
  const composition = { stableHash, contractRevision, control, repositories };
  const workspaceHash = compositeSnapshotHash(composition, "workspaceHash");
  const value = {
    version: 3,
    id: `snapshot-${workspaceHash.slice(0, 20)}`,
    changeId: id,
    workspace: control.workspace,
    workspaceHash,
    codeHash: compositeSnapshotHash(composition, "codeHash"),
    reviewHash: compositeSnapshotHash(composition, "reviewHash"),
    packetReviewHash: control.packetReviewHash,
    revision: contractRevision,
    fileCount: control.fileCount,
    control,
    repositories,
    createdAt: now()
  };
  writeJson(snapshotPath(id), value);
  return value;
}

export function createRepositorySnapshot({
  root, runtimePath, snapshotPath, readJson, writeJson, singleRelevantSnapshot,
  selectedRepositories, gitHead, stableHash, now
}) {
  const relevantSnapshot = relevantSnapshotOperation.bind(null, {
    root, runtimePath, snapshotPath, readJson, writeJson, singleRelevantSnapshot,
    selectedRepositories, gitHead, stableHash, now
  });

  function relevantHash(id, workspaceOverride = null, force = false) {
    return relevantSnapshot(id, workspaceOverride, force).workspaceHash;
  }

  return { relevantSnapshot, relevantHash };
}
