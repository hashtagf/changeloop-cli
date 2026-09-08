import assert from "node:assert/strict";
import test from "node:test";

import {
  configuredProviderValue,
  createEvidenceContract,
  executionFingerprintOperation,
  executionFingerprintValue,
  normalizedAcceptanceValue,
  providerClaimIdsValue,
  providerClaimsOperation,
  providerConfigOperation,
  providerRepositoryOperation,
  providerRepositoryValue,
  providerWorkspaceOperation,
  providerWorkspaceValue,
  resolvedAcceptanceOperation,
  resolvedAcceptanceValue,
  providerRepositoryIds
} from "../runtime/evidence/evidence-contract.mjs";

test("provider repository IDs preserve explicit scopes and derive adapter defaults", () => {
  let selectedCalls = 0;
  const selected = () => { selectedCalls += 1; return ["root", "api", "root"]; };
  assert.deepEqual(providerRepositoryIds({ repositories: ["web", "api", "web"] },
    selected), ["api", "web"]);
  assert.deepEqual(providerRepositoryIds({
    adapter: "contract-digest", contract: { web: {}, api: {} }
  }, selected), ["api", "web"]);
  assert.deepEqual(providerRepositoryIds({ repository: "api" }, selected), ["api"]);
  assert.deepEqual(providerRepositoryIds({}, selected), ["api", "root"]);
  assert.deepEqual(providerRepositoryIds(null), []);
  assert.equal(selectedCalls, 1);
});

test("acceptance normalization preserves required evidence and legacy defaults", () => {
  assert.deepEqual(normalizedAcceptanceValue({}), {
    version: 1, decision: "legacy-not-required", required: false,
    reason: null, claimIds: [], scopeOrigin: null
  });
  assert.deepEqual(normalizedAcceptanceValue({ acceptance: {
    version: "2", required: true, reason: "  approved by owner  ",
    claimIds: ["claim-b", "claim-a", "claim-b"], scopeOrigin: "proposal"
  } }), {
    version: 2, decision: "required", required: true,
    reason: "approved by owner", claimIds: ["claim-a", "claim-b"],
    scopeOrigin: "proposal"
  });
  assert.deepEqual(normalizedAcceptanceValue({ acceptance: {
    version: 0, decision: "waived", required: false,
    reason: "ignored", claimIds: ["ignored"], scopeOrigin: ""
  } }), {
    version: 1, decision: "waived", required: false,
    reason: null, claimIds: [], scopeOrigin: null
  });
  assert.equal(normalizedAcceptanceValue({
    acceptance: { required: true, reason: "   " }
  }).reason, null);
});

test("configured provider lookup supports direct, discovery, and declared output identities", () => {
  const direct = { adapter: "command", command: ["test"] };
  const combined = { adapter: "test-discovery", outputs: ["test", "discovery"] };
  assert.equal(configuredProviderValue({ review: direct }, "review"), direct);
  assert.equal(configuredProviderValue({ test: combined }, "discovery"), combined);
  assert.equal(configuredProviderValue({ combined }, "test"), combined);
  assert.equal(configuredProviderValue({ other: { outputs: "test" } }, "test"), null);
  assert.equal(configuredProviderValue({}, "missing"), null);
});

test("provider claim selection validates explicit scopes", () => {
  const die = (message) => { throw new Error(message); };
  assert.deepEqual(providerClaimIdsValue(["a", "b"], "test", null, die), ["a", "b"]);
  assert.deepEqual(providerClaimIdsValue(["a", "b"], "test", { claims: "declared" }, die),
    ["a", "b"]);
  assert.deepEqual(providerClaimIdsValue(["a", "b"], "test", { claims: ["b"] }, die),
    ["b"]);
  assert.throws(() => providerClaimIdsValue(["a"], "test", { claims: "all" }, die),
    /claims must be an array or 'declared'/);
  assert.throws(() => providerClaimIdsValue(["a"], "test", { claims: ["b", "c"] }, die),
    /undeclared claim\(s\): b, c/);
});

test("provider repository and workspace values honor scoped and runtime fallbacks", () => {
  const lookups = [];
  const repositoryById = (id, repositoryId) => {
    lookups.push([id, repositoryId]);
    return { id: repositoryId, workspacePath: `/repos/${repositoryId}` };
  };
  assert.equal(providerRepositoryValue(repositoryById, "change", null), null);
  const repository = providerRepositoryValue(repositoryById, "change", { repository: "api" });
  assert.deepEqual(repository, { id: "api", workspacePath: "/repos/api" });
  assert.deepEqual(lookups, [["change", "api"]]);
  const canonical = (path) => `canonical:${path}`;
  assert.equal(providerWorkspaceValue(canonical, "/root", {}, repository),
    "canonical:/repos/api");
  assert.equal(providerWorkspaceValue(canonical, "/root", {
    workspace: { path: "/sandbox" }
  }, null), "canonical:/sandbox");
  assert.equal(providerWorkspaceValue(canonical, "/root", { workspace: {} }, null),
    "canonical:/root");
});

test("resolved acceptance combines legacy decisions with claim-declared requirements", () => {
  assert.deepEqual(resolvedAcceptanceValue({}, { claims: [] }), {
    version: 1,
    decision: "legacy-not-required",
    required: false,
    reason: null,
    claimIds: [],
    scopeOrigin: null
  });
  assert.deepEqual(resolvedAcceptanceValue({ acceptance: {
    version: 2,
    decision: "required",
    required: true,
    reason: "owner review",
    claimIds: ["explicit"],
    scopeOrigin: "proposal"
  } }, { claims: [
    { id: "declared", capabilities: ["acceptance"] },
    { id: "explicit", capabilities: ["acceptance", "test"] },
    { id: "other", capabilities: ["test"] }
  ] }), {
    version: 2,
    decision: "required",
    required: true,
    reason: "owner review",
    claimIds: ["declared", "explicit"],
    scopeOrigin: "proposal"
  });
  assert.equal(resolvedAcceptanceValue({}, {
    claims: [{ id: "declared", capabilities: ["acceptance"] }]
  }).scopeOrigin, "claim-capability");
});

test("execution fingerprint binds protocol, providers, and services with empty fallbacks", () => {
  const stableHash = (value) => JSON.stringify(value);
  assert.equal(executionFingerprintValue(stableHash, 7, {
    providers: { test: { command: ["npm", "test"] } },
    execution: { services: { api: { command: ["serve"] } } }
  }), JSON.stringify({
    adapterProtocolVersion: 7,
    providers: { test: { command: ["npm", "test"] } },
    services: { api: { command: ["serve"] } }
  }));
  assert.equal(executionFingerprintValue(stableHash, 7, {}), JSON.stringify({
    adapterProtocolVersion: 7,
    providers: {},
    services: {}
  }));
});

test("contract operations bind factory dependencies and default arguments", () => {
  const testConfig = { adapter: "test-discovery", repository: "api" };
  assert.equal(providerConfigOperation({
    evidence: () => ({ providers: { test: testConfig } })
  }, "change", "discovery"), testConfig);
  assert.equal(providerConfigOperation({
    evidence: () => ({})
  }, "change", "missing"), null);

  const configLookup = () => ({ claims: ["claim-b"] });
  assert.deepEqual(providerClaimsOperation({
    claimsForProvider: () => [{ id: "claim-a" }, { id: "claim-b" }],
    providerConfig: configLookup,
    die: (message) => { throw new Error(message); }
  }, "change", "test"), ["claim-b"]);

  const repository = providerRepositoryOperation({
    providerConfig: () => ({ repository: "api" }),
    repositoryById: (id, repositoryId) => ({ id, repositoryId, workspacePath: "/api" })
  }, "change", "test");
  assert.deepEqual(repository, {
    id: "change", repositoryId: "api", workspacePath: "/api"
  });

  assert.equal(providerWorkspaceOperation({
    providerConfig: () => testConfig,
    providerRepository: () => repository,
    canonicalPath: (path) => `canonical:${path}`,
    loadRuntime: () => ({ workspace: { path: "/sandbox" } }),
    root: "/root"
  }, "change", "test"), "canonical:/api");

  assert.equal(resolvedAcceptanceOperation({
    loadRuntime: () => ({}),
    evidence: () => ({ claims: [{ id: "claim-a", capabilities: ["acceptance"] }] })
  }, "change").required, true);

  const calls = [];
  assert.equal(executionFingerprintOperation({
    activeChangePath: (id) => `/changes/${id}`,
    evidence: (id, dir) => {
      calls.push([id, dir]);
      return { providers: {} };
    },
    stableHash: (value) => JSON.stringify(value),
    adapterProtocolVersion: 4
  }, "change"), JSON.stringify({
    adapterProtocolVersion: 4,
    providers: {},
    services: {}
  }));
  assert.deepEqual(calls, [["change", "/changes/change"]]);
});

test("contract facade maps repository IDs through the authoritative catalog", () => {
  const calls = [];
  const noop = () => ({});
  const contract = createEvidenceContract({
    ROOT: "/root", PROVIDERS: new Set(), ADAPTERS: new Set(), INPUT_MODES: new Set(),
    EXCLUDED_WORKSPACE_DIRS: new Set(), ADAPTER_PROTOCOL_VERSION: 1,
    PROVIDER_PROTOCOL_VERSION: 1,
    activeChangePath: noop, readJson: noop,
    repositoryById: (id, repositoryId) => {
      calls.push([id, repositoryId]);
      return { id: repositoryId };
    },
    selectedRepositories: () => [{ id: "web" }, { id: "api" }],
    providerCapability: noop, canonicalPath: (value) => value,
    loadRuntime: noop, relevantHash: noop, relevantSnapshot: noop,
    singleRelevantSnapshot: noop, fileDigest: noop,
    stableHash: (value) => JSON.stringify(value), filesystemEntryIdentity: noop,
    policyCapabilities: () => [], foundationPolicy: () => ({ workflow: {} }),
    handoffContract: () => ({ operations: [] }), git: noop,
    declaredSurfaceMatcher: () => () => true,
    die: (message) => { throw new Error(message); }
  });
  assert.deepEqual(contract.providerRepositories("change", "tests", {
    repositories: ["web", "api", "web"]
  }), [{ id: "api" }, { id: "web" }]);
  assert.deepEqual(contract.providerRepositories("change", "tests", {}),
    [{ id: "api" }, { id: "web" }]);
  assert.deepEqual(calls, [
    ["change", "api"], ["change", "web"],
    ["change", "api"], ["change", "web"]
  ]);
  assert.equal(contract.normalizedAcceptance({ acceptance: { required: true } }).required,
    true);
});
