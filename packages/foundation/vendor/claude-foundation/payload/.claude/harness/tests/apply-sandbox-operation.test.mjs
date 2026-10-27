import assert from "node:assert/strict";
import {
  appliedRuntimeState,
  applySandboxOperation,
  assertLocalApply,
  projectionHash,
  projectionMismatch,
  reapplyProjection
} from "../runtime/workflow/apply-runtime.mjs";

const priorLog = console.log;
const priorMarker = process.env.FOUNDATION_LAND_TRANSACTION;
console.log = () => {};
const fail = (message) => { throw new Error(message); };

function fixture(overrides = {}) {
  let state = overrides.state || {
    id: "c",
    status: "proven",
    workspace: { mode: "copy", path: "/sandbox" }
  };
  const current = new Map([["a", { identity: "old", mode: "100" }]]);
  const saves = { runtime: [], journal: [] };
  const journal = {
    transactionId: "tx",
    projectionHash: "projection",
    status: "prepared",
    entries: [{
      path: "a", role: "code",
      before: "old", beforeMode: "100",
      after: "new", afterMode: "200"
    }]
  };
  const calls = { recover: 0, refresh: 0, prepare: 0, rollback: 0, marker: null };
  const context = {
    root: "/target",
    loadRuntime: () => state,
    saveRuntime: (value) => { state = value; saves.runtime.push(value); },
    refreshAppliedProjection: () => { calls.refresh += 1; state.workspace.applied = false; },
    recoverPendingApply: () => { calls.recover += 1; },
    landCheck: () => ({ archived: false }),
    verifyAppliedProjection: () => ({ valid: true, journal: { entries: [] } }),
    buildReapplyEntries: () => journal.entries,
    stableHash: (value) => JSON.stringify(value),
    prepareApplyTransaction: () => { calls.prepare += 1; return journal; },
    safeRootPath: (path) => path,
    pathIdentity: (path) => current.get(path)?.identity ?? null,
    pathMode: (path) => current.get(path)?.mode ?? null,
    saveApplyJournal: (value) => { saves.journal.push({ ...value }); },
    applyTransactionEntry: (_journal, entry) => {
      calls.marker = process.env.FOUNDATION_LAND_TRANSACTION;
      current.set(entry.path, { identity: entry.after, mode: entry.afterMode });
    },
    rollbackApplyTransaction: () => { calls.rollback += 1; },
    now: () => "now",
    fail,
    ...overrides.context
  };
  return { context, journal, current, calls, saves, getState: () => state };
}

try {
  assert.throws(() => assertLocalApply({ repositories: { root: {}, api: {} } }, {}, fail),
    /multi-repository/);
  assert.throws(() => assertLocalApply({ repositories: { api: {} } }, {}, fail),
    /multi-repository/);
  assert.doesNotThrow(() => assertLocalApply(
    { repositories: { root: {}, api: {} } }, { controlPlane: true }, fail));
  assert.equal(projectionHash(JSON.stringify, [{ path: "a", after: "x", afterMode: "1", extra: true }]),
    JSON.stringify([{ path: "a", after: "x", afterMode: "1" }]));
  assert.equal(projectionMismatch([{ path: "a", before: "old", beforeMode: "100" }], {
    safeRootPath: (path) => path,
    pathIdentity: () => "old",
    pathMode: () => "100"
  }, "before"), undefined);

  const archived = fixture({ context: { landCheck: () => ({ archived: true }) } });
  applySandboxOperation(archived.context, "c");
  assert.equal(archived.calls.recover, 1);
  assert.equal(archived.calls.prepare, 0);

  const multi = fixture({
    state: { repositories: { root: {}, api: {} }, workspace: { mode: "copy" } }
  });
  assert.throws(() => applySandboxOperation(multi.context, "c"), /multi-repository/);

  const refreshed = fixture({
    state: { id: "c", workspace: { mode: "copy", path: "/sandbox", applied: true } }
  });
  applySandboxOperation(refreshed.context, "c", { refresh: true });
  assert.equal(refreshed.calls.refresh, 1);

  const resumed = fixture({
    state: {
      id: "c",
      workspace: {
        mode: "copy", path: "/sandbox", applied: true,
        apply: {
          transactionId: "prior",
          projectionHash: JSON.stringify([{ path: "a", after: "new", afterMode: "200" }])
        }
      }
    }
  });
  applySandboxOperation(resumed.context, "c");
  assert.equal(resumed.calls.prepare, 0);

  const invalid = fixture({
    state: { id: "c", workspace: { mode: "copy", applied: true, apply: {} } },
    context: { verifyAppliedProjection: () => ({ valid: false, reason: "tampered" }) }
  });
  assert.throws(() => applySandboxOperation(invalid.context, "c"), /tampered/);

  const changed = fixture();
  changed.current.set("a", { identity: "other", mode: "100" });
  assert.throws(() => applySandboxOperation(changed.context, "c"), /target changed before apply/);
  assert.equal(changed.journal.status, "aborted");
  assert.equal(changed.journal.abortedAt, "now");

  delete process.env.FOUNDATION_LAND_TRANSACTION;
  const success = fixture();
  applySandboxOperation(success.context, "c");
  assert.equal(success.calls.marker, "1");
  assert.equal(process.env.FOUNDATION_LAND_TRANSACTION, undefined);
  assert.equal(success.getState().status, "applied");
  assert.equal(success.getState().workspace.targetPath, "/target");
  assert.deepEqual(success.getState().workspace.apply.touchedPaths, ["a"]);
  assert.equal(success.journal.status, "verified");

  process.env.FOUNDATION_LAND_TRANSACTION = "prior";
  const marker = fixture();
  applySandboxOperation(marker.context, "c");
  assert.equal(process.env.FOUNDATION_LAND_TRANSACTION, "prior");

  const mismatch = fixture({ context: { applyTransactionEntry: () => {} } });
  assert.throws(() => applySandboxOperation(mismatch.context, "c"),
    /post-apply projection mismatch.*transaction rolled back/);
  assert.equal(mismatch.calls.rollback, 1);

  const rollbackFailure = fixture({
    context: {
      applyTransactionEntry: () => { throw new Error("copy failed"); },
      rollbackApplyTransaction: () => { throw new Error("rollback failed"); }
    }
  });
  assert.throws(() => applySandboxOperation(rollbackFailure.context, "c"),
    /copy failed; rollback failed/);

  const state = appliedRuntimeState({ workspace: { mode: "worktree", path: "/s" } }, "/r", {
    transactionId: "t", projectionHash: "h", entries: []
  });
  assert.equal(state.workspace.sandboxPath, "/s");
  assert.equal(state.workspace.apply.status, "verified");

  assert.deepEqual(reapplyProjection({
    id: "c", state: { workspace: {} }, fail
  }), { prepared: null, resumed: false });
} finally {
  console.log = priorLog;
  if (priorMarker === undefined) delete process.env.FOUNDATION_LAND_TRANSACTION;
  else process.env.FOUNDATION_LAND_TRANSACTION = priorMarker;
}
