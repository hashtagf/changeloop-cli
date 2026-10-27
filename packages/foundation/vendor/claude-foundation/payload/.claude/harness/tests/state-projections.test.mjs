import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveApplyProjection, deriveChangeProjection, STATE_PROJECTION_VERSION
} from "../runtime/core/state-projections.mjs";

test("change projection derives readiness instead of persisting another status", () => {
  const current = deriveChangeProjection({
    state: { status: "proven", schema: "rapid" },
    proof: { status: "pass", proofRunId: "run-1", workspaceHash: "hash-1" },
    currentHash: "hash-1"
  });
  assert.equal(current.version, STATE_PROJECTION_VERSION);
  assert.equal(current.readiness, "ready-to-land");
  assert.equal(current.proof.current, true);
  assert.equal(deriveChangeProjection({
    state: { status: "proven" }, proof: { status: "pass", workspaceHash: "old" },
    currentHash: "new"
  }).readiness, "stale-proof");
  assert.equal(deriveChangeProjection({ state: {} }).readiness, "untracked");
});

test("apply projection derives journal facts and validates legacy runtime mirrors", () => {
  const state = { workspace: { apply: { transactionId: "tx-1", projectionHash: "p-1" } } };
  const journal = {
    transactionId: "tx-1", projectionHash: "p-1", status: "verified",
    entries: [{ path: "src/a.js" }, { path: "src/b.js" }]
  };
  assert.deepEqual(deriveApplyProjection(state, journal), {
    version: 1, valid: true, reason: null, transactionId: "tx-1",
    projectionHash: "p-1", status: "verified",
    touchedPaths: ["src/a.js", "src/b.js"]
  });
  assert.equal(deriveApplyProjection(state, { ...journal, projectionHash: "other" }).reason,
    "projection-identity-mismatch");
  assert.equal(deriveApplyProjection(state, { ...journal, transactionId: "tx-2" }).reason,
    "transaction-identity-mismatch");
  assert.equal(deriveApplyProjection({}, journal).reason, "missing-apply-transaction");
});
