---
name: concurrency-fundamentals
description: Design or review in-process concurrency involving threads, async tasks, event loops, shared mutable state, locks, atomics, cancellation, or bounded parallelism. Use before code whose correctness depends on interleaving. Use queue-fundamentals for cross-process async and database-fundamentals for transactional writer conflicts. Skip sequential code and pure immutable transformations.
---

# Concurrency fundamentals

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
