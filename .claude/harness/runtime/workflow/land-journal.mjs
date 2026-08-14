import {
  cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, renameSync,
  rmSync, symlinkSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export function transactionJournals(transactions, id, readJson) {
  const root = join(transactions, id);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "journal.json"))
    .filter((path) => existsSync(path))
    .map((path) => readJson(path, {}));
}

export function createLandJournal({
  root, transactions, fileDigest, directoryHash, pathInside, readJson, writeJson, now
}) {
  function pathIdentity(path) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
      if (stat.isFile()) return fileDigest(path);
      if (stat.isDirectory()) return `directory:${directoryHash(path)}`;
      return `unsupported:${stat.mode}`;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  function safeRootPath(rel) {
    const path = resolve(root, rel);
    if (!pathInside(root, path) || path === root)
      throw new Error(`unsafe transaction path '${rel}'`);
    return path;
  }

  function copyPath(source, destination) {
    const stat = lstatSync(source);
    mkdirSync(dirname(destination), { recursive: true });
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), destination);
    else cpSync(source, destination, {
      recursive: stat.isDirectory(), dereference: false, verbatimSymlinks: true
    });
  }

  function transactionRoot(id, transactionId) {
    return join(transactions, id, transactionId);
  }

  function journalPath(id, transactionId) {
    return join(transactionRoot(id, transactionId), "journal.json");
  }

  function save(journal) {
    journal.updatedAt = now();
    writeJson(journalPath(journal.changeId, journal.transactionId), journal);
  }

  function applyEntry(journal, entry, index) {
    const target = safeRootPath(entry.path);
    const current = pathIdentity(target);
    if (current !== entry.before)
      throw new Error(`target changed during apply at '${entry.path}'`);
    journal.inFlightPaths = [entry.path];
    save(journal);
    if (entry.after === null) {
      if (current !== null) rmSync(target, { recursive: true });
    } else {
      const source = resolve(journal.sandboxPath, entry.path);
      const stage = join(transactionRoot(journal.changeId, journal.transactionId),
        "stage", String(index));
      if (existsSync(stage)) rmSync(stage, { recursive: true });
      copyPath(source, stage);
      mkdirSync(dirname(target), { recursive: true });
      if (current !== null) rmSync(target, { recursive: true });
      renameSync(stage, target);
    }
    if (pathIdentity(target) !== entry.after)
      throw new Error(`post-apply projection mismatch at '${entry.path}'`);
    journal.appliedPaths.push(entry.path);
    journal.inFlightPaths = [];
    save(journal);
    const failAfter = process.env.FOUNDATION_TEST_MODE === "1"
      ? Number(process.env.FOUNDATION_TEST_FAIL_APPLY_AFTER || 0) : 0;
    if (failAfter > 0 && journal.appliedPaths.length >= failAfter)
      throw new Error(`injected apply failure after ${journal.appliedPaths.length} path(s)`);
  }

  function restoreEntry(journal, entry) {
    const target = safeRootPath(entry.path);
    const current = pathIdentity(target);
    if (current === entry.before) return;
    const possiblyApplied = journal.appliedPaths.includes(entry.path) ||
      journal.inFlightPaths.includes(entry.path);
    if (!possiblyApplied || (current !== entry.after && current !== null))
      throw new Error(`rollback requires manual recovery at '${entry.path}'`);
    if (current !== null) rmSync(target, { recursive: true });
    if (entry.before !== null)
      copyPath(join(transactionRoot(journal.changeId, journal.transactionId), entry.backup), target);
    if (pathIdentity(target) !== entry.before)
      throw new Error(`rollback verification failed at '${entry.path}'`);
  }

  function rollback(journal, reason) {
    journal.status = "rolling-back";
    journal.failure = String(reason?.message || reason);
    save(journal);
    try {
      for (const entry of [...journal.entries].reverse()) restoreEntry(journal, entry);
      journal.status = "rolled-back";
      journal.inFlightPaths = [];
      journal.rolledBackAt = now();
      save(journal);
    } catch (error) {
      journal.status = "manual-recovery";
      journal.recoveryError = error.message;
      journal.decision = {
        kind: "manual-recovery",
        summary: "The target changed during rollback, so Foundation stopped without overwriting the divergent content.",
        options: [
          { id: "inspect", outcome: "Inspect the target and transaction backup before choosing a recovery." },
          { id: "keep-current", outcome: "Preserve the current target and abandon automatic rollback." },
          { id: "restore-backup", outcome: "Restore the recorded backup after explicitly resolving the divergence." },
          { id: "pause", outcome: "Leave the journal pending and make no further changes." }
        ],
        recommended: "inspect",
        transactionRoot: transactionRoot(journal.changeId, journal.transactionId)
      };
      save(journal);
      throw error;
    }
  }

  function verify(state) {
    const transactionId = state.workspace?.apply?.transactionId;
    if (!transactionId) return { valid: false, reason: "missing-apply-transaction" };
    const path = journalPath(state.id, transactionId);
    if (!existsSync(path)) return { valid: false, reason: "missing-apply-journal" };
    const journal = readJson(path);
    const mismatch = journal.entries.find((entry) =>
      pathIdentity(safeRootPath(entry.path)) !== entry.after);
    if (mismatch) return { valid: false, reason: `projection-mismatch:${mismatch.path}` };
    if (journal.projectionHash !== state.workspace.apply.projectionHash)
      return { valid: false, reason: "projection-identity-mismatch" };
    return { valid: true, journal };
  }

  function cleanup(state) {
    const transactionId = state.workspace?.apply?.transactionId;
    if (!transactionId) return { status: "not-needed" };
    const transactionPath = transactionRoot(state.id, transactionId);
    try {
      for (const name of ["backup", "stage"]) {
        const path = join(transactionPath, name);
        if (existsSync(path)) rmSync(path, { recursive: true });
      }
      const path = journalPath(state.id, transactionId);
      if (existsSync(path)) {
        const journal = readJson(path);
        journal.status = "committed";
        journal.committedAt = now();
        delete journal.inFlightPaths;
        save(journal);
      }
      return { status: "committed", transactionId };
    } catch (error) {
      return { status: "failed", transactionId, reason: error.message };
    }
  }

  return {
    pathIdentity, safeRootPath, copyPath,
    transactionRoot, journalPath, save,
    applyEntry, rollback, verify, cleanup
  };
}
