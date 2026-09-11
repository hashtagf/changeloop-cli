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
import { reviewFindingIssues } from "../runtime/evidence/configured-reviewer.mjs";
import { createAdvanceRuntime } from "../runtime/workflow/advance-runtime.mjs";
import { createAuthorityStore } from "../runtime/workflow/authority.mjs";
import {
  bindMainSession,
  createAuthorityRuntime,
  firstMainSessionValue,
  inferredMainSession,
  mainSessionEnvironment,
  mainSessionFallbackValue,
  mainSessionProvenanceValue
} from "../runtime/workflow/authority-runtime.mjs";
import { reviewAssurancePosture } from "../runtime/core/runtime-environment.mjs";

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

{
  const claude = mainSessionEnvironment({
    FOUNDATION_CLAUDE_SESSION_ID: " claude ",
    FOUNDATION_SESSION_ID: "generic",
    CODEX_THREAD_ID: "codex",
    FOUNDATION_MAIN_SESSION_ID: "declared"
  });
  assert.equal(claude.ambientSession, "claude");
  assert.deepEqual(inferredMainSession(claude), {
    providerFamily: "anthropic", identity: "claude-main-session"
  });
  const generic = mainSessionEnvironment({
    FOUNDATION_SESSION_ID: "generic", CODEX_THREAD_ID: "codex"
  });
  assert.equal(generic.ambientSession, "generic");
  assert.deepEqual(inferredMainSession(generic), {
    providerFamily: "", identity: ""
  });
  const codex = mainSessionEnvironment({ CODEX_THREAD_ID: " codex " });
  assert.deepEqual(inferredMainSession(codex), {
    providerFamily: "openai", identity: "codex-main-session"
  });
  assert.equal(firstMainSessionValue([null, " VALUE "]), "VALUE");
  assert.equal(firstMainSessionValue([null, " VALUE "], true), "value");
  assert.equal(mainSessionFallbackValue(true, "subject", "telemetry"), "subject");
  assert.equal(mainSessionFallbackValue(false, "subject", "telemetry"), "telemetry");
  assert.equal(mainSessionEnvironment({
    FOUNDATION_MAIN_SESSION_ID: "declared"
  }).ambientSession, "declared");
  assert.equal(bindMainSession({ fail }, {}, codex), "codex");
  assert.equal(bindMainSession({ fail }, { "main-session-id": "manual" },
    mainSessionEnvironment({})), "");
  assert.throws(() => bindMainSession({ fail }, {
    "main-session-id": "spoofed"
  }, codex), /must match the calling host session/);

  const subject = {
    sessionId: "CODEX", identity: "subject", providerFamily: "OPENAI",
    modelFamily: "GPT", modelId: "gpt-subject"
  };
  const inherited = mainSessionProvenanceValue({}, subject, {}, {
    environment: codex, boundSession: "codex"
  }, {});
  assert.deepEqual(inherited.missing, []);
  assert.equal(inherited.identity, "subject");
  assert.equal(inherited.providerFamily, "openai");
  const telemetry = mainSessionProvenanceValue({}, {}, {}, {
    environment: codex, boundSession: "codex"
  }, {
    identity: "telemetry", providerFamily: "openai",
    modelFamily: "gpt-5.6", modelId: "gpt-5.6-sol"
  });
  assert.equal(telemetry.identity, "telemetry");
  const explicit = mainSessionProvenanceValue({
    "main-session-identity": " flag ",
    "main-session-provider-family": " OPENAI ",
    "main-session-model-family": " GPT-FLAG ",
    "main-session-model": "gpt-flag"
  }, {}, {
    FOUNDATION_MAIN_IDENTITY: "environment",
    FOUNDATION_MAIN_PROVIDER_FAMILY: "anthropic",
    FOUNDATION_MAIN_MODEL_FAMILY: "claude",
    FOUNDATION_MODEL_ID: "claude-model"
  }, { environment: codex, boundSession: "codex" }, {});
  assert.deepEqual(explicit, {
    identity: "flag", sessionId: "codex", providerFamily: "openai",
    modelFamily: "gpt-flag", modelId: "gpt-flag", missing: []
  });
  const environmentDefaults = mainSessionProvenanceValue({}, {}, {
    FOUNDATION_MAIN_IDENTITY: "environment",
    FOUNDATION_MAIN_PROVIDER_FAMILY: "ANTHROPIC",
    FOUNDATION_MAIN_MODEL_FAMILY: "CLAUDE",
    FOUNDATION_MODEL_ID: "claude-model"
  }, { environment: generic, boundSession: "generic" }, {});
  assert.equal(environmentDefaults.identity, "environment");
  assert.equal(environmentDefaults.providerFamily, "anthropic");
  const missing = mainSessionProvenanceValue({}, {}, {}, {
    environment: mainSessionEnvironment({}), boundSession: ""
  }, {});
  assert.deepEqual(missing.missing,
    ["identity", "sessionId", "providerFamily", "modelFamily", "modelId"]);
}
const decisions = [];
const quiet = (fn) => {
  const prior = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = prior; }
};
const captureLog = (fn) => {
  const prior = console.log;
  const rows = [];
  console.log = (value) => { rows.push(String(value)); };
  try { return { result: fn(), rows }; } finally { console.log = prior; }
};

try {
  const bothWaived = reviewAssurancePosture({
    review: { independence: "self", diversity: "single-model" }
  });
  assert.deepEqual(bothWaived.waivers,
    ["reviewer-independence", "model-diversity"]);
  assert.match(bothWaived.summary, /review may be non-independent/);
  assert.match(bothWaived.summary, /same model family/);

  const fullySeparated = reviewAssurancePosture({
    review: { independence: "required", diversity: "required" }
  });
  assert.deepEqual(fullySeparated.waivers, []);
  assert.equal(fullySeparated.independence.required, true);
  assert.equal(fullySeparated.diversity.required, true);
  assert.match(fullySeparated.summary, /no committed assurance waivers/);

  const independenceOnly = reviewAssurancePosture({
    review: { independence: "self", diversity: "required" }
  });
  assert.deepEqual(independenceOnly.waivers, ["reviewer-independence"]);
  assert.equal(independenceOnly.diversity.required, true);

  const diversityOnly = reviewAssurancePosture({
    review: { independence: "required", diversity: "single-model" }
  });
  assert.deepEqual(diversityOnly.waivers, ["model-diversity"]);
  assert.equal(diversityOnly.independence.required, true);
  assert.deepEqual(JSON.parse(JSON.stringify(diversityOnly)), diversityOnly,
    "review assurance posture is a stable JSON contract");

  const preferredForChange = reviewAssurancePosture({
    review: { independence: "required", diversity: "required" }
  }, { independence: "required", diversity: "preferred" });
  assert.equal(preferredForChange.diversity.required, false);
  assert.equal(preferredForChange.diversity.waived, false);
  assert.deepEqual(preferredForChange.waivers, []);
  assert.match(preferredForChange.summary, /model diversity preferred/);

  const activeSingleModelWaiver = reviewAssurancePosture({
    review: { independence: "required", diversity: "single-model" }
  }, { independence: "required", diversity: "preferred", diversityWaived: true });
  assert.equal(activeSingleModelWaiver.diversity.waived, true);
  assert.deepEqual(activeSingleModelWaiver.waivers, ["model-diversity"]);

  let packetSequence = 0;
  let packetMode = "code";
  let packetOverride = null;
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
  let persistConfiguredResult = false;
  let interruptReceipt = false;
  let providerRepository = null;
  let receiptValidityResult = { validity: "valid" };
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
    providerConfig: () => ({ capability: "review", adapter: "external",
      ...(providerRepository ? { repository: providerRepository } : {}) }),
    reviewPacketValue: () => {
      packetSequence += 1;
      if (packetOverride) return packetOverride();
      const proposal = {
        path: "openspec/changes/change-a/proposal.md",
        workspacePath: fixture,
        relativePath: "proposal.md",
        sha256: packetMode === "contract" ? `proposal-${packetSequence}` : "proposal-stable"
      };
      const groundingArtifact = {
        relativePath: "grounding.yaml", sha256: `grounding-${packetSequence}`
      };
      const evidenceArtifact = {
        relativePath: "evidence.yaml", sha256: `evidence-${packetSequence}`
      };
      return {
        version: 1,
        ...(packetMode === "large" ? { payload: "x".repeat(20_000) } : {}),
        claims: [{ id: "claim-a", scenario: "review the changed behavior" }],
        decisions: packetMode === "sparse" ? null : { proposal, empty: null },
        contractArtifacts: packetMode === "sparse" ? null : {
          "proposal.md": proposal,
          ...(packetMode === "grounding" ? {
            "grounding.yaml": groundingArtifact,
            "specs": { relativePath: "specs", sha256: `specs-${packetSequence}` },
            "evidence.yaml": evidenceArtifact
          } : {})
        },
        grounding: { decisionBatch: { status: "locked" } },
        references: packetMode === "sparse" ? null : packetMode === "grounding"
          ? { grounding: groundingArtifact, empty: null } : {},
        changedSurface: {
          manifest: packetMode === "sparse" ? [
            { repositoryId: "root", path: "app.txt", kind: "code",
              identity: `app-${packetSequence}` },
            { repositoryId: "root", path: "extra.txt", kind: "code",
              identity: `extra-${packetSequence}` }
          ] : [
            {
              repositoryId: "root", path: "app.txt", relativePath: "app.txt",
              workspacePath: fixture, kind: "code",
              identity: packetMode === "code" ? `v${packetSequence}` : "app-stable"
            },
            {
              repositoryId: "root", path: "openspec/changes/change-a/proposal.md",
              relativePath: "proposal.md", workspacePath: fixture,
              kind: "contract-artifact", identity: proposal.sha256
            },
            ...(packetMode === "grounding" ? [{
              repositoryId: "contract", path: "specs/nested/spec.md",
              relativePath: "specs/nested/spec.md", workspacePath: fixture,
              kind: "contract-artifact", identity: `spec-${packetSequence}`
            }, {
              repositoryId: "root", path: "openspec/changes/change-a/grounding.yaml",
              relativePath: "grounding.yaml", workspacePath: fixture,
              kind: "contract-artifact", identity: groundingArtifact.sha256
            }, {
              repositoryId: "root", path: "openspec/changes/change-a/evidence.yaml",
              relativePath: "evidence.yaml", workspacePath: fixture,
              kind: "contract-artifact", identity: evidenceArtifact.sha256
            }] : [])
          ],
          inspection: packetMode === "sparse" ? [] : [{
            repositoryId: "root", workspacePath: fixture, baseHead: "head", paths: ["app.txt"]
          }]
        }
      };
    },
    loadRuntime: () => state,
    evidence: () => ({ claims: [{ id: "claim-a" }] }),
    saveRuntime: (next) => { state = next; },
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
    reviewerConfig: (name) => name === "claude-opus" ? ({
      identity: "claude-opus", providerFamily: "anthropic",
      modelFamily: "claude", modelId: "opus"
    }) : ({
      identity: "codex-sol", providerFamily: "openai",
      modelFamily: "gpt-5.6", modelId: "gpt-5.6-sol"
    }),
    runConfiguredReview: (args) => {
      configuredReviewCalls += 1;
      lastConfiguredReviewArgs = args;
      const configuredResult = configuredReviewResults[args.reviewer];
      if (configuredResult) return configuredResult;
      const report = {
        status: "pass", summary: "configured review passed", findings: [],
        verifiedFindingIds: [], reportReference: "report.json",
        reviewer: { sessionId: configuredReviewSession }
      };
      if (persistConfiguredResult) {
        report.changeId = args.changeId;
        report.reviewer = { ...report.reviewer, identity: "codex-sol",
          providerFamily: "openai", modelFamily: "gpt-5.6", modelId: "gpt-5.6-sol" };
        report.reportReference = `.foundation/reviews/${args.changeId}/saved.json`;
        report.reportPath = join(fixture, report.reportReference);
        writeJson(report.reportPath, report);
      }
      return report;
    },
    reviewerStatus: () => ({ ok: true }),
    writeJson,
    receiptPath: (id) => join(fixture, `${id}-receipt.json`),
    recordReceipt: (id, _provider, status, flags) => {
      if (interruptReceipt) { interruptReceipt = false; throw new Error("receipt interrupted"); }
      return writeJson(
      join(fixture, `${id}-receipt.json`), {
        status, review: { attemptDigest: flags["review-attempt"] }
      });
    },
    receiptValidity: () => receiptValidityResult,
    fileDigest: () => "digest",
    providerWorkspaceHash: () => workspaceHash,
    providerRepository: () => null,
    providerWorkspace: () => fixture,
    gitHead: () => "head",
    validateSignedCiEnvelope: () => ({ valid: false }),
    providerClaims: () => ["claim-a"],
    fail
  });

  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-a", {})),
    /requires --request/);
  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-a", {
    request: "missing"
  })), /requires --subject-actor/);
  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-a", {
    request: "missing", "subject-actor": "agent", "subject-session": "session"
  })), /AI implementation provenance requires/);
  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-a", {
    request: "missing", "subject-actor": "human"
  })), /unknown authority request/);

  const requestedOnly = quiet(() => authority.requestAuthority("change-a", { type: "review" }));
  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-a", {
    request: requestedOnly.requestId, "subject-actor": "human", reviewer: "main-session"
  })), /without a recorded configured reviewer failure/);
  const savedReviewSettings = reviewSettings;
  reviewSettings = {};
  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-a", {
    request: requestedOnly.requestId, "subject-actor": "human"
  })), /infrastructure retries are exhausted/);
  reviewSettings = savedReviewSettings;
  assert.throws(() => quiet(() => authority.dispatchAuthority("change-a", {})),
    /requires --request/);
  assert.throws(() => quiet(() => authority.dispatchAuthority("change-a", {
    request: "missing"
  })), /unknown authority request/);
  const requestedEntry = authorityStore.list("change-a")
    .find((row) => row.value.requestId === requestedOnly.requestId);
  const originalRequested = requestedEntry.value;
  const dispatchRejected = (overrides, flags, pattern) => {
    authorityStore.replace(requestedEntry, { ...originalRequested, ...overrides });
    assert.throws(() => quiet(() => authority.dispatchAuthority("change-a", {
      request: requestedOnly.requestId, ...flags
    })), pattern);
    authorityStore.replace(requestedEntry, originalRequested);
  };
  dispatchRejected({ type: "acceptance" }, {}, /reserves review authority only/);
  dispatchRejected({ reviewCircuit: "legacy" }, {}, /predates the full-delta circuit/);
  dispatchRejected({ status: "completed" }, {}, /is completed/);
  dispatchRejected({ workspaceHash: "stale" }, {}, /is stale/);
  dispatchRejected({ expiresAt: "2000-01-01T00:00:00.000Z" }, {}, /is expired/);
  dispatchRejected({ packetDigest: "mismatch" }, {}, /packet no longer matches/);
  dispatchRejected({}, {}, /reviewer-type ai\|human/);
  const baseAiFlags = {
    "reviewer-type": "ai", scope: "full",
    "reviewer-provider-family": "openai", "reviewer-model-family": "gpt-5.6",
    "reviewer-model": "gpt-5.6-sol", "reviewer-session": "review-input-session"
  };
  dispatchRejected({}, baseAiFlags, /requires --reviewer-identity/);
  dispatchRejected({}, { ...baseAiFlags, "reviewer-identity": "codex-sol",
    "reviewer-provider-family": undefined }, /provider\/model family and model ID/);
  dispatchRejected({}, { ...baseAiFlags, "reviewer-identity": "codex-sol",
    "reviewer-session": undefined }, /requires reviewer session/);
  providerRepository = "root";
  dispatchRejected({}, { ...baseAiFlags, "reviewer-identity": "codex-sol" },
    /composite unscoped review provider/);
  providerRepository = null;
  dispatchRejected({}, { ...baseAiFlags, "reviewer-identity": "codex-sol",
    scope: undefined }, /scope full\|delta/);
  dispatchRejected({}, { ...baseAiFlags, "reviewer-identity": "codex-sol",
    scope: "invalid" }, /scope full\|delta/);
  dispatchRejected({}, { ...baseAiFlags, "reviewer-identity": "codex-sol",
    scope: "delta" }, /requires --base-attempt/);
  assert.equal(state.reviewHistory?.totalAttempts || 0, 0,
    "requesting review must not consume an attempt");
  quiet(() => authority.abortAuthority("change-a", {
    request: requestedOnly.requestId, reason: "cancel before handoff"
  }));
  assert.equal(state.reviewHistory?.totalAttempts || 0, 0,
    "cancelling an undispatched request must not consume an attempt");

  packetMode = "large";
  workspaceHash = "workspace-large-packet";
  const largeRequestOutput = captureLog(() =>
    authority.requestAuthority("change-a", { type: "review" }));
  const largeAcknowledgement = JSON.parse(largeRequestOutput.rows[0]);
  assert.equal(largeAcknowledgement.packet.status, "persisted");
  assert.equal(largeAcknowledgement.packet.display, "truncated");
  assert.ok(Buffer.byteLength(largeRequestOutput.rows[0]) < 8192,
    "authority request acknowledgement must honor the display budget");
  assert.match(largeAcknowledgement.next, /authority status/);
  const durableLargeRequest = authorityStore.list("change-a")
    .find((entry) => entry.value.requestId === largeRequestOutput.result.requestId)?.value;
  assert.equal(durableLargeRequest.packet.payload.length, 20_000,
    "compact acknowledgement must not truncate the durable authority packet");
  quiet(() => authority.abortAuthority("change-a", {
    request: largeRequestOutput.result.requestId, reason: "compact display regression complete"
  }));
  packetMode = "code";
  workspaceHash = "workspace-a";

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
  assert.equal(quiet(() => authority.dispatchAuthority("change-a", {
    request: firstRequest.requestId
  })).dispatch.attemptDigest, first.dispatch.attemptDigest,
  "redispatching an already dispatched request is idempotent");
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

  state = { version: 2, changeId: "change-saved", reviewHistory: null };
  const savedRequest = quiet(() => authority.requestAuthority("change-saved", { type: "review" }));
  persistConfiguredResult = true;
  interruptReceipt = true;
  const callsBeforeRecovery = configuredReviewCalls;
  const savedFlags = { request: savedRequest.requestId, "subject-actor": "human-implementer" };
  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-saved", savedFlags)),
    /receipt interrupted/);
  const savedAttemptDigest = state.reviewHistory.chainHead;
  quiet(() => authority.runAuthorityReviewer("change-saved", savedFlags));
  assert.equal(configuredReviewCalls, callsBeforeRecovery + 1,
    "receipt recovery must reuse the saved review without another model invocation");
  assert.equal(state.reviewHistory.chainHead, savedAttemptDigest,
    "receipt recovery must not append another attempt");
  persistConfiguredResult = false;

  state = { version: 2, changeId: "change-orphan", reviewHistory: null };
  const orphanRequest = quiet(() => authority.requestAuthority(
    "change-orphan", { type: "review" }));
  quiet(() => authority.dispatchAuthority("change-orphan", {
    request: orphanRequest.requestId,
    scope: "full",
    "reviewer-type": "ai",
    "reviewer-identity": "codex-sol",
    "reviewer-provider-family": "openai",
    "reviewer-model-family": "gpt-5.6",
    "reviewer-model": "gpt-5.6-sol",
    "reviewer-session-deferred": true
  }));
  const orphanEntry = authorityStore.list("change-orphan")
    .find((row) => row.value.requestId === orphanRequest.requestId);
  authorityStore.replace(orphanEntry, {
    ...orphanEntry.value,
    configuredController: {
      version: 1,
      pid: 2147483647,
      reviewer: "codex-sol",
      startedAt: now()
    }
  });
  quiet(() => authority.runAuthorityReviewer("change-orphan", {
    request: orphanRequest.requestId,
    "subject-actor": "human-implementer"
  }));
  const orphanAttempts = attemptStore.reviewAttempts(
    "change-orphan", state.reviewHistory);
  assert.deepEqual(orphanAttempts.map((attempt) => attempt.resultStatus),
    ["error", "pass"],
  "a dead configured controller must become an infrastructure error before retry");
  const recoveredAuthority = authorityStore.list("change-orphan")
    .find((row) => row.value.requestId === orphanRequest.requestId).value;
  assert.equal(recoveredAuthority.status, "completed");
  assert.equal(recoveredAuthority.orphanedControllers.length, 1);
  assert.equal(recoveredAuthority.orphanedControllers[0].result,
    "infrastructure-error");

  state = { version: 2, changeId: "change-indeterminate", reviewHistory: null };
  const indeterminateRequest = quiet(() => authority.requestAuthority(
    "change-indeterminate", { type: "review" }));
  quiet(() => authority.dispatchAuthority("change-indeterminate", {
    request: indeterminateRequest.requestId, scope: "full",
    "reviewer-type": "ai", "reviewer-identity": "codex-sol",
    "reviewer-provider-family": "openai", "reviewer-model-family": "gpt-5.6",
    "reviewer-model": "gpt-5.6-sol", "reviewer-session-deferred": true
  }));
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-indeterminate", { request: indeterminateRequest.requestId,
      "subject-actor": "human" })), /is indeterminate/);
  const indeterminateEntry = authorityStore.list("change-indeterminate")
    .find((row) => row.value.requestId === indeterminateRequest.requestId);
  authorityStore.replace(indeterminateEntry, {
    ...indeterminateEntry.value,
    configuredController: { pid: process.pid, reviewer: "codex-sol" }
  });
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-indeterminate", { request: indeterminateRequest.requestId,
      "subject-actor": "human" })), /is still running/);

  state = { version: 2, changeId: "change-named-fallback", reviewHistory: null };
  reviewSettings = {
    defaultReviewer: "claude-opus", fallbackReviewers: ["codex-sol"],
    infraFailureThreshold: 2, independence: "self", diversity: "single-model"
  };
  configuredReviewResults = {
    "claude-opus": {
      status: "error", summary: "Claude reviewer unavailable", findings: [],
      verifiedFindingIds: [], reportReference: "claude-error.json",
      reviewer: { sessionId: null }
    }
  };
  const namedFallbackRequest = quiet(() => authority.requestAuthority(
    "change-named-fallback", { type: "review" }));
  const namedFallbackResult = quiet(() => authority.runAuthorityReviewer(
    "change-named-fallback", {
      request: namedFallbackRequest.requestId,
      "subject-actor": "human-implementer"
    }));
  assert.equal(namedFallbackResult.status, "pass");
  const namedFallbackAttempts = attemptStore.reviewAttempts(
    "change-named-fallback", state.reviewHistory);
  assert.deepEqual(namedFallbackAttempts.map((attempt) =>
    [attempt.reviewerIdentity, attempt.resultStatus]), [
    ["claude-opus", "error"], ["claude-opus", "error"],
    ["codex-sol", "pass"]
  ], "two infrastructure failures switch to the configured diverse reviewer");

  state = { version: 2, changeId: "change-fallback", reviewHistory: null };
  reviewSettings = {
    defaultReviewer: "codex-sol", independence: "self", diversity: "single-model",
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
  const hostProvenanceKeys = [
    "FOUNDATION_CLAUDE_SESSION_ID", "FOUNDATION_SESSION_ID", "CODEX_THREAD_ID",
    "FOUNDATION_MAIN_SESSION_ID", "FOUNDATION_MAIN_IDENTITY",
    "FOUNDATION_MAIN_PROVIDER_FAMILY", "FOUNDATION_MAIN_MODEL_FAMILY",
    "FOUNDATION_MODEL_ID"
  ];
  const priorHostProvenance = Object.fromEntries(hostProvenanceKeys.map((key) =>
    [key, process.env[key]]));
  const restoreHostProvenance = () => {
    for (const key of hostProvenanceKeys) {
      if (priorHostProvenance[key] === undefined) delete process.env[key];
      else process.env[key] = priorHostProvenance[key];
    }
  };
  // A calling host (for example Claude Code) may export its own session
  // provenance; clear it so the codex-host fallback scenario stays ambient.
  for (const key of hostProvenanceKeys) delete process.env[key];
  process.env.CODEX_THREAD_ID = "main-session-thread";
  const handback = quiet(() => authority.runAuthorityReviewer("change-fallback", {
    request: fallbackRequest.requestId,
    "subject-actor": "main-agent",
    "subject-session": "main-session-thread",
    "subject-provider-family": "openai",
    "subject-model-family": "gpt-5.6",
    "subject-model": "gpt-5.6-sol"
  }));
  restoreHostProvenance();
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
  for (const key of hostProvenanceKeys) delete process.env[key];
  const missingRequest = quiet(() => authority.requestAuthority(
    "change-fallback-missing", { type: "review" }));
  const missingHandback = quiet(() => authority.runAuthorityReviewer(
    "change-fallback-missing", {
      request: missingRequest.requestId,
      "subject-actor": "human-implementer"
    }));
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
  restoreHostProvenance();
  assert.equal(resumedHandback.status, "needs-main-session-review");
  assert.equal(resumedHandback.reviewer.identity, "telemetry-main-agent");
  assert.equal(resumedHandback.reviewer.sessionId, "recovered-main-session");
  assert.equal(resumedHandback.reviewer.providerFamily, "openai");
  assert.equal(resumedHandback.reviewer.modelFamily, "gpt-5.6-sol");
  assert.equal(resumedHandback.reviewer.modelId, "gpt-5.6-sol");
  assert.equal(configuredReviewCalls, callsBeforeResume,
    "provenance recovery must not rerun the failed configured reviewer");

  state = { version: 2, changeId: "change-fallback-delta", reviewHistory: null };
  configuredReviewResults = { "codex-sol": {
    status: "fail", summary: "first review finding", findings: [{
      id: "F-FALLBACK", severity: "major", path: "app.txt", message: "fix"
    }], verifiedFindingIds: [], reportReference: "first-fallback.json",
    reviewer: { sessionId: "fallback-first-session" }
  } };
  const fallbackFirstRequest = quiet(() => authority.requestAuthority(
    "change-fallback-delta", { type: "review" }));
  quiet(() => authority.runAuthorityReviewer("change-fallback-delta", {
    request: fallbackFirstRequest.requestId, "subject-actor": "human"
  }));
  configuredReviewResults = { "codex-sol": {
    status: "error", summary: "reviewer unavailable", findings: [],
    verifiedFindingIds: [], reportReference: "fallback-error.json",
    reviewer: { sessionId: null }
  } };
  for (const key of hostProvenanceKeys) delete process.env[key];
  const fallbackDeltaRequest = quiet(() => authority.requestAuthority(
    "change-fallback-delta", { type: "review" }));
  const fallbackDeltaBlocked = quiet(() => authority.runAuthorityReviewer(
    "change-fallback-delta", { request: fallbackDeltaRequest.requestId,
      "subject-actor": "human" }));
  assert.equal(fallbackDeltaBlocked.status, "main-session-provenance-unavailable");
  process.env.CODEX_THREAD_ID = "fallback-delta-main";
  const fallbackDeltaEvents = join(fixture, ".foundation", "logs",
    "change-fallback-delta", "events.jsonl");
  mkdirSync(dirname(fallbackDeltaEvents), { recursive: true });
  writeFileSync(fallbackDeltaEvents, `${JSON.stringify({
    sessionId: "fallback-delta-main", agentId: "fallback-main",
    modelId: "gpt-5.6-sol", source: "codex"
  })}\n`);
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-fallback-delta", { request: fallbackDeltaRequest.requestId,
      "subject-actor": "human" })), /claimRows\.map/);
  restoreHostProvenance();

  state = { version: 2, changeId: "change-fallback-defaults", reviewHistory: null };
  const fallbackDefaultsRequest = quiet(() => authority.requestAuthority(
    "change-fallback-defaults", { type: "review" }));
  const fallbackDefaultsEntry = authorityStore.list("change-fallback-defaults")
    .find((row) => row.value.requestId === fallbackDefaultsRequest.requestId);
  authorityStore.replace(fallbackDefaultsEntry, {
    ...fallbackDefaultsEntry.value,
    fallbackAttempts: [],
    mainSessionFallback: {
      status: "provenance-unavailable", scope: "full", subject: {},
      missingProvenance: ["identity"]
    }
  });
  process.env.CODEX_THREAD_ID = "fallback-default-session";
  const fallbackDefaults = quiet(() => authority.runAuthorityReviewer(
    "change-fallback-defaults", {
      request: fallbackDefaultsRequest.requestId, "subject-actor": "human",
      "main-session-identity": "fallback-default-reviewer",
      "main-session-provider-family": "openai",
      "main-session-model-family": "gpt-5.6",
      "main-session-model": "gpt-5.6-sol"
    }));
  restoreHostProvenance();
  assert.equal(fallbackDefaults.status, "needs-main-session-review");
  assert.equal(fallbackDefaults.failedReviewer, "codex-sol");

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

  state = { version: 2, changeId: "change-invalid-binding", reviewHistory: null };
  configuredReviewResults = {
    "codex-sol": {
      status: "error", retryable: false, summary: "Invalid dispatched finding path",
      findings: [], verifiedFindingIds: [], reportReference: "binding-error.json",
      reviewer: { sessionId: "invalid-binding-thread" }
    }
  };
  const bindingRequest = quiet(() => authority.requestAuthority(
    "change-invalid-binding", { type: "review" }));
  const bindingResult = quiet(() => authority.runAuthorityReviewer("change-invalid-binding", {
    request: bindingRequest.requestId, "subject-actor": "human-implementer"
  }));
  assert.equal(bindingResult.status, "configured-reviewer-infrastructure-exhausted");
  assert.equal(attemptStore.reviewAttempts("change-invalid-binding", state.reviewHistory).length, 1,
    "deterministic binding failures must not spend another full review on fallback");
  assert.throws(() => quiet(() => authority.runAuthorityReviewer("change-invalid-binding", {
    request: bindingRequest.requestId, "subject-actor": "human-implementer"
  })), /exhausted|status|dispatch/i);

  state = { version: 2, changeId: "change-binding-recovery", status: "building", reviewHistory: null };
  const recoveryId = state.changeId;
  const recoveryContract = join(fixture, "openspec", "changes", recoveryId);
  mkdirSync(recoveryContract, { recursive: true });
  writeFileSync(join(recoveryContract, "spec.md"), "requirement\n");
  let bindingCorrected = false;
  packetOverride = () => ({ version: 1, claims: [], changedSurface: {
    inspection: [{ repositoryId: "contract", workspacePath: recoveryContract },
      ...(bindingCorrected ? [{ repositoryId: "root", workspacePath: fixture, paths: [] }] : [])],
    manifest: [{ repositoryId: "contract", path: "spec.md", relativePath: "spec.md",
      workspacePath: recoveryContract, kind: "contract-artifact", identity: "stable-spec" }]
  } });
  const rejectedReport = {
    changeId: recoveryId, status: "error", summary: "finding binding rejected",
    findings: [{ id: "F-RECOVER", severity: "major", line: 1,
      path: `openspec/changes/${recoveryId}/spec.md`, message: "check requirement",
      claimIds: [], verificationCaseIds: [] }], verifiedFindingIds: []
  };
  writeJson(join(fixture, "binding-recovery.json"), rejectedReport);
  configuredReviewResults = { "codex-sol": {
    ...rejectedReport, retryable: false, bindingFailure: "result",
    reportReference: "binding-recovery.json", reviewer: { sessionId: "binding-recovery-one" }
  } };
  const recoveryRequest = quiet(() => authority.requestAuthority(recoveryId, { type: "review" }));
  const beforeRecoveryCalls = configuredReviewCalls;
  quiet(() => authority.runAuthorityReviewer(recoveryId, {
    request: recoveryRequest.requestId, "subject-actor": "human-implementer"
  }));
  const advanceRecovery = createAdvanceRuntime({
    nowMs: () => Date.parse(now()),
    loadRuntime: () => state, agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => workspaceHash, deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: authorityStore.list(recoveryId).map((row) => row.value) }),
    authorityNext: (_id, _type, requests) => requests.map((request) => ({
      requestId: request.requestId,
      command: `claude-foundation authority run ${recoveryId} --request ${request.requestId} --subject-actor implementation-agent`
    })),
    readJson: () => ({}), proofAdvancePath: () => "/unused-proof.json", stableHash,
    recoverReviewBindings: authority.recoverReviewBindings
  });
  assert.equal((await advanceRecovery.advanceThrough(recoveryId, "proven")).action, "REPAIR");
  assert.equal(configuredReviewCalls, beforeRecoveryCalls + 1,
    "unchanged invalid bindings do not spend another review");
  bindingCorrected = true;
  const retainedEntry = authorityStore.list(recoveryId).find((row) => row.value.requestId === recoveryRequest.requestId);
  const retainedRequest = structuredClone(retainedEntry.value);
  writeFileSync(join(recoveryContract, "other.md"), "outside dispatched scope\n");
  const corruptedPacket = structuredClone(retainedRequest.packet);
  corruptedPacket.reviewScope.paths.push("contract/other.md");
  corruptedPacket.changedSurface.manifest.push({ repositoryId: "contract", path: "other.md",
    relativePath: "other.md", workspacePath: recoveryContract, kind: "contract-artifact", identity: "other" });
  authorityStore.replace(retainedEntry, { ...retainedRequest, packet: corruptedPacket });
  assert.equal(authority.recoverReviewBindings(recoveryId), false,
    "recovery must not bless a packet that no longer matches its dispatch digest");
  assert.equal(authorityStore.list(recoveryId).find((row) => row.value.requestId === recoveryRequest.requestId)
    .value.packetDigest, retainedRequest.packetDigest);
  authorityStore.replace(retainedEntry, retainedRequest);
  assert.equal(advanceRecovery.advanceValue(recoveryId, { inspect: true }).action, "REPAIR",
    "inspection must not reopen requests");
  const recoveredAction = await advanceRecovery.advanceThrough(recoveryId, "proven");
  assert.equal(recoveredAction.legacyAction, "RUN_CONFIGURED_REVIEW",
    "advance itself reopens a now-valid binding through the existing route");
  configuredReviewResults = {};
  const recoveredResult = quiet(() => authority.runAuthorityReviewer(recoveryId, {
    request: recoveryRequest.requestId, "subject-actor": "human-implementer"
  }));
  assert.equal(recoveredResult.status, "pass");
  assert.equal(configuredReviewCalls, beforeRecoveryCalls + 2);
  assert.deepEqual(attemptStore.reviewAttempts(recoveryId, state.reviewHistory)
    .map((row) => row.resultStatus), ["error", "pass"], "failed evidence remains in history");
  assert.equal(state.reviewHistory.infraAcknowledged?.length || 0, 0,
    "automatic binding recovery never resets the infrastructure budget");
  packetOverride = null;

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

  reviewSettings = {
    defaultReviewer: "codex-sol", independence: "self", diversity: "single-model"
  };
  state = { version: 2, changeId: "change-no-session", reviewHistory: null };
  configuredReviewSession = "";
  const noSessionRequest = quiet(() => authority.requestAuthority(
    "change-no-session", { type: "review" }));
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-no-session", { request: noSessionRequest.requestId,
      "subject-actor": "human" })), /did not emit an actual session ID/);

  state = { version: 2, changeId: "change-invalid-findings", reviewHistory: null };
  configuredReviewResults = { "codex-sol": {
    status: "fail", summary: "invalid findings", findings: [
      { id: "DUP", severity: "major", path: "app.txt" },
      { id: "DUP", severity: "major", path: "app.txt" }
    ], verifiedFindingIds: [], reportReference: "invalid.json",
    reviewer: { sessionId: "invalid-review-session" }
  } };
  const invalidFindingRequest = quiet(() => authority.requestAuthority(
    "change-invalid-findings", { type: "review" }));
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-invalid-findings", { request: invalidFindingRequest.requestId,
      "subject-actor": "human" })), /non-empty and unique/);
  configuredReviewResults = {};
  configuredReviewSession = "actual-codex-thread";

  state = { version: 2, changeId: "change-delta-run", reviewHistory: null,
    workspace: { path: fixture } };
  configuredReviewResults = { "codex-sol": {
    status: "fail", summary: "first round finding", findings: [{
      id: "F-DELTA", severity: "major", path: "app.txt", line: 1,
      message: "fix this path"
    }], verifiedFindingIds: [], reportReference: "first.json",
    reviewer: { sessionId: "review-full" }
  } };
  const deltaFullRequest = quiet(() => authority.requestAuthority(
    "change-delta-run", { type: "review" }));
  quiet(() => authority.runAuthorityReviewer("change-delta-run", {
    request: deltaFullRequest.requestId, "subject-actor": "human"
  }));
  configuredReviewResults = { "codex-sol": {
    status: "pass", summary: "finding closed", findings: [],
    verifiedFindingIds: ["F-DELTA"], reportReference: "delta.json",
    reviewer: { sessionId: "review-delta" }
  } };
  const deltaClosureRequest = quiet(() => authority.requestAuthority(
    "change-delta-run", { type: "review" }));
  quiet(() => authority.runAuthorityReviewer("change-delta-run", {
    request: deltaClosureRequest.requestId, "subject-actor": "human"
  }));
  assert.equal(attemptStore.reviewAttemptByDigest("change-delta-run",
    state.reviewHistory.chainHead).scope.mode, "delta");
  const seedDeltaFinding = (id) => {
    state = { version: 2, changeId: id, reviewHistory: null };
    configuredReviewResults = { "codex-sol": {
      status: "fail", summary: "first finding", findings: [{
        id: "F-SCOPE", severity: "major", path: "app.txt", message: "fix"
      }], verifiedFindingIds: [], reportReference: "first.json",
      reviewer: { sessionId: `${id}-full` }
    } };
    const request = quiet(() => authority.requestAuthority(id, { type: "review" }));
    quiet(() => authority.runAuthorityReviewer(id, {
      request: request.requestId, "subject-actor": "human"
    }));
  };
  seedDeltaFinding("change-delta-mismatch");
  configuredReviewResults = { "codex-sol": {
    status: "pass", summary: "wrong closure", findings: [],
    verifiedFindingIds: [], reportReference: "wrong.json",
    reviewer: { sessionId: "mismatch-delta" }
  } };
  const mismatchRequest = quiet(() => authority.requestAuthority(
    "change-delta-mismatch", { type: "review" }));
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-delta-mismatch", { request: mismatchRequest.requestId,
      "subject-actor": "human" })), /verify exactly/);

  seedDeltaFinding("change-delta-outside");
  configuredReviewResults = { "codex-sol": {
    status: "fail", summary: "outside finding", findings: [{
      id: "F-OUT", severity: "major", path: "outside.txt", message: "outside"
    }], verifiedFindingIds: ["F-SCOPE"], reportReference: "outside.json",
    reviewer: { sessionId: "outside-delta" }
  } };
  const outsideRequest = quiet(() => authority.requestAuthority(
    "change-delta-outside", { type: "review" }));
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-delta-outside", { request: outsideRequest.requestId,
      "subject-actor": "human" })), /outside the dispatched correction scope/);
  configuredReviewResults = {};

  const stateBeforeRecordValidation = state;
  state = { version: 2, changeId: "change-record-validation", reviewHistory: null };
  workspaceHash = "workspace-record-validation";
  reviewSettings = {
    defaultReviewer: "codex-sol", independence: "self", diversity: "single-model"
  };
  const recordResponsePath = join(fixture, "record-validation-response.json");
  writeJson(recordResponsePath, {});
  assert.throws(() => quiet(() => authority.recordAuthority(
    "change-record-validation", {})), /requires --request/);
  assert.throws(() => quiet(() => authority.recordAuthority(
    "change-record-validation", {
      request: "missing", response: recordResponsePath
    })), /unknown authority request/);
  const recordRequest = quiet(() => authority.requestAuthority(
    "change-record-validation", { type: "review" }));
  const recordEntry = authorityStore.list("change-record-validation")
    .find((row) => row.value.requestId === recordRequest.requestId);
  const originalRecordRequest = recordEntry.value;
  const recordRejected = (overrides, pattern, response = recordResponsePath) => {
    authorityStore.replace(recordEntry, { ...originalRecordRequest, ...overrides });
    assert.throws(() => quiet(() => authority.recordAuthority(
      "change-record-validation", {
        request: recordRequest.requestId, response
      })), pattern);
    authorityStore.replace(recordEntry, originalRecordRequest);
  };
  workspaceHash = "workspace-record-validation-changed";
  recordRejected({}, /is stale/);
  workspaceHash = "workspace-record-validation";
  recordRejected({ status: "completed" }, /is completed/);
  recordRejected({}, /must be dispatched/);
  recordRejected({ reviewCircuit: "legacy" }, /response not found/,
    join(fixture, "missing-record-response.json"));

  quiet(() => authority.dispatchAuthority("change-record-validation", {
    request: recordRequest.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "record-reviewer",
    "reviewer-provider-family": "openai", "reviewer-model-family": "gpt",
    "reviewer-model": "gpt-record", "reviewer-session": "record-session"
  }));
  const recordTemplate = JSON.parse(captureLog(() => authority.showAuthorityStatus(
    "change-record-validation", {
      request: recordRequest.requestId, template: true
    })).rows[0]);
  const validRecordResponse = {
    ...recordTemplate, status: "error", evidence: {
      ...recordTemplate.evidence,
      observed: "review infrastructure unavailable",
      reference: ["record-error.json"],
      "subject-actor": "human"
    }
  };
  const responseRejected = (mutate, pattern) => {
    const candidate = structuredClone(validRecordResponse);
    mutate(candidate);
    writeJson(recordResponsePath, candidate);
    assert.throws(() => quiet(() => authority.recordAuthority(
      "change-record-validation", {
        request: recordRequest.requestId, response: recordResponsePath
      })), pattern);
  };
  responseRejected((response) => { response.evidence.reviewer = "wrong"; },
    /does not match its dispatched reviewer/);
  responseRejected((response) => {
    response.evidence["reviewer-identity"] = "record-reviewer";
    response.evidence.reviewer = "ignored-fallback";
    response.evidence["reviewer-type"] = "wrong";
  }, /does not match its dispatched reviewer/);
  responseRejected((response) => { response.evidence["scope-path"] = ["wrong.txt"]; },
    /scope-path must exactly match/);
  responseRejected((response) => {
    response.evidence.findings = [
      { severity: "major", path: "app.txt" },
      { path: "note.txt" }
    ];
  }, /unresolved-blockers must equal/);
  const dispatchedRecordEntry = authorityStore.list("change-record-validation")
    .find((row) => row.value.requestId === recordRequest.requestId);
  authorityStore.replace(dispatchedRecordEntry, {
    ...dispatchedRecordEntry.value,
    packet: {
      ...dispatchedRecordEntry.value.packet,
      closureFindings: { ids: ["F-INFRASTRUCTURE"] }
    }
  });
  validRecordResponse.evidence.findings = "not-an-array";
  validRecordResponse.evidence.verifiedFindingIds = "not-an-array";
  writeJson(recordResponsePath, validRecordResponse);
  quiet(() => authority.recordAuthority("change-record-validation", {
    request: recordRequest.requestId, response: recordResponsePath
  }));
  const recordedError = authorityStore.list("change-record-validation")
    .find((row) => row.value.requestId === recordRequest.requestId).value;
  assert.equal(recordedError.status, "error");
  assert.equal(recordedError.infrastructureError, true);

  state = { version: 2, changeId: "change-record-human", reviewHistory: null };
  workspaceHash = "workspace-record-human";
  const recordHumanRequest = quiet(() => authority.requestAuthority(
    "change-record-human", { type: "review" }));
  quiet(() => authority.dispatchAuthority("change-record-human", {
    request: recordHumanRequest.requestId, scope: "full", "reviewer-type": "human",
    "reviewer-identity": "human-reviewer"
  }));
  const humanTemplate = JSON.parse(captureLog(() => authority.showAuthorityStatus(
    "change-record-human", {
      request: recordHumanRequest.requestId, template: true
    })).rows[0]);
  writeJson(recordResponsePath, {
    ...humanTemplate, status: "error", evidence: {
      ...humanTemplate.evidence, observed: "human reviewer became unavailable",
      reference: ["human-error.json"], "subject-actor": "human"
    }
  });
  quiet(() => authority.recordAuthority("change-record-human", {
    request: recordHumanRequest.requestId, response: recordResponsePath
  }));

  state = { version: 2, changeId: "change-record-legacy", reviewHistory: null };
  workspaceHash = "workspace-record-legacy";
  const legacyRequest = quiet(() => authority.requestAuthority(
    "change-record-legacy", { type: "review" }));
  const legacyEntry = authorityStore.list("change-record-legacy")
    .find((row) => row.value.requestId === legacyRequest.requestId);
  authorityStore.replace(legacyEntry, {
    ...legacyEntry.value, reviewCircuit: "legacy"
  });
  const legacyTemplate = JSON.parse(captureLog(() => authority.showAuthorityStatus(
    "change-record-legacy", {
      request: legacyRequest.requestId, template: true
    })).rows[0]);
  writeJson(recordResponsePath, {
    ...legacyTemplate, status: "inconclusive", evidence: {
      ...legacyTemplate.evidence, observed: "legacy review remained inconclusive",
      reference: ["legacy-inconclusive.json"], reviewer: "legacy-reviewer",
      "reviewer-type": "human", "subject-actor": "human"
    }
  });
  quiet(() => authority.recordAuthority("change-record-legacy", {
    request: legacyRequest.requestId, response: recordResponsePath
  }));

  state = { version: 2, changeId: "change-record-receipt", reviewHistory: null };
  workspaceHash = "workspace-record-receipt";
  configuredReviewResults = { "codex-sol": {
    status: "pass", summary: "record receipt pass", findings: [],
    verifiedFindingIds: [], reportReference: "record-pass.json",
    reviewer: { sessionId: "record-pass-session" }
  } };
  const receiptRequest = quiet(() => authority.requestAuthority(
    "change-record-receipt", { type: "review" }));
  receiptValidityResult = { validity: "workspace-mismatch" };
  assert.throws(() => quiet(() => authority.runAuthorityReviewer(
    "change-record-receipt", {
      request: receiptRequest.requestId, "subject-actor": "human"
    })), /produced invalid evidence/);
  assert.equal(existsSync(join(fixture, "change-record-receipt-receipt.json")),
    false, "an invalid new receipt must be rolled back");
  receiptValidityResult = { validity: "valid" };
  quiet(() => authority.recordAuthority("change-record-receipt", {
    request: receiptRequest.requestId,
    response: join(fixture, ".foundation", "authority",
      "change-record-receipt",
      `${receiptRequest.requestId}-configured-review-response.json`)
  }));
  assert.equal(readJson(join(fixture, "change-record-receipt-receipt.json")).status,
    "pass");
  configuredReviewResults = {};
  workspaceHash = "workspace-a";
  state = stateBeforeRecordValidation;

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

  state = { version: 2, changeId: "change-status-forge", reviewHistory: null };
  const forgeDispatch = attemptStore.dispatchReviewAttempt("change-status-forge", {
    reviewerType: "ai", reviewerIdentity: "reviewer-forge",
    reviewerProviderFamily: "openai", reviewerModelFamily: "gpt-5.6",
    reviewerModelId: "gpt-5.6-sol", reviewerSessionId: "review-session-forge",
    requestId: "request-forge", workspaceHash: "workspace-forge",
    scope: { mode: "full", paths: [], digest: "scope-digest-forge" },
    packetDigest: "packet-digest-forge", maxAiAttempts: 2
  });
  // A reviewer can genuinely fail (or error) with no itemized findings — a
  // free-text "could not verify" verdict. `attemptIsValid` used to check only
  // that the dispatch identity/scope/findings matched, never that the
  // receipt's asserted status equalled what the reviewer actually delivered,
  // so this exact dispatch digest could be replayed into a fabricated
  // pass receipt with unresolvedBlockers forced to 0.
  const forgeCompleted = attemptStore.completeReviewAttempt("change-status-forge",
    forgeDispatch.digest, {
      reviewerSessionId: "review-session-forge", resultStatus: "fail",
      findings: [], verifiedFindingIds: []
    });
  const forgedReceipt = {
    workspaceHash: forgeCompleted.workspaceHash,
    status: "pass",
    review: {
      round: forgeCompleted.attempt,
      requestId: forgeCompleted.requestId,
      packetDigest: forgeCompleted.packetDigest,
      reviewer: {
        type: forgeCompleted.reviewerType,
        identity: forgeCompleted.reviewerIdentity,
        providerFamily: forgeCompleted.reviewerProviderFamily,
        modelFamily: forgeCompleted.reviewerModelFamily,
        modelId: forgeCompleted.reviewerModelId,
        sessionId: forgeCompleted.reviewerSessionId
      },
      scope: {
        mode: forgeCompleted.scope.mode,
        baseAttemptDigest: forgeCompleted.scope.baseAttemptDigest || null,
        paths: forgeCompleted.scope.paths,
        dispatchDigest: forgeCompleted.scope.digest,
        digest: stableHash({
          priorWorkspaceHash: null,
          workspaceHash: forgeCompleted.workspaceHash,
          paths: forgeCompleted.scope.paths
        })
      },
      findings: {
        verified: 0, unresolvedBlockers: 0,
        items: forgeCompleted.findings, verifiedIds: forgeCompleted.verifiedFindingIds
      },
      supersedes: null
    }
  };
  assert.equal(protocol.attemptIsValid(forgedReceipt, forgeCompleted), false,
    "a completed fail/error attempt cannot be replayed into a fabricated pass receipt");

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

  state = { version: 2, changeId: "change-sparse", reviewHistory: null };
  packetMode = "sparse";
  packetSequence = 0;
  const sparseFirstRequest = quiet(() => authority.requestAuthority(
    "change-sparse", { type: "review" }));
  const sparseFirst = quiet(() => authority.dispatchAuthority("change-sparse", {
    request: sparseFirstRequest.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "sparse-one", "reviewer-provider-family": "openai",
    "reviewer-model-family": "gpt", "reviewer-model": "gpt-5.6",
    "reviewer-session": "sparse-one-session"
  }));
  const sparseCompleted = attemptStore.completeReviewAttempt("change-sparse",
    sparseFirst.dispatch.attemptDigest, {
      reviewerSessionId: "sparse-one-session", resultStatus: "fail",
      findings: [{ id: "F-SPARSE", severity: "major", path: "app.txt",
        message: "sparse correction" }], verifiedFindingIds: []
    });
  writeJson(join(fixture, "change-sparse-receipt.json"), {
    status: "fail", review: { attemptDigest: sparseCompleted.digest }
  });
  quiet(() => authority.abortAuthority("change-sparse", {
    request: sparseFirstRequest.requestId, reason: "apply sparse correction"
  }));
  const sparseSecondRequest = quiet(() => authority.requestAuthority(
    "change-sparse", { type: "review" }));
  const sparseSecond = quiet(() => authority.dispatchAuthority("change-sparse", {
    request: sparseSecondRequest.requestId, scope: "delta",
    "base-attempt": sparseCompleted.digest, "reviewer-type": "ai",
    "reviewer-identity": "sparse-two", "reviewer-provider-family": "google",
    "reviewer-model-family": "gemini", "reviewer-model": "gemini-pro",
    "reviewer-session": "sparse-two-session"
  }));
  assert.deepEqual(sparseSecond.packet.changedSurface.inspection, [{
    repositoryId: "root", workspacePath: null, baseHead: null,
    paths: ["app.txt", "extra.txt"]
  }]);

  state = { version: 2, changeId: "change-grounding", reviewHistory: null };
  packetMode = "grounding";
  packetSequence = 0;
  const groundingFirstRequest = quiet(() => authority.requestAuthority(
    "change-grounding", { type: "review" }));
  const groundingFirst = quiet(() => authority.dispatchAuthority("change-grounding", {
    request: groundingFirstRequest.requestId, scope: "full", "reviewer-type": "ai",
    "reviewer-identity": "grounding-one", "reviewer-provider-family": "openai",
    "reviewer-model-family": "gpt", "reviewer-model": "gpt-5.6",
    "reviewer-session": "grounding-one-session"
  }));
  const groundingCompleted = attemptStore.completeReviewAttempt("change-grounding",
    groundingFirst.dispatch.attemptDigest, {
      reviewerSessionId: "grounding-one-session", resultStatus: "fail",
      findings: [{ id: "F-GROUNDING", severity: "major", path: "grounding.yaml",
        message: "grounding correction" }], verifiedFindingIds: []
    });
  writeJson(join(fixture, "change-grounding-receipt.json"), {
    status: "fail", review: { attemptDigest: groundingCompleted.digest }
  });
  quiet(() => authority.abortAuthority("change-grounding", {
    request: groundingFirstRequest.requestId, reason: "apply grounding correction"
  }));
  const groundingSecondRequest = quiet(() => authority.requestAuthority(
    "change-grounding", { type: "review" }));
  const groundingSecond = quiet(() => authority.dispatchAuthority("change-grounding", {
    request: groundingSecondRequest.requestId, scope: "delta",
    "base-attempt": groundingCompleted.digest, "reviewer-type": "ai",
    "reviewer-identity": "grounding-two", "reviewer-provider-family": "google",
    "reviewer-model-family": "gemini", "reviewer-model": "gemini-pro",
    "reviewer-session": "grounding-two-session"
  }));
  assert.equal(groundingSecond.packet.grounding.decisionBatch.status, "locked");
  assert.equal(groundingSecond.packet.contractArtifacts.specs.relativePath, "specs",
    "a nested spec delta retains the containing agreement reference");
  assert(groundingSecond.packet.reviewScope.paths.includes("contract/specs/nested/spec.md"));
  assert(Array.isArray(groundingSecond.packet.claims));

  for (const includeService of [false, true]) {
    const changeId = `change-contract-alias-${includeService}`;
    const contractWorkspace = join(fixture, "openspec", "changes", changeId);
    const serviceWorkspace = join(fixture, "service");
    mkdirSync(serviceWorkspace, { recursive: true });
    writeFileSync(join(serviceWorkspace, "app.txt"), "service\n");
    mkdirSync(join(contractWorkspace, "specs", "nested"), { recursive: true });
    writeFileSync(join(contractWorkspace, "specs", "nested", "spec.md"), "changed\n");
    writeFileSync(join(contractWorkspace, "specs", "nested", "unchanged.md"), "unchanged\n");
    state = { version: 2, changeId, reviewHistory: null };
    packetSequence = 0;
    packetOverride = () => ({
      version: 1, claims: [], contractArtifacts: {},
      changedSurface: {
        inspection: [
          { repositoryId: "root", workspacePath: fixture, baseHead: "head", paths: [] },
          { repositoryId: "contract", workspacePath: contractWorkspace, paths: ["specs/nested/spec.md"] }
        ],
        manifest: [{ repositoryId: "contract", path: "specs/nested/spec.md",
          relativePath: "specs/nested/spec.md", workspacePath: contractWorkspace,
          kind: "contract-artifact", identity: `spec-${packetSequence}` },
        { repositoryId: "contract", path: "specs/nested/unchanged.md",
          relativePath: "specs/nested/unchanged.md", workspacePath: contractWorkspace,
          kind: "contract-artifact", identity: "stable-sibling" },
        ...(includeService ? [{ repositoryId: "service", path: "app.txt",
          relativePath: "app.txt", workspacePath: serviceWorkspace,
          kind: "code", identity: `service-${packetSequence}` }] : [])]
      }
    });
    const firstRequest = quiet(() => authority.requestAuthority(changeId, { type: "review" }));
    const first = quiet(() => authority.dispatchAuthority(changeId, {
      request: firstRequest.requestId, scope: "full", "reviewer-type": "ai",
      "reviewer-identity": "alias-one", "reviewer-provider-family": "openai",
      "reviewer-model-family": "gpt", "reviewer-model": "gpt-5.6",
      "reviewer-session": `${changeId}-one`
    }));
    const completed = attemptStore.completeReviewAttempt(changeId, first.dispatch.attemptDigest, {
      reviewerSessionId: `${changeId}-one`, resultStatus: "fail",
      findings: [{ id: "F-ALIAS", severity: "major", path: "contract/specs/nested/spec.md",
        message: "repair spec" }], verifiedFindingIds: []
    });
    writeJson(join(fixture, `${changeId}-receipt.json`), {
      status: "fail", review: { attemptDigest: completed.digest }
    });
    quiet(() => authority.abortAuthority(changeId, { request: firstRequest.requestId, reason: "repair spec" }));
    const secondRequest = quiet(() => authority.requestAuthority(changeId, { type: "review" }));
    const deltaReport = { changeId, status: "error", summary: "pre-upgrade packet binding failure",
      findings: [], verifiedFindingIds: [] };
    writeJson(join(fixture, `${changeId}-error.json`), deltaReport);
    configuredReviewResults = { "claude-opus": { ...deltaReport,
      retryable: false, bindingFailure: "packet", reportReference: `${changeId}-error.json`,
      reviewer: { sessionId: `${changeId}-two` }
    } };
    quiet(() => authority.runAuthorityReviewer(changeId, {
      request: secondRequest.requestId, reviewer: "claude-opus", "subject-actor": "human-implementer"
    }));
    const second = authorityStore.list(changeId).find((row) => row.value.requestId === secondRequest.requestId).value;
    assert.equal(second.status, "infrastructure-exhausted");
    for (const packet of [first.packet, second.packet]) {
      const verifiedFindingIds = packet.closureFindings?.ids || [];
      for (const path of ["contract/specs/nested/spec.md",
        `openspec/changes/${changeId}/specs/nested/spec.md`,
        `root/openspec/changes/${changeId}/specs/nested/spec.md`])
        assert.deepEqual(reviewFindingIssues({ findings: [{ id: "F-ALIAS", path, line: 1 }],
          verifiedFindingIds }, packet), [], "full and delta preserve contract aliases");
      if (packet.reviewScope.mode === "delta") assert.match(reviewFindingIssues({ findings: [{ id: "F-OTHER",
        path: "contract/specs/nested/unchanged.md", line: 1 }], verifiedFindingIds }, packet)[0],
      /outside the dispatched review scope/);
    }
    assert.deepEqual(second.packet.changedSurface.inspection.find((row) => row.repositoryId === "root").paths, []);
    const failedScope = [...second.packet.reviewScope.paths];
    assert.equal(authority.recoverReviewBindings(changeId), true);
    configuredReviewResults = { "claude-opus": {
      status: "pass", summary: "delta repaired", findings: [], verifiedFindingIds: ["F-ALIAS"],
      reportReference: `${changeId}-pass.json`, reviewer: { sessionId: `${changeId}-three` }
    } };
    const recoveredDelta = quiet(() => authority.runAuthorityReviewer(changeId, {
      request: secondRequest.requestId, reviewer: "claude-opus", "subject-actor": "human-implementer"
    }));
    assert.equal(recoveredDelta.status, "pass");
    assert.deepEqual(lastConfiguredReviewArgs.packet.reviewScope.paths, failedScope,
      "retrying a recovered delta must not turn omitted unchanged files into reverted files");
    assert.match(reviewFindingIssues({ findings: [{ id: "F-OTHER",
      path: "contract/specs/nested/unchanged.md", line: 1 }], verifiedFindingIds: ["F-ALIAS"] },
    lastConfiguredReviewArgs.packet)[0], /outside the dispatched review scope/);
  }
  configuredReviewResults = {};
  packetOverride = null;

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

  state = { version: 2, changeId: "change-high-human-closure", reviewHistory: null };
  const highDelivered = attemptStore.dispatchReviewAttempt("change-high-human-closure", {
    reviewerType: "ai", reviewerIdentity: "first-ai",
    reviewerProviderFamily: "openai", reviewerModelFamily: "gpt",
    reviewerModelId: "gpt-5.6", reviewerSessionId: "first-ai-session",
    requestId: "first-ai-request", workspaceHash,
    scope: { mode: "full", paths: ["root/app.txt"], digest: "first-scope" },
    packetDigest: "first-packet", maxAiAttempts: 2
  });
  const highDeliveredCompletion = attemptStore.completeReviewAttempt(
    "change-high-human-closure", highDelivered.digest, {
      reviewerSessionId: "first-ai-session", resultStatus: "fail",
      findings: [{ id: "F-HIGH", severity: "blocker", path: "app.txt",
        message: "human closure required" }],
      verifiedFindingIds: []
    });
  writeJson(join(fixture, "change-high-human-closure-receipt.json"), {
    status: "fail", review: { attemptDigest: highDeliveredCompletion.digest }
  });
  const highHumanRequest = quiet(() => authority.requestAuthority(
    "change-high-human-closure", { type: "review" }));
  const highHumanClosure = quiet(() => authority.dispatchAuthority(
    "change-high-human-closure", {
      request: highHumanRequest.requestId, scope: "full", "reviewer-type": "human",
      "reviewer-identity": "security-owner"
    }));
  assert.deepEqual(highHumanClosure.packet.closureFindings.ids, ["F-HIGH"]);

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
  const runtimeApi = readJson(join(root, ".claude/harness/protocol.json")).runtimeApi;
  assert.match(agentContract, /Before work, verify Change Loop/i);
  assert.match(agentContract, new RegExp("runtime API `" + runtimeApi + "`"));
  const developerSetup = readFileSync(
    join(root, ".claude/harness/DEVELOPER-SETUP.md"), "utf8");
  assert.match(developerSetup, new RegExp("runtime API\\s+is `" + runtimeApi + "`"));
  // The remedy the agent contract relays has to be a command that exists.
  // `scripts/install-foundation-runtime.mjs` was named here for four releases
  // and has never existed in the repository, so a version-mismatched machine
  // was handed a dead end.
  assert.match(developerSetup, /`claude-foundation init <project-path>`/);
  assert.doesNotMatch(developerSetup, /install-foundation-runtime/);
  assert.match(developerSetup, /Node\.js 20\.19 or later/);
  const policy = readJson(join(root, "foundation.json"));
  assert.equal(policy.workflow.grounding, "optional");
  assert.equal(policy.workflow.reviewCircuit, "full-delta");
  assert.equal(policy.workflow.reviewPolicy, "risk-tiered");
  assert.deepEqual(policy.review.fallbackReviewers, ["codex-sol", "main-session"]);
  assert.equal(policy.review.infraFailureThreshold, 2);
  assert.equal(policy.telemetry.requireUsage, true);
  assert.equal(policy.land.riskBasedCi, false);
  console.log("workflow policy tests: PASS");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
