import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHostAttestationRuntime } from "../runtime/evidence/attestation.mjs";
import { canonicalJson } from "../runtime/core/trust.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-attestation-validity-"));
const attestations = join(root, "attestations");
const changeDir = join(root, "change");
const trustPath = join(root, "trusted-hosts.json");
const attestationPath = join(root, "attestation.json");
const id = "change-a";
const issuer = "fixture-host";
const priorTesting = process.env.FOUNDATION_TESTING;
const priorTrustRoot = process.env.FOUNDATION_TEST_TRUST_ROOT;
const priorConsoleError = console.error;
process.env.FOUNDATION_TESTING = "1";
process.env.FOUNDATION_TEST_TRUST_ROOT = trustPath;
console.error = () => {};
mkdirSync(changeDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const trustDocument = {
  version: 1,
  issuers: {
    [issuer]: {
      algorithm: "ed25519",
      publicKey: publicKey.export({ type: "spki", format: "pem" })
    }
  }
};
const writeTrustDocument = (value = trustDocument) =>
  writeFileSync(trustPath, `${JSON.stringify(value, null, 2)}\n`);
writeTrustDocument();
chmodSync(trustPath, 0o600);

const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const writer = { mode: "normal" };
const runtime = createHostAttestationRuntime({
  root, attestations, protocolVersion: "1", loadRuntime: () => ({}),
  changePath: () => changeDir, directoryHash: () => "agreement-current",
  stableHash, readJson, writeJson, now: () => new Date().toISOString(),
  writeFileExclusive: (...args) => {
    if (writer.mode !== "normal") {
      const error = new Error(writer.mode);
      error.code = writer.mode;
      throw error;
    }
    return writeFileSync(...args);
  }
});
const challenge = runtime.createChallenge(id);
const basePayload = () => ({
  version: 1, issuer, changeId: id, projectRoot: root,
  agreementHash: challenge.agreementHash, nonce: challenge.nonce,
  permissions: structuredClone(challenge.requiredPermissions),
  issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt
});
const envelope = (payload, signature) => ({
  version: 1, payload,
  signature: signature ?? sign(null, Buffer.from(canonicalJson(payload)), privateKey)
    .toString("base64")
});
const writeEnvelope = (payload, signature) => {
  writeJson(attestationPath, envelope(payload, signature));
  return attestationPath;
};
const resultFor = (mutate = () => {}) => {
  const payload = basePayload();
  mutate(payload);
  return runtime.validate(id, writeEnvelope(payload));
};

try {
  assert.match(runtime.validate(id).reason, /was not supplied/);
  assert.match(runtime.validate(id, join(root, "missing.json")).reason, /file is missing/);
  for (const value of [
    {}, { version: 2, payload: basePayload(), signature: "x" },
    { version: 1, payload: null, signature: "x" },
    { version: 1, payload: basePayload(), signature: null }
  ]) {
    writeJson(attestationPath, value);
    assert.match(runtime.validate(id, attestationPath).reason, /envelope is malformed/);
  }

  chmodSync(trustPath, 0o622);
  assert.match(resultFor().reason, /is not trusted/);
  chmodSync(trustPath, 0o600);
  for (const invalidRoot of [
    { ...trustDocument, version: 2 },
    { version: 1, issuers: null },
    { version: 1, issuers: { [issuer]: { algorithm: "rsa", publicKey: "PUBLIC KEY" } } },
    { version: 1, issuers: { [issuer]: { algorithm: "ed25519", publicKey: "invalid" } } }
  ]) {
    writeTrustDocument(invalidRoot);
    assert.match(resultFor().reason, /is not trusted/);
  }
  writeTrustDocument();

  assert.match(resultFor((payload) => { payload.issuer = "unknown"; }).reason,
    /is not trusted/);
  assert.match(runtime.validate(id, writeEnvelope(basePayload(), "bad")).reason,
    /signature is invalid/);

  const challengeMutations = [
    (payload) => { payload.version = 2; },
    (payload) => { payload.nonce = "other"; },
    (payload) => { payload.changeId = "other"; },
    (payload) => { payload.projectRoot = "/other"; },
    (payload) => { payload.agreementHash = "other"; }
  ];
  for (const mutate of challengeMutations)
    assert.match(resultFor(mutate).reason, /does not match the current challenge/);
  const challengePath = join(attestations, "challenges", `${id}.json`);
  writeJson(challengePath, { ...challenge, version: 2 });
  assert.match(resultFor().reason, /does not match the current challenge/);
  writeJson(challengePath, { ...challenge, agreementHash: "other" });
  assert.match(resultFor().reason, /does not match the current challenge/);
  writeJson(challengePath, challenge);

  const now = Date.now();
  const lifetimeMutations = [
    (payload) => { payload.issuedAt = "invalid"; },
    (payload) => { delete payload.issuedAt; },
    (payload) => { payload.expiresAt = "invalid"; },
    (payload) => { delete payload.expiresAt; },
    (payload) => { payload.issuedAt = new Date(now + 120_000).toISOString(); },
    (payload) => { payload.expiresAt = new Date(now - 1_000).toISOString(); },
    (payload) => {
      payload.issuedAt = new Date(now).toISOString();
      payload.expiresAt = new Date(now + 16 * 60_000).toISOString();
    },
    (payload) => {
      payload.expiresAt = new Date(Date.parse(challenge.expiresAt) + 1_000).toISOString();
    }
  ];
  for (const mutate of lifetimeMutations)
    assert.match(resultFor(mutate).reason, /lifetime is invalid or expired/);
  const challengeWithoutExpiry = structuredClone(challenge);
  delete challengeWithoutExpiry.expiresAt;
  writeJson(challengePath, challengeWithoutExpiry);
  assert.equal(resultFor().valid, true,
    "legacy challenges without expiresAt retain their established lifetime behavior");
  writeJson(challengePath, challenge);

  assert.match(resultFor((payload) => { delete payload.permissions; }).reason,
    /permission mismatch/);
  assert.match(resultFor((payload) => { payload.permissions.network = "open"; }).reason,
    /permission mismatch: network/);
  assert.equal(resultFor().valid, true);

  const consumable = basePayload();
  consumable.nonce = "consume-once";
  const consumablePath = writeEnvelope(consumable);
  assert.equal(runtime.validate(id, consumablePath, true).valid, false,
    "a changed nonce does not bypass challenge binding");
  consumable.nonce = challenge.nonce;
  writeEnvelope(consumable);
  assert.equal(runtime.validate(id, attestationPath, true).valid, true);
  assert.match(runtime.validate(id, attestationPath).reason, /already consumed/);

  rmSync(join(attestations, "used"), { recursive: true, force: true });
  writer.mode = "EEXIST";
  assert.match(runtime.validate(id, writeEnvelope(basePayload()), true).reason,
    /already consumed/);
  writer.mode = "EIO";
  assert.throws(() => runtime.validate(id, writeEnvelope(basePayload()), true),
    (error) => error.code === "EIO");
  writer.mode = "normal";

  const preflight = runtime.preflight(id, { attestation: writeEnvelope(basePayload()) });
  assert.equal(preflight.attestation.valid, true);
  assert.equal(Array.isArray(preflight.reasons), true);
  console.log("attestation validity tests: PASS");
} finally {
  if (priorTesting === undefined) delete process.env.FOUNDATION_TESTING;
  else process.env.FOUNDATION_TESTING = priorTesting;
  if (priorTrustRoot === undefined) delete process.env.FOUNDATION_TEST_TRUST_ROOT;
  else process.env.FOUNDATION_TEST_TRUST_ROOT = priorTrustRoot;
  console.error = priorConsoleError;
  rmSync(root, { recursive: true, force: true });
}
