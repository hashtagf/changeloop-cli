import { createHash } from "node:crypto";

function ciConfigurationValid(config) {
  return config?.adapter === "external" &&
    typeof config.ci?.issuer === "string" && Boolean(config.ci.issuer.trim()) &&
    typeof config.ci?.publicKey === "string" &&
    config.ci.publicKey.includes("PUBLIC KEY");
}

export function compiledExecutionSurfaceValue({
  tasks = [], claims = [], providers = {}, repositories = [],
  reviewTier = null, securityTriggerCount = 0
} = {}) {
  const providerRows = Object.values(providers || {});
  return {
    version: 2,
    taskCount: tasks.length,
    claimCount: claims.length,
    providerCount: providerRows.length,
    repositoryCount: repositories.length,
    criticalCaseCount: providerRows.reduce((count, provider) =>
      count + (Array.isArray(provider?.criticalCases)
        ? provider.criticalCases.length : 0), 0),
    externalAuthorityCount: providerRows.filter((provider) =>
      provider?.adapter === "external").length,
    reviewTier: ["low", "medium", "high"].includes(reviewTier) ? reviewTier : null,
    securityTriggerCount: Math.max(0, Number(securityTriggerCount || 0))
  };
}

export function executionSurfaceBudgetScale(profile = {}) {
  const countScale = (count, floor, increment, maximum) => {
    const value = Math.max(0, Number(count || 0));
    return value > floor
      ? Math.min(maximum, 1 + (value - floor) * increment) : 1;
  };
  return Math.max(
    countScale(profile.taskCount, 2, 0.25, 3),
    countScale(profile.claimCount, 4, 0.15, 3),
    countScale(profile.providerCount, 4, 0.15, 2),
    countScale(profile.repositoryCount, 1, 0.5, 3),
    countScale(profile.criticalCaseCount, 2, 0.2, 2.5),
    1
  );
}

export function effectiveReviewAttemptLimit(routing = {}, delivered = [], workspaceHash = null) {
  const latest = delivered.at(-1) || null;
  const promotesLow = routing.tier === "low" && delivered.length >= 1 &&
    Boolean(workspaceHash) && workspaceHash !== latest?.workspaceHash;
  return {
    promotesLow,
    maxAiAttempts: promotesLow ? 2 : Number(routing.maxAiAttempts || 2)
  };
}

export function outOfBandDeliveryDriftValue({
  changeId, state, recordedHead, currentHead, baseDecision, observation = null
}) {
  return {
    ...baseDecision,
    version: 1,
    kind: "out-of-band-delivery-drift",
    priorKind: baseDecision?.kind || "control-head-moved",
    classification: "lifecycle-drift",
    authoritative: false,
    lifecycleStatus: state?.status || "unknown",
    proofStatus: "unchanged",
    recordedHead: recordedHead || null,
    currentHead: currentHead || null,
    observation,
    summary: "The control target moved outside this Land transaction. A commit, merge, or deployment may have happened, but it is not Change Loop proof or lifecycle completion.",
    recoveryCommand: `claude-foundation sandbox sync ${changeId}`,
    completionRequirement: `re-prove if invalidated, then Land until ${changeId} is archived`
  };
}

export function riskRequiresCi(state, reviewRisk = null) {
  if (state?.riskBasedCiRequired !== true) return false;
  if (reviewRisk?.tier === "high") return true;
  const capabilities = new Set(state?.evidenceCapabilities || []);
  const repositories = Object.values(state?.repositories || {});
  return state?.impact === "high" || repositories.length > 1 ||
    [
      "compatibility", "cross-repo-contract", "data-migration", "deployment",
      "security-static"
    ].some((capability) => capabilities.has(capability));
}

export function authorityPreflightValue({
  changeId, state, reviewRisk = null, providers = [], providerConfig = () => null,
  providerCapability = (provider) => provider,
  acceptance = null,
  grounding = null,
  handoffs = null
}) {
  const ciRequired = riskRequiresCi(state, reviewRisk);
  const configuredCi = providers.filter((provider) =>
    ciConfigurationValid(providerConfig(provider)));
  const capabilities = providers.reduce((rows, provider) => {
    const capability = providerCapability(provider, providerConfig(provider));
    if (!rows[capability]) rows[capability] = [];
    rows[capability].push(provider);
    return rows;
  }, {});
  const blockers = [];
  if (ciRequired && configuredCi.length === 0) blockers.push({
    code: "SIGNED_CI_CONFIGURATION_REQUIRED",
    kind: "configuration-required",
    classification: "authority",
    summary: "Risk policy requires signed CI but no trusted external CI provider is configured.",
    required: ["external adapter", "ci.issuer", "ci.publicKey"],
    next: `configure signed CI in openspec/changes/${changeId}/execution.yaml; or, as the ` +
      "user's decision, record a waiver with claude-foundation change resolve " +
      `${changeId} --ci-not-required --decision-ref <ref>, or set land.riskBasedCi to ` +
      `false in foundation.json and rerun claude-foundation change resolve ${changeId}; ` +
      `then run claude-foundation change validate ${changeId}`
  });
  const binding = {
    changeId,
    revision: Number(state?.revision || 0),
    contractRevision: Number(state?.contractRevision || 0),
    executionRevision: Number(state?.executionRevision || 0),
    impact: state?.impact || null,
    riskBasedCiRequired: state?.riskBasedCiRequired === true,
    capabilities: [...(state?.evidenceCapabilities || [])].sort(),
    reviewTier: reviewRisk?.tier || null,
    configuredCi: configuredCi.sort(),
    acceptance: acceptance ? {
      required: acceptance.required === true,
      claimIds: [...(acceptance.claimIds || [])].sort(),
      reason: acceptance.reason || null
    } : null,
    grounding: grounding ? {
      required: grounding.required === true,
      locked: grounding.locked === true,
      reopenPending: grounding.reopenPending === true
    } : null,
    handoffs: (handoffs?.operations || []).map((operation) => ({
      id: operation.id,
      timing: operation.timing || null,
      authority: operation.authority || null,
      operationDigest: operation.operationDigest || null
    })).sort((left, right) => left.id.localeCompare(right.id))
  };
  const decisionFingerprint = `sha256:${createHash("sha256")
    .update(JSON.stringify(binding)).digest("hex")}`;
  return {
    version: 1,
    status: blockers.length ? "NEEDS_USER_DECISION" : "READY",
    changeId,
    binding,
    decisionFingerprint,
    requirements: {
      signedCi: {
        required: ciRequired,
        configuredProviders: configuredCi
      },
      review: {
        required: reviewRisk?.required === true,
        tier: reviewRisk?.tier || null,
        providers: [...(capabilities.review || [])].sort(),
        requiresHumanFinal: reviewRisk?.requiresHumanFinal === true
      },
      acceptance: {
        required: acceptance?.required === true,
        claimIds: [...(acceptance?.claimIds || [])].sort(),
        providers: [...(capabilities.acceptance || [])].sort(),
        decision: acceptance?.decision || null
      },
      grounding: {
        required: grounding?.required === true,
        locked: grounding?.locked === true,
        reopenPending: grounding?.reopenPending === true,
        recoveryCommand: grounding?.reopenPending
          ? `claude-foundation change validate ${changeId}` : null
      },
      handoffs: {
        status: handoffs?.status || "COMPLETE",
        blocking: [...(handoffs?.blocking || [])].sort(),
        operations: (handoffs?.operations || []).map((operation) => ({
          id: operation.id,
          owner: operation.owner || null,
          authority: operation.authority || null,
          timing: operation.timing || null,
          status: operation.status || "pending",
          landBlocking: operation.landBlocking === true,
          recoveryCommand: `claude-foundation handoff packet ${changeId} --operation ${operation.id}`
        })).sort((left, right) => left.id.localeCompare(right.id))
      }
    },
    blockers,
    decision: blockers.length ? {
      kind: "authority-preflight",
      summary: "Required signed CI authority is unavailable, so Build is paused before dispatch or product edits.",
      recommended: "configure-required-authority",
      options: [{
        id: "configure-required-authority",
        outcome: "Configure the named trust root/provider and resume this change."
      }, {
        id: "waive-signed-ci",
        outcome: "Record the user's decision that this change proceeds without signed CI (`change resolve --ci-not-required --decision-ref <ref>`), or relax `land.riskBasedCi` in foundation.json and rerun `change resolve`."
      }, {
        id: "revise-change-risk",
        outcome: "Revise the agreement only if the declared impact or capability is incorrect."
      }, {
        id: "pause",
        outcome: "Preserve the change without spending Build or model budget."
      }]
    } : null
  };
}
