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
  "schema migration", "payment", "billing", "refund", "webhook signature"
];

// These labels describe ordinary input/business correctness by themselves.
// They become security material only when the change intent also names a real
// trust boundary (authorization, secrets, injection, tenant isolation, etc.).
const BUSINESS_VALIDATION_TRIGGERS = new Set([
  "api-validation", "business-rule-validation", "input-validation",
  "malformed-input", "representation-boundary", "schema-validation",
  "type-confusion-validation-bypass", "untrusted-input"
]);

function containsTerm(value, terms) {
  const semantic = String(value || "").toLowerCase();
  return terms.some((term) => {
    const escaped = String(term).toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(semantic);
  });
}

export function materialSecurityTriggers(triggers, intent = "", terms = SECURITY_TERMS) {
  const values = [...new Set((Array.isArray(triggers) ? triggers : [])
    .map((value) => String(value).trim()).filter((value) =>
      value && value.toLowerCase() !== "none"))];
  if (containsTerm(intent, terms)) return values;
  return values.filter((value) =>
    !BUSINESS_VALIDATION_TRIGGERS.has(value.toLowerCase().replace(/[\s_]+/g, "-")));
}
