# Resource Modeling, URL Design, and Protocol Choice

Deeper companion to **principles 1–2** (model resources not RPC verbs; use HTTP semantics honestly). The SKILL.md body states the rules; this file is the conventions catalog, the URL-shape table, the full status-code reference, and the REST-vs-GraphQL-vs-gRPC decision matrix.

## Finding the resources

A resource is a durable **noun** the client manipulates, named in the bounded context's ubiquitous language ([[ddd-strategic]]). Start from the domain, not the database:

- The noun the client *talks about* is the resource (`subscription`), even if it's three tables internally. Don't publish your schema.
- An **action that produces a lasting result** is itself a resource — a refund, a shipment, an export job. Model the result (`POST /orders/{id}/refunds` → a `refund`), not the verb (`POST /refundOrder`).
- A transient action with no durable result and no CRUD fit (recalculate, send-test-email) is the rare legitimate verb sub-resource: `POST /carts/{id}/checkout`. Keep these few and obviously non-CRUD.

## URL conventions

| Shape | Pattern | Example | Notes |
|---|---|---|---|
| Collection | `/{plural}` | `GET /orders` | always plural; the list endpoint |
| Member | `/{plural}/{id}` | `GET /orders/99` | id is opaque to the client |
| Sub-resource (owned) | `/{plural}/{id}/{plural}` | `GET /orders/99/items` | only for genuine ownership |
| Action sub-resource | `POST /{plural}/{id}/{verb-noun}` | `POST /orders/99/refunds` | result modeled as a resource |
| Singleton | `/{singular}` | `GET /users/me/settings` | one-per-parent, no id |
| Search | `/{plural}?{filters}` | `GET /orders?status=paid` | filter the collection, don't invent `/searchOrders` |

**Nesting stops at ~2 levels.** `/orders/{id}/items/{itemId}` is the deep end. Past that, the URL hard-codes your hierarchy and breaks when ownership changes. Instead, address the deep resource directly by its own id (`/order-items/{itemId}`) and let it carry a parent reference in its body. Deep nesting also forces clients to know the whole path to reach one thing.

**Naming is forever.** Pick one casing (`snake_case` *or* `camelCase`) and apply it to every field, query param, and path segment. `created_at` everywhere — never `created` here and `creationDate` there. A renamed field is a breaking change (see `evolution.md`); get it right before the first client codes against it.

## Protocol decision matrix

The status/errors/idempotency/versioning principles apply to all three — only the mechanics change. Pick for the access pattern, not fashion.

| Axis | REST | GraphQL | gRPC |
|---|---|---|---|
| Shape | resources + HTTP verbs | single graph, client-selected fields | procedures with typed messages |
| Best for | resource CRUD, broad client reach, cache-heavy public reads | varied clients needing different field subsets; avoiding over/under-fetch | high-throughput internal service-to-service |
| HTTP caching | free (`ETag`/`Cache-Control`/`304`) | not for free (POST queries) | none (HTTP/2 binary) |
| Browser story | native | native | needs grpc-web proxy |
| Schema/codegen | OpenAPI (optional but recommended) | SDL (mandatory) | `.proto` (mandatory) |
| Streaming | SSE/WebSocket bolt-on | subscriptions | first-class (bidi streams) |
| Debuggability | curl-friendly, human-readable | introspectable, but POST bodies | binary on the wire (needs tooling) |
| Main cost | over/under-fetching, endpoint sprawl | query-complexity limits, N+1 resolvers, hard caching | weak browser reach, binary debugging |

Rules of thumb: **public API for unknown clients → REST.** **One first-party app with hungry, varied views → GraphQL.** **Internal mesh where you control both ends → gRPC.** Mixing is fine (REST edge, gRPC interior).

## HTTP status code reference

The body lists these in prose; this is the lookup table. Get the **class** right above all — clients and infra branch on the first digit.

| Code | Meaning | Use when |
|---|---|---|
| 200 | OK | read/update succeeded, body returned |
| 201 | Created | resource created — include `Location: /things/{id}` |
| 202 | Accepted | async work queued — return a status resource to poll ([[architecture-fundamentals]]) |
| 204 | No Content | success, nothing to return (e.g. `DELETE`) |
| 304 | Not Modified | conditional `GET` matched `If-None-Match` — client uses its cache |
| 400 | Bad Request | malformed/invalid input |
| 401 | Unauthorized | not authenticated (missing/expired credential) |
| 403 | Forbidden | authenticated but not permitted *(but prefer 404 to hide existence — principle 7)* |
| 404 | Not Found | no such resource (or hidden from this caller) |
| 409 | Conflict | duplicate, or version mismatch on optimistic concurrency |
| 422 | Unprocessable | well-formed but breaks a business rule (when distinguished from 400) |
| 429 | Too Many Requests | rate-limited — include `Retry-After` |
| 500 | Internal Server Error | unhandled server fault — invites retry |
| 503 | Service Unavailable | dependency down/overloaded — `Retry-After` when known |
| 504 | Gateway Timeout | upstream timed out |

**The 4xx/5xx split is a retry contract:** a 5xx invites a retry (server's fault, transient), a 4xx does not (client must change the request). Returning `400` for "not logged in" tells the client to fix its body when it should re-authenticate; returning `200 {success:false}` hides the failure from every cache and retry layer. Get the class right or client middleware misbehaves.

## Caching reads honestly

For reads worth caching, return validators and let conditional requests save bandwidth:

```
GET /orders/99
→ 200 OK
  ETag: "v3"
  Cache-Control: private, max-age=30

GET /orders/99
  If-None-Match: "v3"
→ 304 Not Modified            # no body; client reuses its copy
```

`ETag` is the per-resource version (a hash or a version counter — the same value you compare for optimistic concurrency in evolution.md). `Cache-Control` sets freshness; use `private` for per-user data, `public` only for shared-safe reads. GraphQL and gRPC don't get this for free — a strong reason REST still wins for cache-heavy public reads.

## See also

- `contracts-and-errors.md` — the body and error shape these resources speak.
- `evolution.md` — keeping these URLs and shapes stable as the API grows.
