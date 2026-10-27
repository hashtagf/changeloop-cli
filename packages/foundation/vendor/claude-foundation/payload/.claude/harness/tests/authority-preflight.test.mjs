import assert from "node:assert/strict";
import test from "node:test";

import {
  authorityPreflightValue, riskRequiresCi
} from "../runtime/core/authority-policy.mjs";

test("risk policy recognizes high-impact and capability triggers", () => {
  assert.equal(riskRequiresCi({ riskBasedCiRequired: false, impact: "high" }), false);
  assert.equal(riskRequiresCi({ riskBasedCiRequired: true, impact: "high" }), true);
  assert.equal(riskRequiresCi({
    riskBasedCiRequired: true, impact: "medium",
    evidenceCapabilities: ["data-migration"]
  }), true);
  assert.equal(riskRequiresCi({
    riskBasedCiRequired: true, impact: "low"
  }), false);
});

test("missing signed CI is a typed pre-Build decision", () => {
  const value = authorityPreflightValue({
    changeId: "secure-change",
    state: { riskBasedCiRequired: true, impact: "high" },
    reviewRisk: { tier: "high" },
    providers: ["test", "review"],
    providerConfig: (provider) => ({
      adapter: provider === "test" ? "command" : "external"
    })
  });
  assert.equal(value.status, "NEEDS_USER_DECISION");
  assert.equal(value.blockers[0].code, "SIGNED_CI_CONFIGURATION_REQUIRED");
  assert.equal(value.decision.recommended, "configure-required-authority");
  assert.match(value.decision.summary, /paused before dispatch/);
  assert.ok(value.decision.options.some((option) => option.id === "pause"));
  assert.match(value.blockers[0].next, /change validate secure-change/);
  // The trap a consumer sat in: the only named route was configuring signed
  // CI, and the policy that demanded it lives outside Build's reach.
  assert.match(value.blockers[0].next,
    /change resolve secure-change --ci-not-required --decision-ref <ref>/);
  assert.match(value.blockers[0].next, /land\.riskBasedCi/);
  assert.ok(value.decision.options.some((option) => option.id === "waive-signed-ci"));
  assert.match(value.decisionFingerprint, /^sha256:/);
  assert.equal(value.binding.revision, 0);
});

test("configured trust root clears preflight without fabricating a CI pass", () => {
  const value = authorityPreflightValue({
    changeId: "secure-change",
    state: { riskBasedCiRequired: true, impact: "high" },
    providers: ["ci"],
    providerConfig: () => ({
      adapter: "external",
      ci: {
        issuer: "trusted-ci",
        publicKey: "-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----"
      }
    })
  });
  assert.equal(value.status, "READY");
  assert.deepEqual(value.requirements.signedCi.configuredProviders, ["ci"]);
  assert.equal(value.decision, null);
});

test("risk-relevant revisions invalidate an obsolete authority decision", () => {
  const base = {
    changeId: "secure-change",
    state: { revision: 1, riskBasedCiRequired: true, impact: "high" },
    providers: []
  };
  const first = authorityPreflightValue(base);
  const revised = authorityPreflightValue({
    ...base, state: { ...base.state, revision: 2 }
  });
  assert.notEqual(first.decisionFingerprint, revised.decisionFingerprint);
});

test("preflight lists every later authority boundary without prematurely satisfying it", () => {
  const value = authorityPreflightValue({
    changeId: "release-change",
    state: {
      revision: 3, contractRevision: 2, executionRevision: 1,
      riskBasedCiRequired: false, impact: "medium"
    },
    reviewRisk: { required: true, tier: "medium", requiresHumanFinal: true },
    providers: ["reviewer", "acceptor"],
    providerCapability: (provider) => provider === "reviewer" ? "review" : "acceptance",
    providerConfig: () => ({ adapter: "external" }),
    acceptance: {
      required: true, decision: "required", reason: "visual sign-off",
      claimIds: ["UI-2", "UI-1"]
    },
    grounding: { required: true, locked: true, reopenPending: false },
    handoffs: {
      status: "WAITING_EXTERNAL", blocking: ["DEPLOY-1"],
      operations: [{
        id: "DEPLOY-1", owner: "release", authority: "production",
        timing: "pre-land", status: "pending", landBlocking: true,
        operationDigest: "sha256:operation"
      }]
    }
  });
  assert.equal(value.status, "READY");
  assert.deepEqual(value.requirements.review.providers, ["reviewer"]);
  assert.equal(value.requirements.review.requiresHumanFinal, true);
  assert.deepEqual(value.requirements.acceptance.claimIds, ["UI-1", "UI-2"]);
  assert.equal(value.requirements.grounding.locked, true);
  assert.equal(value.requirements.handoffs.operations[0].landBlocking, true);
  assert.match(value.requirements.handoffs.operations[0].recoveryCommand,
    /handoff packet release-change --operation DEPLOY-1/);
  assert.deepEqual(value.blockers, []);
  assert.equal(value.binding.contractRevision, 2);
  assert.equal(value.binding.executionRevision, 1);
});

test("contract and execution revisions invalidate obsolete preflight decisions", () => {
  const state = {
    revision: 1, contractRevision: 1, executionRevision: 1,
    riskBasedCiRequired: false, impact: "low"
  };
  const first = authorityPreflightValue({ changeId: "revision-bound", state });
  const contractChanged = authorityPreflightValue({
    changeId: "revision-bound", state: { ...state, contractRevision: 2 }
  });
  const executionChanged = authorityPreflightValue({
    changeId: "revision-bound", state: { ...state, executionRevision: 2 }
  });
  assert.notEqual(first.decisionFingerprint, contractChanged.decisionFingerprint);
  assert.notEqual(first.decisionFingerprint, executionChanged.decisionFingerprint);
});
