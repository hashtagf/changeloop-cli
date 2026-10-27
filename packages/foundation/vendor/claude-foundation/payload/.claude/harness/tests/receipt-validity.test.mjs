import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReceiptValidity, validityRecovery } from
  "../runtime/evidence/receipt-validity.mjs";
import { canonicalJson } from "../runtime/core/trust.mjs";
import { validateSemanticAcceptanceEnvelope } from
  "../runtime/evidence/semantic-acceptance.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-receipt-validity-"));
const evidenceVault = join(root, "evidence");
const id = "change-a";
const receipts = new Map();
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const pathFor = (_id, provider) => join(root, `${provider}.json`);
const semanticKeys = generateKeyPairSync("ed25519");
const configs = {
  test: { capability: "test", criticalCases: ["CASE-1"] },
  review: { capability: "review" },
  acceptance: { capability: "acceptance" },
  semantic: {
    capability: "semantic-acceptance", adapter: "external",
    semanticAcceptance: {
      issuer: "hidden-oracle",
      publicKey: semanticKeys.publicKey.export({ type: "spki", format: "pem" })
    },
    acceptanceCases: [{
      id: "CASE-SEMANTIC", claimId: "claim-a", partition: "fractional",
      required: true
    }]
  }
};
const world = {
  prototype: false, inputMode: "workspace",
  provenance: { complete: true, independent: true, diverse: true },
  reviewPolicy: { independence: "required", diversity: "required" },
  attemptValid: true, acceptance: { reason: "approved scope" },
  workspaceHash: "workspace-current", contractFingerprint: "contract-current",
  diffIdentity: "diff-current", packetReviewHash: "packet-current"
};

const put = (provider, value) => {
  const path = pathFor(id, provider);
  writeFileSync(path, "{}\n");
  receipts.set(path, value);
};
const remove = (provider) => {
  rmSync(pathFor(id, provider), { force: true });
  receipts.delete(pathFor(id, provider));
};
const fingerprint = (_id, provider) => `fingerprint-${provider}`;
const inputIdentity = (_id, provider, _config, workspaceHash) => ({
  mode: world.inputMode, fingerprint: `input-${provider}-${workspaceHash}`
});
const baseReceipt = (provider = "test") => ({
  provider, providerProtocolVersion: "1", adapterProtocolVersion: "1",
  providerFingerprint: fingerprint(id, provider),
  contractFingerprint: world.contractFingerprint,
  workspaceHash: world.workspaceHash,
  inputIdentity: inputIdentity(id, provider, configs[provider], world.workspaceHash),
  claims: ["claim-a"], status: "pass", execution: "harness",
  artifacts: [{ type: "command-log", required: true, valid: true }]
});
const externalFingerprint = (value) => stableHash({
  adapterProtocolVersion: value.adapterProtocolVersion || "1",
  providerProtocolVersion: "1", provider: value.provider,
  adapter: value.adapter || "external",
  adapterVersion: String(value.providerVersion || "1"),
  command: value.command || null, claims: value.claims || [],
  environment: value.environment || null,
  inputMode: value.capability?.inputMode || null,
  project: value.project || null
});
const externalReceipt = () => {
  const value = {
    ...baseReceipt("external"), execution: "external", observed: "observed",
    provenance: { source: "ci" }, references: ["run:1"], artifacts: []
  };
  value.providerFingerprint = externalFingerprint(value);
  return value;
};

mkdirSync(join(evidenceVault, id, "review-attempts"), { recursive: true });
writeFileSync(join(evidenceVault, id, "review-attempts", "attempt-123456789abc.json"), "{}\n");

const { receiptValidity } = createReceiptValidity({
  evidenceVault, providerProtocolVersion: "1", adapterProtocolVersion: "1",
  reviewProtocolVersion: "3", acceptanceProtocolVersion: "2",
  receiptPath: pathFor,
  readJson: (path, fallback) => receipts.get(path) ?? fallback,
  receiptPrototypeEvidence: () => world.prototype,
  contractFingerprint: () => world.contractFingerprint,
  providerConfig: (_id, provider) => configs[provider],
  providerCapability: (provider, config) => config?.capability || provider,
  reviewProvenanceResult: () => world.provenance,
  reviewPolicy: () => world.reviewPolicy,
  reviewAttemptByDigest: () => ({ id: "attempt" }),
  reviewAttemptIsValid: () => world.attemptValid,
  resolvedAcceptance: () => world.acceptance,
  claimsForProvider: () => [{ id: "claim-a" }], stableHash,
  adapterFingerprint: fingerprint,
  providerWorkspaceHash: () => world.workspaceHash,
  providerInputIdentity: inputIdentity,
  validateArtifact: (artifact) => artifact.valid !== false,
  relevantHash: () => world.workspaceHash,
  relevantSnapshot: () => ({ packetReviewHash: world.packetReviewHash }),
  changeDiffIdentity: () => world.diffIdentity
});

const validity = (provider, value) => {
  put(provider, value);
  return receiptValidity(id, provider).validity;
};
const expect = (provider, value, expected) =>
  assert.equal(validity(provider, value), expected, `${provider} -> ${expected}`);

try {
  remove("test");
  assert.equal(receiptValidity(id, "test").validity, "missing");
  for (const [mutate, expected] of [
    [(value) => { value.providerProtocolVersion = "0"; }, "provider-version-stale"],
    [(value) => { value.contractFingerprint = "old"; }, "contract-stale"]
  ]) {
    const value = baseReceipt();
    mutate(value);
    expect("test", value, expected);
  }
  world.prototype = true;
  expect("test", baseReceipt(), "prototype-evidence");
  world.prototype = false;
  expect("test", baseReceipt(), "valid");

  const stale = baseReceipt();
  stale.workspaceHash = "workspace-old";
  stale.inputIdentity.fingerprint = "input-old";
  expect("test", stale, "stale");
  world.inputMode = "declared";
  const reusableInputs = baseReceipt();
  reusableInputs.workspaceHash = "workspace-old";
  reusableInputs.inputIdentity = inputIdentity(id, "test", configs.test, world.workspaceHash);
  expect("test", reusableInputs, "reusable-inputs");
  world.inputMode = "workspace";

  const reviewBase = () => ({
    ...baseReceipt("review"), reviewProtocolVersion: "3",
    review: {
      attemptDigest: "123456789abcdef", findings: { unresolvedBlockers: 0 }
    }
  });
  expect("review", reviewBase(), "valid");
  const reviewVersion = reviewBase();
  reviewVersion.reviewProtocolVersion = "2";
  expect("review", reviewVersion, "review-version-stale");
  world.provenance = { complete: false, independent: true, diverse: true };
  expect("review", reviewBase(), "review-not-independent");
  world.provenance = { complete: true, independent: false, diverse: true };
  expect("review", reviewBase(), "review-not-independent");
  world.reviewPolicy.independence = "self";
  expect("review", reviewBase(), "valid");
  world.reviewPolicy.independence = "required";
  world.provenance = { complete: true, independent: true, diverse: true };
  const missingAttempt = reviewBase();
  missingAttempt.review.attemptDigest = "missing-digest";
  expect("review", missingAttempt, "review-attempt-history-missing");
  world.attemptValid = false;
  expect("review", reviewBase(), "review-attempt-history-invalid");
  world.attemptValid = true;
  world.provenance.diverse = false;
  expect("review", reviewBase(), "review-not-diverse");
  world.provenance.diverse = true;
  const blockers = reviewBase();
  blockers.review.findings.unresolvedBlockers = 1;
  expect("review", blockers, "review-blockers");

  const movedReview = reviewBase();
  movedReview.workspaceHash = "workspace-old";
  movedReview.inputIdentity.fingerprint = "old-input";
  movedReview.rebind = {
    mode: "diff", diffIdentity: world.diffIdentity,
    packetReviewHash: world.packetReviewHash
  };
  expect("review", movedReview, "reusable-diff");
  const reboundReview = reviewBase();
  reboundReview.workspaceHash = "workspace-old";
  reboundReview.inputIdentity.fingerprint = "old-input";
  reboundReview.rebind = { boundWorkspaceHash: world.workspaceHash };
  expect("review", reboundReview, "valid");

  const bound = baseReceipt("test");
  put("test", bound);
  const binding = {
    provider: "test", caseId: "CASE-1", claimId: "claim-a",
    receiptDigest: stableHash(bound)
  };
  const closureReview = () => {
    const value = reviewBase();
    value.review.repairClosure = { evidenceBindings: [structuredClone(binding)] };
    return value;
  };
  expect("review", closureReview(), "valid");
  for (const mutate of [
    (row) => { row.provider = ""; },
    (row) => { row.provider = "review"; },
    (row) => { row.provider = "missing"; },
    (row) => { row.caseId = "OTHER"; },
    (row) => { row.claimId = "missing"; },
    (row) => { row.receiptDigest = "bad"; }
  ]) {
    const value = closureReview();
    mutate(value.review.repairClosure.evidenceBindings[0]);
    expect("review", value, "review-repair-evidence-stale");
  }
  for (const mutateBound of [
    (value) => { value.status = "fail"; },
    (value) => { value.workspaceHash = "old"; },
    (value) => { value.contractFingerprint = "old"; },
    (value) => { value.providerProtocolVersion = "0"; },
    (value) => { delete value.providerProtocolVersion; },
    (value) => { value.adapterProtocolVersion = "0"; },
    (value) => { delete value.adapterProtocolVersion; },
    (value) => { value.providerFingerprint = "old"; },
    (value) => { value.inputIdentity.fingerprint = "old"; },
    (value) => { value.claims = []; },
    (value) => { value.artifacts[0].valid = false; },
    (value) => { value.artifacts = []; },
    (value) => { delete value.artifacts; }
  ]) {
    const changed = structuredClone(bound);
    mutateBound(changed);
    put("test", changed);
    const value = closureReview();
    value.review.repairClosure.evidenceBindings[0].receiptDigest = stableHash(changed);
    expect("review", value, "review-repair-evidence-stale");
  }
  put("test", bound);

  const acceptanceBase = () => ({
    ...baseReceipt("acceptance"), acceptanceProtocolVersion: "2",
    acceptance: {
      actor: { type: "human", identity: "operator" }, decision: "accept",
      criteria: ["criterion-a"], subjectWorkspaceHash: world.workspaceHash,
      reason: world.acceptance.reason
    }
  });
  expect("acceptance", acceptanceBase(), "valid");
  const acceptanceVersion = acceptanceBase();
  acceptanceVersion.acceptanceProtocolVersion = "1";
  expect("acceptance", acceptanceVersion, "acceptance-version-stale");
  for (const mutate of [
    (value) => { value.acceptance.actor.type = "ai"; },
    (value) => { value.acceptance.actor.identity = ""; },
    (value) => { value.acceptance.decision = "reject"; },
    (value) => { value.acceptance.criteria = null; },
    (value) => { value.acceptance.criteria = []; },
    (value) => { value.acceptance.criteria = [""]; },
    (value) => { value.acceptance.criteria = ["same", "same"]; },
    (value) => { value.claims = []; },
    (value) => { value.acceptance.subjectWorkspaceHash = "old"; },
    (value) => { value.acceptance.reason = "other"; }
  ]) {
    const value = acceptanceBase();
    mutate(value);
    expect("acceptance", value, "acceptance-invalid");
  }

  const semanticEnvelope = (() => {
    const payload = {
      version: "1", changeId: id, provider: "semantic",
      workspaceHash: world.workspaceHash, issuer: "hidden-oracle",
      cases: [{
        id: "CASE-SEMANTIC", claimId: "claim-a", partition: "fractional",
        status: "pass", observationDigest: "a".repeat(64)
      }]
    };
    return {
      version: "1", payload,
      signature: sign(null, Buffer.from(canonicalJson(payload)),
        semanticKeys.privateKey).toString("base64")
    };
  })();
  const semanticResult = validateSemanticAcceptanceEnvelope({
    envelope: semanticEnvelope, config: configs.semantic, changeId: id,
    provider: "semantic", workspaceHash: world.workspaceHash
  });
  const semanticBase = () => ({
    ...baseReceipt("semantic"), execution: "manual", observed: "1 hidden case passed",
    provenance: { source: "signed-oracle:hidden-oracle" },
    references: [`semantic-verdict:sha256:${semanticResult.verdictDigest}`],
    artifacts: [], semanticAcceptanceProtocolVersion: "1",
    semanticAcceptance: {
      issuer: semanticResult.issuer,
      verdictDigest: semanticResult.verdictDigest,
      subjectWorkspaceHash: world.workspaceHash,
      cases: semanticResult.cases,
      sourceBindings: [],
      signedEnvelope: semanticEnvelope
    }
  });
  expect("semantic", semanticBase(), "valid");
  const tamperedSemantic = semanticBase();
  tamperedSemantic.semanticAcceptance.signedEnvelope.payload.cases[0].observationDigest =
    "b".repeat(64);
  expect("semantic", tamperedSemantic, "semantic-acceptance-invalid");
  const movedSemantic = semanticBase();
  movedSemantic.workspaceHash = "workspace-old";
  expect("semantic", movedSemantic, "stale");

  for (const [mutate, expected] of [
    [(value) => { value.providerFingerprint = "old"; }, "provider-fingerprint-stale"],
    [(value) => { value.inputIdentity.fingerprint = "old"; }, "provider-inputs-stale"],
    [(value) => { value.status = "fail"; }, "fail"],
    [(value) => { value.claims = []; }, "incomplete-claims"],
    [(value) => { value.artifacts[0].valid = false; }, "invalid-artifacts"],
    [(value) => { value.artifacts = []; }, "execution-log-missing"]
  ]) {
    const value = baseReceipt();
    mutate(value);
    expect("test", value, expected);
  }

  expect("external", externalReceipt(), "valid");
  const richExternal = externalReceipt();
  delete richExternal.adapterProtocolVersion;
  richExternal.adapter = "remote-cli";
  richExternal.providerVersion = 2;
  richExternal.command = "verify --remote";
  richExternal.environment = { region: "test" };
  richExternal.capability = { inputMode: "declared" };
  richExternal.project = "example";
  richExternal.providerFingerprint = externalFingerprint(richExternal);
  expect("external", richExternal, "valid");
  const noClaims = externalReceipt();
  delete noClaims.claims;
  noClaims.providerFingerprint = externalFingerprint(noClaims);
  expect("external", noClaims, "incomplete-claims");
  for (const [mutate, expected] of [
    [(value) => { value.observed = ""; }, "external-observation-missing"],
    [(value) => { value.provenance = {}; }, "external-provenance-missing"],
    [(value) => { value.references = []; }, "external-evidence-missing"]
  ]) {
    const value = externalReceipt();
    mutate(value);
    expect("external", value, expected);
  }

  assert.match(validityRecovery("fail", id, "test"), /executed and failed/);
  assert.match(validityRecovery("review-version-stale", id, "review"), /current protocol/);
  assert.equal(validityRecovery("unknown", id, "test"),
    `re-run: claude-foundation proof run ${id}`);
  console.log("receipt validity tests: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
