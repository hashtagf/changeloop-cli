import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Adapters the harness itself executes. A receipt may only claim one of these
// when this process ran the command; naming one on the command line is a claim
// about execution that the caller is not in a position to make.
const EXECUTING_ADAPTERS = new Set([
  "command", "test-discovery", "playwright", "contract-digest"
]);

// A reference stands in for evidence, so it has to be something a reader can
// go and look at. Free text ("trust me bro") is not a reference. Accept a
// URI-shaped token with a scheme, or a path that exists in the workspace.
const REFERENCE_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/;

export function groundedRepairBinding(grounding, finding) {
  if (!grounding || grounding.version !== 2) return null;
  const rawPath = String(finding?.path || "")
    .replaceAll("\\", "/").replace(/^\.\//, "");
  if (!rawPath) return null;
  const repositoryIds = new Set((grounding.claims || []).flatMap((claim) =>
    [...(claim.productionPath || []), ...(claim.failurePaths || [])]
      .map((row) => row.repository || "root")));
  const separator = rawPath.indexOf("/");
  const prefix = separator > 0 ? rawPath.slice(0, separator) : "";
  const repository = repositoryIds.has(prefix) ? prefix : "root";
  const path = repository === prefix ? rawPath.slice(separator + 1) : rawPath;
  const claimIds = (grounding.claims || []).filter((claim) =>
    [...(claim.productionPath || []), ...(claim.failurePaths || [])].some((row) =>
      (row.repository || "root") === repository && row.path === path))
    .map((claim) => claim.id).filter(Boolean).sort();
  const claimSet = new Set(claimIds);
  const verificationCaseIds = (grounding.criticalCases || []).filter((row) =>
    (row.claimIds || []).some((claimId) => claimSet.has(claimId)))
    .map((row) => row.id).filter(Boolean).sort();
  return claimIds.length && verificationCaseIds.length
    ? { claimIds, verificationCaseIds, source: "grounding-v2-path" } : null;
}

export function repairClosureFindings(findings, resolveBinding = () => null) {
  return (findings || []).map((finding) => {
    const declaredClaims = [...new Set(finding.claimIds || [])].filter(Boolean).sort();
    const declaredCases = [...new Set(finding.verificationCaseIds || [])]
      .filter(Boolean).sort();
    if (declaredClaims.length && declaredCases.length)
      return {
        ...finding, claimIds: declaredClaims,
        verificationCaseIds: declaredCases, bindingSource: "reviewer"
      };
    const derived = resolveBinding(finding) || {};
    return {
      ...finding,
      claimIds: [...new Set(derived.claimIds || [])].filter(Boolean).sort(),
      verificationCaseIds: [...new Set(derived.verificationCaseIds || [])]
        .filter(Boolean).sort(),
      bindingSource: derived.source || null
    };
  });
}

export function approvedGroundingRevision(state, currentContractFingerprint) {
  return [...(state?.groundingReopens || [])].reverse().find((row) =>
    row.completedAt && row.newDigest === state.groundingDigest &&
    row.contractFingerprint === currentContractFingerprint) || null;
}

export function createReceiptRuntime({
  ROOT, LOGS, PROVIDERS, INPUT_MODES, providerWorkspace,
  ADAPTER_PROTOCOL_VERSION, PROVIDER_PROTOCOL_VERSION,
  REVIEW_PROTOCOL_VERSION, ACCEPTANCE_PROTOCOL_VERSION,
  validate, relevantHash, requiredProviders, advisoryCapabilities, receiptValidity, now,
  writeJson, receiptPath, providerConfig, providerCapability, loadRuntime,
  resolvedAcceptance, evidence, claimsForProvider, providerWorkspaceHash,
  providerRepository, rejectPrototypeEvidenceInputs, durableArtifact,
  providerInputIdentity, contractFingerprint, executionFingerprint, stableHash,
  adapterFingerprint, environmentDescriptor, reviewPolicy, subjectProvenance,
  reviewProvenanceResult, readJson, flagValues, reviewHistoryState,
  reserveReviewAttempt, reviewAttemptByDigest, reviewAttemptIsValid,
  reviewReceiptBinding, recordRepairClosureAttempt, deliveredAiAttempts,
  groundingForReview = () => null, foundationPolicy, die
}) {
  // What a provider is bound to decides what re-running proof will cost, and
  // the plan is where that is cheap to learn. `stale` alone told an operator to
  // pay again without saying that declaring `inputs` would have made the edit
  // free — a route the shipped reference mentioned in one sentence.
  function bindingNote(id, provider, validity) {
    if (["missing", "valid"].includes(validity)) return null;
    const config = providerConfig(id, provider);
    const capability = providerCapability(provider, config);
    if (["review", "acceptance"].includes(capability))
      return `${capability} is bound to the whole workspace by design`;
    const declared = Array.isArray(config?.inputs) ? config.inputs : null;
    return declared
      ? `declared inputs: ${declared.join(", ")}`
      : "whole-workspace binding; declare inputs to narrow it";
  }

  function proofPlan(id) {
    validate(id, "active", { quiet: true });
    const hash = relevantHash(id);
    const rows = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
    console.log(`PROOF PLAN ${id}\n  workspace: ${hash}`);
    for (const row of rows) {
      const note = bindingNote(id, row.provider, row.validity);
      console.log(`  ${row.provider}: ${row.validity}${note ? ` (${note})` : ""}`);
    }
    // A capability the policy inferred from the diff but nothing wired is not
    // part of the plan — it cannot be executed and no receipt will satisfy it.
    // It is still printed, because "the policy saw a lockfile change and this
    // project has no supply-chain provider" is a fact the plan's reader needs,
    // and the alternative was inventing an unsatisfiable row for it.
    for (const advisory of advisoryCapabilities(id))
      console.log(`  advisory ${advisory.capability}: not blocking (inferred from ${
        advisory.trigger || "the changed surface"}; no provider wired)`);
  }
  
  function rebindReusableReceipt(id, row, snapshot, proofRunId) {
    const prior = row.receipt;
    const rebound = {
      ...prior,
      workspaceHash: row.expectedWorkspaceHash,
      workspaceSnapshotId: snapshot.id,
      inputIdentity: row.expectedInputs,
      proofRunId,
      reusedFrom: {
        proofRunId: prior.proofRunId || null,
        workspaceHash: prior.workspaceHash,
        workspaceSnapshotId: prior.workspaceSnapshotId || null,
        receiptFinishedAt: prior.finishedAt || null
      },
      startedAt: now(),
      finishedAt: now()
    };
    writeJson(receiptPath(id, row.provider), rebound);
    const logPath = join(LOGS, id, "reuse.jsonl");
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify({
      version: 1,
      changeId: id,
      provider: row.provider,
      reason: "declared-inputs-unchanged",
      fromWorkspaceHash: prior.workspaceHash,
      toWorkspaceHash: row.expectedWorkspaceHash,
      inputFingerprint: row.expectedInputs.fingerprint,
      timestamp: now()
    })}\n`);
  }
  
  function unresolvableReference(id, provider, reference) {
    if (REFERENCE_URI.test(reference)) return null;
    const workspace = providerWorkspace(id, provider);
    if ([ROOT, workspace].some((base) => existsSync(resolve(base, reference))))
      return null;
    return reference;
  }

  // `options` is deliberately not reachable from the command line: only a call
  // site inside this process — one that actually ran a command — may declare
  // an execution. Everything arriving over the CLI is a manual assertion and
  // owes the evidence floor below.
  function recordReceipt(id, provider, status, flags = {}, options = {}) {
    const harnessExecuted = options.executed === true;
    const configured = providerConfig(id, provider);
    const capability = providerCapability(provider, configured);
    if (!capability || !PROVIDERS.has(capability)) die(`unknown provider '${provider}'`);
    if (!["pass", "fail", "inconclusive", "error"].includes(status)) die(`invalid receipt status '${status}'`);
    const state = loadRuntime(id);
    if (capability === "acceptance" && !resolvedAcceptance(id, state, evidence(id)).required)
      die("acceptance evidence is not declared for this change");
    const allClaims = evidence(id).claims.map((claim) => claim.id);
    const allowedClaims = claimsForProvider(id, provider).map((claim) => claim.id);
    const requestedClaims = String(
      !flags.claims || flags.claims === "declared" ? allowedClaims.join(",") : flags.claims
    ).split(",").filter(Boolean);
    if (requestedClaims.length === 0) die(`provider '${provider}' has no declared claims`);
    const unknownClaims = requestedClaims.filter((claim) => !allClaims.includes(claim));
    if (unknownClaims.length) die(`receipt references unknown claim(s): ${unknownClaims.join(", ")}`);
    const forbiddenClaims = requestedClaims.filter((claim) => !allowedClaims.includes(claim));
    if (forbiddenClaims.length)
      die(`provider '${provider}' is not declared for claim(s): ${forbiddenClaims.join(", ")}`);
    const config = flags.config || configured;
    const legacyForeground = flags.foreground || null;
    const foregroundRequired = flags["foreground-required"] !== undefined
      ? flags["foreground-required"] === "yes"
      : legacyForeground === "required";
    const foregroundAvailable = flags["foreground-available"] !== undefined
      ? flags["foreground-available"] === "yes"
      : legacyForeground === "available" || legacyForeground === "not-required";
    if (legacyForeground) console.error("WARNING: --foreground is deprecated; use --foreground-required and --foreground-available");
    const command = flags.command || null;
    const providerVersion = String(flags.version || config?.version || "1");
    const adapter = flags.adapter || config?.adapter || "external";
    if (!harnessExecuted) {
      if (typeof flags.adapter === "string" && EXECUTING_ADAPTERS.has(flags.adapter))
        die(`--adapter ${flags.adapter} names an adapter the harness executes; ` +
          "a hand-recorded receipt cannot claim it. Run 'proof run <change>' instead");
      if (status === "pass" && EXECUTING_ADAPTERS.has(String(configured?.adapter || "")))
        die(`provider '${provider}' is configured for adapter '${configured.adapter}'; ` +
          "a passing receipt for it must come from an execution — run 'proof run <change>'");
    }
    const inputMode = flags["input-mode"] || config?.inputMode || null;
    const proofRunId = flags.proofRunId || state.activeProofRun?.id ||
      `manual-${Date.now()}-${process.pid}`;
    // Through `providerWorkspaceHash`, not around it: the active run records
    // one hash for the whole run, and a provider scoped to a repository — or
    // bound to the code half — expects its own. Taking the run's value first
    // wrote a receipt that was stale the moment it existed.
    const workspaceHash = flags.workspaceHash ||
      providerWorkspaceHash(id, provider, state.activeProofRun?.workspaceHash);
    const repository = providerRepository(id, provider, config);
    const artifactFlags = [
      ...(Array.isArray(flags.artifact) ? flags.artifact : []),
      ...(Array.isArray(flags.artifacts) ? flags.artifacts : []),
      ...(flags.log ? [{
        path: flags.log, type: "command-log", required: true
      }] : [])
    ].flatMap((artifact) => typeof artifact === "string"
      ? artifact.split(",").filter(Boolean).map((path) => ({
        path, type: "external-evidence", required: true
      }))
      : [artifact]);
    const uniqueArtifactFlags = [...new Map(artifactFlags.map((artifact) => [
      `${artifact.type || "artifact"}:${artifact.path}`, artifact
    ])).values()];
    const references = (Array.isArray(flags.reference) ? flags.reference : [])
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim()).filter(Boolean);
    rejectPrototypeEvidenceInputs(id, provider, uniqueArtifactFlags, references);
    const unresolvable = references
      .map((reference) => unresolvableReference(id, provider, reference))
      .filter(Boolean);
    if (unresolvable.length)
      die("a reference must be a URI or a path that exists; these resolve to " +
        `nothing: ${unresolvable.join(", ")}`);
    const artifacts = uniqueArtifactFlags
      .map((artifact) => durableArtifact(id, provider, proofRunId, artifact));
    const observed = String(flags.observed || "").trim();
    let provenanceSource = String(
      flags.source || flags.reviewer || flags.provenance ||
      (flags.command ? `command:${Array.isArray(flags.command)
        ? flags.command.join(" ") : flags.command}` : "")
    ).trim();
    if (!provenanceSource && capability === "review" && flags["reviewer-identity"])
      provenanceSource = `reviewer:${String(flags["reviewer-identity"]).trim()}`;
    if (!provenanceSource && capability === "acceptance" && flags.acceptor)
      provenanceSource = `human:${String(flags.acceptor).trim()}`;
    // Report every missing requirement at once. Revealing them one per failure
    // costs a round trip each, and the person who gave the verdict is waiting.
    if (!harnessExecuted && status === "pass") {
      const missing = [];
      if (!observed)
        missing.push("observed — flag --observed, or evidence.observed in the response file");
      if (!provenanceSource)
        missing.push("source — flag --source or --reviewer, or evidence.source in the response file");
      if (artifacts.length === 0 && references.length === 0)
        missing.push("artifact or reference — flag --artifact or --reference, " +
          "or evidence.artifact[] / evidence.reference[] in the response file");
      if (missing.length)
        die(`passing external receipt '${provider}' is missing:\n  ${missing.join("\n  ")}`);
    }
    if (harnessExecuted && status === "pass" &&
        !artifacts.some((artifact) => artifact.type === "command-log"))
      die(`executed receipt '${provider}' must carry its command log`);
    const inputIdentity = providerInputIdentity(
      id, provider, config, workspaceHash
    );
    if (status === "pass" && inputIdentity.mode === "declared" &&
        inputIdentity.files.length === 0)
      die(`passing receipt '${provider}' declared inputs but matched no files`);
    const receipt = {
      version: 7, changeId: id, provider, providerVersion, adapter,
      // Who produced this: an execution the harness performed, or an assertion
      // somebody made. `adapter` cannot answer that — the caller supplies it.
      execution: harnessExecuted ? "harness" : "manual",
      repositoryId: repository?.id || null,
      adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
      providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
      contractFingerprint: contractFingerprint(id),
      executionFingerprint: executionFingerprint(id),
      providerFingerprint: config
        ? adapterFingerprint(id, provider, config)
        : stableHash({
          adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
          providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
          provider, adapter, adapterVersion: providerVersion,
          command, claims: requestedClaims,
          environment: flags.environment || null, inputMode,
          project: flags.project || null
        }),
      workspaceHash, workspaceSnapshotId: state.activeProofRun?.snapshotId || null,
      inputIdentity,
      claims: requestedClaims,
      status, observed, provenance: {
        source: provenanceSource || null,
        recordedBy: String(flags["recorded-by"] || "").trim() || null
      }, references, capability: {
        inputMode,
        foregroundRequired, foregroundAvailable
      },
      command,
      log: artifacts.find((artifact) => artifact.type === "command-log")?.path ||
        flags.log || null,
      artifacts,
      environment: config ? environmentDescriptor(config, id) : (flags.environment || null),
      project: flags.project || config?.project || null,
      proofRunId,
      commandExecutionId: flags.commandExecutionId || flags.executionId || null,
      executionId: flags.commandExecutionId || flags.executionId || null,
      durationMs: flags.durationMs === undefined ? null : Number(flags.durationMs),
      startedAt: flags.started || now(), finishedAt: now()
    };
    if (capability === "review") {
      // Internal callers may grandfather a request created before the dispatch
      // protocol existed. CLI flags cannot select this option, so a new review
      // cannot downgrade itself to the legacy reserve-on-record behavior.
      const reviewCircuit = options.reviewCircuit ||
        foundationPolicy().workflow.reviewCircuit;
      const policy = reviewPolicy(id);
      const reviewerType = String(flags["reviewer-type"] ||
        (flags.reviewer ? "human" : "")).toLowerCase();
      const deterministicClosure = options.repairClosure || null;
      if (!['ai', 'human'].includes(reviewerType) &&
          !(reviewerType === "deterministic" && deterministicClosure))
        die("review receipt requires --reviewer-type ai|human");
      const reviewerIdentity = String(
        flags["reviewer-identity"] || flags.reviewer || ""
      ).trim();
      if (!reviewerIdentity) die("review receipt requires --reviewer-identity");
      const reviewer = {
        type: reviewerType,
        identity: reviewerIdentity,
        providerFamily: String(flags["reviewer-provider-family"] || "").trim().toLowerCase() || null,
        modelFamily: String(flags["reviewer-model-family"] || "").trim().toLowerCase() || null,
        modelId: String(flags["reviewer-model"] || "").trim() || null,
        sessionId: String(flags["reviewer-session"] || "").trim() || null
      };
      const subjects = subjectProvenance(flags);
      const infrastructureError = status === "error";
      if (reviewerType === "ai" && [
        reviewer.providerFamily, reviewer.modelFamily, reviewer.modelId
      ].some((value) => !value))
        die("AI review requires reviewer provider/model family and model ID");
      if (reviewerType === "ai" && !reviewer.sessionId && !infrastructureError)
        die("AI review requires the actual reviewer session unless the recorded status is an infrastructure error");
      if (!subjects.length)
        die("review requires implementation provenance: --subject-actor on " +
          "'evidence record', or a \"subject-actor\" field under \"evidence\" in " +
          "the response file when recording through 'authority record', which " +
          "takes no provenance flags of its own");
      const provenance = reviewProvenanceResult({ reviewer, subjects }, {
        allowMissingAiSession: infrastructureError
      });
      if (!provenance.complete)
        die("review requires complete structured reviewer and subject provenance");
      const { independent, diverse } = provenance;
      // `independent` stays the observed fact and is persisted as one below; the
      // policy only decides whether that fact blocks. Folding the waiver into
      // the predicate would make a self-review's own receipt claim an
      // independence it did not have, which is the record a later reader needs
      // most.
      if (!infrastructureError && !independent && policy.independence !== "self")
        die("reviewer must use an identity and session independent of implementation");
      if (status === "pass" && policy.diversity === "required" && !diverse)
        die("review policy requires a different provider/model family or a human reviewer");
      // A passing review asserts there is nothing left to resolve, so the count
      // has to be stated rather than defaulted. `Number(undefined || 0)` is 0,
      // which made "nobody counted" and "counted zero" identical on the one
      // gate whose job is to stop an unresolved blocker from reaching Land.
      if (status === "pass" && flags["unresolved-blockers"] === undefined)
        die("passing review requires --unresolved-blockers; state the count " +
          "explicitly rather than leaving it unstated");
      const blockers = Number(flags["unresolved-blockers"] || 0);
      const verified = Number(flags["verified-findings"] || 0);
      if (![blockers, verified].every((value) => Number.isInteger(value) && value >= 0))
        die("review finding counts must be non-negative integers");
      if (status === "pass" && blockers > 0)
        die("passing review cannot contain unresolved blockers");
      const findingRows = Array.isArray(flags.findings) ? flags.findings.map((finding) => ({
        id: String(finding?.id || "").trim(),
        severity: String(finding?.severity || "").toLowerCase(),
        path: String(finding?.path || ""),
        line: finding?.line === null || finding?.line === undefined
          ? null : Number(finding.line),
        message: String(finding?.message || "").trim(),
        claimIds: [...new Set((finding?.claimIds || []).map((value) =>
          String(value).trim()).filter(Boolean))].sort(),
        verificationCaseIds: [...new Set((finding?.verificationCaseIds || [])
          .map((value) => String(value).trim()).filter(Boolean))].sort()
      })) : [];
      if (findingRows.some((finding) => !finding.id || !finding.message ||
          !["blocker", "major", "minor"].includes(finding.severity)) ||
          new Set(findingRows.map((finding) => finding.id)).size !== findingRows.length)
        die("review findings must have unique IDs, blocker|major|minor severity, and messages");
      const unresolvedIds = findingRows.filter((finding) =>
        ["blocker", "major"].includes(finding.severity)).map((finding) => finding.id).sort();
      const verifiedFindingIds = [...new Set((Array.isArray(flags.verifiedFindingIds)
        ? flags.verifiedFindingIds : []).map((value) => String(value).trim())
        .filter(Boolean))].sort();
      const prior = existsSync(receiptPath(id, provider))
        ? readJson(receiptPath(id, provider), {}) : null;
      const scopePaths = [...new Set(flagValues(flags, "scope-path"))].sort();
      const history = reviewHistoryState(id);
      const dispatched = reviewCircuit === "full-delta"
        ? reviewAttemptByDigest(id, String(flags["review-attempt"] || ""))
        : null;
      if (reviewCircuit === "full-delta" && !dispatched)
        die("review evidence requires an authority dispatch attempt; run 'authority dispatch' before recording it");
      const nextAttempt = dispatched?.attempt || Number(history.totalAttempts || 0) + 1;
      const scopeMode = dispatched?.scope?.mode ||
        (nextAttempt === 1 || scopePaths.length === 0 ? "full" : "changed");
      const baseAttemptDigest = dispatched?.scope?.baseAttemptDigest || null;
      if ((findingRows.length > 0 || verifiedFindingIds.length > 0 ||
          scopeMode === "delta") &&
          (blockers !== unresolvedIds.length || verified !== verifiedFindingIds.length))
        die("review finding counts must equal the supplied finding and verifiedFindingIds rows");
      if (scopeMode === "delta" && reviewerType === "ai" && scopePaths.length === 0)
        die("AI delta review requires at least one scope-path in the response evidence");
      receipt.reviewProtocolVersion = REVIEW_PROTOCOL_VERSION;
      receipt.review = {
        round: nextAttempt,
        requestId: dispatched?.requestId || null,
        reviewer,
        subjects,
        policy: { ...policy, independent, diverse },
        scope: {
          mode: scopeMode,
          baseAttemptDigest,
          paths: scopePaths,
          dispatchDigest: dispatched?.scope?.digest || null,
          digest: stableHash({ priorWorkspaceHash: prior?.workspaceHash || null, workspaceHash, paths: scopePaths })
        },
        packetDigest: dispatched?.packetDigest || null,
        findings: {
          verified,
          unresolvedBlockers: blockers,
          reference: references[0] || null,
          items: findingRows,
          verifiedIds: verifiedFindingIds,
          unresolvedIds
        },
        supersedes: prior ? {
          receiptSha256: stableHash(prior),
          workspaceHash: prior.workspaceHash || null,
          finishedAt: prior.finishedAt || null,
          round: Number(prior?.review?.round || 0) || null
        } : null
      };
      if (deterministicClosure) receipt.review.repairClosure = deterministicClosure;
      const attempt = dispatched || reserveReviewAttempt(id, reviewerType, {
        workspaceHash, status, reviewBinding: reviewReceiptBinding(receipt)
      });
      receipt.review.attemptDigest = attempt.digest;
      if (!reviewAttemptIsValid(receipt, attempt))
        die("review evidence does not match its dispatched reviewer, workspace, request, or scope");
    }
    if (capability === "acceptance") {
      const acceptor = String(flags.acceptor || "").trim();
      const criteria = flagValues(flags, "criterion").map((value) => String(value).trim());
      const decision = String(flags.decision || "").trim().toLowerCase();
      if (status === "pass") {
        const missing = [];
        if (!acceptor)
          missing.push("acceptor — flag --acceptor, or evidence.acceptor in the response file");
        if (decision !== "accept")
          missing.push("decision 'accept' — flag --decision accept, " +
            "or evidence.decision in the response file");
        if (criteria.length === 0 || criteria.some((criterion) => !criterion))
          missing.push("at least one non-empty criterion — flag --criterion (repeatable), " +
            "or evidence.criterion[] in the response file");
        else if (new Set(criteria).size !== criteria.length)
          missing.push("criteria must be unique — flag --criterion (repeatable), " +
            "or evidence.criterion[] in the response file");
        if (!observed)
          missing.push("observed — flag --observed, or evidence.observed in the response file");
        if (missing.length)
          die(`passing acceptance is missing:\n  ${missing.join("\n  ")}`);
      }
      provenanceSource ||= acceptor ? `human:${acceptor}` : "";
      receipt.provenance.source = provenanceSource || null;
      receipt.acceptanceProtocolVersion = ACCEPTANCE_PROTOCOL_VERSION;
      receipt.acceptance = {
        actor: { type: "human", identity: acceptor || null },
        decision: decision || null,
        criteria,
        reason: resolvedAcceptance(id, state, evidence(id)).reason,
        subjectWorkspaceHash: workspaceHash
      };
    }
    if (capability === "browser" && status === "pass" && receipt.capability.foregroundRequired &&
        !receipt.capability.foregroundAvailable) die("browser cannot pass when required foreground input is unavailable");
    if (capability === "browser" && status === "pass" &&
        !INPUT_MODES.has(receipt.capability.inputMode))
      die("passing browser receipt requires --input-mode browser-automation|dom-event|os-input|both");
    if (capability === "browser" && status === "pass" &&
        ["os-input", "both"].includes(receipt.capability.inputMode) &&
        (!receipt.capability.foregroundRequired || !receipt.capability.foregroundAvailable))
      die("passing OS-input browser receipt requires foreground-required=yes and foreground-available=yes");
    if (capability === "discovery" && status === "pass") {
      const discovered = Number(flags.discovered);
      const minimum = Number(flags.minimum);
      if (!Number.isFinite(discovered) || !Number.isFinite(minimum) || minimum <= 0 || discovered < minimum)
        die("passing discovery receipt requires --discovered N --minimum N with discovered >= minimum > 0");
      receipt.discovery = { discovered, minimum };
    }
    if (capability === "mutation" && status === "pass" &&
        !["behavioral-kill", "test-failure"].includes(flags.classification))
      die("passing mutation receipt requires --classification behavioral-kill|test-failure; crash is not a kill");
    if (capability === "mutation") receipt.classification = flags.classification || null;
    writeJson(receiptPath(id, provider), receipt);
    if (!options.quiet) console.log(`RECEIPT ${id}/${provider}: ${status}`);
  }

  function recordDeterministicReviewClosure(id, provider, workspaceHash) {
    const config = providerConfig(id, provider);
    if (providerCapability(provider, config) !== "review") return null;
    const delivered = deliveredAiAttempts(id);
    const source = delivered.at(-1);
    if (delivered.length < 2 || source?.resultStatus !== "fail" ||
        source.scope?.mode !== "delta") return null;
    const priorPath = receiptPath(id, provider);
    const prior = existsSync(priorPath) ? readJson(priorPath, {}) : null;
    const priorClosure = prior?.review?.repairClosure || null;
    const directlyBound = prior?.status === "fail" &&
      prior?.review?.attemptDigest === source.digest;
    const priorClosureAttempt = priorClosure && prior?.review?.attemptDigest
      ? reviewAttemptByDigest(id, prior.review.attemptDigest) : null;
    const closureBound = prior?.status === "pass" &&
      priorClosure?.sourceAttemptDigest === source.digest &&
      priorClosureAttempt && reviewAttemptIsValid(prior, priorClosureAttempt);
    if (!directlyBound && !closureBound)
      return {
        closed: false,
        route: "CONTRACT_DECISION_REQUIRED",
        reason: "Neither the failed final AI delta nor a valid deterministic closure of it is currently bound to this change."
      };
    const currentContractFingerprint = contractFingerprint(id);
    const contractChanged = prior.contractFingerprint !== currentContractFingerprint;
    const state = loadRuntime(id);
    const approvedRevision = approvedGroundingRevision(
      state, currentContractFingerprint);
    if (contractChanged && !approvedRevision)
      return {
        closed: false,
        route: "CONTRACT_DECISION_REQUIRED",
        reason: "The agreement changed after the final AI delta without a completed locked Decision Sheet revision."
      };
    if (source.workspaceHash === workspaceHash)
      return {
        closed: false,
        route: "AUTO_REPAIR",
        reason: "The final AI delta still describes the current workspace; repair its blocker/major findings before advancing."
      };
    const blockers = repairClosureFindings(
      (source.findings || []).filter((finding) =>
        ["blocker", "major"].includes(finding.severity)),
      (finding) => groundedRepairBinding(groundingForReview(id), finding));
    if (!blockers.length || blockers.some((finding) =>
      !String(finding.path || "").trim() ||
      !finding.claimIds?.length || !finding.verificationCaseIds?.length))
      return {
        closed: false,
        route: "AUTO_REPAIR",
        reason: "Final blocker/major findings must name a path, claimIds, and verificationCaseIds before deterministic closure is possible."
      };

    const currentProviders = requiredProviders(id).filter((candidate) => {
      const capability = providerCapability(candidate, providerConfig(id, candidate));
      return capability !== "review" && capability !== "acceptance";
    });
    const current = currentProviders.map((candidate) => ({
      provider: candidate,
      config: providerConfig(id, candidate),
      validity: receiptValidity(id, candidate, workspaceHash)
    }));
    const invalidProviders = current.filter((row) => row.validity.validity !== "valid");
    if (invalidProviders.length)
      return {
        closed: false,
        route: "AUTO_REPAIR",
        reason: "Current non-review proof is not yet valid for every required provider.",
        providers: invalidProviders.map((row) => ({
          provider: row.provider, validity: row.validity.validity
        }))
      };

    const bindings = [];
    for (const finding of blockers) {
      for (const claimId of finding.claimIds) {
        for (const caseId of finding.verificationCaseIds) {
          const row = current.find((candidate) =>
            claimsForProvider(id, candidate.provider).some((claim) => claim.id === claimId) &&
            (candidate.config?.criticalCases || []).includes(caseId));
          if (!row)
            return {
              closed: false,
              route: "AUTO_REPAIR",
              reason: `No current executable provider binds finding '${finding.id}' to claim '${claimId}' and critical case '${caseId}'.`,
              findingId: finding.id,
              claimId,
              caseId
            };
          const evidencePath = receiptPath(id, row.provider);
          const evidenceReceipt = readJson(evidencePath, {});
          bindings.push({
            provider: row.provider,
            findingId: finding.id,
            claimId,
            caseId,
            bindingSource: finding.bindingSource,
            receiptDigest: stableHash(evidenceReceipt),
            receipt: relative(ROOT, evidencePath)
          });
        }
      }
    }
    const evidenceBindings = [...new Map(bindings.sort((left, right) =>
      `${left.provider}/${left.claimId}/${left.caseId}`.localeCompare(
        `${right.provider}/${right.claimId}/${right.caseId}`))
      .map((row) => [`${row.findingId}/${row.provider}/${row.claimId}/${row.caseId}`, row])).values()];
    const scopePaths = [...new Set(blockers.map((finding) => finding.path))].sort();
    const scopeDigest = stableHash({
      priorWorkspaceHash: prior.workspaceHash || null,
      workspaceHash,
      paths: scopePaths
    });
    const verifiedFindingIds = blockers.map((finding) => finding.id).sort();
    const attempt = recordRepairClosureAttempt(id, {
      sourceAttemptDigest: source.digest,
      workspaceHash,
      paths: scopePaths,
      scopeDigest,
      verifiedFindingIds,
      evidenceBindings
    });
    const repairClosure = {
      version: 1,
      kind: contractChanged
        ? "deterministic-after-approved-contract-revision"
        : "deterministic-after-bounded-ai",
      sourceAttemptDigest: source.digest,
      sourceWorkspaceHash: source.workspaceHash,
      sourceContractFingerprint: priorClosure?.sourceContractFingerprint ||
        prior.contractFingerprint,
      contractFingerprint: currentContractFingerprint,
      ...(approvedRevision ? {
        approvedRevision: {
          decisionRef: approvedRevision.decisionRef,
          reason: approvedRevision.reason,
          priorDigest: approvedRevision.priorDigest,
          newDigest: approvedRevision.newDigest,
          completedAt: approvedRevision.completedAt
        }
      } : {}),
      findingBindings: blockers.map((finding) => ({
        findingId: finding.id,
        source: finding.bindingSource,
        claimIds: finding.claimIds,
        verificationCaseIds: finding.verificationCaseIds
      })),
      evidenceBindings
    };
    recordReceipt(id, provider, "pass", {
      claims: "declared",
      workspaceHash,
      observed: `closed final AI finding IDs ${verifiedFindingIds.join(", ")} with current declared critical-case evidence`,
      source: `foundation-repair-closure:${source.digest}`,
      reference: evidenceBindings.map((row) => row.receipt),
      "reviewer-type": "deterministic",
      "reviewer-identity": "foundation-repair-closure",
      "subject-provenance": (prior.review.subjects || []).map((subject) =>
        JSON.stringify(subject)),
      "unresolved-blockers": 0,
      "verified-findings": verifiedFindingIds.length,
      findings: [],
      verifiedFindingIds,
      "scope-path": scopePaths,
      "review-attempt": attempt.digest
    }, { repairClosure, quiet: true });
    return {
      closed: true,
      provider,
      sourceAttemptDigest: source.digest,
      attemptDigest: attempt.digest,
      findingIds: verifiedFindingIds,
      evidenceBindings
    };
  }

  return {
    proofPlan,
    rebindReusableReceipt,
    recordReceipt,
    recordDeterministicReviewClosure
  };
}
