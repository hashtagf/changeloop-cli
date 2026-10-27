# Query Performance

Moved from `SKILL.md` — principles 4 and 5's full detail: reading the query plan before optimizing, and fetching in sets instead of loops.

## Principle 4 (from SKILL.md): Read the query plan before you guess

**Rule:** Before you decide a query is slow, before you add an index, before you "optimize" — run `EXPLAIN ANALYZE` and read the plan.

**Why:** Intuition is usually wrong. `EXPLAIN ANALYZE` shows what the planner actually chose and why. Optimizing without a plan is guessing.

**How to apply:**
- Use `EXPLAIN ANALYZE` (Postgres / MySQL 8) — runs the query and reports actual times and row counts. Plain `EXPLAIN` only shows the estimated plan, which is often wrong.
- Look for the operator type. `Seq Scan` on a large table is a red flag if you have a `WHERE`. `Index Scan` is good. `Index Only Scan` is best — the query is satisfied entirely from the index.
- Compare `rows=` estimated vs `actual rows=`. A 100x mismatch means the planner has stale statistics and is making bad decisions — `ANALYZE` the table or rebuild statistics.
- Look at the *bottom* of the plan first — that's where the data actually comes from. Costs and times accumulate upward.
- Don't optimize until you have a slow query in front of you with a plan to show why. "Premature optimization" applies to SQL too.
- See `references/query-performance.md` for reading plans, pagination patterns, and the slow-query diagnostic flow.

**Example:**
```sql
EXPLAIN ANALYZE
SELECT id, total_cents FROM orders
WHERE user_id = '...' AND status = 'paid'
ORDER BY placed_at DESC LIMIT 20;

-- Bad plan you want to NOT see:
-- Seq Scan on orders  (cost=0..100000 rows=200 actual rows=120)
--   Filter: (user_id = '...' AND status = 'paid')
--   Rows Removed by Filter: 1_000_000      ← scanned a million rows to find 120
-- → Add (user_id, status, placed_at DESC) index. Re-run. Confirm Index Scan.
```

## Principle 5 (from SKILL.md): Fetch in sets, not loops (N+1 is the bug that hides everywhere)

**Rule:** When you need data for many things, fetch it in one query, not one query per thing. The "loop and query" pattern is the most common database performance bug.

**Why:** [[programming-fundamentals]] complexity applied to I/O. One query returning 1000 rows is cheap; 1000 queries returning one row is 1000× slower. ORMs hide this via lazy-loading — `user.orders` fires a query per user unless you opt out.

**How to apply:**
- Whenever a function loops and calls the database inside the loop, stop. That's an N+1 candidate. Either join, or batch-fetch by IDs, or use a dataloader.
- ORM-side: every framework has the magic word. Sequelize `include`, Prisma `include`, Rails `includes`, SQLAlchemy `joinedload`/`selectinload`, Django `select_related`/`prefetch_related`, Hibernate `JOIN FETCH`, ActiveRecord `eager_load`. Learn the one for your stack and reach for it by default.
- Watch out for "looks like one query, actually N." `users.map(u => formatUser(u))` is fine. `users.map(u => formatUser(u, await getOrders(u.id)))` is N+1.
- For graph fetches across services, use the **dataloader pattern**: collect IDs during the request, fire one batch query, hand each consumer their slice.
- See `references/query-performance.md` for the specific N+1 patterns and fixes.

**Example:**
```ts
// Bad — N+1: one query for users, then one per user for orders
const users = await db.users.findAll()
for (const u of users) {
  u.orders = await db.orders.find({ userId: u.id })   // N queries
}

// Good — one query for users, one batched query for all orders
const users = await db.users.findAll()
const userIds = users.map(u => u.id)
const orders = await db.orders.find({ userId: { in: userIds } })  // 1 query
const ordersByUser = groupBy(orders, o => o.userId)
for (const u of users) u.orders = ordersByUser.get(u.id) ?? []

// Or, in one shot via the ORM
const users = await db.users.findAll({ include: { orders: true } })
```

## Reading EXPLAIN ANALYZE

`EXPLAIN ANALYZE` (Postgres / MySQL 8) runs the query and reports actual row counts and times. Plain `EXPLAIN` shows estimates only — often wrong.

A Postgres plan reads bottom-up. The leaf nodes (the bottom) fetch data; each parent processes its children's output; the top node returns to the client.

```
Limit  (cost=0..1.50 rows=20 width=...) (actual time=0.05..0.06 rows=20 loops=1)
  ->  Index Scan using orders_user_status_placed_idx on orders
        (cost=0..1.45 rows=24 width=...) (actual time=0.04..0.06 rows=20 loops=1)
        Index Cond: (user_id = $1 AND status = 'paid')
```

Things to look at:
- **Operator type** — is it `Seq Scan`, `Index Scan`, `Index Only Scan`, `Bitmap Heap Scan`, `Nested Loop`, `Hash Join`, `Sort`?
- **`actual rows` vs `rows`** — if estimated is 10 and actual is 10,000, the planner has bad stats and is making bad choices. Run `ANALYZE <table>`.
- **`loops`** — for a nested loop, the inner side's `actual time` is per-iteration; total cost is `time × loops`.
- **`Rows Removed by Filter`** — rows the scan read and threw away. A million rows removed by filter means you scanned a million rows; the index didn't narrow them.

## The operators, ranked from cheap to expensive

- **Index Only Scan** — query is satisfied entirely from the index, no table access. The cheapest.
- **Index Scan** — index narrows the rows, then heap fetch retrieves them.
- **Bitmap Heap Scan** — multiple indexes combined, or one index that returns many rows; reads the heap in physical order. Cheaper than `Index Scan` when fetching many rows.
- **Seq Scan** — reads every row of the table. Correct for small tables or when no index matches the filter. **Problematic on large tables.**
- **Nested Loop join** — fine when the outer side is small.
- **Hash Join** — usually fine, sometimes the right answer for big joins.
- **Merge Join** — both sides pre-sorted; appears when joining on indexed keys.

If you see `Seq Scan` on a million-row table with a selective `WHERE`, you're missing an index or the planner can't use the one you have (often a type mismatch — `WHERE user_id = '5'` against a `BIGINT` column will bypass the index).

## The N+1 antipattern

**The pattern:**
```py
users = User.objects.all()                  # 1 query
for user in users:
    print(user.profile.full_name)           # N queries — one per user
```

Each `user.profile` access fires a separate query. Hidden behind clean-looking attribute access.

**The fix:**
```py
# Django
users = User.objects.select_related('profile').all()
# 1 query, joined

# SQLAlchemy
users = session.query(User).options(joinedload(User.profile)).all()

# Prisma
const users = await prisma.user.findMany({ include: { profile: true } })

# Rails
users = User.includes(:profile).all
```

**The detection:**
- Most ORMs have a query logger or middleware that counts queries per request. Wire it up and watch for endpoints that fire dozens or hundreds.
- In Postgres, `pg_stat_statements` ranks queries by total time and call count. An N+1 always shows up as a tiny query that fired hundreds of thousands of times.

**The harder variant — N+1 across batches:**
```ts
async function loadOrdersWithCustomers(orderIds: string[]) {
  const orders = await db.orders.findMany({ where: { id: { in: orderIds } } })  // 1 query
  for (const o of orders) {
    o.customer = await db.customers.findUnique({ where: { id: o.customerId } }) // N queries
  }
}
```

Fix with a single batched query and an in-memory join:
```ts
const orders = await db.orders.findMany({ where: { id: { in: orderIds } } })
const customerIds = [...new Set(orders.map(o => o.customerId))]
const customers = await db.customers.findMany({ where: { id: { in: customerIds } } })
const byId = new Map(customers.map(c => [c.id, c]))
for (const o of orders) o.customer = byId.get(o.customerId)
```

For graph fetches across many call sites, use a **dataloader**: collect IDs during the request, fire one batch query per type at the end of the tick. Facebook's pattern, packaged as `dataloader` in Node and `aiodataloader` in Python.

## Pagination: keyset over offset

`OFFSET 10000 LIMIT 20` scales O(offset) — the DB fetches and discards 10,000 rows to return 20. Worsens with depth.

**Keyset pagination** uses the last seen value of the sort key as the cursor:

```sql
-- First page
SELECT * FROM orders WHERE user_id = $1 ORDER BY placed_at DESC, id DESC LIMIT 20;

-- Next page — cursor is the last row's (placed_at, id) from the previous page
SELECT * FROM orders
WHERE user_id = $1 AND (placed_at, id) < ($last_placed_at, $last_id)
ORDER BY placed_at DESC, id DESC
LIMIT 20;
```

Index on `(user_id, placed_at DESC, id DESC)` and every page costs the same: `O(log n)` lookup + 20 row reads. No matter what page you're on.

Tradeoff: no "jump to page N." Use offset only for small, bounded admin grids.

## SELECT * and overfetching

`SELECT *` in production: wastes network, prevents Index Only Scan, breaks silently on schema changes, serializes large blobs nobody reads. Project the columns you actually use; keep wide blobs out of list endpoints.

## COUNT(*) on large tables

`SELECT COUNT(*) FROM orders` is `O(rows)` — there's no shortcut in MVCC databases. On a billion-row table, it takes seconds to minutes.

Options:
- **Don't count.** Most UIs that show "1,234,567 results" only need "lots" or "approximately X." `LIMIT 1000` and report "1000+".
- **Estimate from stats.** Postgres `SELECT reltuples FROM pg_class WHERE relname = 'orders'` is approximate but free.
- **Maintain a counter.** A separate `counters` table updated by trigger or by the application. Exact, fast read, slight write cost.
- **Use a filtered count with an index.** `COUNT(*) WHERE status = 'pending'` over an index on `status` is fast when 'pending' is a small slice.

## The slow-query diagnostic flow

When a query is slow:

1. **Get the plan.** `EXPLAIN ANALYZE` the exact query, with realistic parameters (not the one-row example that hits the index perfectly).
2. **Find the cost.** The biggest `actual time` cumulative is your bottleneck.
3. **Classify it.**
   - `Seq Scan` on big table + selective `WHERE` → missing or wrong index.
   - `Sort` after an `Index Scan` → index doesn't include the `ORDER BY` column.
   - `Nested Loop` with high `loops` × inner-side time → likely the N+1-as-a-join.
   - Big `Rows Removed by Filter` → index is the wrong shape; filter columns should be in it.
   - `actual rows` >> `rows` estimate → bad stats, run `ANALYZE`.
4. **Hypothesize.** Propose one change (add index, reshape query, switch to keyset).
5. **Apply and re-explain.** Confirm the planner uses your new index. Confirm `actual time` dropped.
6. **Watch in production.** Some queries that look fast on dev data crawl on real data with skew. Check `pg_stat_statements` after deploy.

## Pitfalls

- **Implicit type casts in WHERE.** `WHERE user_id = '123'` against a `BIGINT` column may bypass the index in some engines. Match types exactly.
- **`OR` across columns.** `WHERE a = $1 OR b = $2` typically can't use a single composite index. Either two separate indexes + bitmap-or, or a `UNION` of two queries.
- **Functions on indexed columns.** `WHERE lower(email) = $1` skips a plain `(email)` index. Use an expression index (`CREATE INDEX ON users (lower(email))`) or store the normalized form.
- **`NOT IN` with NULLs.** Returns no rows if any NULL is in the list. Use `NOT EXISTS` instead.
- **`LIKE '%foo'` (leading wildcard).** Can't use a B-tree index. Use full-text search or a reverse index.
- **`LIMIT` without `ORDER BY`.** The result is non-deterministic; the planner may choose a different plan run-to-run.
