# Idempotency patterns

Companion to principle 3 of [[queue-fundamentals]]. If duplicates can't break you, retries and redeliveries stop being dangerous — most operational concerns become routine.

## Principle 3, in full: make consumers idempotent

**Rule:** Every message handler must produce the same observable effect whether called once, twice, or N times with the same message.

**Why:** At-least-once means duplicates *will* happen. Idempotency is the single highest-leverage defense — it turns retries, redeliveries, replays, and rebalances from incidents into non-events. A consumer without an idempotency story is one crash away from a billing incident.

**How to apply:**
- Prefer **naturally idempotent** operations: `SET balance = 100` (idempotent) vs `INCREMENT balance BY 5` (not). When the domain allows, model state as absolute rather than relative.
- Use **conditional writes** to make non-idempotent operations idempotent: `UPDATE order SET status='shipped' WHERE id=? AND status='paid'`. The second call updates zero rows — a no-op, not a duplicate ship.
- When neither works, add an **idempotency key** (often the message ID, or a domain-level operation ID the producer chose). On receive, the consumer checks a dedup table inside the same DB transaction as the side effect; if the key is present, drop the message.
- For external side effects (charging a card, sending an email), pass the idempotency key *through* to the external API when it supports one (Stripe, SendGrid, etc.). When it doesn't, record "I started this work" before the call and "I finished it" after — recovery checks the marker.
- **Your own public mutation API should accept an `Idempotency-Key` header too.** The Stripe-style contract (UUID v4 from the client, server stores key + response for ≥24h, replays cached status+body on duplicate) is now an IETF draft and a near-universal expectation for any POST/DELETE that costs money or sends an irreversible side effect. This is the HTTP-layer cousin of the queue-consumer dedup table — same idea, different boundary.

**Example (TypeScript, dedup table + conditional write):**
```ts
// Bad — at-least-once will double-charge eventually.
async function handleOrderPaid(msg: OrderPaidMessage) {
  await stripe.charge(msg.customerId, msg.amount)
  await db.query('UPDATE orders SET status=$1 WHERE id=$2', ['paid', msg.orderId])
}

// Good — idempotent at every step.
async function handleOrderPaid(msg: OrderPaidMessage) {
  // 1. Pass the broker's message ID to Stripe as their idempotency key.
  //    Stripe will collapse retries to the same charge.
  await stripe.charges.create(
    { customer: msg.customerId, amount: msg.amount },
    { idempotencyKey: msg.messageId },
  )
  // 2. Conditional write — second call updates 0 rows, harmlessly.
  await db.query(
    `UPDATE orders SET status='paid' WHERE id=$1 AND status='pending'`,
    [msg.orderId],
  )
}
```

## The three layers of idempotency

Reach for them in order — earlier layers are simpler with fewer failure modes.

1. **Natural idempotency** — the operation is idempotent by construction.
2. **Conditional idempotency** — a conditional write makes the *repeat* a no-op.
3. **Keyed idempotency** — a side table records "this message ID already produced this effect"; consumer checks before acting.

When the operation reaches an external system (Stripe, SendGrid, an internal API), also pass the idempotency key *through* to that system.

## Layer 1: natural idempotency

`f(x) == f(f(x))` — running twice has the same effect as once.

**Examples:**
- `SET balance = 100` (idempotent) vs `balance += 5` (not).
- `INSERT ... ON CONFLICT (id) DO UPDATE` vs blind `INSERT`.
- `tags = ['a', 'b', 'c']` vs `tags.append('a')`.

When modeling state changes, prefer absolute form over relative: "set status to paid" is idempotent; "increment retry count" is not — model the desired state explicitly.

## Layer 2: conditional idempotency

The operation only takes effect if a condition holds; on the second call the condition no longer holds and the operation is a no-op.

**Pattern:**
```sql
-- Bad: blind update. Run twice, status overwritten twice (probably fine here,
--      but the pattern fails on operations that are visibly destructive).
UPDATE orders SET status = 'shipped' WHERE id = $1;

-- Good: conditional. Second call updates 0 rows, harmlessly.
UPDATE orders SET status = 'shipped'
WHERE id = $1 AND status = 'paid';
```

**Where this shines:**
- **State machines** — next state only reachable from current; second message has nothing to do.
- **Versioned writes** — carry `version`/`seq` on the message; apply only if newer than stored. Also gives out-of-order safety (principle 6).
- **Unique constraints** — `UNIQUE (user_id, event_id)` turns the second `INSERT` into a constraint violation catchable as a duplicate.

**Worked example (Go) — versioned write:**
```go
// The message carries `Version`. We only apply if it's strictly newer.
result, err := db.ExecContext(ctx,
    `UPDATE users
       SET email = $1, version = $2, updated_at = $3
     WHERE id = $4 AND version < $2`,
    msg.Email, msg.Version, msg.UpdatedAt, msg.UserID,
)
if err != nil {
    return err
}
n, _ := result.RowsAffected()
if n == 0 {
    // Either the row doesn't exist (different bug) or a newer version is already
    // stored. Either way, this message is stale — drop it.
    return nil
}
return nil
```

## Layer 3: keyed idempotency

Use when the operation isn't naturally idempotent and can't be made conditional. Cost: one extra table + small write amplification. Benefit: bulletproof dedup.

**Schema:**
```sql
CREATE TABLE processed_messages (
    message_id TEXT PRIMARY KEY,           -- broker message ID or producer-chosen idempotency key
    consumer   TEXT NOT NULL,              -- which consumer? same message_id can be processed by several
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    result     JSONB                       -- optional: cache the result if it's small and the caller might re-ask
);
```

**Critical:** the insert into `processed_messages` and the side effect must be in the **same DB transaction** — a crash between them leaves you either double-processed (effect committed, marker missing) or silently dropped (marker committed, effect missing).

**Pattern (TypeScript):**
```ts
async function handle(msg: Message) {
  await db.transaction(async (tx) => {
    // 1. Try to claim the message. If someone else (or a previous attempt) already claimed it, bail.
    const inserted = await tx.query(
      `INSERT INTO processed_messages (message_id, consumer)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id`,
      [msg.id, 'order-processor'],
    )
    if (inserted.rowCount === 0) {
      // Already processed. Treat as success and ack.
      return
    }

    // 2. Do the side effect IN THE SAME TRANSACTION.
    await tx.query(`UPDATE orders SET status='paid' WHERE id=$1`, [msg.orderId])
  })
}
```

**Multiple consumers (fan-out):** each consumer needs its own dedup row — hence the `(message_id, consumer)` composite key.

**Cleanup:** set a retention policy (e.g. delete rows older than 30 days) matched to the broker's max redelivery age.

## External side effects: pass the key through

When the side effect is not in your DB — a Stripe charge, an email, an internal REST call — your dedup table doesn't help; the external system already acted by the time you record it. Pass an **idempotency key** to the external API; modern APIs collapse duplicate requests to the same response.

**Pattern (Stripe):**
```ts
// Stripe's `idempotencyKey` makes the API call itself idempotent. Two charges
// with the same key return the same charge object — no double-billing.
await stripe.charges.create(
  { customer: msg.customerId, amount: msg.amount, currency: 'usd' },
  { idempotencyKey: msg.messageId },  // ← stable, derived from the message
)
```

**Choosing the key:**
- Use the broker message ID if it's stable across redeliveries (most are; verify).
- Otherwise, have the producer generate a domain-level key (`charge:order:<order_id>:attempt:<n>` or a UUID on the entity) and put it on the message.
- **Never** derive the key from time, randomness, or the receive timestamp — those change on retry.

**When the external API doesn't support idempotency keys:**
- Write `external_call_started_at` before the call, `external_call_completed_at` after. On retry with started-but-not-completed: (a) query the external API, (b) treat as completed and risk one duplicate, or (c) treat as not-completed and risk one missed call. Pick consciously.
- Minimize the unknown-state window: keep the external call alone in its critical section.

## Your own public mutation API should accept `Idempotency-Key` too

Protects *your callers* — a near-universal expectation for any POST/DELETE that costs money or fires an irreversible side effect. The contract (popularised by Stripe, now an IETF draft):

1. Client generates a UUID v4 and sends it in the `Idempotency-Key: <uuid>` header.
2. On first request, server processes normally and stores `(key, request_fingerprint, status_code, response_body)` keyed by the idempotency key.
3. On retry with the same key, server short-circuits: it returns the cached status code and body byte-for-byte. The handler does not run again.
4. Retention is **≥24 hours** (Stripe holds 24h; Slack 24h; many payment processors longer). Long enough to outlive any reasonable client retry budget, short enough not to be a unbounded storage problem.
5. If the retry's `request_fingerprint` (hash of the body + path + key params) doesn't match the original, return `422` — the client is reusing the key incorrectly.

**Schema (Postgres):**
```sql
create table api_idempotency (
  idempotency_key text primary key,
  request_fingerprint text not null,
  status_code int not null,
  response_body jsonb not null,
  created_at timestamptz not null default now()
);
create index on api_idempotency (created_at);  -- for TTL cleanup
```

**Pattern (TypeScript sketch):**
```ts
app.post('/payments', async (req, res) => {
  const key = req.header('Idempotency-Key')
  if (!key) return res.status(400).send({ error: 'Idempotency-Key required' })

  const fp = sha256(req.method + req.path + canonicalize(req.body))

  const cached = await db.one(
    'select status_code, response_body, request_fingerprint from api_idempotency where idempotency_key = $1',
    [key],
  ).catch(() => null)

  if (cached) {
    if (cached.request_fingerprint !== fp) return res.status(422).send({ error: 'idempotency key reuse with different body' })
    return res.status(cached.status_code).send(cached.response_body)
  }

  // ... process the payment exactly once ...
  const result = await processPayment(req.body)

  await db.none(
    'insert into api_idempotency (idempotency_key, request_fingerprint, status_code, response_body) values ($1, $2, $3, $4) on conflict (idempotency_key) do nothing',
    [key, fp, 200, result],
  )

  res.status(200).send(result)
})
```

**Why this belongs here.** The HTTP idempotency-key contract and the consumer dedup table are the same idea at different boundaries: stable client-chosen key + server-side record + same response on retry. When your service is both an HTTP endpoint and a downstream queue consumer, the `Idempotency-Key` from the HTTP request *is* the message-level key in the queue — propagate it and the protection extends end-to-end.

## Common idempotency mistakes

- **Relying on framework-level dedup.** Frameworks that promise "won't deliver the same message twice" don't cover crashes, redeployments, or rebalances. Make the operation idempotent regardless.
- **Dedup marker outside the transaction.** The marker insert and the side effect must commit together.
- **Key that includes time or randomness.** `${msg.id}-${Date.now()}` will differ on retry. Use the message ID alone.
- **No retention on the dedup table.** Grows forever; set a TTL above the broker's max redelivery age.
- **Trusting the broker's dedup window.** SQS FIFO's 5-minute dedup window is a convenience, not a guarantee — crashes and cross-region failover exceed it.
- **Idempotent on the DB write, not the side effect.** Each external side effect needs its own idempotency story.

## Choosing the right layer

A quick decision flow:

1. Can I phrase the operation as setting an absolute state? → **Layer 1 (natural).** Done.
2. Can the operation be a conditional write that no-ops on retry? → **Layer 2 (conditional).** Add the condition; you're done.
3. Does it touch only your DB but isn't conditional-friendly? → **Layer 3 (keyed).** Add a dedup row inside the transaction.
4. Does it call an external system? → Layer 3 *plus* pass the key through to the external system. Both, not either-or.

If a consumer can't answer "how do you survive a duplicate?" with one of these four answers, you have a bug waiting to ship.
