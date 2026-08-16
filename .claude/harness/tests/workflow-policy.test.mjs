import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createReviewAttemptStore } from "../runtime/evidence/review-attempt-store.mjs";
import { createReviewProtocol } from "../runtime/evidence/review-protocol.mjs";
import { createAuthorityStore } from "../runtime/workflow/authority.mjs";
import { createAuthorityRuntime } from "../runtime/workflow/authority-runtime.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");
const fixture = mkdtempSync(join(tmpdir(), "foundation-review-circuit-"));
let state = { version: 2, changeId: "change-a", reviewHistory: null };
const now = () => "2026-08-13T00:00:00.000Z";
const readJson = (path, fallback = undefined) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return fallback; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const fail = (message) => { throw new Error(message); };
const decisions = [];
const quiet = (fn) => {
  const prior = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = prior; }
};

try {
  let packetSequence = 0;
  let packetMode = "code";
  let riskTier = null;
  let workspaceHash = "workspace-a";
  let reviewSettings = {
    defaultReviewer: "codex-sol",
    diversity: "required",
    independence: "required"
  };
  let configuredReviewSession = "actual-codex-thread";
  let lastConfiguredReviewArgs = null;
  const attemptStore = createReviewAttemptStore({
    receiptsRoot: join(fixture, "receipts"),
    evidenceVault: join(fixture, "evidence"),
    readJson,
    writeJson,
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    stableHash,
    reviewReceiptBinding: stableHash,
    now,
    blockWithDecision: (_id, _kind, decision) => {
      decisions.push(decision);
      const error = new Error(decision.kind);
      error.decision = decision;
      throw error;
    },
    fail
  });
  const authorityStore = createAuthorityStore({
    root: join(fixture, "authority"), protocolVersion: "1",
    readJson, writeJson, now
  });
  const authority = createAuthorityRuntime({
    root: fixture,
    protocolVersion: "1",
    ciEvidenceProtocolVersion: "1",
    authorityStore,
    requiredProviders: () => ["review"],
    providerCapability: () => "review",
    providerConfig: () => ({ capability: "review", adapter: "external" }),
    reviewPacketValue: () => {
      packetSequence += 1;
      const proposal = {
        path: "openspec/changes/change-a/proposal.md",
        workspacePath: fixture,
        relativePath: "proposal.md",
        sha256: packetMode === "contract" ? `proposal-${packetSequence}` : "proposal-stable"
      };
      return {
        version: 1,
        claims: [{ id: "claim-a", scenario: "review the changed behavior" }],
        decisions: { proposal },
        contractArtifacts: { "proposal.md": proposal },
        grounding: { decisionBatch: { status: "locked" } },
        references: {},
        changedSurface: {
          manifest: [
            {
              repositoryId: "root", path: "app.txt", relativePath: "app.txt",
              workspacePath: fixture, kind: "code",
              identity: packetMode === "code" ? `v${packetSequence}` : "app-stable"
            },
            {
              repositoryId: "root", path: "openspec/changes/change-a/proposal.md",
              relativePath: "proposal.md", workspacePath: fixture,
              kind: "contract-artifact", identity: proposal.sha256
            }
          ],
          inspection: [{ repositoryId: "root", workspacePath: fixture, baseHead: "head", paths: ["app.txt"] }]
        }
      };
    },
    loadRuntime: () => state,
    evidence: () => ({ claims: [{ id: "claim-a" }] }),
    resolvedAcceptance: () => ({ required: false }),
    relevantHash: () => workspaceHash,
    validate: () => {},
    pendingTasks: () => [],
    claimsForProvider: () => [{ id: "claim-a" }],
    stableHash,
    now,
    reviewPolicy: () => ({
      independence: "required", diversity: "required", tier: riskTier,
      maxAiAttempts: riskTier === "low" ? 1 : 2
    }),
    readJson,
    expandList: (value) => value,
    listCount: (value) => value.length,
    dispatchReviewAttempt: attemptStore.dispatchReviewAttempt,
    completeReviewAttempt: attemptStore.completeReviewAttempt,
    reviewHistoryState: attemptStore.reviewHistoryState,
    reviewAttempts: attemptStore.reviewAttempts,
    deliveredAiAttempts: attemptStore.deliveredAiAttempts,
    reviewAttemptByDigest: attemptStore.reviewAttemptByDigest,
    assertReviewDispatchAllowed: attemptStore.assertReviewDispatchAllowed,
    foundationPolicy: () => ({
      workflow: { reviewCircuit: "full-delta" },
      review: reviewSettings
    }),
    reviewerConfig: () => ({
      identity: "codex-sol", providerFamily: "openai",
      modelFamily: "gpt-5.6", modelId: "gpt-5.6-sol"
    }),
    runConfiguredReview: (args) => {
      lastConfiguredReviewArgs = args;
      return {
        status: "pass", summary: "configured review passed", findings: [],
        verifiedFindingIds: [], reportReference: "report.json",
        reviewer: { sessionId: configuredReviewSession }
      };
    },
    writeJson,
    receiptPath: (id) => join(fixture, `${id}-receipt.json`),
    recordReceipt: (id, _provider, status, flags) => writeJson(
      join(fixture, `${id}-receipt.json`), {
        status, review: { attemptDigest: flags["review-attempt"] }
      }),
    receiptValidity: () => ({ validity: "valid" }),
    fileDigest: () => "digest",
    providerWorkspaceHash: () => workspaceHash,
    providerRepository: () => null,
    providerWorkspace: () => fixture,
    gitHead: () => "head",
    validateSignedCiEnvelope: () => ({ valid: false }),
    providerClaims: () => ["claim-a"],
    fail
  });

  const requestedOnly = quiet(() => authority.requestAuthority("change-a", { type: "review" }));
  assert.equal(state.reviewHistory?.totalAttempts || 0, 0,
    "requesting review must not consume an attempt");
  quiet(() => authority.abortAuthority("change-a", {
    request: requestedOnly.requestId, reason: "cancel before handoff"
  }));
  assert.equal(state.reviewHistory?.totalAttempts || 0, 0,
    "cancelling an undispatched request must not consume an attempt");

  const firstRequest = quiet(() => authority.requestAuthority("change-a", { type: "review" }));
  const first = quiet(() => authority.dispatchAuthority("change-a", {
    request: firstRequest.requestId,
    scope: "full",
    "reviewer-type": "ai",
    "reviewer-identity": "reviewer-one",
    "reviewer-provider-family": "anthropic",
    "reviewer-model-family": "claude",
    "reviewer-model": "claude-opus",
    "reviewer-session": "review-session-one"
  }));
  assert.equal(state.reviewHistory.aiAttempts, 1,
    "the first AI dispatch must consume an attempt immediately");
  quiet(() => authority.abortAuthority("change-a", {
    request: firstRequest.requestId, reason: "reviewer crashed"
  }));
  assert.equal(state.reviewHistory.aiAttempts, 1,
    "aborting after dispatch must not refund an attempt");

  const secondRequest = quiet(() => authority.requestAuthority("change-a", { type: "review" }));
  assert.throws(() => quiet(() => authority.dispatchAuthority("change-a", {
    request: secondRequest.requestId,
    scope: "delta",
    "base-attempt": first.dispatch.attemptDigest,
    "reviewer-type": "ai",
    "reviewer-identity": "reviewer-two",
    "reviewer-provider-family": "google",
    "reviewer-model-family": "gemini",
    "reviewer-model": "gemini-pro",
    "reviewer-session": "review-session-two"
  })), /requires --scope full/,
  "a crashed dispatch cannot manufacture a completed baseline for delta");
  assert.equal(state.reviewHistory.aiAttempts, 1,
    "a refused dispatch must not consume an attempt");
  const second = quiet(() => authority.dispatchAuthority("change-a", {
    request: secondRequest.requestId,
    scope: "full",
    "reviewer-type": "ai",
    "reviewer-identity": "reviewer-two",
    "reviewer-provider-family": "google",
    "reviewer-model-family": "gemini",
    "reviewer-model": "gemini-pro",
    "reviewer-session": "review-session-two"
  }));
  assert.equal(second.dispatch.scope.mode, "full",
    "the one bounded recovery after a crashed dispatch remains full scope");
  const completedSecond = attemptStore.completeReviewAttempt("change-a",
    second.dispatch.attemptDigest, {
      reviewerSessionId: "review-session-two", resultStatus: "fail",
      findings: [{
        id: "F-RECOVERY", severity: "major", path: "app.txt", line: 1,
        message: "recovery review completed"
      }], verifiedFindingIds: []
    });
  writeJson(join(fixture, "change-a-receipt.json"), {
    status: "fail", review: { attemptDigest: completedSecond.digest }
  });
  quiet(() => authority.abortAuthority("change-a", {
    request: secondRequest.requestId, reason: "review completed out of band"
  }));

  const changeASecondAttemptDigest = completedSecond.digest;
  const thirdRequest = quiet(() => authority.requestAuthority("change-a", { type: "review" }));
  const third = quiet(() => authority.dispatchAuthority("change-a", {
    request: thirdRequest.requestId,
    scope: "delta",
    "base-attempt": completedSecond.digest,
    "reviewer-type": "ai",
    "reviewer-identity": "reviewer-three",
    "reviewer-provider-family": "openai",
    "reviewer-model-family": "gpt",
    "reviewer-model": "gpt-6",
    "reviewer-session": "review-session-three"
  }));
  assert.equal(third.dispatch.scope.mode, "delta",
    "one infrastructure failure does not consume a delivered closure wave");
  const completedThird = attemptStore.completeReviewAttempt("change-a",
    third.dispatch.attemptDigest, {
      reviewerSessionId: "review-session-three", resultStatus: "pass",
      findings: [], verifiedFindingIds: ["F-RECOVERY"]
    });
  writeJson(join(fixture, "change-a-receipt.json"), {
    status: "pass", review: { attemptDigest: completedThird.digest }
  });
  quiet(() => authority.abortAuthority("change-a", {
    request: thirdRequest.requestId, reason: "closure completed out of band"
  }));
  const fourthRequest = quiet(() => authority.requestAuthority("change-a", { type: "review" }));
  assert.throws(() => quiet(() => authority.dispatchAuthority("change-a", {
    request: fourthRequest.requestId, scope: "delta",
    "base-attempt": completedThird.digest, "reviewer-type": "ai",
    "reviewer-identity": "reviewer-four", "reviewer-provider-family": "openai",
    "reviewer-model-family": "gpt", "reviewer-model": "gpt-6",
    "reviewer-session": "review-session-four"
  })), /REVIEW_ROUTE_COMPLETE/,
  "a third delivered AI wave is refused without asking redesign, split, or pause");
  assert.equal(state.reviewHistory.aiAttempts, 3,
    "a blocked extra delivered wave must not mutate dispatch history");

  mkdirSync(join(fixture, ".foundation", "locks", "authority-change-a.lock"), {
    recursive: true
  });
  assert.throws(() => authority.requestAuthority("change-a", { type: "review" }),
    /already in progress/,
    "a concurrent authority mutation must fail before reading or writing review state");
  rmSync(join(fixture, ".foundation", "locks", "authority-change-a.lock"), {
    recursive: true, force: true
  });

  writeJson(join(fixture, ".foundation", "locks", "authority-change-c.lock"), {
    version: 1, pid: 2147483647, token: "dead-owner", acquiredAt: now()
  });
  state = { version: 2, changeId: "change-c", reviewHistory: null };
  const changeCRequest = quiet(() => authority.requestAuthority("change-c", { type: "review" }));
  assert.equal(existsSync(join(fixture, ".foundation", "locks", "authority-change-c.lock")), false,
    "a dead lock owner must be recovered without a manual cleanup loop");
  quiet(() => authority.runAuthorityReviewer("change-c", {
    request: changeCRequest.requestId,
    "subject-actor": "human-implementer"
  }));
  const completedCodex = attemptStore.reviewAttemptByDigest(
    "change-c", state.reviewHistory.chainHead);
  assert.equal(completedCodex.status, "completed");
  assert.equal(completedCodex.reviewerSessionId, "actual-codex-thread",
    "configured review completion binds the real thread.started session");

  state = { version: 2, changeId: "change-d", reviewHistory: null };
  const changeDRequest = quiet(() => authority.requestAuthority("change-d", {
    type: "review"
  }));
  const sameFamilySubject = {
    request: changeDRequest.requestId,
    "subject-actor": "codex-implementer",
    "subject-session": "codex-coding-session",
    "subject-provider-family": "openai",
    "subject-model-family": "gpt-5.6",
    "subject-model": "gpt-5.6-sol"
  };
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-d", sameFamilySubject)), /review\.diversity='single-model'/,
  "same-family review must fail closed until the waiver is committed");
  assert.equal(state.reviewHistory?.totalAttempts || 0, 0,
    "a missing same-family waiver must not consume a review attempt");

  reviewSettings = { ...reviewSettings, diversity: "single-model" };
  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-d", {
    ...sameFamilySubject, "subject-actor": "codex-sol"
  })), /shares the implementation identity/,
  "the same-family waiver must not waive reviewer identity independence");
  assert.equal(state.reviewHistory?.totalAttempts || 0, 0,
    "an identity collision must fail before review dispatch");

  configuredReviewSession = "fresh-codex-review-session";
  quiet(() => authority.runAuthorityReviewer("change-d", sameFamilySubject));
  const completedSameFamily = attemptStore.reviewAttemptByDigest(
    "change-d", state.reviewHistory.chainHead);
  assert.equal(completedSameFamily.status, "completed");
  assert.equal(completedSameFamily.reviewerSessionId,
    "fresh-codex-review-session");
  assert(lastConfiguredReviewArgs.forbiddenSessionIds.includes(
    "codex-coding-session"),
  "authority must pass the implementation session to the reviewer adapter as forbidden");

  const attempts = readdirSync(join(fixture, "evidence", "change-a", "review-attempts"));
  assert.equal(attempts.length, 5,
    "three dispatch journals plus two immutable completion journals are durable");

  const protocol = createReviewProtocol({ stableHash, fail });
  const reviewAttempt = attemptStore.reviewAttemptByDigest(
    "change-a", changeASecondAttemptDigest);
  assert.notEqual(stableHash({ scope: { paths: ["a"] } }),
    stableHash({ scope: { paths: ["b"] } }),
    "test hashing must bind nested scope fields");
  const receipt = {
    workspaceHash: reviewAttempt.workspaceHash,
    status: "fail",
    review: {
      round: reviewAttempt.attempt,
      requestId: reviewAttempt.requestId,
      packetDigest: reviewAttempt.packetDigest,
      reviewer: {
        type: reviewAttempt.reviewerType,
        identity: reviewAttempt.reviewerIdentity,
        providerFamily: reviewAttempt.reviewerProviderFamily,
        modelFamily: reviewAttempt.reviewerModelFamily,
        modelId: reviewAttempt.reviewerModelId,
        sessionId: reviewAttempt.reviewerSessionId
      },
      scope: {
        mode: reviewAttempt.scope.mode,
        baseAttemptDigest: null,
        paths: reviewAttempt.scope.paths,
        dispatchDigest: reviewAttempt.scope.digest,
        digest: stableHash({
          priorWorkspaceHash: null,
          workspaceHash: reviewAttempt.workspaceHash,
          paths: reviewAttempt.scope.paths
        })
      },
      findings: {
        verified: 0,
        unresolvedBlockers: 1,
        items: reviewAttempt.findings,
        verifiedIds: reviewAttempt.verifiedFindingIds
      },
      supersedes: null
    }
  };
  assert.equal(protocol.attemptIsValid(receipt, reviewAttempt), true,
    "a receipt matching the durable dispatch scope is valid");
  receipt.review.scope.paths = ["root/not-dispatched.txt"];
  receipt.review.scope.digest = stableHash({
    priorWorkspaceHash: null,
    workspaceHash: reviewAttempt.workspaceHash,
    paths: receipt.review.scope.paths
  });
  assert.equal(protocol.attemptIsValid(receipt, reviewAttempt), false,
    "direct receipt recording cannot substitute arbitrary scope paths");

  state = { version: 2, changeId: "change-b", reviewHistory: null };
  packetMode = "contract";
  packetSequence = 0;
  const contractFirstRequest = quiet(() => authority.requestAuthority("change-b", { type: "review" }));
  const contractFirst = quiet(() => authority.dispatchAuthority("change-b", {
    request: contractFirstRequest.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "contract-reviewer-one",
    "reviewer-provider-family": "anthropic", "reviewer-model-family": "claude",
    "reviewer-model": "claude-opus", "reviewer-session": "contract-session-one"
  }));
  const completedContractFirst = attemptStore.completeReviewAttempt("change-b",
    contractFirst.dispatch.attemptDigest, {
      reviewerSessionId: "contract-session-one", resultStatus: "fail",
      findings: [{
        id: "F-CONTRACT", severity: "major", path: "proposal.md", line: 1,
        message: "proposal correction required"
      }], verifiedFindingIds: []
    });
  writeJson(join(fixture, "change-b-receipt.json"), {
    status: "fail", review: { attemptDigest: completedContractFirst.digest }
  });
  quiet(() => authority.abortAuthority("change-b", {
    request: contractFirstRequest.requestId, reason: "apply contract correction"
  }));
  const contractSecondRequest = quiet(() => authority.requestAuthority("change-b", { type: "review" }));
  const contractSecond = quiet(() => authority.dispatchAuthority("change-b", {
    request: contractSecondRequest.requestId, scope: "delta",
    "base-attempt": completedContractFirst.digest, "reviewer-type": "ai",
    "reviewer-identity": "contract-reviewer-two",
    "reviewer-provider-family": "google", "reviewer-model-family": "gemini",
    "reviewer-model": "gemini-pro", "reviewer-session": "contract-session-two"
  }));
  assert.deepEqual(Object.keys(contractSecond.packet.decisions), ["proposal"],
    "a contract-only delta must carry the changed proposal");
  assert.deepEqual(contractSecond.packet.changedSurface.inspection[0], {
    repositoryId: "root", workspacePath: fixture, baseHead: "head", paths: ["proposal.md"]
  }, "a contract-only external-copy delta must be self-locating");

  state = { version: 2, changeId: "change-low", reviewHistory: null };
  riskTier = "low";
  packetMode = "code";
  packetSequence = 0;
  const lowRequest = quiet(() => authority.requestAuthority(
    "change-low", { type: "review" }));
  quiet(() => authority.dispatchAuthority("change-low", {
    request: lowRequest.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "low-ai", "reviewer-provider-family": "anthropic",
    "reviewer-model-family": "claude", "reviewer-model": "claude-opus",
    "reviewer-session": "low-ai-session"
  }));
  quiet(() => authority.abortAuthority("change-low", {
    request: lowRequest.requestId, reason: "reviewer crashed"
  }));
  const lowRetry = quiet(() => authority.requestAuthority(
    "change-low", { type: "review" }));
  const lowRecovery = quiet(() => authority.dispatchAuthority("change-low", {
    request: lowRetry.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "low-ai-retry", "reviewer-provider-family": "google",
    "reviewer-model-family": "gemini", "reviewer-model": "gemini-pro",
    "reviewer-session": "low-ai-retry-session"
  }));
  assert.equal(lowRecovery.dispatch.scope.mode, "full",
    "an aborted low-risk provider gets one infrastructure recovery without consuming its review wave");
  quiet(() => authority.abortAuthority("change-low", {
    request: lowRetry.requestId, reason: "recovery provider also failed"
  }));
  const lowThird = quiet(() => authority.requestAuthority(
    "change-low", { type: "review" }));
  assert.throws(() => quiet(() => authority.dispatchAuthority("change-low", {
    request: lowThird.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "low-ai-third", "reviewer-provider-family": "openai",
    "reviewer-model-family": "gpt", "reviewer-model": "gpt-6",
    "reviewer-session": "low-ai-third-session"
  })), /REVIEW_INFRASTRUCTURE_ERROR/,
  "infrastructure recovery remains bounded and never opens a product decision interview");

  state = { version: 2, changeId: "change-low-promoted", reviewHistory: null };
  workspaceHash = "workspace-low-before";
  packetSequence = 0;
  const promotedFirstRequest = quiet(() => authority.requestAuthority(
    "change-low-promoted", { type: "review" }));
  const promotedFirst = quiet(() => authority.dispatchAuthority(
    "change-low-promoted", {
      request: promotedFirstRequest.requestId, scope: "full", "reviewer-type": "ai",
      "reviewer-identity": "low-first", "reviewer-provider-family": "anthropic",
      "reviewer-model-family": "claude", "reviewer-model": "claude-opus",
      "reviewer-session": "low-first-session"
    }));
  const promotedCompleted = attemptStore.completeReviewAttempt(
    "change-low-promoted", promotedFirst.dispatch.attemptDigest, {
      reviewerSessionId: "low-first-session", resultStatus: "fail",
      findings: [{ id: "F-LOW", severity: "major", path: "app.txt", line: 1,
        message: "one correction is required" }], verifiedFindingIds: []
    });
  writeJson(join(fixture, "change-low-promoted-receipt.json"), {
    status: "fail", review: { attemptDigest: promotedCompleted.digest }
  });
  quiet(() => authority.abortAuthority("change-low-promoted", {
    request: promotedFirstRequest.requestId, reason: "apply one correction batch"
  }));
  workspaceHash = "workspace-low-after";
  const promotedSecondRequest = quiet(() => authority.requestAuthority(
    "change-low-promoted", { type: "review" }));
  const promotedSecond = quiet(() => authority.dispatchAuthority(
    "change-low-promoted", {
      request: promotedSecondRequest.requestId, scope: "delta",
      "base-attempt": promotedCompleted.digest, "reviewer-type": "ai",
      "reviewer-identity": "low-second", "reviewer-provider-family": "google",
      "reviewer-model-family": "gemini", "reviewer-model": "gemini-pro",
      "reviewer-session": "low-second-session"
    }));
  assert.equal(promotedSecond.requirements.tier, "medium");
  assert.equal(promotedSecond.requirements.promotionReason, "post-review-correction");
  workspaceHash = "workspace-a";

  state = { version: 2, changeId: "change-high", reviewHistory: null };
  riskTier = "high";
  packetMode = "code";
  packetSequence = 0;
  const highAiRequest = quiet(() => authority.requestAuthority("change-high", { type: "review" }));
  quiet(() => authority.dispatchAuthority("change-high", {
    request: highAiRequest.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "high-ai", "reviewer-provider-family": "anthropic",
    "reviewer-model-family": "claude", "reviewer-model": "claude-opus",
    "reviewer-session": "high-ai-session"
  }));
  quiet(() => authority.abortAuthority("change-high", {
    request: highAiRequest.requestId, reason: "reviewer crashed"
  }));
  const highRecoveryRequest = quiet(() => authority.requestAuthority("change-high", { type: "review" }));
  const highRecovery = quiet(() => authority.dispatchAuthority("change-high", {
    request: highRecoveryRequest.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "high-ai-recovery", "reviewer-provider-family": "google",
    "reviewer-model-family": "gemini", "reviewer-model": "gemini-pro",
    "reviewer-session": "high-ai-recovery-session"
  }));
  assert.equal(highRecovery.dispatch.scope.mode, "full",
    "an aborted high-risk dispatch permits one bounded full AI recovery without a human gate");

  state = { version: 2, changeId: "change-human", reviewHistory: null };
  riskTier = "high";
  const humanRequest = quiet(() => authority.requestAuthority(
    "change-human", { type: "review" }));
  const humanDispatch = quiet(() => authority.dispatchAuthority("change-human", {
    request: humanRequest.requestId, scope: "full", "reviewer-type": "human",
    "reviewer-identity": "security-owner"
  }));
  assert.equal(humanDispatch.dispatch.reviewer.type, "human",
    "a named human remains an explicit reviewer option without becoming a mandatory approval gate");

  state = { version: 2, changeId: "change-review-error", reviewHistory: null };
  const failedAttempt = attemptStore.dispatchReviewAttempt("change-review-error", {
    reviewerType: "ai", reviewerIdentity: "codex-sol",
    reviewerProviderFamily: "openai", reviewerModelFamily: "gpt-5.6",
    reviewerModelId: "gpt-5.6-sol", sessionDeferred: true,
    requestId: "review-error-request", workspaceHash: "workspace-error",
    scope: { mode: "full", paths: ["root/app.txt"], digest: "scope-error" },
    packetDigest: "packet-error", maxAiAttempts: 1
  });
  const failedCompletion = attemptStore.completeReviewAttempt(
    "change-review-error", failedAttempt.digest, {
      reviewerSessionId: null, resultStatus: "error",
      findings: [], verifiedFindingIds: []
    });
  assert.equal(failedCompletion.status, "completed");
  assert.equal(failedCompletion.resultStatus, "error");
  assert.equal(failedCompletion.reviewerSessionId, null);
  assert.equal(attemptStore.deliveredAiAttempts("change-review-error").length, 0,
    "an infrastructure error is not a delivered review baseline");
  const errorRecovery = attemptStore.dispatchReviewAttempt("change-review-error", {
    reviewerType: "ai", reviewerIdentity: "codex-sol",
    reviewerProviderFamily: "openai", reviewerModelFamily: "gpt-5.6",
    reviewerModelId: "gpt-5.6-sol", sessionDeferred: true,
    requestId: "review-error-retry", workspaceHash: "workspace-error",
    scope: { mode: "full", paths: ["root/app.txt"], digest: "scope-error-retry" },
    packetDigest: "packet-error-retry", maxAiAttempts: 1
  });
  assert.equal(errorRecovery.scope.mode, "full",
    "the bounded infrastructure recovery remains a full review without a fake baseline");
  attemptStore.completeReviewAttempt("change-review-error", errorRecovery.digest, {
    reviewerSessionId: null, resultStatus: "error",
    findings: [], verifiedFindingIds: []
  });
  assert.throws(() => attemptStore.dispatchReviewAttempt("change-review-error", {
    reviewerType: "ai", reviewerIdentity: "codex-sol",
    reviewerProviderFamily: "openai", reviewerModelFamily: "gpt-5.6",
    reviewerModelId: "gpt-5.6-sol", sessionDeferred: true,
    requestId: "review-error-third", workspaceHash: "workspace-error",
    scope: { mode: "full", paths: ["root/app.txt"], digest: "scope-error-third" },
    packetDigest: "packet-error-third", maxAiAttempts: 1
  }), /REVIEW_INFRASTRUCTURE_ERROR/);

  state = { version: 2, changeId: "legacy", reviewHistory: null };
  riskTier = null;
  const legacyAttempt = attemptStore.reserveReviewAttempt("legacy", "AI", {
    workspaceHash: "legacy-workspace", status: "pass", reviewBinding: "legacy-binding"
  });
  assert.equal(legacyAttempt.reviewerType, "ai",
    "legacy reserve-on-record must normalize and count the reviewer type");

  const grill = readFileSync(join(root, ".claude/skills/grill-task-gu/SKILL.md"), "utf8");
  assert.match(grill, /Present one Decision[\s\S]*?every material choice/i);
  assert.match(grill, /Assignee and date are non-blocking unless `--schedule`/i);
  const feature = readFileSync(join(root, ".claude/commands/feature.md"), "utf8");
  assert.match(feature, /Low risk uses one full AI review/i);
  assert.match(feature, /Medium permits one correction[\s\S]*one fresh-session delta closure/i);
  assert.match(feature, /High asks material risk decisions in the initial Decision Sheet/i);
  assert.match(feature, /never dispatch a third AI/i);
  const agentContract = readFileSync(join(root, ".claude/harness/AGENT.md"), "utf8");
  assert.match(agentContract, /Before the first packet on a developer machine/i);
  assert.match(agentContract, /runtime API is `20`/);
  const developerSetup = readFileSync(
    join(root, ".claude/harness/DEVELOPER-SETUP.md"), "utf8");
  assert.match(developerSetup, /scripts\/install-foundation-runtime\.mjs/);
  assert.match(developerSetup, /Node\.js 20\.19 or later/);
  const policy = readJson(join(root, "foundation.json"));
  assert.equal(policy.workflow.grounding, "required");
  assert.equal(policy.workflow.reviewCircuit, "full-delta");
  assert.equal(policy.workflow.reviewPolicy, "risk-tiered");
  console.log("workflow policy tests: PASS");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
