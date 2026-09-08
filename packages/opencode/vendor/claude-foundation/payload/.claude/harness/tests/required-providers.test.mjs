import assert from "node:assert/strict";
import test from "node:test";

import {
  addRequiredCapability,
  missingHighRiskQualityCapabilities,
  providersForCapability,
  requiredProvidersOperation
} from "../runtime/workflow/change-validation.mjs";
import { providerCapability as catalogCapability } from
  "../runtime/evidence/provider-catalog.mjs";

const providers = {
  "test-global": { capability: "test" },
  "test-api": { capability: "test", repository: "api" },
  "test-web": { capability: "test", repository: "web" },
  discovery: { capability: "discovery", repository: "api" },
  review: { capability: "review" },
  acceptance: { capability: "acceptance" },
  security: { capability: "security-static" },
  quality: { capability: "changed-quality" },
  mutants: { capability: "mutation" }
};
const capability = (provider, config) => config.capability || provider;

test("provider catalog resolves configured, built-in, and unknown capabilities", () => {
  assert.equal(catalogCapability("custom", { capability: "test" }), "test");
  assert.equal(catalogCapability("review"), "review");
  assert.equal(catalogCapability("changed-quality"), "changed-quality");
  assert.equal(catalogCapability("unknown"), null);
  assert.equal(catalogCapability("test", null), "test");
});

test("enforced high-risk policy requires changed quality and mutation providers", () => {
  const result = requiredProvidersOperation({
    loadRuntime: () => ({ impact: "high", securityTriggers: [], waivers: [] }),
    evidence: () => ({ providers, claims: [] }),
    providerCapability: capability,
    reviewPolicy: () => ({ required: false }),
    resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] }),
    foundationPolicy: () => ({ quality: { changeGate: "enforce-high-risk" } })
  }, "change-a");
  assert.deepEqual(result, ["mutants", "quality"]);
});

test("high-risk claim validation follows the configured quality mode", () => {
  const enforce = { quality: { changeGate: "enforce-high-risk" } };
  assert.deepEqual(missingHighRiskQualityCapabilities(
    { impact: "high" }, [{ capabilities: ["mutation"] }], enforce),
  ["changed-quality"]);
  assert.deepEqual(missingHighRiskQualityCapabilities(
    { impact: "low", securityTriggers: ["auth"] }, [{ capabilities: [
      "changed-quality", "mutation"
    ] }], enforce), []);
  assert.deepEqual(missingHighRiskQualityCapabilities(
    { impact: "low" }, [], enforce), []);
  assert.deepEqual(missingHighRiskQualityCapabilities(
    { impact: "high" }, [], { quality: { changeGate: "warn" } }), []);
});

test("provider capability matching honors global and repository-scoped instances", () => {
  assert.deepEqual(providersForCapability(
    providers, capability, "test", ["api"]), ["test-global", "test-api"]);
  assert.deepEqual(providersForCapability(
    providers, capability, "test", ["missing"]), ["test-global"]);
  assert.deepEqual(providersForCapability(
    providers, capability, "test"), ["test-global", "test-api", "test-web"]);
  assert.deepEqual(providersForCapability(
    providers, capability, "unknown"), []);
});

test("required capability addition uses configured providers, fallback names, and waivers", () => {
  const context = {
    providers,
    providerCapability: capability,
    waived: new Set(["review"]),
    required: new Set()
  };
  addRequiredCapability(context, "test", ["api"]);
  addRequiredCapability(context, "deployment");
  addRequiredCapability(context, "review");
  assert.deepEqual([...context.required].sort(),
    ["deployment", "test-api", "test-global"]);
});

test("required provider operation combines claims, discovery, review, acceptance, and policy", () => {
  const contract = {
    providers,
    claims: [{
      id: "claim-a",
      capabilities: ["test", "security-static"],
      repositories: ["api"]
    }]
  };
  const result = requiredProvidersOperation({
    loadRuntime: () => ({ waivers: [] }),
    evidence: () => contract,
    providerCapability: capability,
    reviewPolicy: () => ({ required: true }),
    resolvedAcceptance: () => ({ required: true }),
    policyCapabilitySplit: () => ({ enforced: ["deployment", "security-static"] })
  }, "change-a");
  assert.deepEqual(result, [
    "acceptance", "deployment", "discovery", "review", "security",
    "test-api", "test-global"
  ]);
});

test("waiving test also suppresses automatic discovery while optional gates stay absent", () => {
  const result = requiredProvidersOperation({
    loadRuntime: () => ({ waivers: [{ capability: "test" }] }),
    evidence: () => ({ claims: [{ capabilities: ["test"] }] }),
    providerCapability: capability,
    reviewPolicy: () => ({ required: false }),
    resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] })
  }, "change-a");
  assert.deepEqual(result, []);
});
