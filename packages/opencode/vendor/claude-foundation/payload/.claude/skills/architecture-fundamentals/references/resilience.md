# Resilience

Moved from `SKILL.md` — principle 4's full rule/why/how-to-apply/example, plus the "Below the principles" operational concerns, ahead of the topic-organized detail below.

## Principle 4 (from SKILL.md): Every cross-process call can fail — design for it

**Rule:** Set explicit timeouts, bounded retries with backoff and jitter, circuit breakers around dependencies, and bulkheads between failure domains. No infinite waits. No retry storms. No code path where one slow dependency takes the whole system down.

**Why:** HTTP clients and ORMs default to infinite or 30-second timeouts — genuinely dangerous. The outage script is always the same: a dependency blips, connection pools fill with hung waits, the upstream becomes unresponsive, and a one-component blip cascades system-wide. Designing for failure costs hours upfront; not designing for it costs days of recovery and customer trust.

**How to apply:**
- **Timeouts everywhere.** Every outbound call (HTTP, DB, broker, gRPC, external API) gets an explicit timeout, shorter than the upstream's, with budget left for retries.
- **Retries: bounded, with exponential backoff and jitter.** Only retry **idempotent** operations. Don't retry permanent errors (most 4xx except 408/429) — those just delay the inevitable.
- **Retry budget.** A service might cap retries at X% of its request rate. Without a budget, retries amplify a downstream blip into a thundering herd that prevents recovery.
- **Circuit breakers** around dependencies: after N failures, fail-fast for a cool-down period instead of stacking hung calls; half-open to test recovery. (Resilience4j on JVM, Polly on .NET, opossum on Node, gobreaker on Go, pybreaker/tenacity on Python. Netflix Hystrix is end-of-life — don't pick it for new work.)
- **Bulkheads** isolate failure: separate thread pools, connection pools per dependency. One slow dependency cannot exhaust resources another needs.
- **Graceful degradation.** When a non-critical dependency is down, return a degraded but useful response (cached data, defaults) rather than a 500. Decide what "non-critical" means *before* the incident.

**Example (TypeScript sketch):**
```ts
// Bad — default-infinite timeout, no retries, no breaker, no fallback.
const profile = await fetch(`${userService}/profile/${id}`).then(r => r.json())

// Good — bounded, retried with backoff, circuit-broken, with a graceful fallback.
const profile = await breaker.call(
  () => withTimeout(2000, () =>
    httpClient.get(`/profile/${id}`, { retries: 2, backoff: { initial: 100, max: 500, jitter: 0.2 } })),
).catch(() => CACHED_OR_DEFAULT_PROFILE)
```

## Operational concerns (from SKILL.md)

- **Statelessness scales; statefulness needs a strategy.** A stateless component scales horizontally with a load balancer. State must live in a shared store so any instance can serve any request. Sticky-session and in-memory caches are real but require explicit thought about cache coherence.
- **Cache deliberately, with an invalidation story.** Decide: TTL or invalidation? Read-through, write-through, or aside? Stampede protection? "We'll add a cache" without those answers is how stale-data incidents are born.
- **Security boundaries are architectural.** Every cross-component call crosses a trust boundary; auth and authz live at the boundary. Secrets live in a secret store, not in code or env files. A compromised service should compromise the minimum.
- **Capacity planning is not optional.** Know the rough throughput each component must handle and where the next bottleneck will appear.
- **Operations: deploys, rollbacks, runbooks.** Every component has a deploy story, a rollback story, and an on-call runbook with the top five known failure modes and first-response steps.

## Timeouts and time budgets

**The default timeout in most HTTP clients is dangerous.** Node's `fetch` waits forever. Go's `http.DefaultClient` has no timeout. Java's URLConnection defaults vary. Python's `requests` defaults to no timeout. Every one of these will, on the wrong day, leave a connection pool full of hung waits that take the service down.

**Rule:** every outbound call has an explicit timeout, set deliberately, less than the upstream caller's timeout.

**Time budgets across hops.** When request A calls B which calls C, the user-visible timeout is at A. B's timeout must be less than what's left after A's overhead; C's must be less than what's left after B's. If A waits 5 seconds total, B can spend at most ~4.5 seconds inside its call to C (with margin for B's own work, retries, and the return trip).

```
User → A (5s budget)
       └─ A → B (4s timeout)
              └─ B → C (3s timeout, leaves B 1s for its own work)
```

Without this, the inner timeouts are longer than the outer timeout, the outer call times out, the inner call keeps going (and keeps holding the connection), and you've leaked work the user is no longer waiting for.

**Set timeouts on every layer:**

- Connection timeout (how long to wait for a TCP connection).
- Read timeout (how long to wait for the next byte once connected).
- Overall request deadline (the absolute cap; pass a context/deadline down the call chain so inner calls know how much time is left).
- DB query timeout. Most ORMs default to "no timeout"; set one.

## Retries: when, when not, how

**Retry only when:**

- The operation is **idempotent**, or guarded by an idempotency key.
- The error is **retryable**: network errors, timeouts, 5xx, 429 (rate limited), 408 (request timeout), broker-level redeliveries.

**Do not retry:**

- **4xx that aren't 408/429.** A 400 (bad request) or 404 (not found) won't succeed on retry; you're just burning attempts and adding latency.
- **Non-idempotent operations without an idempotency key.** Retrying a POST that already succeeded creates a duplicate. Either add the key, make the operation idempotent, or don't retry.
- **The original failure was the work itself, not the transport.** Application-level "your data is invalid" is not retryable.

**Cap retries.** Three to five attempts is typical for sync calls; longer for async (where the broker tracks attempts). After the cap, fail-and-propagate or DLQ. Infinite retries are how a downstream blip becomes a sustained outage.

## Exponential backoff and jitter

**Why exponential:** if the dependency is overloaded, immediate retries make it worse. A back-off gives it time to recover. Doubling each gap (100ms → 200ms → 400ms → 800ms) is the standard.

**Why jitter:** without jitter, all clients retry at the same moment after a downstream blip, creating a synchronized thundering herd. A random fraction (±20% or "full jitter": pick a uniform random in [0, current_backoff]) spreads the load across the recovery window.

**Formula:**

```
attempt_n_delay = min(max_delay, initial * (multiplier ^ (n - 1)))
actual_delay    = jittered(attempt_n_delay)
```

Common parameters: `initial=100ms, multiplier=2, max=5s, jitter=±20%`.

**Don't retry without backoff.** A tight retry loop on a flaky dependency will overwhelm it before it can recover, and you'll never see the recovery.

## Retry budgets

A retry policy on a single call site is necessary but not sufficient. Across a whole service, **retries should be capped as a fraction of total requests** (e.g., "retries may not exceed 10% of base request rate"). When retries hit that cap, new retries are dropped, even if the policy allows them.

**Why:** without a budget, a downstream becoming slow amplifies traffic upstream. If 10% of requests fail and each is retried twice, you've increased your request volume by 20% during the worst possible time. With a retry budget, the cap stops the amplification from starving healthy traffic.

Most service-mesh layers (Istio, Linkerd, Envoy) implement retry budgets natively. If you're rolling your own, a simple semaphore or rate limiter on retry-only paths does the job.

## Circuit breakers

A circuit breaker is a finite state machine around a dependency:

- **Closed (normal):** requests flow through. The breaker counts failures.
- **Open (tripped):** requests fail-fast (return immediately with an error or fallback) without hitting the dependency. The breaker stays open for a cool-down period.
- **Half-open (testing):** after cool-down, allow a small number of test requests. If they succeed, close. If they fail, re-open.

**Trip conditions** (any of):

- N consecutive failures.
- Failure rate exceeds X% over the last M requests.
- Latency exceeds threshold for sustained period.

**Why it matters:** without a breaker, when the dependency is slow or down, every request piles up on it. Connection pools fill, threads block, the upstream becomes unresponsive too. The breaker turns "all requests are slow" into "all requests fail fast with a known error," which lets the upstream stay healthy and the downstream recover unmolested.

**Libraries:** Resilience4j (Java/Kotlin — Hystrix's successor; Netflix put Hystrix in maintenance mode in 2018 and it's end-of-life today), Polly (.NET), opossum (Node), gobreaker / sony/gobreaker (Go), pybreaker + tenacity (Python). Roll your own only if these don't fit; the state machine has subtle edge cases (the half-open transition is where most bugs hide).

**Per-dependency, not per-service.** One service may talk to ten dependencies. Each gets its own breaker. A failure in one shouldn't trip the breaker for the others.

## Bulkheads

A bulkhead isolates failure: one slow dependency cannot exhaust the resources another dependency needs. The metaphor is a ship's hull — water in one compartment doesn't flood the rest.

**Practical bulkheads:**

- **Separate thread pools** per dependency. Calls to the payment service use one pool; calls to the search service use another. If payments are hanging, search threads are unaffected.
- **Separate connection pools** per dependency (most HTTP clients let you configure this).
- **Semaphores** that limit concurrent calls to a dependency to a fixed number. Once full, new calls fail fast instead of stacking.
- **Process-level isolation** for the most critical dependencies: the dependency runs in its own service so its resource exhaustion can't take down anything else.

**Without bulkheads:** one slow dependency saturates the shared thread pool, every endpoint in the service becomes slow, the LB starts marking the service unhealthy, traffic shifts to other instances which also have one shared pool, cascading failure.

## Graceful degradation

When a non-critical dependency is unavailable, the system should return a **degraded but useful** response, not an error. Decide what "non-critical" means *before* the incident, so you have a fallback plan.

**Patterns:**

- **Cached fallback:** if the live read fails, return the last known good value with a "stale" indicator.
- **Default fallback:** show a generic banner instead of the personalized one; show the product without the "frequently bought together" widget.
- **Feature flag:** disable the feature entirely and return a response without it.
- **Async fill-in:** return the response immediately with a placeholder; let the client refresh later when the dependency is back.

**Decision rule:** for every dependency, ask "if this is down, what response do we return?" Three answers:

1. **The request fails** — the dependency is on the critical path; failure is honest.
2. **We return a degraded response** — name what "degraded" looks like and ship it.
3. **It doesn't matter** — the response is the same whether the dependency is up or down. Maybe you don't actually need this dependency on this path.

Most "5xx during downstream blip" incidents are unnamed answer-2 cases: the engineer never decided what degraded meant, so the default behavior was "fail."

## Load shedding

When the system is overloaded, **shed load deliberately** before it sheds itself disastrously. The choice is between dropping 10% of requests cleanly (with a 503 and a `Retry-After`) vs. dropping 100% of requests when the system finally tips over.

**Patterns:**

- **Rate limiting at the edge** by client, endpoint, or token bucket. Return 429 with a retry hint.
- **Concurrency limits.** Cap in-flight requests at a number sized for healthy throughput. Excess requests get 503.
- **Adaptive concurrency** (Netflix's library, Envoy's adaptive concurrency filter): the limit auto-tunes based on observed latency. When latency creeps up, the limit drops; when latency is healthy, the limit grows.
- **Prioritize.** Under load, drop low-priority traffic (background analytics, low-tier customers, optional features) before high-priority (paying user requests, the checkout path).

A system without load shedding looks healthy right up until the moment everything is on fire. A system with load shedding looks slightly less healthy under load and stays alive.

## Health checks: liveness vs readiness

Two different signals, often confused, both required.

**Liveness** — "is this process functioning at all?"

- Used by the orchestrator (Kubernetes, ECS, systemd) to decide whether to restart the process.
- Should be **cheap and lightweight**. Return 200 if the process is responsive. Do not check downstream dependencies — if your liveness fails because the DB is slow, the orchestrator will restart your process, which won't fix the DB.

**Readiness** — "is this instance ready to serve traffic right now?"

- Used by the load balancer / service mesh to decide whether to route traffic here.
- May check downstream dependencies (DB connection pool, broker connection, config loaded) — if any are not ready, mark not-ready so the LB skips this instance.
- During graceful shutdown, mark not-ready *before* closing the listener, so the LB drains traffic before your process exits.

**Common mistake:** using one endpoint for both. If the endpoint checks the DB, an upstream DB blip will make every instance fail liveness, triggering a mass restart that makes the situation worse.

## Chaos testing

Resilience that hasn't been tested is theoretical. **Chaos testing** intentionally injects failures (kill a process, sever a network connection, add latency, return errors from a dependency) in production-like environments to verify the system handles them.

**Levels of investment:**

- **Game days:** quarterly, scheduled exercises. The team picks a scenario, runs it in staging or a controlled production window, watches the system behave (or misbehave), and writes follow-ups.
- **Chaos engineering tools:** Chaos Mesh, Litmus, Gremlin, Toxiproxy. Inject failures on demand.
- **Always-on chaos:** Netflix's Chaos Monkey, randomly terminating instances during business hours. The system is designed assuming any instance can disappear at any moment.

You don't need always-on chaos to benefit from chaos testing. Even a single quarterly game day finds bugs no test suite would catch, because the bugs live in the interaction between components, not inside any one of them.

**Most-valuable scenarios** to run before you've ever run chaos:

- Kill a random instance of a service. Does the LB drain correctly?
- Black-hole the DB for 30 seconds. Do timeouts trip? Do retries back off?
- Make a downstream return 500 for 1% of requests. Does the breaker trip at the right rate? Does the fallback work?
- Add 500ms of latency to a downstream. Does the circuit breaker (latency-based) trip? Does the time budget hold?

Each one of these is the shape of a real future incident. Running them in a controlled way is how you make the real incidents boring.
