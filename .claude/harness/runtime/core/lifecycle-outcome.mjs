export const LIFECYCLE_OUTCOME_VERSION = 2;

const OWNER_BY_ACTOR = new Map([
  ["agent", "agent"],
  ["harness", "harness"],
  ["operator", "harness"],
  ["configured-reviewer", "harness"],
  ["user", "user"],
  ["external-authority", "external"],
  ["resource-owner", "external"]
]);

const VALID_OWNERS = new Set(["agent", "harness", "user", "external"]);
const VALID_ACTIONS = new Set([
  "WORKING", "EDIT", "REPAIR", "RUN_EXTERNAL", "WAIT", "ASK_USER", "DONE"
]);
const INTERNAL_DECISION_KINDS = new Set([
  "host-permission", "harness-configuration", "proof-command",
  "review-invocation", "machine-state", "internal-recovery"
]);

export function lifecycleOwner(actor, explicitOwner = null) {
  return explicitOwner || OWNER_BY_ACTOR.get(actor) || null;
}

export function validateLifecycleOutcome(value) {
  if (!value || typeof value !== "object")
    throw new Error("lifecycle outcome must be an object");
  if (!VALID_ACTIONS.has(value.action))
    throw new Error(`unsupported lifecycle action '${value.action || "(missing)"}'`);
  if (!VALID_OWNERS.has(value.owner))
    throw new Error(`lifecycle action '${value.action}' requires a valid owner`);
  if (value.action === "EDIT" && value.owner !== "agent")
    throw new Error("EDIT lifecycle outcomes belong to the agent");
  if (value.action === "ASK_USER") {
    if (value.owner !== "user")
      throw new Error("ASK_USER lifecycle outcomes belong to the user");
    const kind = value.decision?.kind || null;
    if (kind && INTERNAL_DECISION_KINDS.has(kind))
      throw new Error(`internal decision '${kind}' must not be delegated to the user`);
    if (!kind && value.boundary !== "land-authority")
      throw new Error("ASK_USER requires a work decision or Land authority boundary");
  }
  if (value.action === "WAIT" && !["external", "harness"].includes(value.owner))
    throw new Error("WAIT requires an external or harness-owned resume condition");
  if (value.action === "DONE" && value.owner !== "harness")
    throw new Error("DONE lifecycle outcomes belong to the harness");
  return value;
}

export function lifecycleOutcome(value) {
  const owner = lifecycleOwner(value.actor, value.owner);
  return validateLifecycleOutcome({
    outcomeVersion: LIFECYCLE_OUTCOME_VERSION,
    ...value,
    owner
  });
}

export function lifecycleUserState(value) {
  if (value.action === "DONE")
    return value.reached === "archived" ? "DELIVERED" : "TARGET_REACHED";
  if (value.action === "ASK_USER") return "NEEDS_DECISION";
  if (value.action === "WAIT" && value.owner === "external") return "WAITING_EXTERNAL";
  return "WORKING";
}

export function lifecycleUserProjection(value) {
  const state = lifecycleUserState(value);
  const base = {
    state,
    summary: value.reason || (state === "DELIVERED"
      ? "The change is delivered and archived."
      : state === "TARGET_REACHED" ? "The requested target is reached; the change is not yet delivered."
        : state === "WORKING" ? "Work is continuing."
        : state === "WAITING_EXTERNAL" ? "An external dependency is pending."
          : "A work decision is required.")
  };
  if (state === "TARGET_REACHED" || state === "DELIVERED") return {
    ...base,
    reached: value.reached || null,
    delivered: state === "DELIVERED"
  };
  if (state === "NEEDS_DECISION") return {
    ...base,
    decision: value.decision ? {
      kind: value.decision.kind,
      summary: value.decision.summary,
      options: (value.decision.options || []).map((option) => ({
        id: option.id,
        outcome: option.outcome
      })),
      recommended: value.decision.recommended || null
    } : { kind: "land-authority", summary: base.summary, options: [] }
  };
  if (state === "WAITING_EXTERNAL") return {
    ...base,
    owner: value.actor || "external-owner",
    condition: value.wait?.condition || value.reason || null
  };
  if (Array.isArray(value.repositories)) return {
    ...base,
    repositories: value.repositories.map((repository) => ({
      id: repository.id || repository.repository || null,
      status: repository.status || null
    }))
  };
  return base;
}
