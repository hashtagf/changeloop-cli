import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { canonicalJson } from "../runtime/core/trust.mjs";
import {
  semanticAcceptanceCases, validateSemanticAcceptanceEnvelope
} from "../runtime/evidence/semantic-acceptance.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const config = {
  acceptanceCases: [{
    id: "BOUNDARY-FRACTION", claimId: "WINDOW-1",
    partition: "fractional threshold", required: true, requiresFailToPass: true
  }],
  semanticAcceptance: {
    issuer: "hidden-oracle",
    publicKey: publicKey.export({ type: "spki", format: "pem" })
  }
};

function envelope(status = "pass") {
  const payload = {
    version: "1", changeId: "window-fix", provider: "hidden-acceptance",
    workspaceHash: "sha256:workspace", issuer: "hidden-oracle",
    cases: [{
      id: "BOUNDARY-FRACTION", claimId: "WINDOW-1",
      partition: "fractional threshold", status,
      observationDigest: "a".repeat(64),
      transition: {
        beforeStatus: "fail", afterStatus: "pass",
        beforeDigest: "b".repeat(64), afterDigest: "c".repeat(64)
      }
    }]
  };
  return {
    version: "1", payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64")
  };
}

test("semantic case declarations normalize deterministically", () => {
  assert.deepEqual(semanticAcceptanceCases({ acceptanceCases: [
    { id: "B", claimId: "C", partition: "two" },
    { id: "A", claimId: "C", partition: "one", required: false }
  ]}).map((row) => row.id), ["A", "B"]);
});

test("signed hidden verdict exposes only case metadata and digests", () => {
  const result = validateSemanticAcceptanceEnvelope({
    envelope: envelope(), config, changeId: "window-fix",
    provider: "hidden-acceptance", workspaceHash: "sha256:workspace"
  });
  assert.equal(result.valid, true);
  assert.equal(result.status, "pass");
  assert.match(result.verdictDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result.cases[0]).sort(), [
    "claimId", "id", "observationDigest", "partition", "status", "transition"
  ]);
});

test("a required failed or mismatched hidden case cannot pass", () => {
  const failed = validateSemanticAcceptanceEnvelope({
    envelope: envelope("fail"), config, changeId: "window-fix",
    provider: "hidden-acceptance", workspaceHash: "sha256:workspace"
  });
  assert.equal(failed.valid, true);
  assert.equal(failed.status, "fail");
  assert.match(validateSemanticAcceptanceEnvelope({
    envelope: envelope(), config, changeId: "other",
    provider: "hidden-acceptance", workspaceHash: "sha256:workspace"
  }).reason, /does not match/);
});

test("tampering with a signed observation is rejected", () => {
  const value = envelope();
  value.payload.cases[0].observationDigest = "b".repeat(64);
  assert.match(validateSemanticAcceptanceEnvelope({
    envelope: value, config, changeId: "window-fix",
    provider: "hidden-acceptance", workspaceHash: "sha256:workspace"
  }).reason, /signature is invalid/);
});

test("a declared defect reproduction cannot pass without FAIL-to-PASS evidence", () => {
  const value = envelope();
  delete value.payload.cases[0].transition;
  value.signature = sign(null, Buffer.from(canonicalJson(value.payload)), privateKey)
    .toString("base64");
  assert.match(validateSemanticAcceptanceEnvelope({
    envelope: value, config, changeId: "window-fix",
    provider: "hidden-acceptance", workspaceHash: "sha256:workspace"
  }).reason, /FAIL-to-PASS/);
});
