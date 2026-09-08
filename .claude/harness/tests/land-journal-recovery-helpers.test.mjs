import assert from "node:assert/strict";
import test from "node:test";

import {
  beginManualRecovery,
  finishManualRecovery,
  pendingRecoveryEntries,
  replaceRecoveryEntry,
  stageRecoveryBackups
} from "../runtime/workflow/land-journal.mjs";
import { createLandRuntime } from "../runtime/workflow/land-runtime.mjs";

const entry = {
  path: "app.txt", before: "before", after: "after", backup: "backup/0"
};

function journal(entries = [entry]) {
  return {
    changeId: "change-a", transactionId: "tx-1", entries,
    recoveredPaths: [], inFlightPaths: ["app.txt"]
  };
}

test("land recovery requires authority and settles automatic and manual journals", () => {
  let pending = [];
  const recoveries = [];
  const runtime = createLandRuntime({
    pendingApplyTransactions: () => pending,
    recoverPendingApply: (id, state, options) => {
      recoveries.push({ id, state, options });
      pending = [];
    },
    loadRuntime: () => ({ id: "change-a" }),
    fail: (message) => { throw new Error(message); }
  });
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(String(message));
  try {
    assert.throws(() => runtime.recoverLand("change-a"), /requires --decision-ref/);
    runtime.recoverLand("change-a", { "decision-ref": "decision-1" });
    assert.match(logs.at(-1), /NOTHING TO RECOVER/);

    pending = [{
      transactionId: "tx-manual", status: "rolling-back",
      counts: { update: 2, create: 1, delete: 0 }
    }];
    assert.throws(() => runtime.recoverLand("change-a", {
      "decision-ref": "decision-2"
    }), /requires --resolution/);
    runtime.recoverLand("change-a", {
      "decision-ref": "decision-2", resolution: "restore-backup"
    });
    assert.deepEqual(recoveries.at(-1).options, {
      resolution: "restore-backup", decisionRef: "decision-2"
    });

    pending = [{
      transactionId: "tx-auto", status: "applying",
      counts: { update: 0, create: 0, delete: 1 }
    }];
    runtime.recoverLand("change-a", { "decision-ref": "decision-3" });
    assert.deepEqual(recoveries.at(-1).options, {
      resolution: "", decisionRef: "decision-3"
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((message) => message.includes("RECOVERING tx-manual")));
  assert.ok(logs.some((message) => message.includes("RECOVERED change-a")));
});

test("manual recovery start validates authority and snapshots current targets", () => {
  const saves = [];
  const context = {
    safeRootPath: (path) => `/root/${path}`,
    pathIdentity: (path) => `identity:${path}`,
    pathMode: () => 0o644,
    now: () => "2026-08-27T00:00:00.000Z",
    save: (value) => saves.push(value.status)
  };
  assert.throws(() => beginManualRecovery(context, journal(), "keep-current", ""),
    /requires a decision reference/);
  assert.throws(() => beginManualRecovery(context, journal(), "invalid", "decision"),
    /must be keep-current\|restore-backup/);
  const keep = journal();
  assert.equal(beginManualRecovery(context, keep, "keep-current", "decision-1"), false);
  assert.equal(keep.status, "settling-current");
  assert.equal(keep.recovery.before[0].identity, "identity:/root/app.txt");
  const restore = journal();
  delete restore.recoveredPaths;
  assert.equal(beginManualRecovery(context, restore, "restore-backup", "decision-2"), true);
  assert.deepEqual(restore.recoveredPaths, []);
  assert.deepEqual(saves, ["settling-current", "recovering-backup"]);
});

test("pending recovery entries are reversed and exclude already-restored paths", () => {
  const entries = [{ ...entry, path: "one" }, { ...entry, path: "two" }];
  const result = pendingRecoveryEntries({
    safeRootPath: (path) => path,
    matches: (path) => path === "one"
  }, journal(entries));
  assert.deepEqual(result.map((row) => row.path), ["two"]);
});

test("backup staging skips deletions, replaces stale stages, and verifies before mutation", () => {
  const actions = [];
  const entries = [{ ...entry, path: "delete", before: null }, entry];
  const context = {
    transactionRoot: () => "/tx",
    exists: (path) => path === "/tx/recovery-stage/1",
    remove: (...args) => actions.push(["remove", ...args]),
    copyPath: (...args) => actions.push(["copy", ...args]),
    matches: () => true
  };
  stageRecoveryBackups(context, journal(entries), entries);
  assert.equal(actions.filter(([kind]) => kind === "copy").length, 1);
  assert.equal(actions.filter(([kind]) => kind === "remove").length, 1);
  assert.throws(() => stageRecoveryBackups({
    ...context, exists: () => false, matches: () => false
  }, journal([entry]), [entry]), /backup verification failed/);
});

test("entry replacement records already-restored paths and rejects two current copies", () => {
  const value = journal();
  let saves = 0;
  replaceRecoveryEntry({
    safeRootPath: () => "/root/app.txt",
    matches: () => true,
    save: () => { saves += 1; }
  }, value, entry);
  assert.deepEqual(value.recoveredPaths, ["app.txt"]);
  assert.equal(saves, 1);
  replaceRecoveryEntry({
    safeRootPath: () => "/root/app.txt",
    matches: () => true,
    save: () => { saves += 1; }
  }, value, entry);
  assert.deepEqual(value.recoveredPaths, ["app.txt"]);

  assert.throws(() => replaceRecoveryEntry({
    safeRootPath: () => "/root/app.txt",
    matches: () => false,
    transactionRoot: () => "/tx",
    makeDirectory: () => {},
    exists: (path) => ["/root/app.txt", "/tx/recovery-current/0"].includes(path)
  }, journal(), entry), /found two current copies/);
});

test("entry replacement restores a displaced target when staging rename fails", () => {
  const target = "/root/app.txt";
  const stage = "/tx/recovery-stage/0";
  const displaced = "/tx/recovery-current/0";
  const paths = new Set([target, stage]);
  const moves = [];
  const context = {
    safeRootPath: () => target,
    matches: () => false,
    transactionRoot: () => "/tx",
    makeDirectory: () => {},
    exists: (path) => paths.has(path),
    rename: (from, to) => {
      moves.push([from, to]);
      if (from === stage) throw new Error("rename failed");
      paths.delete(from);
      paths.add(to);
    }
  };
  assert.throws(() => replaceRecoveryEntry(context, journal(), entry), /rename failed/);
  assert.equal(paths.has(target), true);
  assert.equal(paths.has(displaced), false);
  assert.deepEqual(moves, [
    [target, displaced], [stage, target], [displaced, target]
  ]);
});

test("deletion recovery displaces current content without restoring a backup", () => {
  const deletion = { ...entry, before: null };
  const target = "/root/app.txt";
  const paths = new Set([target]);
  const value = journal([deletion]);
  replaceRecoveryEntry({
    safeRootPath: () => target,
    matches: (path) => !paths.has(path),
    transactionRoot: () => "/tx",
    makeDirectory: () => {},
    exists: (path) => paths.has(path),
    rename: (from, to) => { paths.delete(from); paths.add(to); },
    save: () => {}
  }, value, deletion);
  assert.equal(paths.has(target), false);
  assert.deepEqual(value.recoveredPaths, ["app.txt"]);
});

test("manual recovery finish removes staging trees and settles the journal", () => {
  const removed = [];
  const value = journal();
  value.recovery = {};
  finishManualRecovery({
    transactionRoot: () => "/tx",
    exists: (path) => path.endsWith("recovery-stage"),
    remove: (path) => removed.push(path),
    now: () => "2026-08-27T00:00:00.000Z",
    save: () => {}
  }, value);
  assert.deepEqual(removed, ["/tx/recovery-stage"]);
  assert.equal(value.status, "rolled-back");
  assert.deepEqual(value.inFlightPaths, []);
  assert.equal(value.recovery.settledAt, "2026-08-27T00:00:00.000Z");
});
