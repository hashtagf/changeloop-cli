import assert from "node:assert/strict";
import test from "node:test";

import {
  completeReviewAttemptOperation,
  completedReviewAttemptValue,
  createRepairClosureAttempt,
  matchingRepairClosure,
  normalizeReviewCompletionFindings,
  recordRepairClosureAttemptOperation,
  repairClosureSource,
  repairClosureVerifiedFindingIds,
  reviewCompletionIdentity,
  validateFinalReviewFindings,
  validateReviewCompletionFindings
} from "../runtime/evidence/review-attempt-store.mjs";

const hash = (value) => JSON.stringify(value);
const fail = (message) => { throw new Error(message); };
const source = {
  digest: "ai-final", resultStatus: "fail", workspaceHash: "before",
  scope: { mode: "delta" }, packetDigest: "packet",
  findings: [
    { id: "F-2", severity: "major" },
    { id: "F-1", severity: "blocker" },
    { id: "F-3", severity: "minor" }
  ]
};
const details = {
  sourceAttemptDigest: "ai-final", workspaceHash: "after",
  scopeDigest: "scope", paths: ["b.js", "a.js", "b.js"],
  verifiedFindingIds: ["F-2", "F-1", "F-1"],
  evidenceBindings: [{ provider: "test", digest: "evidence" }]
};

test("review completion normalizes finding identity and bindings", () => {
  const findings = normalizeReviewCompletionFindings({ findings: [{
    id: " F-1 ", severity: "MAJOR", path: "app.mjs", line: "2",
    message: " defect ", claimIds: [" c2 ", "c1", "c1", ""],
    verificationCaseIds: ["CASE-B", "CASE-A", "CASE-A"]
  }, {
    id: "F-2", severity: "minor", message: "note", line: undefined
  }] });
  assert.deepEqual(findings[0], {
    id: "F-1", severity: "major", path: "app.mjs", line: 2,
    message: "defect", claimIds: ["c1", "c2"],
    verificationCaseIds: ["CASE-A", "CASE-B"]
  });
  assert.equal(findings[1].line, null);
  assert.deepEqual(findings[1].claimIds, []);
  assert.deepEqual(normalizeReviewCompletionFindings({}), []);
});

test("review completion enforces reviewer session identity", () => {
  const ai = { reviewerType: "ai", reviewerSessionId: "session", sessionDeferred: false };
  assert.deepEqual(reviewCompletionIdentity(ai, {
    resultStatus: "pass", reviewerSessionId: " session "
  }, fail), { resultStatus: "pass", sessionId: "session" });
  assert.throws(() => reviewCompletionIdentity(ai, {
    resultStatus: "pass"
  }, fail), /actual reviewer session ID/);
  assert.throws(() => reviewCompletionIdentity(ai, {
    resultStatus: "error", reviewerSessionId: "other"
  }, fail), /does not match/);
  assert.deepEqual(reviewCompletionIdentity({
    reviewerType: "ai", sessionDeferred: true
  }, { resultStatus: "error" }, fail), { resultStatus: "error", sessionId: "" });
});

test("review completion validates statuses, IDs, fields, and passing findings", () => {
  const minor = [{
    id: "F-1", severity: "minor", message: "note", line: null,
    path: "", claimIds: [], verificationCaseIds: []
  }];
  assert.doesNotThrow(() => validateReviewCompletionFindings("pass", minor, fail));
  assert.throws(() => validateReviewCompletionFindings("unknown", [], fail), /non-empty and unique/);
  assert.throws(() => validateReviewCompletionFindings("fail", [
    { ...minor[0], id: "" }
  ], fail), /non-empty and unique/);
  assert.throws(() => validateReviewCompletionFindings("fail", [minor[0], minor[0]], fail),
    /non-empty and unique/);
  for (const invalid of [
    { severity: "unknown" }, { message: "" }, { line: 0 }, { line: 1.5 }
  ]) assert.throws(() => validateReviewCompletionFindings("fail", [
    { ...minor[0], ...invalid }
  ], fail), /valid severity/);
  assert.throws(() => validateReviewCompletionFindings("pass", [
    { ...minor[0], severity: "major" }
  ], fail), /passing review/);
});

test("final delta findings require deterministic closure bindings", () => {
  const complete = [{
    id: "F-1", severity: "major", message: "defect", line: 1,
    path: "app.mjs", claimIds: ["claim"], verificationCaseIds: ["CASE"]
  }];
  assert.deepEqual(validateFinalReviewFindings("fail", complete, [{}], fail), complete);
  assert.deepEqual(validateFinalReviewFindings("fail", complete, [], fail), []);
  assert.deepEqual(validateFinalReviewFindings("pass", complete, [{}], fail), []);
  for (const invalid of [
    { path: "" }, { claimIds: [] }, { verificationCaseIds: [] }
  ]) assert.throws(() => validateFinalReviewFindings("fail", [
    { ...complete[0], ...invalid }
  ], [{}], fail), /must name a path/);
});

test("completed review builder replaces dispatch identity immutably", () => {
  const completed = completedReviewAttemptValue({
    now: () => "now", stableHash: () => "completed-digest"
  }, {
    version: 2, digest: "dispatch-digest", attempt: 1,
    reviewerSessionId: "old"
  }, {
    verifiedFindingIds: [" F-2 ", "F-1", "F-1", ""]
  }, "pass", "session", []);
  assert.equal(completed.version, 3);
  assert.equal(completed.status, "completed");
  assert.equal(completed.digest, "completed-digest");
  assert.equal(completed.reviewerSessionId, "session");
  assert.deepEqual(completed.verifiedFindingIds, ["F-1", "F-2"]);
  assert.equal(completed.completedAt, "now");
});

function completionOperationFixture(overrides = {}) {
  const state = {};
  const writes = [];
  const saves = [];
  const dispatched = {
    version: 2, status: "dispatched", digest: "dispatch", attempt: 1,
    reviewerType: "ai", reviewerSessionId: "session", sessionDeferred: false
  };
  return {
    state, writes, saves, dispatched,
    context: {
      evidenceVault: "/vault",
      loadRuntime: () => state,
      saveRuntime: (value) => saves.push(value),
      reviewHistoryState: () => ({ chainHead: "dispatch", totalAttempts: 1 }),
      reviewAttemptByDigest: () => dispatched,
      deliveredAiAttempts: () => [],
      writeJson: (...args) => writes.push(args),
      now: () => "now",
      stableHash: () => "completed-digest",
      fail,
      ...overrides
    }
  };
}

test("completion operation rejects stale heads and invalid dispatch records", () => {
  const stale = completionOperationFixture({
    reviewHistoryState: () => ({ chainHead: "other" })
  });
  assert.throws(() => completeReviewAttemptOperation(stale.context,
    "change", "dispatch", {}), /current dispatched attempt/);
  for (const invalid of [null, { version: 1, status: "dispatched" }, {
    version: 2, status: "completed"
  }]) {
    const fixture = completionOperationFixture({ reviewAttemptByDigest: () => invalid });
    assert.throws(() => completeReviewAttemptOperation(fixture.context,
      "change", "dispatch", {}), /valid dispatched attempt/);
  }
});

test("completion operation persists the completed immutable chain head", () => {
  const fixture = completionOperationFixture();
  const completed = completeReviewAttemptOperation(fixture.context,
    "change", "dispatch", {
      resultStatus: "pass", reviewerSessionId: "session",
      findings: [], verifiedFindingIds: []
    });
  assert.equal(completed.digest, "completed-digest");
  assert.match(fixture.writes[0][0], /0001-completed-di\.json$/);
  assert.equal(fixture.state.reviewHistory.chainHead, "completed-digest");
  assert.equal(fixture.saves.length, 1);
});

test("matching repair closure requires the complete deterministic identity", () => {
  const current = {
    reviewerType: "deterministic", sourceAttemptDigest: "ai-final",
    workspaceHash: "after", scope: { digest: "scope" },
    evidenceBindings: details.evidenceBindings
  };
  assert.equal(matchingRepairClosure(current, details, hash), current);
  for (const changed of [
    { reviewerType: "ai" }, { sourceAttemptDigest: "other" },
    { workspaceHash: "other" }, { scope: { digest: "other" } },
    { evidenceBindings: [] }
  ]) assert.equal(matchingRepairClosure({ ...current, ...changed }, details, hash), null);
});

test("repair closure source requires the failed second AI delta and changed workspace", () => {
  assert.equal(repairClosureSource([{ digest: "first" }, source], details, fail), source);
  const invalid = [
    [[source], details],
    [[{}, { ...source, digest: "other" }], details],
    [[{}, { ...source, resultStatus: "pass" }], details],
    [[{}, { ...source, scope: { mode: "full" } }], details]
  ];
  for (const [delivered, value] of invalid)
    assert.throws(() => repairClosureSource(delivered, value, fail), /failed final AI delta/);
  assert.throws(() => repairClosureSource([{}, source], {
    ...details, workspaceHash: "before"
  }, fail), /changed workspace/);
});

test("verified findings close every blocker and major exactly once", () => {
  assert.deepEqual(repairClosureVerifiedFindingIds(source, details, fail), ["F-1", "F-2"]);
  assert.throws(() => repairClosureVerifiedFindingIds(source, {
    ...details, verifiedFindingIds: ["F-1"]
  }, fail), /close every blocker\/major/);
  assert.throws(() => repairClosureVerifiedFindingIds({
    ...source, findings: [{ id: "minor", severity: "minor" }]
  }, details, fail), /close every blocker\/major/);
});

test("repair closure builder emits the versioned immutable record", () => {
  let tick = 0;
  const attempt = createRepairClosureAttempt({
    now: () => ++tick,
    stableHash: () => "digest"
  }, "change", { totalAttempts: 2, chainHead: "head" }, source, details,
  ["F-1", "F-2"]);
  assert.equal(attempt.version, 4);
  assert.equal(attempt.attempt, 3);
  assert.equal(attempt.digest, "digest");
  assert.deepEqual(attempt.scope.paths, ["a.js", "b.js"]);
  assert.equal(attempt.packetDigest, "packet");
  assert.equal(attempt.priorChainHead, "head");
  assert.equal(attempt.timestamp, 1);
  assert.equal(attempt.completedAt, 2);
  const defaults = createRepairClosureAttempt({
    now: () => 1, stableHash: () => "default"
  }, "change", {}, { ...source, packetDigest: "" }, {
    ...details, paths: undefined
  }, []);
  assert.equal(defaults.attempt, 1);
  assert.equal(defaults.packetDigest, null);
  assert.equal(defaults.priorChainHead, null);
});

function operationFixture() {
  const state = {};
  const writes = [];
  const saves = [];
  const history = { totalAttempts: 2, chainHead: "head" };
  const context = {
    evidenceVault: "/vault",
    loadRuntime: () => state,
    saveRuntime: (value) => saves.push(value),
    stableHash: (value) => value?.version === 4 ? "closure-digest" : hash(value),
    writeJson: (...args) => writes.push(args),
    now: () => 10,
    fail,
    reviewHistoryState: () => history,
    reviewHistoryChainValid: () => true,
    reviewAttempts: () => [{ reviewerType: "ai" }],
    deliveredAiAttempts: () => [{ digest: "first" }, source]
  };
  return { context, state, writes, saves, history };
}

test("repair closure operation persists the next chained attempt", () => {
  const fixture = operationFixture();
  const attempt = recordRepairClosureAttemptOperation(
    fixture.context, "change", details);
  assert.equal(attempt.digest, "closure-digest");
  assert.match(fixture.writes[0][0], /0003-closure-dige\.json$/);
  assert.equal(fixture.state.reviewHistory.totalAttempts, 3);
  assert.equal(fixture.state.reviewHistory.chainHead, "closure-digest");
  assert.equal(fixture.saves.length, 1);
});

test("repair closure operation preserves idempotency and fails closed", () => {
  const duplicate = operationFixture();
  const current = {
    reviewerType: "deterministic", sourceAttemptDigest: "ai-final",
    workspaceHash: "after", scope: { digest: "scope" },
    evidenceBindings: details.evidenceBindings
  };
  duplicate.context.reviewAttempts = () => [current];
  assert.equal(recordRepairClosureAttemptOperation(
    duplicate.context, "change", details), current);
  assert.equal(duplicate.writes.length, 0);

  const corrupt = operationFixture();
  corrupt.context.reviewHistoryChainValid = () => false;
  assert.throws(() => recordRepairClosureAttemptOperation(
    corrupt.context, "change", details), /valid attempt history/);

  const missing = operationFixture();
  assert.throws(() => recordRepairClosureAttemptOperation(
    missing.context, "change", { ...details, evidenceBindings: [] }),
  /current evidence bindings/);
});
