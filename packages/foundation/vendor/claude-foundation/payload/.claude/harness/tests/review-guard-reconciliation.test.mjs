import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createReviewAttemptStore,
  reviewHistoryAttemptValid,
  reviewHistoryChainValidOperation
} from "../runtime/evidence/review-attempt-store.mjs";
import { createReviewProtocol } from "../runtime/evidence/review-protocol.mjs";
import { createAuthorityRuntime } from "../runtime/workflow/authority-runtime.mjs";

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");
const readJson = (path, fallback = undefined) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (fallback !== undefined) return fallback; throw error; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const fail = (message) => { throw new Error(message); };
const now = () => "2026-08-16T12:00:00.000Z";

function chainValid(attempts, history, id = "change-a") {
  return reviewHistoryChainValidOperation({
    reviewAttemptByDigest: (_changeId, digest) => attempts.get(digest) || null
  }, id, history);
}

{
  assert.equal(reviewHistoryAttemptValid(null, "change-a", 1), false);
  assert.equal(reviewHistoryAttemptValid({
    attempt: 1, changeId: "change-a"
  }, "change-a", 1), true);
  assert.equal(reviewHistoryAttemptValid({
    attempt: 2, changeId: "change-a"
  }, "change-a", 1), false);
  assert.equal(reviewHistoryAttemptValid({
    attempt: 1, changeId: "change-b"
  }, "change-a", 1), false);
  assert.equal(chainValid(new Map(), { chainHead: null, totalAttempts: 0 }), true);
  const valid = new Map([
    ["second", { attempt: 2, changeId: "change-a", priorChainHead: "first" }],
    ["first", { attempt: 1, changeId: "change-a", priorChainHead: null }]
  ]);
  assert.equal(chainValid(valid, { chainHead: "second", totalAttempts: 2 }), true);
  assert.equal(chainValid(new Map(), { chainHead: "missing", totalAttempts: 1 }), false);
  assert.equal(chainValid(new Map([["wrong", {
    attempt: 2, changeId: "change-a", priorChainHead: null
  }]]), { chainHead: "wrong", totalAttempts: 1 }), false);
  assert.equal(chainValid(new Map([["foreign", {
    attempt: 1, changeId: "change-b", priorChainHead: null
  }]]), { chainHead: "foreign", totalAttempts: 1 }), false);
  assert.equal(chainValid(new Map([["cycle", {
    attempt: 1, changeId: "change-a", priorChainHead: "cycle"
  }]]), { chainHead: "cycle", totalAttempts: 1 }), false);
  assert.equal(chainValid(new Map([["migrated", {
    attempt: 3, changeId: "change-a", priorChainHead: null, migrated: true
  }]]), { chainHead: "migrated", totalAttempts: 3 }), true);
  assert.equal(chainValid(new Map([["gap", {
    attempt: 3, changeId: "change-a", priorChainHead: null
  }]]), { chainHead: "gap", totalAttempts: 3 }), false);
  const oversized = new Map();
  for (let attempt = 1; attempt <= 1002; attempt += 1) {
    oversized.set(`attempt-${attempt}`, {
      attempt,
      changeId: "change-a",
      priorChainHead: attempt === 1 ? null : `attempt-${attempt - 1}`
    });
  }
  assert.equal(chainValid(oversized, {
    chainHead: "attempt-1002", totalAttempts: 1002
  }), false, "review history traversal is bounded even for a valid-shaped chain");
}

function fixture(id) {
  const root = mkdtempSync(join(tmpdir(), "foundation-guard-reconcile-"));
  const receiptsRoot = join(root, ".foundation", "receipts");
  const evidenceVault = join(root, ".foundation", "evidence");
  const receiptPath = (changeId, provider) =>
    join(receiptsRoot, changeId, `${provider}.json`);
  let state = { id, changeId: id, status: "proving", reviewHistory: null };
  const protocol = createReviewProtocol({ stableHash, fail });
  const store = createReviewAttemptStore({
    receiptsRoot, evidenceVault, readJson, writeJson,
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    stableHash, reviewReceiptBinding: protocol.receiptBinding, now,
    blockWithDecision: (_changeId, kind) => fail(kind), fail
  });
  const authority = createAuthorityRuntime({
    root,
    readJson,
    receiptPath,
    reviewAttempts: store.reviewAttempts,
    deliveredAiAttempts: store.deliveredAiAttempts,
    stableHash,
    now,
    fail
  });
  const dispatchAi = (n, scope) => store.dispatchReviewAttempt(id, {
    reviewerType: "ai", reviewerIdentity: `reviewer-${n}`,
    reviewerProviderFamily: "openai", reviewerModelFamily: "gpt",
    reviewerModelId: "gpt-x", reviewerSessionId: `session-${n}`,
    requestId: `request-${n}`, workspaceHash: `workspace-${n}`,
    scope, packetDigest: `packet-${n}`, maxAiAttempts: 2,
    maxInfrastructureRetries: 1
  });
  const recordReceipt = (attempt) => writeJson(receiptPath(id, "review"), {
    version: 7, changeId: id, provider: "review", status: "pass",
    workspaceHash: attempt.workspaceHash,
    review: { attemptDigest: attempt.digest }
  });
  return {
    root, store, authority, dispatchAi, recordReceipt,
    unrecorded: () => authority.unrecordedDeliveredAiResponse(
      id, state.reviewHistory, "review"),
    history: () => state.reviewHistory
  };
}

{
  const id = "case-legacy-migration";
  const root = mkdtempSync(join(tmpdir(), "foundation-review-migration-"));
  const receiptsRoot = join(root, "receipts");
  const evidenceVault = join(root, "evidence");
  let state = { id, status: "proving", reviewHistory: null };
  const protocol = createReviewProtocol({ stableHash, fail });
  const legacyReceipt = {
    version: 6,
    changeId: id,
    provider: "review",
    status: "pass",
    workspaceHash: "workspace-legacy",
    review: { round: 3, reviewer: { type: "human" } }
  };
  writeJson(join(receiptsRoot, id, "review.json"), legacyReceipt);
  writeJson(join(receiptsRoot, id, "proof.json"), {
    review: { round: 99, reviewer: { type: "ai" } }
  });
  writeFileSync(join(receiptsRoot, id, "ignored.txt"), "not a receipt\n");
  mkdirSync(join(receiptsRoot, id, "nested.json"));
  const store = createReviewAttemptStore({
    receiptsRoot, evidenceVault, readJson, writeJson,
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    stableHash,
    reviewReceiptBinding: protocol.receiptBinding,
    now,
    blockWithDecision: (_changeId, kind) => fail(kind),
    fail
  });
  const history = store.reviewHistoryState(id);
  assert.equal(history.totalAttempts, 3);
  assert.equal(history.aiAttempts, 2);
  assert.equal(history.migratedFromReceiptDigest, stableHash(legacyReceipt));
  assert.match(history.chainHead, /^[a-f0-9]{64}$/);
  const attempt = store.reviewAttemptByDigest(id, history.chainHead);
  assert.equal(attempt.migrated, true);
  assert.equal(attempt.attempt, 3);
  assert.equal(attempt.reviewerType, "human");
  assert.equal(attempt.workspaceHash, "workspace-legacy");
  assert.equal(attempt.status, "pass");
  assert.equal(attempt.migratedFromReceiptDigest, stableHash(legacyReceipt));
  assert.strictEqual(store.reviewHistoryState(id), history,
    "a migrated current history is reused without another artifact");

  const sparseId = "case-sparse-legacy-migration";
  state = { id: sparseId, status: "proving", reviewHistory: null };
  const sparseReceipt = {
    version: 5, changeId: sparseId, provider: "review", review: {}
  };
  writeJson(join(receiptsRoot, sparseId, "review.json"), sparseReceipt);
  const sparseHistory = store.reviewHistoryState(sparseId);
  assert.equal(sparseHistory.totalAttempts, 0);
  assert.equal(sparseHistory.aiAttempts, 0);
  assert.match(sparseHistory.chainHead, /^[a-f0-9]{64}$/);
  const sparseAttempt = store.reviewAttemptByDigest(sparseId, sparseHistory.chainHead);
  assert.equal(sparseAttempt.attempt, 1);
  assert.equal(sparseAttempt.reviewerType, "unknown");
  assert.equal(sparseAttempt.workspaceHash, null);
  assert.equal(sparseAttempt.status, null);
  assert.equal(sparseAttempt.migratedFromReceiptDigest, stableHash(sparseReceipt));
  rmSync(root, { recursive: true, force: true });
}

// Case 1 — receipt overwrite: a recorded delta receipt replaces the full
// receipt's attempt digest; the earlier delivered attempt must not read as
// unrecorded.
{
  const id = "case-receipt-overwrite";
  const world = fixture(id);
  const full = world.dispatchAi(1, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-full"
  });
  const fullDone = world.store.completeReviewAttempt(id, full.digest, {
    reviewerSessionId: "session-1", resultStatus: "fail",
    findings: [{
      id: "F1", severity: "major", path: "a.mjs", line: 1, message: "defect"
    }],
    verifiedFindingIds: []
  });
  world.recordReceipt(fullDone);
  assert.equal(world.unrecorded(), null,
    "a recorded full receipt leaves nothing unrecorded");
  const delta = world.dispatchAi(2, {
    mode: "delta", baseAttemptDigest: fullDone.digest,
    paths: ["root/a.mjs"], digest: "scope-delta"
  });
  const deltaDone = world.store.completeReviewAttempt(id, delta.digest, {
    reviewerSessionId: "session-2", resultStatus: "pass",
    findings: [], verifiedFindingIds: ["F1"]
  });
  assert.ok(world.unrecorded(),
    "the delta response is unrecorded until its receipt lands");
  world.recordReceipt(deltaDone);
  assert.equal(world.unrecorded(), null,
    "the delta receipt overwriting the full receipt must not block the change");
}

// Case 2 — human supersede: a later recorded human review replaces the AI
// attempt digest in the receipt; the earlier AI response stays recorded.
{
  const id = "case-human-supersede";
  const world = fixture(id);
  const full = world.dispatchAi(1, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-full"
  });
  const fullDone = world.store.completeReviewAttempt(id, full.digest, {
    reviewerSessionId: "session-1", resultStatus: "pass",
    findings: [], verifiedFindingIds: []
  });
  world.recordReceipt(fullDone);
  const human = world.store.dispatchReviewAttempt(id, {
    reviewerType: "human", reviewerIdentity: "reviewer-human",
    reviewerSessionId: "human-session", sessionDeferred: false,
    requestId: "request-h", workspaceHash: "workspace-h",
    scope: { mode: "full", paths: ["root/a.mjs"], digest: "scope-h" },
    packetDigest: "packet-h"
  });
  const humanDone = world.store.completeReviewAttempt(id, human.digest, {
    reviewerSessionId: "human-session", resultStatus: "pass",
    findings: [], verifiedFindingIds: []
  });
  world.recordReceipt(humanDone);
  assert.equal(world.unrecorded(), null,
    "a newer recorded human receipt supersedes the AI receipt without blocking");
}

// Case 3 — errored completion: an AI attempt that completed with
// resultStatus "error" never gains a receipt and must not read as an
// unrecorded delivered response.
{
  const id = "case-error-attempt";
  const world = fixture(id);
  const full = world.dispatchAi(1, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-full"
  });
  world.store.completeReviewAttempt(id, full.digest, {
    reviewerSessionId: "session-1", resultStatus: "error",
    findings: [], verifiedFindingIds: []
  });
  assert.equal(world.store.deliveredAiAttempts(id, world.history()).length, 0,
    "an errored completion is not a delivered response");
  assert.equal(world.unrecorded(), null,
    "an errored completion must not block dispatch as unrecorded");
}

// Case 4 — true positive: a delivered AI response with no recorded receipt
// still reads as unrecorded.
{
  const id = "case-true-positive";
  const world = fixture(id);
  const full = world.dispatchAi(1, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-full"
  });
  const done = world.store.completeReviewAttempt(id, full.digest, {
    reviewerSessionId: "session-1", resultStatus: "pass",
    findings: [], verifiedFindingIds: []
  });
  assert.equal(world.unrecorded()?.digest, done.digest,
    "a delivered response with no receipt must still block");
}

// Case 5 — infrastructure reset: consumed retries block dispatch, an
// acknowledged reset restores it, a reused decision-ref refuses, and later
// dispatches keep the acknowledgment.
{
  const id = "case-infra-reset";
  const world = fixture(id);
  for (const n of [1, 2]) {
    const attempt = world.dispatchAi(n, {
      mode: "full", paths: ["root/a.mjs"], digest: `scope-${n}`
    });
    world.store.completeReviewAttempt(id, attempt.digest, {
      reviewerSessionId: `session-${n}`, resultStatus: "error",
      findings: [], verifiedFindingIds: []
    });
  }
  assert.equal(
    world.store.infrastructureAiAttempts(id, world.history()).length, 2);
  assert.throws(() => world.dispatchAi(3, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-3"
  }), /REVIEW_INFRASTRUCTURE_ERROR/,
  "exhausted infrastructure retries refuse another dispatch");
  const reset = world.store.acknowledgeInfrastructureAttempts(id, "decision-1");
  assert.equal(reset.digests.length, 2);
  assert.equal(
    world.store.infrastructureAiAttempts(id, world.history()).length, 0,
    "acknowledged attempts stop consuming the retry bound");
  assert.throws(() =>
    world.store.acknowledgeInfrastructureAttempts(id, "decision-1"),
  /already used/, "a decision-ref cannot be reused");
  const retried = world.dispatchAi(4, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-4"
  });
  assert.equal(retried.status, "dispatched",
    "dispatch is restored after the reset");
  assert.equal((world.history().infraAcknowledged || []).length, 2,
    "a later dispatch preserves the acknowledgment bookkeeping");
  assert.equal(
    world.store.infrastructureAiAttempts(id, world.history()).length, 1,
    "only the new in-flight attempt counts after the reset");
  // A still-dispatched attempt is a live or indeterminate review; a reset
  // must never acknowledge it and reopen capacity around the bounded circuit.
  assert.throws(() =>
    world.store.acknowledgeInfrastructureAttempts(id, "decision-2"),
  /still dispatched/,
  "a reset is refused outright while any AI attempt is in flight");
  assert.equal((world.history().infraAcknowledged || []).length, 2,
    "the refused reset acknowledges nothing");
}

// Case 6 — reset eligibility: with only an in-flight dispatch, reset refuses;
// once that dispatch completes as an infrastructure error, it acknowledges.
{
  const id = "case-inflight-reset";
  const world = fixture(id);
  const attempt = world.dispatchAi(1, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-1"
  });
  assert.throws(() =>
    world.store.acknowledgeInfrastructureAttempts(id, "decision-1"),
  /still dispatched/);
  world.store.completeReviewAttempt(id, attempt.digest, {
    reviewerSessionId: "session-1", resultStatus: "error",
    findings: [], verifiedFindingIds: []
  });
  const reset = world.store.acknowledgeInfrastructureAttempts(id, "decision-1");
  assert.equal(reset.digests.length, 1,
    "the completed infrastructure error becomes acknowledgeable");
}

// Case 7 — completed error beside a live dispatch: the reset refuses; once
// the live attempt also completes as an infrastructure error, both
// acknowledge together and nothing is stranded off the chain head.
{
  const id = "case-error-plus-live";
  const world = fixture(id);
  const first = world.dispatchAi(1, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-1"
  });
  world.store.completeReviewAttempt(id, first.digest, {
    reviewerSessionId: "session-1", resultStatus: "error",
    findings: [], verifiedFindingIds: []
  });
  const second = world.dispatchAi(2, {
    mode: "full", paths: ["root/a.mjs"], digest: "scope-2"
  });
  assert.throws(() =>
    world.store.acknowledgeInfrastructureAttempts(id, "decision-1"),
  /still dispatched/,
  "a completed error beside a live dispatch is not resettable");
  world.store.completeReviewAttempt(id, second.digest, {
    reviewerSessionId: "session-2", resultStatus: "error",
    findings: [], verifiedFindingIds: []
  });
  const reset = world.store.acknowledgeInfrastructureAttempts(id, "decision-1");
  assert.equal(reset.digests.length, 2,
    "both completed errors acknowledge once nothing is in flight");
}

console.log("review-guard-reconciliation: all cases passed");
