# Indexing

Moved from `SKILL.md` — principle 3's full detail: matching indexes to the queries you actually run.

## Principle 3 (from SKILL.md): Indexes match queries, not tables

**Rule:** Index for the queries you actually run. Composite indexes are ordered — the column order matters. Don't index every column; writes pay the cost.

**Why:** The right index turns O(n) scans into O(log n); every index taxes every write. Right indexes turn 10s into 10ms; wrong ones slow writes with no read benefit.

**How to apply:**
- Read the `WHERE`, `JOIN`, and `ORDER BY` clauses of your hottest queries. Those columns — together — are your index candidates.
- A composite index on `(a, b, c)` accelerates queries that filter on `a`, or `a AND b`, or `a AND b AND c`. It does **not** help a query that filters only on `b` or only on `c`. The leftmost prefix rule. Put the most-filtered column first.
- High-selectivity columns (`user_id`, `email`) benefit more from indexing than low-selectivity ones (`status` with three values, `is_active` boolean) — for low-selectivity, prefer composite or partial indexes.
- A foreign key column should almost always be indexed. The database does not index `REFERENCES` columns for you automatically (Postgres doesn't; MySQL InnoDB does). Without it, deletes/updates on the referenced parent scan the child table.
- Index on what the query already filters by, not on what feels important. `created_at` is rarely the right index unless you actually order by or filter on it.
- See `references/indexing.md` for composite ordering, covering indexes, partial indexes, when not to index, and how to find unused indexes.

**Example:**
```sql
-- Query: list a user's recent orders for a given status
SELECT * FROM orders
WHERE user_id = $1 AND status = $2
ORDER BY placed_at DESC
LIMIT 20;

-- Bad — single-column index, can use it but still sorts in memory
CREATE INDEX ON orders (user_id);

-- Better — composite matches the WHERE; sort still happens
CREATE INDEX ON orders (user_id, status);

-- Best — index supports filter AND order, no sort step
CREATE INDEX ON orders (user_id, status, placed_at DESC);
```

## The two rules that catch most engineers

### 1. The leftmost prefix rule

A composite index on `(a, b, c)` can serve queries that filter on:
- `a`
- `a AND b`
- `a AND b AND c`

It **cannot** serve queries that filter on:
- `b` alone
- `c` alone
- `b AND c`

The columns are concatenated in order; the index is a tree sorted by `a`, then within each `a` value by `b`, then by `c`. You can use a tree if you know where to start at the top — which means you need the leftmost columns.

**Implication for ordering:** put the most-selective and most-frequently-filtered column first. A composite `(tenant_id, status)` for a multi-tenant app makes sense; `(status, tenant_id)` rarely does.

### 2. Range filters consume the rest

Once a composite index hits a range filter (`<`, `>`, `BETWEEN`, `LIKE 'foo%'`), it can't use columns to the *right* of that filter for further narrowing — only for sorting or as covering data.

```sql
-- Index: (user_id, placed_at, status)
SELECT * FROM orders
WHERE user_id = $1 AND placed_at > $2 AND status = 'paid';
-- Index narrows by user_id, then by placed_at range.
-- status filter cannot use the index — it's checked post-scan.

-- Better index for this query:
CREATE INDEX ON orders (user_id, status, placed_at);
-- Now equality on (user_id, status) narrows tightly,
-- then placed_at range scan within that.
```

Equality first, range last.

## Covering / index-only scans

If the index contains every column the query needs (both filter and `SELECT` list), the database can answer entirely from the index without touching the table. That's the cheapest possible read.

```sql
-- Query
SELECT id, total_cents FROM orders WHERE user_id = $1 AND status = 'paid';

-- Plain index — finds the rows but must visit the heap for total_cents
CREATE INDEX ON orders (user_id, status);

-- Covering index — adds total_cents as INCLUDE column (Postgres syntax)
CREATE INDEX ON orders (user_id, status) INCLUDE (total_cents, id);
-- Postgres can do an Index Only Scan: never touches the table.
```

Don't over-include — every column inflates index size, cache pressure, and write cost. Cover hot, read-heavy queries only.

## Partial indexes

Index only the rows you actually query. Massive wins when one value dominates the table.

```sql
-- 99% of users are 'active'; you only ever query the other 1%
CREATE INDEX ON users (created_at) WHERE status = 'suspended';
-- Index is tiny, query is fast, the 99% pay nothing on write to this index.

-- Soft-delete pattern: index only live rows
CREATE INDEX ON orders (user_id, placed_at) WHERE deleted_at IS NULL;
```

Partial indexes are also how you make `UNIQUE` work conditionally: `CREATE UNIQUE INDEX ON users (email) WHERE deleted_at IS NULL` lets soft-deleted rows free up the email.

## Index types beyond B-tree

Default index is B-tree — good for equality, ranges, and ordering. Other index types exist for non-default access patterns:

- **Hash** — equality only, slightly faster than B-tree for that one use case. Postgres B-tree is usually fine; rarely worth choosing hash.
- **GIN** — for inverted lookups: full-text search, JSONB containment (`@>`), array membership. The right answer when you want "is X in this array/document?"
- **GiST / SP-GiST** — for geometric, range, and nearest-neighbor queries.
- **BRIN** — block range index. Tiny, useful when data is physically clustered by the indexed column (e.g., append-only logs ordered by `created_at`). Cheap to maintain, less precise than B-tree.

If you don't know which to pick, the answer is B-tree.

## Foreign keys need indexes

Postgres does **not** auto-index foreign-key columns (MySQL InnoDB does). Without one, parent deletes/updates scan the child table — O(log n) becomes O(n), holding row locks throughout.

```sql
CREATE TABLE order_items (
  order_id  UUID REFERENCES orders(id),
  ...
);
-- Without this, DELETE FROM orders WHERE id = $1 scans order_items.
CREATE INDEX ON order_items (order_id);
```

## When NOT to add an index

- **Small tables** (~10k rows or fewer) — seq scan is faster; optimizer ignores the index anyway.
- **Low-selectivity columns** alone (`is_active` boolean) — use composite or partial instead.
- **Heavy-write, rarely-read columns** — every index taxes every write.
- **Before measuring** — run the query, check the plan, add only if there's a meaningful seq scan.

## How to find unused indexes (Postgres)

```sql
-- Indexes that have never been read since stats reset
SELECT
  schemaname || '.' || relname AS table,
  indexrelname AS index,
  pg_size_pretty(pg_relation_size(i.indexrelid)) AS size,
  idx_scan AS scans
FROM pg_stat_user_indexes i
JOIN pg_index USING (indexrelid)
WHERE idx_scan = 0 AND NOT indisunique
ORDER BY pg_relation_size(i.indexrelid) DESC;
```

Zero scans since the last stats reset → candidate for dropping. Confirm no infrequent batch job uses it first.

## Diagnostic flow when adding an index

1. Find the slow query. (Postgres `pg_stat_statements`, MySQL slow query log.)
2. Run `EXPLAIN ANALYZE` on it.
3. Identify the seq scan or the sort that's costing the most.
4. Propose an index: equality columns first, range/order columns next, included columns if covering helps.
5. Add it (`CREATE INDEX CONCURRENTLY` in Postgres on big tables).
6. Re-run `EXPLAIN ANALYZE`. Confirm the planner uses it and the actual time dropped.
7. Don't keep indexes that didn't help — they're write tax forever.
