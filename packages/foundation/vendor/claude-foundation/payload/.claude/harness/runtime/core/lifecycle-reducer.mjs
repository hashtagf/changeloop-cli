export const LIFECYCLE_STATUSES = Object.freeze([
  "change", "resolved", "building", "proven", "applied", "archived"
]);

const TRANSITIONS = Object.freeze({
  // Direct/legacy workspaces can project without first materializing a
  // sandbox. The Land gate still proves authority and evidence before this
  // reducer is called; preserving that historical edge is compatibility, not
  // a permission bypass.
  change: new Set(["change", "building", "proven", "applied", "archived"]),
  // Older runtime state used `resolved` between agreement and sandbox
  // materialization. Keep it readable and transition it through the same
  // guarded paths as `change`.
  resolved: new Set(["change", "resolved", "building", "proven", "applied", "archived"]),
  building: new Set(["change", "building", "proven", "applied", "archived"]),
  proven: new Set(["building", "proven", "applied", "archived"]),
  // Archive/spec-sync recovery may require proving the already-applied bytes
  // again before the transaction can resume.
  applied: new Set(["building", "proven", "applied", "archived"]),
  archived: new Set(["archived"])
});

export function lifecycleTransitionValue(state, target, reason = null) {
  const from = String(state?.status || "change");
  if (!LIFECYCLE_STATUSES.includes(target))
    throw new Error(`unknown lifecycle target '${target}'`);
  if (!TRANSITIONS[from]?.has(target))
    throw new Error(`invalid lifecycle transition '${from}' -> '${target}'`);
  return {
    version: 1,
    from,
    to: target,
    changed: from !== target,
    outcome: from === target ? "unchanged" : "transitioned",
    reason
  };
}

export function transitionLifecycleState(state, target, reason = null) {
  const transition = lifecycleTransitionValue(state, target, reason);
  state.status = target;
  return transition;
}
