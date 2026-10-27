---
name: concurrency-fundamentals
description: "Design in-process async, threads, shared state, cancellation, atomicity, and bounded parallelism. Use when interleaving affects correctness. Record invariants and executable evidence in OpenSpec; skip harness worker scheduling, cross-process queues, and database isolation."
---

# Concurrency fundamentals

Test retries, partial failure, and restart ownership. PID alone cannot prove
a stale lock. Harness scheduling is not application concurrency.

Use this as the primary skill when multiple in-process activities can overlap.

## Rules

1. Avoid shared mutable state first; prefer immutability, ownership confinement,
   or message passing.
2. Protect every shared read-modify-write as one atomic operation using the
   narrowest suitable lock, atomic, CAS, or version check.
3. Prevent deadlock structurally: enforce lock order, minimize lock scope, avoid
   nested locks, and never hold a lock across unowned I/O.
4. Treat `async`/`await` as concurrency. Await or deliberately supervise every
   task, choose sequential versus parallel execution explicitly, and keep CPU
   work off the event loop.
5. Propagate cancellation and deadlines. Release locks/resources and define how
   partial effects unwind when work stops.
6. Bound in-flight work to the real bottleneck with a semaphore, pool, or
   backpressure; avoid unbounded fan-out.
7. Design correctness independent of timing, then use deterministic interleaving
   tests, stress tests, and race detectors as evidence.

## Check before finishing

- Who owns each mutable value, and which operation is atomic?
- Can any lock acquisition form a wait cycle?
- Are task errors, cancellation, and cleanup observable?
- Is concurrency capped and overload behavior explicit?
- Does the test force a bad interleaving without sleeps?

Record material invariants and failure expectations in the active OpenSpec
change; let project test/race-detector providers produce proof.

Reference: read `references/shared-state-and-async.md` for lock/atomic/CAS
selection, deadlock recipes, async pitfalls, bounded patterns, and examples.
