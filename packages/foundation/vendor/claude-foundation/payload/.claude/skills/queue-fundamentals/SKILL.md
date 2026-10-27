---
name: queue-fundamentals
description: "Design, implement, review, or debug cross-process asynchronous work: brokers, streams, jobs, workers, pub/sub, and DB-backed queues. Covers queue shape, delivery semantics, idempotency, acknowledgement, retries/DLQ, ordering, backpressure, and transactional outbox. Use after architecture-fundamentals decides an async boundary belongs. Skip in-process async; use concurrency-fundamentals there."
---

# Queue fundamentals

Use this as the primary skill when work crosses a process through durable async
delivery. Treat at-least-once delivery as the default unless the broker contract
proves otherwise.

## Rules

1. Name the purpose before choosing technology: task queue, buffer, pub/sub,
   replayable log, or DB-backed job table.
2. State delivery semantics and the loss/duplication window. Never claim
   end-to-end exactly-once across independent systems.
3. Make every consumer idempotent through a natural operation, conditional
   write/version, or durable deduplication key.
4. Acknowledge only after the intended effect is durable. Set or extend the
   visibility/lease timeout beyond expected work duration.
5. Classify transient versus permanent failure; cap attempts, add backoff with
   jitter, route poison messages to a DLQ, and define replay ownership.
6. Assume no global order. Partition by the smallest required ordering key or
   make processing commutative/version-aware.
7. Never dual-write a database and broker. Use a transactional outbox or CDC;
   keep consumers idempotent because relay delivery can repeat.
8. Bound producers and consumers, expose lag/age/saturation, and apply
   backpressure before overload becomes unbounded storage.

## Contract to record

Capture purpose, schema owner/version, delivery semantics, idempotency key,
ack point, retry/DLQ/replay policy, ordering key, capacity limit, and SLI in the
active OpenSpec design. Let the harness execute configured evidence; do not
create a separate queue checklist artifact.

References: read `broker-selection.md` for shape/delivery/ordering;
`idempotency.md` for consumer design; `operating.md` for ack, retry, DLQ,
backpressure, and telemetry; and `outbox.md` for DB-plus-broker writes.

Use `database-fundamentals` for outbox/dedup schema and transactions,
`api-design-fundamentals` for published message contracts, and
`observability-fundamentals` when runtime failure visibility changes.
