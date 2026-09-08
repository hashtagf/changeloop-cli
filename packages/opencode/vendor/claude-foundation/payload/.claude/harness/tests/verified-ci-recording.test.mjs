import assert from "node:assert/strict";
import test from "node:test";
import {
  recordVerifiedCiOperation,
  requireExternalCiConfig,
  signedCiReceiptFlags
} from "../runtime/workflow/authority-runtime.mjs";

const fail = (message) => { throw new Error(message); };
const config = {
  adapter: "external",
  ci: { issuer: "ci.example", publicKey: "public-key" }
};

test("external CI configuration requires adapter, issuer, and public key", () => {
  assert.equal(requireExternalCiConfig({ fail }, "ci", config), config);
  for (const invalid of [null, {}, { adapter: "command" }, {
    adapter: "external", ci: { issuer: "ci.example" }
  }, { adapter: "external", ci: { publicKey: "public-key" } }])
    assert.throws(() => requireExternalCiConfig({ fail }, "ci", invalid),
      /requires external ci\.issuer and ci\.publicKey configuration/);
});

function result(overrides = {}) {
  return {
    valid: true,
    status: "pass",
    payload: {
      issuer: "ci.example",
      status: "pass",
      commit: "abc123",
      runUrl: "https://ci.example/runs/7"
    },
    artifacts: [{ name: "report", sha256: "deadbeef" }],
    ...overrides
  };
}

test("signed CI receipt binds claims, workspace, run, and artifact digests", () => {
  const flags = signedCiReceiptFlags({
    providerClaims: () => ["claim-a", "claim-b"]
  }, "change", "ci", config, "workspace-hash", result());
  assert.deepEqual(flags, {
    claims: "claim-a,claim-b",
    workspaceHash: "workspace-hash",
    observed: "CI pass; commit abc123",
    source: "signed-ci:ci.example",
    reference: [
      "https://ci.example/runs/7",
      "artifact:report:sha256:deadbeef"
    ],
    "recorded-by": "evidence-verify-ci:ci.example"
  });
  assert.equal(signedCiReceiptFlags({ providerClaims: () => [] },
    "change", "ci", config, "hash", result({
      payload: { ...result().payload, observed: "all shards passed" }
    })).observed, "all shards passed");
});

function context(overrides = {}) {
  return {
    providerConfig: () => config,
    resolvePath: (source) => `/project/${source}`,
    pathExists: () => true,
    readJson: () => ({ signature: "signed" }),
    providerWorkspaceHash: () => "workspace-hash",
    providerRepository: () => ({ workspacePath: "/repo/worktree" }),
    providerWorkspace: () => "/fallback/worktree",
    gitHead: () => "head-sha",
    validateSignedCiEnvelope: () => result(),
    ciEvidenceProtocolVersion: 3,
    recordReceipt: () => {},
    providerClaims: () => ["claim-a"],
    fail,
    output: { log: () => {} },
    ...overrides
  };
}

test("verified CI rejects missing envelopes before signature validation", () => {
  assert.throws(() => recordVerifiedCiOperation(context(), "change", "ci", null),
    /requires a signed JSON envelope/);
  assert.throws(() => recordVerifiedCiOperation(context({ pathExists: () => false }),
    "change", "ci", "missing.json"), /requires a signed JSON envelope/);
});

test("verified CI binds repository head and records a validated receipt", () => {
  const validations = [];
  const receipts = [];
  const logs = [];
  recordVerifiedCiOperation(context({
    validateSignedCiEnvelope: (input) => { validations.push(input); return result(); },
    recordReceipt: (...args) => receipts.push(args),
    output: { log: (message) => logs.push(message) }
  }), "change", "ci", "envelope.json");
  assert.deepEqual(validations[0], {
    envelope: { signature: "signed" },
    protocolVersion: 3,
    issuer: "ci.example",
    publicKey: "public-key",
    changeId: "change",
    provider: "ci",
    workspaceHash: "workspace-hash",
    head: "head-sha"
  });
  assert.deepEqual(receipts[0].slice(0, 3), ["change", "ci", "pass"]);
  assert.equal(receipts[0][3].source, "signed-ci:ci.example");
  assert.match(logs[0], /CI EVIDENCE change\/ci: pass[\s\S]*runs\/7/);
});

test("verified CI uses provider workspace fallback and rejects invalid signatures", () => {
  let headPath;
  const invalid = context({
    providerRepository: () => null,
    gitHead: (path) => { headPath = path; return "fallback-head"; },
    validateSignedCiEnvelope: () => ({ valid: false, reason: "signature mismatch" }),
    recordReceipt: assert.fail
  });
  assert.throws(() => recordVerifiedCiOperation(invalid,
    "change", "ci", "envelope.json"), /signature mismatch/);
  assert.equal(headPath, "/fallback/worktree");
});
