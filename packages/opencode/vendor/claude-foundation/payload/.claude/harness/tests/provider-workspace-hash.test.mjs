import assert from "node:assert/strict";
import test from "node:test";

import {
  providerHashExplicitlyScoped,
  providerHashField,
  providerWorkspaceHashOperation,
  repositoryFieldHash
} from "../runtime/evidence/evidence-contract.mjs";

test("provider hash field follows review and packet-bound semantics", () => {
  assert.equal(providerHashField("review", false), "reviewHash");
  assert.equal(providerHashField("acceptance", true), "workspaceHash");
  assert.equal(providerHashField("test", false), "codeHash");
});

test("provider hash scope recognizes repository declarations and contract digests", () => {
  assert.equal(providerHashExplicitlyScoped(), false);
  assert.equal(providerHashExplicitlyScoped({}), false);
  assert.equal(providerHashExplicitlyScoped({ repository: "api" }), true);
  assert.equal(providerHashExplicitlyScoped({ repositories: ["api"] }), true);
  assert.equal(providerHashExplicitlyScoped({ adapter: "contract-digest" }), true);
});

test("repository field hash prefers the aggregate snapshot and falls back to one repository", () => {
  let requested;
  const context = {
    singleRelevantSnapshot: (...args) => {
      requested = args;
      return { codeHash: "isolated" };
    }
  };
  const repository = { id: "api", workspacePath: "/workspace/api" };
  assert.equal(repositoryFieldHash(context, "change", {
    repositories: { api: { codeHash: "aggregate" } }
  }, repository, "codeHash"), "aggregate");
  assert.equal(requested, undefined);
  assert.equal(repositoryFieldHash(context, "change", {}, repository, "codeHash"),
    "isolated");
  assert.deepEqual(requested, ["change", "/workspace/api", true]);
});

function hashContext(config = {}) {
  const calls = [];
  const context = {
    providerConfig: () => config,
    providerCapability: (provider, value) => value.capability || provider,
    packetBoundCapability: () => false,
    providerRepositories: (...args) => {
      calls.push(args);
      return [{ id: "api", workspacePath: "/api" }];
    },
    relevantHash: () => "relevant",
    relevantSnapshot: () => ({ codeHash: "code", reviewHash: "review" }),
    singleRelevantSnapshot: () => ({
      codeHash: "isolated-code", reviewHash: "isolated-review"
    }),
    stableHash: (value) => ({ digest: value })
  };
  return { context, calls };
}

test("unscoped provider hashes preserve packet fallback and code fallback precedence", () => {
  const packet = hashContext({ capability: "acceptance" });
  packet.context.packetBoundCapability = () => true;
  assert.equal(providerWorkspaceHashOperation(packet.context, "change", "tests", "cached"),
    "cached");
  assert.equal(providerWorkspaceHashOperation(packet.context, "change", "tests"),
    "relevant");
  assert.equal(packet.calls.length, 2);

  const code = hashContext({ capability: "test" });
  assert.equal(providerWorkspaceHashOperation(code.context, "change", "tests", "cached"),
    "code");
  code.context.relevantSnapshot = () => ({});
  assert.equal(providerWorkspaceHashOperation(code.context, "change", "tests", "cached"),
    "cached");
  assert.equal(providerWorkspaceHashOperation(code.context, "change", "tests"),
    "relevant");
});

test("single-repository provider hashes use review and isolated snapshots", () => {
  const aggregate = hashContext({ repository: "api", capability: "review" });
  aggregate.context.relevantSnapshot = () => ({
    repositories: { api: { reviewHash: "aggregate-review" } }
  });
  assert.equal(providerWorkspaceHashOperation(
    aggregate.context, "change", "review"), "aggregate-review");

  const isolated = hashContext({ repository: "api", capability: "review" });
  isolated.context.relevantSnapshot = () => ({});
  assert.equal(providerWorkspaceHashOperation(
    isolated.context, "change", "review"), "isolated-review");
});

test("multi-repository provider hashes retain stable repository order and field", () => {
  const fixture = hashContext({
    adapter: "contract-digest", capability: "cross-repo-contract"
  });
  fixture.context.providerRepositories = () => [
    { id: "api", workspacePath: "/api" },
    { id: "web", workspacePath: "/web" }
  ];
  fixture.context.relevantSnapshot = () => ({
    repositories: { api: { codeHash: "api-code" } }
  });
  fixture.context.singleRelevantSnapshot = (_id, workspacePath) => ({
    codeHash: `${workspacePath}-code`
  });
  assert.deepEqual(providerWorkspaceHashOperation(
    fixture.context, "change", "contract"), { digest: {
    version: 1,
    field: "codeHash",
    repositories: [
      { id: "api", hash: "api-code" },
      { id: "web", hash: "/web-code" }
    ]
  } });
});
