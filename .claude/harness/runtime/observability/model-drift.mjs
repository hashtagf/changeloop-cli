const TIER_RANK = { fast: 0, standard: 1, deep: 2 };
const TOKEN_BOUNDARY = /[^a-z0-9]+/;

export const DRIFT_BLOCKING_TASK_KINDS = new Set([
  "contract", "architecture", "security", "migration", "review"
]);

function tierFamilies(policy) {
  const models = policy?.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) return new Map();
  return new Map(Object.keys(TIER_RANK)
    .filter((tier) => typeof models[tier]?.family === "string" && models[tier].family.trim())
    .map((tier) => [tier, models[tier].family.trim()]));
}

function familyNames(policy) {
  return [...new Set(tierFamilies(policy).values())];
}

function canonicalFamily(value, policy) {
  if (typeof value !== "string" || !value.trim()) return null;
  const wanted = value.trim().toLowerCase();
  return familyNames(policy).find((family) => family.toLowerCase() === wanted) || null;
}

function fallbackChain(tier, policy) {
  const chain = [];
  const seen = new Set([tier]);
  let next = policy?.models?.[tier]?.fallbackTier ?? null;
  while (typeof next === "string" && TIER_RANK[next] !== undefined && !seen.has(next)) {
    seen.add(next);
    chain.push(next);
    next = policy?.models?.[next]?.fallbackTier ?? null;
  }
  return chain;
}

/** Ties resolve to the lower tier so an ambiguous mapping surfaces as a downgrade. */
function nearestTier(families, family, requestedRank) {
  let best = null;
  for (const [tier, name] of families) {
    if (name !== family) continue;
    const distance = Math.abs(TIER_RANK[tier] - requestedRank);
    if (!best || distance < best.distance ||
        (distance === best.distance && TIER_RANK[tier] < TIER_RANK[best.tier]))
      best = { tier, distance };
  }
  return best?.tier ?? null;
}

/** Map a concrete model id to a family declared by the policy. */
export function resolveFamily(modelId, policy) {
  if (typeof modelId !== "string") return null;
  const tokens = new Set(modelId.toLowerCase().split(TOKEN_BOUNDARY).filter(Boolean));
  if (!tokens.size) return null;
  let best = null;
  let ambiguous = false;
  for (const family of familyNames(policy)) {
    const parts = family.toLowerCase().split(TOKEN_BOUNDARY).filter(Boolean);
    if (!parts.length || !parts.every((part) => tokens.has(part))) continue;
    if (!best || parts.length > best.parts) {
      best = { family, parts: parts.length };
      ambiguous = false;
    } else if (parts.length === best.parts && family !== best.family) ambiguous = true;
  }
  return best && !ambiguous ? best.family : null;
}

/** Compare the planned model tier against the model the host actually ran. */
export function classifyDrift({ requestedTier, actualModelId, actualFamily, policy } = {}) {
  const requested = typeof requestedTier === "string" ? requestedTier : null;
  const families = tierFamilies(policy);
  const requestedFamily = requested ? families.get(requested) ?? null : null;
  const resolved = canonicalFamily(actualFamily, policy) ?? resolveFamily(actualModelId, policy);
  const base = {
    requestedTier: requested, requestedFamily, actualFamily: resolved, actualTier: null
  };
  if (!families.size)
    return { ...base, kind: "unknown", reason: "model policy unavailable" };
  if (!requestedFamily)
    return {
      ...base, kind: "unknown",
      reason: requested ? `unknown requested tier '${requested}'` : "requested tier missing"
    };
  if (!resolved) {
    const reported = [actualFamily, actualModelId]
      .find((value) => typeof value === "string" && value.trim());
    return {
      ...base, kind: "unknown",
      reason: reported ? `unresolved model '${reported}'` : "actual model not reported"
    };
  }
  if (resolved === requestedFamily)
    return { ...base, actualTier: requested, kind: "match", reason: `${requested} ran as planned` };
  const hop = fallbackChain(requested, policy).find((tier) => families.get(tier) === resolved);
  if (hop)
    return {
      ...base, actualTier: hop, kind: "fallback",
      reason: `declared fallback ${requested} -> ${hop}`
    };
  const actualTier = nearestTier(families, resolved, TIER_RANK[requested]);
  const kind = TIER_RANK[actualTier] > TIER_RANK[requested] ? "upgrade" : "downgrade";
  return { ...base, actualTier, kind, reason: `undeclared ${kind} ${requested} -> ${actualTier}` };
}

/** Only a downgrade on a risk-sensitive task kind blocks; "unknown" never does. */
export function isBlockingDrift(kind, taskKind) {
  return kind === "downgrade" && typeof taskKind === "string" &&
    DRIFT_BLOCKING_TASK_KINDS.has(taskKind);
}

/**
 * A risk-sensitive task whose model could not be classified at all.
 *
 * This deliberately does not block: a host that cannot report which model ran
 * is a reporting gap, not proof of a downgrade, and failing Land on it would
 * punish every integration that has not wired execution reporting yet.
 *
 * It does have to be *distinguishable*, which it was not. "unknown" and "match"
 * both left `blocking: false` and nothing else, so a host that never reported a
 * model produced the same silence as one that reported the planned tier —
 * across the exact task kinds (contract, architecture, security, migration,
 * review) the planner forces a deep tier for. A check that cannot fail and a
 * check that passed have to read differently, or the gate is decoration.
 */
export function isUnverifiedDrift(kind, taskKind) {
  return kind === "unknown" && typeof taskKind === "string" &&
    DRIFT_BLOCKING_TASK_KINDS.has(taskKind);
}
