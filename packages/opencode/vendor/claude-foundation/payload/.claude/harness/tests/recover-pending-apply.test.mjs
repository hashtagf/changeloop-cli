import assert from "node:assert/strict";
import {
  MANUAL_APPLY_STATUS,
  defaultManualRecoveryDecision,
  recoverApplyJournal,
  recoverPendingApplyOperation,
  settleCurrentApplyRecovery
} from "../runtime/workflow/apply-recovery.mjs";

const fail = (message) => { throw new Error(message); };

function fixture() {
  const calls = { block: [], settle: [], saveJournal: [], saveRuntime: [], clear: [], rollback: [] };
  const context = {
    verifyAppliedProjection: () => ({ valid: true }),
    saveApplyJournal: (journal) => { calls.saveJournal.push({ ...journal }); },
    rollbackApplyTransaction: (...args) => { calls.rollback.push(args); },
    settleApplyTransaction: (journal, resolution, decisionRef) => {
      calls.settle.push({ journal, resolution, decisionRef });
      journal.recovery = {};
    },
    saveRuntime: (state) => { calls.saveRuntime.push(state); },
    clearSnapshotCache: (id) => { calls.clear.push(id); },
    now: () => "now",
    blockWithDecision: (...args) => { calls.block.push(args); },
    fail
  };
  return { context, calls };
}

assert.deepEqual(MANUAL_APPLY_STATUS, [
  "rolling-back", "manual-recovery", "recovering-backup", "settling-current"
]);
const decision = defaultManualRecoveryDecision("/transactions/tx");
assert.equal(decision.kind, "manual-recovery");
assert.equal(decision.recommended, "inspect");
assert.equal(decision.transactionRoot, "/transactions/tx");
assert.deepEqual(decision.options.map((option) => option.id), [
  "inspect", "keep-current", "restore-backup", "pause"
]);

{
  const { context, calls } = fixture();
  const journal = { transactionId: "tx", status: "rolling-back" };
  recoverApplyJournal(context, {
    id: "c", state: { workspace: {} }, journal,
    transactionRoot: "/tx", options: {}
  });
  assert.equal(calls.block.length, 1);
  assert.equal(calls.block[0][0], "c");
  assert.equal(calls.block[0][1], "apply-manual-recovery");
  assert.equal(calls.block[0][2].transactionRoot, "/tx");
}

{
  const { context, calls } = fixture();
  const custom = { kind: "custom" };
  recoverApplyJournal(context, {
    id: "c", state: { workspace: {} },
    journal: { status: "manual-recovery", decision: custom },
    transactionRoot: "/tx", options: {}
  });
  assert.equal(calls.block[0][2], custom);
}

{
  const { context, calls } = fixture();
  const state = {
    status: "applied",
    workspace: { applied: true, apply: { transactionId: "tx" }, path: "/sandbox" }
  };
  const journal = { transactionId: "tx", status: "settling-current" };
  recoverApplyJournal(context, {
    id: "c", state, journal, transactionRoot: "/tx",
    options: { resolution: "keep-current", decisionRef: "decision-1" }
  });
  assert.equal(calls.settle.length, 1);
  assert.equal(state.status, "building");
  assert.equal(state.workspace.applied, false);
  assert.equal(state.workspace.apply, undefined);
  assert.deepEqual(state.workspace.recovery, {
    status: "settled-current",
    transactionId: "tx",
    decisionRef: "decision-1",
    requiresSync: true,
    resolvedAt: "now"
  });
  assert.equal(journal.status, "settled-current");
  assert.equal(journal.recovery.settledAt, "now");
  assert.deepEqual(calls.clear, ["c"]);
  assert.equal(calls.saveRuntime.length, 1);
}

{
  const { context, calls } = fixture();
  const journal = { status: "recovering-backup" };
  recoverApplyJournal(context, {
    id: "c", state: { workspace: {} }, journal, transactionRoot: "/tx",
    options: { resolution: "restore-backup", decisionRef: "decision-2" }
  });
  assert.equal(calls.settle[0].resolution, "restore-backup");
  assert.equal(calls.saveRuntime.length, 0);
}

{
  const { context, calls } = fixture();
  recoverApplyJournal(context, {
    id: "c", state: { workspace: {} }, journal: { status: "verified" },
    transactionRoot: "/tx", options: {}
  });
  assert.equal(calls.rollback.length, 0);
}

{
  const { context, calls } = fixture();
  const journal = { transactionId: "tx", status: "applying" };
  const state = { workspace: { applied: true, apply: { transactionId: "tx" } } };
  recoverApplyJournal(context, {
    id: "c", state, journal, transactionRoot: "/tx", options: {}
  });
  assert.equal(journal.status, "verified");
  assert.equal(journal.verifiedAt, "now");
  assert.equal(calls.saveJournal.length, 1);
}

{
  const { context } = fixture();
  context.verifyAppliedProjection = () => ({ valid: false, reason: "target diverged" });
  assert.throws(() => recoverApplyJournal(context, {
    id: "c",
    state: { workspace: { applied: true, apply: { transactionId: "tx" } } },
    journal: { transactionId: "tx", status: "prepared" },
    transactionRoot: "/tx", options: {}
  }), /interrupted apply cannot resume: target diverged/);
}

{
  const { context, calls } = fixture();
  const journal = { transactionId: "other", status: "prepared" };
  recoverApplyJournal(context, {
    id: "c", state: { workspace: { applied: true, apply: { transactionId: "tx" } } },
    journal, transactionRoot: "/tx", options: {}
  });
  assert.deepEqual(calls.rollback[0], [journal, "interrupted apply recovered before retry"]);
  context.rollbackApplyTransaction = () => { throw new Error("rollback blocked"); };
  assert.throws(() => recoverApplyJournal(context, {
    id: "c", state: { workspace: {} }, journal,
    transactionRoot: "/tx", options: {}
  }), /rollback blocked/);
}

{
  const state = { workspace: {} };
  const journal = { transactionId: "direct", recovery: {} };
  const { context, calls } = fixture();
  settleCurrentApplyRecovery({
    ...context, id: "direct", state, journal, decisionRef: "d"
  });
  assert.equal(calls.saveJournal.length, 1);
}

{
  const { context, calls } = fixture();
  const entries = [
    { name: "file", isDirectory: () => false },
    { name: "missing", isDirectory: () => true },
    { name: "tx", isDirectory: () => true }
  ];
  const operationContext = {
    ...context,
    transactions: "/transactions",
    transactionJournalPath: (_id, name) => `/journal/${name}`,
    pathExists: (path) => path !== "/journal/missing",
    readDirectory: () => entries,
    readJson: () => ({ transactionId: "tx", status: "prepared" })
  };
  recoverPendingApplyOperation(operationContext, "c", { workspace: {} });
  assert.equal(calls.rollback.length, 1);
  operationContext.pathExists = () => false;
  calls.rollback.length = 0;
  recoverPendingApplyOperation(operationContext, "c", { workspace: {} });
  assert.equal(calls.rollback.length, 0);
}
