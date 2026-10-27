# Instrumentation

Make the system *tell* you what it did instead of reasoning about what it *should* do. A well-placed log replaces an hour of theorizing with a fact.

## The hierarchy — use the lightest tool that answers

1. **Print / log** — universal, fast, ~80% of bugs.
2. **Structured logs** — to filter / correlate across requests.
3. **Debuggers / breakpoints** — to walk state interactively or inspect deep objects (~15%).
4. **Distributed tracing / APM** — when the bug crosses service boundaries.
5. **System-level** (`strace`, `dtrace`, `eBPF`, `tcpdump`) — OS/network layer, when the app can't see it (~5%).

## Print debugging, done well

For each suspect variable, print in this order — most "wrong value" bugs are actually wrong *type* or *shape*:
1. **Existence** — `log('got here')` — proves the line ran.
2. **Identity** — `log('handler for user', user.id)` — proves *which* invocation.
3. **Type** — `log(typeof x, x?.constructor?.name, x)` — runtime type beats declared type.
4. **Shape** — `log(Object.keys(x))` — what the object actually has.
5. **Value** — structured (`JSON.stringify(x,null,2)`, `%#v`) so nested objects don't render as `[Object]`.

- **Where:** at the **boundaries** of the suspect region (enter, leave, each branch). Boundary values right → bug is inside; wrong → outside. (Bisection in miniature.)
- **Tag every log** so you can grep it out of 200 noisy lines:
```ts
console.log('[chargeOrder] after validate:', { orderId: order.id, total: order.total })
```
- **Clean up:** debug logs are debt — delete after the fix, or promote genuinely-useful boundary events to the project logger. Never leave naked `console.log('here 4')`.

## Structured logging

Every line a JSON object with consistent fields:
```json
{"ts":"2026-05-13T14:32:01Z","level":"info","event":"order.charge.start",
 "request_id":"req_abc","order_id":"ord_123","total_cents":1000}
```
Buys you: filter by `request_id` (one request's whole path), by `event` (all charge attempts), pivots in your log tool (`total_cents == 0`), context carried across service boundaries. Learn the codebase's conventions before adding; if none exist and the bug is cross-cutting, adding them may be the fix.

**Levels:** bump suspect components to `debug`/`trace` in dev; in prod beware hot-path debug logs (pipeline swamp, PII) — sample or flag; in tests, unbuffer / pass through suppressed logs.

## Debuggers

When state is rich and nested, a debugger beats a hundred prints:
- **Conditional breakpoints** — break only when `order.id === 'ord_123'`.
- **Logpoints** — print at a line without stopping or recompiling.
- **Watch expressions** — track `user.permissions.length` as you step.
- **Step into / over / out** — over when you trust the callee, into when you don't.

No interactive UI (agentic context)? Fall back to dense structured prints at every step the debugger would've shown.

## Tracing

Multi-service bugs → distributed tracing (OpenTelemetry, Jaeger, Honeycomb, Datadog): a tree of spans with timing + attributes propagated via trace headers — shows the exact path, the slow/errored span, where a value changed shape. Missing a useful attribute (order id, payload size)? Add it — lowest-effort, highest-value. No tracing + a distributed bug wasting days → adding it is the right fix.

## System-level tracing

When the app says "success" but nothing happened, drop a layer:
- **`strace -p <pid>` / `dtruss`** — every syscall ("is it even opening the file?").
- **`tcpdump` / Wireshark** — actual bytes on the wire (TLS, HTTP/2, proxy misbehaving).
- **`eBPF`** (`bpftrace`, `bcc-tools`) — prod-safe: `tcpconnect`, `opensnoop`, `execsnoop`, `biolatency`.
- **`/proc/<pid>/`** — fds, maps, status. **`lsof`, `netstat`, `ss`** — what's open / connected / listening.

For bugs *below* the app layer: timeouts not in logs, "file not found" when it's there, DNS misery, EAGAIN/EINTR loops.

## Production instrumentation

Make prod carry the evidence on the next occurrence: log the failure point with full context (sanitized), add a metric on the failure shape (`order.charge.zero_total`), add a trace attribute, deploy, wait. Ship an instrumented build, not a "fix" — a fix-without-repro is a guess.

## Anti-patterns

- Unlabeled `console.log(x)` in a hot loop — can't tell which is which.
- Logging only the happy path — the interesting lines are in the error branch.
- Logging *after* the crash — the line after the throw never runs; log *before*.
- Mousing over debugger values without recording them — the bug is often the pattern across calls. Capture, don't just look.
- Removing instrumentation before the regression test passes.
