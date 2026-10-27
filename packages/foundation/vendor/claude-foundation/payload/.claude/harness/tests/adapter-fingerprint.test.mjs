import assert from "node:assert/strict";
import test from "node:test";

import {
  adapterConfigurationIdentity,
  adapterServiceIdentity,
  createAdapterFingerprint
} from "../runtime/evidence/evidence-contract.mjs";

test("adapter configuration identity preserves defaults", () => {
  assert.deepEqual(adapterConfigurationIdentity(), {
    repository: null,
    adapter: "external",
    adapterVersion: "1",
    command: null,
    inputMode: null,
    project: null,
    outputs: [],
    resources: null,
    dependsOn: []
  });
});

test("adapter configuration identity honors command and declared fields", () => {
  const config = {
    repository: "api", adapter: "command", version: 2,
    command: ["npm", "test"], inputMode: "os-input", project: "web",
    outputs: ["report"], resources: ["workspace"], dependsOn: ["build"]
  };
  assert.deepEqual(adapterConfigurationIdentity(config, ["npm", "run", "ci"]), {
    repository: "api", adapter: "command", adapterVersion: "2",
    command: ["npm", "run", "ci"], inputMode: "os-input", project: "web",
    outputs: ["report"], resources: ["workspace"], dependsOn: ["build"]
  });
  assert.deepEqual(adapterConfigurationIdentity(config).command, ["npm", "test"]);
});

test("service identity returns configured execution service or null", () => {
  const context = {
    evidence: () => ({ execution: { services: { app: { command: ["npm", "start"] } } } })
  };
  assert.equal(adapterServiceIdentity(context, "change", {}), null);
  assert.deepEqual(adapterServiceIdentity(context, "change", { service: "app" }), {
    name: "app", config: { command: ["npm", "start"] }
  });
  assert.deepEqual(adapterServiceIdentity(context, "change", { service: "missing" }), {
    name: "missing", config: null
  });
  assert.deepEqual(adapterServiceIdentity({
    evidence: () => ({})
  }, "change", { service: "missing" }), { name: "missing", config: null });
});

test("adapter fingerprint material retains stable field order and complete identity", () => {
  let material;
  const context = {
    adapterProtocolVersion: 3,
    providerProtocolVersion: 4,
    stableHash: (value) => { material = value; return "fingerprint"; },
    providerCapability: () => "test",
    providerRepositories: () => [{ id: "api" }, { id: "root" }],
    providerClaims: () => ["claim-1"],
    environmentDescriptor: () => ({ platform: "test" }),
    evidence: () => ({ execution: { services: { app: { staticRoot: "public" } } } })
  };
  const config = {
    repository: "api", adapter: "command", version: 2,
    command: ["npm", "test"], claims: ["claim-1"],
    inputMode: "os-input", project: "web", outputs: ["report"],
    resources: ["workspace"], dependsOn: ["build"], service: "app",
    timeoutMs: 42, criticalCases: ["CASE-B", "CASE-A"],
    mutantKillers: { z: "CASE-B", a: "CASE-A" }
  };
  assert.equal(createAdapterFingerprint(
    context, "change", "tests", config, ["npm", "run", "ci"]), "fingerprint");
  assert.deepEqual(Object.keys(material), [
    "adapterProtocolVersion", "providerProtocolVersion", "provider", "capability",
    "repository", "repositories", "adapter", "adapterVersion", "command", "claims",
    "environment", "inputMode", "project", "outputs", "resources", "dependsOn",
    "service", "executionPolicy"
  ]);
  assert.deepEqual(material.repositories, ["api", "root"]);
  assert.deepEqual(material.command, ["npm", "run", "ci"]);
  assert.deepEqual(material.service, {
    name: "app", config: { staticRoot: "public" }
  });
  assert.deepEqual(material.executionPolicy.criticalCases, ["CASE-A", "CASE-B"]);
  assert.deepEqual(Object.keys(material.executionPolicy.mutantKillers), ["a", "z"]);
});

test("adapter fingerprint uses external defaults without a service", () => {
  let material;
  const context = {
    adapterProtocolVersion: 1,
    providerProtocolVersion: 1,
    stableHash: (value) => { material = value; return "default"; },
    providerCapability: (provider) => provider,
    providerRepositories: () => [],
    providerClaims: () => [],
    environmentDescriptor: () => ({}),
    evidence: () => { throw new Error("service lookup must be skipped"); }
  };
  assert.equal(createAdapterFingerprint(context, "change", "test", {}), "default");
  assert.equal(material.adapter, "external");
  assert.equal(material.service, null);
  assert.equal(material.executionPolicy.timeoutMs, 120000);
});
