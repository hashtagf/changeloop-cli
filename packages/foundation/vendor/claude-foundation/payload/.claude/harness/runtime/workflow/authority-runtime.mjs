import { REVIEW_DISPATCH_TIMEOUT_MS, currentWaivers } from "../core/user-decisions.mjs";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { acquireProcessLock, isProcessAlive } from "../core/process-lock.mjs";
import { effectiveReviewAttemptLimit } from "../core/authority-policy.mjs";
import { authorityRunCommand, authorityStatusCommand } from "../core/authority-run-command.mjs";
import { reviewFindingIssues, reviewPacketIssues, validReview } from "../evidence/configured-reviewer.mjs";
import { checkpointReviewResult, recoverReviewResult } from "../evidence/review-result-recovery.mjs";
import { normalizeReviewCompletionFindings } from "../evidence/review-attempt-store.mjs";
import {
  reviewAgreementValue, reviewDepthForTier, reviewDiffValue, reviewModelClass,
  reviewScenarioChecklist
} from "../evidence/review-diff.mjs";

export function authorityRequestDisplayValue(request, limit = 8192) {
  const packetBytes = Buffer.byteLength(JSON.stringify(request.packet || null));
  if (request.type !== "review" || packetBytes <= limit) return request;
  return {
    version: request.version,
    requestId: request.requestId,
    changeId: request.changeId,
    type: request.type,
    provider: request.provider,
    status: request.status,
    workspaceHash: request.workspaceHash,
    claimIds: request.claimIds,
    packetDigest: request.packetDigest,
    packet: {
      status: "persisted",
      display: "truncated",
      bytes: packetBytes,
      limit
    },
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    next: `claude-foundation authority status ${request.changeId} --request ${
      request.requestId}`
  };
}

export function requireExternalCiConfig({ fail }, provider, config) {
  if (!config || config.adapter !== "external" || !config.ci?.publicKey || !config.ci?.issuer)
    fail(`provider '${provider}' requires external ci.issuer and ci.publicKey configuration`);
  return config;
}

export function signedCiReceiptFlags(context, id, provider, config, workspaceHash, result) {
  const { payload, artifacts } = result;
  return {
    claims: context.providerClaims(id, provider, config).join(","),
    workspaceHash,
    observed: String(payload.observed || `CI ${payload.status}; commit ${payload.commit || "unknown"}`),
    source: `signed-ci:${payload.issuer}`,
    reference: [payload.runUrl, ...artifacts.map((artifact) =>
      `artifact:${artifact.name}:sha256:${artifact.sha256}`)],
    "recorded-by": `evidence-verify-ci:${payload.issuer}`
  };
}

export function recordVerifiedCiOperation(context, id, provider, source) {
  const config = requireExternalCiConfig(context, provider,
    context.providerConfig(id, provider));
  const path = context.resolvePath(source || "");
  if (!source || !context.pathExists(path))
    context.fail("evidence verify-ci requires a signed JSON envelope");
  const envelope = context.readJson(path);
  const workspaceHash = context.providerWorkspaceHash(id, provider);
  const repository = context.providerRepository(id, provider, config);
  const workspacePath = repository?.workspacePath || context.providerWorkspace(id, provider);
  const result = context.validateSignedCiEnvelope({
    envelope,
    protocolVersion: context.ciEvidenceProtocolVersion,
    issuer: config.ci.issuer,
    publicKey: config.ci.publicKey,
    changeId: id,
    provider,
    workspaceHash,
    head: context.gitHead(workspacePath)
  });
  if (!result.valid) context.fail(result.reason);
  context.recordReceipt(id, provider, result.status,
    signedCiReceiptFlags(context, id, provider, config, workspaceHash, result));
  context.output.log(`CI EVIDENCE ${id}/${provider}: ${result.status}\n  run: ${result.payload.runUrl}`);
}

export function authorityRequestSelection(context, id, flags) {
  const type = String(flags.type || "");
  if (!["review", "acceptance"].includes(type))
    context.fail("authority request --type must be review|acceptance");
  context.validate(id, "active", { quiet: true });
  const pending = context.pendingTasks(id);
  if (pending.length)
    context.fail(`authority request requires completed implementation tasks: ${
      pending.map((task) => task.id).join(", ")}`);
  const repository = String(flags.repo || "").trim() || null;
  const provider = context.authorityProvider(id, type, repository);
  if (!provider || !context.requiredProviders(id).includes(provider))
    context.fail(repository
      ? `change '${id}' has no ${type} provider scoped to repository '${repository}'`
      : `change '${id}' does not require ${type} authority`);
  return {
    type, repository, provider,
    workspaceHash: context.authorityWorkspaceHash(id, provider)
  };
}

export function pendingAuthorityRequest(entries, selection) {
  for (const entry of entries) {
    const value = entry.value;
    if (value.type === selection.type && value.provider === selection.provider &&
        value.workspaceHash === selection.workspaceHash &&
        ["requested", "dispatched", "pending", "infrastructure-exhausted"]
          .includes(value.status))
      return value;
  }
  return null;
}

export function authorityClaimIds(claims) {
  return claims.map((claim) => claim.id);
}

export function randomAuthorityRequestHex() {
  return randomBytes(8).toString("hex");
}

export function authorityRequestPolicy(context, id, type) {
  return type === "review" ? {
    reviewCircuit: context.policy().workflow.reviewCircuit,
    requirements: context.reviewPolicy(id)
  } : {
    reviewCircuit: null,
    requirements: { actor: "human", acceptance: context.resolvedAcceptance(id) }
  };
}

export function newAuthorityRequestValue(context, id, selection) {
  const { type, provider, workspaceHash } = selection;
  const packet = context.authorityPacket(id, type);
  const requestId = `${type}-${context.timestamp()}-${context.randomHex()}`;
  const claimIds = authorityClaimIds(context.claimsForProvider(id, provider));
  const packetDigest = context.canonicalPacketDigest(packet);
  const requestedAt = context.now();
  const expiresAt = new Date(
    context.timestamp() + 24 * 60 * 60 * 1000).toISOString();
  const policy = authorityRequestPolicy(context, id, type);
  return {
    version: Number(context.protocolVersion),
    requestId,
    changeId: id, type, provider, status: "requested", workspaceHash,
    claimIds,
    packet,
    packetDigest,
    requestedAt,
    expiresAt,
    ...policy
  };
}

export function displayAuthorityRequest(context, request, quiet) {
  if (quiet) return;
  const limit = Number(context.policy().execution?.packetBytes?.review || 8192);
  context.output.log(JSON.stringify(context.displayValue(request, limit), null, 2));
}

export function requestAuthorityOperation(context, id, flags = {}, options = {}) {
  const selection = authorityRequestSelection(context, id, flags);
  const existing = pendingAuthorityRequest(context.authorityStore.list(id), selection);
  if (existing) {
    displayAuthorityRequest(context, existing, options.quiet);
    return existing;
  }
  const request = newAuthorityRequestValue(context, id, selection);
  context.authorityStore.writeRequest(id, request);
  displayAuthorityRequest(context, request, options.quiet);
  return request;
}

export function abortAuthorityOperation(context, id, flags = {}) {
  const requestId = String(flags.request || "");
  const reason = String(flags.reason || "").trim();
  if (!requestId || !reason)
    context.fail("authority abort requires --request <id> --reason <text>");
  const entry = context.authorityStore.list(id)
    .find((row) => row.value.requestId === requestId);
  if (!entry) context.fail(`unknown authority request '${requestId}'`);
  const request = entry.value;
  const dispatchedAttempt = request.dispatch?.attemptDigest
    ? context.reviewAttemptByDigest(id, request.dispatch.attemptDigest) : null;
  const attemptIsCurrent = dispatchedAttempt?.status === "dispatched" &&
    context.reviewHistoryState(id, context.loadRuntime(id)).chainHead ===
      dispatchedAttempt.digest;
  if (attemptIsCurrent) {
    context.completeReviewAttempt(id, dispatchedAttempt.digest, {
      reviewerSessionId: dispatchedAttempt.reviewerSessionId || "",
      resultStatus: "error",
      findings: [],
      verifiedFindingIds: []
    });
  }
  if (request.status === "aborted" && attemptIsCurrent) {
    context.output.log(JSON.stringify(request, null, 2));
    return request;
  }
  if (!["requested", "dispatched"].includes(request.status))
    context.fail(`authority request '${requestId}' is ${request.status}`);
  const updated = {
    ...request,
    status: request.status === "dispatched" ? "aborted" : "cancelled",
    abortedAt: context.now(),
    abortReason: reason
  };
  context.authorityStore.replace(entry, updated);
  context.output.log(JSON.stringify(updated, null, 2));
  return updated;
}

// The user's "one more AI attempt" answer to exhausted AI review. The grant
// raises the cap by one, so the open request's next route is `authority run`
// again and `advance` dispatches it.
export function extendReviewAuthorityOperation(context, id, flags = {}) {
  context.validate(id, "active", { quiet: true });
  const decisionRef = String(flags["decision-ref"] || "").trim();
  if (!decisionRef)
    context.fail("authority extend-review requires --decision-ref <ref>");
  const open = (context.authorityStore?.list(id) || []).map((entry) => entry.value)
    .find((request) => request.type === "review" && request.status === "requested");
  const { maxAiAttempts } = context.effectiveReviewAttemptLimit(
    context.reviewPolicy(id), context.deliveredAiAttempts(id), open?.workspaceHash || null);
  const result = context.grantExtraAiWave(id, decisionRef, maxAiAttempts);
  context.output.log(`AUTHORITY ${id}: one more AI review wave\n  waves: ${
    result.delivered}/${result.maxAiAttempts}\n  decision: ${decisionRef
    }\n  next: ${`claude-foundation advance ${id} --through proven`}`);
  return result;
}

export function resetInfrastructureAuthorityOperation(context, id, flags = {}) {
  context.validate(id, "active", { quiet: true });
  const decisionRef = String(flags["decision-ref"] || "").trim();
  if (!decisionRef)
    context.fail("authority reset-infra requires --decision-ref <ref>");
  const reviewerName = String(flags.reviewer || "").trim() || null;
  const status = context.reviewerStatus(reviewerName);
  if (!status.ok)
    context.fail(`configured reviewer '${status.reviewer}' still fails its ${status.check} diagnosis: ${status.detail}`);
  const result = context.acknowledgeInfrastructureAttempts(id, decisionRef);
  for (const entry of context.authorityStore?.list(id) || []) {
    if (entry.value.status !== "infrastructure-exhausted") continue;
    context.authorityStore.replace(entry, {
      ...entry.value,
      status: "requested",
      infrastructureResetAt: context.now?.() || null,
      infrastructureResetDecisionRef: decisionRef
    });
  }
  context.output.log(`AUTHORITY ${id}: infrastructure retries reset\n  reviewer: ${
    status.reviewer} (${status.check})\n  acknowledged: ${
    result.digests.length} attempt(s)\n  decision: ${decisionRef
    }\n  next: request and dispatch the AI review again`);
  return result;
}

export function lockedAuthorityOperation(withAuthorityLock, operation) {
  return (id, flags = {}) => withAuthorityLock(
    id, operation.bind(null, id, flags));
}

export function acceptanceResponseEvidence(context, request) {
  const claimRows = context.expandList(request.packet?.claims);
  const criteria = claimRows.map((claim) => claim.criterion).filter(Boolean);
  const count = context.listCount(request.packet?.claims);
  if (criteria.length && criteria.length < count)
    criteria.push(`<${count - criteria.length} further criteria omitted from this preview; read the packet's claims>`);
  return {
    observed: "<what the responder actually saw, in their own words>",
    artifact: [],
    reference: ["<url or path the responder inspected>"],
    acceptor: "<name of the person who decided>",
    decision: "accept",
    criterion: criteria.length ? criteria : ["<criterion the responder confirmed>"]
  };
}

export function responseEvidenceBase() {
  return {
    observed: "<what the responder actually saw, in their own words>",
    artifact: [],
    reference: ["<url or path the responder inspected>"]
  };
}

export function reviewerResponseEvidence(dispatched) {
  const evidence = {
    reviewer: dispatched?.identity || "<independent reviewer identity>",
    "reviewer-type": dispatched?.type || "human|ai"
  };
  if (!dispatched || dispatched.type === "ai") {
    evidence["reviewer-provider-family"] = dispatched?.providerFamily ||
      "<AI provider family>";
    evidence["reviewer-model-family"] = dispatched?.modelFamily ||
      "<AI model family>";
    evidence["reviewer-model"] = dispatched?.modelId || "<AI model id>";
    evidence["reviewer-session"] = dispatched?.sessionId ||
      "<AI review session>";
  }
  return evidence;
}

export function reviewSubjectResponseEvidence() {
  return {
    "subject-actor": "<who or what implemented the change>",
    "subject-session": "<implementation session id, omit for a human implementer>",
    "subject-provider-family":
      "<implementation provider family, omit for a human implementer>",
    "subject-model-family":
      "<implementation model family, omit for a human implementer>",
    "subject-model": "<implementation model id, omit for a human implementer>"
  };
}

export function reviewFindingResponseEvidence(request) {
  // The count matches the prefilled first-round IDs, so a delta response
  // recorded as given passes the count check.
  const verifiedFindingIds = request.packet?.closureFindings?.ids || [];
  const evidence = {
    "unresolved-blockers": 0,
    "verified-findings": verifiedFindingIds.length,
    findings: [],
    verifiedFindingIds
  };
  if (request.dispatch?.scope?.mode === "delta")
    evidence["scope-path"] = request.dispatch.scope.paths;
  return evidence;
}

export function reviewResponseEvidence(request) {
  return {
    ...responseEvidenceBase(),
    ...reviewerResponseEvidence(request.dispatch?.reviewer || null),
    ...reviewSubjectResponseEvidence(),
    ...reviewFindingResponseEvidence(request)
  };
}

const RESPONSE_REFERENCE_URI = /^[a-z][a-z0-9+.-]*:\/\//i;

// The response problems `authority record` can decide before validating the
// receipt, collected together: dispatch, references, provenance, and finding
// closure. The later checks stay as the authority; this only reports early.
export function authorityResponsePreflightIssues({ request, response, undispatched = false,
  referenceExists = () => true }) {
  const issues = [];
  if (undispatched)
    issues.push(`dispatch the request first: claude-foundation authority dispatch ${request.changeId} ` +
      `--request ${request.requestId} --scope full|delta --reviewer-type human|ai --reviewer-identity <id>`);
  if (request.type !== "review") return issues;
  const evidence = response?.evidence && typeof response.evidence === "object" ? response.evidence : {};
  // An error response closes the attempt as an infrastructure outcome; it
  // carries no receipt, so receipt provenance and references do not apply.
  const infrastructureError = response?.status === "error";
  const references = (Array.isArray(evidence.reference) ? evidence.reference : [])
    .map((value) => String(value).trim()).filter(Boolean);
  const missing = infrastructureError ? [] : references.filter((reference) =>
    !RESPONSE_REFERENCE_URI.test(reference) && !referenceExists(reference));
  if (missing.length)
    issues.push(`a reference must be a URI or a path that exists: ${missing.join(", ")}`);
  // `subject-provenance` is the other accepted form, and the only one for
  // several implementers.
  const hasProvenance = evidence["subject-provenance"] !== undefined &&
    evidence["subject-provenance"] !== null && evidence["subject-provenance"] !== "";
  if (!infrastructureError && !hasProvenance && !String(evidence["subject-actor"] || "").trim())
    issues.push("add evidence.subject-actor (who implemented the change) or evidence.subject-provenance");
  const aiSubject = ["subject-provider-family", "subject-model-family", "subject-model"]
    .some((key) => String(evidence[key] || "").trim());
  if (!infrastructureError && !hasProvenance && aiSubject &&
      !String(evidence["subject-session"] || "").trim())
    issues.push("an AI implementer needs evidence.subject-session");
  const verifiedIds = Array.isArray(evidence.verifiedFindingIds) ? evidence.verifiedFindingIds : [];
  // The receipt validator's rule: counts bind only when finding rows or
  // verified IDs are supplied, or the scope is a delta.
  const suppliedRows = (Array.isArray(evidence.findings) && evidence.findings.length > 0) ||
    verifiedIds.length > 0 || request.dispatch?.scope?.mode === "delta" ||
    (Array.isArray(evidence["scope-path"]) && evidence["scope-path"].length > 0);
  if (!infrastructureError && suppliedRows && evidence["verified-findings"] !== undefined &&
      Number(evidence["verified-findings"]) !== verifiedIds.length)
    issues.push(`evidence.verified-findings (${evidence["verified-findings"]}) must equal the ` +
      `${verifiedIds.length} verifiedFindingIds`);
  const expected = request.packet?.closureFindings?.ids;
  if (Array.isArray(expected) && response?.status !== "error") {
    const supplied = [...new Set(verifiedIds.map((value) => String(value).trim()).filter(Boolean))].sort();
    if (JSON.stringify([...expected].sort()) !== JSON.stringify(supplied))
      issues.push(`verifiedFindingIds must close exactly the first-round findings: ${[...expected].sort().join(", ")}`);
  }
  return issues;
}

export function authorityResponseTemplate(context, request) {
  // Preserve the established eager claim expansion. The production compactor
  // supports both arrays and previews, and callers may rely on malformed packet
  // shapes failing before a review template is projected.
  const acceptanceEvidence = acceptanceResponseEvidence(context, request);
  // A full-delta review is recorded only after dispatch; say so up front.
  const dispatchFirst = request.type === "review" && request.reviewCircuit === "full-delta" &&
    request.status !== "dispatched"
    ? `claude-foundation authority dispatch ${request.changeId} --request ${request.requestId} ` +
      "--scope full|delta --reviewer-type human|ai --reviewer-identity <id>"
    : null;
  return {
    version: Number(context.protocolVersion),
    requestId: request.requestId,
    changeId: request.changeId,
    type: request.type,
    ...(dispatchFirst ? { dispatchFirst } : {}),
    workspaceHash: request.workspaceHash,
    status: "pass|fail|inconclusive|error",
    evidence: request.type === "acceptance"
      ? acceptanceEvidence : reviewResponseEvidence(request)
  };
}

export function authorityPacketOperation(context, id, type) {
  if (type === "review") return context.reviewPacketValue(id);
  const state = context.loadRuntime(id);
  const contract = context.evidence(id);
  const acceptance = context.resolvedAcceptance(id, state, contract);
  const reviewContext = context.reviewPacketValue(id);
  const claims = contract.claims
    .filter((claim) => acceptance.claimIds.includes(claim.id))
    .map((claim) => ({
      id: claim.id,
      scenario: claim.scenario,
      impact: claim.impact,
      criterion: `Confirm the final result satisfies: ${claim.scenario}`
    }));
  return {
    version: Number(context.protocolVersion),
    packetType: "acceptance",
    changeId: id,
    workspaceHash: context.relevantHash(id),
    reason: acceptance.reason,
    intent: state.intent,
    claims,
    inspection: {
      workspaces: reviewContext.changedSurface?.inspection || [],
      changedSurface: reviewContext.changedSurface || null,
      decisions: reviewContext.decisions || null,
      automatedEvidence: reviewContext.evidence || []
    },
    response: {
      statuses: ["pass", "fail", "inconclusive", "error"],
      instructions: "Inspect the final workspace against every criterion. Pass only when all criteria are satisfied; otherwise reject, report uncertainty, or pause without a response.",
      requiredForPass: [
        "named human", "criterion observations", "durable artifact or reference"
      ]
    },
    requiredActor: "human"
  };
}

export function parseTelemetryEventLine(line) {
  try { return JSON.parse(line); }
  catch { return null; }
}

export function telemetryRowsForSession(text, sessionId) {
  const normalizedSession = sessionId.toLowerCase();
  return text.split(/\r?\n/).filter(Boolean)
    .map(parseTelemetryEventLine)
    .filter((row) => row && [row.sessionId, row.runId]
      .some((value) => String(value || "").toLowerCase() === normalizedSession));
}

export function telemetryRowHasModel(candidate) {
  return Boolean(candidate.modelId);
}

export function preferredSessionTelemetryRow(rows) {
  return rows.filter(telemetryRowHasModel).at(-1) ||
    rows.at(-1) || null;
}

export function telemetryProviderFamily(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("claude")) return "anthropic";
  if (normalized.includes("codex") || normalized.includes("openai"))
    return "openai";
  return "";
}

export function telemetryProvenanceValue(row) {
  if (!row) return {};
  const modelId = String(row.modelId || "").trim();
  return {
    identity: String(row.agentId || "").trim(),
    providerFamily: telemetryProviderFamily(row.source),
    modelFamily: String(row.modelFamily || modelId).trim().toLowerCase(),
    modelId
  };
}

export function sessionTelemetryProvenanceOperation(context, id, sessionId) {
  if (!sessionId) return {};
  try {
    const text = context.readFile(join(
      context.root, ".foundation", "logs", id, "events.jsonl"), "utf8");
    return telemetryProvenanceValue(preferredSessionTelemetryRow(
      telemetryRowsForSession(text, sessionId)));
  } catch { return {}; }
}

export function mainSessionEnvironment(environment) {
  const claudeSession = String(
    environment.FOUNDATION_CLAUDE_SESSION_ID || "").trim();
  const codexSession = String(environment.CODEX_THREAD_ID || "").trim();
  const genericSession = String(environment.FOUNDATION_SESSION_ID || "").trim();
  const declaredMainSession = String(
    environment.FOUNDATION_MAIN_SESSION_ID || "").trim();
  return {
    claudeSession,
    codexSession,
    ambientSession: claudeSession || genericSession || codexSession ||
      declaredMainSession
  };
}

export function bindMainSession(context, flags, environment) {
  const requestedSession = String(
    flags["main-session-id"] || environment.ambientSession).trim();
  if (environment.ambientSession && requestedSession &&
      environment.ambientSession !== requestedSession)
    context.fail("main-session fallback session must match the calling host session");
  return environment.ambientSession ? requestedSession : "";
}

export function inferredMainSession(environment) {
  if (environment.claudeSession &&
      environment.ambientSession === environment.claudeSession)
    return { providerFamily: "anthropic", identity: "claude-main-session" };
  if (environment.codexSession &&
      environment.ambientSession === environment.codexSession)
    return { providerFamily: "openai", identity: "codex-main-session" };
  return { providerFamily: "", identity: "" };
}

export function firstMainSessionValue(values, lowercase = false) {
  const value = String(values.find(Boolean) || "").trim();
  return lowercase ? value.toLowerCase() : value;
}

export function mainSessionFallbackValue(
  inheritsSubject, subjectValue, telemetryValue, inferredValue = ""
) {
  return inheritsSubject
    ? subjectValue : firstMainSessionValue([telemetryValue, inferredValue]);
}

export function mainSessionProvenanceValue(
  flags, subject, environmentVariables, session, telemetry
) {
  const inheritsSubject = subject.sessionId && session.boundSession &&
    String(subject.sessionId).toLowerCase() === session.boundSession.toLowerCase();
  const inferred = inferredMainSession(session.environment);
  const value = {
    identity: firstMainSessionValue([
      flags["main-session-identity"],
      environmentVariables.FOUNDATION_MAIN_IDENTITY,
      mainSessionFallbackValue(
        inheritsSubject, subject.identity, telemetry.identity, inferred.identity)
    ]),
    sessionId: session.boundSession || null,
    providerFamily: firstMainSessionValue([
      flags["main-session-provider-family"],
      environmentVariables.FOUNDATION_MAIN_PROVIDER_FAMILY,
      mainSessionFallbackValue(inheritsSubject, subject.providerFamily,
        telemetry.providerFamily, inferred.providerFamily)
    ], true),
    modelFamily: firstMainSessionValue([
      flags["main-session-model-family"],
      environmentVariables.FOUNDATION_MAIN_MODEL_FAMILY,
      mainSessionFallbackValue(
        inheritsSubject, subject.modelFamily, telemetry.modelFamily)
    ], true),
    modelId: firstMainSessionValue([
      flags["main-session-model"],
      environmentVariables.FOUNDATION_MODEL_ID,
      mainSessionFallbackValue(
        inheritsSubject, subject.modelId, telemetry.modelId)
    ])
  };
  const missing = Object.entries(value)
    .filter(([, fieldValue]) => !fieldValue).map(([name]) => name);
  return { ...value, missing };
}

export function createAuthorityRuntime({
  root,
  protocolVersion,
  ciEvidenceProtocolVersion,
  authorityStore,
  requiredProviders,
  providerCapability,
  providerConfig,
  reviewPacketValue,
  loadRuntime,
  saveRuntime,
  evidence,
  resolvedAcceptance,
  relevantHash,
  validate,
  pendingTasks,
  claimsForProvider,
  stableHash,
  now,
  reviewPolicy,
  readJson,
  receiptPath,
  recordReceipt,
  receiptValidity,
  fileDigest,
  providerWorkspaceHash,
  providerRepository,
  providerWorkspace,
  gitHead,
  validateSignedCiEnvelope,
  providerClaims,
  expandList,
  listCount,
  dispatchReviewAttempt,
  completeReviewAttempt,
  reviewHistoryState,
  reviewAttempts,
  deliveredAiAttempts,
  reviewAttemptByDigest,
  assertReviewDispatchAllowed,
  foundationPolicy,
  reviewerConfig,
  reviewerStatus,
  // Absent in narrow compositions: every configured reviewer is routable.
  reviewerInstalled = () => true,
  runConfiguredReview,
  // Optional non-blocking twin of runConfiguredReview; absent means the
  // asynchronous route awaits the synchronous reviewer.
  runConfiguredReviewAsync = null,
  acknowledgeInfrastructureAttempts,
  // Absent in narrow compositions: extend-review then refuses.
  grantExtraAiWave = () => fail("extra AI review waves are unavailable in this composition"),
  acknowledgeBaseMoveAttempts,
  // Absent in narrow compositions: dispatch then keeps the manual reset routes.
  autoReleaseReviewBudget = () => [],
  // Drops the process-local snapshot cache so the post-review content check
  // reads the bytes on disk, not the snapshot taken before the reviewer ran.
  clearSnapshotCache = () => {},
  writeJson,
  fail,
  // { git, pathExists, readFile, readDirectory, isDirectory }; absent means
  // AI dispatch carries no inline diff and the reviewer inspects the workspace.
  reviewDiffContext = null
}) {
  function withAuthorityLock(id, operation) {
    const locks = join(root, ".foundation", "locks");
    const lock = join(locks, `authority-${id}.lock`);
    const acquired = acquireProcessLock(lock, { now });
    if (!acquired.acquired)
      fail(`authority mutation for '${id}' is already in progress; retry after it completes`);
    try { return operation(); }
    finally { acquired.release(); }
  }
  function authorityProvider(id, type, repository = null) {
    return requiredProviders(id).find((provider) => {
      const config = providerConfig(id, provider);
      if (providerCapability(provider, config) !== type) return false;
      return repository ? config?.repository === repository : true;
    }) || (repository ? null : type);
  }

  // A review provider that names a repository is a verdict about that
  // repository, so it binds to that repository's workspace hash. Binding every
  // verdict to the composite meant an edit in *any* selected repository
  // invalidated a review already earned elsewhere — on a wide change, review
  // became a moving target.
  function authorityWorkspaceHash(id, provider) {
    return providerWorkspaceHash(id, provider);
  }

  const authorityPacket = authorityPacketOperation.bind(null, {
    protocolVersion, reviewPacketValue, loadRuntime, evidence,
    resolvedAcceptance, relevantHash
  });

  function canonicalPacketDigest(packet) {
    const canonical = JSON.parse(JSON.stringify(packet || {}));
    delete canonical.packetDigest;
    return stableHash(canonical);
  }

  // The receipt records only the latest attempt digest, so counting delivered
  // attempts against receipt-matching ones misfires the moment a delta receipt
  // overwrites the full receipt or a human receipt supersedes the AI one. The
  // sound question is latest-vs-latest: is the newest delivered AI response
  // still waiting for its receipt, with nothing recorded after it?
  function unrecordedDeliveredAiResponse(id, history, provider) {
    const latest = deliveredAiAttempts(id, history).at(-1);
    if (!latest) return null;
    // A migrated attempt was synthesized from the receipt itself, so it is
    // recorded by construction.
    if (latest.migrated) return null;
    const path = receiptPath(id, provider);
    const receipt = existsSync(path) ? readJson(path, {}) : {};
    const recordedDigest = receipt.review?.attemptDigest || null;
    if (!recordedDigest) return latest;
    const recorded = reviewAttempts(id, history).find((attempt) =>
      attempt.digest === recordedDigest);
    if (recorded && Number(recorded.attempt) >= Number(latest.attempt))
      return null;
    return latest;
  }

  const requestAuthorityUnlocked = requestAuthorityOperation.bind(null, {
    validate,
    pendingTasks,
    authorityProvider,
    requiredProviders,
    authorityWorkspaceHash,
    authorityStore,
    authorityPacket,
    claimsForProvider,
    canonicalPacketDigest,
    protocolVersion,
    timestamp: Date.now,
    randomHex: randomAuthorityRequestHex,
    now,
    policy: foundationPolicy,
    reviewPolicy,
    resolvedAcceptance,
    displayValue: authorityRequestDisplayValue,
    output: console
  });

  function requestAuthority(id, flags = {}, options = {}) {
    return withAuthorityLock(id, () => requestAuthorityUnlocked(id, flags, options));
  }

  function dispatchRequestContext(id, flags) {
    const requestId = String(flags.request || "");
    if (!requestId) fail("authority dispatch requires --request <id>");
    const entry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const request = entry.value;
    if (request.status === "dispatched") {
      console.log(JSON.stringify(request, null, 2));
      return { handled: true, value: request };
    }
    if (request.type !== "review")
      fail("authority dispatch currently reserves review authority only");
    if (request.reviewCircuit !== "full-delta")
      fail(`authority request '${requestId}' predates the full-delta circuit; record or cancel it without dispatch`);
    if (request.status !== "requested")
      fail(`authority request '${requestId}' is ${request.status}`);
    if (request.workspaceHash !== authorityWorkspaceHash(id, request.provider))
      fail(`authority request '${requestId}' is stale`);
    if (Date.parse(request.expiresAt || "") <= Date.now())
      fail(`authority request '${requestId}' is expired`);
    if (canonicalPacketDigest(request.packet) !== request.packetDigest)
      fail(`authority request '${requestId}' packet no longer matches its recorded digest`);
    const reviewerType = String(flags["reviewer-type"] || "").toLowerCase();
    if (!["ai", "human"].includes(reviewerType))
      fail("authority dispatch requires --reviewer-type ai|human");
    return { handled: false, entry, request, requestId, reviewerType };
  }

  function reviewInfrastructureRetryLimit() {
    const reviewSettings = foundationPolicy().review || {};
    const configuredFallbacks = (Array.isArray(reviewSettings.fallbackReviewers)
      ? reviewSettings.fallbackReviewers
      : reviewSettings.fallbackReviewer ? [reviewSettings.fallbackReviewer] : [])
      .filter((name) => name !== "main-session");
    return Math.max(1,
      (1 + configuredFallbacks.length) * Number(reviewSettings.infraFailureThreshold || 1));
  }

  // Release harness-caused review accounting before any dispatch guard reads
  // it, and reopen requests an exhausted infrastructure circuit had closed.
  function releaseHarnessReviewBudget(id) {
    const released = autoReleaseReviewBudget(id, {
      maxInfrastructureRetries: reviewInfrastructureRetryLimit(),
      reviewerHealthy: () => reviewerStatus(null).ok === true,
      reviewerIdentity: stableHash(foundationPolicy().review || {}).slice(0, 12)
    });
    const infrastructure = released.find((reference) => reference.startsWith("harness:infra:"));
    if (infrastructure) for (const entry of authorityStore.list(id)) {
      if (entry.value.status !== "infrastructure-exhausted") continue;
      authorityStore.replace(entry, {
        ...entry.value, status: "requested",
        infrastructureResetAt: now(), infrastructureResetDecisionRef: infrastructure
      });
    }
    for (const reference of released)
      console.error(`AUTHORITY ${id}: harness released review accounting (${reference})`);
    return released;
  }

  function dispatchAuthorityUnlocked(id, flags = {}) {
    releaseHarnessReviewBudget(id);
    const context = dispatchRequestContext(id, flags);
    if (context.handled) return context.value;
    const { entry, request, requestId, reviewerType } = context;
    function dispatchRouting() {
    const routing = reviewPolicy(id);
    const historySnapshot = reviewHistoryState(id);
    const deliveredSnapshot = deliveredAiAttempts(id, historySnapshot);
    const { promotesLow, maxAiAttempts } = effectiveReviewAttemptLimit(
      routing, deliveredSnapshot, request.workspaceHash);
    const maxInfrastructureRetries = reviewInfrastructureRetryLimit();
    // The route-aware cap still wins over malformed scope/base details.
    const history = assertReviewDispatchAllowed(
      id, reviewerType, maxAiAttempts, maxInfrastructureRetries);
    const deliveredAi = deliveredAiAttempts(id, history);
    if (unrecordedDeliveredAiResponse(id, history, request.provider))
      fail("a completed AI response has no matching recorded receipt; repair that authority record or pause instead of dispatching another reviewer");
    if (promotesLow) {
      // A second dispatch means the first review did not close the change and
      // production moved. That is the one permitted low→medium promotion.
      request.requirements = {
        ...request.requirements,
        tier: "medium",
        promotedFrom: "low",
        promotionReason: "post-review-correction"
      };
    }
    return { routing, deliveredAi, maxAiAttempts, maxInfrastructureRetries };
    }
    const { routing, deliveredAi, maxAiAttempts,
      maxInfrastructureRetries } = dispatchRouting();
    function dispatchReviewer() {
    const reviewerIdentity = String(flags["reviewer-identity"] || "").trim();
    if (!reviewerIdentity)
      fail("authority dispatch requires --reviewer-identity");
    const reviewerProviderFamily = String(flags["reviewer-provider-family"] || "").trim().toLowerCase() || null;
    const reviewerModelFamily = String(flags["reviewer-model-family"] || "").trim().toLowerCase() || null;
    const reviewerModelId = String(flags["reviewer-model"] || "").trim() || null;
    const reviewerSessionId = String(flags["reviewer-session"] || "").trim() || null;
    const sessionDeferred = flags["reviewer-session-deferred"] === true;
    if (reviewerType === "ai" && [
      reviewerProviderFamily, reviewerModelFamily, reviewerModelId
    ].some((value) => !value))
      fail("AI dispatch requires reviewer provider/model family and model ID");
    if (reviewerType === "ai" && !reviewerSessionId && !sessionDeferred)
      fail("AI dispatch requires reviewer session unless a configured reviewer defers it to the actual thread.started event");
    function validateDispatchReviewerRoute() {
    if (reviewerType === "ai" && deliveredAi.length > 0) {
      const priorAi = deliveredAi.at(-1);
      if (priorAi?.reviewerType === "ai" &&
          priorAi.reviewerSessionId === reviewerSessionId)
        fail("AI delta closure requires a fresh reviewer session");
    }
    if (reviewerType === "ai" && providerConfig(id, request.provider)?.repository)
      fail("AI full-delta review requires one composite unscoped review provider; reconfigure the provider or split the change");
    }
    validateDispatchReviewerRoute();
    return { reviewerIdentity, reviewerProviderFamily, reviewerModelFamily,
      reviewerModelId, reviewerSessionId, sessionDeferred };
    }
    const { reviewerIdentity, reviewerProviderFamily, reviewerModelFamily,
      reviewerModelId, reviewerSessionId, sessionDeferred } = dispatchReviewer();
    function dispatchScope() {
    const scopeMode = String(flags.scope || "").toLowerCase();
    if (!["full", "delta"].includes(scopeMode))
      fail("authority dispatch requires --scope full|delta");
    const baseAttemptDigest = String(flags["base-attempt"] || "").trim() || null;
    const currentManifest = Array.isArray(request.packet?.changedSurface?.manifest)
      ? request.packet.changedSurface.manifest : [];
    let scopeRows = currentManifest;
    let baseWorkspaceHash = null;
    let baseAttempt = null;
    function resolveDeltaScope() {
    if (scopeMode === "delta") {
      baseAttempt = reviewAttemptByDigest(id, baseAttemptDigest);
      if (!baseAttempt || baseAttempt.reviewerType !== "ai")
        fail("AI delta review requires --base-attempt naming the first durable AI dispatch");
      const baseRequest = authorityStore.list(id)
        .find((row) => row.value.requestId === baseAttempt.requestId)?.value;
      if (!baseRequest)
        fail("AI delta review cannot resolve the packet used by its base dispatch");
      if (canonicalPacketDigest(baseRequest.packet) !== baseAttempt.packetDigest)
        fail("AI delta review base packet no longer matches the immutable first dispatch");
      const baseManifest = Array.isArray(baseRequest.packet?.changedSurface?.manifest)
        ? baseRequest.packet.changedSurface.manifest : [];
      const baseRows = new Map(baseManifest.map((row) => [
        `${row.repositoryId}/${row.path}`, row
      ]));
      const currentRows = new Map(currentManifest.map((row) => [
        `${row.repositoryId}/${row.path}`, row
      ]));
      const projected = request.packet.reviewScope?.mode === "delta" &&
        request.packet.reviewScope.baseAttemptDigest === baseAttemptDigest &&
        request.packet.changedSurface?.deltaFrom?.attemptDigest === baseAttemptDigest;
      // A retry already carries a projected delta. Missing base rows there are
      // unchanged files, not evidence of a revert in the current workspace.
      if (!projected) {
        scopeRows = currentManifest.filter((row) =>
          baseRows.get(`${row.repositoryId}/${row.path}`)?.identity !== row.identity);
        for (const [key, row] of baseRows)
          if (!currentRows.has(key)) scopeRows.push({ ...row, identity: "reverted-to-base" });
      }
      scopeRows.sort((left, right) =>
        `${left.repositoryId}/${left.path}`.localeCompare(`${right.repositoryId}/${right.path}`));
      if (scopeRows.length === 0)
        fail("AI delta review has no files changed since the first AI dispatch; do not spend the second review round");
      baseWorkspaceHash = baseAttempt.workspaceHash;
    }
    }
    resolveDeltaScope();
    const scopePaths = scopeRows.map((row) => `${row.repositoryId}/${row.path}`);
    const scopeDigest = stableHash({
      mode: scopeMode,
      baseAttemptDigest,
      baseWorkspaceHash,
      workspaceHash: request.workspaceHash,
      rows: scopeRows
    });
    return { scopeMode, baseAttemptDigest, baseWorkspaceHash, baseAttempt,
      scopeRows, scopePaths, scopeDigest };
    }
    const { scopeMode, baseAttemptDigest, baseWorkspaceHash, baseAttempt,
      scopeRows, scopePaths, scopeDigest } = dispatchScope();
    function dispatchPacket() {
    const packet = JSON.parse(JSON.stringify(request.packet));
    packet.reviewScope = {
      mode: scopeMode,
      baseAttemptDigest,
      baseWorkspaceHash,
      workspaceHash: request.workspaceHash,
      paths: scopePaths,
      digest: scopeDigest
    };
    function applyHighRiskHumanClosure() {
    if (routing.tier === "high" && reviewerType === "human" && deliveredAi.length) {
      const baseAttempt = deliveredAi.at(-1);
      const closureFindings = (baseAttempt.findings || []).filter((finding) =>
        ["blocker", "major"].includes(finding.severity));
      packet.closureFindings = {
        baseAttemptDigest: baseAttempt.digest,
        ids: closureFindings.map((finding) => finding.id).sort(),
        findings: closureFindings
      };
    }
    }
    applyHighRiskHumanClosure();
    function applyDeltaPacket() {
    if (scopeMode === "delta") {
      function deltaInspection() {
      const fullInspection = new Map((request.packet?.changedSurface?.inspection || [])
        .map((entry) => [entry.repositoryId, entry]));
      const inspection = [...scopeRows.reduce((groups, row) => {
        const key = `${row.repositoryId}\u0000${row.workspacePath || ""}`;
        if (!groups.has(key)) groups.set(key, {
          repositoryId: row.repositoryId,
          workspacePath: row.workspacePath || fullInspection.get(row.repositoryId)?.workspacePath || null,
          baseHead: fullInspection.get(row.repositoryId)?.baseHead || null,
          paths: []
        });
        groups.get(key).paths.push(row.relativePath || row.path);
        return groups;
      }, new Map()).values()];
      // Contract aliases need the control workspace even when no root product
      // file changed. Keep its location without granting additional paths.
      const control = fullInspection.get("root");
      if (control && !inspection.some((entry) => entry.repositoryId === "root"))
        inspection.push({ ...control, paths: [], pathCount: 0, truncated: false });
      return inspection;
      }
      const inspection = deltaInspection();
      packet.changedSurface = {
        paths: scopePaths,
        digest: stableHash(scopePaths),
        inspection,
        rows: scopeRows,
        manifest: scopeRows,
        deltaFrom: {
          attemptDigest: baseAttemptDigest,
          workspaceHash: baseWorkspaceHash
        }
      };
      const closureFindings = (baseAttempt.findings || []).filter((finding) =>
        ["blocker", "major"].includes(finding.severity));
      packet.closureFindings = {
        baseAttemptDigest,
        ids: closureFindings.map((finding) => finding.id).sort(),
        findings: closureFindings
      };
      function applyDeltaContractProjection() {
      const changedContractNames = new Set(scopeRows
        .filter((row) => row.kind === "contract-artifact")
        .map((row) => row.relativePath));
      function artifactName(name) { return name; }
      function artifactRelativePath(_name, artifact) {
        return artifact?.relativePath || null;
      }
      function selectedDeltaArtifacts(artifacts, pathFor) {
        return Object.fromEntries(Object.entries(artifacts).filter(([name, artifact]) =>
          [...changedContractNames].some((path) => path === pathFor(name, artifact) ||
            path.startsWith(`${pathFor(name, artifact)}/`))));
      }
      function artifactCollection(value) {
        return value && typeof value === "object" ? value : {};
      }
      packet.contractArtifacts = selectedDeltaArtifacts(
        artifactCollection(request.packet?.contractArtifacts), artifactName);
      packet.decisions = selectedDeltaArtifacts(
        artifactCollection(request.packet?.decisions), artifactRelativePath);
      packet.references = selectedDeltaArtifacts(
        artifactCollection(request.packet?.references), artifactRelativePath);
      function applyDeltaGroundingAndClaims() {
      packet.grounding = changedContractNames.has("grounding.yaml")
        ? request.packet.grounding : null;
      if (!changedContractNames.has("evidence.yaml")) packet.claims = {
        reuseFromAttempt: baseAttemptDigest,
        digest: stableHash(request.packet?.claims || [])
      };
      }
      applyDeltaGroundingAndClaims();
      }
      applyDeltaContractProjection();
    }
    }
    applyDeltaPacket();
    if (reviewerType === "ai") {
      // Diff-scoped by default: changed hunks plus the agreement, bound by
      // the packet digest. Low risk before any delivered AI round is diff-only.
      packet.reviewDepth = reviewDepthForTier(routing.tier, deliveredAi.length);
      if (reviewDiffContext) {
        packet.reviewDiff = reviewDiffValue(reviewDiffContext, scopeRows,
          packet.changedSurface?.inspection || []);
        packet.agreement = reviewAgreementValue(reviewDiffContext, packet);
        // One checklist item per agreement scenario (N8), bound by the packet
        // digest. A delta round reviews only its correction scope.
        if (scopeMode === "full") {
          const checklist = reviewScenarioChecklist({
            ...reviewDiffContext, packetDir: packet.contractWorkspacePath });
          if (checklist.items.length) packet.scenarioChecklist = checklist;
        }
      }
    }
    delete packet.packetDigest;
    packet.packetDigest = canonicalPacketDigest(packet);
    return packet;
    }
    const packet = dispatchPacket();
    const attempt = dispatchReviewAttempt(id, {
      requestId,
      workspaceHash: request.workspaceHash,
      reviewerType,
      reviewerIdentity,
      reviewerProviderFamily,
      reviewerModelFamily,
      reviewerModelId,
      reviewerSessionId,
      sessionDeferred,
      scope: {
        mode: scopeMode,
        baseAttemptDigest,
        paths: scopePaths,
        digest: scopeDigest
      },
      packetDigest: packet.packetDigest,
      maxAiAttempts,
      maxInfrastructureRetries
    });
    const updated = {
      ...request,
      status: "dispatched",
      dispatchedAt: now(),
      dispatch: {
        attemptDigest: attempt.digest,
        attempt: attempt.attempt,
        reviewer: {
          type: reviewerType,
          identity: reviewerIdentity,
          providerFamily: reviewerProviderFamily,
          modelFamily: reviewerModelFamily,
          modelId: reviewerModelId,
          sessionId: reviewerSessionId
        },
        scope: attempt.scope
      },
      packet,
      packetDigest: packet.packetDigest
    };
    authorityStore.replace(entry, updated);
    console.log(JSON.stringify(updated, null, 2));
    return updated;
  }

  function dispatchAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => dispatchAuthorityUnlocked(id, flags));
  }

  const abortAuthorityUnlocked = abortAuthorityOperation.bind(null, {
    authorityStore, reviewAttemptByDigest, reviewHistoryState, loadRuntime,
    completeReviewAttempt, now, fail, output: console
  });

  function abortAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => abortAuthorityUnlocked(id, flags));
  }

  const sessionTelemetryProvenance = sessionTelemetryProvenanceOperation.bind(
    null, { root, readFile: readFileSync });

  function mainSessionProvenance(id, flags, subject = {}) {
    const environment = mainSessionEnvironment(process.env);
    const boundSession = bindMainSession({ fail }, flags, environment);
    const telemetry = sessionTelemetryProvenance(id, boundSession);
    return mainSessionProvenanceValue(flags, subject, process.env, {
      environment, boundSession
    }, telemetry);
  }

  function mainSessionHandback(id, requestId, configuredIdentity,
    infrastructureError, mainSession, mainDispatched, subject) {
    const template = responseTemplate(mainDispatched);
    template.evidence["subject-actor"] = subject.identity;
    if (subject.sessionId) {
      template.evidence["subject-session"] = subject.sessionId;
      template.evidence["subject-provider-family"] = subject.providerFamily;
      template.evidence["subject-model-family"] = subject.modelFamily;
      template.evidence["subject-model"] = subject.modelId;
    } else {
      delete template.evidence["subject-session"];
      delete template.evidence["subject-provider-family"];
      delete template.evidence["subject-model-family"];
      delete template.evidence["subject-model"];
    }
    return {
      status: "needs-main-session-review",
      changeId: id,
      requestId,
      failedReviewer: configuredIdentity,
      infrastructureError,
      reviewer: mainSession,
      packet: mainDispatched.packet,
      responseTemplate: template,
      next: {
        record: `claude-foundation authority record ${id} --request ${requestId} --response <response.json>`
      }
    };
  }

  function configuredReviewerRoute(settings, request, explicitReviewer = null,
    automaticReviewer = null) {
    if (explicitReviewer) return explicitReviewer;
    if (automaticReviewer) return automaticReviewer;
    const threshold = Number(settings.infraFailureThreshold || 1);
    const fallbacks = Array.isArray(settings.fallbackReviewers)
      ? settings.fallbackReviewers
      : settings.fallbackReviewer ? [settings.fallbackReviewer] : [];
    const configured = [settings.defaultReviewer,
      ...fallbacks.filter((name) => name !== "main-session")].filter(Boolean);
    const attempts = request.fallbackAttempts || [];
    for (const reviewer of configured) {
      if (!reviewerInstalled(reviewer)) continue;
      const failures = attempts.filter((attempt) =>
        attempt.reviewer === reviewer && !attempt.bindingRecoveredAt).length;
      if (failures < threshold) return reviewer;
    }
    return fallbacks.includes("main-session") ? "main-session" : null;
  }

  // Configured reviewers whose CLI is absent on this host. They are skipped by
  // routing, so without a recorded failure the main-session fallback would be
  // unreachable on a host that has no reviewer CLI at all.
  function uninstalledConfiguredReviewers(settings) {
    const fallbacks = Array.isArray(settings.fallbackReviewers)
      ? settings.fallbackReviewers
      : settings.fallbackReviewer ? [settings.fallbackReviewer] : [];
    return [settings.defaultReviewer,
      ...fallbacks.filter((name) => name !== "main-session")]
      .filter((name) => name && !reviewerInstalled(name));
  }

  function recoverReviewBindingsUnlocked(id, requestId = null) {
    let recovered = false;
    for (const entry of authorityStore.list(id)) {
      const request = entry.value;
      if (requestId && request.requestId !== requestId) continue;
      if (request.type !== "review" || request.status !== "infrastructure-exhausted" ||
          !["packet", "result"].includes(request.bindingFailure) ||
          request.workspaceHash !== authorityWorkspaceHash(id, request.provider)) continue;
      const failure = request.fallbackAttempts?.at(-1);
      if (!failure?.reportReference) continue;
      const failedAttempt = reviewAttemptByDigest(id, failure.attemptDigest);
      if (canonicalPacketDigest(request.packet) !== request.packetDigest ||
          failedAttempt?.packetDigest !== request.packetDigest ||
          failedAttempt.status !== "completed" || failedAttempt.resultStatus !== "error") continue;
      const report = readJson(resolve(root, failure.reportReference), null);
      if (report?.status !== "error" || report.changeId !== id) continue;
      const packet = structuredClone(request.packet);
      if (!Array.isArray(packet?.reviewScope?.paths)) continue;
      // Restore location metadata lost by old delta projection, never scope.
      const inspection = packet.changedSurface?.inspection;
      if (Array.isArray(inspection) && !inspection.some((row) => row.repositoryId === "root")) {
        const control = reviewPacketValue(id).changedSurface?.inspection
          ?.find((row) => row.repositoryId === "root");
        if (control) inspection.push({ ...control, paths: [], pathCount: 0, truncated: false });
      }
      if (reviewPacketIssues(packet).length || request.bindingFailure === "result" &&
          (!validReview({ ...report, status: "pass" }) || reviewFindingIssues(report, packet).length)) continue;
      if (!reviewerStatus(failure.reviewer).ok) continue;
      const at = now();
      delete packet.packetDigest;
      packet.packetDigest = canonicalPacketDigest(packet);
      const { bindingFailure: _bindingFailure, ...rest } = request;
      authorityStore.replace(entry, {
        ...rest, status: "requested", packet, packetDigest: packet.packetDigest,
        bindingRecoveredAt: at,
        fallbackAttempts: request.fallbackAttempts.map((row) =>
          row === failure ? { ...row, bindingRecoveredAt: at } : row)
      });
      // The immutable attempt and its infrastructure budget remain consumed.
      // Only the repaired binding's reviewer-routing failure is released.
      recovered = true;
    }
    return recovered;
  }

  function recoverReviewBindings(id) {
    return withAuthorityLock(id, () => recoverReviewBindingsUnlocked(id));
  }

  // Current concrete `authority run` command for a stored request, from the
  // request's recorded subject and the calling host's environment.
  function nextRunCommand(id, requestId) {
    const request = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId)?.value || { requestId };
    const run = authorityRunCommand(id, { ...request, requestId });
    return { command: run.command,
      ...(run.placeholders.length ? { placeholders: run.placeholders } : {}),
      ...(run.unresolved.length ? { unresolved: run.unresolved } : {}) };
  }

  function failWithNext(message, next) {
    const { command, placeholders = [] } = typeof next === "string" ? { command: next } : next;
    fail(`${message}. Next: ${command}${placeholders.length
      ? ` (supply ${placeholders.map((name) => `<${name}>`).join(", ")})` : ""}`);
  }

  function authorityRunSubject(flags, id) {
    const requestId = String(flags.request || "");
    if (!requestId) fail("authority run requires --request <id>");
    const subjectActor = String(flags["subject-actor"] || "").trim();
    if (!subjectActor)
      failWithNext("authority run requires --subject-actor", nextRunCommand(id, requestId));
    const subjectSession = String(flags["subject-session"] || "").trim() || null;
    const subjectProvider = String(flags["subject-provider-family"] || "").trim().toLowerCase() || null;
    const subjectFamily = String(flags["subject-model-family"] || "").trim().toLowerCase() || null;
    const subjectModel = String(flags["subject-model"] || "").trim() || null;
    const aiSubject = [subjectSession, subjectProvider, subjectFamily, subjectModel]
      .some(Boolean);
    if (aiSubject && [subjectSession, subjectProvider, subjectFamily, subjectModel]
      .some((value) => !value))
      failWithNext("AI implementation provenance requires subject session, provider family, model family, and model",
        nextRunCommand(id, requestId));
    return { requestId, subjectActor, subjectSession, subjectProvider,
      subjectFamily, subjectModel, aiSubject };
  }

  function authorityReviewerConfiguration(reviewerName, request, modelTier = null) {
    if (reviewerName !== "main-session") return reviewerConfig(reviewerName, modelTier);
    return {
      identity: request.fallbackAttempts?.at(-1)?.reviewer || "configured-reviewer",
      providerFamily: "",
      modelFamily: ""
    };
  }

  function authorityReviewerSeparationIssue(reviewerName, configured, reviewSettings, subject) {
    const configuredProvider = String(configured.providerFamily).toLowerCase();
    const configuredFamily = String(configured.modelFamily).toLowerCase();
    const sameFamily = subject.aiSubject && subject.subjectProvider === configuredProvider &&
      subject.subjectFamily === configuredFamily;
    if (sameFamily && reviewSettings.diversity !== "single-model")
      return `configured reviewer '${reviewerName}' shares the implementation provider/model family; choose a diverse configured reviewer or commit review.diversity='single-model' before Build`;
    if (subject.aiSubject && reviewSettings.independence !== "self" &&
        subject.subjectActor.toLowerCase() === configured.identity.toLowerCase())
      return `configured reviewer '${reviewerName}' shares the implementation identity; use a distinct reviewer identity/session or commit review.independence='self' before Build`;
    return null;
  }

  function assertAuthorityReviewerSeparation(reviewerName, configured, reviewSettings, subject) {
    const issue = authorityReviewerSeparationIssue(reviewerName, configured, reviewSettings, subject);
    if (issue) fail(issue);
  }

  // N8 (3a): a fast-tier round whose scenario coverage is unparseable or has
  // an unsure scenario is re-run once on the configured model with the same
  // dispatched packet. It is not a new dispatch or AI wave. A missing scenario
  // is already an actionable major finding, so it goes straight to repair.
  // Returns the configured reviewer to escalate to, or null.
  function scenarioEscalationReviewer(reviewerName, configured, requestValue,
    reviewSettings, subject, packet, report) {
    if (!["fast", "standard"].includes(configured.modelTier) || reviewerName === "main-session" ||
        report?.status === "error" || !packet?.scenarioChecklist?.items?.length) return null;
    const coverage = report.scenarioCoverage;
    if (coverage && (coverage.missing.length > 0 || coverage.unsure.length === 0)) return null;
    const escalated = authorityReviewerConfiguration(reviewerName, requestValue, "configured");
    if (!escalated || ["fast", "standard"].includes(escalated.modelTier) ||
        escalated.modelId === configured.modelId)
      return null;
    if (authorityReviewerSeparationIssue(reviewerName, escalated, reviewSettings, subject))
      return null;
    return escalated;
  }

  function authorityRunReviewer(id, flags, subject) {
    const { requestId } = subject;
    const reviewSettings = foundationPolicy().review || {};
    const requestEntry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    if (!requestEntry) fail(`unknown authority request '${requestId}'`);
    if (requestEntry.value.status === "infrastructure-exhausted" &&
        recoverReviewBindingsUnlocked(id, requestId))
      requestEntry.value = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId).value;
    if (requestEntry.value.status === "infrastructure-exhausted")
      failWithNext("configured reviewer infrastructure retries are exhausted for this request",
        authorityStatusCommand(id, requestId));
    const reviewerName = configuredReviewerRoute(reviewSettings, requestEntry.value,
      String(flags.reviewer || "").trim() || null,
      String(flags["automatic-reviewer"] || "").trim() || null);
    const explicitRoute = String(flags.reviewer || "").trim() ||
      String(flags["automatic-reviewer"] || "").trim();
    const uninstalled = explicitRoute ? [] : uninstalledConfiguredReviewers(reviewSettings);
    if (!reviewerName) {
      if (uninstalled.length)
        fail(`reviewer CLI not installed: ${uninstalled.join(", ")}, and no main-session fallback is configured. Install the reviewer CLI (see DEVELOPER-SETUP.md step 6), or set foundation.json review to {"independence":"self","fallbackReviewers":["main-session"]} to let the calling session review`);
      failWithNext("configured reviewer infrastructure retries are exhausted; configure review.fallbackReviewers or record a verdict",
        authorityStatusCommand(id, requestId));
    }
    if (reviewerName === "main-session" && !requestEntry.value.mainSessionFallback &&
        uninstalled.length) {
      // Record the missing CLI as the configured reviewer's infrastructure
      // failure so the existing main-session fallback is reachable. Nothing
      // is spawned; independence rules apply to the main-session reviewer.
      const missingName = uninstalled[0];
      const configured = authorityReviewerConfiguration(missingName, requestEntry.value);
      return { reviewSettings, requestEntry, reviewerName: missingName, configured,
        notInstalled: true };
    }
    if (reviewerName === "main-session" && !requestEntry.value.mainSessionFallback)
      failWithNext("main-session fallback was selected without a recorded configured reviewer failure; omit --reviewer and let routing choose",
        nextRunCommand(id, requestId));
    // The first low or medium round runs on its tier's cheaper model class
    // (reviewModelClass); high, later rounds, and pinned triggers keep the
    // configured model.
    const routing = reviewPolicy(id);
    const runtimeState = loadRuntime(id);
    const modelTier = reviewModelClass({
      tier: routing.tier, deliveredAiCount: deliveredAiAttempts(id).length,
      triggers: routing.triggers,
      declaredReview: Boolean(runtimeState.reviewRequired) && !runtimeState.reviewKeywordOnly,
      settings: reviewSettings
    });
    let configured = authorityReviewerConfiguration(
      reviewerName, requestEntry.value, modelTier);
    // A cheaper standard-class model that would share the implementation's
    // provider/model family under a diversity requirement never blocks the
    // review: the configured model runs instead.
    if (configured.modelTier === "standard" && authorityReviewerSeparationIssue(
      reviewerName, configured, reviewSettings, subject))
      configured = authorityReviewerConfiguration(
        reviewerName, requestEntry.value, "configured");
    assertAuthorityReviewerSeparation(reviewerName, configured, reviewSettings, subject);
    return { reviewSettings, requestEntry, reviewerName, configured };
  }

  // The reviewer call is the one yielded step, so `authority run` (sync) and
  // the concurrent Prove review (async) share every guard and record rule.
  function runAuthorityReviewerUnlocked(id, flags = {}) {
    const steps = authorityReviewerSteps(id, flags);
    let step = steps.next();
    while (!step.done) step = steps.next(runConfiguredReview(step.value));
    return step.value;
  }

  async function runAuthorityReviewerUnlockedAsync(id, flags = {}) {
    const steps = authorityReviewerSteps(id, flags);
    let step = steps.next();
    while (!step.done) step = steps.next(await (runConfiguredReviewAsync
      ? runConfiguredReviewAsync(step.value) : runConfiguredReview(step.value)));
    return step.value;
  }

  function* authorityReviewerSteps(id, flags = {}) {
    const subject = authorityRunSubject(flags, id);
    const { requestId, subjectActor, subjectSession, subjectProvider,
      subjectFamily, subjectModel, aiSubject } = subject;
    const reviewer = authorityRunReviewer(id, flags, subject);
    const { reviewSettings, reviewerName, configured } = reviewer;
    let { requestEntry } = reviewer;
    function resumeMainSessionFallback() {
      if (!requestEntry.value.mainSessionFallback)
        return { handled: false, value: null };
      const fallback = requestEntry.value.mainSessionFallback;
      if (fallback.status !== "provenance-unavailable")
        fail(`configured reviewer already failed; complete the reserved main-session fallback with authority status/record instead of rerunning authority run`);
      const storedSubject = fallback.subject || {};
      const mainSession = mainSessionProvenance(id, flags, storedSubject);
      if (mainSession.missing.length) {
        const blocked = {
          status: "main-session-provenance-unavailable",
          changeId: id,
          requestId,
          failedReviewer: requestEntry.value.fallbackAttempts?.at(-1)?.reviewer ||
            configured.identity,
          infrastructureError: requestEntry.value.fallbackAttempts?.at(-1)?.summary ||
            "configured reviewer infrastructure failed",
          missing: mainSession.missing,
          action: "Expose the calling host session/model provenance and rerun authority run with --main-session-* fields; the failed reviewer will not run again.",
          next: nextRunCommand(id, requestId)
        };
        console.log(JSON.stringify(blocked, null, 2));
        return { handled: true, value: blocked };
      }
      const resumed = dispatchAuthorityUnlocked(id, {
        request: requestId,
        scope: fallback.scope,
        ...(fallback.scope === "delta"
          ? { "base-attempt": fallback.baseAttemptDigest } : {}),
        "reviewer-type": "ai",
        "reviewer-identity": mainSession.identity,
        "reviewer-provider-family": mainSession.providerFamily,
        "reviewer-model-family": mainSession.modelFamily,
        "reviewer-model": mainSession.modelId,
        "reviewer-session": mainSession.sessionId
      });
      const resumedEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      authorityStore.replace(resumedEntry, {
        ...resumedEntry.value,
        mainSessionFallback: {
          ...resumedEntry.value.mainSessionFallback,
          status: "awaiting-response",
          reviewer: {
            identity: mainSession.identity,
            providerFamily: mainSession.providerFamily,
            modelFamily: mainSession.modelFamily,
            modelId: mainSession.modelId,
            sessionId: mainSession.sessionId
          },
          missingProvenance: []
        }
      });
      const handback = mainSessionHandback(id, requestId,
        requestEntry.value.fallbackAttempts?.at(-1)?.reviewer || configured.identity,
        requestEntry.value.fallbackAttempts?.at(-1)?.summary ||
          "configured reviewer infrastructure failed",
        mainSession, resumed, storedSubject);
      console.log(JSON.stringify(handback, null, 2));
      return { handled: true, value: handback };
    }
    const resumedFallback = resumeMainSessionFallback();
    if (resumedFallback.handled) return resumedFallback.value;
    let recoveredReport = null;
    function recoverOrphanedController(entry) {
      if (entry.value.status !== "dispatched") return entry;
      requestEntry = entry;
      const controller = requestEntry.value.configuredController;
      if (!controller && !entry.value.configuredResult)
        fail(`configured review dispatch '${requestId}' is indeterminate; do not rerun it automatically. Abort it with a reason, then request the next bounded route or pause`);
      if (controller && isProcessAlive(Number(controller.pid)))
        fail(`configured review dispatch '${requestId}' is still running in controller PID ${controller.pid}`);
      // An escalated checkpoint binds the configured model that produced it.
      const recoveredEscalation = entry.value.configuredResult?.modelEscalation || null;
      const expectedReviewer = recoveredEscalation
        ? authorityReviewerConfiguration(reviewerName, entry.value, "configured") : configured;
      recoveredReport = recoverReviewResult(root, entry.value, subject, expectedReviewer,
        authorityWorkspaceHash(id, entry.value.provider));
      if (recoveredReport && recoveredEscalation)
        recoveredReport = { ...recoveredReport, modelEscalation: recoveredEscalation,
          finalReviewer: expectedReviewer };
      if (recoveredReport) return entry;
      const attemptDigest = requestEntry.value.dispatch?.attemptDigest;
      const attempt = attemptDigest ? reviewAttemptByDigest(id, attemptDigest) : null;
      if (attempt?.status === "dispatched")
        completeReviewAttempt(id, attemptDigest, {
          reviewerSessionId: "",
          resultStatus: "error",
          findings: [],
          verifiedFindingIds: []
        });
      const currentEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      const {
        dispatch: _orphanedDispatch,
        configuredController: _orphanedController,
        ...reopenable
      } = currentEntry.value;
      authorityStore.replace(currentEntry, {
        ...reopenable,
        status: "requested",
        orphanedControllers: [
          ...(currentEntry.value.orphanedControllers || []),
          {
            ...controller,
            recoveredAt: now(),
            result: "infrastructure-error"
          }
        ]
      });
      return authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
    }
    requestEntry = recoverOrphanedController(requestEntry);
    const state = loadRuntime(id);
    const history = state.reviewHistory || {
      aiAttempts: 0, totalAttempts: 0, chainHead: null
    };
    // Delivered attempts only: a completion whose resultStatus is "error"
    // never gains a receipt, so counting it here locked the change out of
    // review forever.
    const deliveredAi = deliveredAiAttempts(id, history);
    if (!recoveredReport && unrecordedDeliveredAiResponse(id, history, requestEntry.value.provider))
      fail("a completed AI response has no matching recorded receipt; repair that authority record or pause instead of starting another configured reviewer");
    const scope = recoveredReport ? requestEntry.value.dispatch.scope.mode
      : deliveredAi.length === 0 ? "full" : "delta";
    const workspace = loadRuntime(id).workspace?.path || root;
    const dispatched = dispatchAuthorityUnlocked(id, {
      request: requestId,
      scope,
      ...(scope === "delta" ? { "base-attempt": deliveredAi.at(-1).digest } : {}),
      "reviewer-type": "ai",
      "reviewer-identity": configured.identity,
      "reviewer-provider-family": configured.providerFamily,
      "reviewer-model-family": configured.modelFamily,
      "reviewer-model": configured.modelId,
      "reviewer-session-deferred": true
    });
    const controllerEntry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    authorityStore.replace(controllerEntry, {
      ...controllerEntry.value,
      configuredController: {
        version: 1,
        pid: process.pid,
        reviewer: configured.identity,
        subject,
        startedAt: now()
      }
    });
    const reviewRequest = {
      changeId: id,
      timeoutMs: REVIEW_DISPATCH_TIMEOUT_MS,
      reviewer: reviewerName,
      modelTier: configured.modelTier || null,
      workspace,
      packet: dispatched.packet,
      forbiddenSessionIds: reviewSettings.independence === "self" ? [] : [
        subjectSession,
        ...(scope === "delta" ? [deliveredAi.at(-1)?.reviewerSessionId] : [])
      ].filter(Boolean)
    };
    let report = recoveredReport || (reviewer.notInstalled ? {
      status: "error", summary: `reviewer CLI not installed: ${reviewerName}`,
      findings: [], verifiedFindingIds: [], reportReference: null,
      reviewer: { sessionId: "" }
    } : yield reviewRequest);
    let finalReviewer = recoveredReport?.finalReviewer || configured;
    let modelEscalation = recoveredReport?.modelEscalation || null;
    const escalated = recoveredReport ? null : scenarioEscalationReviewer(reviewerName,
      configured, requestEntry.value, reviewSettings, subject, dispatched.packet, report);
    if (escalated) {
      // Same dispatch, packet, and digest; only the model changes. The fast
      // report stays on disk but is never checkpointed or recorded.
      modelEscalation = {
        escalatedFrom: configured.modelTier,
        reason: report.scenarioCoverage ? "scenario-coverage-gap" : "scenario-coverage-unparseable",
        fastModelId: configured.modelId,
        fastModelFamily: configured.modelFamily,
        fastReportReference: report.reportReference || null,
        modelId: escalated.modelId,
        modelFamily: String(escalated.modelFamily || "").toLowerCase() || null
      };
      finalReviewer = escalated;
      report = yield {
        ...reviewRequest,
        timeoutMs: REVIEW_DISPATCH_TIMEOUT_MS,
        modelTier: "configured",
        escalatedFrom: configured.modelTier
      };
    }
    // The verdict is about the bytes this dispatch carried. Anything that
    // changed them while the reviewer ran (a provider writing tracked files
    // beside a concurrent review, an edit) makes it a verdict on a superseded
    // workspace: it is never recorded or checkpointed. The attempt closes as
    // an error exactly like `authority abort`, the request ends aborted, and
    // the next pass requests a review bound to the current bytes. A recovered
    // checkpoint was already bound to its workspace hash on recovery.
    if (!recoveredReport && report.status !== "error") {
      clearSnapshotCache(id);
      const currentHash = authorityWorkspaceHash(id, requestEntry.value.provider);
      if (currentHash !== dispatched.workspaceHash) {
        completeReviewAttempt(id, dispatched.dispatch.attemptDigest, {
          reviewerSessionId: String(report.reviewer?.sessionId || "").trim(),
          resultStatus: "error", findings: [], verifiedFindingIds: []
        });
        const supersededEntry = authorityStore.list(id)
          .find((row) => row.value.requestId === requestId);
        const aborted = {
          ...supersededEntry.value, status: "aborted", abortedAt: now(),
          abortReason: "workspace changed while the reviewer ran; the verdict judged superseded content"
        };
        authorityStore.replace(supersededEntry, aborted);
        const superseded = {
          status: "review-superseded", changeId: id, requestId,
          reviewedWorkspaceHash: dispatched.workspaceHash, currentWorkspaceHash: currentHash,
          action: "The verdict was not recorded; advance requests a review of the current content."
        };
        console.log(JSON.stringify(superseded, null, 2));
        return superseded;
      }
    }
    const checkpoint = checkpointReviewResult(root, dispatched, subject, report);
    if (checkpoint) {
      const resultEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      authorityStore.replace(resultEntry, {
        ...resultEntry.value,
        configuredResult: modelEscalation ? { ...checkpoint, modelEscalation } : checkpoint
      });
    }
    function handleConfiguredInfrastructureError() {
      if (report.status !== "error") return { handled: false, value: null };
      const failed = completeReviewAttempt(id,
        dispatched.dispatch.attemptDigest, {
          reviewerSessionId: String(report.reviewer?.sessionId || "").trim(),
          resultStatus: "error", findings: [], verifiedFindingIds: []
        });
      const failedEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      const {
        dispatch: _failedDispatch,
        configuredController: _failedController,
        ...retryableRequest
      } = failedEntry.value;
      const failedRequest = {
        ...retryableRequest,
        status: "requested",
        fallbackAttempts: [
          ...(failedEntry.value.fallbackAttempts || []),
          {
            attemptDigest: failed.digest,
            reviewer: configured.identity,
            reportReference: report.reportReference,
            summary: report.summary
          }
        ]
      };
      authorityStore.replace(failedEntry, failedRequest);
      // Validation is deterministic for this packet/result. Changing models
      // cannot repair its binding; retain the error and existing resume route.
      const nextReviewer = report.retryable === false ? null
        : configuredReviewerRoute(reviewSettings, failedRequest);
      if (nextReviewer && nextReviewer !== "main-session") {
        const nextFlags = {
          ...flags,
          reviewer: undefined,
          "automatic-reviewer": nextReviewer
        };
        return { handled: true, retryFlags: nextFlags };
      }
      if (!nextReviewer) {
        authorityStore.replace(failedEntry, {
          ...failedRequest,
          status: "infrastructure-exhausted",
          infrastructureExhaustedAt: now(),
          ...(report.bindingFailure ? { bindingFailure: report.bindingFailure } : {}),
          infrastructureError: report.summary
        });
        const exhausted = {
          status: "configured-reviewer-infrastructure-exhausted",
          changeId: id,
          requestId,
          failedReviewer: configured.identity,
          infrastructureError: report.summary,
          attempts: failedRequest.fallbackAttempts,
          action: report.retryable === false
            ? "Repair the packet or finding bindings through the existing harness recovery; do not repeat the unchanged full review."
            : "Configure review.fallbackReviewers, repair reviewer infrastructure, or pause.",
          next: { command: authorityStatusCommand(id, requestId) }
        };
        console.log(JSON.stringify(exhausted, null, 2));
        return { handled: true, value: exhausted };
      }
      const mainSession = mainSessionProvenance(id, flags, aiSubject ? {
        identity: subjectActor,
        sessionId: subjectSession,
        providerFamily: subjectProvider,
        modelFamily: subjectFamily,
        modelId: subjectModel
      } : {});
      const refreshedEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      authorityStore.replace(refreshedEntry, {
        ...refreshedEntry.value,
        mainSessionFallback: {
          status: mainSession.missing.length
            ? "provenance-unavailable" : "dispatching",
          failedAttemptDigest: failed.digest,
          scope,
          baseAttemptDigest: scope === "delta" ? deliveredAi.at(-1).digest : null,
          subject: {
            identity: subjectActor,
            sessionId: subjectSession,
            providerFamily: subjectProvider,
            modelFamily: subjectFamily,
            modelId: subjectModel
          },
          reviewer: mainSession.missing.length ? null : {
            identity: mainSession.identity,
            providerFamily: mainSession.providerFamily,
            modelFamily: mainSession.modelFamily,
            modelId: mainSession.modelId,
            sessionId: mainSession.sessionId
          },
          missingProvenance: mainSession.missing
        }
      });
      if (mainSession.missing.length) {
        const blocked = {
          status: "main-session-provenance-unavailable",
          changeId: id,
          requestId,
          failedReviewer: configured.identity,
          infrastructureError: report.summary,
          missing: mainSession.missing,
          action: "Expose the calling host session/model provenance and rerun authority run with --main-session-* fields; the failed reviewer will not run again.",
          next: nextRunCommand(id, requestId)
        };
        console.log(JSON.stringify(blocked, null, 2));
        return { handled: true, value: blocked };
      }
      const mainDispatched = dispatchAuthorityUnlocked(id, {
        request: requestId,
        scope,
        ...(scope === "delta" ? {
          "base-attempt": deliveredAi.at(-1).digest
        } : {}),
        "reviewer-type": "ai",
        "reviewer-identity": mainSession.identity,
        "reviewer-provider-family": mainSession.providerFamily,
        "reviewer-model-family": mainSession.modelFamily,
        "reviewer-model": mainSession.modelId,
        "reviewer-session": mainSession.sessionId
      });
      const mainEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      authorityStore.replace(mainEntry, {
        ...mainEntry.value,
        mainSessionFallback: {
          ...mainEntry.value.mainSessionFallback,
          status: "awaiting-response"
        }
      });
      const handback = mainSessionHandback(id, requestId, configured.identity,
        report.summary, mainSession, mainDispatched, {
          identity: subjectActor,
          sessionId: subjectSession,
          providerFamily: subjectProvider,
          modelFamily: subjectFamily,
          modelId: subjectModel
        });
      console.log(JSON.stringify(handback, null, 2));
      return { handled: true, value: handback };
    }
    const infrastructureResult = handleConfiguredInfrastructureError();
    if (infrastructureResult.retryFlags)
      return yield* authorityReviewerSteps(id, infrastructureResult.retryFlags);
    if (infrastructureResult.handled) return infrastructureResult.value;
    function validateConfiguredReviewResult() {
    const reviewerSession = String(report.reviewer?.sessionId || "").trim();
    const infrastructureError = report.status === "error";
    if (!reviewerSession && !infrastructureError)
      fail("configured reviewer did not emit an actual session ID; the review cannot be recorded truthfully");
    const findingIds = report.findings.map((finding) => finding.id);
    if (findingIds.some((findingId) => !findingId) ||
        new Set(findingIds).size !== findingIds.length)
      fail("configured reviewer finding IDs must be non-empty and unique");
    if (scope === "delta" && !infrastructureError) {
      const expectedIds = [...(dispatched.packet.closureFindings?.ids || [])].sort();
      const verifiedIds = [...report.verifiedFindingIds].sort();
      if (JSON.stringify(expectedIds) !== JSON.stringify(verifiedIds))
        fail(`AI delta closure must verify exactly the first-round finding IDs: ${expectedIds.join(", ") || "<none>"}`);
      const scoped = dispatched.dispatch.scope.paths || [];
      const outside = report.findings.filter((finding) => {
        const path = String(finding.path || "").replace(/^\.\//, "");
        return !path || !scoped.some((candidate) =>
          candidate === path || candidate.endsWith(`/${path}`));
      });
      if (outside.length)
        fail(`AI delta reviewer reported findings outside the dispatched correction scope: ${outside.map((finding) => finding.id).join(", ")}`);
    }
    return { reviewerSession, infrastructureError };
    }
    const { reviewerSession, infrastructureError } = validateConfiguredReviewResult();
    const completion = {
        reviewerSessionId: reviewerSession,
        resultStatus: report.status,
        findings: report.findings,
        verifiedFindingIds: report.verifiedFindingIds,
        ...(modelEscalation ? { modelEscalation } : {}),
        ...(report.scenarioCoverage !== undefined
          ? { scenarioCoverage: report.scenarioCoverage } : {}),
        ...(report.specGaps?.length ? { specGaps: report.specGaps } : {})
      };
    const currentAttempt = recoveredReport && reviewAttemptByDigest(id,
      loadRuntime(id).reviewHistory?.chainHead);
    const alreadyCompleted = currentAttempt?.status === "completed";
    if (alreadyCompleted && (currentAttempt.requestId !== requestId ||
        currentAttempt.attempt !== dispatched.dispatch.attempt ||
        currentAttempt.workspaceHash !== dispatched.workspaceHash ||
        currentAttempt.reviewerSessionId !== reviewerSession ||
        currentAttempt.resultStatus !== report.status ||
        stableHash(currentAttempt.findings) !== stableHash(normalizeReviewCompletionFindings(completion)) ||
        stableHash(currentAttempt.verifiedFindingIds) !== stableHash([...report.verifiedFindingIds].sort())))
      fail("saved configured review result does not match its completed attempt");
    const completed = alreadyCompleted ? currentAttempt
      : completeReviewAttempt(id, dispatched.dispatch.attemptDigest, completion);
    const dispatchedEntry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    const {
      configuredController: _completedController,
      ...completedRequest
    } = dispatchedEntry.value;
    const finalizedRequest = {
      ...completedRequest,
      dispatch: {
        ...dispatchedEntry.value.dispatch,
        attemptDigest: completed.digest,
        reviewer: {
          ...dispatchedEntry.value.dispatch.reviewer,
          ...(modelEscalation ? {
            modelFamily: modelEscalation.modelFamily, modelId: modelEscalation.modelId
          } : {}),
          sessionId: reviewerSession || null
        },
        ...(modelEscalation ? { modelEscalation } : {})
      }
    };
    authorityStore.replace(dispatchedEntry, finalizedRequest);
    const responsePath = join(root, ".foundation", "authority", id,
      `${requestId}-configured-review-response.json`);
    writeJson(responsePath, {
      version: Number(protocolVersion),
      requestId,
      changeId: id,
      type: "review",
      workspaceHash: dispatched.workspaceHash,
      status: report.status,
      evidence: {
        observed: report.summary,
        reference: [report.reportReference],
        reviewer: finalReviewer.identity,
        "reviewer-type": "ai",
        "reviewer-provider-family": finalReviewer.providerFamily,
        "reviewer-model-family": finalReviewer.modelFamily,
        "reviewer-model": finalReviewer.modelId,
        "reviewer-session": reviewerSession || null,
        // The model class actually run (fast|standard|configured), so reports
        // compare reviews by class as well as by model ID.
        "reviewer-model-tier": finalReviewer.modelTier || "configured",
        "subject-actor": subjectActor,
        ...(aiSubject ? {
          "subject-session": subjectSession,
          "subject-provider-family": subjectProvider,
          "subject-model-family": subjectFamily,
          "subject-model": subjectModel
        } : {}),
        "unresolved-blockers": report.findings.filter((finding) =>
          ["blocker", "major"].includes(finding.severity)).length,
        "verified-findings": report.verifiedFindingIds.length,
        findings: report.findings,
        verifiedFindingIds: report.verifiedFindingIds,
        ...(dispatched.dispatch.scope.mode === "delta"
          ? { "scope-path": dispatched.dispatch.scope.paths } : {})
      }
    });
    recordAuthorityUnlocked(id, {
      request: requestId, response: responsePath,
      ...(flags.proofRun ? { proofRun: flags.proofRun } : {})
    });
    return report;
  }

  function runAuthorityReviewer(id, flags = {}) {
    return withAuthorityLock(id, () => runAuthorityReviewerUnlocked(id, flags));
  }

  // Foreground and awaited by its caller: the authority lock is held across
  // the reviewer child, exactly like the synchronous route.
  async function runAuthorityReviewerAsync(id, flags = {}) {
    const locks = join(root, ".foundation", "locks");
    const lock = acquireProcessLock(join(locks, `authority-${id}.lock`), { now });
    if (!lock.acquired)
      fail(`authority mutation for '${id}' is already in progress; retry after it completes`);
    try { return await runAuthorityReviewerUnlockedAsync(id, flags); }
    finally { lock.release(); }
  }

  function authorityStatusValue(id, requestId = null) {
    loadRuntime(id);
    const workspaceHash = relevantHash(id);
    // Scoped requests carry their own hash; status compares against the
    // composite for unscoped ones only.
    const result = authorityStore.status(id, workspaceHash, requestId,
      (request) => authorityWorkspaceHash(id, request.provider));
    if (!result.found) fail(`unknown authority request '${requestId}'`);
    const waived = new Set(currentWaivers(loadRuntime(id), workspaceHash).map((row) => row.capability));
    return { ...result.value, requests: result.value.requests.map((request) =>
      waived.has(request.type) ? { ...request, status: "user-waived", originalStatus: request.status } : request) };
  }

  // The response shape is a contract. Without a way to emit it, a responder
  // discovers it one rejection at a time while the person who gave the verdict
  // waits. The identity fields are prefilled because those are exactly the
  // ones `validateResponse` matches against the request.
  const responseTemplate = authorityResponseTemplate.bind(null, {
    protocolVersion, expandList, listCount
  });

  function showAuthorityStatus(id, flags = {}) {
    const value = authorityStatusValue(id, flags.request || null);
    if (!flags.template) {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    const open = value.requests.filter((request) => authorityStore.isOpen(request.status));
    if (!open.length)
      fail(`no open authority request for '${id}'; nothing to respond to`);
    console.log(JSON.stringify(open.length === 1
      ? responseTemplate(open[0]) : open.map(responseTemplate), null, 2));
  }

  function recordAuthorityRequest(id, flags) {
    const requestId = String(flags.request || "");
    const responsePath = flags.response ? resolve(flags.response) : null;
    if (!requestId || !responsePath)
      fail("authority record requires --request <id> --response <file>");
    const entry = authorityStore.list(id).find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const effective = authorityStatusValue(id, requestId).requests[0];
    const request = effective || entry.value;
    if (request.status === "stale" ||
        request.workspaceHash !== authorityWorkspaceHash(id, request.provider)) {
      // A verdict on a superseded workspace can never be recorded, but asking
      // anyone to re-request is harness bookkeeping. Issue the replacement
      // bound to the current workspace now; it spends no review attempt until
      // it is dispatched, and `advance` routes it like any open request.
      const repository = providerConfig(id, request.provider)?.repository || null;
      const fresh = requestAuthorityUnlocked(id, {
        type: request.type, ...(repository ? { repo: repository } : {})
      }, { quiet: true });
      fail(`authority request '${requestId}' judged a superseded workspace, so its response was not recorded; ` +
        `the harness re-requested ${request.type} as '${fresh.requestId}' bound to the current workspace. ` +
        `Resume with 'claude-foundation advance ${id}'.`, 1,
      { owner: "harness", boundary: "stale-authority-request", code: "AUTHORITY_REREQUESTED" });
    }
    if (!authorityStore.isOpen(request.status))
      fail(`authority request '${requestId}' is ${request.status}`);
    const undispatched = request.type === "review" && request.reviewCircuit === "full-delta" &&
      request.status !== "dispatched";
    if (!existsSync(responsePath)) fail(`authority response not found: ${flags.response}`);
    return { requestId, responsePath, entry, request, undispatched };
  }

  function validateDispatchedReviewResponse(request, response, evidenceFlags) {
    if (request.type !== "review" || !request.dispatch) return null;
    const reviewer = request.dispatch.reviewer;
    validateDispatchedReviewerIdentity(reviewer, evidenceFlags);
    const { findings, verifiedFindingIds, dispatchedScope } =
      normalizeDispatchedReviewEvidence(request, evidenceFlags);
    validateReviewFindingClosure(request, response, evidenceFlags, findings,
      verifiedFindingIds, dispatchedScope);
    return { reviewer, findings, verifiedFindingIds };
  }

  function validateDispatchedReviewerIdentity(reviewer, evidenceFlags) {
    const identity = reviewEvidenceText(evidenceFlags["reviewer-identity"] ||
      evidenceFlags.reviewer).trim();
    const comparisons = [
      ["reviewer identity", identity, reviewer.identity],
      ["reviewer type", reviewEvidenceText(evidenceFlags["reviewer-type"]).toLowerCase(), reviewer.type],
      ["reviewer provider family", nullableReviewEvidence(
        evidenceFlags["reviewer-provider-family"], true), reviewer.providerFamily],
      ["reviewer model family", nullableReviewEvidence(
        evidenceFlags["reviewer-model-family"], true), reviewer.modelFamily],
      ["reviewer model", nullableReviewEvidence(evidenceFlags["reviewer-model"]), reviewer.modelId],
      ["reviewer session", nullableReviewEvidence(evidenceFlags["reviewer-session"]), reviewer.sessionId]
    ];
    const mismatch = comparisons.filter(([, actual, expected]) => actual !== expected)
      .map(([label, actual, expected]) => `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    if (mismatch.length)
      fail(`authority response does not match its dispatched reviewer\n  ${mismatch.join("\n  ")}`);
  }

  function reviewEvidenceText(value) {
    return String(value || "");
  }

  function nullableReviewEvidence(value, lowerCase = false) {
    const text = lowerCase ? reviewEvidenceText(value).toLowerCase()
      : reviewEvidenceText(value);
    return text || null;
  }

  function normalizeDispatchedReviewEvidence(request, evidenceFlags) {
    const suppliedScope = [...new Set(evidenceFlags["scope-path"] || [])].sort();
    const dispatchedScope = [...new Set(request.dispatch.scope.paths || [])].sort();
    if (suppliedScope.length && JSON.stringify(suppliedScope) !== JSON.stringify(dispatchedScope))
      fail("authority response scope-path must exactly match the paths in its dispatched delta packet");
    evidenceFlags["scope-path"] = dispatchedScope;
    const findings = Array.isArray(evidenceFlags.findings) ? evidenceFlags.findings : [];
    const verifiedFindingIds = Array.isArray(evidenceFlags.verifiedFindingIds)
      ? evidenceFlags.verifiedFindingIds : [];
    return { findings, verifiedFindingIds, dispatchedScope };
  }

  function validateReviewFindingClosure(request, response, evidenceFlags, findings,
    verifiedFindingIds, dispatchedScope) {
    const unresolved = findings.filter((finding) =>
      ["blocker", "major"].includes(String(finding?.severity || "").toLowerCase()));
    if (Number(evidenceFlags["unresolved-blockers"] || 0) !== unresolved.length)
      fail("review unresolved-blockers must equal the blocker/major finding rows");
    if (!request.packet?.closureFindings) return;
    if (response.status === "error") return;
    const expectedIds = [...(request.packet.closureFindings.ids || [])].sort();
    const suppliedIds = [...new Set(verifiedFindingIds.map((value) =>
      String(value).trim()).filter(Boolean))].sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify(suppliedIds))
      fail("delta review verifiedFindingIds must exactly close the first-round finding IDs");
    if (request.dispatch.scope.mode !== "delta") return;
    const outside = findings.filter((finding) => {
      const path = String(finding?.path || "").replace(/^\.\//, "");
      return !path || !dispatchedScope.some((candidate) =>
        candidate === path || candidate.endsWith(`/${path}`));
    });
    if (outside.length)
      fail("delta review findings must stay inside the dispatched correction paths");
  }

  function completeDispatchedReview(id, entry, request, reviewResult) {
    if (!reviewResult) return;
    const attempt = reviewAttemptByDigest(id, request.dispatch.attemptDigest);
    if (attempt?.status !== "dispatched") return;
    const completed = completeReviewAttempt(id, attempt.digest, {
      reviewerSessionId: reviewResult.reviewer.sessionId,
      resultStatus: reviewResult.responseStatus,
      findings: reviewResult.findings,
      verifiedFindingIds: reviewResult.verifiedFindingIds
    });
    request.dispatch = {
      ...request.dispatch,
      attemptDigest: completed.digest,
      reviewer: { ...request.dispatch.reviewer, sessionId: completed.reviewerSessionId }
    };
    authorityStore.replace(entry, request);
  }

  function recordAuthorityInfrastructureError(entry, request, requestId,
    responsePath) {
    authorityStore.replace(entry, {
      ...request,
      status: "error",
      infrastructureError: true,
      responseDigest: fileDigest(responsePath),
      receiptDigest: null,
      completedAt: now()
    });
    console.log(`AUTHORITY ${requestId}: infrastructure error\n  receipt: unchanged\n  next: repair the configured reviewer, run doctor --stage prove, then request the bounded retry`);
  }

  function recordAuthorityReceipt(id, entry, request, requestId, response,
    responsePath, evidenceFlags, proofRun = null) {
    const priorPath = receiptPath(id, request.provider);
    const prior = existsSync(priorPath) ? readFileSync(priorPath) : null;
    // A review started beside proof collection names its run explicitly, so
    // the receipt never depends on whether collection is still active.
    const runBinding = proofRun?.proofRunId &&
      proofRun.workspaceHash === request.workspaceHash ? {
        proofRunId: proofRun.proofRunId,
        workspaceSnapshotId: proofRun.workspaceSnapshotId || null
      } : {};
    recordReceipt(id, request.provider, response.status, {
      ...evidenceFlags,
      ...runBinding,
      claims: request.claimIds.join(","), workspaceHash: request.workspaceHash,
      "review-attempt": request.dispatch?.attemptDigest,
      source: evidenceFlags.source || `authority-request:${requestId}`,
      "recorded-by": evidenceFlags["recorded-by"] || `authority-bridge:${requestId}`
    }, { reviewCircuit: request.reviewCircuit || "legacy" });
    const validity = receiptValidity(id, request.provider, request.workspaceHash);
    if (response.status === "pass" && validity.validity !== "valid") {
      if (prior) writeFileSync(priorPath, prior); else if (existsSync(priorPath)) rmSync(priorPath);
      fail(`authority response produced invalid evidence: ${validity.validity}`);
    }
    const receiptDigest = fileDigest(priorPath);
    authorityStore.complete(entry, request, response, fileDigest(responsePath), receiptDigest);
    console.log(`AUTHORITY ${requestId}: ${response.status}\n  receipt: ${relative(root, priorPath)}`);
  }

  function recordAuthorityUnlocked(id, flags = {}) {
    const { requestId, responsePath, entry, request, undispatched } = recordAuthorityRequest(id, flags);
    const response = readJson(responsePath);
    // Every problem known before validation, at once, instead of one per run.
    const preflight = authorityResponsePreflightIssues({
      request, response, undispatched,
      // The receipt validator's bases: the root and the provider's workspace.
      referenceExists: (reference) => [root, providerWorkspace(id, request.provider)]
        .some((base) => base && existsSync(resolve(base, reference)))
    });
    if (preflight.length)
      fail(`authority response for '${requestId}' cannot be recorded:\n  - ${preflight.join("\n  - ")}`);
    const validated = authorityStore.validateResponse(response, request, id);
    if (!validated.valid) fail(validated.reason);
    const evidenceFlags = validated.evidence;
    const reviewResult = validateDispatchedReviewResponse(request, response,
      evidenceFlags);
    completeDispatchedReview(id, entry, request, reviewResult && {
      ...reviewResult, responseStatus: response.status
    });
    // A configured reviewer/tool failure is infrastructure telemetry, not a
    // delivered review verdict. Persist the completed error attempt and close
    // this request, but do not overwrite an earlier full/delta receipt or
    // manufacture a baseline receipt from an error. The bounded infrastructure
    // retry therefore starts full when no delivered baseline exists and keeps
    // a prior delivered baseline when a closure runner failed.
    if (request.type === "review" && response.status === "error") {
      recordAuthorityInfrastructureError(entry, request, requestId, responsePath);
      return;
    }
    recordAuthorityReceipt(id, entry, request, requestId, response, responsePath,
      evidenceFlags, flags.proofRun || null);
  }

  function recordAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => recordAuthorityUnlocked(id, flags));
  }

  const recordVerifiedCi = recordVerifiedCiOperation.bind(null, {
    providerConfig,
    resolvePath: resolve,
    pathExists: existsSync,
    readJson,
    providerWorkspaceHash,
    providerRepository,
    providerWorkspace,
    gitHead,
    validateSignedCiEnvelope,
    ciEvidenceProtocolVersion,
    recordReceipt,
    providerClaims,
    fail,
    output: console
  });

  // The bounded infrastructure recovery consumed by a failed reviewer run has
  // no automatic escape: the guard's own message routes the operator through a
  // provider repair and doctor. This is that route — it re-runs the reviewer
  // diagnosis in-process and acknowledges the consumed attempts only when the
  // diagnosis passes and the decision reference is fresh.
  const resetInfrastructureAuthorityUnlocked =
    resetInfrastructureAuthorityOperation.bind(null, {
      validate, reviewerStatus, acknowledgeInfrastructureAttempts, fail,
      authorityStore, now, output: console
    });

  const resetInfrastructureAuthority = lockedAuthorityOperation(
    withAuthorityLock, resetInfrastructureAuthorityUnlocked);

  const extendReviewAuthority = lockedAuthorityOperation(withAuthorityLock,
    extendReviewAuthorityOperation.bind(null, {
      validate, authorityStore, reviewPolicy, deliveredAiAttempts,
      effectiveReviewAttemptLimit, grantExtraAiWave, fail, output: console
    }));

  // A moved base whose replay altered the change's diff expires a delivered
  // passing verdict through no fault of the work. This route releases exactly
  // that attempt from the wave budget, on a recorded user decision, so the
  // fresh review the move forces cannot brick the change at the cap. No
  // reviewer diagnosis here — nothing is broken; only the accounting moves.
  function resetBaseMoveAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => {
      validate(id, "active", { quiet: true });
      const decisionRef = String(flags["decision-ref"] || "").trim();
      if (!decisionRef) fail("authority reset-base-move requires --decision-ref <ref>");
      const result = acknowledgeBaseMoveAttempts(id, decisionRef);
      console.log(`AUTHORITY ${id}: base-move review release\n  movement: ${
        result.movementKey}\n  released: ${result.digests.length} attempt(s)\n  decision: ${
        decisionRef}\n  next: request and dispatch the AI review again`);
      return result;
    });
  }

  return {
    authorityProvider,
    authorityPacket,
    requestAuthority,
    dispatchAuthority,
    runAuthorityReviewer,
    runAuthorityReviewerAsync,
    abortAuthority,
    resetInfrastructureAuthority,
    extendReviewAuthority,
    recoverReviewBindings,
    resetBaseMoveAuthority,
    unrecordedDeliveredAiResponse,
    authorityStatusValue,
    showAuthorityStatus,
    recordAuthority,
    recordVerifiedCi
  };
}
