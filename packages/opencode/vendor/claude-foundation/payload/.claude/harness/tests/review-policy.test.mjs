import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleReviewPolicy,
  collectReviewSignals,
  createEvidenceContract
} from "../runtime/evidence/evidence-contract.mjs";

const lowRoute = {
  tier: "low", route: ["ai-full"], maxAiAttempts: 1,
  requiresHumanFinal: false, triggers: []
};

test("review signals stay empty for a low-risk claim", () => {
  const signals = collectReviewSignals(
    {}, { claims: [{ impact: "low", capabilities: ["test"] }] }
  );
  assert.deepEqual(signals.requiredTriggers, []);
  assert.deepEqual(signals.diversityTriggers, []);
  assert.deepEqual([...signals.capabilities], ["test"]);
});

test("review signals combine claim, repository, and semantic risk", () => {
  const signals = collectReviewSignals({
    intent: "Prevent concurrent payment migration races",
    evidenceCapabilities: ["compatibility"],
    securityTriggers: ["authorization"]
  }, {
    claims: [{
      impact: "high", capabilities: ["cross-repo-contract"],
      repositories: ["root", "billing"]
    }]
  }, ["security-static"]);
  assert.deepEqual(signals.requiredTriggers, [
    "risk-capability", "multi-repository-claim", "risk-semantics"
  ]);
  assert.deepEqual(signals.diversityTriggers, [
    "critical-capability", "critical-semantics"
  ]);
  assert.deepEqual([...signals.capabilities], [
    "compatibility", "cross-repo-contract", "security-static"
  ]);
});

test("legacy review policy preserves its compact default shape", () => {
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: [], diversityTriggers: []
    },
    riskRoute: lowRoute,
    policy: {},
    riskTiered: false
  });
  assert.deepEqual(result, {
    required: false,
    independence: "required",
    diversity: "preferred",
    triggers: []
  });
});

test("legacy review can be required by state, trigger, or capability", () => {
  for (const signals of [
    { capabilities: new Set(), requiredTriggers: ["risk-semantics"], diversityTriggers: [] },
    { capabilities: new Set(["review"]), requiredTriggers: [], diversityTriggers: [] }
  ]) {
    assert.equal(assembleReviewPolicy({
      state: {}, signals, riskRoute: lowRoute, policy: {}, riskTiered: false
    }).required, true);
  }
  assert.equal(assembleReviewPolicy({
    state: { reviewRequired: true },
    signals: { capabilities: new Set(), requiredTriggers: [], diversityTriggers: [] },
    riskRoute: lowRoute, policy: {}, riskTiered: false
  }).required, true);
});

test("critical legacy policy requires diversity without a waiver", () => {
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: [],
      diversityTriggers: ["critical-capability"]
    },
    riskRoute: lowRoute,
    policy: {},
    riskTiered: false
  });
  assert.equal(result.diversity, "required");
  assert.deepEqual(result.triggers, ["critical-capability"]);
});

test("single-model and self-review waivers remain explicit", () => {
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: ["risk-capability"],
      diversityTriggers: ["critical-capability"]
    },
    riskRoute: lowRoute,
    policy: { diversity: "single-model", independence: "self" },
    riskTiered: false
  });
  assert.deepEqual(result, {
    required: true,
    independence: "self",
    diversity: "preferred",
    diversityWaived: true,
    independenceWaived: true,
    triggers: [
      "critical-capability", "diversity-waived-single-model",
      "independence-waived-self-review", "risk-capability"
    ]
  });
});

test("risk-tiered policy carries route identity and deduplicated triggers", () => {
  const riskRoute = {
    tier: "high", route: ["ai-full", "ai-delta-after-correction"],
    maxAiAttempts: 2, requiresHumanFinal: true,
    triggers: ["critical-capability", "high-impact"]
  };
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: [],
      diversityTriggers: ["critical-capability"]
    },
    riskRoute,
    policy: {},
    riskTiered: true
  });
  assert.deepEqual(result, {
    required: true,
    tier: "high",
    route: ["ai-full", "ai-delta-after-correction"],
    maxAiAttempts: 2,
    requiresHumanFinal: true,
    independence: "required",
    diversity: "required",
    triggers: ["critical-capability", "high-impact"]
  });
});

test("single-model does not claim a waiver when diversity is unnecessary", () => {
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: [], diversityTriggers: []
    },
    riskRoute: lowRoute,
    policy: { diversity: "single-model" },
    riskTiered: false
  });
  assert.equal(result.diversityWaived, undefined);
  assert.equal(result.diversity, "preferred");
});

test("evidence contract review policy composes grounding, routing, and project policy", () => {
  let projectPolicy = { review: {}, workflow: { reviewPolicy: "legacy" } };
  const contract = createEvidenceContract({
    activeChangePath: () => "/change",
    readJson: () => ({ risk: { tier: "medium" } }),
    policyCapabilities: () => ["compatibility"],
    foundationPolicy: () => projectPolicy,
    loadRuntime: () => ({})
  });
  const claims = [{ impact: "high", capabilities: ["review"] }];
  const legacy = contract.reviewPolicy("change", { intent: "payment" }, { claims });
  assert.equal(legacy.required, true);
  assert.equal(legacy.tier, undefined);
  assert.ok(legacy.triggers.includes("risk-capability"));

  projectPolicy = {
    review: { diversity: "single-model", independence: "self" },
    workflow: { reviewPolicy: "risk-tiered" }
  };
  const tiered = contract.reviewPolicy("change", { impact: "high" }, { claims });
  assert.equal(tiered.tier, "high");
  assert.equal(tiered.diversityWaived, true);
  assert.equal(tiered.independenceWaived, true);

  projectPolicy = { review: null, workflow: { reviewPolicy: "legacy" } };
  const defaultState = contract.reviewPolicy("change", undefined, { claims: [] });
  assert.equal(defaultState.required, false);
});
