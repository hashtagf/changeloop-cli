# Observability

Moved from `SKILL.md` — principle 6's full rule/why/how-to-apply/example, ahead of the topic-organized detail below.

## Principle 6 (from SKILL.md): Build observability in from day one

**Rule:** Every request path produces structured logs, useful metrics, and a trace that crosses every component boundary. Define SLIs and SLOs *before* you ship — not after the first outage.

**Why:** In a distributed system, "what happened" is a relationship across N components — you can't reconstruct it without correlation IDs, propagated trace context, and metrics over time. Teams that bolt observability on after the first outage spend months instrumenting while trust burns.

**How to apply:**
- **Three pillars, all on, structured.**
  - **Logs:** structured (JSON), with `trace_id` and `span_id` on every line. No bare `console.log("got here")`.
  - **Metrics:** **RED** for request paths (Rate, Errors, Duration) and **USE** for resources (Utilization, Saturation, Errors). Use histograms for latency — averages hide the tail.
  - **Traces:** OpenTelemetry (OTel) is the default — CNCF standard, vendor-neutral; as of 2025 logs joined traces and metrics as stable signals over OTLP. Trace context propagates across every hop. (Pick vendor-specific SDK only with hard reason; OTel is portable across Datadog, Honeycomb, Tempo, Jaeger, New Relic, X-Ray.)
- **Define SLIs and SLOs.** SLI = what you measure; SLO = the target; error budget = the gap. The budget funds feature velocity vs. reliability work.
- **Track DORA delivery metrics alongside SLOs.** Deployment frequency, lead time, change failure rate, and failed-deployment recovery time (renamed from MTTR in 2023) describe how *fast and safely* you ship; SLOs describe how *well the running system performs*.
- **Correlate everything.** One trace ID generated at the edge flows through every hop and into every log line. Without this, multi-hop debugging is archaeology.
- **Alert on symptoms, not causes.** Page on "users are seeing errors," not "CPU is over 80%."

**Example:**
```ts
// Bad — unstructured, uncorrelated, no measurable signal.
console.log("processing order", orderId)
try {
  await chargeCard(orderId)
} catch (e) {
  console.log("error", e)
}

// Good — structured, correlated, measurable. RED in three lines, trace propagation, error class.
log.info({ event: "order.charge.start", order_id: orderId, trace_id: ctx.traceId })
const stop = metrics.histogram("order.charge.duration_ms", { route: "checkout" }).start()
try {
  await chargeCard(orderId, { ctx })           // ctx propagates trace context to the downstream
  metrics.counter("order.charge", { result: "success" }).inc()
} catch (e) {
  metrics.counter("order.charge", { result: "failure", reason: classify(e) }).inc()
  log.error({ event: "order.charge.failed", order_id: orderId, trace_id: ctx.traceId, err: serialize(e) })
  throw e
} finally {
  stop()
}
```

## The three pillars (and what each is for)

| Pillar | Question it answers | Time scale | Cardinality |
|---|---|---|---|
| **Logs** | "What exactly happened in this specific request?" | Single event | Unbounded — every event is unique |
| **Metrics** | "How is the system behaving overall, over time?" | Aggregated | Bounded — fixed dimensions |
| **Traces** | "What path did this request take across components?" | Single request | Bounded by sampling |

All three are required. Logs without metrics give you per-request detail but no shape of the system over time. Metrics without traces give you aggregate health but no path through a specific failure. Traces without logs let you see the shape of a failure but not the details.

## Structured logging

**Structured = machine-readable.** JSON, logfmt, or a binary format — anything where each log line has named fields rather than a free-text blob.

**Why structured beats text logs:**

- Searchable by field: "show me all errors where `customer_id=...`."
- Joinable with traces and metrics via shared IDs.
- Survives format evolution without breaking parsers.
- Tools (Datadog, Splunk, Loki, ELK, BigQuery) all expect structured input.

**Required fields on every log line:**

- `timestamp` (UTC, RFC 3339).
- `level` (debug / info / warn / error).
- `service` and `version`.
- `trace_id`, `span_id` (so the line joins with the trace).
- `event` — a short, stable name for what just happened (e.g., `order.charge.start`), useful for filtering without parsing free text.
- For errors: `error.type`, `error.message`, `error.stack` as separate fields, not a single concatenated string.

**Anti-patterns:**

- `console.log("got here")` and variants — no level, no event name, no context, no trace ID. Strip these in code review.
- Logging PII in cleartext (emails, addresses, payment details). Use a redaction layer; assume logs are visible to anyone with operator access.
- Logging on hot paths at debug level in production by accident. Set log levels per environment.
- Logging then re-throwing the same error at multiple layers ("log and rethrow"). One layer logs with context; the others propagate. Doubled logs hide the signal.

**Volume management:**

- Sample debug-level logs in production. Keep all warnings and errors.
- Set retention by importance: errors for months, info for weeks, debug for days.
- Log cardinality matters for cost — see "Cardinality and cost" below.

## Metrics: RED and USE

Two complementary frameworks. Apply both.

**RED** — for request paths (services, endpoints, message handlers):

- **Rate:** requests per second.
- **Errors:** errors per second (or error rate as a fraction).
- **Duration:** request latency distribution (use histograms — see below).

Every endpoint, every consumer, every cross-service call should emit RED metrics. They tell you "is this thing working?"

**USE** — for resources (CPU, memory, disk, connection pools, thread pools, queue depth):

- **Utilization:** percent of resource in use (e.g., CPU at 60%).
- **Saturation:** the amount of work waiting for the resource (queue depth, run queue, connection pool waiters).
- **Errors:** error events from the resource (disk read errors, connection pool exhausted, OOM kills).

USE metrics catch failures at the resource level before they manifest at the request level. A connection pool that's been saturated for 5 minutes is about to cause a latency cliff; the USE metric warns you 5 minutes before the RED metric tips over.

**Tag with dimensions, but bounded:** `route`, `method`, `status_class` (2xx/4xx/5xx, not raw status), `dependency`. Avoid high-cardinality tags like `user_id` or `request_id` (those belong in logs and traces, not metric labels).

## Histograms, percentiles, and why averages lie

**Averages hide the tail.** An endpoint can have a 100ms average latency where 95% of requests finish in 50ms and 5% take 1100ms — and those 5% are where the user pain lives. The average tells you nothing about that.

**Use histograms (or summaries).** They record the distribution: how many requests fell into each latency bucket. From a histogram you can compute percentiles:

- **p50 (median):** half the requests are faster, half are slower. Tells you the typical experience.
- **p95 / p99:** the worst 5% / 1%. Tells you the tail.
- **p99.9, max:** the worst-of-the-worst. Tells you the outliers.

**Latency SLOs are almost always specified at a percentile, not an average.** "p99 < 800ms over 30 days" is meaningful; "average < 200ms" is not.

**Histogram bucket choice matters.** Buckets too coarse and you can't distinguish 200ms from 800ms; buckets too fine and you pay storage cost. Most libraries ship sensible defaults (Prometheus' exponential buckets, OpenTelemetry's explicit buckets). Tune for your latency range.

## Distributed tracing

A **trace** is the record of one logical operation as it flows through your system. A trace has a `trace_id`; each component's work within the trace is a **span** with a `span_id` and a `parent_span_id` chaining back to the entry point.

**What tracing gives you:**

- The path a request took — every service it visited, in order.
- The latency of each hop — where time was spent.
- Causal relationships between async events — when a producer's event is processed by a consumer, the consumer's span links back to the producer's.
- A timeline you can stare at when something goes wrong, instead of guessing.

**Trace context propagation:**

- HTTP: `traceparent` and `tracestate` headers (W3C Trace Context). Every cross-service HTTP call propagates these.
- Messages: `traceparent` in message metadata (a Kafka header, an SQS message attribute). Consumers create a span that links back via this.
- Inside a process: pass the trace context object through function calls or via async-local storage.

**Sampling:** in production, you don't keep every trace — that's expensive. Sample some fraction (1%, 0.1%) head-on, plus keep all traces containing errors (tail-based sampling). Most tracing backends support both. The sampling decision propagates with the trace context so you don't keep half a trace.

## OpenTelemetry as the default

**OpenTelemetry (OTel)** is the CNCF standard for instrumentation, and as of 2025 is the de facto default — all three signals (traces, metrics, **and logs**, which went stable in 2025) ship over a single wire protocol (OTLP). Auto-instrumentation libraries exist for most languages and frameworks; SDKs let you add custom spans and metrics with a stable API.

**Why standardize on OTel:**

- You write instrumentation once; you can swap backends (Jaeger, Tempo, Datadog, Honeycomb, New Relic, X-Ray) without rewriting code.
- The data model (spans, metrics, log events with trace context) is consistent across pillars and shares trace IDs natively.
- Auto-instrumentation covers HTTP servers/clients, DB drivers, message brokers — most of the work is done for you.
- **eBPF-based auto-instrumentation** (OTel OBI, Pixie, Cilium Tetragon) gives you traces and metrics for unmodified processes — useful for legacy services or third-party binaries you can't recompile. Treat it as a complement to SDK instrumentation, not a replacement for it.

**Pick a vendor SDK over OTel only when you have a hard reason** (a single-vendor feature you genuinely need). The portability cost of vendor lock-in is paid the day you want to leave; the cost of OTel is one extra config file.

**Practical setup:**

- Enable auto-instrumentation for your framework and DB client. You'll get RED metrics and traces "for free" on common paths.
- Add custom spans around business-meaningful operations: `place_order`, `process_payment`. Name them after the business action, not the function.
- Add custom attributes to spans (`order.total`, `customer.tier`) so traces are searchable by domain values.
- Configure exporters to send to your backend. Most backends accept OTLP natively.

## SLIs, SLOs, and error budgets

**SLI (Service Level Indicator)** — a metric of user-experienced quality. The good kind: "the fraction of checkout requests that succeed in under 800ms." Not "CPU utilization."

**SLO (Service Level Objective)** — the target for an SLI. "99.9% of checkout requests succeed in under 800ms over 30 days."

**Error budget** — `1 - SLO`. If your SLO is 99.9%, your error budget is 0.1% — over 30 days at 1M requests, that's 1,000 "failed" requests you can afford. Burn the budget faster than expected → slow down feature work, focus on reliability. Stay within budget → ship features.

**How to pick SLIs:**

- They measure something users care about. Latency they experience; errors they see; correctness of a result.
- They're **measurable continuously** — not "we'll check once a quarter."
- They're **owned** — there's a team responsible for them.

**Common SLIs by component type:**

- **Sync request API:** availability (% of requests with non-5xx response), latency (p99 under threshold).
- **Async consumer:** lag (age of oldest unprocessed message), throughput (messages/sec), error rate.
- **Batch job:** completion (jobs that finish per day), correctness (samples that pass validation), duration.

**SLOs are a contract.** Internal teams promise SLOs to each other; the SLO is what consumers can plan around. Hitting 100% is not the goal — the goal is hitting the SLO consistently, while the error budget funds risk-taking on features.

## DORA delivery metrics

SLOs measure how *the running system performs*. **DORA metrics** measure how *fast and safely you ship changes to it* — a different but equally first-class dimension. The 2024 DORA set:

1. **Deployment frequency** — how often you ship to production. Elite teams: on demand (multiple/day); high: weekly–daily.
2. **Lead time for changes** — commit-to-production. Elite: under a day; high: under a week.
3. **Change failure rate** — % of deployments that cause a production incident (rollback, hotfix, degraded service). Elite: 0–15%.
4. **Failed deployment recovery time** (renamed from MTTR in 2023) — time to restore service after a failed deploy. Elite: under an hour.

A fifth metric, **rework rate** (work redone after a deploy), was added in DORA 2024 as a leading indicator of stability.

**How to apply.** Wire deployment frequency and lead time to your CI/CD pipeline; wire change failure rate to your incident tracker (or to a "deploys → incidents within N hours" join). Treat the DORA set as the *delivery health* dashboard, alongside the SLO dashboard for *running-system health*.

## Chaos engineering as an SLO partner

Once SLOs and DORA are in place, **chaos engineering** is how you stress-test the resilience properties from [[resilience]] *while you still have error budget to spend*. The principle: inject controlled failures (kill a pod, inject 500ms of latency on a dependency, drop 1% of broker messages) and observe whether timeouts, retries, circuit breakers, and bulkheads behave as designed.

**Rules of engagement (Principles of Chaos Engineering):**

- Have a **hypothesis** before the experiment — "if the payment service times out, the checkout falls back to async confirmation within 2s." Not "let's see what breaks."
- Run experiments **only when the error budget is healthy.** Chaos against a service that's already burning budget makes things worse.
- Start in **staging or a small production blast radius** (one cell, one region, 1% of traffic). Widen only when the small experiment passes.
- **Stop conditions are explicit.** If the SLO burn-rate alert fires during the experiment, the experiment ends and rolls back automatically.

Tools: Gremlin, AWS Fault Injection Service, Litmus, Chaos Mesh, plus per-platform primitives (k8s pod evictions, network policies, Toxiproxy).

## Alerting: symptoms, not causes

**Alert on what users feel, not on causes.**

- ✅ "p99 checkout latency exceeded SLO for 5 minutes."
- ✅ "Error rate on /api/orders exceeded 1% for 5 minutes."
- ✅ "Consumer lag > 1 hour."
- ❌ "CPU > 80%." (Maybe everything is fine and we're just busy.)
- ❌ "Memory > 90%." (Maybe the garbage collector is just lazy.)
- ❌ "A single pod restarted." (Pods restart.)

**Why:** cause-based alerts generate noise; symptom-based alerts generate signal. CPU at 80% might mean everything is fine. Latency exceeding SLO means a user is unhappy *right now*.

**Paging vs ticketing:**

- **Page** for problems a human must address *now* — symptoms in production, SLO burn faster than the budget allows.
- **Ticket** for problems that need attention soon but don't need to wake someone up — a stale dashboard, a once-a-quarter cron, a non-critical batch fell behind.

**Avoid alert fatigue.** Every page that doesn't matter is a slow erosion of trust in the alerting system. Tune ruthlessly: kill alerts that fire without action being needed, raise thresholds for ones that fire on noise, route ones that don't need immediate response to tickets.

**Runbook for every page.** A page without a runbook is a page that wakes someone up and asks them to figure it out at 3am. Each alert links to a runbook: what does this mean, what to check first, common causes, escalation path.

## Cardinality and cost

Observability backends charge by data volume. The dominant cost driver in metrics and logs is **cardinality** — the number of unique values for tagged dimensions.

**Common cardinality bombs:**

- Tagging metrics with `user_id` or `request_id` (millions of values).
- Logging full URLs as metric labels (every query string is a new label set).
- Free-text log messages that vary per request, indexed as full-text (every log line is unique).
- Tracing every request without sampling.

**Discipline:**

- Metric labels: bounded, small set of values (status_class, route name, dependency). Per-request identifiers go in **traces and logs**, not metric labels.
- Logs: structured fields are cheap; full-text indexing is expensive. Index the fields you'll query on; store the rest as searchable but not indexed.
- Traces: sample, keep errors, drop the rest.

The goal isn't minimizing cost at the expense of signal — it's not creating data the system will never use. A 100% sampled trace store with billions of identical "everything's fine" traces is mostly waste.

## Quick checklist for instrumenting a new feature

Before merging a new endpoint, event handler, or batch job:

1. **Structured logs** on entry, exit, and on every error path, with `trace_id` and `event` name.
2. **RED metrics** for the new path: a counter for rate, a counter for errors, a histogram for duration.
3. **USE metrics** if you added a new resource (a connection pool, a worker pool, a queue).
4. **A trace span** wrapping the operation, with business attributes (order ID, customer ID) on the span.
5. **An SLI** defined for this path, and an SLO (even a draft one) for what "good" means.
6. **An alert** on the SLI (symptom-based), with a link to a runbook (even if the runbook is one sentence).

If any of these are missing, the feature isn't done — it's done-pending-an-outage.
