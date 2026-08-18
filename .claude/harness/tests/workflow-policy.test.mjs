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
  let configuredReviewResults = {};
  let configuredReviewCalls = 0;
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
      configuredReviewCalls += 1;
      lastConfiguredReviewArgs = args;
      const configuredResult = configuredReviewResults[args.reviewer];
      if (configuredResult) return configuredResult;
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
  assert.equal(attemptStore.reviewAttemptByDigest("change-a",
    state.reviewHistory.chainHead).resultStatus, "error",
  "aborting a dispatched request must durably finalize the attempt as infrastructure error");

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

  state = { version: 2, changeId: "change-fallback", reviewHistory: null };
  reviewSettings = {
    ...reviewSettings, independence: "self", diversity: "single-model",
    fallbackReviewer: "main-session"
  };
  configuredReviewResults = {
    "codex-sol": {
      status: "error", summary: "Codex authentication failed", findings: [],
      verifiedFindingIds: [], reportReference: "codex-error.json",
      reviewer: { sessionId: null }
    }
  };
  const fallbackRequest = quiet(() => authority.requestAuthority(
    "change-fallback", { type: "review" }));
  const priorCodexThread = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = "main-session-thread";
  const handback = quiet(() => authority.runAuthorityReviewer("change-fallback", {
    request: fallbackRequest.requestId,
    "subject-actor": "main-agent",
    "subject-session": "main-session-thread",
    "subject-provider-family": "openai",
    "subject-model-family": "gpt-5.6",
    "subject-model": "gpt-5.6-sol"
  }));
  if (priorCodexThread === undefined) delete process.env.CODEX_THREAD_ID;
  else process.env.CODEX_THREAD_ID = priorCodexThread;
  const fallbackAttempts = attemptStore.reviewAttempts("change-fallback",
    state.reviewHistory);
  assert.equal(fallbackAttempts.filter((attempt) =>
    attempt.status === "completed").length, 1,
  "the failed configured reviewer must be completed before handback");
  const primaryFailure = fallbackAttempts.find((attempt) =>
    attempt.status === "completed" && attempt.resultStatus === "error");
  assert.equal(primaryFailure.reviewerIdentity, "codex-sol");
  assert.equal(handback.status, "needs-main-session-review");
  assert.equal(handback.reviewer.identity, "main-agent");
  assert.equal(handback.reviewer.sessionId, "main-session-thread");
  assert.equal(handback.responseTemplate.evidence["subject-actor"], "main-agent");
  assert.equal(handback.responseTemplate.evidence["subject-session"],
    "main-session-thread");
  const fallbackProtocol = createReviewProtocol({ stableHash, fail });
  const fallbackProvenance = fallbackProtocol.provenanceResult({
    reviewer: {
      type: "ai", identity: handback.reviewer.identity,
      sessionId: handback.reviewer.sessionId,
      providerFamily: handback.reviewer.providerFamily,
      modelFamily: handback.reviewer.modelFamily,
      modelId: handback.reviewer.modelId
    },
    subjects: [{
      type: "ai", identity: "main-agent", sessionId: "main-session-thread",
      providerFamily: "openai", modelFamily: "gpt-5.6",
      modelId: "gpt-5.6-sol"
    }]
  });
  assert.equal(fallbackProvenance.complete, true);
  assert.equal(fallbackProvenance.independent, false,
    "the receipt must truthfully preserve that main-session fallback is self-review");
  assert.equal(fallbackProvenance.diverse, false,
    "the receipt must truthfully preserve that main-session fallback is same-family");
  const fallbackAuthority = authorityStore.list("change-fallback")
    .find((row) => row.value.requestId === fallbackRequest.requestId).value;
  assert.equal(fallbackAuthority.fallbackAttempts.length, 1,
    "the failed primary reviewer must remain visible on the authority request");
  assert.equal(fallbackAuthority.status, "dispatched");
  assert.equal(fallbackAuthority.mainSessionFallback.status, "awaiting-response");
  assert.equal(fallbackAuthority.dispatch.reviewer.identity, "main-agent");
  assert.equal(fallbackAuthority.dispatch.reviewer.sessionId,
    "main-session-thread");
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-fallback", {
      request: fallbackRequest.requestId,
      "subject-actor": "human-implementer"
    })), /complete the reserved main-session fallback/,
  "the handback must not relaunch the failed configured reviewer");
  const mainResponsePath = join(fixture, "main-session-response.json");
  writeJson(mainResponsePath, {
    ...handback.responseTemplate,
    status: "pass",
    evidence: {
      ...handback.responseTemplate.evidence,
      observed: "Main session inspected the bounded packet and found no defect",
      reference: ["https://example.test/main-session-review"]
    }
  });
  quiet(() => authority.recordAuthority("change-fallback", {
    request: fallbackRequest.requestId, response: mainResponsePath
  }));
  const mainSessionCompletion = attemptStore.reviewAttemptByDigest(
    "change-fallback", state.reviewHistory.chainHead);
  assert.equal(mainSessionCompletion.resultStatus, "pass");
  assert.equal(attemptStore.reviewAttempts("change-fallback",
    state.reviewHistory).filter((attempt) =>
      attempt.status === "completed").length, 2,
  "the main-session verdict must append a second truthful completion");
  assert.equal(readJson(join(fixture, "change-fallback-receipt.json")).status,
    "pass", "the main-session response must cross the real authority receipt gate");

  state = { version: 2, changeId: "change-fallback-missing", reviewHistory: null };
  const hostProvenanceKeys = [
    "FOUNDATION_CLAUDE_SESSION_ID", "FOUNDATION_SESSION_ID", "CODEX_THREAD_ID",
    "FOUNDATION_MAIN_SESSION_ID", "FOUNDATION_MAIN_IDENTITY",
    "FOUNDATION_MAIN_PROVIDER_FAMILY", "FOUNDATION_MAIN_MODEL_FAMILY",
    "FOUNDATION_MODEL_ID"
  ];
  const priorHostProvenance = Object.fromEntries(hostProvenanceKeys.map((key) =>
    [key, process.env[key]]));
  for (const key of hostProvenanceKeys) delete process.env[key];
  const missingRequest = quiet(() => authority.requestAuthority(
    "change-fallback-missing", { type: "review" }));
  const missingHandback = quiet(() => authority.runAuthorityReviewer(
    "change-fallback-missing", {
      request: missingRequest.requestId,
      "subject-actor": "human-implementer"
    }));
  for (const key of hostProvenanceKeys) {
    if (priorHostProvenance[key] === undefined) delete process.env[key];
    else process.env[key] = priorHostProvenance[key];
  }
  assert.equal(missingHandback.status,
    "main-session-provenance-unavailable");
  assert(missingHandback.missing.includes("sessionId"));
  assert(missingHandback.missing.includes("modelId"));
  const missingAuthority = authorityStore.list("change-fallback-missing")
    .find((row) => row.value.requestId === missingRequest.requestId).value;
  assert.equal(missingAuthority.status, "requested");
  assert.equal(missingAuthority.mainSessionFallback.status,
    "provenance-unavailable");
  const callsBeforeResume = configuredReviewCalls;
  process.env.CODEX_THREAD_ID = "recovered-main-session";
  const recoveredEvents = join(fixture, ".foundation", "logs",
    "change-fallback-missing", "events.jsonl");
  mkdirSync(dirname(recoveredEvents), { recursive: true });
  writeFileSync(recoveredEvents, `${JSON.stringify({
    runId: "recovered-main-session", sessionId: "recovered-main-session",
    agentId: "telemetry-main-agent", modelId: "gpt-5.6-sol",
    source: "codex"
  })}\n`);
  const resumedHandback = quiet(() => authority.runAuthorityReviewer(
    "change-fallback-missing", {
      request: missingRequest.requestId,
      "subject-actor": "human-implementer"
    }));
  if (priorHostProvenance.CODEX_THREAD_ID === undefined)
    delete process.env.CODEX_THREAD_ID;
  else process.env.CODEX_THREAD_ID = priorHostProvenance.CODEX_THREAD_ID;
  assert.equal(resumedHandback.status, "needs-main-session-review");
  assert.equal(resumedHandback.reviewer.identity, "telemetry-main-agent");
  assert.equal(resumedHandback.reviewer.sessionId, "recovered-main-session");
  assert.equal(resumedHandback.reviewer.providerFamily, "openai");
  assert.equal(resumedHandback.reviewer.modelFamily, "gpt-5.6-sol");
  assert.equal(resumedHandback.reviewer.modelId, "gpt-5.6-sol");
  assert.equal(configuredReviewCalls, callsBeforeResume,
    "provenance recovery must not rerun the failed configured reviewer");

  state = { version: 2, changeId: "change-verdict", reviewHistory: null };
  configuredReviewResults = {
    "codex-sol": {
      status: "fail", summary: "Codex found a product defect", findings: [{
        id: "F-PRODUCT", severity: "major", path: "app.txt", line: 1,
        message: "The implementation violates the contract",
        claimIds: ["claim-a"], verificationCaseIds: ["case-a"]
      }],
      verifiedFindingIds: [], reportReference: "codex-fail.json",
      reviewer: { sessionId: "codex-verdict-thread" }
    }
  };
  const verdictRequest = quiet(() => authority.requestAuthority(
    "change-verdict", { type: "review" }));
  quiet(() => authority.runAuthorityReviewer("change-verdict", {
    request: verdictRequest.requestId,
    "subject-actor": "human-implementer"
  }));
  const verdictAttempts = attemptStore.reviewAttempts("change-verdict",
    state.reviewHistory);
  assert.equal(verdictAttempts.filter((attempt) =>
    attempt.status === "completed").length, 1,
  "a delivered fail verdict must not trigger infrastructure fallback");
  assert.equal(verdictAttempts.at(-1).reviewerIdentity, "codex-sol");
  assert.equal(verdictAttempts.at(-1).resultStatus, "fail");

  configuredReviewResults = {};
  reviewSettings = {
    ...reviewSettings, independence: "required", diversity: "required",
    fallbackReviewer: undefined
  };

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
  assert.equal(attempts.length, 6,
    "three dispatch journals plus three immutable completion journals are durable");

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
  const feature = readFileSync(join(root,
    ".claude/skills/feature/references/workflow.md"), "utf8");
  assert.match(feature, /Low risk uses one full AI\s+review/i);
  assert.match(feature, /Medium permits one correction[\s\S]*one fresh-session delta closure/i);
  assert.match(feature,
    /High\s+asks material risk decisions in the initial Decision Sheet/i);
  assert.match(feature, /never dispatch a\s+third AI/i);
  const agentContract = readFileSync(join(root, ".claude/harness/AGENT.md"), "utf8");
  assert.match(agentContract, /Before developer work, verify Foundation/i);
  assert.match(agentContract, /runtime API `22`/);
  const developerSetup = readFileSync(
    join(root, ".claude/harness/DEVELOPER-SETUP.md"), "utf8");
  assert.match(developerSetup, /scripts\/install-foundation-runtime\.mjs/);
  assert.match(developerSetup, /Node\.js 20\.19 or later/);
  const policy = readJson(join(root, "foundation.json"));
  assert.equal(policy.workflow.grounding, "required");
  assert.equal(policy.workflow.reviewCircuit, "full-delta");
  assert.equal(policy.workflow.reviewPolicy, "risk-tiered");
  assert.equal(policy.review.fallbackReviewer, "main-session");
  console.log("workflow policy tests: PASS");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
