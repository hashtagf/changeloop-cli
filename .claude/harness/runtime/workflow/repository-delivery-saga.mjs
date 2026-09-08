import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { createLandJournal, landEntryNoOp } from "./land-journal.mjs";

export const REPOSITORY_DELIVERY_SAGA_VERSION = 1;

export class RepositoryDeliveryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RepositoryDeliveryError";
    this.code = "REPOSITORY_DELIVERY_FAILED";
    this.owner = details.decision ? "user" : "harness";
    this.boundary = details.decision ? "user-authority" : "internal-transaction";
    this.decision = details.decision || null;
    this.details = details;
  }
}

export function repositoryDeliveryOrder(repositories) {
  const selected = new Map(repositories.map((repository) => [repository.id, repository]));
  const remaining = new Set(selected.keys());
  const complete = new Set();
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining].filter((id) =>
      (selected.get(id).dependsOn || []).every((dependency) =>
        !selected.has(dependency) || complete.has(dependency))).sort();
    if (!ready.length)
      throw new RepositoryDeliveryError("repository delivery graph contains a cycle");
    for (const id of ready) {
      ordered.push(selected.get(id));
      complete.add(id);
      remaining.delete(id);
    }
  }
  return ordered;
}

function safeRepositoryId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function repositoryRuntime(state, repository) {
  if (repository.id === "root") return state.repositories?.root || state.workspace;
  return state.repositories?.[repository.id] || null;
}

function gitInvariant(git, stableHash, targetPath) {
  const head = git(["rev-parse", "HEAD"], targetPath);
  const index = git(["diff", "--cached", "--binary", "--"], targetPath);
  if (head.status !== 0 || index.status !== 0)
    throw new RepositoryDeliveryError(`cannot inspect Git state at '${targetPath}'`);
  return {
    head: String(head.stdout || "").trim(),
    index: stableHash(String(index.stdout || ""))
  };
}

function assertGitInvariant(git, stableHash, repository, expected) {
  const observed = gitInvariant(git, stableHash, repository.path);
  if (observed.head !== expected.head || observed.index !== expected.index)
    throw new RepositoryDeliveryError(
      `Land changed Git HEAD or index for repository '${repository.id}'`, {
        repository: repository.id, expected, observed
      });
}

function childDiffNames(git, repository, runtime, fail) {
  const tracked = git([
    "diff", "--name-only", "-z", runtime.baseHead, "--"
  ], runtime.path);
  const untracked = git([
    "ls-files", "--others", "--exclude-standard", "-z", "--"
  ], runtime.path);
  if (tracked.status !== 0 || untracked.status !== 0)
    fail(`cannot inspect '${repository.id}' sandbox projection`);
  return [...new Set(`${tracked.stdout || ""}\0${untracked.stdout || ""}`
    .split("\0").filter(Boolean))].sort();
}

function assertChildTargetCompatible({ git, journalRuntime }, repository, runtime, entries) {
  const targetHead = git(["rev-parse", "HEAD"], repository.path);
  if (targetHead.status !== 0 || String(targetHead.stdout || "").trim() !== runtime.baseHead)
    throw new RepositoryDeliveryError(
      `repository '${repository.id}' target HEAD moved after proof`, {
        repository: repository.id,
        expectedHead: runtime.baseHead,
        observedHead: String(targetHead.stdout || "").trim() || null
      });
  for (const entry of entries) {
    if (landEntryNoOp(entry)) continue;
    const target = journalRuntime.safeRootPath(entry.path);
    const current = journalRuntime.pathIdentity(target);
    if (current === entry.after && journalRuntime.pathMode(target) === entry.afterMode)
      continue;
    const base = git(["cat-file", "-e", `${runtime.baseHead}:${entry.path}`], repository.path);
    if (base.status !== 0) {
      if (current !== null)
        throw new RepositoryDeliveryError(
          `Land would overwrite an uncommitted target path in '${repository.id}': ${entry.path}`,
          { repository: repository.id, path: entry.path });
      continue;
    }
    const changed = git(["diff", "--quiet", runtime.baseHead, "--", entry.path],
      repository.path);
    if (changed.status !== 0)
      throw new RepositoryDeliveryError(
        `Land would overwrite an uncommitted target edit in '${repository.id}': ${entry.path}`,
        { repository: repository.id, path: entry.path });
  }
}

export function createRepositoryDeliverySaga({
  root, transactions, loadRuntime, saveRuntime, selectedRepositories,
  git, gitHead, fileDigest, directoryHash, pathInside, readJson, writeJson,
  stableHash, proofPath, now, prepareRoot, executeRoot, verifyRoot,
  cleanupRoot, fail, checkpoint = () => {}
}) {
  const sagaPath = (id) => join(transactions, id, "repository-delivery.json");
  const childTransactions = (repositoryId) => join(
    transactions, "repository-delivery", safeRepositoryId(repositoryId));
  const journalFor = (repository) => createLandJournal({
    root: repository.path,
    transactions: childTransactions(repository.id),
    fileDigest,
    directoryHash,
    pathInside,
    readJson,
    writeJson,
    now
  });

  function loadSaga(id) {
    return readJson(sagaPath(id), {
      version: REPOSITORY_DELIVERY_SAGA_VERSION,
      changeId: id,
      status: "new",
      repositories: {}
    });
  }

  function saveSaga(value) {
    value.updatedAt = now();
    writeJson(sagaPath(value.changeId), value);
  }

  function childJournalPath(repository, id, transactionId) {
    return journalFor(repository).journalPath(id, transactionId);
  }

  function recoverInterruptedChild(id, repository, node) {
    if (!node?.transactionId || node.status === "verified") return;
    const runtime = journalFor(repository);
    const path = runtime.journalPath(id, node.transactionId);
    if (!existsSync(path)) return;
    const journal = readJson(path, {});
    if (!["prepared", "applying", "rolling-back", "manual-recovery"]
      .includes(journal.status)) return;
    if (journal.status === "manual-recovery")
      throw new RepositoryDeliveryError(
        `repository '${repository.id}' requires a semantic recovery decision`, {
          repository: repository.id,
          decision: journal.decision
        });
    try { runtime.rollback(journal, "interrupted repository apply recovered before resume"); }
    catch (error) {
      const refreshed = readJson(path, {});
      throw new RepositoryDeliveryError(error.message, {
        repository: repository.id,
        decision: refreshed.decision || null,
        journal: path
      });
    }
    node.status = "rolled-back";
  }

  function prepareChild(id, state, repository) {
    const record = repositoryRuntime(state, repository);
    if (!record?.path || !record?.targetPath || !record?.baseHead)
      throw new RepositoryDeliveryError(
        `repository '${repository.id}' has no complete isolated delivery binding`);
    const runtime = journalFor(repository);
    const entries = childDiffNames(git, repository, record, fail).map((path) => ({
      path,
      role: "code",
      before: runtime.pathIdentity(runtime.safeRootPath(path)),
      beforeMode: runtime.pathMode(runtime.safeRootPath(path)),
      after: runtime.pathIdentity(resolve(record.path, path)),
      afterMode: runtime.pathMode(resolve(record.path, path))
    }));
    assertChildTargetCompatible({ git, journalRuntime: runtime }, repository, record, entries);
    const transactionId = `repo-${safeRepositoryId(repository.id)}-${Date.now()}-${process.pid}`;
    const transactionRoot = runtime.transactionRoot(id, transactionId);
    for (const [index, entry] of entries.entries()) {
      entry.backup = `backup/${index}`;
      if (entry.before !== null)
        runtime.copyPath(runtime.safeRootPath(entry.path),
          join(transactionRoot, entry.backup));
    }
    const journal = {
      version: 1,
      changeId: id,
      repositoryId: repository.id,
      transactionId,
      proofRunId: readJson(proofPath(id), {}).proofRunId || null,
      mode: record.mode,
      status: "prepared",
      sandboxPath: record.path,
      targetPath: repository.path,
      projectionHash: stableHash(entries.map(({ path, after, afterMode }) =>
        ({ path, after, afterMode }))),
      entries,
      appliedPaths: [],
      inFlightPaths: [],
      createdAt: now()
    };
    runtime.save(journal);
    return { journal, runtime };
  }

  function executeChild(id, state, repository, prepared) {
    const { journal, runtime } = prepared;
    const mismatch = journal.entries.find((entry) =>
      runtime.pathIdentity(runtime.safeRootPath(entry.path)) !== entry.before ||
      runtime.pathMode(runtime.safeRootPath(entry.path)) !== entry.beforeMode);
    if (mismatch)
      throw new RepositoryDeliveryError(
        `repository '${repository.id}' changed before apply at '${mismatch.path}'`);
    journal.status = "applying";
    runtime.save(journal);
    const priorMarker = process.env.FOUNDATION_LAND_TRANSACTION;
    process.env.FOUNDATION_LAND_TRANSACTION = "1";
    try {
      journal.entries.forEach((entry, index) => runtime.applyEntry(journal, entry, index));
      journal.status = "verified";
      journal.verifiedAt = now();
      runtime.save(journal);
      const current = loadRuntime(id);
      const record = current.repositories[repository.id];
      record.delivery = {
        strategy: "workspace-uncommitted",
        status: "applied-uncommitted",
        transactionId: journal.transactionId,
        projectionHash: journal.projectionHash,
        touchedPaths: journal.entries.map((entry) => entry.path),
        appliedAt: now()
      };
      saveRuntime(current);
      Object.assign(state, current);
    } catch (error) {
      try { runtime.rollback(journal, error); }
      catch (rollbackError) {
        const refreshed = readJson(runtime.journalPath(id, journal.transactionId), {});
        throw new RepositoryDeliveryError(
          `${error.message}; ${rollbackError.message}`, {
            repository: repository.id,
            decision: refreshed.decision || null
          });
      }
      throw new RepositoryDeliveryError(`${error.message}; repository transaction rolled back`, {
        repository: repository.id
      });
    } finally {
      if (priorMarker === undefined) delete process.env.FOUNDATION_LAND_TRANSACTION;
      else process.env.FOUNDATION_LAND_TRANSACTION = priorMarker;
    }
  }

  function verifiedChild(id, state, repository) {
    const delivery = state.repositories?.[repository.id]?.delivery;
    if (delivery?.status !== "applied-uncommitted" || !delivery.transactionId)
      return false;
    const runtime = journalFor(repository);
    const verification = runtime.verify({
      id,
      workspace: { apply: {
        transactionId: delivery.transactionId,
        projectionHash: delivery.projectionHash
      } }
    });
    if (!verification.valid)
      throw new RepositoryDeliveryError(
        `repository '${repository.id}' delivered projection drifted: ${verification.reason}`,
        { repository: repository.id });
    return true;
  }

  function apply(id) {
    let state = loadRuntime(id);
    const selected = selectedRepositories(id, state);
    const writable = repositoryDeliveryOrder(selected)
      .filter((repository) => repository.mode === "write");
    const saga = loadSaga(id);
    for (const repository of writable.filter((row) => row.id !== "root"))
      recoverInterruptedChild(id, repository, saga.repositories[repository.id]);

    const invariants = Object.fromEntries(writable.map((repository) => [
      repository.id, gitInvariant(git, stableHash, repository.path)
    ]));
    const prepared = new Map();
    // Prepare every remaining target before mutating the first one.
    const preparationOrder = [
      ...writable.filter((repository) => repository.id !== "root"),
      ...writable.filter((repository) => repository.id === "root")
    ];
    for (const repository of preparationOrder) {
      state = loadRuntime(id);
      if (repository.id === "root") {
        if (state.workspace?.applied) {
          const verification = verifyRoot(state);
          if (!verification.valid)
            throw new RepositoryDeliveryError(
              `root delivered projection drifted: ${verification.reason}`);
          continue;
        }
        prepared.set(repository.id, { journal: prepareRoot(id, state), root: true });
      } else if (!verifiedChild(id, state, repository)) {
        prepared.set(repository.id, prepareChild(id, state, repository));
      }
    }
    saga.status = "prepared";
    saga.order = writable.map((repository) => repository.id);
    for (const repository of writable) {
      const node = saga.repositories[repository.id] ||= {};
      const value = prepared.get(repository.id);
      node.status = value ? "prepared" : "verified";
      node.transactionId = value?.journal?.transactionId ||
        (repository.id === "root" ? loadRuntime(id).workspace?.apply?.transactionId
          : loadRuntime(id).repositories?.[repository.id]?.delivery?.transactionId) || null;
      node.targetPath = repository.path;
    }
    saveSaga(saga);

    for (const repository of writable) {
      const value = prepared.get(repository.id);
      if (!value) continue;
      if (value.root) {
        executeRoot(id, value.journal);
        const current = loadRuntime(id);
        current.repositories ||= {};
        current.repositories.root = {
          ...(current.repositories.root || {}),
          delivery: {
            strategy: "workspace-uncommitted",
            status: "applied-uncommitted",
            transactionId: current.workspace.apply.transactionId,
            projectionHash: current.workspace.apply.projectionHash,
            touchedPaths: current.workspace.apply.touchedPaths,
            appliedAt: now()
          }
        };
        saveRuntime(current);
      } else executeChild(id, state, repository, value);
      assertGitInvariant(git, stableHash, repository, invariants[repository.id]);
      saga.repositories[repository.id].status = "verified";
      saveSaga(saga);
      checkpoint("after-repository", {
        changeId: id, repositoryId: repository.id,
        completed: Object.values(saga.repositories)
          .filter((node) => node.status === "verified").length
      });
    }
    // Applying one repository must not have staged or committed another.
    for (const repository of writable)
      assertGitInvariant(git, stableHash, repository, invariants[repository.id]);
    saga.status = "verified";
    saga.verifiedAt = now();
    saveSaga(saga);
    return {
      status: "PASS",
      strategy: "workspace-uncommitted",
      repositories: writable.map((repository) => ({
        id: repository.id,
        status: "applied-uncommitted",
        targetPath: repository.path
      }))
    };
  }

  function cleanup(id, state) {
    const selected = selectedRepositories(id, state);
    for (const repository of selected.filter((row) =>
      row.id !== "root" && row.mode === "write")) {
      const delivery = state.repositories?.[repository.id]?.delivery;
      if (!delivery?.transactionId) continue;
      delivery.cleanup = journalFor(repository).cleanup({
        id,
        workspace: { apply: { transactionId: delivery.transactionId } }
      });
    }
    const saga = loadSaga(id);
    saga.status = "complete";
    saga.completedAt = now();
    saveSaga(saga);
  }

  return { apply, cleanup, sagaPath, childJournalPath };
}
