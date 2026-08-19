# Body Contracts and the Error Surface

Deeper companion to **principles 3–4** (the body is a validated contract; errors are first-class). The SKILL.md body states the rules; this file is the schema-first workflow, the wire-vs-domain mapping, the full RFC 9457 envelope, and error-code catalog design.

## Schema as the single source of truth

Write the contract down in a machine-readable schema and **generate** everything else from it — never hand-maintain docs and types in parallel; they drift the day you forget.

| Protocol | Schema | Generates |
|---|---|---|
| REST | OpenAPI (YAML/JSON) | docs, client SDKs, server stubs, request validators, mock servers |
| GraphQL | SDL | resolvers' types, client typed queries, introspection docs |
| gRPC | `.proto` | message + service code for every language, strict on the wire |

Workflow: **schema → codegen → validators + typed handlers + published docs.** The schema lives in the repo and is reviewed like code. A change to the surface is a change to the schema first, then the code — which is also what makes the CI contract-compatibility check possible (see `evolution.md`).

## Validate at the boundary

Validation is one job done once, at the edge, *before* domain logic runs. The output of the boundary is a trusted typed value the rest of the code never re-checks — [[programming-fundamentals]] "parse, don't validate", and the [[security-fundamentals]] edge.

- Required fields present, types correct, enums in range, strings within length, numbers within bounds.
- Reject failures with `400` (malformed) or `422` (well-formed but breaks a rule) and a **field-level** error body (below) — never let bad input reach the use case.
- Validate against the schema, not by hand: `zod` / `pydantic` / JSON Schema / the OpenAPI validator. One declaration drives both the validator and the generated docs.
- The *how* of safe validation and canonicalization (decode-then-check, allow-lists, ReDoS) is [[security-fundamentals]] `input-and-output.md`; this principle says **do it here, at the edge.**

## Wire model ≠ domain model

Never serialize an ORM row to the client. Map explicitly through a DTO so an internal rename can't leak and you can't accidentally expose a field. This is the [[hexagonal-backend]] adapter's translate step.

```ts
// Bad — internal model straight to the wire
return res.json(await db.orders.findById(id))
//   ships db column names, leaks internal_status / password_hash,
//   and any schema rename silently breaks the API

// Good — a defined response DTO, mapped explicitly
type OrderResponse = {
  id: string
  status: 'pending' | 'paid' | 'refunded'   // mapped from internal enum
  total_cents: number
  currency: string
}
const toOrderResponse = (o: Order): OrderResponse => ({
  id: o.id, status: mapStatus(o.internal_status),
  total_cents: o.totalCents, currency: o.currency,
})           // internal_* fields never reach the wire
return res.json(toOrderResponse(order))
```

**Tolerant reader, strict writer:** on input, ignore unknown fields rather than 400-ing on them (lets a client send a superset, and lets you add request fields without breaking old clients). On output, never add a field you aren't committed to keeping — clients come to depend on whatever you emit.

## The three states of "no value"

`absent`, `null`, and `empty` are different. Decide what each means **per field** and document it; ambiguity here causes silent bugs on both sides.

| State | JSON | Common meaning |
|---|---|---|
| absent | (key omitted) | "don't change this" (PATCH) / "no opinion" |
| null | `"x": null` | "explicitly cleared / known to be nothing" |
| empty | `"x": ""` or `[]` | "present but contains nothing" |

For `PATCH`, the absent-vs-null distinction is the whole semantics: absent = leave alone, null = set to null. Pick a convention and state it in the schema.

## The error envelope — one shape, everywhere

Pick **one** error shape and use it for every endpoint, including framework-default 404/500s (override them so they conform). A widely-used standard is **RFC 9457 Problem Details**:

| Field | Meaning |
|---|---|
| `type` | URI identifying the problem class (stable; the machine key) |
| `title` | short human summary of the `type` (stable per type) |
| `status` | HTTP status, duplicated in the body for convenience |
| `detail` | human explanation specific to *this* occurrence |
| `instance` | URI/ID of this occurrence (correlate to logs) |
| *(extensions)* | any extra members — `errors[]`, `trace_id`, `code` |

```jsonc
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json
{
  "type": "https://errors.example.com/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "detail": "Order total 5000 exceeds available balance 3200.",
  "instance": "/orders/99",
  "trace_id": "req_01H...",                      // correlate to server logs
  "errors": [{ "field": "amount_cents", "code": "exceeds_balance" }]
}
```

A simpler in-house envelope (`{"error": {"code", "message", "details": [...]}}`) is fine too — what matters is that it is **the same everywhere**. Inconsistency forces per-endpoint error parsing that always falls back to "something went wrong."

## Error codes are a contract; messages are not

- **`code` (or `type`) is the stable machine key** clients branch on. Treat the set of codes as part of the contract: **adding a code is safe; repurposing or removing one is a breaking change** (`evolution.md`). Namespace them so they read clearly (`insufficient_funds`, `order_already_shipped`).
- **`message`/`detail` is free human text** — reword it anytime; clients must never `if (msg === "...")`.
- **Field-level detail for validation** lets a form highlight the offending input: `errors: [{field, code, message}]`. The `code` per field is also stable (`min`, `required`, `invalid_format`).

## Never leak internals

No stack traces, SQL, internal hostnames, or enumeration oracles ("user 42 not found" tells an attacker 42 exists — return the same generic error and a 404). Log the real detail server-side with a correlation id ([[observability-fundamentals]]) and return that id (`trace_id`/`instance`) so support can trace it without the client seeing internals.

## Document the error set per endpoint

List the errors each endpoint can return in the schema (OpenAPI `responses`, GraphQL error extensions, gRPC status codes). Undocumented errors are discovered in production. The spec's acceptance criteria carry an `on error / at boundary` clause — it maps directly onto these documented responses.

## See also

- `resource-modeling.md` — the resources and status codes these bodies belong to.
- `evolution.md` — changing a body or error set without breaking clients.
