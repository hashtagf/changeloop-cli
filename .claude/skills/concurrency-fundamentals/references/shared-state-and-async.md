# Shared state, locking, and async

Moved from `SKILL.md` — principles 1-7's full rule/why/how-to-apply/example, ahead of the topic-organized recipes below.

## Principle 1 (from SKILL.md): Don't share mutable state — the easiest concurrency bug is the one you designed out

**Rule:** Before reaching for a lock, ask whether the state needs to be shared and mutable at all. If you can make it immutable, confine it to one owner, or pass it by message instead of by reference, the race disappears — no lock required.

**Why:** Locking bugs only exist because two things touch the same mutable cell. Remove the sharing or the mutation and the race category disappears — locks are the fallback, not the default.

**How to apply:**
- **Immutability** — if a value never changes after construction, any number of tasks can read it concurrently with zero coordination. Build new values instead of mutating shared ones. Frozen config, snapshots, copy-on-write.
- **Confinement** — give mutable state a single owner. One task, one actor, one thread owns the data; everyone else asks it to act. No other code holds a reference to mutate.
- **Share by communicating** — instead of "share memory and lock it," pass ownership through a channel/queue so only one task holds the data at a time (Go's mantra, Erlang's actors, JS Web Workers with `postMessage`). The hand-off is the synchronization.
- **Thread-local / task-local** — per-worker scratch state that's never shared needs no protection at all.

**Example:**
```ts
// Bad — shared accumulator whose read-modify-write straddles an await
let total = 0
await Promise.all(items.map(async (it) => {
  total += await score(it)   // reads `total`, suspends at await, writes later: two tasks
                             // read the SAME old value and one increment is lost
}))

// Good — no shared mutable state; each task returns its own value, combine after
const scores = await Promise.all(items.map((it) => score(it)))  // each task owns its result
const total = scores.reduce((a, b) => a + b, 0)                  // single-threaded fold, no race
```

In single-threaded JS the race is the read-modify-write that *straddles* an `await`: `total += await score(it)` reads `total`, suspends, and a second task reads the same old value before either writes. (A `+=` with no `await` between its read and write is atomic here — see principle 2.) The fix is the same — don't share the accumulator.

## Principle 2 (from SKILL.md): When you must share, make access atomic

**Rule:** If state genuinely must be shared and mutated, identify the **critical section** — the smallest span that must execute without interleaving — and protect it. A read-modify-write is never atomic by default. `i++` is not atomic.

**Why:** `count++` is three operations; two threads both reading 41, both writing 42 loses one increment. This is the in-process twin of [[database-fundamentals]] principle 6 — make the read-modify-write indivisible.

**How to apply:**
- **Lock / mutex** — take the lock, do the read-modify-write, release. Hold it for the *smallest* span that preserves the invariant, and never across I/O or `await` you don't control (that's where deadlocks and starvation come from — see principle 3).
- **Atomic primitives** — `AtomicInteger`, `std::atomic`, `Interlocked.Increment`, an atomic CAS. For a single counter or flag these beat a lock: no blocking, no deadlock risk.
- **Compare-and-swap (CAS) loop** — read the current value, compute the new one, swap *only if* the value is unchanged; retry if it moved. Lock-free, the basis of most atomics.
- **Optimistic version** — for coarser state, attach a version number; on write, fail if the version moved and retry. Same shape as the DB optimistic-locking pattern, in memory.
- **Pick the right granularity** — one giant lock around everything is correct but serializes the whole system; a lock per shard/key keeps parallelism. Too fine and you reintroduce ordering bugs (principle 3).

**Example:**
```ts
// Bad — read-modify-write with an await in the middle; classic in-process lost update
async function reserve(seatId: string) {
  const seat = cache.get(seatId)          // read: { taken: false }
  await persist(seat)                     // <-- another task interleaves here
  cache.set(seatId, { taken: true })      // write: clobbers a concurrent reservation
}

// Good — serialize the critical section with a per-key lock (e.g. async-mutex)
const locks = new KeyedMutex()
async function reserve(seatId: string) {
  return locks.runExclusive(seatId, async () => {   // only one task per seatId at a time
    const seat = cache.get(seatId)
    if (seat.taken) throw new AlreadyReserved(seatId)
    await persist({ ...seat, taken: true })
    cache.set(seatId, { taken: true })
  })
}
```

## Principle 3 (from SKILL.md): Prevent deadlock by design

**Rule:** A deadlock is a cycle of waiting — A holds lock 1 and wants lock 2 while B holds lock 2 and wants lock 1. Break the cycle structurally: take locks in a consistent global order, keep lock scope tiny, avoid nested locks, and put a timeout on every acquire.

**Why:** Deadlocks hang silently — the service wedges while appearing alive. You can't test them away; design out the waiting cycle.

**How to apply:**
- **Consistent lock ordering** — if any code path needs both lock A and lock B, *every* path takes them in the same order (e.g., always lower id first). A cycle is impossible if there's a total order. This is the single most effective rule.
- **Minimize scope** — hold a lock for the fewest statements possible. Compute outside the lock, mutate inside it, release immediately. The shorter the hold, the smaller the window for contention.
- **Avoid nested locks** — needing two locks at once is the precondition for deadlock. Often you can restructure to hold one at a time, or merge the two into one coarser lock.
- **Never lock across un-owned I/O** — holding a lock while you `await` a network call or wait on user input invites both deadlock and pathological latency. Load → release → call out → reacquire.
- **Timeout every acquire** — `tryLock(timeout)` instead of `lock()`. A timeout turns a silent permanent hang into a loud, recoverable error you can log, retry, or fail fast on.

**Example:**
```ts
// Bad — transfer locks accounts in argument order; two opposite transfers deadlock
async function transfer(from: Account, to: Account, amt: number) {
  await from.lock()      // T1: lock A, wants B   |  T2: lock B, wants A  -> cycle
  await to.lock()
  from.bal -= amt; to.bal += amt
  to.unlock(); from.unlock()
}

// Good — always acquire in a consistent order (by id); no cycle can form
async function transfer(from: Account, to: Account, amt: number) {
  const [first, second] = from.id < to.id ? [from, to] : [to, from]
  await first.lock()
  await second.lock()
  try { from.bal -= amt; to.bal += amt }
  finally { second.unlock(); first.unlock() }
}
```

## Principle 4 (from SKILL.md): async/await is concurrency too

**Rule:** `async`/`await` is concurrency, not parallelism, and it has its own footguns. An un-awaited promise swallows its error and races ahead of the code that should follow it. Blocking the event loop stalls *everything*. Know whether your runtime is cooperative or preemptive, and whether you want concurrent or sequential.

**Why:** "Single-threaded" isn't race-free — logical races happen at every `await` point. Dropped promises, blocked loops, and accidental serialization look like linear code but break production the same way.

**How to apply:**
- **Always await (or deliberately handle) every promise.** A floating promise runs detached: if it rejects, the error vanishes (unhandled rejection), and downstream code runs before it finishes. If you truly want fire-and-forget, say so explicitly and attach a `.catch`.
- **Concurrent vs sequential is a choice.** `await a(); await b();` runs them in series. `await Promise.all([a(), b()])` runs them concurrently. Pick on purpose — series for dependencies, parallel for independent work. (`Promise.allSettled` when you want every result even if some reject.)
- **Don't block the event loop.** A synchronous CPU-heavy loop or a sync FS/crypto call freezes every other task and request on the same thread. Offload to a worker thread, chunk the work, or use the async API. The same applies to Python's asyncio and a blocking call.
- **Cooperative vs preemptive.** In a cooperative runtime (JS event loop, Python asyncio) a task runs uninterrupted until it `await`s/yields — so a critical section with no `await` inside it is effectively atomic. In a preemptive *and* parallel model (OS threads, **Go goroutines** — multiple run simultaneously on `GOMAXPROCS>1`, and the scheduler also preempts asynchronously) two tasks execute at the same instant, so even `i++` races and every shared mutation needs an atomic or a lock. Know which you're in; it changes what needs a lock.

**Example:**
```ts
// Bad — floating promise: error is swallowed, and the email may not be sent before we return
async function checkout(cart: Cart) {
  sendReceiptEmail(cart)        // not awaited; rejection becomes an unhandled rejection
  return { ok: true }           // returns before the email resolves or fails
}

// Bad — accidental serialization: 100 independent fetches run one at a time
const out = []
for (const id of ids) out.push(await fetchUser(id))   // N sequential round-trips

// Good — await what must complete; run independent work concurrently
async function checkout(cart: Cart) {
  await sendReceiptEmail(cart)                 // failure propagates; ordering guaranteed
  return { ok: true }
}
const out = await Promise.all(ids.map(fetchUser))   // concurrent — but bound it (principle 6)
```

## Principle 5 (from SKILL.md): Make operations idempotent and cancellable

**Rule:** Concurrent systems retry and double-fire — a user double-clicks, a timeout fires while the work is still running, a supervisor restarts a task. Design operations so doing them twice equals doing them once, and so a cancellation or timeout cleanly unwinds whatever was half-started.

**Why:** Under concurrency an operation can fire more than once — retries, timeout races, re-entrant handlers. A non-idempotent charge double-charges; a cancelled task leaking a lock or partial write poisons the next attempt. (In-process cousin of [[queue-fundamentals]] at-least-once delivery.)

**How to apply:**
- **Idempotency key / dedup** — guard the effectful step with a key so a repeat is a no-op: "if this requestId already processed, return the prior result." A `Set` of in-flight keys, an atomic "insert if absent," a CAS on a status flag.
- **Make the in-flight state single.** Collapse concurrent identical requests into one shared promise (request coalescing / single-flight) so ten callers asking for the same thing trigger one operation, not ten.
- **Cancellation must clean up.** Plumb an `AbortSignal` / cancellation token through. On cancel, release locks, close handles, roll back partial writes — in a `finally`, so it runs whether the task completed, threw, or was cancelled.
- **Timeouts are cancellation.** A timeout that abandons a task without cancelling its underlying work leaks the work (and any resources it holds). Wire the timeout to the same cancellation path.

**Example:**
```ts
// Bad — double-click fires charge twice; timeout abandons the call but it keeps running
async function pay(orderId: string) {
  await chargeCard(orderId)            // no dedup; second click double-charges
}

// Good — single-flight + idempotency + cancellable cleanup
const inflight = new Map<string, Promise<Receipt>>()
async function pay(orderId: string, signal: AbortSignal) {
  if (inflight.has(orderId)) return inflight.get(orderId)!   // coalesce concurrent retries
  const p = (async () => {
    const lock = await acquire(orderId)
    try {
      if (await alreadyCharged(orderId)) return loadReceipt(orderId)  // idempotent
      return await chargeCard(orderId, { signal })                    // honors cancellation
    } finally { lock.release() }      // cleanup on success, throw, OR cancel
  })()
  inflight.set(orderId, p)
  try { return await p } finally { inflight.delete(orderId) }
}
```

## Principle 6 (from SKILL.md): Bound your concurrency

**Rule:** Unbounded fan-out is a self-inflicted denial of service. `Promise.all` over 50,000 items opens 50,000 sockets, 50,000 DB connections, 50,000 file handles — and falls over. Cap in-flight work with a semaphore, a worker pool, or a queue with backpressure.

**Why:** Unbounded fan-out exhausts pools, memory, and downstream limits — works at 10, melts at 10,000. The cap keeps throughput high instead of thrashing.

**How to apply:**
- **Semaphore / concurrency limit** — allow at most N tasks in the critical resource at once; the N+1th waits. `p-limit`, a counting semaphore, a `Semaphore(N)`. Pick N from the real bottleneck (DB pool size, downstream rate limit), not a guess.
- **Worker pool** — a fixed set of workers pull from a shared queue. Bounded workers, bounded memory, natural load-leveling.
- **Backpressure** — when producers outrun consumers, *slow the producer* (bounded queue that blocks/rejects on full), don't buffer unboundedly until you OOM. A full queue is a signal, not a problem to paper over.
- **Match N to the limiter.** More concurrency than the downstream can absorb just converts to queueing and timeouts. The right N is usually small.

**Example:**
```ts
// Bad — unbounded fan-out: 10k concurrent DB writes exhaust the pool, everything times out
await Promise.all(records.map((r) => db.insert(r)))

// Good — cap concurrency at the pool size; at most 10 writes in flight
import pLimit from "p-limit"
const limit = pLimit(10)                       // size to the actual DB pool, not a guess
await Promise.all(records.map((r) => limit(() => db.insert(r))))

// Or a worker pool draining a bounded queue, with backpressure when full
const queue = new BoundedQueue(records, { capacity: 1000 })  // producer blocks when full
await Promise.all(Array.from({ length: 10 }, () => worker(queue)))
```

## Principle 7 (from SKILL.md): Test the races you can — but design so correctness doesn't depend on timing

**Rule:** Write deterministic tests around the critical section, add stress/fuzz tests where you can, and run a race detector if your toolchain has one. But the real safety comes from a design whose correctness does **not** depend on a particular interleaving — because no test can prove the absence of a race.

**Why:** A one-in-ten-million race won't fail in CI; observing it changes the timing. Tests catch races you can force, not all interleavings. Principles 1-3 (remove possibility) are the first line; testing is second.

**How to apply:**
- **Make critical sections deterministically testable.** Inject the scheduler/clock, expose seams to release two tasks at a known point, assert the post-condition. Test the lock does what you think.
- **Force the interleaving.** Use barriers/latches to start N tasks at exactly the same moment and hammer the shared resource; assert the invariant (e.g., final count equals N) holds over many runs.
- **Use the tools.** Go's `-race`, ThreadSanitizer (C/C++/Rust), Java's `jcstress`, linters for floating promises (`no-floating-promises`). They catch real races cheaply.
- **Prefer designs that don't need the test.** Immutability, confinement, a single owner, an atomic op — these are *provably* race-free, so the test only confirms what the design guarantees. If correctness hinges on "the lock is probably fast enough," redesign.

**Example:**
```ts
// Stress test — force the interleaving the unit test never would
it("increments are not lost under contention", async () => {
  const counter = new AtomicCounter()
  const start = new Barrier(100)                       // release all 100 at once
  await Promise.all(Array.from({ length: 100 }, async () => {
    await start.wait()
    for (let i = 0; i < 1000; i++) counter.inc()
  }))
  expect(counter.value).toBe(100_000)                  // fails immediately if inc() races
})
```

---

## 1. Escape hatches: avoid the sharing entirely

### Immutability

If a value never mutates after construction, unlimited readers can share it with zero coordination. There is no read-modify-write to interleave because there is no write.

```ts
// Do this: build a new value, never mutate the shared one
function applyDiscount(cart: ReadonlyCart, pct: number): ReadonlyCart {
  return { ...cart, total: cart.total * (1 - pct) }   // new object; original untouched
}

// Not this: mutating a shared object that other tasks may be reading
function applyDiscount(cart: Cart, pct: number): void {
  cart.total *= (1 - pct)        // any concurrent reader sees a half-applied state
}
```

`Object.freeze`, `readonly`, persistent/immutable collections, and "compute a new snapshot" all serve here. The cost is allocation; usually cheap relative to a bug you can't reproduce.

### Confinement (single owner)

Give each piece of mutable state exactly one owner. Everyone else sends the owner a request; nobody else holds a reference that can mutate it. This is the actor model and Go's "share by communicating."

```ts
// A single-owner counter: only the owner task mutates `n`; others post messages
class CounterActor {
  private n = 0
  private queue = new AsyncQueue<{ op: "inc" | "get"; reply: (v: number) => void }>()
  constructor() { this.loop() }
  private async loop() {
    for await (const msg of this.queue) {       // serial: one message at a time
      if (msg.op === "inc") this.n++            // no lock needed — single owner
      msg.reply(this.n)
    }
  }
  inc() { return new Promise<number>((r) => this.queue.push({ op: "inc", reply: r })) }
}
```

The queue *is* the synchronization. The owner processes one message at a time, so its internal mutation never races.

### Message-passing / hand-off

Instead of two tasks sharing a buffer behind a lock, pass ownership through a channel so only one holds it at a time. JS Web Workers (`postMessage` transfers an `ArrayBuffer`), Go channels, Rust's `mpsc`. The transfer point is the only synchronization, and it's explicit.

### Thread-local / task-local

Per-worker scratch state that nothing else can see needs no protection. A buffer allocated inside a task, a request-scoped context — keep it local and the question of races never arises.

**Decision:** immutable? → do that. One owner? → confine it. Hand off by message? → do that. Only if none fit: reach for a lock.

---

## 2. When you must share: lock vs atomic vs CAS vs optimistic version

Protect the **critical section** — the smallest span that must run without interleaving. `count++` is three steps (load, add, store); two threads lose an increment. Same as [[database-fundamentals]] lost update, in memory.

### The decision rules

| Situation | Use | Why |
|-----------|-----|-----|
| Single counter / flag, preemptive threads | **Atomic** (`AtomicInteger`, `Interlocked`, `std::atomic`) | No blocking, no deadlock, hardware-level indivisible |
| Multi-step invariant over several fields | **Lock / mutex** | Atomics only cover one word; a lock spans the whole critical section |
| Lock-free single-value update under contention | **CAS loop** | Read, compute, swap-if-unchanged, retry; no blocking |
| Coarse state, low contention, "detect & retry" is fine | **Optimistic version** | Cheap on the happy path; pay only when a conflict actually happens |
| Read-mostly, rare writes | **RWLock / copy-on-write** | Many concurrent readers, exclusive writer |

### Lock — the workhorse

```ts
import { Mutex } from "async-mutex"
const mutex = new Mutex()
async function deposit(amt: number) {
  await mutex.runExclusive(() => {        // critical section: one task at a time
    balance = balance + amt               // read-modify-write is now indivisible
  })
}
```

Rules: hold for the *smallest* span; never `await` un-owned I/O while holding it; prefer a lock per key/shard over one global lock.

### Atomic — for a single value

```ts
// Pseudo-threaded: an atomic increment can't lose updates the way ++ can
counter.incrementAndGet()                 // indivisible; no lock, no deadlock
```

### CAS loop — lock-free update

```ts
// Compare-and-swap: only write if nobody changed it since we read
function addLockFree(delta: number) {
  for (;;) {
    const cur = atomic.get()
    const next = cur + delta
    if (atomic.compareAndSet(cur, next)) return   // succeeded — nobody raced us
    // else: someone wrote between our read and swap — loop and retry
  }
}
```

### Optimistic version — detect-and-retry on coarse state

Same shape as DB optimistic locking, in memory: stamp the state with a version, only commit if the version is unchanged.

```ts
type Doc = { value: string; version: number }
async function update(store: Map<string, Doc>, key: string, fn: (s: string) => Promise<string>) {
  for (;;) {
    const cur = store.get(key)!
    const newValue = await fn(cur.value)               // the only interleave point is here
    if (store.get(key)!.version !== cur.version) continue   // someone wrote during the await — retry
    store.set(key, { value: newValue, version: cur.version + 1 })  // check + set with NO await
    return                                              // between them, so it's atomic in JS
  }
}
```

Optimistic wins when conflicts are rare; pessimistic when conflicts are common (retrying is worse than waiting).

---

## 3. Deadlock-avoidance recipes

### Recipe 1: consistent lock ordering (the big one)

If any code path acquires two locks, *every* path acquires them in the same global order. A total order on locks makes a cycle impossible.

```ts
// Order locks by a stable key (id) so A→B and B→A both lock low-id first
async function transfer(from: Account, to: Account, amt: number) {
  const [first, second] = from.id < to.id ? [from, to] : [to, from]
  await first.lock(); await second.lock()
  try { from.bal -= amt; to.bal += amt }
  finally { second.unlock(); first.unlock() }   // release in reverse
}
```

### Recipe 2: minimize lock scope

Compute *outside* the lock; mutate *inside* it; release immediately. The shorter the hold, the smaller the contention window.

```ts
// Bad: expensive work done while holding the lock blocks everyone
await mutex.runExclusive(async () => {
  const result = await expensiveComputation()   // others wait on this for no reason
  shared.value = result
})

// Good: compute first, lock only for the mutation
const result = await expensiveComputation()
await mutex.runExclusive(() => { shared.value = result })   // tiny critical section
```

### Recipe 3: avoid nested locks

Needing two locks at once is the precondition for deadlock. Hold one at a time, or merge them into one coarser lock.

### Recipe 4: never lock across un-owned I/O

Holding a lock while you `await` a network call, a DB query, or user input can wedge the system: the call is slow or hangs, and everyone waiting on that lock hangs with it.

```ts
// Bad: HTTP call inside the lock — every other task blocks on a remote latency
await mutex.runExclusive(async () => {
  const data = await fetch(url)        // lock held for the whole round-trip
  cache.set(key, data)
})

// Good: do I/O outside the lock; lock only the in-memory mutation
const data = await fetch(url)
await mutex.runExclusive(() => cache.set(key, data))
```

### Recipe 5: timeout every acquire

`tryLock(timeout)` instead of `lock()`. A timeout converts a silent permanent hang into a loud, recoverable error.

```ts
const acquired = await mutex.acquire({ timeout: 5_000 })
if (!acquired) throw new LockTimeout("could not acquire within 5s")  // fail loud, not hang
```

---

## 4. async/await pitfalls

### Pitfall: the floating (un-awaited) promise

A promise you don't await runs detached. If it rejects, the error becomes an unhandled rejection and is *swallowed* — the calling code already moved on. Worse, downstream code runs before the work finishes.

```ts
// Bad: error vanishes; "done" logs before save completes (or fails)
function handler() {
  saveToDb(record)          // not awaited
  console.log("done")       // runs immediately, save may still be in flight or rejected
}

// Good: await it — the error propagates and ordering is guaranteed
async function handler() {
  await saveToDb(record)
  console.log("done")
}

// If you truly want fire-and-forget, say so AND handle the error explicitly
void saveToDb(record).catch((err) => log.error("background save failed", err))
```

Enforce it: ESLint `@typescript-eslint/no-floating-promises`.

### Pitfall: accidental serialization

`await` inside a loop runs the iterations one at a time. For independent work that's N sequential round-trips when it could be one concurrent batch.

```ts
// Bad: sequential — total latency is the SUM of all calls
const users = []
for (const id of ids) users.push(await fetchUser(id))

// Good: concurrent — total latency is the MAX of the calls (but bound it, §5)
const users = await Promise.all(ids.map(fetchUser))
```

### Pitfall: Promise.all vs allSettled

`Promise.all` rejects on the *first* failure and abandons the rest's results. If you need every outcome (even failures), use `allSettled`.

```ts
const results = await Promise.allSettled(ids.map(fetchUser))
const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value)
const failed = results.filter((r) => r.status === "rejected")
```

### Pitfall: blocking the event loop

A synchronous CPU-heavy loop or a sync API (`crypto.pbkdf2Sync`, `fs.readFileSync`, a big JSON parse) freezes *every* task and request on that thread. Offload or chunk.

```ts
// Bad: blocks the loop; every other request stalls until this finishes
const hash = crypto.pbkdf2Sync(pw, salt, 600_000, 32, "sha256")

// Good: async variant yields the loop; or move to a worker thread
const hash = await promisify(crypto.pbkdf2)(pw, salt, 600_000, 32, "sha256")
```

### Pitfall: logical race across an await

Even single-threaded, two tasks can interleave at `await` points and clobber shared state.

```ts
// Bad: both tasks read the same `seq`, both write seq+1 — one increment lost
let seq = 0
async function next() {
  const cur = seq            // task A and task B both read 0
  await tick()               // interleave point
  seq = cur + 1              // both write 1 — lost update
  return seq
}
// Fix: don't share (return per-task values), or serialize with a mutex (§2)
```

### Cancellation: AbortSignal and cleanup

A timeout or user cancel must actually *stop* the work and release its resources, not just stop waiting for it.

```ts
async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)    // cancel the underlying work
  try {
    return await fetch(url, { signal: ctrl.signal })  // honors abort
  } finally {
    clearTimeout(timer)                                // cleanup runs on success, throw, OR abort
  }
}
```

Plumb the signal through every layer; a timeout that abandons without aborting leaks the connection. Put cleanup in `finally` so it runs on completion, throw, and cancel alike.

---

## 5. Bounded concurrency patterns

### Semaphore / concurrency limit

```ts
import pLimit from "p-limit"
const limit = pLimit(10)          // size to the DB pool / downstream rate limit, not a guess
const results = await Promise.all(
  items.map((it) => limit(() => processWithDb(it)))   // at most 10 concurrent
)
```

Roll-your-own counting semaphore (the shape, if you have no library):

```ts
class Semaphore {
  private avail: number
  private waiters: Array<() => void> = []
  constructor(n: number) { this.avail = n }
  async acquire() {
    if (this.avail > 0) { this.avail--; return }
    await new Promise<void>((r) => this.waiters.push(r))   // block until a slot frees
  }
  release() {
    const w = this.waiters.shift()
    if (w) w(); else this.avail++
  }
}
```

### Worker pool draining a queue

```ts
async function runPool<T>(items: T[], workers: number, job: (t: T) => Promise<void>) {
  const queue = [...items]
  const work = async () => { let t; while ((t = queue.shift()) !== undefined) await job(t) }
  await Promise.all(Array.from({ length: workers }, work))   // exactly `workers` in flight
}
await runPool(records, 10, (r) => db.insert(r))
```

### Backpressure

```ts
class BoundedQueue<T> {
  private buf: T[] = []
  constructor(private capacity: number) {}
  async push(item: T) {
    while (this.buf.length >= this.capacity) await this.spaceAvailable()  // producer waits
    this.buf.push(item)
  }
  // consumers pop and signal spaceAvailable(); a full queue throttles the producer
}
```

Prefer the platform mechanism when one exists (Node streams `highWaterMark` + `pipe`).

### Choosing N

N is the real bottleneck: DB pool size, downstream rate limit, CPU cores. More concurrency than the limiter absorbs converts to queueing and timeouts. The right N is usually small (single or low double digits).

---

## Quick reference

- **First move:** make it immutable, confined, or message-passed — no lock needed.
- **Must share:** atomic for one value; lock for a multi-field invariant; CAS for lock-free single value; optimistic version for rare-conflict coarse state.
- **Locks:** smallest scope, consistent global order, no nested locks, no un-owned I/O inside, timeout on acquire.
- **Async:** await or explicitly `.catch` every promise; choose concurrent vs sequential on purpose; never block the event loop; cancellation cleans up in `finally`.
- **Fan-out:** always bounded — semaphore, worker pool, or backpressuring queue, sized to the real bottleneck.
- **Boundary check:** broker → [[queue-fundamentals]]; DB rows → [[database-fundamentals]]; in-process memory → here.
