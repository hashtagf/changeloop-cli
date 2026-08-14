import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
  stale: (id) => `the workspace moved after this receipt was earned; re-run: claude-foundation proof run ${id}. A provider that declares "inputs" in its config keeps its receipt when the edit falls outside them`,
  "provider-inputs-stale": (id) => `the provider's declared inputs changed; re-run: claude-foundation proof run ${id}`,
  "contract-stale": (id) => `evidence.yaml changed after this receipt; re-run: claude-foundation proof run ${id}`,
  "provider-fingerprint-stale": (id) => `the provider's execution.yaml wiring changed; re-run: claude-foundation proof run ${id}`,
  "incomplete-claims": (id, provider) => `provider '${provider}' did not cover every claim declared for it; check its claim list in execution.yaml, then re-run: claude-foundation proof run ${id}`,
  "review-not-independent": (id) => "the reviewer shares an identity or session with the implementation. Use a fresh reviewer, or — for a project driven from one session — set \"review\": {\"independence\": \"self\"} in foundation.json, which records the waiver on the receipt",
  "review-not-diverse": () => "the reviewer shares a provider and model family with the implementation. Use a human or a different model family, or set \"review\": {\"diversity\": \"single-model\"} in foundation.json",
  "review-blockers": (id) => `the review recorded unresolved blockers; resolve them, then request a new review: claude-foundation authority request ${id} --type review`,
  "acceptance-invalid": (id) => `acceptance needs a named human, an "accept" decision, and criteria matching the current scope. Either record a real acceptance, or withdraw the requirement: claude-foundation change resolve ${id} --acceptance-not-required (a claim that declares capability 'acceptance' must drop it in evidence.yaml instead)`,
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

export function createReceiptValidity({
  evidenceVault, providerProtocolVersion, adapterProtocolVersion,
  reviewProtocolVersion, acceptanceProtocolVersion, receiptPath, readJson,
  receiptPrototypeEvidence, contractFingerprint, providerConfig,
  providerCapability, reviewProvenanceResult, reviewPolicy,
  reviewAttemptByDigest, reviewAttemptIsValid, resolvedAcceptance,
  claimsForProvider, stableHash, adapterFingerprint, providerWorkspaceHash,
  providerInputIdentity, validateArtifact, relevantHash
}) {
  function receiptValidity(id, provider, hash = relevantHash(id)) {
    const path = receiptPath(id, provider);
    if (!existsSync(path)) return { provider, validity: "missing" };
    const value = readJson(path);
    if (String(value.providerProtocolVersion || "") !== providerProtocolVersion)
      return { provider, validity: "provider-version-stale", status: value.status };
    if (receiptPrototypeEvidence(id, provider, value))
      return { provider, validity: "prototype-evidence", status: value.status };
    if (value.contractFingerprint !== contractFingerprint(id))
      return { provider, validity: "contract-stale", status: value.status };
    const config = providerConfig(id, provider);
    const capability = providerCapability(provider, config);
    if (capability === "review") {
      if (String(value.reviewProtocolVersion || "") !== reviewProtocolVersion)
        return { provider, validity: "review-version-stale", status: value.status };
      const provenance = reviewProvenanceResult(value.review);
      if (!provenance.complete ||
          (!provenance.independent && reviewPolicy(id).independence !== "self"))
        return { provider, validity: "review-not-independent", status: value.status };
      const attemptDigest = String(value.review?.attemptDigest || "");
      const attemptDir = join(evidenceVault, id, "review-attempts");
      const attemptPath = attemptDigest && existsSync(attemptDir)
        ? readdirSync(attemptDir).find((name) => name.includes(attemptDigest.slice(0, 12))) : null;
      if (!attemptPath)
        return { provider, validity: "review-attempt-history-missing", status: value.status };
      const attempt = reviewAttemptByDigest(id, attemptDigest);
      if (!reviewAttemptIsValid(value, attempt))
        return { provider, validity: "review-attempt-history-invalid", status: value.status };
      if (reviewPolicy(id).diversity === "required" && !provenance.diverse)
        return { provider, validity: "review-not-diverse", status: value.status };
      if (Number(value.review?.findings?.unresolvedBlockers || 0) > 0)
        return { provider, validity: "review-blockers", status: value.status };
    }
    if (capability === "acceptance") {
      if (String(value.acceptanceProtocolVersion || "") !== acceptanceProtocolVersion)
        return { provider, validity: "acceptance-version-stale", status: value.status };
      const currentAcceptance = resolvedAcceptance(id);
      const criteria = value.acceptance?.criteria;
      const actualClaims = Array.isArray(value.claims) ? [...value.claims].sort() : [];
      const expectedClaims = claimsForProvider(id, provider).map((claim) => claim.id).sort();
      if (value.acceptance?.actor?.type !== "human" ||
          !String(value.acceptance?.actor?.identity || "").trim() ||
          value.acceptance?.decision !== "accept" ||
          !Array.isArray(criteria) || criteria.length === 0 ||
          criteria.some((criterion) => !String(criterion).trim()) ||
          new Set(criteria.map((criterion) => String(criterion).trim())).size !== criteria.length ||
          stableHash(actualClaims) !== stableHash(expectedClaims) ||
          value.acceptance?.subjectWorkspaceHash !== value.workspaceHash ||
          value.acceptance?.reason !== currentAcceptance.reason)
        return { provider, validity: "acceptance-invalid", status: value.status };
    }
    const expectedFingerprint = config
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
    if (value.providerFingerprint !== expectedFingerprint)
      return { provider, validity: "provider-fingerprint-stale", status: value.status };
    const expectedWorkspaceHash = providerWorkspaceHash(id, provider, hash);
    const expectedInputs = providerInputIdentity(id, provider, config, expectedWorkspaceHash);
    let reusableInputs = false;
    if (value.workspaceHash !== expectedWorkspaceHash) {
      if (expectedInputs.mode === "declared" &&
          value.inputIdentity?.mode === "declared" &&
          value.inputIdentity.fingerprint === expectedInputs.fingerprint)
        reusableInputs = true;
      else return { provider, validity: "stale", status: value.status };
    }
    if (value.inputIdentity?.fingerprint !== expectedInputs.fingerprint)
      return { provider, validity: "provider-inputs-stale", status: value.status };
    if (value.status !== "pass") return { provider, validity: value.status };
    const requiredClaims = claimsForProvider(id, provider).map((claim) => claim.id);
    const covered = new Set(value.claims || []);
    if (requiredClaims.some((claim) => !covered.has(claim)))
      return { provider, validity: "incomplete-claims", status: value.status };
    const invalidArtifacts = (value.artifacts || []).filter((artifact) =>
      artifact.required !== false && !validateArtifact(artifact));
    if (invalidArtifacts.length)
      return { provider, validity: "invalid-artifacts", status: value.status };
    if (value.status === "pass" && value.execution === "harness") {
      if (!(value.artifacts || []).some((artifact) => artifact.type === "command-log"))
        return { provider, validity: "execution-log-missing", status: value.status };
    } else if (value.status === "pass") {
      if (!String(value.observed || "").trim())
        return { provider, validity: "external-observation-missing", status: value.status };
      if (!String(value.provenance?.source || "").trim())
        return { provider, validity: "external-provenance-missing", status: value.status };
      if ((value.artifacts || []).length === 0 && (value.references || []).length === 0)
        return { provider, validity: "external-evidence-missing", status: value.status };
    }
    return reusableInputs
      ? {
        provider, validity: "reusable-inputs", status: value.status,
        receipt: value, expectedWorkspaceHash, expectedInputs
      }
      : { provider, validity: "valid", receipt: value };
  }

  return { receiptValidity };
}
