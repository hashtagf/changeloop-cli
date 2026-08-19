const HIGH_CAPABILITIES = new Set([
  "security-static", "data-migration", "compatibility",
  "cross-repo-contract", "state-identity"
]);
const HIGH_SEMANTICS =
  /\b(money|payment|billing|financial|authori[sz]|permission|secret|credential|destructive|migration|irreversible|concurren|race|deadlock|replay|idempoten|queue|broker|rabbit|kafka|wire|contract|legacy|activat|cutover)\w*\b/;
const HIGH_CLASSES =
  /money|authori[sz]|secret|destructive|concurren|replay|idempoten|queue|wire|legacy|activation|cutover/;

export function classifyReviewRisk({
  state, claims, capabilities, grounding, requiredTriggers = []
}) {
  const semantic = `${state.intent || ""} ${(state.securityTriggers || []).join(" ")}`
    .toLowerCase();
  const high = [];
  const medium = [];
  if (grounding?.risk?.tier === "high") high.push("declared-high-risk");
  if ((grounding?.risk?.classes || []).some((value) =>
    HIGH_CLASSES.test(String(value).toLowerCase())))
    high.push("declared-critical-class");
  if (state.impact === "high" || claims.some((claim) => claim.impact === "high"))
    high.push("high-impact");
  if ((state.securityTriggers || []).length || capabilities.has("security-static"))
    high.push("authorization-or-secrets");
  if ([...HIGH_CAPABILITIES].some((capability) => capabilities.has(capability)))
    high.push("destructive-data-or-external-contract");
  if (HIGH_SEMANTICS.test(semantic)) high.push("critical-semantics");
  if (grounding?.risk?.tier === "medium") medium.push("declared-medium-risk");
  if (state.impact === "medium" || state.coupling === "coupled")
    medium.push("medium-impact-or-coupling");
  if (claims.some((claim) => claim.impact !== "low") || requiredTriggers.length)
    medium.push("review-risk");
  const tier = high.length ? "high" : medium.length ? "medium" : "low";
  return {
    tier,
    route: tier === "low" ? ["ai-full"] :
      ["ai-full", "ai-delta-after-correction"],
    maxAiAttempts: tier === "low" ? 1 : 2,
    requiresHumanFinal: false,
    triggers: [...new Set([...high, ...medium])].sort()
  };
}
