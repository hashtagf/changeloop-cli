import assert from "node:assert/strict";
import {
  acceptanceEvidenceRecovery,
  externalEvidenceRecoveryOperation,
  genericExternalEvidenceRecovery,
  reviewEvidenceRecovery,
  wiringChoiceOperation
} from "../runtime/evidence/proof-readiness.mjs";

const review = reviewEvidenceRecovery("c", "reviewer");
assert.equal(review.provider, "reviewer");
assert.equal(review.kind, "user-decision");
assert.equal(review.request.command, "claude-foundation authority request c --type review");
assert.equal(review.request.packet, "claude-foundation packet c --phase review");
assert.equal(review.decision.kind, "independent-review");
assert.equal(review.decision.recommended, "prepare-for-reviewer");
assert.deepEqual(review.decision.options.map((option) => option.id), [
  "prepare-for-user", "prepare-for-reviewer", "waive-independence", "pause"
]);

const explicit = acceptanceEvidenceRecovery("c", "acceptance", {
  reason: "release approval"
});
assert.equal(explicit.decision.scope.origin, "explicit");
assert.equal(explicit.decision.scope.reason, "release approval");
assert.match(explicit.decision.summary, /criteria are satisfied\.$/);
assert.match(explicit.decision.options[2].outcome, /--acceptance-not-required/);

const claim = acceptanceEvidenceRecovery("c", "acceptance", {
  claimIds: ["claim-a", "claim-b"],
  scopeOrigin: "claim-capability"
});
assert.match(claim.decision.summary, /claim-a, claim-b/);
assert.deepEqual(claim.decision.scope.claims, ["claim-a", "claim-b"]);
assert.match(claim.decision.scope.detail, /evidence.yaml/);
assert.match(claim.decision.options[2].outcome, /Drop capability 'acceptance'.*claim-a, claim-b/);

const emptyClaim = acceptanceEvidenceRecovery("c", "acceptance", {
  scopeOrigin: "claim-capability"
});
assert.match(emptyClaim.decision.options[2].outcome, /in evidence.yaml/);

const noWiring = genericExternalEvidenceRecovery("security", null);
assert.equal(Object.hasOwn(noWiring, "wiring"), false);
assert.equal(noWiring.decision.recommended, "provide-evidence");
assert.deepEqual(noWiring.decision.options.map((option) => option.id), [
  "provide-evidence", "configure-provider", "pause"
]);
const wiring = { source: "package.json", command: "evidence init" };
const wired = genericExternalEvidenceRecovery("security", wiring);
assert.equal(wired.wiring, wiring);
assert.equal(wired.decision.recommended, "wire-provider");
assert.equal(wired.decision.options[0].id, "wire-provider");
assert.match(wired.decision.summary, /package.json/);

const configs = {
  reviewer: { capability: "review" },
  acceptance: { capability: "acceptance" },
  security: { capability: "security-static" }
};
const operation = (provider) => externalEvidenceRecoveryOperation({
  providerConfig: (_id, name) => configs[name],
  providerCapability: (_provider, config) => config.capability,
  loadRuntime: () => ({
    acceptance: { claimIds: ["claim-a"], scopeOrigin: "claim-capability" }
  }),
  wiringChoice: (_id, name) => name === "security" ? wiring : null
}, "c", provider);
assert.equal(operation("reviewer").decision.kind, "independent-review");
assert.equal(operation("acceptance").decision.scope.origin, "claim-capability");
assert.equal(operation("security").wiring, wiring);

assert.equal(wiringChoiceOperation({
  evidenceDetectionValue: () => { throw new Error("unavailable"); }
}, "c", "security"), null);
assert.equal(wiringChoiceOperation({
  evidenceDetectionValue: () => ({ candidates: [
    { provider: "other", recommended: true, config: {}, source: "other.json" },
    { provider: "security", recommended: false, config: {}, source: "ignored.json" },
    { provider: "security", recommended: true, config: null, source: "ignored.json" }
  ] })
}, "c", "security"), null);
assert.deepEqual(wiringChoiceOperation({
  evidenceDetectionValue: () => ({ candidates: [
    { provider: "security", recommended: true, config: { command: ["npm", "test"] },
      source: "package.json" }
  ] })
}, "c", "security"), {
  kind: "configure-provider",
  command: "claude-foundation evidence init c --write",
  source: "package.json",
  instruction: "Wire provider 'security' from the project-owned command detected at package.json, then re-run proof.",
  verify: "claude-foundation proof readiness c"
});
