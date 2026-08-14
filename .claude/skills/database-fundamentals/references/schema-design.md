# Schema Design — Data Shape and Constraints

Moved from `SKILL.md` — principles 1 and 2's full detail: modeling the data before the queries, and pushing invariants into the schema as constraints.

## Principle 1 (from SKILL.md): Model the data first

**Rule:** Decide the shape of the data before you decide the queries. Pick types that match the domain, and start in a normalized shape. Denormalize only when a query forces it, not as a default.

**Why:** The schema outlives the code. A wrong type (`FLOAT` for money, `VARCHAR` for timestamps) queues a year of bugs; duplicated facts make every update a race.

**How to apply:**
- Choose types that match the domain. Money is integer cents (or `NUMERIC`/`DECIMAL`), **never** `FLOAT` or `DOUBLE` — floating point loses pennies. Dates and timestamps are `DATE` / `TIMESTAMPTZ`, never strings. Identifiers have a single canonical type used everywhere they appear.
- Start in 3rd normal form: every non-key column depends on the key, the whole key, and nothing but the key. One fact lives in one place.
- Recognize relationship shapes and model them honestly. 1:1 collapses into one row (or a true 1:1 with a shared key). 1:N is a foreign key on the many side. N:N needs a join table — never a comma-separated string column.
- Use `TIMESTAMPTZ` (Postgres) or UTC `TIMESTAMP` for any moment-in-time. Store wall-clock local time only when you genuinely mean "a clock on a wall in some city" (e.g., a recurring 9 AM reminder in the user's timezone), and store the zone alongside.
- Reserve `JSON`/`JSONB` for genuinely schemaless or rarely-queried payloads. The moment you find yourself indexing or filtering inside a JSON blob frequently, those fields want to be real columns.

**Example:**
```sql
-- Awkward — three different schemas hiding in one table
CREATE TABLE orders (
  id           TEXT PRIMARY KEY,            -- sometimes uuid, sometimes integer
  user_id      VARCHAR(255),                -- type mismatches users.id
  total        FLOAT,                       -- loses pennies
  placed_at    VARCHAR(50),                 -- "2025-01-04T..."  string sort, no validation
  line_items   TEXT                         -- comma-separated SKUs
);

-- Better — domain shape, honest types, real relationships
CREATE TABLE orders (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  total_cents  BIGINT NOT NULL,
  currency     CHAR(3) NOT NULL,
  placed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, sku)
);
```

## Principle 2 (from SKILL.md): Constraints are invariants — push them into the schema

**Rule:** Every invariant the application "always" guarantees should also be a constraint in the database. `NOT NULL`, `UNIQUE`, foreign keys, `CHECK` constraints — use all of them.

**Why:** [[programming-fundamentals]] "make illegal states unrepresentable" at the storage layer. The application will have a bug; a future script will write the same tables. Constraints protect every writer forever; application checks get forgotten. A unique index is the **only** way to enforce uniqueness across concurrent writers — `SELECT then INSERT` has a race window.

**How to apply:**
- Default every column to `NOT NULL`. A nullable column is a claim that "missing" is a meaningful value for this field. If you can't explain what `NULL` means here in business terms, the column should be `NOT NULL`.
- Foreign keys on every reference. They cost a tiny bit on write; they pay it back forever in dangling-row bugs you never have to debug.
- `UNIQUE` for any field a human might think of as identifying (`email`, `slug`, `(tenant_id, name)`). Don't enforce uniqueness only in application code.
- `CHECK` constraints encode invariants that have a closed form: `CHECK (quantity > 0)`, `CHECK (status IN ('pending','paid','refunded'))`, `CHECK (ended_at IS NULL OR ended_at >= started_at)`.
- Use `ON DELETE` actions deliberately. `CASCADE` for genuinely owned children (order → order_items). `RESTRICT` (the default) for references that should block deletion (you cannot delete a user with open invoices). `SET NULL` only when null genuinely means "the parent is gone but the child remains."

**Example:**
```sql
-- Bad — schema says nothing about the domain rules; app has to remember everything
CREATE TABLE subscriptions (
  id          UUID,
  user_id     UUID,
  plan        TEXT,
  started_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  trial_days  INTEGER
);

-- Good — the schema enforces what "well-formed subscription" means
CREATE TABLE subscriptions (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan        TEXT NOT NULL CHECK (plan IN ('basic','pro','enterprise')),
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ CHECK (ended_at IS NULL OR ended_at > started_at),
  trial_days  INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  UNIQUE (user_id, plan, started_at)   -- can't double-subscribe the same plan
);
```

NoSQL note: most document stores don't give you foreign keys or rich `CHECK` constraints. That doesn't make the invariant go away — it just means the application owns more of the enforcement, and you accept the cost (orphan documents, drift across collections, manual cleanup). If the data is truly relational, prefer a relational store.

## Pointers
- Index design once the shape is settled: `indexing.md`.
- Query performance and reading query plans: `query-performance.md`.
- Changing a live schema safely: `migrations.md`.
