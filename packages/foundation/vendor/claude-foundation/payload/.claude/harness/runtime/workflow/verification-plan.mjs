export function verificationRisk(packet) {
  const providerRows = Array.isArray(packet.providers) ? packet.providers : [];
  const repositories = new Set(providerRows.flatMap((provider) =>
    Array.isArray(provider.repositories) ? provider.repositories : []));
  if (packet.impact === "high" || packet.coupling === "coupled" ||
      packet.reviewRequired || repositories.size > 1) return "high";
  if (packet.schema === "foundation-rapid" && packet.impact === "low") return "rapid";
  return "standard";
}

function providerReuse(packet) {
  const rows = Array.isArray(packet.providers) ? packet.providers : [];
  const reusable = rows.filter((provider) => provider.validity === "valid")
    .map((provider) => provider.provider);
  const required = rows.filter((provider) => provider.validity !== "valid")
    .map((provider) => provider.provider);
  return {
    measurement: Array.isArray(packet.providers) ? "provider-validity" : "compacted-unavailable",
    reusable,
    required,
    instruction: "Reuse only receipts whose current packet validity is 'valid'; proof rechecks every binding before finalization."
  };
}

function phasePlan(changeId, phase, pendingTaskCount) {
  if (phase === "change") return {
    boundary: "change-complete",
    command: `claude-foundation change validate ${changeId}`,
    includes: ["contract", "traceability", "provider-wiring", "risk-policy"],
    avoidBefore: []
  };
  if (phase === "build") return {
    boundary: "build-complete",
    command: pendingTaskCount > 0 ? null : `claude-foundation proof readiness ${changeId}`,
    deferredCommand: pendingTaskCount > 0
      ? `claude-foundation proof readiness ${changeId}` : null,
    includes: [
      "change-validation", "topology", "changed-surface", "critical-cases",
      "leases", "provider-availability"
    ],
    avoidBefore: [
      `claude-foundation change validate ${changeId}`,
      `claude-foundation proof plan ${changeId}`
    ]
  };
  if (phase === "prove") return {
    boundary: "prove",
    command: `claude-foundation proof advance ${changeId}`,
    includes: [
      "change-validation", "readiness", "provider-dag", "receipt-reuse",
      "review-routing", "acceptance-routing", "proof-finalization"
    ],
    avoidBefore: [
      `claude-foundation change validate ${changeId}`,
      `claude-foundation proof plan ${changeId}`,
      `claude-foundation proof readiness ${changeId}`,
      `claude-foundation proof run ${changeId}`
    ]
  };
  if (phase === "land") return {
    boundary: "land",
    command: `claude-foundation land advance ${changeId}`,
    includes: ["proof-freshness", "handoffs", "apply-recovery", "archive"],
    avoidBefore: [
      `claude-foundation land check ${changeId}`,
      `claude-foundation handoff status ${changeId}`
    ]
  };
  return {
    boundary: phase || "build", command: null, includes: [], avoidBefore: []
  };
}

export function convergencePlan() {
  return {
    mode: "until-pass",
    findings: "aggregate-independent",
    repairLimit: null,
    rerun: "invalidated-dependencies",
    noProgress: "decision-and-resume",
    state: "preserve-same-change"
  };
}

export function verificationPlanValue(packet, phase = "build", stableHash = null) {
  const risk = verificationRisk(packet);
  if (packet.packetType === "task") {
    const delegated = {
      version: 1,
      strategy: "parent-boundary",
      phase,
      risk,
      assurance: "unchanged-by-batching",
      execution: { boundary: "parent", command: null }
    };
    return {
      ...delegated,
      planFingerprint: typeof stableHash === "function" ? stableHash(delegated) : null
    };
  }
  const execution = phasePlan(packet.changeId, phase, Number(packet.pendingTaskCount || 0));
  const authorityPreflight = packet.authorityPreflight || { status: "READY", blockers: [] };
  const plan = {
    version: 1,
    strategy: "single-boundary-entrypoint",
    phase,
    risk,
    assurance: "unchanged-by-batching",
    pendingTaskCount: Number(packet.pendingTaskCount || 0),
    execution,
    authority: {
      status: authorityPreflight.status,
      blockerCodes: (authorityPreflight.blockers || []).map((blocker) => blocker.code).sort(),
      instruction: authorityPreflight.status === "READY"
        ? "Proceed within the declared authority."
        : "Stop before dispatch or product edits; present the packet decision and resume the same change after resolution."
    },
    convergence: convergencePlan(),
    evidence: providerReuse(packet),
    duplicateSuppression: {
      mode: "instruction-enforced",
      rule: "Do not call an avoidBefore command when the boundary command will run the same check against unchanged inputs.",
      invalidation: [
        "contract-change", "workspace-change", "policy-change", "receipt-change",
        "lease-change", "external-authority-change", "provider-environment-change"
      ]
    }
  };
  return {
    ...plan,
    planFingerprint: typeof stableHash === "function" ? stableHash(plan) : null
  };
}
