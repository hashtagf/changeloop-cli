import assert from "node:assert/strict";
import test from "node:test";

import {
  currentRepairProviders,
  deterministicClosureIsBound,
  deterministicRepairClosureValue,
  deterministicReviewClosureSource,
  recordDeterministicReviewClosureOperation,
  repairClosureBindingsComplete,
  repairClosureEvidenceBindings,
  uniqueRepairEvidenceBindings
} from "../runtime/evidence/receipt-runtime.mjs";

const finalDelta = {
  digest: "attempt-2",
  resultStatus: "fail",
  scope: { mode: "delta" }
};

test("deterministic closure source requires two attempts and a failed final delta", () => {
  assert.equal(deterministicReviewClosureSource([]), null);
  assert.equal(deterministicReviewClosureSource([finalDelta]), null);
  assert.equal(deterministicReviewClosureSource([
    {}, { ...finalDelta, resultStatus: "pass" }
  ]), null);
  assert.equal(deterministicReviewClosureSource([
    {}, { ...finalDelta, scope: { mode: "full" } }
  ]), null);
  assert.equal(deterministicReviewClosureSource([{}, finalDelta]), finalDelta);
});

test("repair closure findings require path, claims, and verification cases", () => {
  const valid = {
    path: "app.mjs", claimIds: ["claim-a"], verificationCaseIds: ["CASE-A"]
  };
  assert.equal(repairClosureBindingsComplete([]), false);
  assert.equal(repairClosureBindingsComplete([valid]), true);
  assert.equal(repairClosureBindingsComplete([{ ...valid, path: " " }]), false);
  assert.equal(repairClosureBindingsComplete([{ ...valid, claimIds: [] }]), false);
  assert.equal(repairClosureBindingsComplete([
    { ...valid, verificationCaseIds: [] }
  ]), false);
});

test("current repair providers excludes review and acceptance and reports stale proof", () => {
  const configs = {
    test: { capability: "test" },
    lint: { capability: "static" },
    review: { capability: "review" },
    accept: { capability: "acceptance" }
  };
  const result = currentRepairProviders({
    requiredProviders: () => Object.keys(configs),
    providerConfig: (_id, provider) => configs[provider],
    providerCapability: (_provider, config) => config.capability,
    receiptValidity: (_id, provider) => ({
      validity: provider === "lint" ? "stale" : "valid"
    })
  }, "change-a", "workspace-a");
  assert.deepEqual(result.current.map((row) => row.provider), ["test", "lint"]);
  assert.deepEqual(result.invalid.map((row) => row.provider), ["lint"]);
});

test("repair closure evidence binds claims and cases to current receipts", () => {
  const blockers = [{
    id: "F-1",
    bindingSource: "reviewer",
    claimIds: ["claim-a"],
    verificationCaseIds: ["CASE-A"]
  }];
  const current = [{
    provider: "test",
    config: { criticalCases: ["CASE-A"] }
  }];
  const result = repairClosureEvidenceBindings({
    claimsForProvider: () => [{ id: "claim-a" }],
    receiptPath: () => "/receipts/test.json",
    readJson: () => ({ status: "pass" }),
    stableHash: () => "receipt-digest",
    relativeReceipt: () => ".foundation/receipts/test.json"
  }, "change-a", blockers, current);
  assert.deepEqual(result.bindings, [{
    provider: "test",
    findingId: "F-1",
    claimId: "claim-a",
    caseId: "CASE-A",
    bindingSource: "reviewer",
    receiptDigest: "receipt-digest",
    receipt: ".foundation/receipts/test.json"
  }]);
});

test("repair closure evidence reports the first missing executable binding", () => {
  const result = repairClosureEvidenceBindings({
    claimsForProvider: () => [],
    receiptPath: () => assert.fail("missing binding must not read a receipt"),
    readJson: () => assert.fail("missing binding must not read a receipt"),
    stableHash: () => assert.fail("missing binding must not hash a receipt"),
    relativeReceipt: () => assert.fail("missing binding must not resolve a receipt")
  }, "change-a", [{
    id: "F-1", claimIds: ["claim-a"], verificationCaseIds: ["CASE-A"]
  }], [{ provider: "test", config: { criticalCases: ["CASE-A"] } }]);
  assert.equal(result.error.route, "AUTO_REPAIR");
  assert.equal(result.error.findingId, "F-1");
  assert.equal(result.error.claimId, "claim-a");
  assert.equal(result.error.caseId, "CASE-A");
});

test("repair evidence bindings sort and deduplicate by complete identity", () => {
  const row = {
    findingId: "F-1", provider: "test", claimId: "claim-a", caseId: "CASE-A"
  };
  const other = {
    findingId: "F-2", provider: "lint", claimId: "claim-b", caseId: "CASE-B"
  };
  assert.deepEqual(uniqueRepairEvidenceBindings([row, other, { ...row }]),
    [other, row]);
  assert.deepEqual(uniqueRepairEvidenceBindings([]), []);
});

test("deterministic closure lineage accepts the failed delta or a valid prior closure", () => {
  const source = { digest: "attempt-source" };
  const context = {
    reviewAttemptByDigest: () => ({ digest: "closure-attempt" }),
    reviewAttemptIsValid: () => true
  };
  assert.equal(deterministicClosureIsBound(context, "change-a", {
    status: "fail", review: { attemptDigest: "attempt-source" }
  }, source), true);
  assert.equal(deterministicClosureIsBound(context, "change-a", {
    status: "pass",
    review: {
      attemptDigest: "closure-attempt",
      repairClosure: { sourceAttemptDigest: "attempt-source" }
    }
  }, source), true);
  assert.equal(deterministicClosureIsBound({
    ...context, reviewAttemptIsValid: () => false
  }, "change-a", {
    status: "pass",
    review: {
      attemptDigest: "closure-attempt",
      repairClosure: { sourceAttemptDigest: "attempt-source" }
    }
  }, source), false);
  assert.equal(deterministicClosureIsBound(context, "change-a", null, source), false);
});

test("deterministic repair closure records bounded and approved-revision lineage", () => {
  const base = {
    source: { digest: "attempt-source", workspaceHash: "workspace-old" },
    prior: { contractFingerprint: "contract-old" },
    priorClosure: null,
    currentContractFingerprint: "contract-current",
    approvedRevision: null,
    blockers: [{
      id: "F-1", bindingSource: "reviewer",
      claimIds: ["claim-a"], verificationCaseIds: ["CASE-A"]
    }],
    evidenceBindings: [{ provider: "test" }]
  };
  const bounded = deterministicRepairClosureValue({
    ...base, contractChanged: false
  });
  assert.equal(bounded.kind, "deterministic-after-bounded-ai");
  assert.equal(bounded.sourceContractFingerprint, "contract-old");
  assert.equal(bounded.approvedRevision, undefined);
  assert.equal(bounded.findingBindings[0].findingId, "F-1");

  const revised = deterministicRepairClosureValue({
    ...base,
    contractChanged: true,
    priorClosure: { sourceContractFingerprint: "contract-source" },
    approvedRevision: {
      decisionRef: "decision:one", reason: "approved", priorDigest: "old",
      newDigest: "new", completedAt: "2026-08-27T00:00:00.000Z"
    }
  });
  assert.equal(revised.kind, "deterministic-after-approved-contract-revision");
  assert.equal(revised.sourceContractFingerprint, "contract-source");
  assert.equal(revised.approvedRevision.decisionRef, "decision:one");
});

function operationContext(overrides = {}) {
  const records = [];
  const source = {
    digest: "attempt-source",
    resultStatus: "fail",
    workspaceHash: "workspace-old",
    scope: { mode: "delta" },
    findings: [{
      id: "F-1", severity: "major", path: "app.mjs",
      claimIds: ["claim-a"], verificationCaseIds: ["CASE-A"]
    }]
  };
  return {
    records,
    source,
    context: {
      providerConfig: (_id, provider) => provider === "review"
        ? { capability: "review" }
        : { capability: "test", criticalCases: ["CASE-A"] },
      providerCapability: (_provider, config) => config.capability,
      deliveredAiAttempts: () => [{ resultStatus: "fail" }, source],
      receiptPath: (_id, provider) => `/receipts/${provider}.json`,
      exists: () => true,
      readJson: (path) => path.endsWith("review.json") ? ({
        status: "fail",
        contractFingerprint: "contract-current",
        review: { attemptDigest: "attempt-source", subjects: [] }
      }) : { status: "pass" },
      reviewAttemptByDigest: () => null,
      reviewAttemptIsValid: () => false,
      contractFingerprint: () => "contract-current",
      loadRuntime: () => ({}),
      groundingForReview: () => null,
      requiredProviders: () => ["test", "review"],
      receiptValidity: () => ({ validity: "valid" }),
      claimsForProvider: () => [{ id: "claim-a" }],
      stableHash: () => "stable-digest",
      relativeReceipt: (path) => path.slice(1),
      recordRepairClosureAttempt: () => ({ digest: "closure-attempt" }),
      recordReceipt: (...args) => records.push(args),
      ...overrides
    }
  };
}

test("closure operation ignores non-review providers and incomplete AI history", () => {
  const nonReview = operationContext({
    providerCapability: () => "test",
    deliveredAiAttempts: () => assert.fail("non-review must stop first")
  });
  assert.equal(recordDeterministicReviewClosureOperation(
    nonReview.context, "change-a", "test", "workspace-new"), null);
  const incomplete = operationContext({ deliveredAiAttempts: () => [] });
  assert.equal(recordDeterministicReviewClosureOperation(
    incomplete.context, "change-a", "review", "workspace-new"), null);
});

test("closure operation reports unbound lineage and unapproved contract changes", () => {
  const unbound = operationContext({ exists: () => false });
  assert.equal(recordDeterministicReviewClosureOperation(
    unbound.context, "change-a", "review", "workspace-new").route,
  "CONTRACT_DECISION_REQUIRED");

  const changed = operationContext({
    readJson: () => ({
      status: "fail", contractFingerprint: "contract-old",
      review: { attemptDigest: "attempt-source" }
    })
  });
  assert.match(recordDeterministicReviewClosureOperation(
    changed.context, "change-a", "review", "workspace-new").reason,
  /agreement changed/);
});

test("closure operation reports unchanged workspaces and incomplete findings", () => {
  const unchanged = operationContext();
  assert.match(recordDeterministicReviewClosureOperation(
    unchanged.context, "change-a", "review", "workspace-old").reason,
  /still describes the current workspace/);

  const incomplete = operationContext();
  incomplete.source.findings = [{
    id: "F-1", severity: "minor", path: "app.mjs"
  }];
  assert.match(recordDeterministicReviewClosureOperation(
    incomplete.context, "change-a", "review", "workspace-new").reason,
  /must name a path/);
});

test("closure operation reports invalid proof and missing claim-case bindings", () => {
  const invalid = operationContext({
    receiptValidity: (_id, provider) => ({
      validity: provider === "test" ? "stale" : "valid"
    })
  });
  const invalidResult = recordDeterministicReviewClosureOperation(
    invalid.context, "change-a", "review", "workspace-new");
  assert.equal(invalidResult.providers[0].validity, "stale");

  const missing = operationContext({ claimsForProvider: () => [] });
  const missingResult = recordDeterministicReviewClosureOperation(
    missing.context, "change-a", "review", "workspace-new");
  assert.equal(missingResult.findingId, "F-1");
  assert.equal(missingResult.caseId, "CASE-A");
});

test("closure operation records a deterministic pass with current evidence", () => {
  const fixture = operationContext();
  const result = recordDeterministicReviewClosureOperation(
    fixture.context, "change-a", "review", "workspace-new");
  assert.equal(result.closed, true);
  assert.equal(result.attemptDigest, "closure-attempt");
  assert.equal(fixture.records.length, 1);
  assert.equal(fixture.records[0][2], "pass");
  assert.equal(fixture.records[0][4].repairClosure.kind,
    "deterministic-after-bounded-ai");
});
