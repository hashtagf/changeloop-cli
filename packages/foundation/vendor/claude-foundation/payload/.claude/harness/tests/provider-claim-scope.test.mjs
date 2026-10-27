import assert from "node:assert/strict";
import test from "node:test";
import {
  claimsForCapability,
  claimsForProviderOperation,
  claimsInRepositories,
  providerClaimRepositories
} from "../runtime/evidence/evidence-contract.mjs";

const claims = [
  { id: "review", capabilities: ["review"], repositories: ["root"] },
  { id: "test", capabilities: ["test"], repositories: ["api"] },
  { id: "discovery", capabilities: ["discovery"], repositories: ["web"] },
  { id: "global", capabilities: ["test"] }
];

function capabilityContext(overrides = {}) {
  return {
    scopedReviewClaims: (values) => values.slice(0, 1),
    resolvedAcceptance: () => ({ claimIds: ["test", "global"] }),
    loadRuntime: () => ({ id: "state" }),
    evidence: () => ({ claims }),
    policyCapabilities: () => ["policy"],
    ...overrides
  };
}

test("capability claim selection covers review, acceptance, policy, and discovery", () => {
  assert.deepEqual(claimsForCapability(capabilityContext(), "c", claims, "review"),
    [claims[0]]);
  assert.deepEqual(claimsForCapability(capabilityContext(), "c", claims, "acceptance"),
    [claims[1], claims[3]]);
  assert.equal(claimsForCapability(capabilityContext(), "c", claims, "policy"), claims);
  assert.deepEqual(claimsForCapability(capabilityContext(), "c", claims, "discovery"),
    [claims[1], claims[2], claims[3]]);
  assert.deepEqual(claimsForCapability(capabilityContext(), "c", claims, "missing"), []);
});

test("provider claim repositories preserve explicit, digest, single, and global scopes", () => {
  assert.deepEqual(providerClaimRepositories({ repositories: ["api", "web"] }),
    ["api", "web"]);
  assert.deepEqual(providerClaimRepositories({
    adapter: "contract-digest", contract: { root: "a", api: "b" }
  }), ["root", "api"]);
  assert.deepEqual(providerClaimRepositories({ adapter: "contract-digest" }), []);
  assert.deepEqual(providerClaimRepositories({ repository: "root" }), ["root"]);
  assert.equal(providerClaimRepositories({}), null);
  assert.equal(providerClaimRepositories(null), null);
});

test("repository filtering keeps global and overlapping claims in original order", () => {
  assert.equal(claimsInRepositories(claims, null), claims);
  assert.deepEqual(claimsInRepositories(claims, ["api"]), [claims[1], claims[3]]);
  assert.deepEqual(claimsInRepositories(claims, []), [claims[3]]);
  assert.deepEqual(claimsInRepositories(claims, ["missing"]), [claims[3]]);
});

test("provider claim operation combines capability and repository scopes", () => {
  const context = {
    ...capabilityContext(),
    providerConfig: (_id, provider) => provider === "scoped"
      ? { repositories: ["api"] } : null,
    providerCapability: (provider) => provider === "scoped" ? "discovery" : "policy"
  };
  assert.deepEqual(claimsForProviderOperation(context, "c", "scoped"),
    [claims[1], claims[3]]);
  assert.equal(claimsForProviderOperation(context, "c", "unscoped"), claims);
});
