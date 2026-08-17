import { existsSync } from "node:fs";

export function createRepositorySnapshot({
  root, runtimePath, snapshotPath, readJson, writeJson, singleRelevantSnapshot,
  selectedRepositories, gitHead, stableHash, now
}) {
  function relevantSnapshot(id, workspaceOverride = null, force = false) {
    const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
    if (workspaceOverride || !state.repositories ||
        Object.keys(state.repositories).length === 0)
      return singleRelevantSnapshot(id, workspaceOverride, force);
    const control = singleRelevantSnapshot(id, state.workspace?.path || root, force);
    const repositories = {};
    for (const repository of selectedRepositories(id, state)) {
      if (repository.id === "root") {
        repositories.root = {
          id: control.id,
          workspaceHash: control.workspaceHash,
          codeHash: control.codeHash,
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
        workspace: snapshot.workspace,
        baseHead: repository.baseHead || gitHead(repository.path)
      };
    }
    // Composed twice from the same entries. The packet lives in the control
    // repository, so every other entry's two hashes are equal by construction —
    // but composing the code hash from the code halves is what keeps a packet
    // edit out of the composite an executable provider binds.
    const composite = (field) => stableHash({
      version: 1,
      contractRevision: Number(state.contractRevision || state.revision || 0),
      control: control[field],
      repositories: Object.entries(repositories).sort(([left], [right]) =>
        left.localeCompare(right)).map(([repository, value]) => ({
        // Commit identity is Land/recovery state, not content identity. The
        // snapshot already hashes every tracked byte and the contract revision;
        // explicit target-head guards separately refuse an unreconciled base.
        repository, workspaceHash: value[field]
      }))
    });
    const workspaceHash = composite("workspaceHash");
    const value = {
      version: 2,
      id: `snapshot-${workspaceHash.slice(0, 20)}`,
      changeId: id,
      workspace: control.workspace,
      workspaceHash,
      codeHash: composite("codeHash"),
      revision: Number(state.contractRevision || state.revision || 0),
      fileCount: control.fileCount,
      control,
      repositories,
      createdAt: now()
    };
    writeJson(snapshotPath(id), value);
    return value;
  }

  function relevantHash(id, workspaceOverride = null, force = false) {
    return relevantSnapshot(id, workspaceOverride, force).workspaceHash;
  }

  return { relevantSnapshot, relevantHash };
}
