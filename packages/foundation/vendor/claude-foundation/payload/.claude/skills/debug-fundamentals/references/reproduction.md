# Reproduction

From "it happened to someone, sometimes" to "I can trigger it on demand in <60s locally" — a bug you can't reproduce is one you can't verify a fix for.

A real repro is **specific** (exact input/env/version/command), **deterministic enough to iterate** (get the rate up — 1-in-1000 is a flake hunt), **cheap** (<60s cycle), and **standalone** (bake inputs in; no reliance on prod data / `~/.aws` / yesterday's deploy). Artifact: a failing test, a `curl`, a script, or a saved payload.

## The repro funnel

Work top-down; stop at the first reliable trigger.

1. **Production-equivalent** (staging / prod replica; same data shape, config, versions). Most prod-only bugs vanish here → cause is environmental (data, config, version skew), and now you know where to look.
2. **Local** — same code, same deps, your machine. Stops reproducing here → the cause is something local lacks: load, scale, real data, or a dependency you mocked.
3. **In a test** — gold standard: fast, deterministic, CI-replayable, becomes the regression test.

```ts
test('order with zero-priced item does not crash discount math', () => {
  const order = makeOrder({ items: [{ price: 0 }] })
  expect(() => applyDiscount(order)).not.toThrow()  // currently throws DivByZero
})
```

Needs a DB/network/queue? Write an *integration* test against a real instance — the mock is exactly where the bug isn't.

## Minimize it

Smallest input/sequence/state that still triggers the bug — minimization often reveals the cause ("it's specifically `total === 0`").
- Remove one field/header/param/step; re-run. Still fails → leave it out. Now passes → the trigger touches that piece.
- Long inputs → binary-search: chop in half, keep the failing half, repeat (see `references/bisection.md`).

## When it's "flaky"

Not random — deterministic with a hidden input you haven't found. List what you assume is constant, vary the most suspicious, watch the rate. Common hidden variables:
- **Concurrency / interleaving** — a race. Add load: `seq 100 | xargs -P 20 -I _ <repro>`.
- **Time** — fails at 23:59 UTC → timezone / date-rollover. Pin the clock.
- **Map/set iteration order** — unpromised; sort or use ordered collections.
- **Test isolation** — fails only after another test → shared global state (DB rows, env, singleton). Run alone; run suite in reverse; bisect the order.
- **Network / DNS** — retries mask it; disable them to see the real failure.
- **Floating point** — `0.1 + 0.2 !== 0.3`; suspect for money / comparisons.
- **Random seeds** — pin them.
- **Cache state** — cold vs warm differ; clear or fill.
- **Resource limits** — fds, memory, pools; shows at hour 4 of a soak → a leak.

## Production-only bugs

Make prod carry the evidence:
1. When the failure handler fires, log the full inbound request (sanitized) + user id, timestamp, request id, version, host.
2. Log the value of any field on the failure path *before* it's used.
3. Wait for the next occurrence — don't waste it.
4. Replay the logged payload locally as a test / `curl` — almost always reproduces.

Too sensitive to log values? Log the *shape* — types, lengths, field presence.

## Pitfalls

- "Reproduces sometimes" stops being enough below ~80% — find the variable or instrument prod.
- Re-running until it passes teaches CI to hide the bug; it's not a fix.
- Repros needing your branch + laptop aren't portable — bake into the repo.
- Don't lose the repro after the fix; promote it to the suite (principle 7).
