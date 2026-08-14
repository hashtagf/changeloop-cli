export function createReviewProtocol({ stableHash, fail }) {
  function flagValues(flags, name) {
    const value = flags[name];
    if (value === undefined || value === null) return [];
    return (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function provenanceResult(review) {
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
    const reviewerComplete = reviewer.type === "human"
      ? Boolean(reviewerIdentity)
      : reviewer.type === "ai" && Boolean(
        reviewer.providerFamily && reviewer.modelFamily && reviewer.modelId && reviewerSession
      );
    const complete = reviewerComplete && subjectsComplete;
    const independent = complete && !actors.includes(reviewerIdentity) &&
      subjects.filter((subject) => subject.type === "ai")
        .every((subject) => String(subject.sessionId).toLowerCase() !== reviewerSession);
    const diverse = reviewer.type === "human" || (complete && subjects
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
    return attempt.workspaceHash === receipt.workspaceHash &&
      attempt.reviewerType === receipt.review?.reviewer?.type &&
      attempt.reviewBinding === receiptBinding(receipt) &&
      Number(receipt.review?.round) === Number(attempt.attempt) &&
      [findings.verified, findings.unresolvedBlockers]
        .every((count) => Number.isInteger(count) && count >= 0) &&
      !(receipt.status === "pass" && findings.unresolvedBlockers !== 0) &&
      scope.digest === expectedScopeDigest;
  }

  return {
    flagValues,
    provenanceResult,
    receiptBinding,
    subjectProvenance,
    attemptIsValid
  };
}
