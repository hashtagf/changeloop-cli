# Transactions

Moved from `SKILL.md` — principle 6's full detail: keeping transactions short and knowing your isolation level.

## Principle 6 (from SKILL.md): Transactions: keep them short, know your isolation level

**Rule:** Wrap multi-step writes in a transaction so they succeed or fail together. Keep transactions short — open, do the work, commit. Know what isolation level you're running under and what anomalies it leaves possible.

**Why:** Open transactions hold locks, block writers, consume connections, and prevent vacuum — the longer they live, the worse. Isolation level determines which anomalies are possible: `READ COMMITTED` (Postgres default) allows lost updates — two transactions read the same value, both write, one silently clobbered.

**How to apply:**
- The unit of a transaction is "a thing that must succeed or fail atomically together." Usually that's one HTTP request, one use case, one event handler. Not "the whole user session."
- Never wait on external I/O (HTTP, message broker, user input) inside an open transaction. Load → close → call out → reopen if needed → commit.
- For read-modify-write on a shared row, choose one:
  - **Pessimistic:** `SELECT ... FOR UPDATE` locks the row until commit. Simple, blocks other readers-who-want-to-write.
  - **Optimistic:** add a `version` column or use `WHERE updated_at = $1`. On update, check the affected row count — if zero, someone else wrote first, retry or fail.
- Know your default *and that `REPEATABLE READ` means different things in different engines*. Postgres: `READ COMMITTED` by default; its `REPEATABLE READ` is snapshot isolation and prevents lost updates by aborting the second committer with error 40001. MySQL InnoDB: `REPEATABLE READ` by default; uses next-key locks to prevent phantoms but **still allows lost updates** on the read-modify-write pattern unless you take a row lock. SQLite: `SERIALIZABLE` (but it serializes everything).
- For balance transfers, inventory decrements, ticket bookings — anything where lost updates would be money or correctness — bump isolation to `SERIALIZABLE` or use explicit row locks. **Postgres `SERIALIZABLE` (SSI — Serializable Snapshot Isolation)** is a real first-class option: the engine detects read-write conflicts and aborts the offending transaction with 40001; your app retries. Often a cleaner answer than `SELECT FOR UPDATE` when transactions are short and the retry cost is small.
- See `references/transactions.md` for the anomalies table, lock types, and concrete patterns.

**Example:**
```sql
-- Bad — two transactions both read 100, both write 90, one decrement is lost
BEGIN;
SELECT balance FROM accounts WHERE id = $1;     -- 100
-- ... app subtracts 10 ...
UPDATE accounts SET balance = 90 WHERE id = $1;
COMMIT;

-- Good — row lock prevents the race
BEGIN;
SELECT balance FROM accounts WHERE id = $1 FOR UPDATE;   -- locks the row
UPDATE accounts SET balance = balance - 10 WHERE id = $1;
COMMIT;

-- Or optimistic: detect concurrent write and retry
UPDATE accounts SET balance = balance - 10, version = version + 1
WHERE id = $1 AND version = $expected_version;
-- If affected_rows == 0 → someone else updated first, reload and retry
```

## ACID, in one paragraph each

- **Atomicity** — all the statements between `BEGIN` and `COMMIT` succeed together, or none of them take effect. A crash mid-transaction rolls back to the state before `BEGIN`.
- **Consistency** — committed state respects the constraints declared on the schema (`NOT NULL`, `UNIQUE`, `CHECK`, foreign keys). Often the "C" people care least about, because it's enforced by the schema, not by the transaction mechanism.
- **Isolation** — concurrent transactions don't see each other's intermediate state. The strength of this guarantee depends on the isolation level — see below.
- **Durability** — once `COMMIT` returns, the change survives a crash. The database flushes the change to disk before acknowledging.

## Isolation levels and anomalies

The SQL standard defines four levels. Each prevents some anomalies and allows others. Knowing your level — and what it lets slip — is the difference between correct and "mostly correct."

| Level              | Dirty read | Non-repeatable read | Phantom read | Lost update | Serialization anomaly |
|--------------------|------------|---------------------|--------------|-------------|----------------------|
| `READ UNCOMMITTED` | Possible   | Possible            | Possible     | Possible    | Possible             |
| `READ COMMITTED`   | Prevented  | Possible            | Possible     | Possible    | Possible             |
| `REPEATABLE READ`  | Prevented  | Prevented           | Possible*    | Prevented*  | Possible             |
| `SERIALIZABLE`     | Prevented  | Prevented           | Prevented    | Prevented   | Prevented            |

*The two big engines disagree on what `REPEATABLE READ` actually delivers — this is the most-confused fact in this whole table:
- **Postgres** `REPEATABLE READ` is **snapshot isolation**. Prevents phantoms and prevents lost updates by aborting the second committer with `serialization_failure` (40001); your app retries.
- **MySQL InnoDB** `REPEATABLE READ` uses next-key locks to prevent most phantom reads but **still allows lost updates** on the read-modify-write pattern — both transactions read the same value, both UPDATE, the later wins silently. To close this hole in MySQL you must take a row lock (`SELECT ... FOR UPDATE`) or move to `SERIALIZABLE`.

The SQL standard is loose; verify against your engine's docs before relying on the level alone.

**The anomalies, in plain language:**
- **Dirty read** — you see another transaction's uncommitted write. Almost never enabled in practice.
- **Non-repeatable read** — you read row X, do some work, read row X again in the same transaction, and the value changed because someone else committed in between.
- **Phantom read** — you `SELECT * WHERE status = 'pending'` twice in the same transaction and get different rows because another transaction inserted (or deleted) a matching row.
- **Lost update** — two transactions both read a value, both compute a new value based on it, both write. One write is silently overwritten. **The most common bug in real systems.**
- **Serialization anomaly** — the result of running concurrent transactions is something no serial order could produce. Real but subtle; relevant for complex multi-row invariants.

## Defaults you should memorize

- **Postgres:** `READ COMMITTED`. Allows lost updates. Three options to protect a read-modify-write: `SELECT ... FOR UPDATE` (pessimistic row lock), `REPEATABLE READ` (snapshot isolation — engine aborts the second committer with 40001), or `SERIALIZABLE` / **SSI** (Postgres's serializable snapshot isolation — detects read-write conflicts across rows; abort + retry on 40001). SSI is the cleanest answer when transactions are short and the retry rate is low; reach for `FOR UPDATE` when you need to *block* rather than retry.
- **MySQL InnoDB:** `REPEATABLE READ`. Despite the name, this does **not** prevent lost updates on the read-modify-write pattern — both transactions read the same value via their snapshot, both UPDATE, the later wins. To get lost-update protection in MySQL, take a row lock (`SELECT ... FOR UPDATE`) or move to `SERIALIZABLE` (where InnoDB converts plain SELECTs into shared-lock reads). This is one of the most-reported "but I'm in REPEATABLE READ" bugs.
- **SQLite:** `SERIALIZABLE` (effectively — only one writer at a time). Strong, but throughput is limited.
- **DynamoDB / most cloud KV stores:** per-item atomicity only; multi-item transactions are an explicit opt-in with sharp limits.

## The lost-update problem

```sql
-- T1                                            -- T2
BEGIN;                                            BEGIN;
SELECT balance FROM accounts WHERE id=1; -- 100   SELECT balance FROM accounts WHERE id=1; -- 100
-- app computes: 100 - 30 = 70                    -- app computes: 100 - 50 = 50
UPDATE accounts SET balance=70 WHERE id=1;        UPDATE accounts SET balance=50 WHERE id=1;
COMMIT;                                           COMMIT;

-- Final balance: 50. The $30 withdrawal vanished.
```

Three fixes, in order of preference:

### Fix 1: SQL-level atomic update (best when you can)

If the new value is a function of the old value, write it as one statement. The DB locks the row implicitly.

```sql
UPDATE accounts SET balance = balance - 30 WHERE id = 1;
```

Two concurrent decrements serialize automatically. No application-level read-then-write.

### Fix 2: Pessimistic row lock

When the new value depends on logic the database can't express, lock the row for the duration of the transaction.

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- T2 trying the same SELECT FOR UPDATE waits here until T1 commits.
-- ... compute new value ...
UPDATE accounts SET balance = $new WHERE id = 1;
COMMIT;
```

Simple, blocks readers-who-want-to-write. Risk: deadlocks if multiple rows are locked in different orders. Always lock rows in a deterministic order (e.g., by id ascending) when locking more than one.

### Fix 3: Optimistic concurrency (version column)

Add a `version` column. Read it, then write only if it hasn't changed.

```sql
UPDATE accounts
SET balance = $new, version = version + 1
WHERE id = 1 AND version = $expected_version;
```

Check the affected-row count. If zero, someone else updated first — reload, recompute, retry. Good when conflicts are rare (most reads never collide); bad under high contention (lots of retries).

## Common patterns

### Idempotency keys

For "exactly once" semantics across retries (payment processing, message delivery), store the idempotency key in the same transaction as the work:

```sql
INSERT INTO charges (id, idempotency_key, amount, status)
VALUES ($1, $2, $3, 'pending');
-- ON CONFLICT (idempotency_key) DO NOTHING — second call returns no row inserted
```

The `UNIQUE` index on `idempotency_key` is the guarantee. The application-level `if (exists) return` check is the race window.

### Upserts: `ON CONFLICT` vs `MERGE`

Postgres 15+ added the SQL-standard `MERGE` statement alongside the older `INSERT ... ON CONFLICT`. They are *not* equivalent under concurrency:

- **`INSERT ... ON CONFLICT`** is the right answer for **single-row, OLTP upserts**. It cooperates with the unique index: under concurrent inserts to the same key, the conflict path runs deterministically and you don't see serialization failures. Use this for "create-if-missing-else-update" on a known PK or unique constraint.
- **`MERGE`** is the right answer for **bulk / ETL** workloads (apply this batch of source rows to that target table, with insert/update/delete branches). Under concurrent writes against the same target rows, MERGE can raise `serialization_failure` (40001) — you need a retry loop, and you cannot replace `ON CONFLICT` with `MERGE` for hot single-row upsert paths without inviting that error in production.

MySQL has its own dialect: `INSERT ... ON DUPLICATE KEY UPDATE` is the long-standing OLTP equivalent. MySQL 8.0+ also has `MERGE` (limited) and the more common bulk-update path remains `INSERT ... ON DUPLICATE KEY UPDATE` against a unique index.

When in doubt: single-row upsert → `ON CONFLICT` / `ON DUPLICATE KEY UPDATE`. Bulk apply with insert/update/delete logic → `MERGE` with a retry loop.

### SELECT ... FOR UPDATE SKIP LOCKED (job queues)

The poor-person's job queue, when you don't want to bring in Redis or Kafka:

```sql
SELECT id, payload FROM jobs
WHERE status = 'pending'
ORDER BY id
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

Each worker grabs an unlocked row and skips ones held by other workers. Cheap, durable, no separate broker. Doesn't scale to millions of jobs per second, but for ~thousands per minute it's perfect.

### Transactional outbox

The dual-write problem: you `UPDATE` a row *and* publish a Kafka message. Either can succeed without the other. The fix:

1. In one DB transaction, write the row change *and* an `outbox` row containing the message.
2. A separate process polls the `outbox` table and publishes to Kafka, deleting after ack.

Now both changes commit atomically; the broker publish is async but guaranteed eventually-delivered.

## Pitfalls

- **Holding a transaction open across user input or external HTTP.** A locked row plus a 30-second HTTP timeout equals 30 seconds of every other writer blocked. Load data → close transaction → call external service → reopen transaction if needed → commit.
- **The "long-running read" trap.** A `SELECT` inside an open transaction in Postgres holds the snapshot, which blocks `VACUUM` from cleaning up dead rows. Run analytical queries outside of transactional code paths, or use a read replica.
- **Deadlocks from inconsistent lock order.** Two transactions lock rows in opposite order → both wait → DB kills one. Always lock multiple rows in the same deterministic order (e.g., by id ascending).
- **Transactions don't compose across services.** If your "transaction" spans two microservices' databases, you don't have a transaction — you have an eventually-consistent saga. Acknowledge it and design failure compensation.
- **`autocommit` is on by default in most drivers.** Without an explicit `BEGIN`, each statement commits on its own. Multi-statement workflows need explicit transactions — don't assume the driver groups them.

## Quick decision guide

- Single statement that touches one row → no transaction needed (autocommit is fine).
- Multiple statements that must succeed or fail together → wrap in a transaction.
- Read-modify-write on a shared row → atomic SQL if possible, else `FOR UPDATE`, else version column.
- Multi-row invariants under concurrency → `SERIALIZABLE` isolation, or restructure to avoid the invariant.
- Cross-service consistency → saga / outbox, not a transaction.
