export const LIFECYCLE_STATUSES = Object.freeze([
  "change", "resolved", "building", "proven", "applied", "archived"
]);

const TRANSITIONS = Object.freeze({
  // Land applies and archives only proven work, so nothing before `proven`
  // reaches `applied` or `archived` directly. Direct workspaces prove in place
  // and move to `proven` first, like every other workspace.
  change: new Set(["change", "building", "proven"]),
  // Older runtime state used `resolved` between agreement and sandbox
  // materialization. Keep it readable and transition it through the same
  // guarded paths as `change`.
  resolved: new Set(["change", "resolved", "building", "proven"]),
  building: new Set(["change", "building", "proven"]),
  proven: new Set(["building", "proven", "applied", "archived"]),
  // Archive/spec-sync recovery may require proving the already-applied bytes
  // again before the transaction can resume.
  applied: new Set(["building", "proven", "applied", "archived"]),
  archived: new Set(["archived"])
});

// `landing` was written by an older runtime between proof and apply and is no
// longer produced. A record that still carries it is read as `proven`, which
// leaves every Land gate (proof freshness, approval, grant) in force.
const LEGACY_STATUS_ALIASES = Object.freeze({ landing: "proven" });

export function normalizeLifecycleStatus(status) {
  const value = String(status || "change");
  return LEGACY_STATUS_ALIASES[value] || value;
}

// Rewrites a loaded runtime record's legacy status in place and reports
// whether it changed, so a loader can migrate on read.
export function normalizeLifecycleState(state) {
  if (!state || typeof state !== "object" || !("status" in state)) return false;
  const normalized = normalizeLifecycleStatus(state.status);
  if (normalized === state.status) return false;
  state.status = normalized;
  return true;
}

export function lifecycleTransitionValue(state, target, reason = null) {
  const from = normalizeLifecycleStatus(state?.status);
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
