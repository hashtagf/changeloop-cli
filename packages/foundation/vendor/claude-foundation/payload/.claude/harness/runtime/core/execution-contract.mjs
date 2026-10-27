import { createHash } from "node:crypto";
import { canonicalJson } from "./trust.mjs";

export const EXECUTION_CONTRACT_VERSION = 1;

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function workspaceCapabilityValue(changeId, state) {
  const status = state?.status || "change";
  if (status === "change") return {
    phase: "change", mode: "agreement-only",
    roots: [`openspec/changes/${changeId}`, ".foundation"]
  };
  if (status === "building") return {
    phase: "build", mode: "isolated-workspace",
    roots: [state?.workspace?.path, ...Object.values(state?.repositories || {})
      .filter((repository) => repository?.mode !== "read")
      .map((repository) => repository?.path || repository?.workspacePath)]
      .filter(Boolean)
  };
  if (status === "proven") return {
    phase: "prove", mode: "evidence-state-only", roots: [".foundation"]
  };
  if (["applied", "archived"].includes(status)) return {
    phase: "land", mode: "journaled-transaction",
    roots: [state?.workspace?.targetPath,
      ...Object.values(state?.repositories || {})
        .filter((repository) => repository?.mode !== "read")
        .map((repository) => repository?.targetPath)]
      .filter(Boolean)
  };
  return { phase: status, mode: "fail-closed", roots: [] };
}

export function workspaceMutationDecision({
  capability,
  target,
  foundationRoot,
  investigationRoot,
  additionalRoots = [],
  landTransaction = false,
  contains
}) {
  if (!target) return { allowed: false, reason: "mutation target is missing or invalid" };
  if (contains(target, foundationRoot)) return { allowed: true, reason: null };
  if (capability.phase === "change") {
    const allowed = [...capability.roots, investigationRoot].filter(Boolean)
      .some((root) => contains(target, root));
    return allowed ? { allowed: true, reason: null } : {
      allowed: false,
      reason: "Change may write only OpenSpec change drafts, investigation notes, or .foundation state"
    };
  }
  if (capability.phase === "prove")
    return contains(target, investigationRoot) ? { allowed: true, reason: null } : {
      allowed: false, reason: "Prove keeps product and instruction files read-only"
    };
  if (capability.phase === "land")
    return landTransaction && capability.roots.some((root) => contains(target, root))
      ? { allowed: true, reason: null } : {
      allowed: false, reason: "Land mutations require the runtime transaction marker"
    };
  if (capability.phase === "build") {
    if (!capability.roots.length)
      return { allowed: false, reason: "Build workspace is unavailable" };
    const allowed = [...capability.roots, ...additionalRoots].filter(Boolean)
      .some((root) => contains(target, root));
    return allowed ? { allowed: true, reason: null } : {
      allowed: false,
      reason: "Build mutation is outside its isolated workspace and declared paths"
    };
  }
  return { allowed: false, reason: `unsupported active phase: ${capability.phase}` };
}

export function compileExecutionContractValue({
  changeId,
  state,
  review = null,
  providers = [],
  providerCapabilities = {},
  authority,
  repositories = [],
  handoffs = null
}) {
  const body = {
    version: EXECUTION_CONTRACT_VERSION,
    changeId,
    revisions: {
      change: Number(state?.revision || 0),
      contract: Number(state?.contractRevision || 0),
      execution: Number(state?.executionRevision || 0)
    },
    risk: {
      impact: state?.impact || null,
      coupling: state?.coupling || null,
      securityTriggers: [...(state?.securityTriggers || [])].sort(),
      review
    },
    evidence: {
      providers: [...new Set(providers)].sort(),
      capabilities: Object.fromEntries(Object.entries(providerCapabilities)
        .sort(([left], [right]) => left.localeCompare(right)))
    },
    authority,
    workspace: workspaceCapabilityValue(changeId, state),
    budgets: state?.budget || null,
    repositories: repositories.map((repository) => ({
      id: repository.id,
      mode: repository.mode,
      dependsOn: [...(repository.dependsOn || [])].sort()
    })).sort((left, right) => left.id.localeCompare(right.id)),
    land: {
      explicitAuthorizationRequired: true,
      signedCiRequired: authority?.requirements?.signedCi?.required === true,
      handoffStatus: handoffs?.status || "COMPLETE",
      blockingHandoffs: [...(handoffs?.blocking || [])].sort()
    }
  };
  return { ...body, fingerprint: digest(body) };
}
