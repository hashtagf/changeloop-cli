# Broker selection

Companion to principle 1 of [[queue-fundamentals]]. Match the shape of your problem to the shape of the broker.

## Principle 1, in full: pick the right queue for the purpose

**Rule:** Decide what the queue is *for* before you decide which broker to use. Different purposes need different shapes; the wrong broker turns a normal feature into an operational nightmare.

**Why:** "We use Kafka" is not an architecture. A queue can be a burst buffer, an async decoupler, a task queue, a pub/sub fanout, or a replayable event log. Each purpose has a different natural fit — most queue pain comes from forcing the wrong tool into the wrong role (Kafka as a task queue, SQS as an event log, an in-memory channel expected to survive crashes).

**How to apply:**
- Name the purpose in one sentence before picking a broker. "Fan out user-signup events to N independent consumers" → log/pub-sub. "Run a slow image-resize off the request thread" → task queue. "Buffer a burst of webhooks so we don't drop any" → durable broker.
- Match the durability to the cost of loss. If losing a message is fine (metrics, best-effort notifications), an in-memory channel is OK. If losing a message means losing money, the queue must survive a broker crash and a consumer crash.
- Match the topology to who reads. Single worker pool draining a queue (point-to-point) is a task queue. Many independent subscribers each seeing every message is pub/sub. Replayable history is a log.

**Example:**
```
"Send a welcome email when a user signs up"
  Wrong: write directly to Kafka, because Kafka is what we have.
  Right: a task queue (SQS, BullMQ, Sidekiq) with retries and a DLQ — point-to-point work, no replay needed.

"Notify analytics, billing, and the recommender when an order is placed"
  Wrong: have the order service call all three over HTTP.
  Right: publish OrderPlaced to a log/pub-sub topic. Each consumer reads independently
         at its own pace; adding a fourth consumer doesn't touch the order service.
```

## Five shapes a queue can take

1. **In-process buffer** — same process, decouple two pieces of code or smooth a burst. Lost on restart. Examples: Go `chan`, Node `EventEmitter` + array, Python `asyncio.Queue`.
2. **Task / work queue** — point-to-point: one message, one worker out of a pool processes it. Built-in retries, backoff, scheduled jobs. Examples: SQS, BullMQ (Redis), Sidekiq (Redis), Celery (Redis/RabbitMQ), `pg-boss` (Postgres).
3. **Pub/sub** — fan-out: one message, every subscriber gets a copy. Each subscriber tracks its own progress. Examples: SNS+SQS fanout, RabbitMQ fanout exchange, Google Pub/Sub, NATS, Redis Pub/Sub (non-durable).
4. **Event log** — append-only, replayable history. Partitioned. Multiple independent consumer groups, each with its own offset. Examples: Kafka, AWS Kinesis, Redpanda, Pulsar, Redis Streams.
5. **DB-backed job table** — a table with `status`, `attempts`, `run_after`. A worker polls and locks rows. Examples: `pg-boss`, Oban (Elixir), Que (Ruby), hand-rolled. Underrated for many use cases.

If you can't name which of the five your problem is, you're not ready to pick a broker.

## Decision matrix

The questions, in order:

| Question | If yes, lean toward |
|---|---|
| Same process, loss acceptable on restart? | In-process channel |
| Already have Postgres, jobs < ~100/s, no fan-out? | DB-backed job table |
| Point-to-point work, want managed infra? | SQS / BullMQ / Sidekiq |
| Multiple independent consumers, each needs every message? | Pub/sub (SNS+SQS, Pub/Sub, RabbitMQ fanout) |
| Need to **replay** history, audit, or add new consumers retroactively? | Event log (Kafka, Kinesis, Redis Streams) |
| Need strict per-entity ordering at high throughput? | Log with partition key, or SQS FIFO |
| Need scheduled / delayed jobs (`run in 2h`)? | Task queue with delay support (BullMQ, Sidekiq, SQS DelaySeconds, DB-backed) |
| Need exactly-once semantics tightly coupled to a DB write? | Outbox + your existing broker — see [[outbox]] |

## Principle 2, in full: know your delivery semantics

**Rule:** Pick one of {at-most-once, at-least-once, exactly-once} consciously, and know which one your broker actually delivers. "Exactly-once" is almost always at-least-once + an idempotent consumer.

**Why:** Almost every production broker is **at-least-once** by default — duplicates happen on retries, consumer crashes, rebalances, and network blips. If your handler assumes "this runs once per message," you wrote a bug. Every "we double-charged" postmortem started here.

**How to apply:**
- Default mental model: at-least-once. Build for it (see principle 3).
- At-most-once is fine *only* when loss is cheaper than duplicates (high-volume telemetry, ephemeral UI hints). Be honest about which side of that line you're on.
- "Exactly-once" exists narrowly *within* a single broker's domain (Kafka transactions + idempotent producer + `isolation.level=read_committed` consumer, set up correctly, deliver true end-to-end EOS for Kafka-to-Kafka pipelines; the idempotent producer has been on by default since Kafka 3.0). It breaks the moment you cross to an external system (DB, HTTP, email, another broker). Treat any guarantee that ends at the broker's boundary as at-least-once for the rest of your code, and reach for the outbox pattern (principle 7) when the cross-system boundary matters.
- Read your broker's docs for the *exact* semantics, including under failure: leader re-elections, consumer rebalances, ack timeouts. The defaults differ.

**Example:**
```
SQS Standard:        at-least-once, no ordering.            → idempotent consumer required.
SQS FIFO:            exactly-once *delivery* within 5 min,  → still treat as at-least-once
                     per MessageGroupId.                       outside that window.
RabbitMQ (ack mode): at-least-once.                          → idempotent consumer required.
Kafka (default):     at-least-once.                          → idempotent consumer required.
Kafka EOS:           exactly-once *between Kafka topics*     → still at-least-once if you
                     within one transaction.                    write to a DB or call HTTP.
```

## Per-broker cheat sheet

Behaviors that bite. Verify against current docs — defaults change.

### In-process channel (Go chan, Node, Python asyncio)
- **Durability:** none. Restart = lost.
- **Delivery:** at-most-once.
- **Ordering:** preserved per channel.
- **DLQ:** none — handle errors at the consumer.
- **Use when:** you want to decouple two pieces of code in the same process, and you'd accept the loss if the process died. Almost always paired with a graceful-shutdown drain.

### SQS Standard
- **Durability:** durable; replicated.
- **Delivery:** at-least-once.
- **Ordering:** none. Out-of-order is normal, not an edge case.
- **DLQ:** first-class. Configure a redrive policy with max receives.
- **Visibility timeout:** explicit; extend with `ChangeMessageVisibility`.
- **Use when:** point-to-point work, AWS-native, fine with no global ordering.

### SQS FIFO
- **Durability:** durable.
- **Delivery:** exactly-once delivery within a 5-minute deduplication window, per `MessageGroupId`.
- **Ordering:** preserved within a `MessageGroupId`. Across groups: parallel and unordered.
- **DLQ:** first-class.
- **Caveat:** throughput is much lower than Standard; the 5-minute dedup window is **not** a substitute for an idempotent consumer.

### RabbitMQ
- **Durability:** depends on queue + message flags. Confirm `durable: true` queues + `persistent` messages + `publisher confirms`.
- **Delivery:** at-least-once with consumer acks (always set `manual_ack`).
- **Ordering:** per-queue, single consumer. Multiple consumers on the same queue → no ordering.
- **DLQ:** dead-letter exchange (`x-dead-letter-exchange`) — configure per queue.
- **Caveats:** auto-ack is a footgun for anything that matters. Mirrored queues and quorum queues have very different durability guarantees — pick consciously.

### Kafka
- **Durability:** durable. Configure `acks=all` and a replication factor of 3 for anything important.
- **Delivery:** at-least-once by default. The **idempotent producer is on by default since Kafka 3.0** (no duplicate writes from producer retries within a session). **End-to-end exactly-once** requires three things together: idempotent producer + transactional producer (`transactional.id`) + consumer with `isolation.level=read_committed`. This works for Kafka-to-Kafka topology only — the moment you write to an external DB or call HTTP, you're back to at-least-once and need the outbox (see [[outbox]]).
- **Cluster mode:** **KRaft (Kafka Raft) is the only supported mode from Kafka 4.0 (March 2025) onward.** ZooKeeper was removed entirely; ZK-backed clusters lost upstream support in late 2025. Any new Kafka cluster is KRaft. Existing ZK clusters must migrate.
- **Ordering:** per partition. Use a stable partition key to keep one entity's events in one partition.
- **DLQ:** **not built in.** You implement it: catch in the consumer, publish to a `*-dlq` topic, then commit.
- **Offsets:** turn off auto-commit for anything that matters. Commit only after the work is durable.
- **Use when:** you need a replayable log, multiple consumer groups, or high throughput with per-key ordering.

### Redis Streams
- **Durability:** depends on Redis persistence config (AOF/RDB). Treat as durable only if you've configured it that way and have replication.
- **Delivery:** at-least-once via consumer groups + `XACK`.
- **Ordering:** preserved per stream.
- **DLQ:** not built in; use the pending entries list (PEL) + `XCLAIM` for redrive, or your own DLQ stream.
- **Use when:** you're already running Redis, throughput needs are moderate, you don't need partitioning.

### Google Pub/Sub
- **Durability:** durable.
- **Delivery:** at-least-once. (There's an "exactly-once" mode — read the docs; it has limits.)
- **Ordering:** off by default; opt in with ordering keys, which constrains throughput.
- **DLQ:** first-class (dead letter topic, max delivery attempts).

### NATS / NATS JetStream
- **Plain NATS:** at-most-once, no persistence. Don't use for anything you care about losing.
- **JetStream:** durable, at-least-once, ack-based, with DLQ-like features. Use this if you're on NATS and need durability.

### BullMQ (Redis), Sidekiq (Redis), Celery
- Task queues with retries, scheduled jobs, and built-in worker pools. Built on Redis (mostly).
- **Delivery:** at-least-once.
- **Ordering:** not guaranteed across workers; jobs are independent.
- **DLQ:** "failed jobs" set; some support automatic DLQ-like behavior. Configure max attempts and inspection.
- **Use when:** you want batteries-included background jobs without standing up a separate broker.

### DB-backed job table (pg-boss, Oban, Que, hand-rolled)
- **Durability:** as durable as your DB.
- **Delivery:** at-least-once via row locking (`SELECT ... FOR UPDATE SKIP LOCKED`).
- **Ordering:** by `created_at` or `priority`; you control it in the query.
- **DLQ:** a `failed_jobs` table or `status='dead'` flag — you build it.
- **Transactional with DB writes:** yes, naturally. This is the killer feature — no outbox needed for use cases that only emit work to themselves, because the job insert is in the same DB transaction as the state change.
- **Limits:** polling adds latency (LISTEN/NOTIFY helps); throughput ceiling is your DB's write throughput; doesn't scale to fan-out across services.
- **Use when:** your team already runs Postgres well, throughput is moderate, and you want fewer moving parts.

## Principle 6, in full: ordering is opt-in, not a default

**Rule:** Most brokers do not preserve global message order. If your handler assumes order, prove the broker delivers it for the keys you care about — or make the handler order-tolerant.

**Why:** "Process in the order sent" is the most-broken hidden assumption in queue code. SQS Standard is unordered; RabbitMQ preserves per-queue order but not across workers; Kafka guarantees order **per partition**, not per topic. Code that worked with one worker breaks the day you add a second.

**How to apply:**
- Ask "for what subset of messages does order need to hold?" — almost never *all* of them. Order usually matters per-entity (this user's events in order; this order's state transitions in order), not globally.
- Route by **partition key / message group ID** so all messages for one entity go to one partition/consumer. Kafka partition key, Kinesis shard key, SQS FIFO `MessageGroupId`, RabbitMQ consistent-hash exchange.
- For SQS-style queues, **SQS FIFO** gives ordering within a `MessageGroupId`. Standard SQS does not — don't assume.
- Better than ordering: make the handler **version-aware** or **commutative** so out-of-order delivery is safe. Carry a monotonic version (`updated_at`, `seq`) on the message; the consumer applies a state change only if its version is newer than what's stored. Two messages arriving out of order produce the same final state.
- Global ordering = one consumer = a bottleneck. If you genuinely need it, name it explicitly and accept the throughput ceiling.

**Example (TypeScript, version-aware consumer):**
```ts
// Out-of-order safe: stale messages are dropped, latest wins.
async function applyUserUpdate(msg: UserUpdatedMessage) {
  // Conditional update on version: only apply if msg is newer than what we have.
  const result = await db.query(
    `UPDATE users SET name=$1, version=$2
     WHERE id=$3 AND version < $2`,
    [msg.name, msg.version, msg.userId],
  )
  // rowCount === 0 means a newer update already landed; this one is stale. Drop it.
  if (result.rowCount === 0) return
}
```

## Common selection mistakes

- **Using Kafka as a task queue.** Kafka is a log; it doesn't have per-message ack/redelivery semantics. Treating it as a task queue means you reinvent retries, DLQ, and ack tracking by hand — and you'll do it worse than SQS/BullMQ already does.
- **Using SQS as an event log.** SQS doesn't replay. Once a message is acked, it's gone. If you ever want "replay the last 24 hours to a new consumer," you needed Kafka.
- **Using Redis Pub/Sub for anything durable.** Redis Pub/Sub is fire-and-forget — subscribers connected at publish time get the message; everyone else doesn't. Use Redis Streams instead if you need durability.
- **Standing up Kafka for 10 messages/minute.** Operational cost is wildly out of proportion. A DB-backed job table or SQS is almost always the right answer at that scale.
- **In-process channel for cross-service coordination.** If the producer and consumer are in different processes (or different machines), an in-memory queue is not a queue — it's a memory leak with extra steps.

## How to decide quickly

When in doubt, this is the order I'd try:

1. Can it be a **DB-backed job table**? If yes, default to that — fewer moving parts, transactional with your data.
2. Otherwise, is it **point-to-point work**? Use SQS / BullMQ / Sidekiq.
3. Otherwise, is it **fan-out to N independent consumers**? Use Pub/Sub (SNS+SQS, Google Pub/Sub) or RabbitMQ fanout.
4. Otherwise, do you need **replayable history or per-key ordering at scale**? Use Kafka.
5. Same process, loss-tolerant? In-process channel.

If you can't justify a more complex broker in one sentence, drop to the next-simpler option.
