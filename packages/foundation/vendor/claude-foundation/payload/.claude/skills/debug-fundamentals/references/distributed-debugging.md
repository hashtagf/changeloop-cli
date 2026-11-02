# Distributed-system debugging

Single-process bugs are about *what*; distributed bugs about *when*, *where*, and *in what order*. The hardest prod bugs share a few recurring shapes — recognizing the shape early saves hours.

## First move: correlate

Get a **correlation id** (request / trace / job id) through the system so you can pull "everything that touched this one request, across all services." Use the existing one (`X-Request-Id`, OTel `traceparent`) or add one: generated at the edge, propagated on every outbound call (HTTP/message header, RPC metadata), logged on every line, surfaced in error responses. No correlation id = reading nine log streams and squinting. Missing mid-investigation? Add one — the next incident benefits.

## The common shapes

Run through these as a checklist; the symptom usually matches one.

**Duplicate delivery** — consumer ran twice (double charge, double insert/email).
- Tells: same message id, two timestamps; "impossible" `UNIQUE` violation; counter jumps by 2.
- Cause: at-least-once delivery + non-idempotent consumer ([[queue-fundamentals]] P3).
- Fix: make the consumer idempotent — `INSERT ... ON CONFLICT DO NOTHING`, dedup table on a natural key, idempotency-key column. Not in the producer; brokers don't do true exactly-once.

**Lost message** — sent (or "appeared sent"), never processed.
- Tells: API returned 200 but no consumer log; source row without downstream row; producer count > consumer count.
- Causes (likeliest first): send failed at broker, app didn't check (un-awaited promise, ignored error); dual-write inconsistency (DB ok, broker failed — see queue-fundamentals outbox); ack-on-receive then crash; wrong topic/partition/queue.
- Fix: outbox, or ack-after-process, or fix the subscription — not a blind retry loop.

**Out-of-order processing** — update before create, cancel before charge.
- Tells: "state went backwards"; created arrives after updated; retries scramble order.
- Causes: no global order guarantee (retries with backoff reorder; multiple producers, no shared clock).
- Fix: partition by the entity needing order (user/order id) so its events share a partition; or make the consumer order-independent (process by timestamp, LWW + versioning, state as a fold of events).

**Race (read-modify-write)** — two requests read, both modify, second write clobbers.
- Tells: "count wrong by one"; double charge; `count = count + 1` in app code not SQL.
- Fix: push into one DB statement (`UPDATE accounts SET balance = balance - 100 WHERE id = ?`); or `SELECT ... FOR UPDATE`; or optimistic lock (`UPDATE ... WHERE version = ?`, check rowcount); or single-consumer-per-key partitioning. ([[database-fundamentals]], [[queue-fundamentals]].)

**Time-skew / clock** — hosts disagree on time, or a clock jumped (NTP, VM pause, DST).
- Tells: timestamps go backwards; token expires before issued; scheduled job runs twice/zero around DST; "works in UTC, breaks on a local-time host."
- Fix: UTC everywhere internally, convert only at the edge; monotonic clocks for *durations*, wall clocks for *points in time*; compare cross-host times with a tolerance; prefer "expires = issue + duration" over an absolute time.

**Retry storm / cascading failure** — one service degrades, clients retry, retries amplify load, system topples.
- Tells: B's latency spikes while A/C/D CPU all spike; error rates climb together with no shared deploy; no recovery even after the root cause is fixed.
- Fix: bounded retries with exponential backoff *and jitter* (three, not unlimited); circuit breakers; backpressure / load-shed; never retry 4xx.

**Partial failure / split brain** — halves of the system disagree.
- Tells: two replicas both claim primary; `status=charged` in one service, `pending` in another; flag true in cache, false in DB.
- Fix: one source of truth, others are derived views that reconcile; on drift, the source wins and the rest rebuild.

## Investigation flow

1. Get the correlation id of **one** failing case (one request id, one timestamp).
2. Pull every log line with that id across all services; sort by timestamp — that's your timeline.
3. Walk it forward; at each step ask "is this what I expected?" The first surprise is where to dig.
4. Match the surprise to a shape above.
5. Form one hypothesis; run the smallest experiment that distinguishes shape X from Y.

Finish one case before starting the next.

## Anti-patterns

- "It's a flake, just retry" — flakes are bugs; retries are the cope.
- Adding retries before understanding *why* it failed — that's how duplicate-charge incidents are born.
- Reading one service's logs — the bug is at the boundary, which is in two services.
- Trusting "the API returned 200" — that means "accepted," not "the work happened." Check the side effect.
- Debugging without a correlation id — stop, add one, resume.

## Relation

- [[queue-fundamentals]] — duplicate / lost / out-of-order / retry-storm are queue concerns; the fix lives there.
- [[database-fundamentals]] — races and partial failures often want a transaction or constraint.
- [[hexagonal-backend]] — boundary bugs; the adapter is where serialization, retries, and timeouts live.
