import assert from "node:assert/strict";
import test from "node:test";
import {
  abortAuthorityOperation,
  acceptanceResponseEvidence,
  authorityClaimIds,
  authorityPacketOperation,
  authorityResponseTemplate,
  authorityRequestPolicy,
  authorityRequestSelection,
  displayAuthorityRequest,
  lockedAuthorityOperation,
  newAuthorityRequestValue,
  pendingAuthorityRequest,
  parseTelemetryEventLine,
  preferredSessionTelemetryRow,
  requestAuthorityOperation,
  reviewResponseEvidence,
  sessionTelemetryProvenanceOperation,
  telemetryProviderFamily,
  telemetryProvenanceValue,
  telemetryRowHasModel,
  telemetryRowsForSession,
  resetInfrastructureAuthorityOperation
} from "../runtime/workflow/authority-runtime.mjs";

const fail = (message) => { throw new Error(message); };

function selectionContext(overrides = {}) {
  return {
    validate: () => {},
    pendingTasks: () => [],
    authorityProvider: (_id, type, repository) => repository
      ? `${type}-${repository}` : type,
    requiredProviders: () => ["review", "acceptance", "review-api"],
    authorityWorkspaceHash: (_id, provider) => `hash:${provider}`,
    fail,
    ...overrides
  };
}

test("authority request selection validates type before lifecycle and pending work", () => {
  assert.throws(() => authorityRequestSelection(selectionContext({
    validate: assert.fail
  }), "c", {}), /type must be review\|acceptance/);
  assert.throws(() => authorityRequestSelection(selectionContext({
    validate: assert.fail
  }), "c", { type: "invalid" }), /type must be review\|acceptance/);
  const validated = [];
  assert.throws(() => authorityRequestSelection(selectionContext({
    validate: (...args) => validated.push(args),
    pendingTasks: () => [{ id: "T002" }, { id: "T001" }]
  }), "c", { type: "review" }), /T002, T001/);
  assert.deepEqual(validated, [["c", "active", { quiet: true }]]);
});

test("authority request selection resolves scoped and unscoped providers", () => {
  assert.deepEqual(authorityRequestSelection(selectionContext(), "c", {
    type: "review", repo: " api "
  }), {
    type: "review", repository: "api", provider: "review-api",
    workspaceHash: "hash:review-api"
  });
  assert.deepEqual(authorityRequestSelection(selectionContext(), "c", {
    type: "acceptance"
  }), {
    type: "acceptance", repository: null, provider: "acceptance",
    workspaceHash: "hash:acceptance"
  });
  assert.throws(() => authorityRequestSelection(selectionContext({
    authorityProvider: () => null
  }), "c", { type: "review", repo: "api" }), /no review provider scoped/);
  assert.throws(() => authorityRequestSelection(selectionContext({
    requiredProviders: () => []
  }), "c", { type: "acceptance" }), /does not require acceptance authority/);
});

test("pending authority lookup requires complete identity and an open status", () => {
  const selection = { type: "review", provider: "reviewer", workspaceHash: "hash" };
  const matching = { type: "review", provider: "reviewer", workspaceHash: "hash" };
  const entries = [
    { value: { ...matching, type: "acceptance", status: "requested" } },
    { value: { ...matching, provider: "other", status: "requested" } },
    { value: { ...matching, workspaceHash: "old", status: "requested" } },
    { value: { ...matching, status: "completed" } },
    { value: { ...matching, status: "pending", requestId: "open" } }
  ];
  assert.equal(pendingAuthorityRequest(entries, selection).requestId, "open");
  assert.equal(pendingAuthorityRequest(entries.slice(0, 4), selection), null);
  for (const status of [
    "requested", "dispatched", "pending", "infrastructure-exhausted"
  ])
    assert.equal(pendingAuthorityRequest([{ value: { ...matching, status } }], selection).status,
      status);
});

test("authority request policy separates review circuit from human acceptance", () => {
  const context = {
    policy: () => ({ workflow: { reviewCircuit: "full-delta" } }),
    reviewPolicy: (id) => ({ id, actor: "ai" }),
    resolvedAcceptance: (id) => ({ id, reason: "requested" })
  };
  assert.deepEqual(authorityRequestPolicy(context, "c", "review"), {
    reviewCircuit: "full-delta", requirements: { id: "c", actor: "ai" }
  });
  assert.deepEqual(authorityRequestPolicy(context, "c", "acceptance"), {
    reviewCircuit: null,
    requirements: { actor: "human", acceptance: { id: "c", reason: "requested" } }
  });
  assert.deepEqual(authorityClaimIds([{ id: "a" }, { id: "b" }]), ["a", "b"]);
});

function valueContext(type = "review") {
  const timestamps = [1000, 2000];
  return {
    protocolVersion: "3",
    authorityPacket: (id, requestType) => ({ id, type: requestType }),
    timestamp: () => timestamps.shift(),
    randomHex: () => "0123456789abcdef",
    claimsForProvider: () => [{ id: "claim-a" }, { id: "claim-b" }],
    canonicalPacketDigest: (packet) => `digest:${packet.type}`,
    now: () => "2026-08-26T00:00:00.000Z",
    policy: () => ({ workflow: { reviewCircuit: "full-delta" } }),
    reviewPolicy: () => ({ actor: "ai" }),
    resolvedAcceptance: () => ({ reason: `${type}-reason` })
  };
}

test("new authority request binds packet, claims, timing, and type policy", () => {
  const review = newAuthorityRequestValue(valueContext(), "change", {
    type: "review", provider: "reviewer", workspaceHash: "workspace"
  });
  assert.deepEqual(review, {
    version: 3,
    requestId: "review-1000-0123456789abcdef",
    changeId: "change", type: "review", provider: "reviewer",
    status: "requested", workspaceHash: "workspace",
    claimIds: ["claim-a", "claim-b"],
    packet: { id: "change", type: "review" },
    packetDigest: "digest:review",
    requestedAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "1970-01-02T00:00:02.000Z",
    reviewCircuit: "full-delta", requirements: { actor: "ai" }
  });
  const acceptance = newAuthorityRequestValue(valueContext("acceptance"), "change", {
    type: "acceptance", provider: "human", workspaceHash: "workspace"
  });
  assert.equal(acceptance.reviewCircuit, null);
  assert.deepEqual(acceptance.requirements, {
    actor: "human", acceptance: { reason: "acceptance-reason" }
  });
});

test("authority display honors quiet mode and configured or default packet limits", () => {
  const rows = [];
  let policyCalls = 0;
  const context = {
    policy: () => { policyCalls += 1; return { execution: {} }; },
    displayValue: (request, limit) => ({ request, limit }),
    output: { log: (row) => rows.push(JSON.parse(row)) }
  };
  displayAuthorityRequest(context, { requestId: "quiet" }, true);
  assert.equal(policyCalls, 0);
  displayAuthorityRequest(context, { requestId: "shown" }, false);
  assert.equal(rows[0].limit, 8192);
  context.policy = () => ({ execution: { packetBytes: { review: 1234 } } });
  displayAuthorityRequest(context, { requestId: "custom" }, false);
  assert.equal(rows[1].limit, 1234);
});

function operationContext(entries = []) {
  const writes = [];
  const rows = [];
  return {
    ...selectionContext(),
    authorityStore: {
      list: () => entries,
      writeRequest: (id, request) => writes.push([id, request])
    },
    ...valueContext(),
    displayValue: (request) => request,
    output: { log: (row) => rows.push(JSON.parse(row)) },
    writes,
    rows
  };
}

test("authority operation reuses open requests and writes new requests once", () => {
  const existing = {
    type: "review", provider: "review", workspaceHash: "hash:review",
    status: "dispatched", requestId: "existing"
  };
  const reused = operationContext([{ value: existing }]);
  assert.equal(requestAuthorityOperation(reused, "c", { type: "review" }), existing);
  assert.equal(reused.writes.length, 0);
  assert.equal(reused.rows[0].requestId, "existing");

  const created = operationContext();
  const request = requestAuthorityOperation(created, "c", { type: "review" }, {
    quiet: true
  });
  assert.equal(created.writes.length, 1);
  assert.deepEqual(created.writes[0], ["c", request]);
  assert.equal(created.rows.length, 0);
});

function abortContext(request, attempt = null, chainHead = null) {
  const entry = request ? { value: request } : null;
  const replaced = [];
  const completed = [];
  const output = [];
  return {
    authorityStore: {
      list: () => entry ? [entry] : [],
      replace: (...args) => replaced.push(args)
    },
    reviewAttemptByDigest: () => attempt,
    reviewHistoryState: () => ({ chainHead }),
    loadRuntime: () => ({}),
    completeReviewAttempt: (...args) => completed.push(args),
    now: () => "2026-08-27T00:00:00.000Z",
    fail,
    output: { log: (row) => output.push(JSON.parse(row)) },
    replaced,
    completed,
    outputRows: output
  };
}

test("authority abort validates identity and terminal request states", () => {
  const missing = abortContext(null);
  assert.throws(() => abortAuthorityOperation(missing, "c", {}),
    /requires --request/);
  assert.throws(() => abortAuthorityOperation(missing, "c", {
    request: "request-a", reason: "reason"
  }), /unknown authority request/);
  const terminal = abortContext({ requestId: "request-a", status: "completed" });
  assert.throws(() => abortAuthorityOperation(terminal, "c", {
    request: "request-a", reason: "reason"
  }), /is completed/);
});

test("authority abort cancels requested work and aborts stale dispatches", () => {
  const requested = abortContext({ requestId: "request-a", status: "requested" });
  const cancelled = abortAuthorityOperation(requested, "c", {
    request: "request-a", reason: " no longer needed "
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.abortReason, "no longer needed");
  assert.equal(requested.replaced.length, 1);
  assert.deepEqual(requested.outputRows, [cancelled]);

  const stale = abortContext({
    requestId: "request-b", status: "dispatched",
    dispatch: { attemptDigest: "attempt-old" }
  }, { digest: "attempt-old", status: "dispatched" }, "attempt-new");
  const aborted = abortAuthorityOperation(stale, "c", {
    request: "request-b", reason: "stale dispatch"
  });
  assert.equal(aborted.status, "aborted");
  assert.equal(stale.completed.length, 0);
  assert.equal(stale.replaced.length, 1);
});

test("authority abort completes the current dispatch and preserves idempotency", () => {
  const attempt = {
    digest: "attempt-current", status: "dispatched", reviewerSessionId: null
  };
  const current = abortContext({
    requestId: "request-a", status: "dispatched",
    dispatch: { attemptDigest: attempt.digest }
  }, attempt, attempt.digest);
  const aborted = abortAuthorityOperation(current, "c", {
    request: "request-a", reason: "reviewer crashed"
  });
  assert.equal(aborted.status, "aborted");
  assert.deepEqual(current.completed[0], ["c", attempt.digest, {
    reviewerSessionId: "", resultStatus: "error",
    findings: [], verifiedFindingIds: []
  }]);

  const already = abortContext({
    requestId: "request-a", status: "aborted",
    dispatch: { attemptDigest: attempt.digest }
  }, { ...attempt, reviewerSessionId: "session-a" }, attempt.digest);
  const unchanged = abortAuthorityOperation(already, "c", {
    request: "request-a", reason: "repeat"
  });
  assert.equal(unchanged.status, "aborted");
  assert.equal(already.replaced.length, 0);
  assert.equal(already.completed[0][2].reviewerSessionId, "session-a");
  assert.deepEqual(already.outputRows, [unchanged]);
});

function resetInfrastructureContext(overrides = {}) {
  const validated = [];
  const acknowledgements = [];
  const output = [];
  const exhaustedEntry = {
    path: "request.json",
    value: { requestId: "request-a", status: "infrastructure-exhausted" }
  };
  const replaced = [];
  return {
    validate: (...args) => validated.push(args),
    reviewerStatus: (reviewer) => ({
      ok: true, reviewer: reviewer || "default-reviewer", check: "doctor"
    }),
    acknowledgeInfrastructureAttempts: (...args) => {
      acknowledgements.push(args);
      return { digests: ["attempt-a", "attempt-b"] };
    },
    fail,
    output: { log: (row) => output.push(row) },
    authorityStore: {
      list: () => [exhaustedEntry],
      replace: (...args) => replaced.push(args)
    },
    now: () => "2026-09-05T00:00:00.000Z",
    validated,
    acknowledgements,
    outputRows: output,
    replaced,
    ...overrides
  };
}

test("infrastructure reset validates decision identity and reviewer diagnosis", () => {
  const missing = resetInfrastructureContext();
  assert.throws(() => resetInfrastructureAuthorityOperation(missing, "c"),
    /requires --decision-ref/);
  assert.deepEqual(missing.validated, [["c", "active", { quiet: true }]]);
  const broken = resetInfrastructureContext({
    reviewerStatus: () => ({
      ok: false, reviewer: "codex", check: "authentication", detail: "expired"
    })
  });
  assert.throws(() => resetInfrastructureAuthorityOperation(broken, "c", {
    "decision-ref": "decision-a", reviewer: " codex "
  }), /codex.*authentication.*expired/);
  assert.equal(broken.acknowledgements.length, 0);
});

test("infrastructure reset acknowledges attempts and renders the recovery route", () => {
  const context = resetInfrastructureContext();
  const result = resetInfrastructureAuthorityOperation(context, "c", {
    "decision-ref": " decision-a ", reviewer: ""
  });
  assert.deepEqual(result, { digests: ["attempt-a", "attempt-b"] });
  assert.deepEqual(context.acknowledgements, [["c", "decision-a"]]);
  assert.equal(context.replaced.length, 1);
  assert.equal(context.replaced[0][1].status, "requested",
    "a diagnosed infrastructure reset reactivates the same durable request");
  assert.match(context.outputRows[0], /default-reviewer \(doctor\)/);
  assert.match(context.outputRows[0], /acknowledged: 2 attempt/);
  assert.match(context.outputRows[0], /decision: decision-a/);
});

test("locked authority adapter preserves identity, flags, and lock ownership", () => {
  const locks = [];
  const operations = [];
  const locked = lockedAuthorityOperation((id, operation) => {
    locks.push(id);
    return operation();
  }, (id, flags) => {
    operations.push([id, flags]);
    return "completed";
  });
  assert.equal(locked("change-a", { reason: "test" }), "completed");
  assert.equal(locked("change-b"), "completed");
  assert.deepEqual(locks, ["change-a", "change-b"]);
  assert.deepEqual(operations, [
    ["change-a", { reason: "test" }], ["change-b", {}]
  ]);
});

const templateContext = {
  protocolVersion: "3",
  expandList: (value) => Array.isArray(value) ? value : value?.preview || [],
  listCount: (value) => Array.isArray(value) ? value.length : value?.count || 0
};

test("acceptance response evidence expands criteria and names compact omissions", () => {
  assert.deepEqual(acceptanceResponseEvidence(templateContext, {
    packet: { claims: { count: 3, preview: [
      { criterion: "criterion-a" }, { id: "claim-b" }
    ] } }
  }).criterion, [
    "criterion-a",
    "<2 further criteria omitted from this preview; read the packet's claims>"
  ]);
  assert.deepEqual(acceptanceResponseEvidence(templateContext, {
    packet: { claims: [] }
  }).criterion, ["<criterion the responder confirmed>"]);
});

test("review response evidence projects undispatched, human, and AI delta provenance", () => {
  const undispatched = reviewResponseEvidence({ packet: {} });
  assert.equal(undispatched.reviewer, "<independent reviewer identity>");
  assert.equal(undispatched["reviewer-provider-family"], "<AI provider family>");
  assert.deepEqual(undispatched.verifiedFindingIds, []);

  const human = reviewResponseEvidence({
    dispatch: { reviewer: { type: "human", identity: "alice" }, scope: { mode: "full" } }
  });
  assert.equal(human.reviewer, "alice");
  assert.equal(human["reviewer-provider-family"], undefined);
  assert.equal(human["scope-path"], undefined);

  const ai = reviewResponseEvidence({
    packet: { closureFindings: { ids: ["F-1"] } },
    dispatch: {
      reviewer: {
        type: "ai", identity: "codex", providerFamily: "openai",
        modelFamily: "gpt", modelId: "gpt-5", sessionId: "session-a"
      },
      scope: { mode: "delta", paths: ["src/app.mjs"] }
    }
  });
  assert.equal(ai["reviewer-model"], "gpt-5");
  assert.deepEqual(ai.verifiedFindingIds, ["F-1"]);
  assert.deepEqual(ai["scope-path"], ["src/app.mjs"]);
});

test("authority response template binds its envelope and type-specific evidence", () => {
  const acceptance = authorityResponseTemplate(templateContext, {
    requestId: "request-a", changeId: "change-a", type: "acceptance",
    workspaceHash: "workspace-a", packet: { claims: [{ criterion: "accepted" }] }
  });
  assert.deepEqual({
    version: acceptance.version,
    requestId: acceptance.requestId,
    changeId: acceptance.changeId,
    type: acceptance.type,
    workspaceHash: acceptance.workspaceHash,
    status: acceptance.status
  }, {
    version: 3, requestId: "request-a", changeId: "change-a",
    type: "acceptance", workspaceHash: "workspace-a",
    status: "pass|fail|inconclusive|error"
  });
  assert.deepEqual(acceptance.evidence.criterion, ["accepted"]);
  assert.equal(authorityResponseTemplate(templateContext, {
    type: "review", packet: {}
  }).evidence["reviewer-type"], "human|ai");
});

function packetContext(overrides = {}) {
  const reviewPacket = {
    changedSurface: {
      inspection: [{ repository: "root", paths: ["src/app.mjs"] }]
    },
    decisions: [{ id: "decision-a" }],
    evidence: [{ provider: "test", status: "pass" }]
  };
  return {
    protocolVersion: "4",
    reviewPacketValue: () => reviewPacket,
    loadRuntime: () => ({ intent: "ship the bounded behavior" }),
    evidence: () => ({ claims: [
      { id: "claim-a", scenario: "A works", impact: "high" },
      { id: "claim-b", scenario: "B works", impact: "low" }
    ] }),
    resolvedAcceptance: () => ({
      claimIds: ["claim-a"], reason: "human decision required"
    }),
    relevantHash: () => "workspace-a",
    reviewPacket,
    ...overrides
  };
}

test("authority packet returns the review packet without loading acceptance state", () => {
  const reviewPacket = { packetType: "review", changeId: "change-a" };
  const context = packetContext({
    reviewPacketValue: () => reviewPacket,
    loadRuntime: () => assert.fail("review packets must not load acceptance state")
  });
  assert.equal(authorityPacketOperation(context, "change-a", "review"), reviewPacket);
});

test("authority packet projects selected acceptance claims and inspection context", () => {
  const context = packetContext();
  const packet = authorityPacketOperation(context, "change-a", "acceptance");
  assert.equal(packet.version, 4);
  assert.equal(packet.packetType, "acceptance");
  assert.equal(packet.workspaceHash, "workspace-a");
  assert.equal(packet.intent, "ship the bounded behavior");
  assert.deepEqual(packet.claims, [{
    id: "claim-a", scenario: "A works", impact: "high",
    criterion: "Confirm the final result satisfies: A works"
  }]);
  assert.equal(packet.inspection.changedSurface, context.reviewPacket.changedSurface);
  assert.deepEqual(packet.inspection.decisions, [{ id: "decision-a" }]);
  assert.deepEqual(packet.inspection.automatedEvidence,
    [{ provider: "test", status: "pass" }]);
  assert.equal(packet.requiredActor, "human");
});

test("authority packet supplies empty inspection fallbacks", () => {
  const packet = authorityPacketOperation(packetContext({
    reviewPacketValue: () => ({}),
    resolvedAcceptance: () => ({ claimIds: [], reason: "acceptance" })
  }), "change-a", "acceptance");
  assert.deepEqual(packet.claims, []);
  assert.deepEqual(packet.inspection, {
    workspaces: [], changedSurface: null, decisions: null, automatedEvidence: []
  });
});

test("session telemetry parsing tolerates malformed rows and matches session or run identity", () => {
  assert.equal(parseTelemetryEventLine("{broken"), null);
  assert.deepEqual(parseTelemetryEventLine('{"sessionId":"session-a"}'), {
    sessionId: "session-a"
  });
  const rows = telemetryRowsForSession([
    "{broken",
    JSON.stringify({ sessionId: "other", agentId: "ignored" }),
    JSON.stringify({ runId: "SESSION-A", agentId: "run-match" }),
    JSON.stringify({ sessionId: "session-a", agentId: "session-match", modelId: "gpt" })
  ].join("\n"), "session-a");
  assert.deepEqual(rows.map((row) => row.agentId), ["run-match", "session-match"]);
  assert.equal(telemetryRowHasModel({ modelId: "gpt" }), true);
  assert.equal(telemetryRowHasModel({ modelId: "" }), false);
  assert.equal(preferredSessionTelemetryRow(rows).agentId, "session-match");
  assert.equal(preferredSessionTelemetryRow([{ agentId: "fallback" }]).agentId,
    "fallback");
  assert.equal(preferredSessionTelemetryRow([]), null);
});

test("telemetry provenance normalizes provider and conservative model family", () => {
  assert.equal(telemetryProviderFamily("claude-transcript"), "anthropic");
  assert.equal(telemetryProviderFamily("codex"), "openai");
  assert.equal(telemetryProviderFamily("OPENAI-api"), "openai");
  assert.equal(telemetryProviderFamily("custom"), "");
  assert.deepEqual(telemetryProvenanceValue({
    agentId: " agent ", source: "codex", modelId: " GPT-5 ",
    modelFamily: " GPT "
  }), {
    identity: "agent", providerFamily: "openai",
    modelFamily: "gpt", modelId: "GPT-5"
  });
  assert.equal(telemetryProvenanceValue({
    source: "claude", modelId: "Claude-Opus"
  }).modelFamily, "claude-opus");
  assert.deepEqual(telemetryProvenanceValue(null), {});
});

test("session telemetry provenance contains missing ledgers and selects the best matching row", () => {
  let reads = 0;
  const context = {
    root: "/workspace",
    readFile: () => {
      reads += 1;
      return [
        JSON.stringify({ runId: "session-a", agentId: "without-model" }),
        JSON.stringify({
          sessionId: "session-a", agentId: "with-model",
          source: "claude", modelId: "claude-opus"
        }),
        JSON.stringify({ sessionId: "session-a", agentId: "later-no-model" })
      ].join("\n");
    }
  };
  assert.deepEqual(sessionTelemetryProvenanceOperation(context, "change-a", ""), {});
  assert.equal(reads, 0);
  assert.deepEqual(sessionTelemetryProvenanceOperation(
    context, "change-a", "session-a"), {
    identity: "with-model", providerFamily: "anthropic",
    modelFamily: "claude-opus", modelId: "claude-opus"
  });
  assert.equal(reads, 1);
  assert.deepEqual(sessionTelemetryProvenanceOperation({
    root: "/workspace", readFile: () => { throw new Error("missing"); }
  }, "change-a", "session-a"), {});
  assert.deepEqual(sessionTelemetryProvenanceOperation({
    root: "/workspace", readFile: () => ""
  }, "change-a", "session-a"), {});
});
