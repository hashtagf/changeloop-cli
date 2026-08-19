export function createReviewProtocol({ stableHash, fail }) {
  function flagValues(flags, name) {
    const value = flags[name];
    if (value === undefined || value === null) return [];
    return (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function provenanceResult(review, { allowMissingAiSession = false } = {}) {
    const reviewer = review?.reviewer || {};
    const subjects = Array.isArray(review?.subjects) ? review.subjects : [];
    const actors = subjects.map((subject) => String(subject.identity || "").toLowerCase());
    const reviewerIdentity = String(reviewer.identity || "").toLowerCase();
    const reviewerSession = String(reviewer.sessionId || "").toLowerCase();
    const subjectsComplete = subjects.length > 0 && subjects.length <= 16 &&
      subjects.every((subject) => subject?.type === "human"
        ? Boolean(subject.identity)
        : subject?.type === "ai" && Boolean(subject.identity && subject.sessionId &&
          subject.providerFamily && subject.modelFamily && subject.modelId));
    const deterministic = reviewer.type === "deterministic" &&
      reviewer.identity === "foundation-repair-closure";
    const reviewerComplete = deterministic
      ? true
      : reviewer.type === "human"
      ? Boolean(reviewerIdentity)
      : reviewer.type === "ai" && Boolean(
        reviewer.providerFamily && reviewer.modelFamily && reviewer.modelId &&
        (reviewerSession || allowMissingAiSession)
      );
    const complete = reviewerComplete && subjectsComplete;
    const sessionIndependent = deterministic || reviewer.type === "human" || Boolean(reviewerSession) &&
      subjects.filter((subject) => subject.type === "ai")
        .every((subject) => String(subject.sessionId).toLowerCase() !== reviewerSession);
    const independent = complete && !actors.includes(reviewerIdentity) && sessionIndependent;
    const diverse = deterministic || reviewer.type === "human" || (complete && subjects
      .filter((subject) => subject.type === "ai")
      .every((subject) =>
        String(subject.providerFamily).toLowerCase() !==
          String(reviewer.providerFamily).toLowerCase() ||
        String(subject.modelFamily).toLowerCase() !==
          String(reviewer.modelFamily).toLowerCase()));
    return { complete, independent, diverse };
  }

  function receiptBinding(receipt) {
    const canonical = JSON.parse(JSON.stringify(receipt));
    if (canonical.review) delete canonical.review.attemptDigest;
    return stableHash(canonical);
  }

  function subjectProvenance(flags) {
    const rawStructured = flags["subject-provenance"] === undefined
      ? []
      : Array.isArray(flags["subject-provenance"])
        ? flags["subject-provenance"]
        : [flags["subject-provenance"]];
    const structured = rawStructured.map((value) => {
      let subject;
      try { subject = JSON.parse(String(value)); }
      catch (error) { fail(`invalid --subject-provenance JSON (${error.message})`); }
      return subject;
    });
    if (structured.length) return structured;
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

  function attemptIsValid(receipt, attempt) {
    if (!attempt) return false;
    const findings = receipt.review?.findings || {};
    const scope = receipt.review?.scope || {};
    const scopePaths = Array.isArray(scope.paths) ? scope.paths : [];
    const expectedScopeDigest = stableHash({
      priorWorkspaceHash: receipt.review?.supersedes?.workspaceHash || null,
      workspaceHash: receipt.workspaceHash,
      paths: scopePaths
    });
    const reviewer = receipt.review?.reviewer || {};
    const common = attempt.workspaceHash === receipt.workspaceHash &&
      attempt.reviewerType === reviewer.type &&
      Number(receipt.review?.round) === Number(attempt.attempt) &&
      [findings.verified, findings.unresolvedBlockers]
        .every((count) => Number.isInteger(count) && count >= 0) &&
      !(receipt.status === "pass" && findings.unresolvedBlockers !== 0) &&
      scope.digest === expectedScopeDigest;
    if (!common) return false;
    if (attempt.version === 2 || attempt.version === 3) {
      const findingsMatch = attempt.version === 2 ||
        stableHash(attempt.findings || []) === stableHash(findings.items || []) &&
        stableHash([...(attempt.verifiedFindingIds || [])].sort()) ===
          stableHash([...(findings.verifiedIds || [])].sort());
      return (attempt.version === 2
        ? attempt.status === "dispatched" : attempt.status === "completed") &&
        attempt.requestId === receipt.review?.requestId &&
        attempt.reviewerIdentity === reviewer.identity &&
        (attempt.reviewerProviderFamily || null) === (reviewer.providerFamily || null) &&
        (attempt.reviewerModelFamily || null) === (reviewer.modelFamily || null) &&
        (attempt.reviewerModelId || null) === (reviewer.modelId || null) &&
        (attempt.reviewerSessionId || null) === (reviewer.sessionId || null) &&
        attempt.scope?.mode === scope.mode &&
        (attempt.scope?.baseAttemptDigest || null) === (scope.baseAttemptDigest || null) &&
        JSON.stringify([...(attempt.scope?.paths || [])].sort()) ===
          JSON.stringify([...scopePaths].sort()) &&
        attempt.scope?.digest === scope.dispatchDigest &&
        attempt.packetDigest === receipt.review?.packetDigest && findingsMatch;
    }
    if (attempt.version === 4) {
      const closure = receipt.review?.repairClosure || {};
      return attempt.status === "completed" && attempt.resultStatus === "pass" &&
        attempt.requestId === receipt.review?.requestId &&
        attempt.reviewerIdentity === reviewer.identity &&
        attempt.scope?.mode === "repair-closure" &&
        (attempt.scope?.baseAttemptDigest || null) ===
          (scope.baseAttemptDigest || null) &&
        JSON.stringify([...(attempt.scope?.paths || [])].sort()) ===
          JSON.stringify([...scopePaths].sort()) &&
        attempt.scope?.digest === scope.dispatchDigest &&
        attempt.packetDigest === receipt.review?.packetDigest &&
        attempt.sourceAttemptDigest === closure.sourceAttemptDigest &&
        stableHash(attempt.evidenceBindings || []) ===
          stableHash(closure.evidenceBindings || []) &&
        stableHash(attempt.verifiedFindingIds || []) ===
          stableHash(findings.verifiedIds || []);
    }
    return attempt.version === 1 && attempt.reviewBinding === receiptBinding(receipt);
  }

  return {
    flagValues,
    provenanceResult,
    receiptBinding,
    subjectProvenance,
    attemptIsValid
  };
}
