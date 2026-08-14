# Communication

Moved from `SKILL.md` — principles 3, 5, and 7's full rule/why/how-to-apply/example, ahead of the topic-organized detail below.

## Principle 3 (from SKILL.md): Choose sync or async for each interaction, deliberately

**Rule:** For every cross-boundary call, name whether the caller must wait for the callee to finish (sync) or can move on while work happens later (async). The right answer follows from whether the caller needs the result *now*, not from what's fashionable.

**Why:** Sync couples in time — callee slow means caller slow; callee down means caller down. Long chains become outage multipliers ("service A waits on B waits on C waits on D, which has a 99.5% SLO, so the chain delivers 98%"). Async decouples time but introduces eventual consistency, duplicate-delivery, and ordering. Picking wrong is a permanent tax: sync-when-async-works creates cascade failures; async-when-sync-needed creates "I saved and nothing changed… then it did later."

**How to apply:**
- **Sync for:** queries the user is actively waiting on, operations where the caller needs the result to make the *next* decision, simple reads.
- **Async for:** side effects the caller doesn't need to wait on (email, indexing, analytics), fan-out to many independent consumers, smoothing bursts, decoupling deploy/scale/failure between components.
- **The wait-and-poll pattern is async with extra friction.** If the caller polls a status endpoint, you needed async events with a status update or a webhook.
- **Chain depth matters.** Fan-out in parallel and gather rather than chain serially. Per-hop timeouts must fit inside the overall budget (see [[resilience]]).
- **Async ≠ free.** At-least-once delivery, idempotency, outbox to avoid lost events, and operating a broker. Pay it where the decoupling is worth it.

**Example:**
```
"Charge the customer's card during checkout"
  Sync: user is staring at a spinner; next screen depends on whether charge succeeded.

"Send the welcome email after signup"
  Async: publish UserSignedUp; emailer consumes, retries on failure, DLQs on permanent failure.
        Signup never breaks because SMTP is having a moment.

"Recompute search index after a product update"
  Async: seconds of search staleness is fine; blocking the product API on indexing is not.
```

## Principle 5 (from SKILL.md): Default to eventual consistency; treat strong consistency as opt-in

**Rule:** Across components, assume changes propagate eventually. Reach for strong cross-component consistency only when the business *genuinely* requires it — and accept the cost deliberately.

**Why:** Most "needs to be consistent" requirements relax when someone asks "for how long?" A 200ms propagation lag is invisible to users; engineering a distributed transaction to eliminate it costs availability, latency, and permanent complexity. On the other side, casual eventual consistency where the business needs strong (charging the right amount, not overselling the last unit) leads to irreconcilable data and refund emails.

**How to apply:**
- For each cross-boundary write, ask: **how stale can a reader be without the business breaking?** Seconds? Minutes? Never?
- "Never" is rare. When it's real, **keep the consistent operation inside a single transactional boundary** — one component, one database, one transaction. Do not reach across components to enforce strong consistency.
- Most cross-component patterns: write source-of-truth → publish event → downstream catches up. Combine with the **outbox** pattern (see [[queue-fundamentals]]).
- For multi-step workflows across components, **start with sagas and compensating actions**. Reach for **2PC** only inside a narrow, homogeneous boundary where you can't tolerate a compensating window. The 2024 stance: sagas for user-facing flows, 2PC where participants and failure modes are tightly controlled.
- **Surface staleness to readers.** `updated_at` timestamps, "last refreshed N seconds ago." Hidden staleness is worse than visible staleness.

**Example:**
```
Wrong: "Dashboard must show the right account balance instantly" → synchronous cross-service
       transaction. Slow, brittle, breaks when billing is down — the dashboard can't even render
       a stale value because the design depended on freshness.

Right: Billing owns the balance. Dashboard subscribes to balance-changed events, caches projection.
       "Updated 2s ago." Strong consistency lives inside Billing; everything outside is eventual.

Wrong: "Eventually consistent inventory is fine for flash sale" → oversold seats, refund emails.

Right: Inventory is the consistency boundary for stock. Decrement-and-reserve inside one
       transaction (conditional UPDATE WHERE qty > 0). Others consume reservation events.
```

## Principle 7 (from SKILL.md): Evolve contracts; don't break them

**Rule:** Treat every public API, event schema, and shared message format as a contract. Add fields and behaviors backwards-compatibly. Remove only after an honest deprecation cycle, long enough for every consumer to migrate.

**Why:** In any multi-component system, you can't atomically update producer and consumer — they deploy on different schedules. Breaking a contract turns "ship the feature" into "coordinate a multi-team rollout." Backwards-compatible evolution is invisible to consumers who haven't adopted it; a breaking change without versioning is an incident.

**How to apply:**
- **Add, don't replace.** New optional fields with defaults are safe. New required fields, renames, type changes, and removals are all breaks.
- **Version explicitly when you must break.** `/v1/orders` and `/v2/orders` coexist; events carry `schema_version`. Both versions run until consumption hits zero, then v1 is removed.
- **Tolerant reader.** Consumers ignore unknown fields; producers don't depend on consumers having every field.
- **Deprecation is a long horizon.** Announce → instrument (count usage by consumer) → wait until usage is **zero** (not "low") → remove. "We told them six weeks ago" is not a deprecation.
- **Idempotency keys are part of the public contract.** Any public mutation API accepts an `Idempotency-Key`. Not an optimization — the only way clients can safely retry.
- **Schema registries help.** Avro, Protobuf, JSON Schema with a registry encodes compatibility rules so CI rejects breaking changes before they ship.

**Example:**
```
Wrong: Rename `customer_email` to `email` in the user-created event. Half the consumers parse
       the old field name and break on next producer deploy. Roll back, hold a meeting, ship
       the rename over a quarter with manual consumer coordination.

Right: Add `email` alongside `customer_email`. Both fields populated. Mark `customer_email`
       deprecated. Track consumption metrics until zero. Then — only then — remove.
```

## Sync vs async decision matrix

| Question | Sync | Async |
|---|---|---|
| Is the caller actively waiting for the result? | ✅ | ❌ |
| Can the caller proceed without the result? | ❌ | ✅ |
| Does the result feed the *next* decision in this request? | ✅ | ❌ |
| Are there many independent consumers of this event? | ❌ (would require N calls) | ✅ |
| Is the dependency frequently slow or flaky? | risky — couples caller's availability to it | ✅ — decouples them |
| Does staleness of milliseconds-to-seconds matter? | ✅ — sync is fresh | ⚠️ — eventually consistent |
| Are we smoothing a burst of work? | ❌ | ✅ |
| Is the work expensive and the caller is a user-facing path? | risky — user waits | ✅ — return now, work later |

**Rules of thumb:**

- If the caller needs the result *to render the next screen* or *to make the next decision*, sync.
- If the caller's response can be sent before the work finishes, async.
- "I need to know it succeeded" doesn't require sync — it requires a status mechanism. A webhook callback, a status endpoint, or a "your job is queued" response is often the right shape.
- Avoid sync chains of depth > 2 without strong reasons. Latency compounds and availability multiplies (a chain of three 99.9% services delivers 99.7%).

## Sync transports: REST, gRPC, GraphQL

| | REST/JSON | gRPC | GraphQL |
|---|---|---|---|
| **Best for** | Public APIs, browser clients, cacheable reads | Internal service-to-service, low-latency, polyglot | Aggregating reads across multiple sources, mobile clients |
| **Strengths** | Universal, cacheable, debuggable with curl, browser-native | Binary, fast, strongly typed (proto), streaming, generated clients | Single endpoint, client-driven shape, avoids over-fetching |
| **Weaknesses** | Verbose, no native streaming, weak typing, over-/under-fetching | Browser support requires gateway, less debuggable, learning curve | Complex caching, easy to write N+1 resolvers, harder authz |
| **Versioning** | URL path (`/v1/`) or header | Proto field rules, package versioning | Field deprecation, type evolution |
| **Defaults to** | Often sloppy types and unstructured errors — discipline required | Strong types, but generated code can hide cost | Powerful for clients, easy to misuse for servers |

**Practical guidance:**

- **External (third-party / browser):** REST. Universal. Cacheable. Easy to instrument.
- **Internal high-frequency, latency-sensitive:** gRPC. Binary frames, HTTP/2 multiplexing, codegen across languages, native streaming.
- **Mobile / aggregating UI:** GraphQL can pay for itself if you have many backends and one client shape. If you have one backend, GraphQL is overhead.
- **Don't mix without reason.** A polyglot transport story is an operational tax.

## Async transports: event-driven, task queues, webhooks

For the mechanics (delivery semantics, ack discipline, idempotency, DLQs, outbox), see [[queue-fundamentals]]. From an architecture perspective:

- **Event-driven (pub/sub, log):** the producer publishes a fact ("OrderPlaced"). Many independent consumers subscribe. The producer doesn't know who is listening. Good for fan-out, decoupling, replayable history. Kafka, NATS, Pulsar, SNS+SQS, Google Pub/Sub.
- **Task queue (point-to-point):** the producer hands work to a worker pool. One worker handles each message. Good for offloading slow work from a sync request. SQS, RabbitMQ, BullMQ, Sidekiq, Celery.
- **Webhooks:** an outbound HTTP call to a consumer the producer knows about. The producer is responsible for retrying and signing the payload. Use when the consumer is external and not in your message bus.

**Pick the topology that matches the relationship:**

- One producer → many independent consumers, replayable: event log (Kafka).
- One producer → one consumer doing background work: task queue.
- One producer → external consumer the producer knows by URL: webhook.
- Two services that need to coordinate per-request: usually sync RPC, occasionally request-response over a queue.

## API versioning patterns

Versioning matters because in any non-trivial system, you cannot upgrade producer and consumer atomically. Pick a scheme before you ship v1; switching schemes later is itself a breaking change.

**Schemes:**

- **URL path:** `/v1/orders`, `/v2/orders`. Most common, most visible, easy to debug. Downside: every URL bumps. Good default.
- **Media type / Accept header:** `Accept: application/vnd.acme.order.v2+json`. Cleaner URLs, but invisible — consumers forget which version they're on, and your gateway has to do content negotiation.
- **Query parameter:** `/orders?version=2`. Discouraged: caches sometimes ignore query strings, and it's easy to forget to pass.
- **No versioning, evolve only backwards-compatibly:** plausible for small surfaces, dangerous as the surface grows. The day you must break, you have no plan.

**Versioning rule of thumb:** bump the major version *only* when you must break. Add fields, add endpoints, add optional behaviors all on the current version. A v2 is a project; a backwards-compatible v1 evolution is a deploy.

**Both versions run together** during the transition. Don't shut off v1 the day v2 ships; wait until consumption metrics say zero.

## Event schema evolution

Events outlive every other artifact in your system. A row in your DB lives until you delete it; an event in Kafka may live indefinitely, and old events you replay must still parse with new consumers.

**Compatibility flavors** (terms come from Avro/Confluent but apply universally):

- **Backward compatible:** new schema can read data written with old schema. New consumers can read old events. Most common ask.
- **Forward compatible:** old schema can read data written with new schema. Old consumers can read new events (they'll ignore new fields, see defaults for unknown). Required when you can't upgrade all consumers atomically.
- **Full compatible:** both directions. The safest, most constrained mode.

**Rules that keep schemas evolvable:**

- **Add fields with defaults.** Always safe.
- **Don't remove fields.** Mark them deprecated, stop populating them when no consumer reads them, then remove after a long quiet period.
- **Don't rename fields.** Renames are deletes + adds, which is a break. If you must rename, add the new name, populate both, deprecate the old, eventually drop the old.
- **Don't change a field's type or semantics.** A string that used to be `"USD"` and now is `{ currency: "USD", precision: 2 }` is a break, even if the JSON happens to parse.
- **Enums grow, don't shrink.** Adding a new enum value can break consumers that pattern-match all known values exhaustively — design consumers to handle unknown values gracefully (default branch).
- **Use a schema registry.** Confluent Schema Registry, Buf Schema Registry, your own JSON Schema CI check — anything that fails the build when a breaking change ships. CI is cheaper than a postmortem.

**Versioned events** when you must break: carry `schema_version` on every event. New consumers handle both versions; old consumers handle only their own. Plan the cutover: stop emitting v1 only after every consumer has confirmed it can handle v2 (and ideally, only after the v1 events have aged out of any replay window).

## Idempotency keys as a public contract

Every public mutation API should accept an idempotency key — typically a client-generated UUID, sent as a header (`Idempotency-Key`) or as a top-level field on the event. The server records the key and the response; a second call with the same key returns the recorded response without re-doing the work.

**Why this is a contract concern, not an implementation concern:**

- Without idempotency keys, clients cannot safely retry. Every retry is a roulette wheel: did the previous request succeed? Did it create a duplicate? The client has to *not* retry, which means transient failures become permanent failures from the client's perspective.
- With idempotency keys, the client retries freely; the server collapses duplicates. The semantics are predictable.
- Idempotency is **part of what consumers depend on**. Adding it later is fine; removing it later is a break.

**Implementation notes** (see [[queue-fundamentals]] reference `idempotency.md` for depth):

- The key is scoped to the operation type. A POST `/charges` with key X has a different scope from POST `/refunds` with key X.
- The recorded response is replayed verbatim, including status code and body. Don't recompute it; the second call returns whatever the first call returned, even if the world has since changed.
- Retain the key + response for at least the longest plausible retry window. 24 hours is common; longer is safer.
- Don't reuse keys across different request bodies. If the body differs and the key is the same, return 409 (idempotency-key conflict).

## Tolerant reader

Postel's robustness principle: "Be conservative in what you send, liberal in what you accept." For consumers:

- **Ignore unknown fields.** Don't fail because a new field appeared. Skip what you don't know.
- **Default for missing optional fields.** Don't crash if a field your consumer doesn't strictly require is absent.
- **Don't require a strict order** for collection fields where the schema didn't promise order.
- **Don't depend on private fields.** Anything not documented as part of the contract is not part of the contract. The producer can change it without warning.

For producers:

- **Don't add fields prematurely.** Once shipped, a field is part of the contract whether you meant it to be or not.
- **Validate what you emit against the schema.** It's cheap to catch a producer regression before it ships; expensive to catch it after consumers have started depending on the regression.

## The deprecation lifecycle

When you must remove or break a contract surface:

1. **Announce.** Internal docs, changelog, status page, direct email to consumers if you know them. The clock starts here.
2. **Mark deprecated** in the schema, OpenAPI spec, gRPC proto, or response headers (`Deprecation: true`, `Sunset: <date>`).
3. **Instrument the deprecated path.** Count requests by consumer (User-Agent, API key, client ID). You need to see the line trending to zero, not "low."
4. **Provide migration guidance.** A concrete recipe: "Replace `GET /v1/foo` with `GET /v2/foo`; the difference is field X is now nested under Y."
5. **Reach out to lingering consumers.** If usage isn't going to zero on its own, find the consumer and help them migrate.
6. **Wait until usage is zero.** Not "low," not "almost none" — zero, for a long enough period that you're confident it's not a quarterly batch job that's about to fire.
7. **Remove.** Now and only now is it safe.

The timeline is usually months for internal consumers, quarters for external. "We told everyone in the changelog" is not a deprecation; it's an announcement. The deprecation is the period during which the old surface still works while the new one becomes the default.

**Hard cases:**

- Consumers you don't control (public API, partner integrations): the timeline is longer and the migration support is more hands-on. Sometimes you maintain v1 indefinitely for these.
- Internal teams under deadline pressure: they will not migrate "when they can." They will migrate when v1 stops working. If you have authority and the migration is mechanical, set a cutoff date; if not, prepare to maintain v1 for a long time.
- Implicit consumers: scripts, dashboards, monitoring alerts. The deprecation isn't done until those are checked.

When in doubt, keep the old surface alive a little longer than feels necessary. The cost of waiting is one or two engineers maintaining a small compat layer; the cost of removing too early is an incident.
