import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReviewDispatchHistory,
  reviewDispatchAttemptValue,
  reviewDispatchScope,
  reviewDispatchType,
  reviewHistoryAfterDispatch,
  validateReviewDispatchBudget
} from "../runtime/evidence/review-attempt-store.mjs";

const fail = (message) => { throw new Error(message); };

test("review dispatch history allows clean chains and blocks corrupt chains", () => {
  let checks = 0;
  const context = {
    reviewHistoryChainValid: () => { checks += 1; return true; },
    blockWithDecision: () => assert.fail("valid chain must not block")
  };
  assertReviewDispatchHistory(context, "change-a", {});
  assert.equal(checks, 0);
  assertReviewDispatchHistory(context, "change-a", { chainHead: "head" });
  assert.equal(checks, 1);
  assert.throws(() => assertReviewDispatchHistory({
    reviewHistoryChainValid: () => false,
    blockWithDecision: (_id, kind, details) => {
      assert.equal(kind, "review-history-corrupt");
      assert.equal(details.attemptsRecorded, 3);
      throw new Error(kind);
    }
  }, "change-a", { chainHead: "bad", totalAttempts: 3 }), /review-history-corrupt/);
});

test("review dispatch type normalizes AI and human and rejects other values", () => {
  assert.equal(reviewDispatchType({ reviewerType: "AI" }, fail), "ai");
  assert.equal(reviewDispatchType({ reviewerType: "human" }, fail), "human");
  assert.throws(() => reviewDispatchType({}, fail), /reviewerType ai\|human/);
  assert.throws(() => reviewDispatchType({ reviewerType: "bot" }, fail),
    /reviewerType ai\|human/);
});

test("review dispatch budget applies only to AI delivery and infrastructure limits", () => {
  const quiet = {
    blockAiExhausted: () => assert.fail("human budget is not bounded here"),
    fail: () => assert.fail("human budget is not bounded here")
  };
  validateReviewDispatchBudget(quiet, "change-a", "human", {}, {}, [1, 2], [1, 2]);
  assert.throws(() => validateReviewDispatchBudget({
    blockAiExhausted: () => { throw new Error("exhausted"); }, fail
  }, "change-a", "ai", {}, { maxAiAttempts: 2 }, [1, 2], []), /exhausted/);
  assert.throws(() => validateReviewDispatchBudget({
    blockAiExhausted: () => {}, fail
  }, "change-a", "ai", {}, { maxInfrastructureRetries: 0 }, [], [1]),
  /REVIEW_INFRASTRUCTURE_ERROR/);
  assert.doesNotThrow(() => validateReviewDispatchBudget({
    blockAiExhausted: () => {}, fail
  }, "change-a", "ai", {}, {}, [], [1]));
});

test("review dispatch scope enforces the AI full then delta state machine", () => {
  assert.equal(reviewDispatchScope({ scope: { mode: "full" } },
    "human", [], [], fail), "full");
  assert.equal(reviewDispatchScope({ scope: { mode: "delta" } },
    "human", [], [], fail), "delta");
  assert.throws(() => reviewDispatchScope({ scope: {} },
    "human", [], [], fail), /scope must be full\|delta/);
  assert.equal(reviewDispatchScope({ scope: { mode: "full" } },
    "ai", [], [], fail), "full");
  assert.throws(() => reviewDispatchScope({ scope: { mode: "delta" } },
    "ai", [], [], fail), /requires --scope full/);
  assert.throws(() => reviewDispatchScope({
    scope: { mode: "full", baseAttemptDigest: "attempt-1" }
  }, "ai", [], [], fail), /must not declare --base-attempt/);
  const completed = [{ digest: "attempt-1" }];
  assert.equal(reviewDispatchScope({
    scope: { mode: "delta", baseAttemptDigest: "attempt-1" }
  }, "ai", completed, completed, fail), "delta");
  assert.throws(() => reviewDispatchScope({
    scope: { mode: "delta", baseAttemptDigest: "wrong" }
  }, "ai", completed, completed, fail), /must reference the first AI dispatch/);
});

function attemptDetails(overrides = {}) {
  return {
    reviewerIdentity: "reviewer-one",
    reviewerProviderFamily: "openai",
    reviewerModelFamily: "gpt",
    reviewerModelId: "gpt-5.6",
    reviewerSessionId: "session-one",
    sessionDeferred: true,
    requestId: "request-one",
    workspaceHash: "workspace-one",
    scope: {
      baseAttemptDigest: "attempt-zero",
      paths: ["b.mjs", "a.mjs", "a.mjs"], digest: "scope-digest"
    },
    packetDigest: "packet-digest",
    ...overrides
  };
}

test("review dispatch attempt normalizes identity, scope, defaults, and digest", () => {
  const context = { now: () => "now", stableHash: () => "digest", fail };
  const attempt = reviewDispatchAttemptValue(context, "change-a", attemptDetails(),
    { totalAttempts: 2, chainHead: "prior" }, "ai", "delta");
  assert.equal(attempt.attempt, 3);
  assert.equal(attempt.digest, "digest");
  assert.deepEqual(attempt.scope.paths, ["a.mjs", "b.mjs"]);
  assert.equal(attempt.priorChainHead, "prior");
  const minimal = reviewDispatchAttemptValue(context, "change-a", attemptDetails({
    reviewerProviderFamily: undefined, reviewerModelFamily: undefined,
    reviewerModelId: undefined, reviewerSessionId: undefined,
    sessionDeferred: false,
    scope: { paths: undefined }, packetDigest: undefined
  }), {}, "human", "full");
  assert.equal(minimal.reviewerProviderFamily, null);
  assert.equal(minimal.scope.baseAttemptDigest, null);
  assert.deepEqual(minimal.scope.paths, []);
  assert.equal(minimal.packetDigest, null);
});

test("review dispatch attempt requires identity, request, and workspace", () => {
  const context = { now: () => "now", stableHash: () => "digest", fail };
  for (const field of ["reviewerIdentity", "requestId", "workspaceHash"])
    assert.throws(() => reviewDispatchAttemptValue(context, "change-a",
      attemptDetails({ [field]: "" }), {}, "human", "full"),
    /requires reviewer identity, request, and workspace hash/);
});

test("review dispatch history increments only AI attempts", () => {
  const attempt = { attempt: 4, digest: "digest" };
  assert.equal(reviewHistoryAfterDispatch({}, attempt, "ai").aiAttempts, 1);
  assert.equal(reviewHistoryAfterDispatch({ aiAttempts: 2 }, attempt, "human").aiAttempts, 2);
  assert.equal(reviewHistoryAfterDispatch({}, attempt, "human").totalAttempts, 4);
});
