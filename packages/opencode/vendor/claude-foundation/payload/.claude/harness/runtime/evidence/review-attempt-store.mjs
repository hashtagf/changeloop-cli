import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
  blockWithDecision,
  fail
}) {
  function reviewHistoryState(id, state = loadRuntime(id)) {
    const receiptDir = join(receiptsRoot, id);
    const candidates = existsSync(receiptDir)
      ? readdirSync(receiptDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "proof.json")
        .map((entry) => readJson(join(receiptDir, entry.name), {}))
        .filter((receipt) => receipt.review)
      : [];
    if (state.reviewHistory?.version === 1 &&
        (Number(state.reviewHistory.totalAttempts || 0) > 0 || candidates.length === 0))
      return state.reviewHistory;
    const latest = candidates.sort((a, b) => Number(b.review?.round || 0) - Number(a.review?.round || 0))[0];
    const round = Number(latest?.review?.round || 0);
    // A legacy receipt only preserves the latest reviewer, not the identities
    // of earlier rounds. Treat every prior round as potentially AI so migration
    // cannot manufacture extra AI retries when the latest receipt is human.
    const aiAttempts = Math.min(round, 2);
    let migratedAttempt = null;
    if (latest) {
      migratedAttempt = {
        version: 1, changeId: id, attempt: round || 1,
        reviewerType: latest.review?.reviewer?.type || "unknown",
        workspaceHash: latest.workspaceHash || null, status: latest.status || null,
        reviewBinding: reviewReceiptBinding(latest),
        priorChainHead: null, migrated: true,
        migratedFromReceiptDigest: stableHash(latest), timestamp: now()
      };
      migratedAttempt.digest = stableHash(migratedAttempt);
      writeJson(join(evidenceVault, id, "review-attempts",
        `${String(round || 1).padStart(4, "0")}-${migratedAttempt.digest.slice(0, 12)}.json`), migratedAttempt);
    }
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

  function reviewHistoryChainValid(id, history) {
    let digest = history.chainHead || null;
    let expectedAttempt = Number(history.totalAttempts || 0);
    let base = null;
    const seen = new Set();
    while (digest) {
      if (seen.has(digest) || seen.size > 1000) return false;
      seen.add(digest);
      const attempt = reviewAttemptByDigest(id, digest);
      if (!attempt || Number(attempt.attempt) !== expectedAttempt || attempt.changeId !== id)
        return false;
      base = attempt;
      digest = attempt.priorChainHead || null;
      expectedAttempt -= 1;
    }
    // A migrated history has no records before its synthetic attempt, so the
    // walk legitimately stops above zero. That marker sits at the chain *base*;
    // looking for it on the head declared every migrated change corrupt the
    // moment a real attempt was appended on top of it.
    return expectedAttempt === 0 || Boolean(base?.migrated);
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
    return reviewAttempts(id, history).filter((attempt) =>
      attempt.reviewerType === "ai" && (
        attempt.status === "completed" &&
          ["pass", "fail", "inconclusive"].includes(attempt.resultStatus) ||
        attempt.version === 1 &&
          ["pass", "fail", "inconclusive"].includes(attempt.status)
      ));
  }

  function infrastructureAiAttempts(id, history = reviewHistoryState(id)) {
    const delivered = new Set(deliveredAiAttempts(id, history).map((attempt) => attempt.digest));
    // Attempts acknowledged by `authority reset-infra` stay in the immutable
    // chain but no longer consume the bounded infrastructure recovery.
    const acknowledged = new Set(history.infraAcknowledged || []);
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
    if (reviewAttempts(id, history).some((attempt) =>
      attempt.reviewerType === "ai" && attempt.status === "dispatched"))
      fail("an AI review attempt is still dispatched; complete or abort it before resetting infrastructure retries");
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

  function blockAiExhausted(id, history, maxAiAttempts = 2) {
    const delivered = deliveredAiAttempts(id, history).length;
    fail(`REVIEW_ROUTE_COMPLETE: ${delivered}/${maxAiAttempts} delivered AI review wave(s) are complete. ` +
      "Do not ask the user to choose redesign/split/pause and do not dispatch another open-ended AI review. " +
      "Continue when proof is satisfied; otherwise route a remaining item as AUTO_REPAIR inside the locked contract, " +
      "CONTRACT_DECISION_REQUIRED only for changed behavior/security/data/rollout, or EXTERNAL_WAIT for missing authority.");
  }

  function assertReviewDispatchAllowed(id, reviewerType, maxAiAttempts = 2,
      maxInfrastructureRetries = 1) {
    const state = loadRuntime(id);
    const history = reviewHistoryState(id, state);
    if (history.chainHead && !reviewHistoryChainValid(id, history))
      blockWithDecision(id, "review-history-corrupt", {
        kind: "review-history-corrupt",
        summary: "The review attempt chain is corrupt, so Foundation cannot safely dispatch another reviewer.",
        options: [
          { id: "restore", outcome: "Restore the attempt records from backup." },
          { id: "abandon", outcome: "Retire this change and start a fresh one." },
          { id: "pause", outcome: "Leave the change unchanged." }
        ],
        recommended: "restore",
        attemptsRecorded: Number(history.totalAttempts || 0)
      });
    if (reviewerType === "ai") {
      if (deliveredAiAttempts(id, history).length >= Number(maxAiAttempts))
        blockAiExhausted(id, history, Number(maxAiAttempts));
      if (infrastructureAiAttempts(id, history).length > Number(maxInfrastructureRetries))
        fail(`REVIEW_INFRASTRUCTURE_ERROR: ${maxInfrastructureRetries} automatic reviewer infrastructure retry has already been used. Repair the configured provider and run doctor --stage prove; this is not a product decision and must not open another user interview.`);
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
    const history = reviewHistoryState(id, state);
    if (history.chainHead && !reviewHistoryChainValid(id, history))
      blockWithDecision(id, "review-history-corrupt", {
        kind: "review-history-corrupt",
        summary: "The review attempt chain is corrupt, so Foundation cannot safely reserve another dispatch.",
        options: [
          { id: "restore", outcome: "Restore the attempt records from backup." },
          { id: "abandon", outcome: "Retire this change and start a fresh one." },
          { id: "pause", outcome: "Leave the change unchanged." }
        ],
        recommended: "restore",
        attemptsRecorded: Number(history.totalAttempts || 0)
      });
    const reviewerType = String(details.reviewerType || "").toLowerCase();
    if (!["ai", "human"].includes(reviewerType))
      fail("review dispatch requires reviewerType ai|human");
    const priorAttempts = reviewAttempts(id, history);
    const aiAttempts = priorAttempts.filter((attempt) => attempt.reviewerType === "ai");
    const completedAi = deliveredAiAttempts(id, history);
    const infrastructureAi = infrastructureAiAttempts(id, history);
    const maxAiAttempts = Number(details.maxAiAttempts || 2);
    const maxInfrastructureRetries = Number(details.maxInfrastructureRetries ?? 1);
    if (reviewerType === "ai") {
      if (completedAi.length >= maxAiAttempts)
        blockAiExhausted(id, history, maxAiAttempts);
      if (infrastructureAi.length > maxInfrastructureRetries)
        fail(`REVIEW_INFRASTRUCTURE_ERROR: ${maxInfrastructureRetries} automatic reviewer infrastructure retry has already been used. Repair the configured provider and run doctor --stage prove; this is not a product decision and must not open another user interview.`);
    }
    const scopeMode = String(details.scope?.mode || "");
    if (!["full", "delta"].includes(scopeMode))
      fail("review dispatch scope must be full|delta");
    if (reviewerType === "ai") {
      // A crashed/aborted dispatch does not produce a review baseline. The one
      // infrastructure recovery is therefore full; delta is available only
      // after a delivered full response.
      const expectedMode = completedAi.length === 0 ? "full" : "delta";
      if (scopeMode !== expectedMode)
        fail(`AI review dispatch ${aiAttempts.length + 1} requires --scope ${expectedMode}`);
      const expectedBase = completedAi.at(-1)?.digest || null;
      if (scopeMode === "delta" && details.scope?.baseAttemptDigest !== expectedBase)
        fail(`AI delta review must reference the first AI dispatch with --base-attempt ${expectedBase}`);
      if (scopeMode === "full" && details.scope?.baseAttemptDigest)
        fail("the first AI full review must not declare --base-attempt");
    }
    const attempt = {
      version: 2,
      changeId: id,
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
      timestamp: now()
    };
    if (!attempt.reviewerIdentity || !attempt.requestId || !attempt.workspaceHash)
      fail("review dispatch requires reviewer identity, request, and workspace hash");
    attempt.digest = stableHash(attempt);
    const path = join(evidenceVault, id, "review-attempts",
      `${String(attempt.attempt).padStart(4, "0")}-${attempt.digest.slice(0, 12)}.json`);
    writeJson(path, attempt);
    state.reviewHistory = {
      ...history,
      version: 1,
      aiAttempts: Number(history.aiAttempts || 0) + (reviewerType === "ai" ? 1 : 0),
      totalAttempts: attempt.attempt,
      chainHead: attempt.digest
    };
    saveRuntime(state);
    return attempt;
  }

  function completeReviewAttempt(id, digest, details) {
    const state = loadRuntime(id);
    const history = reviewHistoryState(id, state);
    if (history.chainHead !== digest)
      fail("review completion must finalize the current dispatched attempt");
    const dispatched = reviewAttemptByDigest(id, digest);
    if (!dispatched || dispatched.version !== 2 || dispatched.status !== "dispatched")
      fail("review completion requires a valid dispatched attempt");
    const resultStatus = String(details.resultStatus || "");
    const sessionId = String(details.reviewerSessionId || "").trim();
    if (dispatched.reviewerType === "ai" && !sessionId && resultStatus !== "error")
      fail("AI review completion requires the actual reviewer session ID");
    if (!dispatched.sessionDeferred &&
        (dispatched.reviewerSessionId || null) !== (sessionId || null))
      fail("review completion session does not match the dispatched reviewer");
    const findings = (details.findings || []).map((finding) => ({
      id: String(finding.id || "").trim(),
      severity: String(finding.severity || "").toLowerCase(),
      path: String(finding.path || ""),
      line: finding.line === null || finding.line === undefined
        ? null : Number(finding.line),
      message: String(finding.message || "").trim(),
      claimIds: [...new Set((finding.claimIds || []).map((value) =>
        String(value).trim()).filter(Boolean))].sort(),
      verificationCaseIds: [...new Set((finding.verificationCaseIds || [])
        .map((value) => String(value).trim()).filter(Boolean))].sort()
    }));
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
    if (details.resultStatus === "pass" && findings.some((finding) =>
      ["blocker", "major"].includes(finding.severity)))
      fail("a passing review completion cannot carry blocker or major findings");
    const priorDelivered = deliveredAiAttempts(id, history);
    const finalBlocking = resultStatus === "fail" && priorDelivered.length >= 1
      ? findings.filter((finding) => ["blocker", "major"].includes(finding.severity))
      : [];
    if (finalBlocking.some((finding) =>
      !finding.path || finding.claimIds.length === 0 ||
      finding.verificationCaseIds.length === 0))
      fail("a blocker or major finding in the final AI delta must name a path, claimIds, and verificationCaseIds for deterministic repair closure");
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
      completedAt: now()
    };
    delete completed.digest;
    completed.digest = stableHash(completed);
    writeJson(join(evidenceVault, id, "review-attempts",
      `${String(completed.attempt).padStart(4, "0")}-${completed.digest.slice(0, 12)}.json`), completed);
    state.reviewHistory = { ...history, chainHead: completed.digest };
    saveRuntime(state);
    return completed;
  }

  function recordRepairClosureAttempt(id, details) {
    const state = loadRuntime(id);
    const history = reviewHistoryState(id, state);
    if (history.chainHead && !reviewHistoryChainValid(id, history))
      fail("review repair closure requires a valid attempt history");
    const attempts = reviewAttempts(id, history);
    const current = attempts.at(-1);
    if (current?.reviewerType === "deterministic" &&
        current.sourceAttemptDigest === details.sourceAttemptDigest &&
        current.workspaceHash === details.workspaceHash &&
        current.scope?.digest === details.scopeDigest &&
        stableHash(current.evidenceBindings || []) ===
          stableHash(details.evidenceBindings || []))
      return current;
    const delivered = deliveredAiAttempts(id, history);
    const source = delivered.at(-1);
    if (delivered.length < 2 || !source || source.digest !== details.sourceAttemptDigest ||
        source.resultStatus !== "fail" || source.scope?.mode !== "delta")
      fail("deterministic repair closure requires the failed final AI delta");
    if (source.workspaceHash === details.workspaceHash)
      fail("deterministic repair closure requires a changed workspace after the final finding batch");
    const verifiedFindingIds = [...new Set(details.verifiedFindingIds || [])].sort();
    const expectedFindingIds = source.findings.filter((finding) =>
      ["blocker", "major"].includes(finding.severity)).map((finding) => finding.id).sort();
    if (!expectedFindingIds.length ||
        JSON.stringify(verifiedFindingIds) !== JSON.stringify(expectedFindingIds))
      fail("deterministic repair closure must close every blocker/major ID from the final AI delta");
    if (!Array.isArray(details.evidenceBindings) || !details.evidenceBindings.length)
      fail("deterministic repair closure requires current evidence bindings");
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
      timestamp: now(),
      completedAt: now()
    };
    attempt.digest = stableHash(attempt);
    writeJson(join(evidenceVault, id, "review-attempts",
      `${String(attempt.attempt).padStart(4, "0")}-${attempt.digest.slice(0, 12)}.json`), attempt);
    state.reviewHistory = {
      ...history,
      totalAttempts: attempt.attempt,
      chainHead: attempt.digest
    };
    saveRuntime(state);
    return attempt;
  }

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
    acknowledgeInfrastructureAttempts
  };
}
