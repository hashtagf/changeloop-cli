# Authentication, Authorization, and Rate-Limiting at the Boundary

Deeper companion to **principle 7** (every endpoint authenticates, authorizes the specific object/action, and rate-limits). The crypto/token mechanics and full threat model live in [[security-fundamentals]] (`authn-authz.md`); this file is the api-design-specific checklist for what every endpoint must answer before it ships. The endpoint is the trust boundary — enforce here, not in scattered helpers.

## Authenticate

Use a standard scheme — `Authorization: Bearer` for users, API keys for services. Return `401` when the credential is missing or expired.

## Authorize the object, not just "is logged in"

Check ownership (`order.user_id == caller.id`), role/scope, and tenant isolation on every call — not just that a valid session exists. A missing object-level check is the BOLA/IDOR hole, OWASP API Top 10 #1.

## Rate-limit every endpoint

Tighter limits on auth, expensive, and write paths. Respond `429` with `Retry-After`, and surface the budget (e.g. `X-RateLimit-*` headers) so clients self-throttle instead of hammering the limit blind.

## Hide existence from unauthorized callers

A resource the caller may not see returns `404`, not a `403` that confirms it exists — the same enumeration-oracle concern [[security-fundamentals]] applies to error messages generally.

## See also

- `resource-modeling.md` — the resources these checks guard.
- [[security-fundamentals]] — the crypto/token mechanics and full threat model.
