import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createAbandonRuntime } from "../runtime/workflow/abandon-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-abandon-runtime-"));
const paths = Object.fromEntries([
  "recovery", "logs", "changes", "runtime", "receipts", "evidenceVault",
  "transactions", "plans", "handoffs", "snapshots"
].map((name) => [name, join(root, name)]));
let states = {};
let journals = {};
let rollbackFailure = null;
let workspaceCleanup = { status: "cleaned" };
let repositoryCleanup = { status: "cleaned" };
let blockMode = "throw";
const rollbacks = [];
const blocks = [];
const leaseCleanups = [];
const writes = [];
let output = "";
let warnings = "";
const priorLog = console.log;
const priorError = console.error;
console.log = (message) => { output += `${message}\n`; };
console.error = (message) => { warnings += `${message}\n`; };

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  writes.push([path, value]);
};
const runtime = createAbandonRuntime({
  root, paths,
  loadRuntime: (id, options) => {
    assert.deepEqual(options, { recoverable: true });
    return states[id] || {};
  },
  cleanupChangeLeases: (id) => leaseCleanups.push(id),
  cleanupAppliedSandbox: () => workspaceCleanup,
  cleanupRepositorySandboxes: () => repositoryCleanup,
  transactionJournals: (id) => journals[id] || [],
  rollbackApplyTransaction: (journal, reason) => {
    rollbacks.push([journal.transactionId, reason]);
    if (rollbackFailure === journal.transactionId) throw new Error("restore failed");
  },
  readJson: () => ({}), writeJson,
  now: () => "2026-08-26T00:00:00.000Z",
  blockWithDecision: (id, code, decision) => {
    blocks.push([id, code, decision]);
    if (blockMode === "throw") throw new Error(code);
  },
  fail: (message) => { throw new Error(message); }
});

function seed(id, state = {}) {
  states[id] = state;
  mkdirSync(join(paths.changes, id), { recursive: true });
  writeFileSync(join(paths.changes, id, "tasks.md"), "# Tasks\n");
  mkdirSync(paths.runtime, { recursive: true });
  writeFileSync(join(paths.runtime, `${id}.json`), "{}\n");
  mkdirSync(join(paths.receipts, id), { recursive: true });
  writeFileSync(join(paths.receipts, id, "test.json"), "{}\n");
  mkdirSync(join(paths.logs, id), { recursive: true });
  writeFileSync(join(paths.logs, id, "events.jsonl"), "{}\n");
}

try {
  assert.throws(() => runtime.abandonChange("missing"), /requires --reason/);
  assert.throws(() => runtime.abandonChange("missing", { reason: "retire" }),
    /requires --decision-ref/);

  states.archived = { status: "archived" };
  assert.throws(() => runtime.abandonChange("archived", {
    reason: "retire", "decision-ref": "host://archived"
  }), /already terminal/);

  states.invalid = {};
  assert.throws(() => runtime.abandonChange("invalid", {
    reason: "retire", "decision-ref": "host://invalid", applied: "inspect"
  }), /must be keep\|revert/);

  states.decision = {
    workspace: { applied: true, apply: { transactionId: "done", touchedPaths: ["app.js"] } }
  };
  journals.decision = [{
    transactionId: "divergent", status: "manual-recovery", failure: "conflict"
  }];
  assert.throws(() => runtime.abandonChange("decision", {
    reason: "retire", "decision-ref": "host://decision"
  }), /abandon-applied-workspace/);
  assert.equal(blocks.at(-1)[2].appliedPaths[0], "app.js");
  assert.equal(blocks.at(-1)[2].unresolvedTransactions[0].failure, "conflict");

  states.divergent = {};
  journals.divergent = [{ transactionId: "rolling", status: "rolling-back" }];
  assert.throws(() => runtime.abandonChange("divergent", {
    reason: "retire", "decision-ref": "host://divergent"
  }), /abandon-applied-workspace/);
  assert.match(blocks.at(-1)[2].summary, /stopped midway/);
  assert.equal(blocks.at(-1)[2].unresolvedTransactions[0].failure, null);

  const simpleId = "simple";
  seed(simpleId, { recoveredState: "missing", schema: "rapid", status: "building" });
  journals[simpleId] = [
    { transactionId: "prepared", status: "prepared" },
    { transactionId: "applying", status: "applying" },
    { transactionId: "settled", status: "settled" }
  ];
  mkdirSync(join(paths.recovery, "abandoned", simpleId, "change"), { recursive: true });
  writeFileSync(join(paths.recovery, "abandoned", simpleId, "change", "old.txt"), "old\n");
  output = "";
  warnings = "";
  runtime.abandonChange(simpleId, {
    reason: "  cannot prove  ", "decision-ref": " host://simple "
  });
  assert.deepEqual(rollbacks.slice(-2).map(([id]) => id), ["prepared", "applying"]);
  assert.equal(existsSync(join(paths.changes, simpleId)), false);
  assert.equal(existsSync(join(runtime.recoveryRoot(simpleId), "change", "tasks.md")), true);
  assert.equal(existsSync(join(runtime.recoveryRoot(simpleId), "change", "old.txt")), false);
  const simpleRecord = JSON.parse(readFileSync(
    join(runtime.recoveryRoot(simpleId), "abandon.json"), "utf8"));
  assert.equal(simpleRecord.reason, "cannot prove");
  assert.equal(simpleRecord.workspaceCleanup.status, "not-needed");
  assert.equal(simpleRecord.repositoryCleanup, null);
  assert.deepEqual(simpleRecord.reverted.map((row) => row.transactionId), ["prepared", "applying"]);
  assert.match(warnings, /runtime state.*missing/);
  assert.match(output, /ABANDONED simple/);

  const appliedId = "applied";
  seed(appliedId, {
    schema: "foundation-standard", status: "proven",
    workspace: {
      applied: true,
      apply: { transactionId: "projection", touchedPaths: ["src/a.js"] }
    },
    repositories: { root: {} }
  });
  journals[appliedId] = [{ transactionId: "projection", status: "committed" }];
  workspaceCleanup = { status: "refused", reason: "dirty workspace" };
  repositoryCleanup = { status: "cleaned", count: 1 };
  warnings = "";
  runtime.abandonChange(appliedId, {
    reason: "retire projection", "decision-ref": "host://applied", applied: "revert"
  });
  const appliedRecord = JSON.parse(readFileSync(
    join(runtime.recoveryRoot(appliedId), "abandon.json"), "utf8"));
  assert.equal(appliedRecord.applied, "revert");
  assert.deepEqual(appliedRecord.appliedPaths, ["src/a.js"]);
  assert.equal(appliedRecord.repositoryCleanup.count, 1);
  assert.equal(appliedRecord.reverted.at(-1).transactionId, "projection");
  assert.match(warnings, /sandbox cleanup refused: dirty workspace/);

  const missingJournalId = "missing-journal";
  seed(missingJournalId, {
    workspace: { applied: true, apply: { transactionId: "absent", touchedPaths: [] } }
  });
  assert.throws(() => runtime.abandonChange(missingJournalId, {
    reason: "retire", "decision-ref": "host://missing-journal", applied: "revert"
  }), /journal is missing/);
  assert.match(readFileSync(join(paths.logs, "abandoned.jsonl"), "utf8"), /abandon-started/);

  const failedRollbackId = "failed-rollback";
  seed(failedRollbackId, {});
  journals[failedRollbackId] = [{ transactionId: "broken", status: "prepared" }];
  rollbackFailure = "broken";
  blockMode = "continue";
  workspaceCleanup = { status: "cleaned" };
  warnings = "";
  const priorUser = process.env.USER;
  const priorLogname = process.env.LOGNAME;
  delete process.env.USER;
  delete process.env.LOGNAME;
  runtime.abandonChange(failedRollbackId, {
    reason: "retire", "decision-ref": "host://failed-rollback", applied: "keep"
  });
  if (priorUser === undefined) delete process.env.USER;
  else process.env.USER = priorUser;
  if (priorLogname === undefined) delete process.env.LOGNAME;
  else process.env.LOGNAME = priorLogname;
  assert.equal(blocks.at(-1)[1], "abandon-revert-failed");
  assert.match(blocks.at(-1)[2].summary, /restore failed/);
  const failedRecord = JSON.parse(readFileSync(
    join(runtime.recoveryRoot(failedRollbackId), "abandon.json"), "utf8"));
  assert.deepEqual(failedRecord.reverted, []);

  assert.equal(leaseCleanups.includes(simpleId), true);
  assert.equal(writes.some(([path]) => path.endsWith("abandon.json")), true);
  priorLog("abandon runtime tests: PASS");
} finally {
  console.log = priorLog;
  console.error = priorError;
  rmSync(root, { recursive: true, force: true });
}
