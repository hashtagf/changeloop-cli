import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  approvedGroundingRevision, createReceiptRuntime, groundedRepairBinding,
  repairClosureFindings
} from "../runtime/evidence/receipt-runtime.mjs";
import { createReceiptValidity } from "../runtime/evidence/receipt-validity.mjs";
import { createReviewAttemptStore } from "../runtime/evidence/review-attempt-store.mjs";
import { createReviewProtocol } from "../runtime/evidence/review-protocol.mjs";

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");
const root = mkdtempSync(join(tmpdir(), "foundation-review-repair-"));
const id = "repair-final-delta";
const receiptsRoot = join(root, ".foundation", "receipts");
const evidenceVault = join(root, ".foundation", "evidence");
const receiptPath = (changeId, provider) =>
  join(receiptsRoot, changeId, `${provider}.json`);
const readJson = (path, fallback = undefined) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (fallback !== undefined) return fallback; throw error; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const fail = (message) => { throw new Error(message); };
const now = () => "2026-08-14T12:00:00.000Z";
let state = { id, changeId: id, status: "proving", reviewHistory: null,
  groundingDigest: "grounding-current", groundingReopens: [] };
let workspaceHash = "workspace-reviewed";
const configs = {
  test: {
    capability: "test", adapter: "command",
    criticalCases: ["CASE-FINAL-DEFECT"]
  },
  review: { capability: "review", adapter: "external" }
};
const providerConfig = (_id, provider) => configs[provider] || null;
const providerCapability = (provider, config = providerConfig(id, provider)) =>
  config?.capability || provider;
const claimsForProvider = () => [{ id: "claim-final" }];
const providerWorkspaceHash = () => workspaceHash;
const providerInputIdentity = (_id, provider, _config, hash) => ({
  mode: "global", patterns: [], files: [],
  fingerprint: stableHash({ provider, workspaceHash: hash })
});
const adapterFingerprint = (_id, provider) => stableHash({ provider });
let contractDigest = "contract-fingerprint";
const contractFingerprint = () => contractDigest;
const reviewPolicy = () => ({
  tier: "high", maxAiAttempts: 2,
  independence: "required", diversity: "preferred"
});

const legacyFinding = {
  id: "F-LEGACY", severity: "major",
  path: "root/app.mjs", line: 2, message: "legacy finding"
};
const grounding = {
  version: 2,
  claims: [{
    id: "claim-final",
    productionPath: [{ repository: "root", path: "app.mjs" }],
    failurePaths: []
  }],
  criticalCases: [{
    id: "CASE-FINAL-DEFECT", claimIds: ["claim-final"]
  }]
};
assert.deepEqual(groundedRepairBinding(grounding, legacyFinding), {
  claimIds: ["claim-final"],
  verificationCaseIds: ["CASE-FINAL-DEFECT"],
  source: "grounding-v2-path"
});
assert.deepEqual(repairClosureFindings([legacyFinding], (finding) =>
  groundedRepairBinding(grounding, finding))[0], {
  ...legacyFinding,
  claimIds: ["claim-final"],
  verificationCaseIds: ["CASE-FINAL-DEFECT"],
  bindingSource: "grounding-v2-path"
});
assert.equal(approvedGroundingRevision({
  groundingDigest: "grounding-current",
  groundingReopens: [{
    completedAt: "2026-08-14T12:00:00.000Z",
    newDigest: "grounding-current",
    contractFingerprint: "different-contract"
  }]
}, "contract-fingerprint"), null,
"a prior Decision Sheet cannot authorize later unbound contract drift");
assert.equal(approvedGroundingRevision({
  groundingDigest: "grounding-current",
  groundingReopens: [{
    completedAt: "2026-08-14T12:00:00.000Z",
    newDigest: "grounding-current",
    contractFingerprint: "contract-fingerprint"
  }]
}, "contract-fingerprint")?.contractFingerprint, "contract-fingerprint");

try {
  const protocol = createReviewProtocol({ stableHash, fail });
  const attemptStore = createReviewAttemptStore({
    receiptsRoot, evidenceVault, readJson, writeJson,
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    stableHash, reviewReceiptBinding: protocol.receiptBinding, now,
    blockWithDecision: (_changeId, kind) => fail(kind), fail
  });
  const full = attemptStore.dispatchReviewAttempt(id, {
    reviewerType: "ai", reviewerIdentity: "reviewer-one",
    reviewerProviderFamily: "anthropic", reviewerModelFamily: "claude",
    reviewerModelId: "claude-opus", reviewerSessionId: "session-one",
    requestId: "request-one", workspaceHash,
    scope: { mode: "full", paths: ["root/app.mjs"], digest: "full-scope" },
    packetDigest: "packet-one", maxAiAttempts: 2
  });
  const fullResult = attemptStore.completeReviewAttempt(id, full.digest, {
    reviewerSessionId: "session-one", resultStatus: "fail",
    findings: [{
      id: "F-FIRST", severity: "major", path: "app.mjs", line: 1,
      message: "initial defect"
    }], verifiedFindingIds: []
  });
  workspaceHash = "workspace-delta";
  const delta = attemptStore.dispatchReviewAttempt(id, {
    reviewerType: "ai", reviewerIdentity: "reviewer-two",
    reviewerProviderFamily: "google", reviewerModelFamily: "gemini",
    reviewerModelId: "gemini-pro", reviewerSessionId: "session-two",
    requestId: "request-two", workspaceHash,
    scope: {
      mode: "delta", baseAttemptDigest: fullResult.digest,
      paths: ["root/app.mjs"], digest: "delta-scope"
    },
    packetDigest: "packet-two", maxAiAttempts: 2
  });
  const deltaResult = attemptStore.completeReviewAttempt(id, delta.digest, {
    reviewerSessionId: "session-two", resultStatus: "fail",
    findings: [{
      id: "F-FINAL", severity: "major", path: "app.mjs", line: 2,
      message: "final bounded defect",
      claimIds: ["claim-final"],
      verificationCaseIds: ["CASE-FINAL-DEFECT"]
    }],
    verifiedFindingIds: ["F-FIRST"]
  });
  writeJson(receiptPath(id, "review"), {
    version: 7,
    changeId: id,
    provider: "review",
    status: "fail",
    workspaceHash,
    contractFingerprint: contractFingerprint(),
    review: {
      attemptDigest: deltaResult.digest,
      subjects: [{ type: "human", identity: "developer-one" }]
    }
  });

  workspaceHash = "workspace-fixed";
  const testReceipt = {
    version: 7,
    changeId: id,
    provider: "test",
    providerProtocolVersion: "1",
    adapterProtocolVersion: "1",
    providerFingerprint: adapterFingerprint(id, "test"),
    contractFingerprint: contractFingerprint(),
    workspaceHash,
    inputIdentity: providerInputIdentity(id, "test", configs.test, workspaceHash),
    claims: ["claim-final"],
    status: "pass",
    execution: "harness",
    artifacts: [{ path: "test.log", type: "command-log", required: true }]
  };
  writeJson(receiptPath(id, "test"), testReceipt);

  const { receiptValidity } = createReceiptValidity({
    evidenceVault,
    providerProtocolVersion: "1",
    adapterProtocolVersion: "1",
    reviewProtocolVersion: "3",
    acceptanceProtocolVersion: "1",
    receiptPath,
    readJson,
    receiptPrototypeEvidence: () => false,
    contractFingerprint,
    providerConfig,
    providerCapability,
    reviewProvenanceResult: protocol.provenanceResult,
    reviewPolicy,
    reviewAttemptByDigest: attemptStore.reviewAttemptByDigest,
    reviewAttemptIsValid: protocol.attemptIsValid,
    resolvedAcceptance: () => ({ required: false }),
    claimsForProvider,
    stableHash,
    adapterFingerprint,
    providerWorkspaceHash,
    providerInputIdentity,
    validateArtifact: () => true,
    relevantHash: () => workspaceHash
  });
  const receipts = createReceiptRuntime({
    ROOT: root,
    LOGS: join(root, ".foundation", "logs"),
    PROVIDERS: new Set(["test", "review"]),
    INPUT_MODES: new Set(),
    providerWorkspace: () => root,
    ADAPTER_PROTOCOL_VERSION: "1",
    PROVIDER_PROTOCOL_VERSION: "1",
    REVIEW_PROTOCOL_VERSION: "3",
    ACCEPTANCE_PROTOCOL_VERSION: "1",
    validate: () => {},
    relevantHash: () => workspaceHash,
    requiredProviders: () => ["test", "review"],
    advisoryCapabilities: () => [],
    receiptValidity,
    now,
    writeJson,
    receiptPath,
    providerConfig,
    providerCapability,
    loadRuntime: () => state,
    resolvedAcceptance: () => ({ required: false }),
    evidence: () => ({ claims: [{ id: "claim-final" }] }),
    claimsForProvider,
    providerWorkspaceHash,
    providerRepository: () => null,
    rejectPrototypeEvidenceInputs: () => {},
    durableArtifact: () => fail("closure should not invent an artifact"),
    providerInputIdentity,
    contractFingerprint,
    executionFingerprint: () => "execution-fingerprint",
    stableHash,
    adapterFingerprint,
    environmentDescriptor: () => null,
    reviewPolicy,
    subjectProvenance: protocol.subjectProvenance,
    reviewProvenanceResult: protocol.provenanceResult,
    readJson,
    flagValues: protocol.flagValues,
    reviewHistoryState: attemptStore.reviewHistoryState,
    reserveReviewAttempt: attemptStore.reserveReviewAttempt,
    reviewAttemptByDigest: attemptStore.reviewAttemptByDigest,
    reviewAttemptIsValid: protocol.attemptIsValid,
    reviewReceiptBinding: protocol.receiptBinding,
    recordRepairClosureAttempt: attemptStore.recordRepairClosureAttempt,
    deliveredAiAttempts: attemptStore.deliveredAiAttempts,
    foundationPolicy: () => ({ workflow: { reviewCircuit: "full-delta" } }),
    die: fail
  });

  const closure = receipts.recordDeterministicReviewClosure(id, "review", workspaceHash);
  assert.equal(closure.closed, true);
  assert.equal(attemptStore.deliveredAiAttempts(id).length, 2,
    "deterministic closure does not become a third delivered AI wave");
  const reviewReceipt = readJson(receiptPath(id, "review"));
  assert.equal(reviewReceipt.status, "pass");
  assert.equal(reviewReceipt.review.reviewer.type, "deterministic");
  assert.deepEqual(reviewReceipt.review.findings.verifiedIds, ["F-FINAL"]);
  assert.equal(receiptValidity(id, "review", workspaceHash).validity, "valid");

  contractDigest = "contract-fingerprint-revised";
  workspaceHash = "workspace-revised";
  state.groundingDigest = "grounding-revised";
  state.groundingReopens = [...state.groundingReopens, {
    decisionRef: "decision:approved-follow-up",
    reason: "approved contract revision",
    priorDigest: "grounding-current",
    newDigest: "grounding-revised",
    contractFingerprint: contractDigest,
    completedAt: now()
  }];
  const revisedTestReceipt = {
    ...testReceipt,
    contractFingerprint: contractDigest,
    workspaceHash,
    inputIdentity: providerInputIdentity(id, "test", configs.test, workspaceHash)
  };
  writeJson(receiptPath(id, "test"), revisedTestReceipt);
  const renewed = receipts.recordDeterministicReviewClosure(
    id, "review", workspaceHash);
  assert.equal(renewed.closed, true,
    "an approved later contract revision renews the existing closure lineage");
  assert.equal(attemptStore.deliveredAiAttempts(id).length, 2,
    "renewing deterministic closure never opens another AI wave");
  assert.equal(state.reviewHistory.totalAttempts, 4,
    "a renewed closure is a new immutable deterministic journal entry");
  assert.equal(receiptValidity(id, "review", workspaceHash).validity, "valid");
  assert.equal(readJson(receiptPath(id, "review")).review.repairClosure
    .sourceContractFingerprint, "contract-fingerprint",
  "renewal preserves the original failed-review contract lineage");

  writeJson(receiptPath(id, "test"), {
    ...revisedTestReceipt, observed: "tampered"
  });
  assert.equal(receiptValidity(id, "review", workspaceHash).validity,
    "review-repair-evidence-stale",
    "changing bound critical-case evidence invalidates deterministic closure");

  console.log("review repair closure tests: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
