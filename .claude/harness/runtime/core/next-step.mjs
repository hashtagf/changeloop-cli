// One vocabulary for "what moves this change forward".
//
// The status-to-command map lived inline in `changes`, so it was reachable
// only by typing `changes`. Every other place that ends a phase either
// invented its own hint or said nothing, and the SessionStart hook — the one
// moment a fresh context could learn where it stands — said nothing at all.
// A loop that knows its own position but never volunteers it reads, from the
// outside, exactly like a loop that has lost track of itself.
//
// Pure by construction: no filesystem, no process, no change state loaded
// here. Callers pass the status they already hold, which is what lets the
// SessionStart hook share this map without importing the runtime's stores.

// `changes` collapses `proven` into `ready-to-land` or `stale-proof` before it
// gets here, because it has already paid for a workspace hash. Callers that
// have not — the hook, deliberately — see the raw status, so `proven` maps to
// `land check`, which performs that same freshness comparison itself rather
// than guessing at it here.
const NEXT_BY_STATUS = {
  "ready-to-land": "advance",
  "stale-proof": "advance --through proven",
  change: "advance --through build",
  building: "advance --through build",
  proven: "advance",
  applied: "advance --through archived"
};

const THROUGH_RANK = { build: 1, proven: 2, archived: 3 };

// The furthest `advance --through` target already requested for a change (the
// advance coordinator records it), never below what the user's approval
// already covers: an approved spec authorizes Prove, so a Build-only route
// would be a bounce. Land itself stays behind its own grant; this names only
// the route that makes progress, so a printed resume never walks back.
export function resumeThrough(state, floor = "build") {
  const asked = THROUGH_RANK[state?.requestedThrough] ? state.requestedThrough : null;
  const base = floor === "build" && state?.specApproval?.identity ? "proven" : floor;
  return asked && THROUGH_RANK[asked] > THROUGH_RANK[base] ? asked : base;
}

export function nextCommand(status, id, state = null) {
  const operation = NEXT_BY_STATUS[status];
  const floor = { change: "build", building: "build", "stale-proof": "proven" }[status];
  const through = state && (floor || status === "proven")
    ? resumeThrough(state, floor || "proven") : null;
  if (through && operation && (floor || through === "archived"))
    return `claude-foundation advance ${id} --through ${through}`;
  const [name, ...args] = operation ? operation.split(" ") : [];
  return operation
    ? `claude-foundation ${name} ${id}${args.length ? ` ${args.join(" ")}` : ""}`
    : `claude-foundation doctor --change ${id}`;
}

// `validate` has just performed the operation the canonical map recommends for
// a change still in `change` status, so echoing it back sends the reader in a
// circle at exactly the moment they asked what comes next.
export function nextAfterValidate(status, id, state = null) {
  return status === "change" ? `/build ${id}` : nextCommand(status, id, state);
}

export const LIFECYCLE_STATUSES = Object.keys(NEXT_BY_STATUS);
