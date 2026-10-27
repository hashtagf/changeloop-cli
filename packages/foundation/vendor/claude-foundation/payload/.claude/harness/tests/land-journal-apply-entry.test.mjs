import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  applyFailureAfter,
  applyLandJournalEntry,
  cleanupLandJournalOperation,
  createLandJournal,
  landEntryNoOp,
  restoreLandJournalEntry,
  rollbackLandJournalOperation,
  verifyLandJournalOperation
} from "../runtime/workflow/land-journal.mjs";

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(name) {
  const root = mkdtempSync(join(tmpdir(), `foundation-land-entry-${name}-`));
  const transactions = join(root, ".foundation", "transactions");
  const sandbox = join(root, ".foundation", "sandbox");
  const writes = [];
  const runtime = createLandJournal({
    root,
    transactions,
    fileDigest: (path) => readFileSync(path, "utf8"),
    directoryHash: (path) => `directory:${path}`,
    pathInside: (parent, path) => path.startsWith(`${parent}/`),
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => {
      write(path, `${JSON.stringify(value)}\n`);
      writes.push(JSON.parse(JSON.stringify(value)));
    },
    now: () => "2026-08-26T00:00:00.000Z"
  });
  const journal = {
    changeId: "change",
    transactionId: "transaction",
    sandboxPath: sandbox,
    appliedPaths: [],
    inFlightPaths: []
  };
  return { root, sandbox, runtime, journal, writes };
}

test("apply entry replaces a target through staging and records journal order", () => {
  const { root, sandbox, runtime, journal, writes } = fixture("replace");
  write(join(root, "src/app.txt"), "before");
  write(join(sandbox, "src/app.txt"), "after");
  runtime.applyEntry(journal, {
    path: "src/app.txt", before: "before", after: "after"
  }, 0);
  assert.equal(readFileSync(join(root, "src/app.txt"), "utf8"), "after");
  assert.deepEqual(journal.appliedPaths, ["src/app.txt"]);
  assert.deepEqual(journal.inFlightPaths, []);
  assert.deepEqual(writes.map((row) => row.inFlightPaths), [["src/app.txt"], []]);
  assert.equal(existsSync(join(root, ".foundation/transactions/change/transaction/stage/0")), false);
});

test("apply entry creates, deletes, and accepts exact no-op projections", () => {
  const created = fixture("create");
  write(join(created.sandbox, "new.txt"), "new");
  created.runtime.applyEntry(created.journal, {
    path: "new.txt", before: null, after: "new"
  }, 0);
  assert.equal(readFileSync(join(created.root, "new.txt"), "utf8"), "new");

  const deleted = fixture("delete");
  write(join(deleted.root, "old.txt"), "old");
  deleted.runtime.applyEntry(deleted.journal, {
    path: "old.txt", before: "old", after: null
  }, 0);
  assert.equal(existsSync(join(deleted.root, "old.txt")), false);

  const unchanged = fixture("noop");
  write(join(unchanged.root, "same.txt"), "same");
  unchanged.runtime.applyEntry(unchanged.journal, {
    path: "same.txt", before: "same", after: "same"
  }, 0);
  assert.equal(readFileSync(join(unchanged.root, "same.txt"), "utf8"), "same");
});

test("apply entry fails before journaling when the target has drifted", () => {
  const { root, sandbox, runtime, journal, writes } = fixture("drift");
  write(join(root, "app.txt"), "divergent");
  write(join(sandbox, "app.txt"), "after");
  assert.throws(() => runtime.applyEntry(journal, {
    path: "app.txt", before: "before", after: "after"
  }, 0), /target changed during apply/);
  assert.deepEqual(writes, []);
  assert.equal(readFileSync(join(root, "app.txt"), "utf8"), "divergent");
});

test("post-apply mismatch leaves the path in flight for rollback", () => {
  const journal = { appliedPaths: [], inFlightPaths: [] };
  let matchCalls = 0;
  const saves = [];
  assert.throws(() => applyLandJournalEntry({
    safeRootPath: () => "/target",
    pathIdentity: () => "before",
    matches: () => ++matchCalls === 1,
    save: (value) => saves.push([...value.inFlightPaths]),
    env: {},
    pathExists: () => false,
    remove: assert.fail,
    copyPath: () => {},
    makeDirectory: () => {},
    rename: () => {},
    transactionRoot: () => "/transaction"
  }, journal, { path: "app.txt", before: "before", after: "before" }, 0),
  /post-apply projection mismatch/);
  assert.deepEqual(journal.inFlightPaths, ["app.txt"]);
  assert.deepEqual(saves, [["app.txt"]]);
});

test("test-mode failure is injected only after the applied journal is durable", () => {
  const journal = { appliedPaths: [], inFlightPaths: [] };
  const saves = [];
  assert.throws(() => applyLandJournalEntry({
    safeRootPath: () => "/target",
    pathIdentity: () => "same",
    matches: () => true,
    save: (value) => saves.push({
      applied: [...value.appliedPaths], inFlight: [...value.inFlightPaths]
    }),
    env: { FOUNDATION_TEST_MODE: "1", FOUNDATION_TEST_FAIL_APPLY_AFTER: "1" }
  }, journal, { path: "same.txt", before: "same", after: "same" }, 0),
  /injected apply failure after 1 path/);
  assert.deepEqual(saves.at(-1), { applied: ["same.txt"], inFlight: [] });
});

test("entry decisions account for modes and guarded test injection", () => {
  assert.equal(landEntryNoOp({ before: "x", after: "x" }), true);
  assert.equal(landEntryNoOp({ before: "x", after: "x", beforeMode: 0o644, afterMode: 0o755 }), false);
  assert.equal(applyFailureAfter({ FOUNDATION_TEST_MODE: "0", FOUNDATION_TEST_FAIL_APPLY_AFTER: "2" }), 0);
  assert.equal(applyFailureAfter({ FOUNDATION_TEST_MODE: "1", FOUNDATION_TEST_FAIL_APPLY_AFTER: "2" }), 2);
});

test("restore entry accepts settled state and rejects unowned divergence", () => {
  const entry = { path: "app.txt", before: "before", after: "after", backup: "backup/0" };
  let removed = 0;
  restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => "before",
    matches: (_path, _entry, side) => side === "before",
    remove: () => { removed += 1; }, copyPath: assert.fail,
    transactionRoot: () => "/transaction"
  }, { appliedPaths: [], inFlightPaths: [] }, entry);
  assert.equal(removed, 0);

  assert.throws(() => restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => "divergent",
    matches: () => false, remove: assert.fail, copyPath: assert.fail,
    transactionRoot: () => "/transaction"
  }, { appliedPaths: [], inFlightPaths: [] }, entry), /manual recovery/);

  assert.throws(() => restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => "divergent",
    matches: () => false, remove: assert.fail, copyPath: assert.fail,
    transactionRoot: () => "/transaction"
  }, { appliedPaths: ["app.txt"], inFlightPaths: [] }, entry), /manual recovery/);
});

test("restore entry removes applied creations and restores verified backups", () => {
  const creation = { path: "new.txt", before: null, after: "new", backup: null };
  const calls = [];
  let matchCall = 0;
  restoreLandJournalEntry({
    safeRootPath: () => "/new", pathIdentity: () => "new",
    matches: () => [false, true, true][matchCall++],
    remove: (...args) => calls.push(["remove", ...args]),
    copyPath: assert.fail, transactionRoot: () => "/transaction"
  }, { appliedPaths: [], inFlightPaths: ["new.txt"] }, creation);
  assert.deepEqual(calls, [["remove", "/new", { recursive: true }]]);

  const restored = [];
  matchCall = 0;
  restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => null,
    matches: () => [false, false, true][matchCall++],
    remove: assert.fail,
    copyPath: (...args) => restored.push(args),
    transactionRoot: () => "/transaction"
  }, {
    changeId: "change", transactionId: "tx",
    appliedPaths: ["app.txt"], inFlightPaths: []
  }, { path: "app.txt", before: "before", after: "after", backup: "backup/0" });
  assert.deepEqual(restored, [["/transaction/backup/0", "/target"]]);

  matchCall = 0;
  assert.throws(() => restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => null,
    matches: () => [false, false, false][matchCall++],
    remove: assert.fail, copyPath: () => {}, transactionRoot: () => "/transaction"
  }, {
    changeId: "change", transactionId: "tx",
    appliedPaths: ["app.txt"], inFlightPaths: []
  }, { path: "app.txt", before: "before", after: "after", backup: "backup/0" }),
  /rollback verification failed/);
});

test("rollback processes entries in reverse and records manual recovery failures", () => {
  const order = [];
  const saves = [];
  const journal = {
    changeId: "change", transactionId: "tx", inFlightPaths: ["b"],
    entries: [{ path: "a" }, { path: "b" }]
  };
  rollbackLandJournalOperation({
    restoreEntry: (_journal, entry) => order.push(entry.path),
    save: (value) => saves.push(value.status),
    now: () => "now", transactionRoot: () => "/transaction"
  }, journal, new Error("apply failed"));
  assert.deepEqual(order, ["b", "a"]);
  assert.deepEqual(saves, ["rolling-back", "rolled-back"]);
  assert.equal(journal.failure, "apply failed");
  assert.deepEqual(journal.inFlightPaths, []);

  const failed = {
    changeId: "change", transactionId: "tx", inFlightPaths: [], entries: [{ path: "a" }]
  };
  assert.throws(() => rollbackLandJournalOperation({
    restoreEntry: () => { throw new Error("target diverged"); },
    save: () => {}, now: () => "now", transactionRoot: () => "/transaction"
  }, failed, "apply failed"), /target diverged/);
  assert.equal(failed.status, "manual-recovery");
  assert.equal(failed.recoveryError, "target diverged");
  assert.equal(failed.decision.recommended, "inspect");
  assert.equal(failed.decision.transactionRoot, "/transaction");
});

test("journal verification distinguishes every invalid projection state", () => {
  const base = {
    journalPath: () => "/journal", exists: () => true,
    readJson: () => ({ entries: [], projectionHash: "projection" }),
    matches: () => true, safeRootPath: (path) => `/root/${path}`
  };
  assert.deepEqual(verifyLandJournalOperation(base, { id: "change", workspace: {} }), {
    valid: false, reason: "missing-apply-transaction"
  });
  const state = {
    id: "change", workspace: { apply: { transactionId: "tx", projectionHash: "projection" } }
  };
  assert.deepEqual(verifyLandJournalOperation({ ...base, exists: () => false }, state), {
    valid: false, reason: "missing-apply-journal"
  });
  assert.deepEqual(verifyLandJournalOperation({
    ...base,
    readJson: () => ({ entries: [{ path: "bad.txt" }], projectionHash: "projection" }),
    matches: () => false
  }, state), { valid: false, reason: "projection-mismatch:bad.txt" });
  assert.deepEqual(verifyLandJournalOperation({
    ...base, readJson: () => ({ entries: [], projectionHash: "other" })
  }, state), { valid: false, reason: "projection-identity-mismatch" });
  assert.equal(verifyLandJournalOperation(base, state).valid, true);
});

test("journal cleanup removes temporary data, commits journals, and reports failures", () => {
  const noApply = cleanupLandJournalOperation({}, { workspace: {} });
  assert.deepEqual(noApply, { status: "not-needed" });

  const removed = [];
  const saved = [];
  const journal = { status: "applied", inFlightPaths: ["app.txt"] };
  const state = { id: "change", workspace: { apply: { transactionId: "tx" } } };
  const result = cleanupLandJournalOperation({
    transactionRoot: () => "/transaction",
    exists: (path) => path !== "/transaction/stage",
    remove: (...args) => removed.push(args),
    journalPath: () => "/journal", readJson: () => journal,
    now: () => "now", save: (value) => saved.push(value)
  }, state);
  assert.deepEqual(result, { status: "committed", transactionId: "tx" });
  assert.deepEqual(removed, [["/transaction/backup", { recursive: true }]]);
  assert.equal(journal.status, "committed");
  assert.equal(journal.committedAt, "now");
  assert.equal("inFlightPaths" in journal, false);
  assert.equal(saved.length, 1);

  assert.deepEqual(cleanupLandJournalOperation({
    transactionRoot: () => "/transaction", exists: () => true,
    remove: () => { throw new Error("busy"); }, journalPath: () => "/journal"
  }, state), { status: "failed", transactionId: "tx", reason: "busy" });
});
