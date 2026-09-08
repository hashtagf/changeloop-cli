import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION,
  validateSemanticAcceptanceEnvelope
} from "./semantic-acceptance.mjs";

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

export function receiptBindingNote(context, id, provider, validity) {
  if (["missing", "valid"].includes(validity)) return null;
  const config = context.providerConfig(id, provider);
  const capability = context.providerCapability(provider, config);
  if (["review", "acceptance"].includes(capability))
    return `${capability} is bound to the change's diff and packet; ` +
      "a clean replay onto a moved base rebinds it without a new verdict";
  const declared = Array.isArray(config?.inputs) ? config.inputs : null;
  return declared
    ? `declared inputs: ${declared.join(", ")}${validity === "reusable-inputs"
      ? "; unchanged inputs will be rebound without re-execution" : ""}`
    : "whole-workspace binding; declare inputs to narrow it";
}

export function proofPlanOperation(context, id) {
  context.validate(id, "active", { quiet: true });
  const hash = context.relevantHash(id);
  const rows = [];
  for (const provider of context.requiredProviders(id))
    rows.push(context.receiptValidity(id, provider, hash));
  context.log(`PROOF PLAN ${id}\n  workspace: ${hash}`);
  for (const row of rows) {
    const note = receiptBindingNote(context, id, row.provider, row.validity);
    context.log(`  ${row.provider}: ${row.validity}${note ? ` (${note})` : ""}`);
  }
  // A capability the policy inferred from the diff but nothing wired is not
  // part of the plan — it cannot be executed and no receipt will satisfy it.
  // It is still printed, because "the policy saw a lockfile change and this
  // project has no supply-chain provider" is a fact the plan's reader needs,
  // and the alternative was inventing an unsatisfiable row for it.
  for (const advisory of context.advisoryCapabilities(id))
    context.log(`  advisory ${advisory.capability}: not blocking (inferred from ${
      advisory.trigger || "the changed surface"}; no provider wired)`);
}

export function rebindReusableReceiptOperation(context, id, row, snapshot, proofRunId) {
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
    startedAt: context.now(),
    finishedAt: context.now()
  };
  context.writeJson(context.receiptPath(id, row.provider), rebound);
  const logPath = join(context.LOGS, id, "reuse.jsonl");
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({
    version: 1,
    changeId: id,
    provider: row.provider,
    reason: "declared-inputs-unchanged",
    fromWorkspaceHash: prior.workspaceHash,
    toWorkspaceHash: row.expectedWorkspaceHash,
    inputFingerprint: row.expectedInputs.fingerprint,
    timestamp: context.now()
  })}\n`);
}

export function rebindDiffBoundReceiptOperation(context, id, row, snapshot, proofRunId) {
  const prior = row.receipt;
  const rebound = {
    ...prior,
    rebind: {
      ...prior.rebind,
      boundWorkspaceHash: row.expectedWorkspaceHash,
      boundSnapshotId: snapshot.id,
      boundAt: context.now(),
      reboundFrom: {
        workspaceHash: prior.rebind?.boundWorkspaceHash || prior.workspaceHash,
        proofRunId: prior.proofRunId || null
      }
    },
    proofRunId
  };
  context.writeJson(context.receiptPath(id, row.provider), rebound);
  const logPath = join(context.LOGS, id, "reuse.jsonl");
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({
    version: 1,
    changeId: id,
    provider: row.provider,
    reason: "diff-identity-unchanged",
    fromWorkspaceHash: prior.rebind?.boundWorkspaceHash || prior.workspaceHash,
    toWorkspaceHash: row.expectedWorkspaceHash,
    diffIdentity: prior.rebind?.diffIdentity || null,
    timestamp: context.now()
  })}\n`);
}

export function normalizedReviewFinding(finding) {
  return {
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
  };
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

export function deterministicReviewClosureSource(delivered) {
  const source = delivered.at(-1);
  return delivered.length >= 2 && source?.resultStatus === "fail" &&
    source.scope?.mode === "delta" ? source : null;
}

export function repairClosureBindingsComplete(blockers) {
  return blockers.length > 0 && blockers.every((finding) =>
    String(finding.path || "").trim() &&
    finding.claimIds?.length && finding.verificationCaseIds?.length);
}

export function currentRepairProviders(context, id, workspaceHash) {
  const current = context.requiredProviders(id)
    .filter((candidate) => {
      const capability = context.providerCapability(
        candidate, context.providerConfig(id, candidate));
      return capability !== "review" && capability !== "acceptance";
    })
    .map((candidate) => ({
      provider: candidate,
      config: context.providerConfig(id, candidate),
      validity: context.receiptValidity(id, candidate, workspaceHash)
    }));
  return {
    current,
    invalid: current.filter((row) => row.validity.validity !== "valid")
  };
}

export function repairClosureEvidenceBindings(context, id, blockers, current) {
  const bindings = [];
  for (const finding of blockers) {
    for (const claimId of finding.claimIds) {
      for (const caseId of finding.verificationCaseIds) {
        const row = current.find((candidate) =>
          context.claimsForProvider(id, candidate.provider)
            .some((claim) => claim.id === claimId) &&
          (candidate.config?.criticalCases || []).includes(caseId));
        if (!row)
          return {
            error: {
              closed: false,
              route: "AUTO_REPAIR",
              reason: `No current executable provider binds finding '${finding.id}' to claim '${claimId}' and critical case '${caseId}'.`,
              findingId: finding.id,
              claimId,
              caseId
            }
          };
        const evidencePath = context.receiptPath(id, row.provider);
        const evidenceReceipt = context.readJson(evidencePath, {});
        bindings.push({
          provider: row.provider,
          findingId: finding.id,
          claimId,
          caseId,
          bindingSource: finding.bindingSource,
          receiptDigest: context.stableHash(evidenceReceipt),
          receipt: context.relativeReceipt(evidencePath)
        });
      }
    }
  }
  return { bindings };
}

export function uniqueRepairEvidenceBindings(bindings) {
  return [...new Map(bindings.sort((left, right) =>
    `${left.provider}/${left.claimId}/${left.caseId}`.localeCompare(
      `${right.provider}/${right.claimId}/${right.caseId}`))
    .map((row) => [
      `${row.findingId}/${row.provider}/${row.claimId}/${row.caseId}`, row
    ])).values()];
}

export function deterministicClosureIsBound(context, id, prior, source) {
  const priorClosure = prior?.review?.repairClosure || null;
  const directlyBound = prior?.status === "fail" &&
    prior?.review?.attemptDigest === source.digest;
  const priorClosureAttempt = priorClosure && prior?.review?.attemptDigest
    ? context.reviewAttemptByDigest(id, prior.review.attemptDigest) : null;
  const closureBound = prior?.status === "pass" &&
    priorClosure?.sourceAttemptDigest === source.digest &&
    priorClosureAttempt && context.reviewAttemptIsValid(prior, priorClosureAttempt);
  return Boolean(directlyBound || closureBound);
}

export function deterministicRepairClosureValue({
  contractChanged, source, prior, priorClosure, currentContractFingerprint,
  approvedRevision, blockers, evidenceBindings
}) {
  return {
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
}

export function recordDeterministicReviewClosureOperation(
  context, id, provider, workspaceHash
) {
  const config = context.providerConfig(id, provider);
  if (context.providerCapability(provider, config) !== "review") return null;
  const source = deterministicReviewClosureSource(context.deliveredAiAttempts(id));
  if (!source) return null;
  const priorPath = context.receiptPath(id, provider);
  const prior = context.exists(priorPath) ? context.readJson(priorPath, {}) : null;
  const priorClosure = prior?.review?.repairClosure || null;
  if (!deterministicClosureIsBound(context, id, prior, source))
    return {
      closed: false,
      route: "CONTRACT_DECISION_REQUIRED",
      reason: "Neither the failed final AI delta nor a valid deterministic closure of it is currently bound to this change."
    };
  const currentContractFingerprint = context.contractFingerprint(id);
  const contractChanged = prior.contractFingerprint !== currentContractFingerprint;
  const approvedRevision = approvedGroundingRevision(
    context.loadRuntime(id), currentContractFingerprint);
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
    (finding) => groundedRepairBinding(context.groundingForReview(id), finding));
  if (!repairClosureBindingsComplete(blockers))
    return {
      closed: false,
      route: "AUTO_REPAIR",
      reason: "Final blocker/major findings must name a path, claimIds, and verificationCaseIds before deterministic closure is possible."
    };
  const { current, invalid: invalidProviders } = currentRepairProviders(context,
    id, workspaceHash);
  if (invalidProviders.length)
    return {
      closed: false,
      route: "AUTO_REPAIR",
      reason: "Current non-review proof is not yet valid for every required provider.",
      providers: invalidProviders.map((row) => ({
        provider: row.provider, validity: row.validity.validity
      }))
    };
  const bindingResult = repairClosureEvidenceBindings(
    context, id, blockers, current);
  if (bindingResult.error) return bindingResult.error;
  const evidenceBindings = uniqueRepairEvidenceBindings(bindingResult.bindings);
  const scopePaths = [...new Set(blockers.map((finding) => finding.path))].sort();
  const scopeDigest = context.stableHash({
    priorWorkspaceHash: prior.workspaceHash || null,
    workspaceHash,
    paths: scopePaths
  });
  const verifiedFindingIds = blockers.map((finding) => finding.id).sort();
  const attempt = context.recordRepairClosureAttempt(id, {
    sourceAttemptDigest: source.digest,
    workspaceHash,
    paths: scopePaths,
    scopeDigest,
    verifiedFindingIds,
    evidenceBindings
  });
  const repairClosure = deterministicRepairClosureValue({
    contractChanged, source, prior, priorClosure, currentContractFingerprint,
    approvedRevision, blockers, evidenceBindings
  });
  context.recordReceipt(id, provider, "pass", {
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

export function createReceiptRuntime({
  ROOT, LOGS, PROVIDERS, INPUT_MODES, providerWorkspace,
  ADAPTER_PROTOCOL_VERSION, PROVIDER_PROTOCOL_VERSION,
  REVIEW_PROTOCOL_VERSION, ACCEPTANCE_PROTOCOL_VERSION,
  validate, relevantHash, requiredProviders, advisoryCapabilities, receiptValidity, now,
  writeJson, receiptPath, providerConfig, providerCapability, loadRuntime,
  resolvedAcceptance, evidence, claimsForProvider, providerWorkspaceHash,
  providerRepository, rejectPrototypeEvidenceInputs, durableArtifact,
  providerRepositories = (id, provider, config) => {
    const repository = providerRepository(id, provider, config);
    return repository ? [repository] : [];
  },
  providerInputIdentity, contractFingerprint, executionFingerprint, stableHash,
  // Null identity means "not rebindable", so a composition that does not wire
  // these degrades to the pre-rebind behavior instead of failing to record.
  relevantSnapshot = () => null, changeDiffIdentity = () => null,
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
  const operationContext = {
    LOGS, providerConfig, providerCapability, validate, relevantHash,
    requiredProviders, receiptValidity, advisoryCapabilities, log: console.log,
    now, writeJson, receiptPath
  };
  const proofPlan = proofPlanOperation.bind(null, operationContext);
  const rebindReusableReceipt = rebindReusableReceiptOperation.bind(null, operationContext);
  const rebindDiffBoundReceipt = rebindDiffBoundReceiptOperation.bind(null, operationContext);

  function unresolvableReference(id, provider, reference) {
    if (REFERENCE_URI.test(reference)) return null;
    const workspace = providerWorkspace(id, provider);
    if ([ROOT, workspace].some((base) => existsSync(resolve(base, reference))))
      return null;
    return reference;
  }

  function receiptClaims(id, provider, flags) {
    const allClaims = evidence(id).claims.map((claim) => claim.id);
    const allowedClaims = claimsForProvider(id, provider).map((claim) => claim.id);
    const requestedClaims = String(
      !flags.claims || flags.claims === "declared" ? allowedClaims.join(",") : flags.claims
    ).split(",").filter(Boolean);
    if (requestedClaims.length === 0) die(`provider '${provider}' has no declared claims`);
    const unknownClaims = requestedClaims.filter((claim) => !allClaims.includes(claim));
    if (unknownClaims.length)
      die(`receipt references unknown claim(s): ${unknownClaims.join(", ")}`);
    const forbiddenClaims = requestedClaims.filter((claim) => !allowedClaims.includes(claim));
    if (forbiddenClaims.length)
      die(`provider '${provider}' is not declared for claim(s): ${forbiddenClaims.join(", ")}`);
    return requestedClaims;
  }

  function receiptForeground(flags) {
    const legacy = flags.foreground || null;
    const required = flags["foreground-required"] !== undefined
      ? flags["foreground-required"] === "yes" : legacy === "required";
    const available = flags["foreground-available"] !== undefined
      ? flags["foreground-available"] === "yes"
      : legacy === "available" || legacy === "not-required";
    if (legacy)
      console.error("WARNING: --foreground is deprecated; use --foreground-required and --foreground-available");
    return { required, available };
  }

  function validateReceiptAdapter(provider, status, flags, configured, harnessExecuted) {
    if (harnessExecuted) return;
    if (typeof flags.adapter === "string" && EXECUTING_ADAPTERS.has(flags.adapter))
      die(`--adapter ${flags.adapter} names an adapter the harness executes; ` +
        "a hand-recorded receipt cannot claim it. Run 'proof run <change>' instead");
    if (status === "pass" && EXECUTING_ADAPTERS.has(String(configured?.adapter || "")))
      die(`provider '${provider}' is configured for adapter '${configured.adapter}'; ` +
        "a passing receipt for it must come from an execution — run 'proof run <change>'");
  }

  function receiptTarget(id, provider, status) {
    const configured = providerConfig(id, provider);
    const capability = providerCapability(provider, configured);
    if (!capability || !PROVIDERS.has(capability)) die(`unknown provider '${provider}'`);
    if (!["pass", "fail", "inconclusive", "error"].includes(status))
      die(`invalid receipt status '${status}'`);
    const state = loadRuntime(id);
    if (capability === "acceptance" && !resolvedAcceptance(id, state, evidence(id)).required)
      die("acceptance evidence is not declared for this change");
    return { configured, capability, state };
  }

  function receiptExecutionContext(id, provider, status, flags, options) {
    const harnessExecuted = options.executed === true;
    const { configured, capability, state } = receiptTarget(id, provider, status);
    const config = flags.config || configured;
    const foreground = receiptForeground(flags);
    const adapter = flags.adapter || config?.adapter || "external";
    validateReceiptAdapter(provider, status, flags, configured, harnessExecuted);
    const proofRunId = flags.proofRunId || state.activeProofRun?.id ||
      `manual-${Date.now()}-${process.pid}`;
    return {
      harnessExecuted, configured, capability, state, config, adapter,
      requestedClaims: receiptClaims(id, provider, flags),
      command: flags.command || null,
      providerVersion: String(flags.version || config?.version || "1"),
      inputMode: flags["input-mode"] || config?.inputMode || null,
      foregroundRequired: foreground.required, foregroundAvailable: foreground.available,
      proofRunId,
      workspaceHash: flags.workspaceHash ||
        providerWorkspaceHash(id, provider, state.activeProofRun?.workspaceHash),
      repository: providerRepository(id, provider, config)
    };
  }

  function semanticAcceptanceReceiptInput(id, provider, status, flags) {
    const config = providerConfig(id, provider);
    if (providerCapability(provider, config) !== "semantic-acceptance") return flags;
    const source = String(flags.envelope || "").trim();
    if (!source || !existsSync(resolve(source)))
      die(`semantic-acceptance provider '${provider}' requires --envelope <signed-json>`);
    const workspaceHash = flags.workspaceHash || providerWorkspaceHash(id, provider);
    const result = validateSemanticAcceptanceEnvelope({
      envelope: readJson(resolve(source)), config, changeId: id, provider, workspaceHash
    });
    if (!result.valid) die(result.reason);
    if (result.status !== status)
      die(`semantic acceptance envelope status '${result.status}' does not match requested receipt status '${status}'`);
    const references = [
      ...(Array.isArray(flags.reference) ? flags.reference : flags.reference ? [flags.reference] : []),
      `semantic-verdict:sha256:${result.verdictDigest}`
    ];
    return {
      ...flags,
      workspaceHash,
      observed: `signed semantic acceptance ${result.status}; ${result.cases.length} case(s)`,
      source: `signed-oracle:${result.issuer}`,
      reference: references,
      semanticAcceptanceResult: result
    };
  }

  function receiptArtifactFlags(flags) {
    const artifactFlags = [
      ...(Array.isArray(flags.artifact) ? flags.artifact : []),
      ...(Array.isArray(flags.artifacts) ? flags.artifacts : []),
      ...(flags.log ? [{ path: flags.log, type: "command-log", required: true }] : [])
    ].flatMap((artifact) => typeof artifact === "string"
      ? artifact.split(",").filter(Boolean).map((path) => ({
        path, type: "external-evidence", required: true
      })) : [artifact]);
    return [...new Map(artifactFlags.map((artifact) => [
      `${artifact.type || "artifact"}:${artifact.path}`, artifact
    ])).values()];
  }

  function receiptProvenance(flags, capability) {
    let source = String(flags.source || flags.reviewer || flags.provenance ||
      (flags.command ? `command:${Array.isArray(flags.command)
        ? flags.command.join(" ") : flags.command}` : "")).trim();
    if (!source && capability === "review" && flags["reviewer-identity"])
      source = `reviewer:${String(flags["reviewer-identity"]).trim()}`;
    if (!source && capability === "acceptance" && flags.acceptor)
      source = `human:${String(flags.acceptor).trim()}`;
    return source;
  }

  function validateReceiptEvidence(provider, status, context, row) {
    if (!context.harnessExecuted && status === "pass") {
      const missing = [];
      if (!row.observed)
        missing.push("observed — flag --observed, or evidence.observed in the response file");
      if (!row.provenanceSource)
        missing.push("source — flag --source or --reviewer, or evidence.source in the response file");
      if (row.artifacts.length === 0 && row.references.length === 0)
        missing.push("artifact or reference — flag --artifact or --reference, " +
          "or evidence.artifact[] / evidence.reference[] in the response file");
      if (missing.length)
        die(`passing external receipt '${provider}' is missing:\n  ${missing.join("\n  ")}`);
    }
    if (context.harnessExecuted && status === "pass" &&
        !row.artifacts.some((artifact) => artifact.type === "command-log"))
      die(`executed receipt '${provider}' must carry its command log`);
  }

  function receiptEvidence(id, provider, status, flags, context) {
    const uniqueArtifactFlags = receiptArtifactFlags(flags);
    const references = (Array.isArray(flags.reference) ? flags.reference : [])
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim()).filter(Boolean);
    rejectPrototypeEvidenceInputs(id, provider, uniqueArtifactFlags, references);
    const unresolvable = references
      .map((reference) => unresolvableReference(id, provider, reference)).filter(Boolean);
    if (unresolvable.length)
      die("a reference must be a URI or a path that exists; these resolve to " +
        `nothing: ${unresolvable.join(", ")}`);
    const artifacts = uniqueArtifactFlags
      .map((artifact) => durableArtifact(id, provider, context.proofRunId, artifact));
    const row = {
      artifacts, references, observed: String(flags.observed || "").trim(),
      provenanceSource: receiptProvenance(flags, context.capability)
    };
    validateReceiptEvidence(provider, status, context, row);
    return row;
  }

  function receiptProviderFingerprint(id, provider, flags, context) {
    if (context.config) return adapterFingerprint(id, provider, context.config);
    return stableHash({
      adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
      providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
      provider, adapter: context.adapter, adapterVersion: context.providerVersion,
      command: context.command, claims: context.requestedClaims,
      environment: flags.environment || null, inputMode: context.inputMode,
      project: flags.project || null
    });
  }

  function receiptRebind(id, context) {
    if (!["review", "acceptance"].includes(context.capability)) return undefined;
    return {
      mode: "diff", diffIdentity: changeDiffIdentity(id, context.state),
      packetReviewHash: relevantSnapshot(id)?.packetReviewHash || null
    };
  }

  function receiptTimingAndExecution(flags, context) {
    const executionId = flags.commandExecutionId || flags.executionId || null;
    return {
      proofRunId: context.proofRunId, commandExecutionId: executionId, executionId,
      durationMs: flags.durationMs === undefined ? null : Number(flags.durationMs),
      startedAt: flags.started || now(), finishedAt: now()
    };
  }

  function normalizedCriticalCaseObservations(flags) {
    if (!Array.isArray(flags.criticalCases)) return [];
    return flags.criticalCases.map((row) => ({
      id: String(row?.id || "").trim(),
      status: String(row?.status || "").trim()
    })).filter((row) => row.id && ["pass", "fail", "skip", "todo"].includes(row.status))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function receiptLog(flags, artifacts) {
    return artifacts.find((artifact) => artifact.type === "command-log")?.path ||
      flags.log || null;
  }

  function baseReceipt(id, provider, status, flags, context, suppliedEvidence) {
    const { config, workspaceHash, requestedClaims } = context;
    const inputIdentity = providerInputIdentity(id, provider, config, workspaceHash);
    if (status === "pass" && inputIdentity.mode === "declared" && inputIdentity.files.length === 0)
      die(`passing receipt '${provider}' declared inputs but matched no files`);
    return {
      version: 7, changeId: id, provider, providerVersion: context.providerVersion,
      adapter: context.adapter, execution: context.harnessExecuted ? "harness" : "manual",
      repositoryId: context.repository?.id || null,
      repositoryIds: providerRepositories(id, provider, config).map((row) => row.id),
      adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
      providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
      contractFingerprint: contractFingerprint(id), executionFingerprint: executionFingerprint(id),
      providerFingerprint: receiptProviderFingerprint(id, provider, flags, context),
      workspaceHash, workspaceSnapshotId: context.state.activeProofRun?.snapshotId || null,
      inputIdentity,
      rebind: receiptRebind(id, context),
      claims: requestedClaims, status, observed: suppliedEvidence.observed,
      criticalCases: normalizedCriticalCaseObservations(flags),
      provenance: {
        source: suppliedEvidence.provenanceSource || null,
        recordedBy: String(flags["recorded-by"] || "").trim() || null
      },
      references: suppliedEvidence.references,
      capability: {
        inputMode: context.inputMode,
        foregroundRequired: context.foregroundRequired,
        foregroundAvailable: context.foregroundAvailable
      },
      command: context.command,
      log: receiptLog(flags, suppliedEvidence.artifacts),
      artifacts: suppliedEvidence.artifacts,
      environment: config ? environmentDescriptor(config, id) : (flags.environment || null),
      project: flags.project || config?.project || null,
      ...receiptTimingAndExecution(flags, context)
    };
  }

  function normalizedReviewer(flags) {
    const reviewerType = String(flags["reviewer-type"] ||
      (flags.reviewer ? "human" : "")).toLowerCase();
    const reviewerIdentity = String(flags["reviewer-identity"] || flags.reviewer || "").trim();
    return {
      type: reviewerType, identity: reviewerIdentity,
      providerFamily: String(flags["reviewer-provider-family"] || "").trim().toLowerCase() || null,
      modelFamily: String(flags["reviewer-model-family"] || "").trim().toLowerCase() || null,
      modelId: String(flags["reviewer-model"] || "").trim() || null,
      sessionId: String(flags["reviewer-session"] || "").trim() || null
    };
  }

  function validateReviewProvenance(status, reviewer, subjects, policy) {
    const infrastructureError = status === "error";
    if (reviewer.type === "ai" && [
      reviewer.providerFamily, reviewer.modelFamily, reviewer.modelId
    ].some((value) => !value))
      die("AI review requires reviewer provider/model family and model ID");
    if (reviewer.type === "ai" && !reviewer.sessionId && !infrastructureError)
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
    if (!infrastructureError && !provenance.independent && policy.independence !== "self")
      die("reviewer must use an identity and session independent of implementation");
    if (status === "pass" && policy.diversity === "required" && !provenance.diverse)
      die("review policy requires a different provider/model family or a human reviewer");
    return provenance;
  }

  function reviewIdentity(id, status, flags, options) {
    const reviewCircuit = options.reviewCircuit || foundationPolicy().workflow.reviewCircuit;
    const policy = reviewPolicy(id);
    const reviewer = normalizedReviewer(flags);
    const reviewerType = reviewer.type;
    const deterministicClosure = options.repairClosure || null;
    if (!["ai", "human"].includes(reviewerType) &&
        !(reviewerType === "deterministic" && deterministicClosure))
      die("review receipt requires --reviewer-type ai|human");
    if (!reviewer.identity) die("review receipt requires --reviewer-identity");
    const subjects = subjectProvenance(flags);
    const provenance = validateReviewProvenance(status, reviewer, subjects, policy);
    return {
      reviewCircuit, policy, reviewerType, deterministicClosure, reviewer, subjects,
      independent: provenance.independent, diverse: provenance.diverse
    };
  }

  function reviewFindings(status, flags) {
    if (status === "pass" && flags["unresolved-blockers"] === undefined)
      die("passing review requires --unresolved-blockers; state the count " +
        "explicitly rather than leaving it unstated");
    const blockers = Number(flags["unresolved-blockers"] || 0);
    const verified = Number(flags["verified-findings"] || 0);
    if (![blockers, verified].every((value) => Number.isInteger(value) && value >= 0))
      die("review finding counts must be non-negative integers");
    if (status === "pass" && blockers > 0)
      die("passing review cannot contain unresolved blockers");
    const findingRows = Array.isArray(flags.findings)
      ? flags.findings.map(normalizedReviewFinding) : [];
    if (findingRows.some((finding) => !finding.id || !finding.message ||
        !["blocker", "major", "minor"].includes(finding.severity)) ||
        new Set(findingRows.map((finding) => finding.id)).size !== findingRows.length)
      die("review findings must have unique IDs, blocker|major|minor severity, and messages");
    const unresolvedIds = findingRows.filter((finding) =>
      ["blocker", "major"].includes(finding.severity)).map((finding) => finding.id).sort();
    const suppliedIds = Array.isArray(flags.verifiedFindingIds) ? flags.verifiedFindingIds : [];
    const verifiedFindingIds = [...new Set(suppliedIds.map((value) =>
      String(value).trim()).filter(Boolean))].sort();
    return { blockers, verified, findingRows, unresolvedIds, verifiedFindingIds };
  }

  function dispatchedReviewScope(id, flags, identity) {
    const history = reviewHistoryState(id);
    const dispatched = identity.reviewCircuit === "full-delta"
      ? reviewAttemptByDigest(id, String(flags["review-attempt"] || "")) : null;
    if (identity.reviewCircuit === "full-delta" && !dispatched)
      die("review evidence requires an authority dispatch attempt; run 'authority dispatch' before recording it");
    return { history, dispatched };
  }

  function validateReviewScopeCounts(scopeMode, scopePaths, identity, findings) {
    const suppliedRows = findings.findingRows.length > 0 ||
      findings.verifiedFindingIds.length > 0 || scopeMode === "delta";
    const mismatchedCounts = findings.blockers !== findings.unresolvedIds.length ||
      findings.verified !== findings.verifiedFindingIds.length;
    if (suppliedRows && mismatchedCounts)
      die("review finding counts must equal the supplied finding and verifiedFindingIds rows");
    if (scopeMode === "delta" && identity.reviewerType === "ai" && scopePaths.length === 0)
      die("AI delta review requires at least one scope-path in the response evidence");
  }

  function reviewScope(id, provider, flags, identity, findings) {
    const prior = existsSync(receiptPath(id, provider))
      ? readJson(receiptPath(id, provider), {}) : null;
    const scopePaths = [...new Set(flagValues(flags, "scope-path"))].sort();
    const { history, dispatched } = dispatchedReviewScope(id, flags, identity);
    const nextAttempt = dispatched?.attempt || Number(history.totalAttempts || 0) + 1;
    const scopeMode = dispatched?.scope?.mode ||
      (nextAttempt === 1 || scopePaths.length === 0 ? "full" : "changed");
    validateReviewScopeCounts(scopeMode, scopePaths, identity, findings);
    return {
      prior, scopePaths, dispatched, nextAttempt, scopeMode,
      baseAttemptDigest: dispatched?.scope?.baseAttemptDigest || null
    };
  }

  function priorReviewBinding(prior) {
    if (!prior) return null;
    return {
      receiptSha256: stableHash(prior), workspaceHash: prior.workspaceHash || null,
      finishedAt: prior.finishedAt || null,
      round: Number(prior?.review?.round || 0) || null
    };
  }

  function reviewScopeBinding(scope, workspaceHash) {
    return {
      mode: scope.scopeMode, baseAttemptDigest: scope.baseAttemptDigest,
      paths: scope.scopePaths, dispatchDigest: scope.dispatched?.scope?.digest || null,
      digest: stableHash({
        priorWorkspaceHash: scope.prior?.workspaceHash || null,
        workspaceHash, paths: scope.scopePaths
      })
    };
  }

  function applyReviewReceipt(id, provider, status, flags, options, receipt, references) {
    const identity = reviewIdentity(id, status, flags, options);
    const findings = reviewFindings(status, flags);
    const scope = reviewScope(id, provider, flags, identity, findings);
    receipt.reviewProtocolVersion = REVIEW_PROTOCOL_VERSION;
    receipt.review = {
      round: scope.nextAttempt, requestId: scope.dispatched?.requestId || null,
      reviewer: identity.reviewer, subjects: identity.subjects,
      policy: {
        ...identity.policy, independent: identity.independent, diverse: identity.diverse
      },
      scope: reviewScopeBinding(scope, receipt.workspaceHash),
      packetDigest: scope.dispatched?.packetDigest || null,
      findings: {
        verified: findings.verified, unresolvedBlockers: findings.blockers,
        reference: references[0] || null, items: findings.findingRows,
        verifiedIds: findings.verifiedFindingIds, unresolvedIds: findings.unresolvedIds
      },
      supersedes: priorReviewBinding(scope.prior)
    };
    if (identity.deterministicClosure)
      receipt.review.repairClosure = identity.deterministicClosure;
    const attempt = scope.dispatched || reserveReviewAttempt(id, identity.reviewerType, {
      workspaceHash: receipt.workspaceHash, status, reviewBinding: reviewReceiptBinding(receipt)
    });
    receipt.review.attemptDigest = attempt.digest;
    if (!reviewAttemptIsValid(receipt, attempt))
      die("review evidence does not match its dispatched reviewer, workspace, request, or scope");
  }

  function applyAcceptanceReceipt(id, status, flags, receipt, context) {
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
      if (!receipt.observed)
        missing.push("observed — flag --observed, or evidence.observed in the response file");
      if (missing.length) die(`passing acceptance is missing:\n  ${missing.join("\n  ")}`);
    }
    receipt.provenance.source ||= acceptor ? `human:${acceptor}` : null;
    receipt.acceptanceProtocolVersion = ACCEPTANCE_PROTOCOL_VERSION;
    receipt.acceptance = {
      actor: { type: "human", identity: acceptor || null }, decision: decision || null,
      criteria, reason: resolvedAcceptance(id, context.state, evidence(id)).reason,
      subjectWorkspaceHash: context.workspaceHash
    };
  }

  function semanticSourceBindings(id, config) {
    return (config.acceptanceCases || []).flatMap((row) => {
      if (!row.sourceProvider) return [];
      const path = receiptPath(id, row.sourceProvider);
      if (!existsSync(path))
        die(`semantic acceptance case '${row.id}' requires current source receipt '${row.sourceProvider}'`);
      const source = readJson(path, {});
      const observation = (source.criticalCases || []).find((candidate) =>
        candidate.id === row.criticalCaseId);
      if (!observation || observation.status !== "pass")
        die(`semantic acceptance case '${row.id}' requires passing critical case '${row.criticalCaseId}' from '${row.sourceProvider}'`);
      return [{
        caseId: row.id,
        sourceProvider: row.sourceProvider,
        criticalCaseId: row.criticalCaseId,
        sourceReceiptDigest: stableHash(source),
        observation
      }];
    });
  }

  function applySemanticAcceptanceReceipt(id, flags, receipt, context) {
    const result = flags.semanticAcceptanceResult;
    if (!result) die("semantic acceptance receipt requires a verified signed envelope");
    receipt.semanticAcceptanceProtocolVersion = SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION;
    receipt.semanticAcceptance = {
      issuer: result.issuer,
      verdictDigest: result.verdictDigest,
      subjectWorkspaceHash: receipt.workspaceHash,
      cases: result.cases,
      sourceBindings: semanticSourceBindings(id, context.config),
      signedEnvelope: {
        version: SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION,
        payload: result.payload,
        signature: result.signature
      }
    };
  }

  function validateBrowserReceipt(status, receipt) {
    if (status !== "pass") return;
    if (receipt.capability.foregroundRequired && !receipt.capability.foregroundAvailable)
      die("browser cannot pass when required foreground input is unavailable");
    if (!INPUT_MODES.has(receipt.capability.inputMode))
      die("passing browser receipt requires --input-mode browser-automation|dom-event|os-input|both");
    const needsForeground = ["os-input", "both"].includes(receipt.capability.inputMode);
    if (needsForeground &&
        (!receipt.capability.foregroundRequired || !receipt.capability.foregroundAvailable))
      die("passing OS-input browser receipt requires foreground-required=yes and foreground-available=yes");
  }

  function applyDiscoveryReceipt(status, flags, receipt) {
    if (status !== "pass") return;
    const discovered = Number(flags.discovered);
    const minimum = Number(flags.minimum);
    if (!Number.isFinite(discovered) || !Number.isFinite(minimum) ||
        minimum <= 0 || discovered < minimum)
      die("passing discovery receipt requires --discovered N --minimum N with discovered >= minimum > 0");
    receipt.discovery = { discovered, minimum };
  }

  function applyMutationReceipt(status, flags, receipt) {
    if (status === "pass" &&
        !["behavioral-kill", "test-failure"].includes(flags.classification))
      die("passing mutation receipt requires --classification behavioral-kill|test-failure; crash is not a kill");
    receipt.classification = flags.classification || null;
  }

  function applyCapabilityReceipt(id, provider, status, flags, options, receipt, context) {
    if (context.capability === "review")
      applyReviewReceipt(id, provider, status, flags, options, receipt, receipt.references);
    if (context.capability === "acceptance")
      applyAcceptanceReceipt(id, status, flags, receipt, context);
    if (context.capability === "semantic-acceptance")
      applySemanticAcceptanceReceipt(id, flags, receipt, context);
    if (context.capability === "browser") validateBrowserReceipt(status, receipt);
    if (context.capability === "discovery") applyDiscoveryReceipt(status, flags, receipt);
    if (context.capability === "mutation") applyMutationReceipt(status, flags, receipt);
  }

  // `options` is deliberately not reachable from the command line: only a call
  // site inside this process — one that actually ran a command — may declare
  // an execution. Everything arriving over the CLI is a manual assertion and
  // owes the evidence floor below.
  function recordReceipt(id, provider, status, flags = {}, options = {}) {
    const preparedFlags = semanticAcceptanceReceiptInput(id, provider, status, flags);
    const context = receiptExecutionContext(id, provider, status, preparedFlags, options);
    const suppliedEvidence = receiptEvidence(id, provider, status, preparedFlags, context);
    const receipt = baseReceipt(id, provider, status, preparedFlags, context, suppliedEvidence);
    applyCapabilityReceipt(id, provider, status, preparedFlags, options, receipt, context);
    writeJson(receiptPath(id, provider), receipt);
    if (!options.quiet) console.log(`RECEIPT ${id}/${provider}: ${status}`);
  }

  const recordDeterministicReviewClosure =
    recordDeterministicReviewClosureOperation.bind(null, {
      providerConfig, providerCapability, deliveredAiAttempts, receiptPath,
      exists: existsSync, readJson, reviewAttemptByDigest, reviewAttemptIsValid,
      contractFingerprint, loadRuntime, groundingForReview, requiredProviders,
      receiptValidity, claimsForProvider, stableHash,
      relativeReceipt: (path) => relative(ROOT, path),
      recordRepairClosureAttempt, recordReceipt
    });

  return {
    proofPlan,
    rebindReusableReceipt,
    rebindDiffBoundReceipt,
    recordReceipt,
    recordDeterministicReviewClosure
  };
}
