# Operating queues in production

Companion to principle 5 of [[queue-fundamentals]]. Use when wiring up retries, dashboards, DLQ handling, or shaping messages. Most queue incidents are operational — these controls turn a queue from a liability into load-bearing infrastructure.

## Principle 4, in full: ack only after the work is durably done — and respect the visibility timeout

**Rule:** Acknowledge a message *after* its effect is durable. Until then, the broker should consider the message in-flight and redeliver it if you crash. If your work might exceed the broker's visibility timeout, extend it explicitly.

**Why:** **Ack-before-work** loses messages on crash (broker thinks done, work never ran). **Ack-after-work** is correct but causes duplicates on crash — exactly what principle 3 handles. Third trap: the visibility timeout. A broker hides a delivered message for a window; miss the window and it redelivers. A 30-second timeout on a 5-minute job means the job runs three times in parallel.

**How to apply:**
- Ack pattern: receive → do work → write result → **then** ack. Never the other order.
- Set the visibility timeout longer than your p99 work time, with margin. If work time is unpredictable, **heartbeat / extend** the visibility window from inside the handler.
- For long-running jobs (minutes+), consider a "claim" model: write `job.status='running', claimed_at=now()` in your DB before starting, and have a separate watchdog reclaim stuck jobs by timestamp, independent of the broker's visibility timeout.
- Never `await broker.ack()` inside a `try` block whose `catch` is wide — a thrown exception after ack leaves you in an "acked but unfinished" state, which is silent message loss.
- For Kafka, the analog is **commit offsets after** the work is durable, not on every poll. Auto-commit is a footgun; turn it off for anything that matters.

**Example (Go, SQS-style):**
```go
// Bad — acks before the side effect commits. Crash between ack and DB write loses the message.
func handle(ctx context.Context, msg Message) error {
    if err := broker.Ack(ctx, msg); err != nil { return err }
    return processAndSave(ctx, msg) // if this panics, message is gone
}

// Good — ack only after the durable effect is committed.
func handle(ctx context.Context, msg Message) error {
    if err := processAndSave(ctx, msg); err != nil {
        return err // do not ack; broker will redeliver after visibility timeout
    }
    return broker.Ack(ctx, msg)
}

// Better — for long work, extend visibility while we run, then ack at the end.
func handleLong(ctx context.Context, msg Message) error {
    stop := startHeartbeat(ctx, msg, 20*time.Second) // extend visibility every 20s
    defer stop()
    if err := processAndSave(ctx, msg); err != nil {
        return err
    }
    return broker.Ack(ctx, msg)
}
```

## Principle 5, in full: plan for poison messages — retries, backoff, and a dead-letter queue

**Rule:** Every consumer needs three numbers and one destination: max attempts, backoff strategy, jitter, and a DLQ. Decide these before the first message flows.

**Why:** Some messages will always fail — bad payloads, schema drift, deleted references. Without a cap, a single poison message spins forever and starves healthy ones. Without backoff, a downstream blip becomes a thundering herd. Without a DLQ, you have no visibility and no replay path after a fix. These are not optional; they are the operational floor.

**How to apply:**
- **Cap retries.** Pick a max attempts (commonly 3–10 depending on side-effect cost). After the cap, send the message to a DLQ instead of retrying forever.
- **Exponential backoff with jitter.** Doubles the gap on each retry (1s, 2s, 4s, 8s...) plus a random fraction so retries don't synchronize across consumers. Most brokers support this natively; turn it on.
- **Distinguish retryable from permanent errors.** A 5xx from a downstream service or a network timeout is retryable. A schema-validation failure or a 4xx from a downstream is not — those should DLQ on the first attempt. Retrying a permanent failure is just delaying the inevitable while wasting attempts.
- **DLQ is a human inbox.** Alert on DLQ depth > 0 (or > N for noisier systems). Have a runbook for triaging: inspect payload, fix the bug or the data, redrive. A DLQ nobody watches is the same as no DLQ.

**Example (config sketch):**
```yaml
consumer:
  max_attempts: 5
  backoff:
    initial: 1s
    multiplier: 2
    max: 5m
    jitter: 0.2          # ±20% randomization
  dead_letter:
    target: orders-dlq
    on:
      - any error after max_attempts
      - SchemaValidationError on first attempt   # don't retry permanent errors
      - DependencyDeletedError on first attempt
alerts:
  - dlq_depth > 0 for 5m   → page on-call
  - oldest_message_age > 1h → page on-call
```

## Retries: the three numbers and one destination

Configure all four before the first message flows:

1. **Max attempts** — idempotent/cheap: 5–10; operations with external side effects (charges, emails): 3–5.
2. **Backoff strategy** — exponential: `delay = base * 2^attempt`. Cap max delay (5–15 min) so the queue doesn't go dormant after a few failures.
3. **Jitter** — randomize (`delay * (1 ± 0.2)`) so retries from many consumers don't synchronize into a thundering herd.
4. **DLQ target** — once max attempts is hit, the message goes here. Required, not optional.

**Worked example:**
```
attempt 1: try immediately
attempt 2: wait  1s ± 20%
attempt 3: wait  2s ± 20%
attempt 4: wait  4s ± 20%
attempt 5: wait  8s ± 20%
            └→ if still failing, route to DLQ
```

### Retryable vs permanent

- **Retryable:** transient failures, timeouts, 5xx, network errors, rate limits, lock contention.
- **Permanent:** schema validation failures, 4xx, missing fields, references to deleted entities. Retrying will fail the same way; DLQ on the **first** attempt — don't waste 5 retries with backoff before a human can inspect it.

**Pattern:**
```ts
async function handle(msg: Message) {
  try {
    await process(msg)
  } catch (e) {
    if (isPermanent(e)) {
      // Short-circuit: go straight to DLQ. No retry will help.
      await broker.deadLetter(msg, { reason: e.message })
      return
    }
    throw e // let the broker retry with backoff
  }
}

function isPermanent(e: unknown): boolean {
  return (
    e instanceof SchemaValidationError ||
    e instanceof EntityNotFoundError ||
    (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)
  )
}
```

## The DLQ is a human inbox

A DLQ nobody watches is the same as no DLQ. Alert on it, triage it, drain it.

**Alerting thresholds (tune to traffic):**
- **DLQ depth > 0 for 5 minutes:** page. One message means something is broken.
- **Oldest message age > 30 minutes:** page. Redrive policy is working but nobody's looking.
- **DLQ growth rate > 0:** slope alert is more useful than a count threshold when volume is high.

**Triage runbook:**
1. **Look at a sample message.** Topic, headers, payload. Most DLQs have a one-shape problem ("all the bad messages are from publisher X after the schema change").
2. **Classify:** bug in the consumer, bad data from the producer, downstream-permanent-fail, or stale reference (entity deleted).
3. **Fix the cause.** Don't just redrive — redriving without a fix sends them back through the same broken path.
4. **Redrive in batches.** Most broker UIs / CLIs support "move N messages from DLQ back to main." Move in small batches, watch them succeed, then move more.
5. **Document the incident** if it's not trivial. The pattern of DLQ causes over time tells you what to invest in (validation, schemas, dead-link detection).

**Never:**
- Re-enqueue silently on a timer — hides recurring bugs.
- Delete DLQ messages without inspection — you're discarding the only signal.
- Treat DLQ as overflow — it's for **failing loudly**, not for waiting in line.

## Backpressure: bound your queues

Unbounded queues become latency black holes — work piles up, oldest-age grows, and the system looks healthy (accepting!) until everything downstream times out.

**Four strategies, ordered by aggressiveness:**

1. **Reject new producers** (return an error / 429 / 503). Best when callers can retry, like external API clients you control. Honest about overload.
2. **Slow producers** (apply rate limits at the producer side). Best when producers are internal services you can ask to behave.
3. **Shed load** (drop or sample messages). Best for low-value telemetry where some loss is preferable to lag.
4. **Drop oldest** (keep the newest N messages, evict the rest). Best when stale messages are useless — fresh metrics, live state syncs.

**Pick consciously.** "Accept everything and pray" is the worst option.

**Where to set the bound:**
- Per-queue max depth (broker-supported on most queues).
- Per-queue max age (oldest message > N seconds → reject incoming).
- Producer-side rate limit (token bucket on the publish call).
- Concurrency limit at the consumer (only N workers; if more work piles up, queue depth grows and signals upstream).

## Observability: the four signals

Every queue needs dashboards for these four:

1. **Queue depth** — trending up = consumers can't keep up.
2. **Consumer lag** — for log-based brokers (Kafka, Kinesis): how far behind each consumer group is.
3. **Age of oldest unacked message** — the most honest signal. Depth 1000 / oldest-age 30s is healthier than depth 100 / oldest-age 10 min.
4. **Error rate / DLQ growth** — "are we failing more than baseline?" Catches regressions.

**Secondary signals worth tracking:**
- Processing latency (p50/p95/p99 per consumer).
- Throughput (messages/sec into the queue and out).
- Retry rate (messages on attempt > 1 / total).
- Visibility-extension count (consumers heartbeating because work is slow).

**Alerting starter pack:**
- `queue_depth > N` sustained for 5 min → warning, 15 min → page.
- `oldest_unacked_age > 5 min` → warning. → 30 min → page.
- `consumer_lag > threshold` (Kafka) → page.
- `dlq_depth > 0 sustained` → page.
- `error_rate > 3x baseline` for 5 min → page.

Tune N and timeouts to your traffic, but configure all five from day one.

## Message hygiene

### Keep messages small

- **Under ~256 KB** is a safe heuristic; some brokers have hard limits below 1 MB.
- For blobs (image, file, large JSON), use the **claim-check pattern**: store in object storage (S3, GCS), send only the URL + small metadata header. Consumers fetch on demand.

### Treat the message schema as a public API

Once a message has more than one consumer, the schema is a contract.

- **Add fields with safe defaults** — old consumers ignore unknowns.
- **Never rename or remove fields silently** — add new field, dual-write for a deprecation window, then remove the old.
- **Version explicitly** on breaking changes (`topic.v2` or `schemaVersion` field).
- **Use a schema registry** (Avro/Protobuf + Confluent Schema Registry) once you have more than a handful of topics — catches breaking changes at publish time, not at 2 AM.

### Required headers

Every message should carry, at minimum:

- **Message ID** — stable across redeliveries, used by consumers for idempotency. See [[idempotency]].
- **Trace ID** — for distributed tracing across producer → broker → consumer.
- **Schema version** — even if implicit in the topic name, store it on the message for safety.
- **Created-at timestamp** — for measuring end-to-end latency and detecting old messages.

These are cheap to add up front and painful to retrofit.

## Putting it together: a launch checklist

Before a new queue path goes to production, verify all of these:

- [ ] Max attempts, backoff, jitter, and DLQ configured.
- [ ] Permanent errors short-circuit to DLQ on first attempt.
- [ ] Dashboards exist for depth, oldest-age, consumer lag, DLQ depth, error rate.
- [ ] Alerts wired for sustained depth, oldest-age, and DLQ > 0.
- [ ] Bound on queue depth or producer rate; explicit backpressure strategy chosen.
- [ ] Visibility timeout > p99 work time, or consumer heartbeats to extend.
- [ ] Message payloads under broker limit; claim-check for anything blob-shaped.
- [ ] Required headers (message ID, trace ID, schema version, created-at) populated.
- [ ] DLQ triage runbook exists and is linked from the alert.

If any of these is "no" or "I don't know," fix it before traffic.
