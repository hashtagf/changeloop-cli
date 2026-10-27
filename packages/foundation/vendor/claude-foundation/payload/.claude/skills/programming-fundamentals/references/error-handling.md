# Error Handling

## The three buckets

### 1. Expected failures (part of the domain)
Validation failed. Resource not found. Insufficient funds. The user typed the wrong password.

- **Belong in the return type.** `Result<T, E>`, `Either<E, T>`, tagged union, Go's `(value, error)`, or Rust's `Option`/`Result`.
- The caller is *forced* to handle them by the type system — no surprise control flow.

### 2. Bugs (invariant violations)
A null where the type said non-null. An index out of bounds. A "this should never happen" branch.

- **Should crash loudly.** Throw, panic, `assert`. Don't try to recover — the program's understanding of the world is already broken; continuing makes the next bug harder to diagnose.
- These get logged with full context and surfaced to monitoring. They're tickets, not retries.

### 3. Infrastructure failures (the world misbehaved)
Network blip. DB connection lost. Disk full. Upstream service down.

- **Handle at the layer with retry/fallback context** — not in the deepest helper.
- Wrap with context as they propagate (`fmt.Errorf("save order: %w", err)`, `throw new Error("...", { cause: e })`) so the eventual log line tells the whole story.

## Where to handle

Handle at the **lowest layer that has enough context to do something useful**; propagate everywhere above.

```ts
// Bottom — knows nothing about retry policy, just propagates
async function fetchOrder(id: string) {
  const res = await http.get(`/orders/${id}`)
  if (!res.ok) throw new Error(`fetch order ${id}: ${res.status}`)
  return res.json()
}

// Middle — knows retry is appropriate here
async function fetchOrderWithRetry(id: string) {
  for (let i = 0; i < 3; i++) {
    try { return await fetchOrder(id) }
    catch (e) { if (i === 2) throw e }
  }
}

// Top (HTTP handler) — knows how to translate to the user
app.get('/orders/:id', async (req, res) => {
  try { res.json(await fetchOrderWithRetry(req.params.id)) }
  catch (e) {
    logger.error({ err: e, orderId: req.params.id }, 'fetch failed')
    res.status(502).json({ error: 'upstream unavailable' })
  }
})
```

## Boundary handling

System boundaries (HTTP handlers, message consumers, CLI entry points, scheduled jobs) **must** catch everything. An unhandled exception at a boundary either:

- Crashes the process (a CLI exits with a stack trace; an HTTP server returns a generic 500 with no context).
- Leaves a request half-finished (a message consumer that throws may or may not ack — your at-least-once becomes never).

Always at the boundary:
1. Catch.
2. Log with full context (the request id, the inputs, the user, the stack).
3. Translate to the boundary's error model (HTTP status, exit code, message NACK).

## What not to do

- **`catch { }`** — empty catch. The program now silently runs in an unknown state.
- **`catch (e) { console.log(e) }` then continue** — same thing, with a log message no one reads.
- **`if err != nil { return nil }`** — swallowing in Go; the caller gets a nil and goes on.
- **Catching at the wrong layer "just to be safe"** — the deepest helper has no idea whether to retry or fail. Catching here just hides information from layers that could decide.

## Result types in languages without them

- **TypeScript:** discriminated unions. `type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }`. Plenty of libraries; or just write it yourself.
- **Python:** return a `Result` class, or use a tuple `(value, error)` for simple cases. Don't lean only on exceptions for expected failures — they're invisible at the call site.
- **Go:** the language gives you `(T, error)` for free; use it. Wrap with `fmt.Errorf("context: %w", err)` so the chain is debuggable.
- **Rust:** `Result<T, E>` and `?` are the language's native handling — use them.
- **Java/C#:** checked exceptions vs unchecked is a long argument; the principle holds — expected failures should be visible to the caller, bugs should crash.

## The smell test

Ask of every `catch` / `recover` / `if err != nil`: **"if this code didn't exist, what would go wrong?"** If the answer is "the user would see a confusing 500" → boundary handling, good. If the answer is "nothing — we'd just notice the bug sooner" → delete the catch.
