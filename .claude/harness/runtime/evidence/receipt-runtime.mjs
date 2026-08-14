import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
  reserveReviewAttempt, reviewReceiptBinding, die
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
      const policy = reviewPolicy(id);
      const reviewerType = String(flags["reviewer-type"] ||
        (flags.reviewer ? "human" : "")).toLowerCase();
      if (!['ai', 'human'].includes(reviewerType))
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
      if (reviewerType === "ai" && [
        reviewer.providerFamily, reviewer.modelFamily, reviewer.modelId, reviewer.sessionId
      ].some((value) => !value))
        die("AI review requires reviewer provider/model family, model ID, and session");
      if (!subjects.length)
        die("review requires implementation provenance: --subject-actor on " +
          "'evidence record', or a \"subject-actor\" field under \"evidence\" in " +
          "the response file when recording through 'authority record', which " +
          "takes no provenance flags of its own");
      const provenance = reviewProvenanceResult({ reviewer, subjects });
      if (!provenance.complete)
        die("review requires complete structured reviewer and subject provenance");
      const { independent, diverse } = provenance;
      // `independent` stays the observed fact and is persisted as one below; the
      // policy only decides whether that fact blocks. Folding the waiver into
      // the predicate would make a self-review's own receipt claim an
      // independence it did not have, which is the record a later reader needs
      // most.
      if (!independent && policy.independence !== "self")
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
      const prior = existsSync(receiptPath(id, provider))
        ? readJson(receiptPath(id, provider), {}) : null;
      const scopePaths = [...new Set(flagValues(flags, "scope-path"))].sort();
      const history = reviewHistoryState(id);
      const nextAttempt = Number(history.totalAttempts || 0) + 1;
      if (nextAttempt >= 2 && reviewerType === "ai" && scopePaths.length === 0)
        die("AI review round 2 requires at least one --scope-path");
      receipt.reviewProtocolVersion = REVIEW_PROTOCOL_VERSION;
      receipt.review = {
        round: nextAttempt,
        reviewer,
        subjects,
        policy: { ...policy, independent, diverse },
        scope: {
          mode: nextAttempt === 1 || scopePaths.length === 0 ? "full" : "changed",
          paths: scopePaths,
          digest: stableHash({ priorWorkspaceHash: prior?.workspaceHash || null, workspaceHash, paths: scopePaths })
        },
        findings: {
          verified,
          unresolvedBlockers: blockers,
          reference: references[0] || null
        },
        supersedes: prior ? {
          receiptSha256: stableHash(prior),
          workspaceHash: prior.workspaceHash || null,
          finishedAt: prior.finishedAt || null,
          round: Number(prior?.review?.round || 0) || null
        } : null
      };
      const attempt = reserveReviewAttempt(id, reviewerType, {
        workspaceHash, status, reviewBinding: reviewReceiptBinding(receipt)
      });
      receipt.review.attemptDigest = attempt.digest;
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
    console.log(`RECEIPT ${id}/${provider}: ${status}`);
  }

  return { proofPlan, rebindReusableReceipt, recordReceipt };
}
