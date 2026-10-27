import { existsSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";

import { emitSignal } from "../core/signals.mjs";

export function matchingRepairClosure(current, details, stableHash) {
  if (current?.reviewerType !== "deterministic") return null;
  if (current.sourceAttemptDigest !== details.sourceAttemptDigest ||
      current.workspaceHash !== details.workspaceHash ||
      current.scope?.digest !== details.scopeDigest) return null;
  return stableHash(current.evidenceBindings || []) ===
    stableHash(details.evidenceBindings || []) ? current : null;
}

export function repairClosureSource(delivered, details, fail) {
  const source = delivered.at(-1);
  if (delivered.length < 2 || !source || source.digest !== details.sourceAttemptDigest ||
      source.resultStatus !== "fail" || source.scope?.mode !== "delta")
    fail("deterministic repair closure requires the failed final AI delta");
  if (source.workspaceHash === details.workspaceHash)
    fail("deterministic repair closure requires a changed workspace after the final finding batch");
  return source;
}

export function repairClosureVerifiedFindingIds(source, details, fail) {
  const verified = [...new Set(details.verifiedFindingIds || [])].sort();
  const expected = source.findings.filter((finding) =>
    ["blocker", "major"].includes(finding.severity)).map((finding) => finding.id).sort();
  if (!expected.length || JSON.stringify(verified) !== JSON.stringify(expected))
    fail("deterministic repair closure must close every blocker/major ID from the final AI delta");
  return verified;
}

export function createRepairClosureAttempt(context, id, history, source,
  details, verifiedFindingIds) {
  const attempt = {
    version: 4,
    changeId: id,
    attempt: Number(history.totalAttempts || 0) + 1,
    reviewerType: "deterministic",
    reviewerIdentity: "foundation-repair-closure",
    reviewerProviderFamily: null,
    reviewerModelFamily: null,
    reviewerModelId: null,
    reviewerSessionId: null,
    requestId: `repair:${source.digest}`,
    workspaceHash: details.workspaceHash,
    scope: {
      mode: "repair-closure",
      baseAttemptDigest: source.digest,
      paths: [...new Set(details.paths || [])].sort(),
      digest: details.scopeDigest
    },
    packetDigest: source.packetDigest || null,
    status: "completed",
    resultStatus: "pass",
    findings: [],
    verifiedFindingIds,
    sourceAttemptDigest: source.digest,
    evidenceBindings: details.evidenceBindings,
    priorChainHead: history.chainHead || null,
    timestamp: context.now(),
    completedAt: context.now()
  };
  attempt.digest = context.stableHash(attempt);
  return attempt;
}

export function recordRepairClosureAttemptOperation(context, id, details) {
  const history = assertReviewDispatchHistory(context, id,
    context.reviewHistoryState(id, context.loadRuntime(id)));
  const state = context.loadRuntime(id);
  const current = context.reviewAttempts(id, history).at(-1);
  const duplicate = matchingRepairClosure(current, details, context.stableHash);
  if (duplicate) return duplicate;
  const source = repairClosureSource(
    context.deliveredAiAttempts(id, history), details, context.fail);
  const verified = repairClosureVerifiedFindingIds(source, details, context.fail);
  if (!Array.isArray(details.evidenceBindings) || !details.evidenceBindings.length)
    context.fail("deterministic repair closure requires current evidence bindings");
  const attempt = createRepairClosureAttempt(
    context, id, history, source, details, verified);
  context.writeJson(join(context.evidenceVault, id, "review-attempts",
    `${String(attempt.attempt).padStart(4, "0")}-${attempt.digest.slice(0, 12)}.json`), attempt);
  state.reviewHistory = {
    ...history,
    totalAttempts: attempt.attempt,
    chainHead: attempt.digest
  };
  context.saveRuntime(state);
  return attempt;
}

export function assertBaseMoveResetAllowed(history, move, reference, fail) {
  if (!move) fail("no sandbox sync base move is recorded for this change");
  if (move.preDiffIdentity && move.preDiffIdentity === move.postDiffIdentity)
    fail("the last base move left the change's diff unchanged; the review receipt rebinds on 'claude-foundation proof run' and no reset is needed");
  if ((history.baseMoveResets || []).some((row) =>
    row.movementKey === move.movementKey))
    fail("this base move already released a review attempt");
  if ((history.baseMoveResets || []).some((row) => row.decisionRef === reference))
    fail("--decision-ref was already used for a base-move reset on this change");
}

export function baseMoveResetRecovery(state, id) {
  const move = state?.lastBaseMove;
  if (!move || !move.movementKey || !move.preDiffIdentity || !move.postDiffIdentity ||
      move.preDiffIdentity === move.postDiffIdentity) return "";
  return " If the passing verdict expired because this recorded sandbox sync changed the diff, " +
    "that is not a quality round: the harness releases that attempt on the next dispatch once no " +
    `review is live, so dispatch the review again (manual route: 'claude-foundation authority reset-base-move ${id} --decision-ref <ref>').`;
}

// The live attempt already records its request, so the refusal names the exact
// abort instead of sending the agent to look it up first.
export function liveReviewAbortCommand(id, attempt) {
  const requestId = String(attempt?.requestId || "").trim();
  return requestId
    ? `claude-foundation authority abort ${id} --request ${requestId} --reason <why>`
    : `find the open request with 'claude-foundation authority status ${id}', then ` +
      `claude-foundation authority abort ${id} --request <requestId> --reason <why>`;
}

export function assertNoLiveBaseMoveReview(attempts, id, fail) {
  const live = attempts.find((attempt) =>
    attempt.reviewerType === "ai" && attempt.status === "dispatched");
  if (live)
    fail("an AI review attempt is still dispatched; complete or abort it before a base-move reset: " +
      liveReviewAbortCommand(id, live));
}

export function baseMoveReleasedAttempt(attempts, move, fail) {
  const moveAt = String(move.at || "");
  const candidates = attempts.filter((attempt) =>
    (attempt.resultStatus === "pass" ||
      attempt.version === 1 && attempt.status === "pass") &&
    String(attempt.timestamp || "") < moveAt);
  const released = candidates.at(-1);
  if (!released)
    fail("no delivered passing AI review attempt predates the recorded base move");
  return released;
}

export function acknowledgeBaseMoveAttemptsOperation(context, id, decisionRef) {
  const reference = String(decisionRef || "").trim();
  if (!reference)
    context.fail("authority reset-base-move requires --decision-ref <host-user-decision>");
  const state = context.loadRuntime(id);
  const history = context.reviewHistoryState(id, state);
  if (history.chainHead && !context.reviewHistoryChainValid(id, history))
    context.fail("authority reset-base-move requires a valid review attempt history");
  const move = state.lastBaseMove;
  assertBaseMoveResetAllowed(history, move, reference, context.fail);
  assertNoLiveBaseMoveReview(context.reviewAttempts(id, history), id, context.fail);
  const attempt = baseMoveReleasedAttempt(
    context.deliveredAiAttempts(id, history), move, context.fail);
  state.reviewHistory = {
    ...history,
    baseMoveAcknowledged: [...new Set([
      ...(history.baseMoveAcknowledged || []), attempt.digest
    ])],
    baseMoveResets: [...(history.baseMoveResets || []), {
      decisionRef: reference,
      movementKey: move.movementKey,
      digests: [attempt.digest],
      at: context.now()
    }]
  };
  context.saveRuntime(state);
  return {
    changeId: id,
    decisionRef: reference,
    movementKey: move.movementKey,
    digests: [attempt.digest]
  };
}

// A corrupt or lowered chain is harness bookkeeping, not a user decision: the
// harness quarantines and rebuilds it (see recoverCorruptReviewHistory) and
// returns the history the dispatch must continue from.
export function assertReviewDispatchHistory(context, id, history) {
  // An empty head has no chain to verify; only records it never recorded
  // (a history lowered to nothing) make it corrupt.
  if (!history.chainHead
    ? !context.reviewChainLowered(id, history)
    : context.reviewHistoryChainValid(id, history)) return history;
  return context.recoverCorruptReviewHistory(id, history);
}

// Every AI route allows at most two delivered waves unless the latest one
// failed (the closure wave). A rebuilt chain whose delivered count cannot be
// determined ends in at least this many inconclusive AI placeholders, which
// exhausts every route through the normal REVIEW_ROUTE_COMPLETE boundary.
export const RECOVERED_DELIVERED_FLOOR = 2;

export function attemptNumberFromName(name) {
  const match = /^(\d+)-/.exec(String(name || ""));
  return match ? Number(match[1]) : 0;
}

// The longest chain that verifies end to end among individually verified
// records: consecutive attempt numbers down to attempt 1 or a migrated base.
// Same-height candidates prefer the recorded head, then a completed verdict
// (it consumes budget; a dispatched sibling does not), then the latest record.
export function verifiedReviewChain(records, preferredHead = null) {
  const byDigest = new Map(records.map((record) => [record.digest, record]));
  const chains = [];
  for (const top of records) {
    const chain = [top];
    const seen = new Set([top.digest]);
    let cursor = top;
    let valid = true;
    while (cursor.priorChainHead) {
      const prior = byDigest.get(cursor.priorChainHead);
      if (!prior || seen.has(prior.digest) || chain.length > 1000 ||
          Number(prior.attempt) !== Number(cursor.attempt) - 1) { valid = false; break; }
      seen.add(prior.digest);
      chain.unshift(prior);
      cursor = prior;
    }
    if (valid && chain.length <= 1000 &&
        (Number(cursor.attempt) === 1 || cursor.migrated === true)) chains.push(chain);
  }
  const rank = (chain) => {
    const head = chain.at(-1);
    return [Number(head.attempt), head.digest === preferredHead ? 1 : 0,
      head.status === "completed" ? 1 : 0,
      String(head.completedAt || head.timestamp || "")];
  };
  chains.sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    for (let index = 0; index < a.length; index += 1)
      if (a[index] !== b[index]) return a[index] < b[index] ? 1 : -1;
    return 0;
  });
  return chains[0] || [];
}

// The conservative lower bound on attempts ever reserved: the runtime count,
// a recorded head, every attempt number any record or file name claims (even
// an unverifiable one), and the highest legacy receipt round. Tampering can
// only raise this bound, never lower it.
// Every writer (dispatch, reserve, repair closure) writes the attempt record
// before it moves the runtime head, so a crash between the two leaves exactly
// one in-flight record at head+1 that links to the recorded head. That record
// is legitimate. Any other record above the recorded head means the head and
// the count were moved back together to an earlier valid record: the chain
// still verifies, but the review budget was reset. A completed v2 verdict is
// never in flight (completion rewrites the head's own attempt number), so it
// is lowering even at head+1. `files` are { name, value } attempt records.
export function reviewChainLowered(files, history, verifies) {
  const head = Number(history.totalAttempts || 0) || 0;
  const above = files.filter((file) => Math.max(attemptNumberFromName(file.name),
    Number.isInteger(file.value?.attempt) ? file.value.attempt : 0) > head);
  if (!above.length) return false;
  if (above.length > 1) return true;
  const [{ name, value }] = above;
  const inFlight = attemptNumberFromName(name) === head + 1 &&
    value?.attempt === head + 1 && verifies(value) &&
    (value.priorChainHead || null) === (history.chainHead || null) &&
    !(value.version === 2 && value.status === "completed");
  return !inFlight;
}

export function evidencedReviewAttemptCount({ history = {}, files = [],
  receiptRounds = [], verifiedTop = 0 }) {
  const claimed = files.flatMap((file) => [
    attemptNumberFromName(file.name),
    Number.isInteger(file.value?.attempt) ? file.value.attempt : 0
  ]);
  return Math.max(0, Number(history.totalAttempts || 0) || 0,
    history.chainHead ? 1 : 0, verifiedTop, ...claimed,
    ...receiptRounds.map((round) => Number(round) || 0));
}

export function reviewDispatchType(details, fail) {
  const reviewerType = String(details.reviewerType || "").toLowerCase();
  if (!["ai", "human"].includes(reviewerType))
    fail("review dispatch requires reviewerType ai|human");
  return reviewerType;
}

export function validateReviewDispatchBudget(context, id, reviewerType,
  history, details, completedAi, infrastructureAi) {
  const maxAiAttempts = Number(details.maxAiAttempts || 2);
  const maxInfrastructureRetries = Number(details.maxInfrastructureRetries ?? 1);
  if (reviewerType !== "ai") return;
  if (completedAi.length >= maxAiAttempts)
    context.blockAiExhausted(id, history, maxAiAttempts);
  if (infrastructureAi.length > maxInfrastructureRetries)
    context.fail(`REVIEW_INFRASTRUCTURE_ERROR: ${maxInfrastructureRetries} automatic reviewer infrastructure retry has already been used. Repair or switch the configured reviewer and resume: the harness resets this itself whenever the reviewer diagnosis passes under a changed reviewer configuration, and once per review wave for the same one. A reviewer configuration fault is the agent's repair; a reviewer that is not logged in or whose credential was rejected is a cause only the user can clear, which advance asks with the exact fix. It is never a product decision.`, 1, { code: "REVIEW_INFRASTRUCTURE_ERROR" });
}

export function reviewDispatchScope(details, reviewerType, aiAttempts,
  completedAi, fail) {
  const scopeMode = String(details.scope?.mode || "");
  if (!["full", "delta"].includes(scopeMode))
    fail("review dispatch scope must be full|delta");
  if (reviewerType === "ai") {
    const expectedMode = completedAi.length === 0 ? "full" : "delta";
    if (scopeMode !== expectedMode)
      fail(`AI review dispatch ${aiAttempts.length + 1} requires --scope ${expectedMode}`);
    const expectedBase = completedAi.at(-1)?.digest || null;
    if (scopeMode === "delta" && details.scope?.baseAttemptDigest !== expectedBase)
      fail(`AI delta review must reference the first AI dispatch with --base-attempt ${expectedBase}`);
    if (scopeMode === "full" && details.scope?.baseAttemptDigest)
      fail("the first AI full review must not declare --base-attempt");
  }
  return scopeMode;
}

export function reviewDispatchAttemptValue(context, id, details, history,
  reviewerType, scopeMode) {
  const attempt = {
    version: 2, changeId: id,
    attempt: Number(history.totalAttempts || 0) + 1,
    reviewerType,
    reviewerIdentity: String(details.reviewerIdentity || "").trim(),
    reviewerProviderFamily: details.reviewerProviderFamily || null,
    reviewerModelFamily: details.reviewerModelFamily || null,
    reviewerModelId: details.reviewerModelId || null,
    reviewerSessionId: details.reviewerSessionId || null,
    sessionDeferred: details.sessionDeferred === true,
    requestId: String(details.requestId || ""),
    workspaceHash: details.workspaceHash,
    scope: {
      mode: scopeMode,
      baseAttemptDigest: details.scope?.baseAttemptDigest || null,
      paths: [...new Set(details.scope?.paths || [])].sort(),
      digest: details.scope?.digest || null
    },
    packetDigest: details.packetDigest || null,
    status: "dispatched",
    priorChainHead: history.chainHead || null,
    timestamp: context.now()
  };
  if (!attempt.reviewerIdentity || !attempt.requestId || !attempt.workspaceHash)
    context.fail("review dispatch requires reviewer identity, request, and workspace hash");
  attempt.digest = context.stableHash(attempt);
  return attempt;
}

export function reviewHistoryAfterDispatch(history, attempt, reviewerType) {
  return {
    ...history,
    version: 1,
    aiAttempts: Number(history.aiAttempts || 0) + (reviewerType === "ai" ? 1 : 0),
    totalAttempts: attempt.attempt,
    chainHead: attempt.digest
  };
}

export function reviewCompletionIdentity(dispatched, details, fail) {
  const resultStatus = String(details.resultStatus || "");
  const sessionId = String(details.reviewerSessionId || "").trim();
  if (dispatched.reviewerType === "ai" && !sessionId && resultStatus !== "error")
    fail("AI review completion requires the actual reviewer session ID");
  if (!dispatched.sessionDeferred &&
      (dispatched.reviewerSessionId || null) !== (sessionId || null))
    fail("review completion session does not match the dispatched reviewer");
  return { resultStatus, sessionId };
}

const FINDING_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A malformed code is dropped, never rejected; an absent code adds no key so
// uncoded findings keep their prior digest.
function findingCode(value) {
  return typeof value === "string" && value.length <= 64 &&
    FINDING_CODE_PATTERN.test(value) ? { code: value } : {};
}

export function normalizeReviewCompletionFindings(details) {
  return (details.findings || []).map((finding) => ({
    id: String(finding.id || "").trim(),
    severity: String(finding.severity || "").toLowerCase(),
    path: String(finding.path || ""),
    line: finding.line === null || finding.line === undefined
      ? null : Number(finding.line),
    message: String(finding.message || "").trim(),
    claimIds: [...new Set((finding.claimIds || []).map((value) =>
      String(value).trim()).filter(Boolean))].sort(),
    verificationCaseIds: [...new Set((finding.verificationCaseIds || [])
      .map((value) => String(value).trim()).filter(Boolean))].sort(),
    ...findingCode(finding.code)
  }));
}

export function validateReviewCompletionFindings(resultStatus, findings, fail) {
  const findingIds = findings.map((finding) => finding.id);
  if (!["pass", "fail", "inconclusive", "error"].includes(resultStatus) ||
      findingIds.some((idValue) => !idValue) ||
      new Set(findingIds).size !== findingIds.length)
    fail("review completion finding IDs must be non-empty and unique");
  if (findings.some((finding) =>
    !["blocker", "major", "minor"].includes(finding.severity) ||
    !finding.message ||
    (finding.line !== null && (!Number.isInteger(finding.line) || finding.line < 1))))
    fail("review completion findings require valid severity, message, and optional positive line");
  if (resultStatus === "pass" && findings.some((finding) =>
    ["blocker", "major"].includes(finding.severity)))
    fail("a passing review completion cannot carry blocker or major findings");
}

export function validateFinalReviewFindings(resultStatus, findings, priorDelivered, fail) {
  const finalBlocking = resultStatus === "fail" && priorDelivered.length >= 1
    ? findings.filter((finding) => ["blocker", "major"].includes(finding.severity))
    : [];
  if (finalBlocking.some((finding) =>
    !finding.path || finding.claimIds.length === 0 ||
    finding.verificationCaseIds.length === 0))
    fail("a blocker or major finding in the final AI delta must name a path, claimIds, and verificationCaseIds for deterministic repair closure");
  return finalBlocking;
}

export function completedReviewAttemptValue(context, dispatched, details,
  resultStatus, sessionId, findings) {
  const verifiedFindingIds = [...new Set((details.verifiedFindingIds || [])
    .map((value) => String(value).trim()).filter(Boolean))].sort();
  const completed = {
    ...dispatched,
    version: 3,
    status: "completed",
    resultStatus,
    reviewerSessionId: sessionId || null,
    findings,
    verifiedFindingIds,
    completedAt: context.now()
  };
  // A same-packet model escalation (N8) keeps one attempt and one wave; the
  // completed attempt binds the model whose verdict is final.
  const escalation = details.modelEscalation;
  if (escalation && typeof escalation === "object") {
    completed.reviewerModelId = escalation.modelId || completed.reviewerModelId;
    completed.reviewerModelFamily = escalation.modelFamily || completed.reviewerModelFamily;
    completed.modelEscalation = escalation;
  }
  if (details.scenarioCoverage && typeof details.scenarioCoverage === "object")
    completed.scenarioCoverage = details.scenarioCoverage;
  // Advisory only: recorded with the verdict, never part of the gate.
  if (Array.isArray(details.specGaps) && details.specGaps.length)
    completed.specGaps = details.specGaps;
  delete completed.digest;
  completed.digest = context.stableHash(completed);
  return completed;
}

export function completeReviewAttemptOperation(context, id, digest, details) {
  const state = context.loadRuntime(id);
  const history = context.reviewHistoryState(id, state);
  if (history.chainHead !== digest)
    context.fail("review completion must finalize the current dispatched attempt");
  const dispatched = context.reviewAttemptByDigest(id, digest);
  if (!dispatched || dispatched.version !== 2 || dispatched.status !== "dispatched")
    context.fail("review completion requires a valid dispatched attempt");
  const { resultStatus, sessionId } = reviewCompletionIdentity(
    dispatched, details, context.fail);
  const findings = normalizeReviewCompletionFindings(details);
  validateReviewCompletionFindings(resultStatus, findings, context.fail);
  const priorDelivered = context.deliveredAiAttempts(id, history);
  validateFinalReviewFindings(resultStatus, findings, priorDelivered, context.fail);
  const completed = completedReviewAttemptValue(context,
    dispatched, details, resultStatus, sessionId, findings);
  context.writeJson(join(context.evidenceVault, id, "review-attempts",
    `${String(completed.attempt).padStart(4, "0")}-${completed.digest.slice(0, 12)}.json`), completed);
  state.reviewHistory = { ...history, chainHead: completed.digest };
  context.saveRuntime(state);
  return completed;
}

export function reviewHistoryAttemptValid(attempt, id, expectedAttempt) {
  return Boolean(attempt) &&
    Number(attempt.attempt) === expectedAttempt &&
    attempt.changeId === id;
}

export function reviewHistoryChainValidOperation(context, id, history) {
  if (context.reviewChainLowered?.(id, history)) return false;
  let digest = history.chainHead || null;
  let expectedAttempt = Number(history.totalAttempts || 0);
  let base = null;
  const seen = new Set();
  while (digest) {
    if (seen.has(digest) || seen.size > 1000) return false;
    seen.add(digest);
    const attempt = context.reviewAttemptByDigest(id, digest);
    if (!reviewHistoryAttemptValid(attempt, id, expectedAttempt)) return false;
    base = attempt;
    digest = attempt.priorChainHead || null;
    expectedAttempt -= 1;
  }
  // Migrated histories intentionally have no records before their synthetic
  // base. A real attempt may subsequently sit above that migrated base.
  return expectedAttempt === 0 || Boolean(base?.migrated);
}

export function createReviewAttemptStore({
  receiptsRoot,
  evidenceVault,
  readJson,
  writeJson,
  loadRuntime,
  saveRuntime,
  stableHash,
  reviewReceiptBinding,
  now,
  fail
}) {
  function legacyReviewReceipts(id) {
    const receiptDir = join(receiptsRoot, id);
    if (!existsSync(receiptDir)) return [];
    return readdirSync(receiptDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") &&
        entry.name !== "proof.json")
      .map((entry) => readJson(join(receiptDir, entry.name), {}))
      .filter((receipt) => receipt.review);
  }

  function migratedReviewAttempt(id, latest, round) {
    if (!latest) return null;
    const attempt = {
      version: 1, changeId: id, attempt: round || 1,
      reviewerType: latest.review?.reviewer?.type || "unknown",
      workspaceHash: latest.workspaceHash || null, status: latest.status || null,
      reviewBinding: reviewReceiptBinding(latest),
      priorChainHead: null, migrated: true,
      migratedFromReceiptDigest: stableHash(latest), timestamp: now()
    };
    attempt.digest = stableHash(attempt);
    writeJson(join(evidenceVault, id, "review-attempts",
      `${String(round || 1).padStart(4, "0")}-${attempt.digest.slice(0, 12)}.json`), attempt);
    return attempt;
  }

  function reviewHistoryState(id, state = loadRuntime(id)) {
    const candidates = legacyReviewReceipts(id);
    if (state.reviewHistory?.version === 1 &&
        (Number(state.reviewHistory.totalAttempts || 0) > 0 || candidates.length === 0))
      return state.reviewHistory;
    const latest = candidates.sort((a, b) => Number(b.review?.round || 0) - Number(a.review?.round || 0))[0];
    const round = Number(latest?.review?.round || 0);
    // A legacy receipt only preserves the latest reviewer, not the identities
    // of earlier rounds. Treat every prior round as potentially AI so migration
    // cannot manufacture extra AI retries when the latest receipt is human.
    const aiAttempts = Math.min(round, 2);
    const migratedAttempt = migratedReviewAttempt(id, latest, round);
    state.reviewHistory = {
      version: 1, aiAttempts, totalAttempts: round,
      chainHead: migratedAttempt?.digest || null,
      migratedFromReceiptDigest: latest ? stableHash(latest) : null
    };
    saveRuntime(state);
    return state.reviewHistory;
  }

  function reviewAttemptByDigest(id, digest) {
    const dir = join(evidenceVault, id, "review-attempts");
    if (!digest || !existsSync(dir)) return null;
    const name = readdirSync(dir).find((entry) => entry.includes(String(digest).slice(0, 12)));
    if (!name) return null;
    const attempt = readJson(join(dir, name), {});
    const claimed = attempt.digest;
    const canonical = { ...attempt };
    delete canonical.digest;
    return claimed === digest && stableHash(canonical) === claimed ? attempt : null;
  }

  function reviewAttemptFiles(id) {
    const dir = join(evidenceVault, id, "review-attempts");
    return existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => ({ name: entry.name, value: readJson(join(dir, entry.name), {}) }))
      : [];
  }

  const isReviewChainLowered = (id, history) => reviewChainLowered(
    reviewAttemptFiles(id), history, (value) => attemptRecordVerifies(id, value));

  const reviewHistoryChainValid = reviewHistoryChainValidOperation.bind(null, {
    reviewAttemptByDigest, reviewChainLowered: isReviewChainLowered
  });

  function attemptRecordVerifies(id, value) {
    if (!value || typeof value !== "object" || value.changeId !== id ||
        !Number.isInteger(value.attempt) || value.attempt < 1 ||
        typeof value.digest !== "string" || !value.digest) return false;
    const canonical = { ...value };
    delete canonical.digest;
    return stableHash(canonical) === value.digest;
  }

  const attemptFileName = (record) =>
    `${String(record.attempt).padStart(4, "0")}-${record.digest.slice(0, 12)}.json`;

  function quarantinePath(dir) {
    const stamp = String(now()).replace(/[^0-9A-Za-z]/g, "-");
    let candidate = `${dir}.corrupt-${stamp}`;
    for (let index = 2; existsSync(candidate); index += 1)
      candidate = `${dir}.corrupt-${stamp}-${index}`;
    return candidate;
  }

  // The attempt chain is harness bookkeeping, so a corrupt chain is repaired
  // by the harness rather than handed to the user. The chain exists to stop a
  // review budget reset and a stale or forged verdict from being replayed, so
  // the repair is fail-closed on both:
  // - the corrupt records move aside as `review-attempts.corrupt-<stamp>`
  //   (never deleted) with a recovery manifest beside them;
  // - the rebuilt count never falls below any attempt the runtime history,
  //   a record, a file name, or a legacy receipt evidences;
  // - only a chain that verifies end to end and covers every evidenced
  //   attempt is restored, verdicts included; otherwise the unverifiable
  //   attempts become inconclusive AI placeholders (at least
  //   RECOVERED_DELIVERED_FLOOR), so no verdict is reused and the budget is
  //   consumed through the normal REVIEW_ROUTE_COMPLETE boundary.
  // A lowered chain (records above the recorded head beyond one in-flight
  // dispatch; see reviewChainLowered) takes the same route: its records
  // evidence the higher count, and the lowered head is not the top of the
  // longest verified chain, so its budget is consumed rather than reset.
  function recoverCorruptReviewHistory(id, history) {
    const current = reviewHistoryState(id, loadRuntime(id));
    if (reviewHistoryChainValid(id, current) ||
        !current.chainHead && !isReviewChainLowered(id, current)) return current;
    const dir = join(evidenceVault, id, "review-attempts");
    const files = reviewAttemptFiles(id);
    const verified = [...new Map(files
      .filter((file) => attemptRecordVerifies(id, file.value))
      .map((file) => [file.value.digest, file.value])).values()];
    const preferredHead = current.chainHead || history.chainHead;
    const chain = verifiedReviewChain(verified, preferredHead);
    const verifiedTop = chain.length ? Number(chain.at(-1).attempt) : 0;
    const evidenced = Math.max(
      evidencedReviewAttemptCount({ history: current, files, verifiedTop,
        receiptRounds: legacyReviewReceipts(id).map((receipt) => receipt.review?.round) }),
      evidencedReviewAttemptCount({ history }));
    // Only the recorded head's chain is restorable: a verified sibling that
    // was never recorded as head carries a verdict the runtime never accepted.
    const determinate = chain.length > 0 && evidenced === verifiedTop &&
      chain.at(-1).digest === preferredHead;
    const quarantine = quarantinePath(dir);
    if (existsSync(dir)) renameSync(dir, quarantine);
    const recoveredFrom = basename(quarantine);
    const rebuilt = [];
    if (determinate) {
      for (const record of chain) {
        writeJson(join(dir, attemptFileName(record)), record);
        rebuilt.push(record);
      }
    } else {
      const total = Math.max(evidenced, RECOVERED_DELIVERED_FLOOR);
      for (const attempt of [total - 1, total]) {
        const placeholder = {
          version: 1, changeId: id, attempt,
          reviewerType: "ai", status: "inconclusive",
          workspaceHash: null, reviewBinding: null,
          priorChainHead: rebuilt.at(-1)?.digest || null,
          ...(rebuilt.length ? {} : { migrated: true }),
          recovered: "unverifiable-review-attempt", recoveredFrom,
          timestamp: now()
        };
        placeholder.digest = stableHash(placeholder);
        writeJson(join(dir, attemptFileName(placeholder)), placeholder);
        rebuilt.push(placeholder);
      }
    }
    const head = rebuilt.at(-1);
    const recovery = {
      at: now(), quarantine: recoveredFrom, determinate,
      evidencedAttempts: evidenced, verifiedAttempts: verifiedTop,
      unverifiableRecords: files.filter((file) =>
        !attemptRecordVerifies(id, file.value)).map((file) => file.name).sort(),
      priorChainHead: current.chainHead || null,
      priorTotalAttempts: Number(current.totalAttempts || 0),
      chainHead: head.digest, totalAttempts: Number(head.attempt)
    };
    writeJson(join(quarantine, "recovery.json"), {
      version: 1, changeId: id, ...recovery, priorReviewHistory: current
    });
    const state = loadRuntime(id);
    state.reviewHistory = {
      ...current,
      version: 1,
      aiAttempts: Math.max(Number(current.aiAttempts || 0), Number(history.aiAttempts || 0),
        rebuilt.filter((record) => record.reviewerType === "ai").length),
      totalAttempts: Number(head.attempt),
      chainHead: head.digest,
      recoveries: [...(current.recoveries || []), recovery]
    };
    saveRuntime(state);
    emitSignal("review-history-recovered",
      `NOTICE: the review attempt chain for ${id} was corrupt; the harness moved it aside as ` +
      `${recoveredFrom} and rebuilt ${recovery.totalAttempts} attempt(s) ` +
      (determinate
        ? "from the records that still verify, verdicts included."
        : "with unverifiable attempts counted as delivered inconclusive AI waves, so no prior verdict is reused and the review budget is consumed."));
    return state.reviewHistory;
  }

  function reviewAttempts(id, history = reviewHistoryState(id)) {
    const attempts = [];
    let digest = history.chainHead || null;
    const seen = new Set();
    while (digest && !seen.has(digest) && seen.size <= 1000) {
      seen.add(digest);
      const attempt = reviewAttemptByDigest(id, digest);
      if (!attempt) break;
      attempts.push(attempt);
      digest = attempt.priorChainHead || null;
    }
    return attempts.sort((left, right) => Number(left.attempt) - Number(right.attempt));
  }

  function deliveredAiAttempts(id, history = reviewHistoryState(id)) {
    // Attempts released by `authority reset-base-move` stay in the immutable
    // chain but no longer consume the wave budget: their verdict expired
    // because a moved base altered the change's diff in replay, not because
    // the work needed another quality round.
    const baseMoveAcknowledged = new Set(history.baseMoveAcknowledged || []);
    return reviewAttempts(id, history).filter((attempt) =>
      attempt.reviewerType === "ai" &&
      !baseMoveAcknowledged.has(attempt.digest) && (
        attempt.status === "completed" &&
          ["pass", "fail", "inconclusive"].includes(attempt.resultStatus) ||
        attempt.version === 1 &&
          ["pass", "fail", "inconclusive"].includes(attempt.status)
      ));
  }

  function infrastructureAiAttempts(id, history = reviewHistoryState(id)) {
    const delivered = new Set(deliveredAiAttempts(id, history).map((attempt) => attempt.digest));
    // Attempts acknowledged by `authority reset-infra` stay in the immutable
    // chain but no longer consume the bounded infrastructure recovery. A
    // base-move release must not leak its delivered attempt into this set —
    // it was delivered, not an infrastructure outcome.
    const acknowledged = new Set([
      ...(history.infraAcknowledged || []),
      ...(history.baseMoveAcknowledged || [])
    ]);
    return reviewAttempts(id, history).filter((attempt) =>
      attempt.reviewerType === "ai" && !delivered.has(attempt.digest) &&
      !acknowledged.has(attempt.digest));
  }

  // The REVIEW_INFRASTRUCTURE_ERROR guard instructs the operator to repair the
  // provider and re-run doctor, so the reset it implies must exist. The caller
  // gates on a passing reviewer diagnosis and a host-recorded decision
  // reference; this only moves the retry accounting, never the attempt chain.
  function acknowledgeInfrastructureAttempts(id, decisionRef) {
    const reference = String(decisionRef || "").trim();
    if (!reference) fail("authority reset-infra requires --decision-ref");
    const state = loadRuntime(id);
    const history = reviewHistoryState(id, state);
    if (history.chainHead && !reviewHistoryChainValid(id, history))
      fail("authority reset-infra requires a valid review attempt history");
    if ((history.infraResets || []).some((row) => row.decisionRef === reference))
      fail("--decision-ref was already used for an infrastructure reset on this change");
    // No reset while any AI attempt is still dispatched: acknowledging the
    // completed errors beside a live dispatch would reopen capacity for a
    // further dispatch and strand the live attempt off the chain head.
    const liveDispatch = reviewAttempts(id, history).find((attempt) =>
      attempt.reviewerType === "ai" && attempt.status === "dispatched");
    if (liveDispatch)
      fail("an AI review attempt is still dispatched; complete or abort it before resetting infrastructure retries: " +
        liveReviewAbortCommand(id, liveDispatch));
    // Completed infrastructure errors only. Anything else is not an
    // infrastructure outcome the bounded recovery circuit consumed.
    const attempts = infrastructureAiAttempts(id, history).filter((attempt) =>
      attempt.status === "completed" && attempt.resultStatus === "error");
    if (!attempts.length)
      fail("no completed reviewer infrastructure errors to acknowledge");
    const digests = attempts.map((attempt) => attempt.digest);
    state.reviewHistory = {
      ...history,
      infraAcknowledged: [...new Set([
        ...(history.infraAcknowledged || []), ...digests
      ])],
      infraResets: [...(history.infraResets || []), {
        decisionRef: reference, digests, at: now()
      }]
    };
    saveRuntime(state);
    return { changeId: id, decisionRef: reference, digests };
  }

  // After the routed waves are delivered the user may, on record, allow one
  // more AI wave. Each decision reference grants exactly one, only while the
  // cap is reached and no AI attempt is still dispatched.
  function grantExtraAiWave(id, decisionRef, maxAiAttempts = 2) {
    const reference = String(decisionRef || "").trim();
    if (!reference) fail("authority extend-review requires --decision-ref");
    const state = loadRuntime(id);
    const history = reviewHistoryState(id, state);
    if (history.chainHead && !reviewHistoryChainValid(id, history))
      fail("authority extend-review requires a valid review attempt history");
    if ((history.extraAiWaves || []).some((row) => row.decisionRef === reference))
      fail("--decision-ref was already used for an extra AI review wave on this change");
    const liveDispatch = reviewAttempts(id, history).find((attempt) =>
      attempt.reviewerType === "ai" && attempt.status === "dispatched");
    if (liveDispatch)
      fail("an AI review attempt is still dispatched; complete or abort it before granting another wave: " +
        liveReviewAbortCommand(id, liveDispatch));
    const delivered = deliveredAiAttempts(id, history).length;
    if (delivered < Number(maxAiAttempts))
      fail(`AI review waves are not exhausted (${delivered}/${maxAiAttempts} delivered); resume advance instead`);
    const grant = { decisionRef: reference, delivered, at: now() };
    state.reviewHistory = {
      ...history,
      extraAiWaves: [...(history.extraAiWaves || []), grant]
    };
    saveRuntime(state);
    return { changeId: id, ...grant, maxAiAttempts: delivered + 1 };
  }

  // The wave cap bounds verdict-quality review rounds. A verdict expired by a
  // moved base whose replay altered the change's diff is not a quality round —
  // the author changed nothing — so the user may, on record, release exactly
  // that attempt from the count. Keyed by the sync movement so one base move
  // releases at most one attempt, and gated on the recorded identities
  // actually differing: when they match, the receipt rebinds on 'proof run'
  // and there is nothing to release.
  const acknowledgeBaseMoveAttempts = acknowledgeBaseMoveAttemptsOperation.bind(null, {
    loadRuntime, saveRuntime, now, fail,
    reviewHistoryState, reviewHistoryChainValid, reviewAttempts, deliveredAiAttempts
  });

  // Accounting the harness caused is released by the harness, never by a user
  // decision: a base move that changed the diff always releases its expired
  // verdict, and a healthy reviewer gets one infrastructure reset per wave.
  // Each release records a harness-owned reference instead of a user's.
  function autoReleaseReviewBudget(id, {
    maxInfrastructureRetries = 1, reviewerHealthy = () => false, reviewerIdentity = null
  } = {}) {
    const released = [];
    const refuse = (message) => { throw new Error(message); };
    const state = loadRuntime(id);
    const history = assertReviewDispatchHistory({
      reviewHistoryChainValid, recoverCorruptReviewHistory,
      reviewChainLowered: isReviewChainLowered
    }, id, reviewHistoryState(id, state));
    const attempts = reviewAttempts(id, history);
    if (attempts.some((attempt) =>
      attempt.reviewerType === "ai" && attempt.status === "dispatched")) return released;
    const move = state.lastBaseMove;
    if (move?.movementKey) {
      const reference = `harness:base-move:${move.movementKey}`;
      try {
        assertBaseMoveResetAllowed(history, move, reference, refuse);
        baseMoveReleasedAttempt(attempts, move, refuse);
        acknowledgeBaseMoveAttempts(id, reference);
        released.push(reference);
      } catch {}
    }
    const current = reviewHistoryState(id, loadRuntime(id));
    const infrastructure = infrastructureAiAttempts(id, current);
    if (infrastructure.length <= Number(maxInfrastructureRetries) ||
        !infrastructure.some((attempt) =>
          attempt.status === "completed" && attempt.resultStatus === "error"))
      return released;
    // A repaired reviewer shows up as a changed configuration: it earns its
    // own reset, so recovery after the repair never needs a user decision.
    // The same configuration still gets one reset per wave, which bounds a
    // reviewer that passes diagnosis but keeps failing dispatch.
    const wave = `harness:infra:wave-${deliveredAiAttempts(id, current).length + 1}`;
    const reference = reviewerIdentity ? `${wave}:${reviewerIdentity}` : wave;
    if ((current.infraResets || []).some((row) => row.decisionRef === reference) ||
        !reviewerHealthy()) return released;
    acknowledgeInfrastructureAttempts(id, reference);
    released.push(reference);
    return released;
  }

  function blockAiExhausted(id, history, maxAiAttempts = 2) {
    const delivered = deliveredAiAttempts(id, history).length;
    const baseMoveRecovery = baseMoveResetRecovery(loadRuntime(id), id);
    fail(`REVIEW_ROUTE_COMPLETE: ${delivered}/${maxAiAttempts} delivered AI review wave(s) are complete. ` +
      "Do not ask the user to choose redesign/split/pause and do not dispatch another open-ended AI review. " +
      "Continue when proof is satisfied; otherwise route a remaining item as AUTO_REPAIR inside the locked contract, " +
      "CONTRACT_DECISION_REQUIRED only for changed behavior/security/data/rollout, or EXTERNAL_WAIT for missing authority." +
      ` If repair cannot progress, report attempted remedies and remaining risks; ask the user for a human verdict, one more AI wave (claude-foundation authority extend-review ${id} --decision-ref <user-decision>), or a pause.` +
      baseMoveRecovery);
  }

  function assertReviewDispatchAllowed(id, reviewerType, maxAiAttempts = 2,
      maxInfrastructureRetries = 1) {
    const state = loadRuntime(id);
    const history = assertReviewDispatchHistory({
      reviewHistoryChainValid, recoverCorruptReviewHistory,
      reviewChainLowered: isReviewChainLowered
    }, id, reviewHistoryState(id, state));
    if (reviewerType === "ai") {
      if (deliveredAiAttempts(id, history).length >= Number(maxAiAttempts))
        blockAiExhausted(id, history, Number(maxAiAttempts));
      if (infrastructureAiAttempts(id, history).length > Number(maxInfrastructureRetries))
        fail(`REVIEW_INFRASTRUCTURE_ERROR: ${maxInfrastructureRetries} automatic reviewer infrastructure retry has already been used. Repair or switch the configured reviewer and resume: the harness resets this itself whenever the reviewer diagnosis passes under a changed reviewer configuration, and once per review wave for the same one. A reviewer configuration fault is the agent's repair; a reviewer that is not logged in or whose credential was rejected is a cause only the user can clear, which advance asks with the exact fix. It is never a product decision.`, 1, { code: "REVIEW_INFRASTRUCTURE_ERROR" });
    }
    return history;
  }

  function reserveReviewAttempt(id, reviewerType, receiptSeed) {
    const state = loadRuntime(id);
    const normalizedReviewerType = String(reviewerType || "").toLowerCase();
    const history = assertReviewDispatchAllowed(id, normalizedReviewerType);
    const attempt = {
      version: 1, changeId: id,
      attempt: Number(history.totalAttempts || 0) + 1,
      reviewerType: normalizedReviewerType, priorChainHead: history.chainHead || null,
      workspaceHash: receiptSeed.workspaceHash, status: receiptSeed.status,
      reviewBinding: receiptSeed.reviewBinding,
      timestamp: now()
    };
    attempt.digest = stableHash(attempt);
    // Spread first: a rebuilt history must not drop the acknowledged
    // infrastructure bookkeeping recorded by `authority reset-infra`.
    state.reviewHistory = {
      ...history,
      version: 1,
      aiAttempts: Number(history.aiAttempts || 0) + (normalizedReviewerType === "ai" ? 1 : 0),
      totalAttempts: attempt.attempt,
      chainHead: attempt.digest
    };
    const path = join(evidenceVault, id, "review-attempts", `${String(attempt.attempt).padStart(4, "0")}-${attempt.digest.slice(0, 12)}.json`);
    writeJson(path, attempt);
    saveRuntime(state);
    return attempt;
  }

  // Reserve every dispatch before work leaves the process. Delivered reviews
  // consume the two-wave review budget; infrastructure outcomes stay visible
  // in the same chain and receive only the separately bounded recovery below.
  function dispatchReviewAttempt(id, details) {
    const state = loadRuntime(id);
    const history = assertReviewDispatchHistory({
      reviewHistoryChainValid, recoverCorruptReviewHistory,
      reviewChainLowered: isReviewChainLowered
    }, id, reviewHistoryState(id, state));
    const reviewerType = reviewDispatchType(details, fail);
    const priorAttempts = reviewAttempts(id, history);
    const aiAttempts = priorAttempts.filter((attempt) => attempt.reviewerType === "ai");
    const completedAi = deliveredAiAttempts(id, history);
    const infrastructureAi = infrastructureAiAttempts(id, history);
    validateReviewDispatchBudget({ blockAiExhausted, fail }, id, reviewerType,
      history, details, completedAi, infrastructureAi);
    const scopeMode = reviewDispatchScope(
      details, reviewerType, aiAttempts, completedAi, fail);
    const attempt = reviewDispatchAttemptValue({ now, stableHash, fail },
      id, details, history, reviewerType, scopeMode);
    const path = join(evidenceVault, id, "review-attempts",
      `${String(attempt.attempt).padStart(4, "0")}-${attempt.digest.slice(0, 12)}.json`);
    writeJson(path, attempt);
    state.reviewHistory = reviewHistoryAfterDispatch(history, attempt, reviewerType);
    saveRuntime(state);
    return attempt;
  }

  const completeReviewAttempt = completeReviewAttemptOperation.bind(null, {
    evidenceVault, loadRuntime, saveRuntime, stableHash, writeJson, now, fail,
    reviewHistoryState, reviewAttemptByDigest, deliveredAiAttempts
  });

  const recordRepairClosureAttempt = recordRepairClosureAttemptOperation.bind(null, {
    evidenceVault, loadRuntime, saveRuntime, stableHash, writeJson, now, fail,
    reviewHistoryState, reviewHistoryChainValid, recoverCorruptReviewHistory,
    reviewChainLowered: isReviewChainLowered, reviewAttempts, deliveredAiAttempts
  });

  return {
    reviewHistoryState,
    reviewAttemptByDigest,
    reviewHistoryChainValid,
    assertReviewDispatchAllowed,
    reserveReviewAttempt,
    dispatchReviewAttempt,
    completeReviewAttempt,
    recordRepairClosureAttempt,
    reviewAttempts,
    deliveredAiAttempts,
    infrastructureAiAttempts,
    acknowledgeInfrastructureAttempts,
    grantExtraAiWave,
    acknowledgeBaseMoveAttempts,
    autoReleaseReviewBudget
  };
}
