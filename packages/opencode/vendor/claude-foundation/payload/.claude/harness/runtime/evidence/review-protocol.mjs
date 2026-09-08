export function structuredSubjectProvenance({ fail }, value) {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => {
    try { return JSON.parse(String(entry)); }
    catch (error) { fail(`invalid --subject-provenance JSON (${error.message})`); }
  });
}

export function legacySubjectProvenance({ flagValues, fail }, flags) {
  const actors = flagValues(flags, "subject-actor");
  const sessions = flagValues(flags, "subject-session");
  const providers = flagValues(flags, "subject-provider-family");
  const families = flagValues(flags, "subject-model-family");
  const models = flagValues(flags, "subject-model");
  if ([actors, sessions, providers, families, models].some((values) => values.length > 1))
    fail("multiple implementers require repeated --subject-provenance JSON tuples");
  if (!actors.length) return [];
  const ai = sessions.length || providers.length || families.length || models.length;
  return [{
    type: ai ? "ai" : "human",
    identity: actors[0],
    sessionId: sessions[0] || null,
    providerFamily: providers[0]?.toLowerCase() || null,
    modelFamily: families[0]?.toLowerCase() || null,
    modelId: models[0] || null
  }];
}

export function subjectProvenanceOperation(context, flags) {
  const structured = structuredSubjectProvenance(context, flags["subject-provenance"]);
  return structured.length ? structured : legacySubjectProvenance(context, flags);
}

export function reviewSubjectComplete(subject) {
  if (subject?.type === "human") return Boolean(subject.identity);
  return subject?.type === "ai" && Boolean(
    subject.identity && subject.sessionId && subject.providerFamily &&
    subject.modelFamily && subject.modelId);
}

export function reviewSubjectsComplete(subjects) {
  return subjects.length > 0 && subjects.length <= 16 &&
    subjects.every(reviewSubjectComplete);
}

export function deterministicReview(reviewer) {
  return reviewer.type === "deterministic" &&
    reviewer.identity === "foundation-repair-closure";
}

export function reviewActorComplete(
  reviewer, reviewerIdentity, reviewerSession, allowMissingAiSession, deterministic
) {
  if (deterministic) return true;
  if (reviewer.type === "human") return Boolean(reviewerIdentity);
  return reviewer.type === "ai" && Boolean(
    reviewer.providerFamily && reviewer.modelFamily && reviewer.modelId &&
    (reviewerSession || allowMissingAiSession));
}

export function reviewSessionIndependent(
  reviewer, reviewerSession, subjects, deterministic
) {
  if (deterministic || reviewer.type === "human") return true;
  if (!reviewerSession) return false;
  return subjects.filter((subject) => subject.type === "ai")
    .every((subject) =>
      String(subject.sessionId).toLowerCase() !== reviewerSession);
}

export function reviewSubjectsDiverse(reviewer, subjects, complete, deterministic) {
  if (deterministic || reviewer.type === "human") return true;
  if (!complete) return false;
  return subjects.filter((subject) => subject.type === "ai")
    .every((subject) =>
      String(subject.providerFamily).toLowerCase() !==
        String(reviewer.providerFamily).toLowerCase() ||
      String(subject.modelFamily).toLowerCase() !==
        String(reviewer.modelFamily).toLowerCase());
}

export function reviewProvenanceResult(
  review, { allowMissingAiSession = false } = {}
) {
  const reviewer = review?.reviewer || {};
  const subjects = Array.isArray(review?.subjects) ? review.subjects : [];
  const actors = subjects.map((subject) =>
    String(subject.identity || "").toLowerCase());
  const reviewerIdentity = String(reviewer.identity || "").toLowerCase();
  const reviewerSession = String(reviewer.sessionId || "").toLowerCase();
  const deterministic = deterministicReview(reviewer);
  const complete = reviewActorComplete(reviewer, reviewerIdentity,
    reviewerSession, allowMissingAiSession, deterministic) &&
    reviewSubjectsComplete(subjects);
  const independent = complete && !actors.includes(reviewerIdentity) &&
    reviewSessionIndependent(
      reviewer, reviewerSession, subjects, deterministic);
  const diverse = reviewSubjectsDiverse(
    reviewer, subjects, complete, deterministic);
  return { complete, independent, diverse };
}

export function createReviewProtocol({ stableHash, fail }) {
  function flagValues(flags, name) {
    const value = flags[name];
    if (value === undefined || value === null) return [];
    return (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function receiptBinding(receipt) {
    const canonical = JSON.parse(JSON.stringify(receipt));
    if (canonical.review) delete canonical.review.attemptDigest;
    return stableHash(canonical);
  }

  const subjectProvenance = subjectProvenanceOperation.bind(null, { flagValues, fail });

  function optionalEqual(left, right) {
    return (left || null) === (right || null);
  }

  function sortedValuesEqual(left = [], right = []) {
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  }

  function digestValuesEqual(left, right) {
    return stableHash(left || []) === stableHash(right || []);
  }

  function validFindingCount(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function resultAllowsBlockers(status, unresolvedBlockers) {
    if (status === "pass") return unresolvedBlockers === 0;
    return true;
  }

  function commonAttemptContext(receipt, attempt) {
    if (!attempt) return null;
    const findings = receipt.review?.findings || {};
    const scope = receipt.review?.scope || {};
    const scopePaths = Array.isArray(scope.paths) ? scope.paths : [];
    const reviewer = receipt.review?.reviewer || {};
    const expectedScopeDigest = stableHash({
      priorWorkspaceHash: receipt.review?.supersedes?.workspaceHash || null,
      workspaceHash: receipt.workspaceHash,
      paths: scopePaths
    });
    const valid = [
      attempt.workspaceHash === receipt.workspaceHash,
      attempt.reviewerType === reviewer.type,
      Number(receipt.review?.round) === Number(attempt.attempt),
      validFindingCount(findings.verified),
      validFindingCount(findings.unresolvedBlockers),
      resultAllowsBlockers(receipt.status, findings.unresolvedBlockers),
      scope.digest === expectedScopeDigest
    ].every(Boolean);
    return valid ? { findings, scope, scopePaths, reviewer } : null;
  }

  function version23FindingsMatch(attempt, findings) {
    if (attempt.version === 2) return true;
    return [
      digestValuesEqual(attempt.findings, findings.items),
      digestValuesEqual(
        [...(attempt.verifiedFindingIds || [])].sort(),
        [...(findings.verifiedIds || [])].sort())
    ].every(Boolean);
  }

  function version23StatusMatches(attempt, receipt) {
    if (attempt.version === 2) return attempt.status === "dispatched";
    return attempt.status === "completed" && attempt.resultStatus === receipt.status;
  }

  function reviewerMatches(attempt, reviewer) {
    return [
      attempt.reviewerIdentity === reviewer.identity,
      optionalEqual(attempt.reviewerProviderFamily, reviewer.providerFamily),
      optionalEqual(attempt.reviewerModelFamily, reviewer.modelFamily),
      optionalEqual(attempt.reviewerModelId, reviewer.modelId),
      optionalEqual(attempt.reviewerSessionId, reviewer.sessionId)
    ].every(Boolean);
  }

  function reviewScopeMatches(attempt, scope, scopePaths) {
    return [
      attempt.scope?.mode === scope.mode,
      optionalEqual(attempt.scope?.baseAttemptDigest, scope.baseAttemptDigest),
      sortedValuesEqual(attempt.scope?.paths, scopePaths),
      attempt.scope?.digest === scope.dispatchDigest
    ].every(Boolean);
  }

  function version23AttemptIsValid(receipt, attempt, context) {
    return [
      version23StatusMatches(attempt, receipt),
      attempt.requestId === receipt.review?.requestId,
      reviewerMatches(attempt, context.reviewer),
      reviewScopeMatches(attempt, context.scope, context.scopePaths),
      attempt.packetDigest === receipt.review?.packetDigest,
      version23FindingsMatch(attempt, context.findings)
    ].every(Boolean);
  }

  function repairClosureAttemptIsValid(receipt, attempt, context) {
    const closure = receipt.review?.repairClosure || {};
    return [
      attempt.status === "completed",
      attempt.resultStatus === "pass",
      receipt.status === "pass",
      attempt.requestId === receipt.review?.requestId,
      attempt.reviewerIdentity === context.reviewer.identity,
      attempt.scope?.mode === "repair-closure",
      optionalEqual(attempt.scope?.baseAttemptDigest, context.scope.baseAttemptDigest),
      sortedValuesEqual(attempt.scope?.paths, context.scopePaths),
      attempt.scope?.digest === context.scope.dispatchDigest,
      attempt.packetDigest === receipt.review?.packetDigest,
      attempt.sourceAttemptDigest === closure.sourceAttemptDigest,
      digestValuesEqual(attempt.evidenceBindings, closure.evidenceBindings),
      digestValuesEqual(attempt.verifiedFindingIds, context.findings.verifiedIds)
    ].every(Boolean);
  }

  function attemptIsValid(receipt, attempt) {
    const context = commonAttemptContext(receipt, attempt);
    if (!context) return false;
    if (attempt.version === 2 || attempt.version === 3)
      return version23AttemptIsValid(receipt, attempt, context);
    if (attempt.version === 4)
      return repairClosureAttemptIsValid(receipt, attempt, context);
    return attempt.version === 1 && attempt.reviewBinding === receiptBinding(receipt);
  }

  return {
    flagValues,
    provenanceResult: reviewProvenanceResult,
    receiptBinding,
    subjectProvenance,
    attemptIsValid
  };
}
