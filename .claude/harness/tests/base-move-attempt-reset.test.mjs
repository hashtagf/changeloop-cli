import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeBaseMoveAttemptsOperation,
  assertBaseMoveResetAllowed,
  assertNoLiveBaseMoveReview,
  baseMoveResetRecovery,
  baseMoveReleasedAttempt
} from "../runtime/evidence/review-attempt-store.mjs";

const fail = (message) => { throw new Error(message); };
const move = {
  movementKey: "move-1", preDiffIdentity: "before",
  postDiffIdentity: "after", at: "2026-08-20T12:00:00Z"
};

test("base-move reset is recommended only for an eligible recorded move", () => {
  assert.equal(baseMoveResetRecovery({}, "change"), "");
  assert.equal(baseMoveResetRecovery({ lastBaseMove: {
    ...move, postDiffIdentity: "before"
  } }, "change"), "");
  assert.match(baseMoveResetRecovery({ lastBaseMove: move }, "change"),
    /authority reset-base-move change/);
});

test("base-move reset rejects absent, unchanged, and reused authority", () => {
  assert.throws(() => assertBaseMoveResetAllowed({}, null, "decision", fail),
    /no sandbox sync base move/);
  assert.throws(() => assertBaseMoveResetAllowed({}, {
    ...move, postDiffIdentity: "before"
  }, "decision", fail), /diff unchanged/);
  assert.throws(() => assertBaseMoveResetAllowed({
    baseMoveResets: [{ movementKey: "move-1", decisionRef: "other" }]
  }, move, "decision", fail), /already released/);
  assert.throws(() => assertBaseMoveResetAllowed({
    baseMoveResets: [{ movementKey: "other", decisionRef: "decision" }]
  }, move, "decision", fail), /decision-ref was already used/);
  assert.doesNotThrow(() => assertBaseMoveResetAllowed({}, move, "decision", fail));
});

test("base-move reset refuses a live AI dispatch", () => {
  assert.doesNotThrow(() => assertNoLiveBaseMoveReview([
    { reviewerType: "human", status: "dispatched" },
    { reviewerType: "ai", status: "completed" }
  ], "change", fail));
  assert.throws(() => assertNoLiveBaseMoveReview([
    { reviewerType: "ai", status: "dispatched" }
  ], "change", fail), /authority abort change/);
});

test("released attempt is the latest passing verdict predating the move", () => {
  const current = {
    digest: "current", resultStatus: "pass", timestamp: "2026-08-20T10:00:00Z"
  };
  const legacy = {
    digest: "legacy", version: 1, status: "pass", timestamp: "2026-08-20T11:00:00Z"
  };
  assert.equal(baseMoveReleasedAttempt([
    current,
    { digest: "fail", resultStatus: "fail", timestamp: "2026-08-20T11:30:00Z" },
    legacy,
    { digest: "late", resultStatus: "pass", timestamp: "2026-08-20T13:00:00Z" }
  ], move, fail), legacy);
  assert.throws(() => baseMoveReleasedAttempt([
    { digest: "late", resultStatus: "pass", timestamp: "2026-08-20T13:00:00Z" }
  ], move, fail), /no delivered passing AI review/);
  assert.throws(() => baseMoveReleasedAttempt([], { ...move, at: "" }, fail),
    /no delivered passing AI review/);
});

function operationFixture() {
  const history = {
    chainHead: "head", baseMoveAcknowledged: ["prior"],
    baseMoveResets: [{ decisionRef: "prior-decision", movementKey: "prior-move" }]
  };
  const state = { lastBaseMove: move };
  const saves = [];
  const context = {
    loadRuntime: () => state,
    saveRuntime: (value) => saves.push(value),
    now: () => "reset-at",
    fail,
    reviewHistoryState: () => history,
    reviewHistoryChainValid: () => true,
    reviewAttempts: () => [],
    deliveredAiAttempts: () => [{
      digest: "passing", resultStatus: "pass", timestamp: "2026-08-20T10:00:00Z"
    }]
  };
  return { context, history, state, saves };
}

test("base-move operation records one released digest and movement", () => {
  const fixture = operationFixture();
  assert.deepEqual(acknowledgeBaseMoveAttemptsOperation(
    fixture.context, "change", "  decision:new  "), {
    changeId: "change", decisionRef: "decision:new",
    movementKey: "move-1", digests: ["passing"]
  });
  assert.deepEqual(fixture.state.reviewHistory.baseMoveAcknowledged,
    ["prior", "passing"]);
  assert.deepEqual(fixture.state.reviewHistory.baseMoveResets.at(-1), {
    decisionRef: "decision:new", movementKey: "move-1",
    digests: ["passing"], at: "reset-at"
  });
  assert.equal(fixture.saves.length, 1);
});

test("base-move operation validates authority and chain before mutation", () => {
  const missing = operationFixture();
  assert.throws(() => acknowledgeBaseMoveAttemptsOperation(
    missing.context, "change", null), /requires --decision-ref/);
  const corrupt = operationFixture();
  corrupt.context.reviewHistoryChainValid = () => false;
  assert.throws(() => acknowledgeBaseMoveAttemptsOperation(
    corrupt.context, "change", "decision"), /valid review attempt history/);
  assert.equal(corrupt.saves.length, 0);

  const noHead = operationFixture();
  noHead.history.chainHead = null;
  delete noHead.history.baseMoveAcknowledged;
  delete noHead.history.baseMoveResets;
  noHead.context.reviewHistoryChainValid = () => {
    throw new Error("must not validate empty chain");
  };
  assert.doesNotThrow(() => acknowledgeBaseMoveAttemptsOperation(
    noHead.context, "change", "decision"));
});
