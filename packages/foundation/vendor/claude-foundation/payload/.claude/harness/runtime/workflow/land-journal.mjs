import {
  cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, renameSync,
  rmSync, symlinkSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deriveApplyProjection } from "../core/state-projections.mjs";
import { manualRecoveryDecision } from "./apply-recovery.mjs";

export function transactionJournals(transactions, id, readJson) {
  const root = join(transactions, id);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "journal.json"))
    .filter((path) => existsSync(path))
    .map((path) => readJson(path, {}));
}

export function landEntryNoOp(entry) {
  return entry.before === entry.after &&
    (entry.beforeMode === undefined || entry.beforeMode === entry.afterMode);
}

export function applyFailureAfter(env = process.env) {
  return env.FOUNDATION_TEST_MODE === "1"
    ? Number(env.FOUNDATION_TEST_FAIL_APPLY_AFTER || 0) : 0;
}

export function projectLandEntry(context, journal, entry, index, target, current) {
  if (landEntryNoOp(entry)) return;
  if (entry.after === null) {
    if (current !== null) context.remove(target, { recursive: true });
    return;
  }
  const source = resolve(journal.sandboxPath, entry.path);
  const stage = join(context.transactionRoot(journal.changeId, journal.transactionId),
    "stage", String(index));
  if (context.pathExists(stage)) context.remove(stage, { recursive: true });
  context.copyPath(source, stage);
  context.makeDirectory(dirname(target), { recursive: true });
  if (current !== null) context.remove(target, { recursive: true });
  context.rename(stage, target);
}

export function applyLandJournalEntry(context, journal, entry, index) {
  const target = context.safeRootPath(entry.path);
  const current = context.pathIdentity(target);
  if (!context.matches(target, entry, "before"))
    throw new Error(`target changed during apply at '${entry.path}'`);
  journal.inFlightPaths = [entry.path];
  context.save(journal);
  projectLandEntry(context, journal, entry, index, target, current);
  if (!context.matches(target, entry, "after"))
    throw new Error(`post-apply projection mismatch at '${entry.path}'`);
  journal.appliedPaths.push(entry.path);
  journal.inFlightPaths = [];
  context.save(journal);
  const failAfter = applyFailureAfter(context.env);
  if (failAfter > 0 && journal.appliedPaths.length >= failAfter)
    throw new Error(`injected apply failure after ${journal.appliedPaths.length} path(s)`);
}

export function beginManualRecovery(context, journal, resolution, decisionRef) {
  if (!decisionRef)
    throw new Error("manual recovery requires a decision reference");
  if (!["keep-current", "restore-backup"].includes(resolution))
    throw new Error("manual recovery resolution must be keep-current|restore-backup");
  journal.recovery = {
    resolution,
    decisionRef,
    before: journal.entries.map((entry) => ({
      path: entry.path,
      identity: context.pathIdentity(context.safeRootPath(entry.path)),
      mode: context.pathMode(context.safeRootPath(entry.path))
    })),
    startedAt: context.now()
  };
  if (resolution === "keep-current") {
    journal.status = "settling-current";
    context.save(journal);
    return false;
  }
  journal.status = "recovering-backup";
  journal.recoveredPaths ||= [];
  context.save(journal);
  return true;
}

export function pendingRecoveryEntries(context, journal) {
  return [...journal.entries].reverse().filter((entry) =>
    !context.matches(context.safeRootPath(entry.path), entry, "before"));
}

export function stageRecoveryBackups(context, journal, pending) {
  for (const entry of pending) {
    if (entry.before === null) continue;
    const index = journal.entries.indexOf(entry);
    const stage = join(context.transactionRoot(
      journal.changeId, journal.transactionId), "recovery-stage", String(index));
    if (context.exists(stage)) context.remove(stage, { recursive: true });
    context.copyPath(join(context.transactionRoot(
      journal.changeId, journal.transactionId), entry.backup), stage);
    if (!context.matches(stage, entry, "before"))
      throw new Error(`manual recovery backup verification failed at '${entry.path}'`);
  }
}

export function replaceRecoveryEntry(context, journal, entry) {
  const target = context.safeRootPath(entry.path);
  if (!context.matches(target, entry, "before")) {
    const index = journal.entries.indexOf(entry);
    const transaction = context.transactionRoot(
      journal.changeId, journal.transactionId);
    const stage = join(transaction, "recovery-stage", String(index));
    const displaced = join(transaction, "recovery-current", String(index));
    context.makeDirectory(dirname(displaced), { recursive: true });
    if (context.exists(displaced) && context.exists(target))
      throw new Error(`manual recovery found two current copies at '${entry.path}'`);
    if (!context.exists(displaced) && context.exists(target))
      context.rename(target, displaced);
    try {
      if (entry.before !== null && !context.exists(target)) {
        context.makeDirectory(dirname(target), { recursive: true });
        context.rename(stage, target);
      }
    } catch (error) {
      if (!context.exists(target) && context.exists(displaced))
        context.rename(displaced, target);
      throw error;
    }
  }
  if (!context.matches(target, entry, "before"))
    throw new Error(`manual recovery verification failed at '${entry.path}'`);
  if (!journal.recoveredPaths.includes(entry.path))
    journal.recoveredPaths.push(entry.path);
  context.save(journal);
}

export function finishManualRecovery(context, journal) {
  for (const name of ["recovery-current", "recovery-stage"]) {
    const path = join(context.transactionRoot(
      journal.changeId, journal.transactionId), name);
    if (context.exists(path)) context.remove(path, { recursive: true });
  }
  journal.status = "rolled-back";
  journal.inFlightPaths = [];
  journal.rolledBackAt = context.now();
  journal.recovery.settledAt = context.now();
  context.save(journal);
}

export function settleLandJournalOperation(
  context, journal, resolution, decisionRef
) {
  if (!beginManualRecovery(context, journal, resolution, decisionRef)) return;
  const pending = pendingRecoveryEntries(context, journal);
  stageRecoveryBackups(context, journal, pending);
  for (const entry of pending) replaceRecoveryEntry(context, journal, entry);
  finishManualRecovery(context, journal);
}

export function restoreLandJournalEntry(context, journal, entry) {
  const target = context.safeRootPath(entry.path);
  const current = context.pathIdentity(target);
  if (context.matches(target, entry, "before")) return;
  const possiblyApplied = journal.appliedPaths.includes(entry.path) ||
    journal.inFlightPaths.includes(entry.path);
  if (!possiblyApplied || (!context.matches(target, entry, "after") && current !== null))
    throw new Error(`rollback requires manual recovery at '${entry.path}'`);
  if (current !== null) context.remove(target, { recursive: true });
  if (entry.before !== null)
    context.copyPath(join(context.transactionRoot(
      journal.changeId, journal.transactionId), entry.backup), target);
  if (!context.matches(target, entry, "before"))
    throw new Error(`rollback verification failed at '${entry.path}'`);
}

// Paths whose current target content is neither what Land found nor what it
// wrote: someone else's bytes. Reported to the agent, never overwritten.
export function divergentJournalPaths(context, journal) {
  try {
    return (journal.entries || []).filter((entry) => {
      const target = context.safeRootPath(entry.path);
      return !context.matches(target, entry, "before") && !context.matches(target, entry, "after");
    }).map((entry) => entry.path);
  } catch {
    return [];
  }
}

export function rollbackLandJournalOperation(context, journal, reason) {
  journal.status = "rolling-back";
  journal.failure = String(reason?.message || reason);
  context.save(journal);
  try {
    for (const entry of [...journal.entries].reverse())
      context.restoreEntry(journal, entry);
    journal.status = "rolled-back";
    journal.inFlightPaths = [];
    journal.rolledBackAt = context.now();
    context.save(journal);
  } catch (error) {
    journal.status = "manual-recovery";
    journal.recoveryError = error.message;
    journal.divergentPaths = divergentJournalPaths(context, journal);
    journal.decision = manualRecoveryDecision(
      context.transactionRoot(journal.changeId, journal.transactionId), {
        changeId: journal.changeId,
        summary: "The target changed during rollback, so Foundation stopped without overwriting the divergent content.",
        divergentPaths: journal.divergentPaths,
        recoveryError: error.message
      });
    context.save(journal);
    throw error;
  }
}

export function verifyLandJournalOperation(context, state, { archivedChangePath = null } = {}) {
  const transactionId = state.workspace?.apply?.transactionId;
  if (!transactionId) return { valid: false, reason: "missing-apply-transaction" };
  const path = context.journalPath(state.id, transactionId);
  if (!context.exists(path)) return { valid: false, reason: "missing-apply-journal" };
  const journal = context.readJson(path);
  if (archivedChangePath && (!archivedChangePath.startsWith("openspec/changes/archive/") ||
      archivedChangePath.split(/[\\/]/).some((part) => !part || part === "." || part === "..")))
    return { valid: false, reason: "invalid-archive-projection-path" };
  for (const entry of journal.entries) {
    const observedPath = archivedChangePath && entry.path === `openspec/changes/${state.id}`
      ? archivedChangePath : entry.path;
    if (!context.matches(context.safeRootPath(observedPath), entry, "after"))
      return { valid: false, reason: `projection-mismatch:${entry.path}` };
  }
  const projection = deriveApplyProjection(state, journal);
  if (!projection.valid) return { valid: false, reason: projection.reason };
  return { valid: true, journal };
}

export function cleanupLandJournalOperation(context, state) {
  const transactionId = state.workspace?.apply?.transactionId;
  if (!transactionId) return { status: "not-needed" };
  const transactionPath = context.transactionRoot(state.id, transactionId);
  try {
    // The backup of the pre-Land bytes is retained: while the target diff is
    // uncommitted, `advance --undo-land` restores it.
    for (const name of ["stage"]) {
      const path = join(transactionPath, name);
      if (context.exists(path)) context.remove(path, { recursive: true });
    }
    const path = context.journalPath(state.id, transactionId);
    if (context.exists(path)) {
      const journal = context.readJson(path);
      journal.status = "committed";
      journal.committedAt = context.now();
      delete journal.inFlightPaths;
      context.save(journal);
    }
    return { status: "committed", transactionId };
  } catch (error) {
    return { status: "failed", transactionId, reason: error.message };
  }
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

  function pathMode(path) {
    try {
      const stat = lstatSync(path);
      return stat.isFile() || stat.isDirectory() ? stat.mode & 0o7777 : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  function matches(path, entry, side) {
    if (pathIdentity(path) !== entry[side]) return false;
    const expectedMode = entry[`${side}Mode`];
    return expectedMode === undefined || pathMode(path) === expectedMode;
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

  const applyEntry = applyLandJournalEntry.bind(null, {
    safeRootPath,
    pathIdentity,
    matches,
    save,
    transactionRoot,
    pathExists: existsSync,
    remove: rmSync,
    copyPath,
    makeDirectory: mkdirSync,
    rename: renameSync,
    env: process.env
  });

  const restoreEntry = restoreLandJournalEntry.bind(null, {
    safeRootPath, pathIdentity, matches, remove: rmSync, copyPath, transactionRoot
  });
  const rollback = rollbackLandJournalOperation.bind(null, {
    restoreEntry, save, now, transactionRoot, safeRootPath, matches
  });

  const settle = settleLandJournalOperation.bind(null, {
    safeRootPath, pathIdentity, pathMode, now, save, matches, transactionRoot,
    exists: existsSync, remove: rmSync, copyPath,
    makeDirectory: mkdirSync, rename: renameSync
  });

  const verify = verifyLandJournalOperation.bind(null, {
    journalPath, exists: existsSync, readJson, matches, safeRootPath
  });
  const cleanup = cleanupLandJournalOperation.bind(null, {
    transactionRoot, exists: existsSync, remove: rmSync,
    journalPath, readJson, now, save
  });

  return {
    pathIdentity, pathMode, safeRootPath, copyPath,
    transactionRoot, journalPath, save,
    applyEntry, rollback, settle, verify, cleanup
  };
}
