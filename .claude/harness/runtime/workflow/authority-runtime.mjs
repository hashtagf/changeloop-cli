import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { acquireProcessLock } from "../core/process-lock.mjs";

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
  runConfiguredReview,
  writeJson,
  fail
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
    const scoped = providerConfig(id, provider)?.repository;
    return scoped ? providerWorkspaceHash(id, provider) : relevantHash(id);
  }

  function authorityPacket(id, type) {
    if (type === "review") return reviewPacketValue(id);
    const state = loadRuntime(id);
    const contract = evidence(id);
    const acceptance = resolvedAcceptance(id, state, contract);
    const context = reviewPacketValue(id);
    const claims = contract.claims.filter((claim) => acceptance.claimIds.includes(claim.id))
      .map((claim) => ({
        id: claim.id,
        scenario: claim.scenario,
        impact: claim.impact,
        criterion: `Confirm the final result satisfies: ${claim.scenario}`
      }));
    return {
      version: Number(protocolVersion), packetType: "acceptance", changeId: id,
      workspaceHash: relevantHash(id), reason: acceptance.reason,
      intent: state.intent,
      claims,
      inspection: {
        workspaces: context.changedSurface?.inspection || [],
        changedSurface: context.changedSurface || null,
        decisions: context.decisions || null,
        automatedEvidence: context.evidence || []
      },
      response: {
        statuses: ["pass", "fail", "inconclusive", "error"],
        instructions: "Inspect the final workspace against every criterion. Pass only when all criteria are satisfied; otherwise reject, report uncertainty, or pause without a response.",
        requiredForPass: ["named human", "criterion observations", "durable artifact or reference"]
      },
      requiredActor: "human"
    };
  }

  function canonicalPacketDigest(packet) {
    const canonical = JSON.parse(JSON.stringify(packet || {}));
    delete canonical.packetDigest;
    return stableHash(canonical);
  }

  function recordedCompletedAiReviews(id, history, provider) {
    const path = receiptPath(id, provider);
    const receipt = existsSync(path) ? readJson(path, {}) : {};
    const recordedDigest = receipt.review?.attemptDigest || null;
    return deliveredAiAttempts(id, history).filter((attempt) =>
      attempt.digest === recordedDigest);
  }

  function requestAuthorityUnlocked(id, flags = {}, options = {}) {
    const type = String(flags.type || "");
    if (!["review", "acceptance"].includes(type))
      fail("authority request --type must be review|acceptance");
    validate(id, "active", { quiet: true });
    const pending = pendingTasks(id);
    if (pending.length)
      fail(`authority request requires completed implementation tasks: ${pending.map((task) => task.id).join(", ")}`);
    const repository = String(flags.repo || "").trim() || null;
    const provider = authorityProvider(id, type, repository);
    if (!provider || !requiredProviders(id).includes(provider))
      fail(repository
        ? `change '${id}' has no ${type} provider scoped to repository '${repository}'`
        : `change '${id}' does not require ${type} authority`);
    const workspaceHash = authorityWorkspaceHash(id, provider);
    const existing = authorityStore.list(id).find((entry) =>
      entry.value.type === type && entry.value.provider === provider &&
      entry.value.workspaceHash === workspaceHash &&
      ["requested", "dispatched", "pending"].includes(entry.value.status));
    if (existing) {
      if (!options.quiet) console.log(JSON.stringify(existing.value, null, 2));
      return existing.value;
    }
    const packet = authorityPacket(id, type);
    const requestId = `${type}-${Date.now()}-${randomBytes(8).toString("hex")}`;
    const request = {
      version: Number(protocolVersion), requestId, changeId: id, type, provider,
      status: "requested", workspaceHash, claimIds: claimsForProvider(id, provider).map((claim) => claim.id),
      packet, packetDigest: canonicalPacketDigest(packet), requestedAt: now(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      reviewCircuit: type === "review"
        ? foundationPolicy().workflow.reviewCircuit : null,
      requirements: type === "review" ? reviewPolicy(id) : {
        actor: "human", acceptance: resolvedAcceptance(id)
      }
    };
    authorityStore.writeRequest(id, request);
    if (!options.quiet) console.log(JSON.stringify(request, null, 2));
    return request;
  }

  function requestAuthority(id, flags = {}, options = {}) {
    return withAuthorityLock(id, () => requestAuthorityUnlocked(id, flags, options));
  }

  function dispatchAuthorityUnlocked(id, flags = {}) {
    const requestId = String(flags.request || "");
    if (!requestId) fail("authority dispatch requires --request <id>");
    const entry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const request = entry.value;
    if (request.status === "dispatched") {
      console.log(JSON.stringify(request, null, 2));
      return request;
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
    const routing = reviewPolicy(id);
    const historySnapshot = reviewHistoryState(id);
    const completedAi = recordedCompletedAiReviews(
      id, historySnapshot, request.provider);
    const promotesLow = routing.tier === "low" && completedAi.length >= 1 &&
      request.workspaceHash !== completedAi.at(-1).workspaceHash;
    const maxAiAttempts = promotesLow ? 2 : Number(routing.maxAiAttempts || 2);
    // The route-aware cap still wins over malformed scope/base details.
    const history = assertReviewDispatchAllowed(
      id, reviewerType, maxAiAttempts);
    const deliveredAi = deliveredAiAttempts(id, history);
    if (deliveredAi.length > completedAi.length)
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
    if (reviewerType === "ai" && completedAi.length > 0) {
      const priorAi = completedAi.at(-1);
      if (priorAi?.reviewerType === "ai" &&
          priorAi.reviewerSessionId === reviewerSessionId)
        fail("AI delta closure requires a fresh reviewer session");
    }
    if (reviewerType === "ai" && providerConfig(id, request.provider)?.repository)
      fail("AI full-delta review requires one composite unscoped review provider; reconfigure the provider or split the change");
    const scopeMode = String(flags.scope || "").toLowerCase();
    if (!["full", "delta"].includes(scopeMode))
      fail("authority dispatch requires --scope full|delta");
    const baseAttemptDigest = String(flags["base-attempt"] || "").trim() || null;
    const currentManifest = Array.isArray(request.packet?.changedSurface?.manifest)
      ? request.packet.changedSurface.manifest : [];
    let scopeRows = currentManifest;
    let baseWorkspaceHash = null;
    let baseAttempt = null;
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
      scopeRows = currentManifest.filter((row) =>
        baseRows.get(`${row.repositoryId}/${row.path}`)?.identity !== row.identity);
      for (const [key, row] of baseRows)
        if (!currentRows.has(key)) scopeRows.push({ ...row, identity: "reverted-to-base" });
      scopeRows.sort((left, right) =>
        `${left.repositoryId}/${left.path}`.localeCompare(`${right.repositoryId}/${right.path}`));
      if (scopeRows.length === 0)
        fail("AI delta review has no files changed since the first AI dispatch; do not spend the second review round");
      baseWorkspaceHash = baseAttempt.workspaceHash;
    }
    const scopePaths = scopeRows.map((row) => `${row.repositoryId}/${row.path}`);
    const scopeDigest = stableHash({
      mode: scopeMode,
      baseAttemptDigest,
      baseWorkspaceHash,
      workspaceHash: request.workspaceHash,
      rows: scopeRows
    });
    const packet = JSON.parse(JSON.stringify(request.packet));
    packet.reviewScope = {
      mode: scopeMode,
      baseAttemptDigest,
      baseWorkspaceHash,
      workspaceHash: request.workspaceHash,
      paths: scopePaths,
      digest: scopeDigest
    };
    if (routing.tier === "high" && reviewerType === "human" && completedAi.length) {
      const baseAttempt = completedAi.at(-1);
      const closureFindings = (baseAttempt.findings || []).filter((finding) =>
        ["blocker", "major"].includes(finding.severity));
      packet.closureFindings = {
        baseAttemptDigest: baseAttempt.digest,
        ids: closureFindings.map((finding) => finding.id).sort(),
        findings: closureFindings
      };
    }
    if (scopeMode === "delta") {
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
      const changedContractNames = new Set(scopeRows
        .filter((row) => row.kind === "contract-artifact")
        .map((row) => row.relativePath));
      packet.contractArtifacts = Object.fromEntries(Object.entries(
        request.packet?.contractArtifacts || {}).filter(([name]) =>
        changedContractNames.has(name)));
      packet.decisions = Object.fromEntries(Object.entries(
        request.packet?.decisions || {}).filter(([, artifact]) =>
        artifact && changedContractNames.has(artifact.relativePath)));
      packet.grounding = changedContractNames.has("grounding.yaml")
        ? request.packet.grounding : null;
      packet.references = Object.fromEntries(Object.entries(
        request.packet?.references || {}).filter(([, artifact]) =>
        artifact && changedContractNames.has(artifact.relativePath)));
      if (!changedContractNames.has("evidence.yaml")) packet.claims = {
        reuseFromAttempt: baseAttemptDigest,
        digest: stableHash(request.packet?.claims || [])
      };
    }
    delete packet.packetDigest;
    packet.packetDigest = canonicalPacketDigest(packet);
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
      maxAiAttempts
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

  function abortAuthorityUnlocked(id, flags = {}) {
    const requestId = String(flags.request || "");
    const reason = String(flags.reason || "").trim();
    if (!requestId || !reason)
      fail("authority abort requires --request <id> --reason <text>");
    const entry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const request = entry.value;
    if (!["requested", "dispatched"].includes(request.status))
      fail(`authority request '${requestId}' is ${request.status}`);
    const updated = {
      ...request,
      status: request.status === "dispatched" ? "aborted" : "cancelled",
      abortedAt: now(),
      abortReason: reason
    };
    authorityStore.replace(entry, updated);
    console.log(JSON.stringify(updated, null, 2));
    return updated;
  }

  function abortAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => abortAuthorityUnlocked(id, flags));
  }

  function runAuthorityReviewerUnlocked(id, flags = {}) {
    const requestId = String(flags.request || "");
    if (!requestId) fail("authority run requires --request <id>");
    const reviewerName = String(flags.reviewer || "").trim() ||
      foundationPolicy().review.defaultReviewer;
    const configured = reviewerConfig(reviewerName);
    const subjectActor = String(flags["subject-actor"] || "").trim();
    if (!subjectActor) fail("authority run requires --subject-actor");
    const subjectSession = String(flags["subject-session"] || "").trim() || null;
    const subjectProvider = String(flags["subject-provider-family"] || "").trim().toLowerCase() || null;
    const subjectFamily = String(flags["subject-model-family"] || "").trim().toLowerCase() || null;
    const subjectModel = String(flags["subject-model"] || "").trim() || null;
    const aiSubject = [subjectSession, subjectProvider, subjectFamily, subjectModel]
      .some(Boolean);
    if (aiSubject && [subjectSession, subjectProvider, subjectFamily, subjectModel]
      .some((value) => !value))
      fail("AI implementation provenance requires subject session, provider family, model family, and model");
    const reviewSettings = foundationPolicy().review || {};
    const configuredProvider = String(configured.providerFamily).toLowerCase();
    const configuredFamily = String(configured.modelFamily).toLowerCase();
    const sameFamily = aiSubject && subjectProvider === configuredProvider &&
      subjectFamily === configuredFamily;
    if (sameFamily && reviewSettings.diversity !== "single-model")
      fail(`configured reviewer '${reviewerName}' shares the implementation provider/model family; choose a diverse configured reviewer or commit review.diversity='single-model' before Build`);
    if (aiSubject && reviewSettings.independence !== "self" &&
        subjectActor.toLowerCase() === configured.identity.toLowerCase())
      fail(`configured reviewer '${reviewerName}' shares the implementation identity; use a distinct reviewer identity/session or commit review.independence='self' before Build`);
    const requestEntry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    if (!requestEntry) fail(`unknown authority request '${requestId}'`);
    if (requestEntry.value.status === "dispatched")
      fail(`configured review dispatch '${requestId}' is indeterminate; do not rerun it automatically. Abort it with a reason, then request the next bounded route or pause`);
    const state = loadRuntime(id);
    const history = state.reviewHistory || {
      aiAttempts: 0, totalAttempts: 0, chainHead: null
    };
    const completedAi = recordedCompletedAiReviews(
      id, history, requestEntry.value.provider);
    const deliveredAi = reviewAttempts(id, history).filter((attempt) =>
      attempt.reviewerType === "ai" && attempt.status === "completed");
    if (deliveredAi.length > completedAi.length)
      fail("a completed AI response has no matching recorded receipt; repair that authority record or pause instead of starting another configured reviewer");
    const scope = completedAi.length === 0 ? "full" : "delta";
    const dispatched = dispatchAuthorityUnlocked(id, {
      request: requestId,
      scope,
      ...(scope === "delta" ? { "base-attempt": completedAi.at(-1).digest } : {}),
      "reviewer-type": "ai",
      "reviewer-identity": configured.identity,
      "reviewer-provider-family": configured.providerFamily,
      "reviewer-model-family": configured.modelFamily,
      "reviewer-model": configured.modelId,
      "reviewer-session-deferred": true
    });
    const workspace = loadRuntime(id).workspace?.path || root;
    const report = runConfiguredReview({
      changeId: id,
      reviewer: reviewerName,
      workspace,
      packet: dispatched.packet,
      forbiddenSessionIds: reviewSettings.independence === "self" ? [] : [
        subjectSession,
        ...(scope === "delta" ? [completedAi.at(-1)?.reviewerSessionId] : [])
      ].filter(Boolean)
    });
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
    const completed = completeReviewAttempt(id,
      dispatched.dispatch.attemptDigest, {
        reviewerSessionId: reviewerSession,
        resultStatus: report.status,
        findings: report.findings,
        verifiedFindingIds: report.verifiedFindingIds
      });
    const dispatchedEntry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    const finalizedRequest = {
      ...dispatchedEntry.value,
      dispatch: {
        ...dispatchedEntry.value.dispatch,
        attemptDigest: completed.digest,
        reviewer: {
          ...dispatchedEntry.value.dispatch.reviewer,
          sessionId: reviewerSession || null
        }
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
        reviewer: configured.identity,
        "reviewer-type": "ai",
        "reviewer-provider-family": configured.providerFamily,
        "reviewer-model-family": configured.modelFamily,
        "reviewer-model": configured.modelId,
        "reviewer-session": reviewerSession || null,
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
    recordAuthorityUnlocked(id, { request: requestId, response: responsePath });
    return report;
  }

  function runAuthorityReviewer(id, flags = {}) {
    return withAuthorityLock(id, () => runAuthorityReviewerUnlocked(id, flags));
  }

  function authorityStatusValue(id, requestId = null) {
    loadRuntime(id);
    const workspaceHash = relevantHash(id);
    // Scoped requests carry their own hash; status compares against the
    // composite for unscoped ones only.
    const result = authorityStore.status(id, workspaceHash, requestId,
      (request) => authorityWorkspaceHash(id, request.provider));
    if (!result.found) fail(`unknown authority request '${requestId}'`);
    return result.value;
  }

  // The response shape is a contract. Without a way to emit it, a responder
  // discovers it one rejection at a time while the person who gave the verdict
  // waits. The identity fields are prefilled because those are exactly the
  // ones `validateResponse` matches against the request.
  function responseTemplate(request) {
    // An acceptance packet carries its claims as a plain array; a review packet
    // compacts them past twelve into `{count, preview, digest}`. Only acceptance
    // reads `criterion`, but this ran before the type check, so `.map` on the
    // compact object threw for every review with more than twelve claims — the
    // template was unreachable for exactly the changes with the most to inspect.
    const claimRows = expandList(request.packet?.claims);
    const criteria = claimRows.map((claim) => claim.criterion).filter(Boolean);
    if (criteria.length && criteria.length < listCount(request.packet?.claims))
      criteria.push(`<${listCount(request.packet?.claims) - criteria.length
        } further criteria omitted from this preview; read the packet's claims>`);
    const evidence = {
      observed: "<what the responder actually saw, in their own words>",
      artifact: [],
      reference: ["<url or path the responder inspected>"]
    };
    if (request.type === "acceptance") {
      evidence.acceptor = "<name of the person who decided>";
      evidence.decision = "accept";
      evidence.criterion = criteria.length ? criteria
        : ["<criterion the responder confirmed>"];
    } else {
      // `validateResponse` forwards every key under `evidence` into the receipt
      // flags, so this is where a reviewer states provenance. Omitting these
      // fields from the template made the documented path a dead end: the
      // receipt refused the response for a missing `--subject-actor`, and
      // `authority record` does not accept that flag. Naming them here is the
      // difference between a template a responder can complete and one that
      // cannot be recorded at all.
      const dispatched = request.dispatch?.reviewer || null;
      evidence.reviewer = dispatched?.identity || "<independent reviewer identity>";
      evidence["reviewer-type"] = dispatched?.type || "human|ai";
      if (!dispatched || dispatched.type === "ai") {
        evidence["reviewer-provider-family"] = dispatched?.providerFamily || "<AI provider family>";
        evidence["reviewer-model-family"] = dispatched?.modelFamily || "<AI model family>";
        evidence["reviewer-model"] = dispatched?.modelId || "<AI model id>";
        evidence["reviewer-session"] = dispatched?.sessionId || "<AI review session>";
      }
      evidence["subject-actor"] = "<who or what implemented the change>";
      evidence["subject-session"] = "<implementation session id, omit for a human implementer>";
      evidence["subject-provider-family"] = "<implementation provider family, omit for a human implementer>";
      evidence["subject-model-family"] = "<implementation model family, omit for a human implementer>";
      evidence["subject-model"] = "<implementation model id, omit for a human implementer>";
      // Numbers, not placeholders, because the receipt parses them. A passing
      // review now has to state its blocker count rather than inherit a zero
      // from an absent flag, so the template is where the responder is asked
      // for it — the same lesson as the provenance fields above.
      evidence["unresolved-blockers"] = 0;
      evidence["verified-findings"] = 0;
      evidence.findings = [];
      evidence.verifiedFindingIds = request.packet?.closureFindings?.ids || [];
      if (request.dispatch?.scope?.mode === "delta")
        evidence["scope-path"] = request.dispatch.scope.paths;
    }
    return {
      version: Number(protocolVersion),
      requestId: request.requestId,
      changeId: request.changeId,
      type: request.type,
      workspaceHash: request.workspaceHash,
      status: "pass|fail|inconclusive|error",
      evidence
    };
  }

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

  function recordAuthorityUnlocked(id, flags = {}) {
    const requestId = String(flags.request || "");
    const responsePath = flags.response ? resolve(flags.response) : null;
    if (!requestId || !responsePath)
      fail("authority record requires --request <id> --response <file>");
    const entry = authorityStore.list(id).find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const effective = authorityStatusValue(id, requestId).requests[0];
    const request = effective || entry.value;
    if (request.status === "stale" ||
        request.workspaceHash !== authorityWorkspaceHash(id, request.provider))
      fail(`authority request '${requestId}' is stale — the workspace changed after it was issued; request review and acceptance last, after the workspace stops changing, then re-request: claude-foundation authority request ${id} --type ${request.type}`);
    if (!authorityStore.isOpen(request.status))
      fail(`authority request '${requestId}' is ${request.status}`);
    if (request.type === "review" && request.reviewCircuit === "full-delta" &&
        request.status !== "dispatched")
      fail(`authority request '${requestId}' must be dispatched before its response is recorded`);
    if (!existsSync(responsePath)) fail(`authority response not found: ${flags.response}`);
    const response = readJson(responsePath);
    const validated = authorityStore.validateResponse(response, request, id);
    if (!validated.valid) fail(validated.reason);
    const evidenceFlags = validated.evidence;
    if (request.type === "review" && request.dispatch) {
      const reviewer = request.dispatch.reviewer;
      const identity = String(evidenceFlags["reviewer-identity"] ||
        evidenceFlags.reviewer || "").trim();
      const comparisons = [
        ["reviewer identity", identity, reviewer.identity],
        ["reviewer type", String(evidenceFlags["reviewer-type"] || "").toLowerCase(), reviewer.type],
        ["reviewer provider family", String(evidenceFlags["reviewer-provider-family"] || "").toLowerCase() || null, reviewer.providerFamily],
        ["reviewer model family", String(evidenceFlags["reviewer-model-family"] || "").toLowerCase() || null, reviewer.modelFamily],
        ["reviewer model", String(evidenceFlags["reviewer-model"] || "") || null, reviewer.modelId],
        ["reviewer session", String(evidenceFlags["reviewer-session"] || "") || null, reviewer.sessionId]
      ];
      const mismatch = comparisons.filter(([, actual, expected]) => actual !== expected)
        .map(([label, actual, expected]) => `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      if (mismatch.length)
        fail(`authority response does not match its dispatched reviewer\n  ${mismatch.join("\n  ")}`);
      const suppliedScope = [...new Set(evidenceFlags["scope-path"] || [])].sort();
      const dispatchedScope = [...new Set(request.dispatch.scope.paths || [])].sort();
      if (suppliedScope.length && JSON.stringify(suppliedScope) !== JSON.stringify(dispatchedScope))
        fail("authority response scope-path must exactly match the paths in its dispatched delta packet");
      evidenceFlags["scope-path"] = dispatchedScope;
      const findings = Array.isArray(evidenceFlags.findings) ? evidenceFlags.findings : [];
      const verifiedFindingIds = Array.isArray(evidenceFlags.verifiedFindingIds)
        ? evidenceFlags.verifiedFindingIds : [];
      const unresolved = findings.filter((finding) =>
        ["blocker", "major"].includes(String(finding?.severity || "").toLowerCase()));
      if (Number(evidenceFlags["unresolved-blockers"] || 0) !== unresolved.length)
        fail("review unresolved-blockers must equal the blocker/major finding rows");
      if (request.packet?.closureFindings && response.status !== "error") {
        const expectedIds = [...(request.packet?.closureFindings?.ids || [])].sort();
        const suppliedIds = [...new Set(verifiedFindingIds.map((value) =>
          String(value).trim()).filter(Boolean))].sort();
        if (JSON.stringify(expectedIds) !== JSON.stringify(suppliedIds))
          fail("delta review verifiedFindingIds must exactly close the first-round finding IDs");
        const outside = request.dispatch.scope.mode === "delta" ? findings.filter((finding) => {
          const path = String(finding?.path || "").replace(/^\.\//, "");
          return !path || !dispatchedScope.some((candidate) =>
            candidate === path || candidate.endsWith(`/${path}`));
        }) : [];
        if (outside.length)
          fail("delta review findings must stay inside the dispatched correction paths");
      }
      const attempt = reviewAttemptByDigest(id, request.dispatch.attemptDigest);
      if (attempt?.status === "dispatched") {
        const completed = completeReviewAttempt(id, attempt.digest, {
          reviewerSessionId: reviewer.sessionId,
          resultStatus: response.status,
          findings,
          verifiedFindingIds
        });
        request.dispatch = {
          ...request.dispatch,
          attemptDigest: completed.digest,
          reviewer: { ...request.dispatch.reviewer, sessionId: completed.reviewerSessionId }
        };
        authorityStore.replace(entry, request);
      }
    }
    // A configured reviewer/tool failure is infrastructure telemetry, not a
    // delivered review verdict. Persist the completed error attempt and close
    // this request, but do not overwrite an earlier full/delta receipt or
    // manufacture a baseline receipt from an error. The bounded infrastructure
    // retry therefore starts full when no delivered baseline exists and keeps
    // a prior delivered baseline when a closure runner failed.
    if (request.type === "review" && response.status === "error") {
      authorityStore.replace(entry, {
        ...request,
        status: "error",
        infrastructureError: true,
        responseDigest: fileDigest(responsePath),
        receiptDigest: null,
        completedAt: now()
      });
      console.log(`AUTHORITY ${requestId}: infrastructure error\n  receipt: unchanged\n  next: repair the configured reviewer, run doctor --stage prove, then request the bounded retry`);
      return;
    }
    const priorPath = receiptPath(id, request.provider);
    const prior = existsSync(priorPath) ? readFileSync(priorPath) : null;
    recordReceipt(id, request.provider, response.status, {
      ...evidenceFlags,
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

  function recordAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => recordAuthorityUnlocked(id, flags));
  }

  function recordVerifiedCi(id, provider, source) {
    const config = providerConfig(id, provider);
    if (!config || config.adapter !== "external" || !config.ci?.publicKey || !config.ci?.issuer)
      fail(`provider '${provider}' requires external ci.issuer and ci.publicKey configuration`);
    const path = resolve(source || "");
    if (!source || !existsSync(path)) fail("evidence verify-ci requires a signed JSON envelope");
    const envelope = readJson(path);
    const workspaceHash = providerWorkspaceHash(id, provider);
    const repository = providerRepository(id, provider, config);
    const head = repository ? gitHead(repository.workspacePath) : gitHead(providerWorkspace(id, provider));
    const result = validateSignedCiEnvelope({
      envelope,
      protocolVersion: ciEvidenceProtocolVersion,
      issuer: config.ci.issuer,
      publicKey: config.ci.publicKey,
      changeId: id,
      provider,
      workspaceHash,
      head
    });
    if (!result.valid) fail(result.reason);
    const { payload, artifacts, status } = result;
    recordReceipt(id, provider, status, {
      claims: providerClaims(id, provider, config).join(","), workspaceHash,
      observed: String(payload.observed || `CI ${payload.status}; commit ${payload.commit || "unknown"}`),
      source: `signed-ci:${payload.issuer}`,
      reference: [payload.runUrl, ...artifacts.map((artifact) =>
        `artifact:${artifact.name}:sha256:${artifact.sha256}`)],
      "recorded-by": `evidence-verify-ci:${payload.issuer}`
    });
    console.log(`CI EVIDENCE ${id}/${provider}: ${status}\n  run: ${payload.runUrl}`);
  }

  return {
    authorityProvider,
    authorityPacket,
    requestAuthority,
    dispatchAuthority,
    runAuthorityReviewer,
    abortAuthority,
    authorityStatusValue,
    showAuthorityStatus,
    recordAuthority,
    recordVerifiedCi
  };
}
