import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { canonicalJson } from "../runtime/core/trust.mjs";
import {
  signedCiArtifactReason,
  signedCiRunReason,
  signedCiShapeReason,
  signedCiWorkspaceReason,
  validateSignedCiEnvelope
} from "../runtime/evidence/signed-ci.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const digest = "a".repeat(64);
const basePayload = () => ({
  version: 1,
  issuer: "ci.example",
  changeId: "change",
  provider: "tests",
  workspaceHash: "workspace",
  status: "pass",
  commit: "head",
  runUrl: "https://ci.example/runs/1",
  artifacts: [{ name: "results.json", sha256: digest }]
});
const signature = (payload) => sign(
  null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64");

function validate(payload = basePayload(), envelopeOverrides = {}, optionOverrides = {}) {
  return validateSignedCiEnvelope({
    envelope: { version: 1, payload, signature: signature(payload), ...envelopeOverrides },
    protocolVersion: "1",
    issuer: "ci.example",
    publicKey: publicPem,
    changeId: "change",
    provider: "tests",
    workspaceHash: "workspace",
    head: "head",
    ...optionOverrides
  });
}

test("shape validation rejects each malformed envelope boundary", () => {
  assert.match(signedCiShapeReason(null, "1"), /malformed/);
  assert.match(signedCiShapeReason({ version: 2, payload: {} }, "1"), /malformed/);
  assert.match(signedCiShapeReason({ version: 1, payload: null, signature: "x" }, "1"), /malformed/);
  assert.match(signedCiShapeReason({ version: 1, payload: {}, signature: 2 }, "1"), /malformed/);
  assert.equal(signedCiShapeReason({ version: 1, payload: {}, signature: "x" }, "1"), null);
});

test("workspace validation binds every provider identity", () => {
  const options = {
    protocolVersion: "1", changeId: "change", provider: "tests", workspaceHash: "workspace"
  };
  assert.equal(signedCiWorkspaceReason(basePayload(), options), null);
  for (const [field, value] of [
    ["version", 2], ["changeId", "other"], ["provider", "lint"],
    ["workspaceHash", "other"]
  ]) assert.match(signedCiWorkspaceReason({ ...basePayload(), [field]: value }, options),
    /provider workspace/);
});

test("run validation checks status, optional commit, and URL", () => {
  assert.equal(signedCiRunReason(basePayload(), "head"), null);
  assert.match(signedCiRunReason({ ...basePayload(), status: "unknown" }, "head"), /status/);
  assert.match(signedCiRunReason({ ...basePayload(), commit: "other" }, "head"), /does not match/);
  assert.equal(signedCiRunReason({ ...basePayload(), commit: "other" }, null), null);
  assert.match(signedCiRunReason({ ...basePayload(), runUrl: "ftp://ci" }, "head"), /http/);
  assert.match(signedCiRunReason({ ...basePayload(), runUrl: "" }, "head"), /http/);
});

test("artifact validation requires pass evidence and valid digest entries", () => {
  assert.equal(signedCiArtifactReason(basePayload(), basePayload().artifacts), null);
  assert.match(signedCiArtifactReason(basePayload(), []), /at least one/);
  assert.equal(signedCiArtifactReason({ ...basePayload(), status: "fail" }, []), null);
  for (const artifact of [null, { name: "", sha256: digest },
    { name: "result", sha256: "bad" }])
    assert.match(signedCiArtifactReason(basePayload(), [artifact]), /name and SHA-256/);
});

test("signed CI envelope accepts pass and maps pending to inconclusive", () => {
  const passed = validate();
  assert.equal(passed.valid, true);
  assert.equal(passed.status, "pass");
  assert.equal(passed.artifacts[0].sha256, digest);
  const pendingPayload = { ...basePayload(), status: "pending", artifacts: undefined };
  const pending = validate(pendingPayload);
  assert.equal(pending.valid, true);
  assert.equal(pending.status, "inconclusive");
  assert.deepEqual(pending.artifacts, []);
});

test("signed CI envelope preserves ordered actionable failures", () => {
  assert.match(validateSignedCiEnvelope({
    envelope: {}, protocolVersion: "1"
  }).reason, /malformed/);
  assert.match(validate({ ...basePayload(), issuer: "other" }).reason, /issuer/);
  assert.match(validate(basePayload(), { signature: "invalid" }).reason, /signature/);
  assert.match(validate({ ...basePayload(), workspaceHash: "other" }).reason, /workspace/);
  assert.match(validate({ ...basePayload(), status: "unknown" }).reason, /status/);
  assert.match(validate({ ...basePayload(), commit: "other" }).reason, /commit/);
  assert.match(validate({ ...basePayload(), runUrl: "file:///tmp/run" }).reason, /runUrl/);
  assert.match(validate({ ...basePayload(), artifacts: [] }).reason, /artifact digest/);
  assert.match(validate({
    ...basePayload(), artifacts: [{ name: "result", sha256: "bad" }]
  }).reason, /SHA-256/);
});
