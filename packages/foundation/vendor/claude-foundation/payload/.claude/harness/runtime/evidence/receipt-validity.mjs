import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION,
  validateSemanticAcceptanceEnvelope
} from "./semantic-acceptance.mjs";

// A validity code names what is wrong with a receipt and nothing about how to
// fix it, so every caller that stopped on one printed a code and left. These
// are the routes out, kept beside the codes they answer so the two cannot drift
// apart. Anything unlisted falls back to re-running proof, which is correct for
// every staleness class.
const VALIDITY_RECOVERY = {
  missing: (id) => `no evidence has been executed for this workspace; run: claude-foundation proof run ${id}`,
  // The one gate class that had no named exit: a provider that ran and failed.
  // "Re-run" is correct when the gate caught a real defect and useless when
  // the gate itself is wrong, so all three honest exits are stated. There is
  // deliberately no route that lands a failing proof.
  fail: (id, provider) => `provider '${provider}' executed and failed. Fix the cause and re-run: claude-foundation proof run ${id}. If the gate itself is wrong, rewire it in openspec/changes/${id}/execution.yaml. If the user decides to land without it, withdraw it on record: claude-foundation change waive ${id} --capability <capability> --reason <why> --decision-ref <ref>`,
  stale: (id) => `the workspace moved after this receipt was earned; re-run: claude-foundation proof run ${id}. A provider that declares "inputs" in its config keeps its receipt when the edit falls outside them, and a review or acceptance verdict rebinds automatically when the change's diff and packet are unchanged on the moved base`,
  "reusable-diff": (id) => `the change's diff and packet are unchanged on the moved base, so the verdict rebinds without a new review; run: claude-foundation proof run ${id}`,
  "provider-inputs-stale": (id) => `the provider's declared inputs changed; re-run: claude-foundation proof run ${id}`,
  "contract-stale": (id) => `evidence.yaml changed after this receipt; re-run: claude-foundation proof run ${id}`,
  "provider-fingerprint-stale": (id) => `the provider's execution.yaml wiring changed; re-run: claude-foundation proof run ${id}`,
  "incomplete-claims": (id, provider) => `provider '${provider}' did not cover every claim declared for it; check its claim list in execution.yaml, then re-run: claude-foundation proof run ${id}`,
  "review-not-independent": () => "the reviewer shares an identity or session with the implementation. Use a fresh configured reviewer; same-family Codex-only or Claude-Code-only review needs only review.diversity='single-model'. Set review.independence='self' only for a deliberate same-identity/session waiver, which is recorded on the receipt",
  "review-not-diverse": () => "the reviewer shares a provider and model family with the implementation. Use a human or a different model family, or set \"review\": {\"diversity\": \"single-model\"} in foundation.json",
  "review-blockers": (id) => `the review recorded unresolved blockers; resolve them, then request a new review: claude-foundation authority request ${id} --type review`,
  "review-repair-evidence-stale": (id) => `the deterministic final-review closure no longer matches its current critical-case evidence; run: claude-foundation proof advance ${id}`,
  "acceptance-invalid": (id) => `acceptance needs a named human, an "accept" decision, and criteria matching the current scope. Either record a real acceptance, or withdraw the requirement: claude-foundation change resolve ${id} --acceptance-not-required (a claim that declares capability 'acceptance' must drop it in evidence.yaml instead)`,
  "semantic-acceptance-invalid": (id) => `the signed semantic acceptance verdict is missing, stale, altered, or does not cover its declared cases; obtain a current oracle envelope and record it with: claude-foundation evidence record ${id} <provider> <status> --envelope <signed-json>`,
  "external-observation-missing": () => "a passing external receipt must state what was observed (--observed)",
  "external-provenance-missing": () => "a passing external receipt must state its source (--source or --reviewer)",
  "external-evidence-missing": () => "a passing external receipt must carry an artifact or reference (--artifact or --reference)",
  "execution-log-missing": (id) => `a harness-executed receipt must carry its command log; re-run: claude-foundation proof run ${id}`,
  "invalid-artifacts": (id) => `a required artifact is missing or altered since it was recorded; re-run: claude-foundation proof run ${id}`,
  "prototype-evidence": () => "prototype output cannot serve as evidence; prove the real implementation"
};

export function validityRecovery(validity, id, provider) {
  const route = VALIDITY_RECOVERY[validity];
  if (route) return route(id, provider);
  if (String(validity).endsWith("-version-stale"))
    return `this receipt predates the current protocol; re-run: claude-foundation proof run ${id}`;
  return `re-run: claude-foundation proof run ${id}`;
}

export function reviewProvenanceValidityReason(context) {
  const { value, id, reviewProtocolVersion, reviewProvenanceResult, reviewPolicy } = context;
  if (String(value.reviewProtocolVersion || "") !== reviewProtocolVersion)
    return "review-version-stale";
  const infrastructureError = value.status === "error";
  const provenance = reviewProvenanceResult(value.review, {
    allowMissingAiSession: infrastructureError
  });
  if (!provenance.complete ||
      (!infrastructureError && !provenance.independent &&
        reviewPolicy(id).independence !== "self"))
    return "review-not-independent";
  return { provenance };
}

export function reviewAttemptValidityReason(context) {
  const { value, id, evidenceVault, pathExists, readDirectory,
    reviewAttemptByDigest, reviewAttemptIsValid } = context;
  const attemptDigest = String(value.review?.attemptDigest || "");
  const attemptDir = join(evidenceVault, id, "review-attempts");
  let attemptPath = null;
  if (attemptDigest && pathExists(attemptDir))
    for (const name of readDirectory(attemptDir)) {
      if (!name.includes(attemptDigest.slice(0, 12))) continue;
      attemptPath = name;
      break;
    }
  if (!attemptPath) return "review-attempt-history-missing";
  if (!reviewAttemptIsValid(value, reviewAttemptByDigest(id, attemptDigest)))
    return "review-attempt-history-invalid";
  return null;
}

export function reviewOutcomeValidityReason(context, provenance) {
  const { value, id, hash, repairBindingValid, reviewPolicy } = context;
  const bindings = value.review?.repairClosure?.evidenceBindings;
  if (value.review?.repairClosure && !(Array.isArray(bindings) && bindings.length > 0 &&
      bindings.every((binding) => repairBindingValid(id, binding, hash))))
    return "review-repair-evidence-stale";
  if (value.status === "pass" &&
      reviewPolicy(id).diversity === "required" && !provenance.diverse)
    return "review-not-diverse";
  if (value.status === "pass" &&
      Number(value.review?.findings?.unresolvedBlockers || 0) > 0)
    return "review-blockers";
  return null;
}

export function acceptanceDecisionIsValid({
  value, currentAcceptance, actualClaims, expectedClaims, stableHash
}) {
  const criteria = value.acceptance?.criteria;
  return value.acceptance?.actor?.type === "human" &&
    Boolean(String(value.acceptance?.actor?.identity || "").trim()) &&
    value.acceptance?.decision === "accept" &&
    Array.isArray(criteria) && criteria.length > 0 &&
    !criteria.some((criterion) => !String(criterion).trim()) &&
    new Set(criteria.map((criterion) => String(criterion).trim())).size === criteria.length &&
    stableHash(actualClaims) === stableHash(expectedClaims) &&
    value.acceptance?.subjectWorkspaceHash === value.workspaceHash &&
    value.acceptance?.reason === currentAcceptance.reason;
}

export function createReceiptValidity({
  evidenceVault, providerProtocolVersion, adapterProtocolVersion,
  reviewProtocolVersion, acceptanceProtocolVersion, receiptPath, readJson,
  receiptPrototypeEvidence, contractFingerprint, providerConfig,
  providerCapability, reviewProvenanceResult, reviewPolicy,
  reviewAttemptByDigest, reviewAttemptIsValid, resolvedAcceptance,
  claimsForProvider, stableHash, adapterFingerprint, providerWorkspaceHash,
  providerInputIdentity, validateArtifact, relevantHash, relevantSnapshot,
  changeDiffIdentity
}) {
  const invalidReceipt = (provider, validity, value) =>
    ({ provider, validity, status: value.status });

  function protocolValidity(id, provider, value) {
    if (String(value.providerProtocolVersion || "") !== providerProtocolVersion)
      return invalidReceipt(provider, "provider-version-stale", value);
    if (receiptPrototypeEvidence(id, provider, value))
      return invalidReceipt(provider, "prototype-evidence", value);
    const expectedContractFingerprint = contractFingerprint(id);
    if (value.contractFingerprint !== expectedContractFingerprint)
      return {
        provider, validity: "contract-stale", status: value.status,
        invalidation: {
          reason: "contract-changed",
          from: value.contractFingerprint || null,
          to: expectedContractFingerprint,
          reusable: false
        }
      };
    return null;
  }

  function receiptContext(id, provider, hash, value) {
    const config = providerConfig(id, provider);
    const capability = providerCapability(provider, config);
    const expectedWorkspaceHash = providerWorkspaceHash(id, provider, hash);
    const expectedInputs = providerInputIdentity(
      id, provider, config, expectedWorkspaceHash);
    return { id, provider, hash, value, config, capability, expectedWorkspaceHash, expectedInputs };
  }

  function workspaceReuse(context) {
    const { id, provider, value, capability, expectedWorkspaceHash, expectedInputs } = context;
    let reusableInputs = false;
    let reusableDiff = false;
    // A durable diff rebind pins the exact workspace content it sanctioned,
    // so matching it is as strong as matching the original hash. The rebind
    // lives beside `workspaceHash`, never in its place: the review attempt
    // chain digests the original hash, and rewriting it would corrupt the
    // very history that proves the verdict happened.
    const reboundCurrent = ["review", "acceptance"].includes(capability) &&
      Boolean(value.rebind?.boundWorkspaceHash) &&
      value.rebind.boundWorkspaceHash === expectedWorkspaceHash;
    if (value.workspaceHash !== expectedWorkspaceHash && !reboundCurrent) {
      if (expectedInputs.mode === "declared" &&
          value.inputIdentity?.mode === "declared" &&
          value.inputIdentity.fingerprint === expectedInputs.fingerprint)
        reusableInputs = true;
      // A review or acceptance verdict binds the change's diff plus the
      // packet its giver read. When both survive a moved base byte-for-byte
      // — the common shape of "another change landed first" — the verdict is
      // rebindable, not stale. Null identities never match: a receipt or a
      // workspace without one stays on the expiring path.
      else if (["review", "acceptance"].includes(capability) &&
          value.rebind?.mode === "diff" &&
          value.rebind.diffIdentity &&
          value.rebind.diffIdentity === changeDiffIdentity(id) &&
          value.rebind.packetReviewHash &&
          value.rebind.packetReviewHash === relevantSnapshot(id)?.packetReviewHash)
        reusableDiff = true;
      else return { result: {
          provider, validity: "stale", status: value.status,
          invalidation: {
            reason: "workspace-content-changed",
            fromWorkspaceHash: value.workspaceHash || null,
            toWorkspaceHash: expectedWorkspaceHash,
            inputMode: expectedInputs.mode,
            reusable: false
          }
        } };
    }
    return { reusableInputs, reusableDiff, reboundCurrent };
  }

  function repairBindingContext(id, binding) {
    const boundProvider = String(binding?.provider || "");
    const boundConfig = providerConfig(id, boundProvider);
    const boundCapability = providerCapability(boundProvider, boundConfig);
    const path = receiptPath(id, boundProvider);
    if (!boundProvider || ["review", "acceptance"].includes(boundCapability) ||
        !existsSync(path) ||
        !(boundConfig?.criticalCases || []).includes(binding.caseId) ||
        !claimsForProvider(id, boundProvider).some((claim) =>
          claim.id === binding.claimId)) return null;
    return { boundProvider, boundConfig, bound: readJson(path, {}) };
  }

  function boundReceiptValid(id, binding, hash, context) {
    const { boundProvider, boundConfig, bound } = context;
    const expectedHash = providerWorkspaceHash(id, boundProvider, hash);
    const expectedInputs = providerInputIdentity(
      id, boundProvider, boundConfig, expectedHash);
    return stableHash(bound) === binding.receiptDigest &&
      bound.status === "pass" &&
      bound.workspaceHash === expectedHash &&
      bound.contractFingerprint === contractFingerprint(id) &&
      String(bound.providerProtocolVersion || "") === providerProtocolVersion &&
      String(bound.adapterProtocolVersion || "") === adapterProtocolVersion &&
      bound.providerFingerprint === adapterFingerprint(id, boundProvider, boundConfig) &&
      bound.inputIdentity?.fingerprint === expectedInputs.fingerprint &&
      Array.isArray(bound.claims) && bound.claims.includes(binding.claimId) &&
      (bound.artifacts || []).every((artifact) =>
        artifact.required === false || validateArtifact(artifact)) &&
      (bound.execution !== "harness" || (bound.artifacts || [])
        .some((artifact) => artifact.type === "command-log"));
  }

  function repairBindingValid(id, binding, hash) {
    const context = repairBindingContext(id, binding);
    return Boolean(context) && boundReceiptValid(id, binding, hash, context);
  }

  function reviewValidity(context) {
    const { id, provider, value, hash, capability } = context;
    if (capability !== "review") return null;
    const provenanceResult = reviewProvenanceValidityReason({
      value, id, reviewProtocolVersion, reviewProvenanceResult, reviewPolicy
    });
    if (typeof provenanceResult === "string")
      return invalidReceipt(provider, provenanceResult, value);
    const attemptReason = reviewAttemptValidityReason({
      value, id, evidenceVault, pathExists: existsSync, readDirectory: readdirSync,
      reviewAttemptByDigest, reviewAttemptIsValid
    });
    if (attemptReason) return invalidReceipt(provider, attemptReason, value);
    const outcomeReason = reviewOutcomeValidityReason({
      value, id, hash, repairBindingValid, reviewPolicy
    }, provenanceResult.provenance);
    return outcomeReason ? invalidReceipt(provider, outcomeReason, value) : null;
  }

  function acceptanceValidity(context) {
    const { id, provider, value, capability } = context;
    if (capability !== "acceptance") return null;
    if (String(value.acceptanceProtocolVersion || "") !== acceptanceProtocolVersion)
      return invalidReceipt(provider, "acceptance-version-stale", value);
    const currentAcceptance = resolvedAcceptance(id);
    const actualClaims = Array.isArray(value.claims) ? [...value.claims].sort() : [];
    const expectedClaims = claimsForProvider(id, provider).map((claim) => claim.id).sort();
    if (!acceptanceDecisionIsValid({
      value, currentAcceptance, actualClaims, expectedClaims, stableHash
    }))
      return invalidReceipt(provider, "acceptance-invalid", value);
    return null;
  }

  function semanticAcceptanceValidity(context) {
    const { id, provider, value, capability, config, expectedWorkspaceHash } = context;
    if (capability !== "semantic-acceptance") return null;
    if (String(value.semanticAcceptanceProtocolVersion || "") !==
        SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION)
      return invalidReceipt(provider, "semantic-acceptance-version-stale", value);
    const semantic = value.semanticAcceptance;
    const result = validateSemanticAcceptanceEnvelope({
      envelope: semantic?.signedEnvelope,
      config,
      changeId: id,
      provider,
      workspaceHash: expectedWorkspaceHash
    });
    if (!result.valid || result.status !== value.status ||
        result.verdictDigest !== semantic?.verdictDigest ||
        semantic?.subjectWorkspaceHash !== value.workspaceHash)
      return invalidReceipt(provider, "semantic-acceptance-invalid", value);
    for (const binding of semantic?.sourceBindings || []) {
      const path = receiptPath(id, binding.sourceProvider);
      if (!existsSync(path))
        return invalidReceipt(provider, "semantic-acceptance-invalid", value);
      const source = readJson(path, {});
      const observation = (source.criticalCases || []).find((row) =>
        row.id === binding.criticalCaseId && row.status === "pass");
      if (!observation || stableHash(source) !== binding.sourceReceiptDigest ||
          stableHash(observation) !== stableHash(binding.observation))
        return invalidReceipt(provider, "semantic-acceptance-invalid", value);
    }
    return null;
  }

  function expectedProviderFingerprint(context) {
    const { id, provider, value, config } = context;
    return config
      ? adapterFingerprint(id, provider, config)
      : stableHash({
        adapterProtocolVersion: value.adapterProtocolVersion || adapterProtocolVersion,
        providerProtocolVersion,
        provider,
        adapter: value.adapter || "external",
        adapterVersion: String(value.providerVersion || "1"),
        command: value.command || null,
        claims: value.claims || [],
        environment: value.environment || null,
        inputMode: value.capability?.inputMode || null,
        project: value.project || null
      });
  }

  function identityValidity(context, reuse) {
    const { provider, value, expectedInputs } = context;
    const expectedFingerprint = expectedProviderFingerprint(context);
    if (value.providerFingerprint !== expectedFingerprint)
      return {
        provider, validity: "provider-fingerprint-stale", status: value.status,
        invalidation: {
          reason: "provider-configuration-changed",
          from: value.providerFingerprint || null,
          to: expectedFingerprint,
          reusable: false
        }
      };
    // A diff-rebindable receipt's global input fingerprint derives from the
    // very workspace hash the rebind refreshes; judging it here would expire
    // exactly the receipt the branch above just found reusable or rebound.
    if (!reuse.reusableDiff && !reuse.reboundCurrent &&
        value.inputIdentity?.fingerprint !== expectedInputs.fingerprint)
      return {
        provider, validity: "provider-inputs-stale", status: value.status,
        invalidation: {
          reason: "provider-inputs-changed",
          from: value.inputIdentity?.fingerprint || null,
          to: expectedInputs.fingerprint,
          inputMode: expectedInputs.mode,
          reusable: false
        }
      };
    return null;
  }

  function completionValidity(context) {
    const { id, provider, value } = context;
    if (value.status !== "pass") return { provider, validity: value.status };
    const requiredClaims = claimsForProvider(id, provider).map((claim) => claim.id);
    const covered = new Set(value.claims || []);
    if (requiredClaims.some((claim) => !covered.has(claim)))
      return { provider, validity: "incomplete-claims", status: value.status };
    const invalidArtifacts = (value.artifacts || []).filter((artifact) =>
      artifact.required !== false && !validateArtifact(artifact));
    if (invalidArtifacts.length)
      return { provider, validity: "invalid-artifacts", status: value.status };
    if (value.execution === "harness") {
      if (!(value.artifacts || []).some((artifact) => artifact.type === "command-log"))
        return invalidReceipt(provider, "execution-log-missing", value);
    } else {
      if (!String(value.observed || "").trim())
        return invalidReceipt(provider, "external-observation-missing", value);
      if (!String(value.provenance?.source || "").trim())
        return invalidReceipt(provider, "external-provenance-missing", value);
      if ((value.artifacts || []).length === 0 && (value.references || []).length === 0)
        return invalidReceipt(provider, "external-evidence-missing", value);
    }
    return null;
  }

  function reusableValidity(context, reuse) {
    const { provider, value, expectedWorkspaceHash, expectedInputs } = context;
    // This is intentionally transitional rather than "valid": proof execute
    // and proof advance first rebind the unchanged declared inputs to the new
    // workspace hash, then recompute validity before finalize. Treating it as
    // valid here would let Land accept the old receipt without that durable,
    // content-bound rebind. `reusable-diff` is the review/acceptance twin of
    // the same contract.
    if (reuse.reusableDiff) return {
      provider, validity: "reusable-diff", status: value.status,
      receipt: value, expectedWorkspaceHash, expectedInputs,
      reuse: {
        reason: "diff-identity-unchanged",
        fromWorkspaceHash: value.workspaceHash,
        toWorkspaceHash: expectedWorkspaceHash,
        diffIdentity: value.rebind.diffIdentity
      }
    };
    return reuse.reusableInputs
      ? {
        provider, validity: "reusable-inputs", status: value.status,
        receipt: value, expectedWorkspaceHash, expectedInputs,
        reuse: {
          reason: "declared-inputs-unchanged",
          fromWorkspaceHash: value.workspaceHash,
          toWorkspaceHash: expectedWorkspaceHash,
          inputFingerprint: expectedInputs.fingerprint
        }
      }
      : { provider, validity: "valid", receipt: value };
  }

  function receiptValidity(id, provider, hash = relevantHash(id)) {
    const path = receiptPath(id, provider);
    if (!existsSync(path)) return { provider, validity: "missing" };
    const value = readJson(path);
    const protocol = protocolValidity(id, provider, value);
    if (protocol) return protocol;
    const context = receiptContext(id, provider, hash, value);
    const reuse = workspaceReuse(context);
    if (reuse.result) return reuse.result;
    const semantic = reviewValidity(context) || acceptanceValidity(context) ||
      semanticAcceptanceValidity(context);
    if (semantic) return semantic;
    const identity = identityValidity(context, reuse);
    if (identity) return identity;
    const completion = completionValidity(context);
    if (completion) return completion;
    return reusableValidity(context, reuse);
  }

  return { receiptValidity };
}
