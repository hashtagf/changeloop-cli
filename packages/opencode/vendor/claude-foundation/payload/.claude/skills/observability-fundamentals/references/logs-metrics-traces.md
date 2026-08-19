# Logs, Metrics & Traces

Concrete recipes for the three pillars. The SKILL gives the principles; this is the field manual — field names, level semantics, metric shapes, propagation code, a worked SLO, and the cardinality traps.

Moved from `SKILL.md` — principles 1-7's full rule/why/how-to-apply/example, ahead of the field-manual detail below.

## Principle 1 (from SKILL.md): Know the three pillars and what each is for

**Rule:** Logs are discrete events, metrics are aggregatable numbers, traces are the causal path of one request. Reach for the right pillar for the question — don't try to make one do another's job.

**Why:** Each pillar carries different information and costs differently. **Metric**: cheap, aggregatable, alertable — tells you *that* and *how many*, never *which one*. **Log**: high detail per event — tells you *why* that operation failed. **Trace**: follows one request across every hop with timing — tells you *where* time was spent. The wrong pillar is expensive: counting log lines for a rate is slow; finding one failing request in metrics is impossible. Incident flow: metric → trace → log.

**How to apply:**
- Emit a **metric** for anything you'd want to alert on, graph, or count: request rate, error rate, latency, queue depth, cache hit ratio.
- Emit a **log** at the points where a human will need the specifics: an error with its cause, a security-relevant decision, a state transition.
- Emit/propagate a **trace** for any request that crosses an async boundary or more than one service — that's the only pillar that reconstructs the cross-service path.
- Don't reconstruct a metric by querying logs in a hot path, and don't try to debug a single request from metrics alone.

**Example:**
```
Incident: "checkout is slow"
  metric  →  http_request_duration p99 on POST /checkout jumped 200ms → 8s   (THAT it's slow, widespread)
  trace   →  one /checkout trace: 7.8s of the 8s is in the `inventory` service call   (WHERE)
  log     →  inventory service log: "lock wait timeout on table reservations, retried 5x"   (WHY)
```

## Principle 2 (from SKILL.md): Logs are structured and leveled — key-value, not string-concat

**Rule:** Emit logs as structured key-value records (JSON or logfmt), at a level that means something. `ERROR` means "a human should act." Include enough context (ids, not secrets) to debug the event six months from now, with no access to your memory of today.

**Why:** A log line is written once and read under pressure months later. An interpolated string is unparseable at scale — you can't filter, count, or alert on it. Key-value is queryable: filter by `order_id`, group by `level`, alert on a field. Levels give the firehose a dial: if everything is `INFO`, the real `ERROR` drowns. And logs leak: a line with a password, bearer token, or PAN is a breach sitting in your aggregator's index. Log the *id*, never the secret.

**How to apply:**
- Use a structured logger (`pino`, `zerolog`, `structlog`, `slog`, `serilog`) and pass fields as key-value, never via string interpolation.
- Pick the level by **what it asks of the reader**, not by vague severity:
  - `ERROR` — something failed and a human should look (it should be alertable; if no one needs to act, it's not an error).
  - `WARN` — degraded but handled (retry succeeded, fell back, approaching a limit).
  - `INFO` — a notable business event (order placed, user registered) — sparse by design.
  - `DEBUG` — developer detail, off in production by default.
- Attach context fields every reader will want: ids (`user_id`, `order_id`, `request_id`), the operation, the outcome, the duration. Make ids consistent across the codebase (principle 3 depends on it).
- **Never** log secrets, credentials, tokens, full PANs, or full PII — log identifiers and redacted forms. ([[security-fundamentals]] owns the trust-boundary rule; this is its application to what you *write* into logs, mirroring the repo's `protect-secrets.sh` guard on what you *read*.)

**Example:**
```ts
// Bad — unparseable, no level discipline, leaks the token, no ids to correlate
console.log("user logged in " + email + " token=" + jwt)

// Good — structured, leveled, correlatable, no secret
log.info({ event: "user.login", user_id: user.id, request_id: ctx.requestId, method: "password" })
log.error({ event: "payment.failed", order_id: o.id, request_id: ctx.requestId,
            amount_cents: o.totalCents, reason: "card_declined", provider_code: "do_not_honor" })
// note: user_id not email, provider_code not raw card data
```

## Principle 3 (from SKILL.md): Correlate — one id threaded through every log and across every boundary

**Rule:** Stamp each request with a correlation id (request id / trace id) at the edge, attach it to every log line that request produces, and propagate it across every service and queue boundary it crosses. Without it you cannot reconstruct what happened.

**Why:** Once a request fans out across services or async hops, logs from different processes interleave. Without a shared id, "what happened to order 8821" is unanswerable — you can't know which lines belong together. With a correlation id, one filter pulls the whole causal story. It costs one header and one log field and is the highest-leverage observability investment. The id must survive every boundary — drop propagation at one hop and the trace dead-ends there.

**How to apply:**
- Generate (or accept from the inbound header) a correlation id at the edge — gateway, first handler, message consumer.
- Bind it to the request context (async-local storage, context object, MDC) so every log call inside that request picks it up automatically — don't thread it by hand through every function signature.
- Propagate outbound: set the trace header on every HTTP/gRPC call; copy it into every published message's metadata; include it in every enqueued job.
- Standardize on **W3C Trace Context** (`traceparent`) if you can — it's what OpenTelemetry and most vendors speak, so the id survives across third-party hops.
- On the consume side of a queue, *read the id back out* of the message and rebind it — a worker that generates a fresh id severs the chain to the producer.

**Example:**
```ts
// Edge: adopt inbound id or mint one, bind to context
const requestId = req.headers["x-request-id"] ?? crypto.randomUUID()
withContext({ requestId }, () => handler(req))   // every log inside now carries request_id

// Outbound HTTP — propagate, don't drop
await fetch(url, { headers: { "x-request-id": ctx.requestId, traceparent: ctx.traceparent } })

// Publishing to a queue — id rides in metadata, not lost at the async hop
await queue.publish(topic, payload, { headers: { "x-request-id": ctx.requestId } })

// Consuming — REBIND from the message, don't mint a fresh one (that severs the chain)
const requestId = msg.headers["x-request-id"]
withContext({ requestId }, () => process(msg))
```

## Principle 4 (from SKILL.md): Metrics that answer questions — RED for services, USE for resources, percentiles not averages

**Rule:** Don't emit metrics at random. For a request-serving **service**, measure RED: **R**ate, **E**rrors, **D**uration. For a **resource** (CPU, pool, disk, queue), measure USE: **U**tilization, **S**aturation, **E**rrors. Report duration as percentiles, never as a mean.

**Why:** "Add some metrics" produces a junk drawer no one reads. RED and USE are checklists that guarantee metrics answer the questions you'll ask in an incident. Service: rate, errors, duration cover "is this healthy" almost completely. Resource: utilization, saturation, errors localize a bottleneck fast. Averages lie: 95 requests at 50ms + 5 at 10s = 550ms mean — a latency *no single user experiences*. The slow 5 file the tickets; only p99 shows them.

**How to apply:**
- For each service/endpoint, emit: a **counter** for request count (the rate, by route and status), a **counter** for errors (so you can compute error ratio), and a **histogram** for duration (so you can read percentiles).
- For each constrained resource — DB connection pool, thread pool, queue, cache, disk — emit utilization (in use / capacity), saturation (waiting / rejected / queue depth), and error count.
- Read latency as **p50/p95/p99**, never `avg`. Use a histogram metric type so percentiles are computed correctly server-side — you cannot average pre-aggregated percentiles across instances.
- Label metrics by the dimensions you'll slice by (route, status_class, region) — but mind cardinality (principle 7).
- Counters for things that only go up (requests, errors), gauges for levels (pool in-use, queue depth), histograms for distributions (latency, payload size).

**Example:**
```
# RED for the checkout service
http_requests_total{route="/checkout", status="200"}        counter   → rate & error ratio
http_requests_total{route="/checkout", status="500"}        counter
http_request_duration_seconds_bucket{route="/checkout"}     histogram → p50/p95/p99

# USE for the DB connection pool it depends on
db_pool_connections_in_use / db_pool_size                   → utilization
db_pool_wait_queue_depth                                    → saturation
db_pool_acquire_timeouts_total                              → errors

# Bad: a single avg gauge that hides the tail
checkout_latency_avg_ms  723   ← means nothing; whose latency? the p99 could be 30s
```

## Principle 6 (from SKILL.md): Alert on symptoms users feel, not on causes — and make every alert actionable

**Rule:** Page on the symptom a user experiences (requests failing, requests slow, SLO budget burning), not on a cause (`CPU > 80%`, `memory high`). Every alert that pages a human must be actionable — if there's nothing to do, it shouldn't page.

**Why:** Causes are not outcomes. High CPU might be invisible to users. Paging on causes produces false alarms; false alarms train on-call to ignore the pager; alert fatigue is how good monitoring leads to *worse* response. The fix: alert on what the user feels — errors, slow requests, SLO budget burning. Causes belong on dashboards consulted *after* a symptom fires. The actionability test: "when this fires at 3 a.m., is there a specific thing to do?" If the honest answer is "look and go back to sleep," it's a dashboard panel, not an alert — demote it.

**How to apply:**
- Alert on **SLO burn rate** (principle 6), elevated error ratio, and latency-percentile breach — symptoms. Use **multi-window burn-rate** alerts (each alert pairs a long window with a short one — e.g. page on 1h AND 5m both burning; ticket on 6h AND 30m) so you page on real budget loss, not a one-minute blip.
- Put causes (CPU, memory, GC, pool saturation) on **dashboards**, not pagers — they're diagnostic context, consulted after a symptom fires.
- For every paging alert, write the **runbook link** and the first action into the alert itself. No runbook → not ready to page.
- Tier by urgency: **page** = user-facing and needs action now; **ticket** = needs attention this week; **dashboard** = context only. Most things are not pages.
- Periodically audit: every alert that fired and required no action is a candidate for deletion or demotion.

**Example:**
```
# Bad — a cause, fires constantly, nothing to do, trains people to ignore
ALERT HighCPU  IF  cpu_usage > 80%  FOR 5m   → pages at 3am during a harmless batch job

# Good — a symptom users feel, actionable, with a runbook
ALERT CheckoutErrorBudgetFastBurn
  IF   error_budget_burn_rate(slo="checkout-availability", window="1h") > 14
   AND error_budget_burn_rate(slo="checkout-availability", window="5m") > 14
  FOR  2m
  ANNOT runbook="https://wiki/runbooks/checkout-availability"
        summary="Checkout burning 30-day budget 14x — see runbook step 1: check inventory svc"
```

## Principle 5 (from SKILL.md): Define SLI/SLO/error budgets — measure "healthy" before you alert on it

**Rule:** Before you can alert meaningfully or make a reliability tradeoff, define what "healthy" *measurably* means: an **SLI** (the metric), an **SLO** (the target on it), and the **error budget** (1 − SLO) that the target implies.

**Why:** "Is the service healthy?" is unanswerable without a number. An **SLI** measures one user-facing quality (fraction of `/checkout` requests non-5xx and < 500ms). An **SLO** sets the target (99.9% over 30 days). The **error budget** is what the target permits to fail (0.1% ≈ 43 min/month) — the currency for reliability-vs-velocity decisions: budget left → ship; exhausted → stabilize. Without an SLO you either chase 100% (infinitely expensive) or have no bar at all (every degradation is an argument).

**How to apply:**
- Pick SLIs that reflect **user experience**, expressed as good-events / valid-events: availability (non-5xx ratio), latency (fraction under a threshold), correctness/freshness where relevant. One to three per service — not dozens.
- Set the SLO target from what users actually need, not from "as high as possible." 99.9% and 99.99% differ by 10× the cost; justify the extra nine.
- Compute the error budget and *use it*: it's the shared currency between "ship faster" and "stabilize." Burn it fast → reliability work; budget healthy → feature velocity.
- Drive principle-5 alerts off **burn rate** against the budget, not off raw thresholds — that's what makes them symptom-based and tunable.

**Example:**
```
SLI:  proportion of POST /checkout requests that are non-5xx AND < 500ms
SLO:  99.9% over a rolling 30 days
Error budget:  0.1% of requests  →  over 30 days ≈ 43m12s of total unavailability allowed

Budgeting in practice:
  budget 80% remaining, mid-month  →  green: ship the risky migration
  budget exhausted on day 12       →  freeze risky deploys, spend remaining cycle on reliability
  one bad deploy burned 40% in 1h  →  fast-burn alert fired (principle 5), roll it back
```

## Principle 7 (from SKILL.md): Cost and cardinality discipline — sample and budget, or the bill and the noise bury you

**Rule:** Telemetry is not free. High-cardinality metric labels can multiply your time-series count into the millions; a debug-log firehose can cost more than the service it watches and bury the one signal that mattered. Choose labels, sample, and budget retention deliberately.

**Why:** Two failure modes. **Cardinality**: every unique label combination is a separate stored time series. A `user_id` label on a service with 1M users = 1M series — the backend falls over and the bill explodes. **Volume**: debug-logging every request in prod generates terabytes and buries the one `ERROR` in ten million lines. More telemetry past a point is more cost and more noise, not more observability. High-cardinality ids belong in logs/traces (built for per-event detail), never in metric labels.

**How to apply:**
- **Metric labels**: only bounded, low-cardinality dimensions — `route`, `status_class`, `region`, `method`. **Never** `user_id`, `order_id`, `email`, `request_id`, raw URL with ids, or anything unbounded. Put those identifiers on logs/traces instead.
- Watch derived cardinality: a `route` label with un-templated paths (`/order/8821`, `/order/8822`, …) is secretly unbounded — template it to `/order/:id`.
- **Sample** high-volume traces and logs: keep all errors and slow requests, sample a small percentage of normal successes (head or tail sampling). You don't need every healthy request's full trace.
- Keep production at `INFO`; make `DEBUG` switchable per-request or per-service for incidents rather than always-on.
- Set **retention** by value: detailed traces days, aggregated metrics months/years (they're cheap), raw debug logs short. Budget ingestion and review the bill — runaway telemetry cost is a real outage-of-the-finance-kind.

**Example:**
```
# Bad — user_id label: 1 metric × 1M users = 1M time series, backend dies, bill explodes
http_requests_total{route="/checkout", user_id="u_91", status="200"}

# Good — user_id lives in the log (per-event detail), metric stays low-cardinality
http_requests_total{route="/checkout", status_class="2xx"}        # bounded labels only
log.info({ event: "checkout.ok", user_id: "u_91", request_id: ctx.requestId })   # detail here

# Bad — un-templated path is secretly unbounded cardinality
http_requests_total{route="/order/8821"}   # a new series per order id

# Good — templated, bounded
http_requests_total{route="/order/:id"}

# Sampling: keep the signal, drop the bulk
trace_sample_rate: errors=1.0, slow(>1s)=1.0, normal_success=0.01
```

---

## Structured logging: field conventions

Emit logs as key-value (JSON or logfmt), not interpolated strings. Standardize field names across the codebase so one query (`order_id = "o_88"`) pulls the whole story regardless of which service emitted each line.

### The baseline fields every line should carry

| Field | Type | Why |
|---|---|---|
| `timestamp` | ISO-8601 / RFC3339, UTC | sortable, unambiguous; let the logger add it |
| `level` | enum (see below) | the dial that lets you filter the firehose |
| `event` | dotted name, e.g. `order.placed` | a stable key you can count and alert on — not a free-text sentence |
| `request_id` / `trace_id` | string | the correlation handle (see propagation section) |
| `service` | string | which service emitted it (auto-injected) |
| `msg` | short human string | for the human reading one line; not for machines to parse |

### Context fields — attach what the next debugger needs

Pick the ids and the outcome of the operation. Test: *could a stranger reconstruct what happened from this line alone, six months from now?*

```json
{ "timestamp":"2026-06-12T09:31:02.114Z", "level":"error", "event":"payment.failed",
  "request_id":"req_7f3a", "service":"checkout", "user_id":"u_91", "order_id":"o_88",
  "amount_cents":4200, "currency":"USD", "provider":"stripe", "provider_code":"card_declined",
  "attempt":3, "duration_ms":812, "msg":"payment declined after 3 attempts" }
```

### Never log these

Logs are indexed, replicated, and shipped to third-party aggregators — the single most common accidental data-leak surface.

- **Secrets / credentials**: passwords, API keys, bearer/JWT tokens, session cookies, private keys, DB connection strings with passwords.
- **Full PII**: full card numbers (PANs), CVV, SSNs, full DOB, raw email/phone in bulk where regulated.
- **Whole request/response bodies** on a hot path — they smuggle in all of the above and blow up volume.

Do / don't:

```
DON'T  log.info("auth ok for " + email + " jwt=" + token)
DO     log.info({ event:"auth.ok", user_id: user.id, request_id: ctx.requestId })

DON'T  log.error({ event:"charge.fail", card: "4242424242424242", cvv:"311" })
DO     log.error({ event:"charge.fail", card_last4:"4242", provider_code:"do_not_honor" })
```

---

## Log levels: the action each one demands

Make each level encode *what it asks of a reader*, so `level=error` returns exactly what a human must act on.

| Level | Meaning — what it asks of the reader | Prod default |
|---|---|---|
| `ERROR` | **A human should look.** Something failed and isn't self-healing. Should be alertable. If nobody needs to act, it is **not** an error. | on |
| `WARN` | Degraded but handled — retry eventually succeeded, fell back to a default, approaching a quota. Worth a dashboard, not a page. | on |
| `INFO` | A notable business event: order placed, user registered, job completed. **Sparse by design** — one or a few per request, not per loop iteration. | on |
| `DEBUG` | Developer detail: branch taken, intermediate value, cache hit. | off (switchable) |
| `TRACE` | Firehose — every function entry, full payloads. Local/incident only. | off |

Two most common level mistakes:
- **Everything is `INFO`** — level carries zero information; the real `ERROR` drowns. Demote noise.
- **`ERROR` for handled conditions** — logging `ERROR` on a successfully-retried failure trains on-call that errors are ignorable. That's a `WARN`. Reserve `ERROR` for "this actually failed."

Keep prod at `INFO`. Make `DEBUG` flippable per request or per service (header, feature flag, config push) — never always-on.

---

## Metrics: RED and USE recipes

**RED** covers request-serving services; **USE** covers resources. Use the right *type* — counter, gauge, or histogram — or the math comes out wrong.

### Metric types (get this right or percentiles lie)

- **Counter** — monotonically increasing total. Requests, errors, bytes. You compute a *rate* from it (`rate(http_requests_total[5m])`). Never use a gauge for a count.
- **Gauge** — a value that goes up and down. Pool connections in use, queue depth, temperature. A point-in-time level.
- **Histogram** — bucketed distribution. Latency, payload size. **The way to get fleet-wide percentiles** — the backend computes p95/p99 from buckets across all instances (summaries/sketches also yield percentiles but don't aggregate across instances). You cannot average per-instance percentiles into a fleet percentile.

### RED — for a request-serving service / endpoint

```
# Rate  — how many requests (a counter; rate() derives requests/sec)
http_requests_total{service="checkout", route="/checkout", method="POST", status="200"}

# Errors — count failures so you can compute error ratio = errors / total
http_requests_total{... status="500"}        # 5xx (server fault)
# error ratio: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Duration — a histogram, so p50/p95/p99 are correct
http_request_duration_seconds_bucket{service="checkout", route="/checkout", le="0.1"}
http_request_duration_seconds_bucket{... le="0.5"}
http_request_duration_seconds_bucket{... le="1.0"}
http_request_duration_seconds_bucket{... le="+Inf"}
# p99: histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

Those three answer "is this service healthy" almost completely: serving traffic (rate), failing (errors), slow (duration).

### USE — for a constrained resource

For every resource a request can wait on — DB connection pool, thread pool, queue, cache, disk, CPU:

```
# Utilization — how busy (fraction of capacity in use)
db_pool_connections_in_use   /   db_pool_size                # gauge ratio

# Saturation — the work that can't be served right now (queued / rejected)
db_pool_wait_queue_depth                                     # gauge
worker_queue_depth                                           # gauge

# Errors — the resource's own failures
db_pool_acquire_timeouts_total                               # counter
```

When a RED symptom fires, USE on the dependencies tells you *which resource* is the bottleneck — utilization near 100% with rising saturation is your culprit.

### Percentiles, never averages

```
# DON'T — avg hides the tail, describes nobody
checkout_latency_avg_ms  723

# DO — histogram, read as percentiles
p50 = 48ms   p95 = 210ms   p99 = 9_400ms
#  → 1-in-100 checkouts takes 9.4s; the 723ms avg made that invisible.
```

---

## Traces & spans: following one request

A **trace** is the end-to-end story of one request — a tree of **spans** (HTTP handler, DB query, outbound call), each with start time, duration, and parent. The trace answers what metrics and logs can't: *where did this one request spend its time across every service?*

### Trace / span anatomy

- **trace_id** — one id for the whole request; the same across every service and span.
- **span_id** — id of one operation within the trace.
- **parent_span_id** — links a span to the operation that caused it, building the tree.
- **attributes** — key-values on the span (`http.route`, `db.statement` (parameterized!), `error=true`).

```
trace_id = 4bf92f...   (one id for the entire /checkout request)
└─ span: POST /checkout                 [checkout svc]   8.10s
   ├─ span: validate cart               [checkout svc]   0.02s
   ├─ span: POST inventory.reserve      [checkout svc]   7.80s   ← the time sink
   │  └─ span: SELECT ... FOR UPDATE    [inventory svc]  7.78s   error=true, lock_wait_timeout
   └─ span: POST payment.charge         [checkout svc]   0.21s
```

One look localizes the 8s to the inventory lock wait. Then the inventory service's logs (filtered by the same `trace_id`) tell you *why*.

### Instrument

- Auto-instrument the framework (OpenTelemetry SDKs wrap HTTP servers/clients, DB drivers, queue clients) for the common spans.
- Add manual spans around meaningful business operations the framework can't see (`reserve_inventory`, `compute_pricing`).
- Put a parameterized statement, not interpolated values, in `db.statement` — a span attribute is as leaky as a log field.

---

## Correlation: propagating the id across boundaries

The trace is only continuous if the id **survives every hop** — drop it at one boundary and logs after that point are orphaned. Standardize on **W3C Trace Context** (`traceparent`) — OpenTelemetry and most vendors speak it, so the id survives third-party hops.

### The pattern, end to end

```ts
// 1. EDGE — adopt an inbound id or mint one; bind it to request-scoped context
//    so EVERY log/span inside this request inherits it without manual threading.
const ctx = {
  requestId: req.headers["x-request-id"] ?? crypto.randomUUID(),
  traceparent: req.headers["traceparent"],   // W3C; SDK continues the trace from it
}
runWithContext(ctx, () => handler(req))       // async-local-storage / context.WithValue / MDC

// 2. OUTBOUND HTTP — propagate on every call. Dropping this severs the trace.
await fetch(inventoryUrl, {
  headers: { "x-request-id": ctx.requestId, traceparent: currentTraceparent() },
})

// 3. PUBLISH TO A QUEUE — the id rides in MESSAGE METADATA (a header is gone once
//    the request returns; the consumer runs later, in another process).
await queue.publish("inventory.reserve", payload, {
  headers: { "x-request-id": ctx.requestId, traceparent: currentTraceparent() },
})

// 4. CONSUME — READ the id back out and REBIND. Minting a fresh id here is the
//    classic mistake: it severs the chain to the producer and you lose the link
//    between "request enqueued the job" and "worker ran the job."
function onMessage(msg) {
  const ctx = {
    requestId: msg.headers["x-request-id"],
    traceparent: msg.headers["traceparent"],
  }
  runWithContext(ctx, () => process(msg))
}
```

Steps 3-4 (the async hop) are where correlation is most often lost and most valuable — the one boundary where logs are guaranteed to be in different processes at different times.

---

## SLI / SLO / error budget: a worked example

Three nested definitions make "healthy" a number:
- **SLI** — `good events / valid events` for one user-facing quality.
- **SLO** — the target on the SLI over a window.
- **Error budget** — `1 − SLO`: what you're *allowed* to fail. The currency for reliability-vs-velocity decisions.

### Worked: checkout availability

```
SLI:           proportion of POST /checkout requests that are non-5xx AND < 500ms
               = count(non-5xx AND <500ms) / count(valid requests)
SLO:           99.9% over a rolling 30-day window
Error budget:  1 − 0.999 = 0.1% of requests may fail
               in time terms over 30 days ≈ 43m 12s of total "down"
```

### Using the budget

```
budget 80% remaining, mid-month     → green: ship the risky migration
budget 100% remaining for months    → SLO too loose; you can spend it or loosen
budget exhausted on day 12          → freeze risky deploys; spend remaining cycle on reliability
one bad deploy burned 40% in 1 hour → fast-burn alert fires → roll back now
```

### Burn-rate alerting (the symptom alert from principle 5)

Alert on *how fast you're burning the 30-day budget*, with **multi-window** confirmation so a one-minute blip doesn't page:

```
# Burn rate 14.4 means: at this pace you'd exhaust the entire 30-day budget in ~2 days.
# Require BOTH a long and a short window to be burning, to filter transients.
ALERT CheckoutBudgetFastBurn
  IF   burn_rate(slo="checkout-availability", window="1h")  > 14.4
   AND burn_rate(slo="checkout-availability", window="5m")  > 14.4
  FOR  2m
  SEVERITY page
  ANNOT runbook="https://wiki/runbooks/checkout-availability"

# A separate, gentler slow-burn alert catches steady low-grade erosion (ticket, not page).
ALERT CheckoutBudgetSlowBurn
  IF   burn_rate(... window="6h")  > 1   AND  burn_rate(... window="30m") > 1
  SEVERITY ticket
```

Fast-burn pages; slow-burn tickets. Both fire on the *symptom* — budget loss — not on a cause like CPU.

---

## Cardinality & cost pitfalls

### Cardinality — unique label combinations explode time-series count

Every distinct label-value combination is a **separate stored time series**. A high-cardinality label multiplies your series count without bound; the backend OOMs and the bill detonates. Identifiers belong in **logs and traces**, never in metric labels.

```
# DON'T — user_id on a metric: 1 metric × 1,000,000 users = 1,000,000 series. Backend dies.
http_requests_total{route="/checkout", user_id="u_91", status="200"}

# DO — keep the metric low-cardinality; the id lives in the correlated log/trace
http_requests_total{route="/checkout", status_class="2xx"}
log.info({ event:"checkout.ok", user_id:"u_91", request_id: ctx.requestId })
```

**Hidden cardinality** — a label that *looks* bounded but isn't, because un-templated values leak in:

```
# DON'T — raw path is a new series per id (and per uuid, per search query…)
http_requests_total{route="/order/8821"}        # /order/8822, /order/8823, … unbounded

# DO — template the route to its pattern
http_requests_total{route="/order/:id"}
```

Safe labels: **bounded and known in advance** — `route` (templated), `method`, `status_class`, `region`, `tenant_tier`. Unsafe: `user_id`, `order_id`, `request_id`, `email`, raw URL, raw error message, full SQL.

### Volume — the debug firehose costs money and hides the signal

Logging every request at `DEBUG` in prod produces terabytes and buries the one `ERROR` in ten million lines. More telemetry past a point is cost and noise, not observability.

```
# Sampling: keep 100% of what matters, a fraction of the routine
trace_sample_rate:
  errors:           1.00     # always keep failures
  slow (>1s):       1.00     # always keep the tail
  normal success:   0.01     # 1% of healthy requests is plenty to characterize normal

log levels in prod:  INFO        # DEBUG switchable per-request for incidents, not always-on
```

### Retention — budget by value

```
raw debug logs        → short (days)
detailed traces       → days  (sampled)
aggregated metrics    → long  (months/years — cheap and needed for trend analysis)
```

Review the telemetry bill like any infra cost. Runaway observability spend is an incident your finance team reports instead of your pager.
