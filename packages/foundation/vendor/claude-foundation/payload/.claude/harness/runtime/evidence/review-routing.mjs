const HIGH_CAPABILITIES = new Set([
  "security-static", "data-migration", "compatibility",
  "cross-repo-contract", "state-identity"
]);
const HIGH_SEMANTICS =
  /\b(money|payment|billing|financial|authori[sz]|permission|secret|credential|destructive|migration|irreversible|concurren|race|deadlock|replay|idempoten|queue|broker|rabbit|kafka|wire|contract|legacy|activat|cutover)\w*\b/;
// Thai intents carry the same semantics. Thai has no spaces between words, so
// these families match as substrings; `\b` never fires between Thai letters.
export const THAI_RISK_SEMANTICS = Object.freeze({
  money: ["ชำระเงิน", "จ่ายเงิน", "คืนเงิน", "โอนเงิน", "เรียกเก็บเงิน", "การเงิน",
    "ใบแจ้งหนี้", "เพย์เมนต์", "บิลลิ่ง"],
  migration: ["ย้ายข้อมูล", "ไมเกรชัน", "ไมเกรต", "มิเกรต"],
  irreversible: ["ลบข้อมูล", "ลบถาวร", "ย้อนกลับไม่ได้", "กู้คืนไม่ได้"],
  concurrency: ["ทำงานพร้อมกัน", "เข้าถึงพร้อมกัน", "เขียนพร้อมกัน", "ภาวะแข่งขัน",
    "เรซคอนดิชัน", "เดดล็อก"],
  authority: ["สิทธิ์", "สิทธิการเข้าถึง", "ออโธไรเซชัน", "ความลับ", "รหัสลับ",
    "รหัสผ่าน", "ข้อมูลรับรอง"],
  delivery: ["ส่งซ้ำ", "เรียกซ้ำ", "คิวงาน", "คิวข้อความ", "โบรกเกอร์"]
});
export const thaiRiskPattern = (...families) => new RegExp(families
  .flatMap((family) => THAI_RISK_SEMANTICS[family]).join("|"), "u");
const THAI_HIGH_SEMANTICS = thaiRiskPattern(...Object.keys(THAI_RISK_SEMANTICS));
const HIGH_CLASSES =
  /money|authori[sz]|secret|destructive|concurren|replay|idempoten|queue|wire|legacy|activation|cutover/;

// Typed draft risk signals that name a trust boundary set the review tier the
// same way a declared security trigger does. `access-control` is an
// authorization boundary and `financial` is money movement: both the high
// tier, whatever language the intent is written in. `input-domain` is
// caller-supplied values reaching computation: at least the medium tier, so
// its first review runs on the configured model instead of the fast low-risk
// one. Other typed signals already reach review through the capabilities and
// coverage they require; they do not move the tier here.
export const SECURITY_RISK_SIGNAL_TIERS = Object.freeze({
  "access-control": "high",
  "financial": "high",
  "input-domain": "medium"
});

// The declared trust-boundary signals that set `tier`, lowercased and sorted.
export function securityRiskSignals(state = {}, tier = null) {
  const values = Array.isArray(state?.riskSignals) ? state.riskSignals : [];
  return [...new Set(values.map((value) => String(value).trim().toLowerCase())
    .filter((value) => Object.hasOwn(SECURITY_RISK_SIGNAL_TIERS, value) &&
      (!tier || SECURITY_RISK_SIGNAL_TIERS[value] === tier)))].sort();
}

// Intent keywords alone make review required at the low tier (user
// decision). They escalate the tier or require reviewer diversity only when
// the change also declares risk: security triggers, an access-control risk
// signal, non-low impact, coupling, a non-low claim, or a grounded risk
// tier/class.
export function declaredReviewRisk({ state = {}, claims = [], grounding = null }) {
  return Boolean((state.securityTriggers || []).length ||
    securityRiskSignals(state, "high").length ||
    (state.impact && state.impact !== "low") || state.coupling === "coupled" ||
    claims.some((claim) => claim.impact && claim.impact !== "low") ||
    ["medium", "high"].includes(grounding?.risk?.tier) ||
    (grounding?.risk?.classes || []).length);
}

export function reviewSemanticText({ state = {}, claims = [], grounding = null }) {
  const declared = (state.securityTriggers || []).join(" ");
  const text = declaredReviewRisk({ state, claims, grounding })
    ? `${state.intent || ""} ${declared}` : declared;
  return text.toLowerCase();
}

export function highReviewRiskTriggers({ state, claims, capabilities, grounding }) {
  const triggers = [];
  const semantic = reviewSemanticText({ state, claims, grounding });
  if (grounding?.risk?.tier === "high") triggers.push("declared-high-risk");
  for (const value of grounding?.risk?.classes || []) {
    if (!HIGH_CLASSES.test(String(value).toLowerCase())) continue;
    triggers.push("declared-critical-class");
    break;
  }
  if (state.impact === "high" || claims.some((claim) => claim.impact === "high"))
    triggers.push("high-impact");
  const highSignals = securityRiskSignals(state, "high");
  if ((state.securityTriggers || []).length || capabilities.has("security-static") ||
      highSignals.includes("access-control"))
    triggers.push("authorization-or-secrets");
  if (highSignals.includes("financial")) triggers.push("financial");
  for (const capability of HIGH_CAPABILITIES) {
    if (!capabilities.has(capability)) continue;
    triggers.push("destructive-data-or-external-contract");
    break;
  }
  if (HIGH_SEMANTICS.test(semantic) || THAI_HIGH_SEMANTICS.test(semantic))
    triggers.push("critical-semantics");
  return triggers;
}

export function mediumReviewRiskTriggers({
  state, claims, grounding, requiredTriggers = []
}) {
  const triggers = [];
  if (grounding?.risk?.tier === "medium") triggers.push("declared-medium-risk");
  if (state.impact === "medium" || state.coupling === "coupled")
    triggers.push("medium-impact-or-coupling");
  if (claims.some((claim) => claim.impact !== "low") || requiredTriggers.length)
    triggers.push("review-risk");
  if (securityRiskSignals(state, "medium").length)
    triggers.push("input-domain");
  return triggers;
}

export function classifyReviewRisk({
  state, claims, capabilities, grounding, requiredTriggers = []
}) {
  const input = { state, claims, capabilities, grounding, requiredTriggers };
  const high = highReviewRiskTriggers(input);
  const medium = mediumReviewRiskTriggers(input);
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
