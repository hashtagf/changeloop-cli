# The outbox pattern

Companion to principle 7 of [[queue-fundamentals]]. Use whenever a use case must change DB state and emit an event to a broker atomically — almost any meaningful event-driven backend.

## Principle 7, in full: don't dual-write to DB and queue

**Rule:** Never write to a database and publish to a broker as two separate steps. They cannot be made atomic across systems, and the gap is where data gets corrupted in production.

**Why:** "Save the row, then publish the event" looks fine until the process crashes between the two — DB commits but broker is down, or broker accepts but DB rolls back. Each leaves an inconsistency no retry fixes. This is the single most common source of "we lost the event" bugs.

**How to apply:**
- **Transactional outbox.** Write the outgoing message into an `outbox` table *in the same DB transaction* as the state change. A separate relay process polls the outbox (or uses CDC on it) and publishes to the broker. The relay marks rows as published. Producers never talk to the broker directly.
- **CDC (Change Data Capture).** Read the DB's write-ahead log (Postgres logical replication, MySQL binlog, MongoDB oplog) with a tool like Debezium, and turn DB changes into events automatically. Higher ops cost than outbox; lower application-code cost.
- The relay/CDC is at-least-once → publish duplicates are possible → consumers must be idempotent (principle 3). The two principles compose: outbox eliminates *lost* events, idempotency eliminates *duplicate* effects.

**Example (TypeScript, outbox write inside the same transaction):**
```ts
// Bad — dual write. Crash between the two = lost event, no way to recover.
async function placeOrder(cmd: PlaceOrderCommand) {
  const order = Order.create(cmd)
  await db.query('INSERT INTO orders ...', [order])
  await broker.publish('order.placed', order) // ← if this fails, the event is gone
}

// Good — single DB transaction; relay publishes from the outbox later.
async function placeOrder(cmd: PlaceOrderCommand) {
  const order = Order.create(cmd)
  await db.transaction(async (tx) => {
    await tx.query('INSERT INTO orders ...', [order])
    await tx.query(
      `INSERT INTO outbox (id, topic, payload, created_at)
       VALUES ($1, $2, $3, now())`,
      [order.eventId, 'order.placed', JSON.stringify(order)],
    )
  })
  // A separate relay process reads outbox rows and publishes them. The use case
  // doesn't know the broker exists.
}
```

## The problem in one diagram

```
Use case:
  1. INSERT order row in DB     ← commits independently
  2. broker.publish('order.placed', order)   ← commits independently

Failure modes:
  - Crash between 1 and 2:        DB has the order; broker has no event.   → lost event
  - Step 2 fails (broker down):   DB has the order; broker has no event.   → lost event
  - Step 2 succeeds, step 1 rolls back (rare but real with retries):       → ghost event
  - Retrying the whole thing:                                              → duplicate event
```

No ordering of those two steps avoids the problem. Two-phase commit across Postgres and a broker isn't practical. The fix: make both writes part of **one** transaction by writing to one system, and have a separate process bridge to the other.

## The fix: an outbox table

Add an `outbox` table to the **same** database. The use case writes a row inside the same transaction as the state change. A separate relay reads `outbox` rows and publishes them to the broker.

```
Use case:
  BEGIN TX
    INSERT INTO orders ...
    INSERT INTO outbox (topic, payload) VALUES ('order.placed', '{...}')
  COMMIT
                                ↓
                          (separate process)
                                ↓
  Relay:
    SELECT * FROM outbox WHERE published_at IS NULL
    publish to broker
    UPDATE outbox SET published_at = now() WHERE id = ?
```

One DB transaction from the use case's perspective. No window where state changed but the event was lost.

## Schema

```sql
CREATE TABLE outbox (
    id          BIGSERIAL PRIMARY KEY,
    topic       TEXT NOT NULL,
    payload     JSONB NOT NULL,
    headers     JSONB,                              -- message ID, trace ID, partition key
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ                        -- NULL = pending; set when relay succeeds
);

-- Index for the relay's poll query. Partial index keeps it tiny.
CREATE INDEX outbox_pending_idx
    ON outbox (created_at)
    WHERE published_at IS NULL;
```

Notes:
- `id` is monotonic — preserves per-entity order during relay.
- `headers` carries the message ID (used by consumers for idempotency — see [[idempotency]]). Generate at insert time, not publish time, so retries publish the same ID.
- Don't delete published rows immediately. Keep for a retention window (days) for auditability and replay; sweep on a schedule.

## The relay

A small loop. Three flavors:

### 1. Polling relay (simplest)

```
loop:
  rows = SELECT id, topic, payload, headers FROM outbox
         WHERE published_at IS NULL
         ORDER BY id ASC
         LIMIT 100
         FOR UPDATE SKIP LOCKED;

  for row in rows:
    broker.publish(row.topic, row.payload, row.headers)
    UPDATE outbox SET published_at = now() WHERE id = row.id;

  COMMIT;
  if rows was empty: sleep(200ms)
```

Notes:
- `FOR UPDATE SKIP LOCKED` lets you scale the relay horizontally without two workers grabbing the same row.
- Relay is at-least-once — if it crashes after `broker.publish` but before `UPDATE outbox`, it publishes again on the next poll. Consumers must be idempotent (see principle 3).
- Tune `LIMIT` and sleep interval for throughput. Polling adds latency — expect ~100–500ms lag between commit and publish.

### 2. LISTEN/NOTIFY relay (Postgres-specific, lower latency)

A trigger fires `pg_notify('outbox', '')`. The relay holds a `LISTEN outbox` connection and wakes immediately on insert. Otherwise identical to polling. Cuts latency from the polling interval to milliseconds — worth it for user-facing latency-sensitive events.

### 3. CDC relay (Debezium, etc.)

A change-data-capture tool reads the DB's write-ahead log and publishes outbox inserts to the broker — no relay code to write.

**Pros:** lowest latency, zero app code, works for any DB write. **Cons:** operational complexity (Debezium + Kafka Connect + schema registry), needs log retention configured, harder to test locally.

Use CDC when many services are on this pattern and the ops investment is amortized. For 1–2 services, polling or LISTEN/NOTIFY is plenty.

## Ordering

1. **Per-entity order**: preserved if the relay reads `ORDER BY id` and publishes serially. With parallel relays, set a partition key header matching the entity ID.
2. **Global order** across all entities: don't try — forces single-threaded relay. Almost no consumer needs it.

## When to write to the outbox vs the broker

In the use case, **always** write to the outbox, never directly to the broker. The composition root wires the use case with an outbox-shaped port; the relay is a separate deployable.

```ts
// application/ports/event-publisher.ts
export interface EventPublisher {
  publish(event: DomainEvent, tx: Transaction): Promise<void>
}

// adapters/driven/outbox/outbox-publisher.ts — implements EventPublisher
export class OutboxPublisher implements EventPublisher {
  async publish(event: DomainEvent, tx: Transaction): Promise<void> {
    await tx.query(
      `INSERT INTO outbox (topic, payload, headers)
       VALUES ($1, $2, $3)`,
      [event.topic, event.payload, { messageId: event.id }],
    )
  }
}

// Use case (composes with hexagonal):
async function placeOrder(cmd: PlaceOrderCommand): Promise<OrderId> {
  return await uow.run(async (tx) => {
    const order = Order.create(cmd)
    await orders.save(order, tx)
    await events.publish(OrderPlaced.from(order), tx)   // outbox insert
    return order.id
  })
}
```

The use case has no idea Kafka exists. That's the right level of decoupling — see [[hexagonal-backend]].

## Common outbox pitfalls

- **Forgetting the same-transaction rule.** If `outbox` insert is in a separate transaction from the domain write, you're back to dual-write. Use a Unit of Work or pass `tx` through explicitly.
- **No primary key index on `published_at IS NULL`.** A full-table scan kills the relay once outbox grows. Partial index is cheap and essential.
- **Deleting rows immediately on publish.** Now you can't audit what was sent, and a relay bug becomes unrecoverable. Set `published_at` and sweep on a schedule (1–30 days, depending on disk budget).
- **Generating message IDs at publish time.** A retry publishes a *new* ID, breaking consumer-side idempotency. Generate the ID at outbox-insert time and store it.
- **Relay that doesn't `SKIP LOCKED`.** Two relay workers grab the same row, both publish, you get duplicates that weren't strictly necessary. Use `FOR UPDATE SKIP LOCKED`.
- **Publishing the entire DB row as the event.** Events should be intentional API contracts, not "here's everything we changed." Pick the fields, version the shape.
- **Using outbox when a DB-backed job table would do.** If the consumer is in the *same* service and uses the *same* DB, you can skip the broker entirely — insert into a `jobs` table in the same transaction and have a worker poll. Outbox is for cross-system events; job tables are for in-system work.

## Choosing outbox vs CDC

| | Outbox (polling / LISTEN) | CDC (Debezium) |
|---|---|---|
| App-code cost | Low (one table + a relay) | None |
| Ops cost | Low | High (Connect, schema registry, log retention) |
| Latency | 100–500ms (polling) or ~ms (LISTEN/NOTIFY) | ~ms |
| Easy to test locally | Yes | No (needs the full stack) |
| Works for any DB write | Only what you `INSERT INTO outbox` | Any table — opt out per-table |
| Best for | 1–5 services emitting events | Many services or many tables emitting events |

Default to outbox + polling. Move to LISTEN/NOTIFY for latency-sensitive paths. Move to CDC only when the ops investment is justified.

## Putting it together

Outbox eliminates *lost* events. Idempotent consumers (see [[idempotency]]) eliminate *duplicate* effects. Together they give you what people mean by "exactly-once," using only at-least-once components.
