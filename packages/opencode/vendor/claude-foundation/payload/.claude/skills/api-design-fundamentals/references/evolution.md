# Safe Retries, Large Collections, and Long-term Evolution

Deeper companion to **principles 5, 6, 8** (idempotency & safety; pagination/filtering; versioning & deprecation). The SKILL.md body states the rules; this file is the implementation detail — idempotency-key storage, optimistic concurrency, cursor pagination, the additive-vs-breaking table, versioning schemes, and the deprecation lifecycle.

## Idempotency keys (safe retries for non-idempotent mutations)

`GET`/`HEAD` are safe and `PUT`/`DELETE` are idempotent by contract — design the handler so a repeat is a no-op (delete an already-deleted resource → still `204`/`404`, not `500`). The problem is `POST`/`PATCH`: a dropped response makes the client retry and double-charge. Accept a client-generated **`Idempotency-Key`**:

```
POST /charges
Idempotency-Key: 9f1c...-client-uuid
{ "amount_cents": 5000 }
```

Server algorithm:

1. Look up the key. **Miss** → execute, then persist `key → {request_fingerprint, status, response_body}` atomically with the side effect (ideally same transaction, or the [[queue-fundamentals]] outbox pattern).
2. **Hit, same fingerprint** → return the *stored* original response verbatim. Do not re-execute.
3. **Hit, in-flight** → return `409` (or block briefly); the original is still running.
4. **Hit, different request body for the same key** → `422`: the key was reused for a different operation, which is a client bug, not a retry.

Details that matter:
- **Scope** the key per endpoint + per authenticated client so two clients can't collide.
- **TTL** the stored keys (e.g. 24h); they're for retries, not permanent dedup.
- Store a **fingerprint** (hash of method+path+body) so step 4 can detect misuse.
- This is part of the **public contract**, documented per endpoint — not a quiet optimization. The async mirror is idempotent consumers ([[queue-fundamentals]]).

## Optimistic concurrency (lost-update protection)

Two clients reading then writing the same resource will silently clobber each other. Guard mutating endpoints with an ETag + `If-Match`:

```
GET /orders/99        → 200, ETag: "v3"
PUT /orders/99
  If-Match: "v3"      → 200 if still v3; bumps to "v4"
                      → 412 Precondition Failed if missing If-Match
                      → 409 Conflict if the resource is now "v4" (someone else wrote)
```

The `ETag` is the same per-resource version used for read caching (`resource-modeling.md`) — a version counter or content hash. This is the API-surface mirror of [[database-fundamentals]] optimistic locking; the 409 lets the client re-fetch, re-merge, and retry instead of overwriting blind.

## Pagination — never return an unbounded collection

Decide the scheme *before* the collection grows; retrofitting pagination breaks every consumer that paged the old shape.

**Always cap:** a default page size (e.g. 20) and a hard max (e.g. 100). Clamp an over-large `limit`, don't error.

**Prefer cursor (keyset) pagination** for anything large or mutating:

```
GET /orders?limit=20                     → { data: [...], next_cursor: "eyJpZCI6OTl9" }
GET /orders?limit=20&cursor=eyJpZCI6OTl9 → stable next page, fast at any depth
```

The cursor is an **opaque** token — base64 of the keyset position (`{last_id, last_sort_value}`), never a field the client constructs. It's `O(log n)` at any depth and stable under inserts/deletes (`WHERE (created_at, id) < (:cursor) ORDER BY created_at DESC, id DESC LIMIT :n`). See [[database-fundamentals]] keyset pagination.

**Offset pagination** (`?offset=N`) is the trap to reserve for small, stable, human-browsable lists where "jump to page 7" is a real need:
- `OFFSET 200000` scans and throws away 200k rows — linear slowdown with depth.
- Rows inserted/deleted between pages cause **skips and duplicates** — the page boundary shifts under the reader.

**Return metadata consistently** — the same shape on every collection: `next_cursor` (cursor) or `total`/`page` (offset), and either a body envelope or a `Link: <...>; rel="next"` header. Don't vary it per endpoint.

## Filtering and sorting — an allow-listed surface

Expose filters and sorts as an explicit, allow-listed surface (`?status=paid&sort=-created_at`), never arbitrary query passthrough:

- Passthrough couples the API to your column names (a breaking change waiting to happen) and is an injection + performance footgun.
- Validate each filterable field against an allow-list ([[security-fundamentals]]); each one is part of the contract and must be **indexed** ([[database-fundamentals]]).
- Sort keys are allow-listed too, with a documented direction syntax (`-` prefix or `sort=created_at&order=desc` — pick one).

## Versioning — additive evolution, break only with a cycle

Treat the surface as a contract you evolve **additively**. Adding is invisible and free; mutating is quarters of cross-team coordination.

| Safe (additive) | Breaking (needs a version + deprecation) |
|---|---|
| new optional field with a default | removing or renaming a field |
| new endpoint | making an optional field required |
| new optional query param | narrowing a type / tightening validation |
| new enum value clients can ignore | changing units or semantics of a field |
| new optional request header | removing an endpoint or an enum value clients switch on |

**Prefer additive over a version bump** — a new major version is a parallel surface you must run and maintain. Version explicitly only when you genuinely must break:

| Scheme | Form | Pros / cons |
|---|---|---|
| URL | `/v1/orders`, `/v2/orders` | most visible, trivially routable; pollutes every URL, implies whole-API versioning |
| Header | `Accept-Version: 2` | clean URLs, granular; invisible in a browser, easy to forget |
| Media-type | `Accept: application/vnd.api+json; version=2` | content-negotiation-native; verbose, less familiar |

Run both versions in parallel — never break v1 the day v2 ships. **Tolerant reader on both sides:** clients ignore unknown response fields (so you can add them); the server doesn't require fields a client predates.

## The deprecation lifecycle

Never remove on a guess. Run the full cycle:

1. **Announce** — changelog + direct notice to known consumers.
2. **Mark** deprecated in the schema (OpenAPI `deprecated: true`, GraphQL `@deprecated`) and emit a **`Deprecation`** header, plus **`Sunset: <date>`** (RFC 8594) so clients learn programmatically.
3. **Instrument usage of the old shape *by consumer*** — you can't safely remove what you can't see; per-consumer metrics tell you who still depends on it.
4. **Remove only when usage is zero** — not "low". A single pinned mobile build or two-year-old script still breaks.

Worked example:

```
Wrong: rename response field customer_email → email in place.
       Every client parsing customer_email breaks on the next deploy.

Right: add `email` alongside `customer_email`; populate both.
       Mark `customer_email` deprecated in the schema + Deprecation header.
       Track per-consumer usage until it hits zero, THEN remove.
       Cost: one serializer line + a quarter of patient observation — no client ever breaks.
```

## Catch breaks in CI

A schema-diff / contract-compatibility check is the cheapest place to catch an accidental break — before it ships. This is the [[delivery-engineering]] CI-gate applied to the API contract:

- REST/OpenAPI → `openapi-diff`, `oasdiff` (fail the build on a breaking diff).
- gRPC/protobuf → **Buf** breaking-change detection.
- GraphQL → schema checks (`graphql-inspector`, Apollo schema checks).

Wire it as a required check so a breaking change can't merge without an explicit, reviewed version bump.

## See also

- `resource-modeling.md` — the resources and ETags these rules evolve.
- `contracts-and-errors.md` — additive vs breaking applies to bodies *and* error codes.
