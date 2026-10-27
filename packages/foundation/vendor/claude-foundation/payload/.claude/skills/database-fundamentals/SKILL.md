---
name: database-fundamentals
description: Design or change schemas, queries, indexes, transactions, migrations, ORM mappings, or other durable state. Covers constraints, query-shaped indexes, plans, N+1, isolation, concurrency, and compatible rollout. Skip throwaway storage and read-only ad-hoc queries with no shipped effect.
---

# Database fundamentals

Use this as the primary skill when persistence is the main design constraint.

## Rules

1. Model domain facts with precise types, nullability, keys, and normalized
   ownership. Denormalize only for a measured read path.
2. Put durable invariants in constraints: `NOT NULL`, `UNIQUE`, foreign keys,
   and checks. Application validation improves errors but is not the final
   guard.
3. Design indexes from real predicates, joins, ordering, and cardinality.
4. Inspect the query plan and representative data before claiming performance.
5. Prevent N+1 deliberately through batching, joins, or bounded preloading.
6. Define the transaction boundary around one business invariant and choose the
   weakest isolation level that still preserves it. Handle retries explicitly.
7. Migrate compatibly: expand, backfill in bounded batches, switch, verify,
   contract. State rollback and lock/write-amplification risk.

## Check before finishing

- Can concurrent writers violate an invariant?
- Does each important query have an explainable access path?
- Are timeouts, retries, idempotency, and partial failure defined?
- Can old and new application versions overlap during rollout?
- Is migration progress and failure observable?

Record compatibility, backfill, lock/load risk, rollback/forward-fix, and the
provider that proves each data claim in the active OpenSpec change. Never use a
schema migration as an implicit application deployment or a manual proof step.

References: `references/schema-design.md`, `indexing.md`,
`query-performance.md`, `transactions.md`, and `migrations.md`. Read only the
matching file.
