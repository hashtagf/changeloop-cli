// Whole-word and phrase triggers that name an actual trust boundary. Generic
// words such as "token" and "session" are intentionally absent because they
// also describe ordinary budgeting and agent activity.
export const SECURITY_TERMS = [
  "auth", "authn", "authz", "authentication", "authorization",
  "user identity", "identity provider",
  "access control", "permissions", "secret", "secrets", "credential",
  "credentials", "user session", "user sessions", "session cookie",
  "session id", "session token", "session fixation", "session hijack",
  "auth token", "access token", "refresh token", "bearer token", "api token",
  "csrf token", "password",
  "passwords", "passkey", "passkeys", "sign in", "sign-in", "signin", "login",
  "log in", "sso", "oauth", "saml", "jwt", "cookie", "cookies", "encryption",
  "decrypt", "encrypt", "crypto", "cross-user", "cross user", "tenant",
  "multi-tenant", "trust boundary", "irreversible", "sensitive data", "pii",
  "personal data", "command execution", "injection", "sql injection", "xss",
  "csrf", "ssrf", "sandbox escape", "privilege", "data migration",
  "schema migration", "payment", "billing", "refund", "webhook signature",
  // Thai intents name the same boundaries. Bare โทเคน/โทเค็น is absent for the
  // same reason as bare "token": it also describes model token budgets.
  "ล็อกอิน", "ล็อคอิน", "เข้าสู่ระบบ", "ลงชื่อเข้าใช้", "ยืนยันตัวตน",
  "ออเทนทิเคชัน", "ออเธนติเคชัน", "ออโธไรเซชัน", "รหัสผ่าน", "พาสเวิร์ด",
  "พาสคีย์", "สิทธิ์", "สิทธิการเข้าถึง", "ควบคุมการเข้าถึง", "ยกระดับสิทธิ",
  "โทเคนเข้าถึง", "โทเค็นเข้าถึง", "โทเคนยืนยันตัวตน", "โทเค็นยืนยันตัวตน",
  "โทเคนเข้าสู่ระบบ", "โทเค็นเข้าสู่ระบบ", "ความลับ", "รหัสลับ", "คีย์ลับ",
  "ข้อมูลรับรอง", "เซสชันผู้ใช้", "คุกกี้", "เข้ารหัส", "ถอดรหัส",
  "ความปลอดภัย", "ข้อมูลส่วนตัว", "ข้อมูลส่วนบุคคล", "ข้อมูลอ่อนไหว",
  "ชำระเงิน", "จ่ายเงิน", "คืนเงิน", "เรียกเก็บเงิน", "เพย์เมนต์", "บิลลิ่ง",
  "ย้ายข้อมูล", "ไมเกรชัน", "ไมเกรต", "มิเกรต", "ลบข้อมูล", "ย้อนกลับไม่ได้"
];

// These labels describe ordinary input/business correctness by themselves.
// They become security material only when the change intent also names a real
// trust boundary (authorization, secrets, injection, tenant isolation, etc.).
const BUSINESS_VALIDATION_TRIGGERS = new Set([
  "api-validation", "business-rule-validation", "input-validation",
  "malformed-input", "representation-boundary", "schema-validation",
  "type-confusion-validation-bypass", "untrusted-input"
]);

const THAI = /\p{Script=Thai}/u;

// Latin terms match whole words or phrases. Thai is written without spaces
// between words, so a Thai term matches as a substring.
export function matchesSecurityTerm(value, term) {
  const semantic = String(value || "").toLowerCase();
  const normalized = String(term).toLowerCase();
  if (THAI.test(normalized)) return semantic.includes(normalized);
  const escaped = normalized
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(semantic);
}

function containsTerm(value, terms) {
  return terms.some((term) => matchesSecurityTerm(value, term));
}

export function materialSecurityTriggers(triggers, intent = "", terms = SECURITY_TERMS) {
  const values = [...new Set((Array.isArray(triggers) ? triggers : [])
    .map((value) => String(value).trim()).filter((value) =>
      value && value.toLowerCase() !== "none"))];
  if (containsTerm(intent, terms)) return values;
  return values.filter((value) =>
    !BUSINESS_VALIDATION_TRIGGERS.has(value.toLowerCase().replace(/[\s_]+/g, "-")));
}
