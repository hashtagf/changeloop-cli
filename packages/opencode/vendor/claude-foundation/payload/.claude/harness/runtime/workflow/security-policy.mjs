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
