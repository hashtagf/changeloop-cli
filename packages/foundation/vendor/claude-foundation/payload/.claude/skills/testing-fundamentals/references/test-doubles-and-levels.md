# Test Doubles and Levels

Two decisions dominate test design: *at which level* to test, and *what to replace the real dependencies with*. This file gives the decision rules for both, plus the taxonomy of doubles, the case for a real database, contract tests, and how to kill flakiness.

Moved from `SKILL.md` — principles 2, 4, and 5's full detail: the pyramid, doubles discipline, and isolated/deterministic/fast tests.

## Principle 2 (from SKILL.md): The test pyramid — push every test to the cheapest level that proves the thing

**Rule:** Many fast unit tests at the base, fewer integration tests in the middle, a few end-to-end tests at the top. For each thing you want to prove, choose the lowest level that can actually prove it.

**Why:** Levels trade speed against fidelity. A mostly-e2e suite (inverted pyramid / ice-cream cone) is slow to run, slow to diagnose, and quietly skipped under deadline. A units-only suite ships integration bugs. The discipline: "push down" — ask whether a unit test proves the same thing 10× faster before writing an e2e. Reserve expensive levels for what only they can prove (real wiring, real user journeys).

**How to apply:**
- Pure logic with branches → unit. Pricing, validation, state machines, parsers, formatters. This is the backbone; it should be most of your tests.
- A boundary crossing (DB, filesystem, HTTP, IPC) → integration, against the *real* dependency (principle 4).
- A user-observable journey across the whole stack → one e2e per critical path (sign up, checkout, refund), not one per variation. Test the variations at the unit level.
- If a "unit" test takes seconds, it's secretly doing I/O — find it and move it down a level or fake the seam (principle 4).
- Decision rules and the per-level mechanics live in `references/test-doubles-and-levels.md`.

**Example:**
```
A checkout feature with: a discount rule, a tax calc, an order repository, a payment gateway.

Inverted (bad):                       Pyramid (good):
  12 e2e tests through the browser      ~40 unit: discount × tax × validation branches
   2 unit tests                          ~6 integration: repository against a real test DB
  → 4 min run, flaky, vague failures     ~2 e2e: "guest checks out", "refund a paid order"
                                         → 8s run, sharp failures, real wiring proven
```

## Principle 4 (from SKILL.md): Use test doubles with discipline — fake at the seams, real for what you're testing

**Rule:** Replace a dependency with a double only at an architectural seam (a port), and only when the real thing is slow, costly, non-deterministic, or out of scope. Use the *real* thing for the component you're actually testing — above all, a real database in integration tests.

**Why:** Doubles enable isolation; they also let tests pass while the real system is broken. A mocked DB happily accepts queries the real one rejects for missing columns, violated constraints, or un-run migrations. Fake what you're *not* testing (third-party APIs, the clock); use the real thing for what you are — a repository test is testing "does this code talk to the DB correctly" and mocking the DB deletes the point. The taxonomy ("mock" names five distinct things); decision tree in `references/test-doubles-and-levels.md`. A second signal: 20 lines of mock setup for a 5-line assertion → fix the production design, not the mocks.

**How to apply:**
- Fake at ports/seams: the repository interface, the email-sender interface, the clock. Hexagonal code makes this natural — the port *is* the seam ([[hexagonal-backend]]).
- Integration tests use a **real test database** — Docker, an in-memory engine of the same family, or transactional rollback per test. Never a mocked DB.
- OK to mock: external APIs, slow services, things that cost money or send real email. Risky: your own database. Never: the function under test itself.
- Prefer a fake (a working in-memory implementation of the port) over a forest of per-test stubs when many tests need the same collaborator.

**Example:**
```ts
// Bad — mocked DB: this passes even if the real query references a dropped column
const db = { query: vi.fn().mockResolvedValue([{ id: 1, total: 100 }]) }
const repo = new OrderRepo(db)
expect(await repo.findPaid(userId)).toHaveLength(1)   // proves nothing about real SQL

// Good — integration test against a real test DB, rolled back after
const db = await testDb()                              // real Postgres, migrated
await seed(db, { orders: [{ userId, status: 'paid' }, { userId, status: 'open' }] })
const repo = new OrderRepo(db)
expect(await repo.findPaid(userId)).toHaveLength(1)    // proves the SQL + schema agree

// Fake the gateway you are NOT testing — it costs money and is non-deterministic
const gateway = new InMemoryPaymentGateway()           // a fake, not a mock
```

## Principle 5 (from SKILL.md): A good test is isolated, deterministic, and fast

**Rule:** Each test sets up its own world, depends on nothing another test left behind, and produces the same result every run. No shared mutable state, no real clock/network/randomness unless that *is* what you're testing, no dependence on test order.

**Why:** A flaky test is worse than no test — it trains the team to ignore red. Causes are always a determinism leak: shared DB rows, real clocks, unordered query assertions, fixed sleeps. Fast matters for the same reason the pyramid does: a minutes-long suite gets run on push instead of on save.

**How to apply:**
- No shared mutable state across tests. Each test builds its own fixtures and tears them down (transactional rollback, fresh temp dir, fresh in-memory store). If tests pass alone but fail together, you have leakage.
- Inject the clock, the random source, and IDs so the test controls them. Assert on a frozen `now`, a seeded RNG, a fixed UUID — never the real ones, unless the behaviour under test *is* "it uses the real clock."
- No order dependence — a test must pass when run alone, and the suite must pass when randomized. Many runners can shuffle order; turn it on to catch coupling.
- Don't `sleep`. Wait on a condition (poll until true, await a signal, use fake timers). A fixed sleep is either flaky (too short) or slow (too long), usually both.
- Flakiness-taming patterns (test containers, fake timers, retries-as-last-resort) are in `references/test-doubles-and-levels.md`.

**Example:**
```js
// Bad — depends on the real clock and on running before the cleanup test
test('token expires after 1h', () => {
  const t = issueToken()                  // embeds Date.now()
  // ...no way to advance time except to actually wait an hour
  expect(isExpired(t)).toBe(false)        // and flaky near boundaries
})

// Good — inject the clock; the test owns time, runs in microseconds, never flakes
test('token expires after 1h', () => {
  const clock = fakeClock('2026-01-01T00:00:00Z')
  const t = issueToken(clock)
  clock.advance(hours(1) + seconds(1))
  expect(isExpired(t, clock)).toBe(true)
})
```

## Levels: unit vs integration vs e2e

The levels trade **speed** against **fidelity**. Pick the lowest level that can actually prove the thing.

| Level | Speed | What it proves | Doubles | Count |
|-------|-------|----------------|---------|-------|
| **Unit** | ~ms | One unit's logic is correct in isolation | Fake the seams (DB, network, clock) | Hundreds–thousands |
| **Integration** | ~10–100ms | Two+ real components wire together correctly | Real DB/FS; fake only external/3rd-party | Tens–hundreds |
| **E2E** | seconds | A whole user journey works through the real stack | Almost nothing — real everything | A handful |

### Decision rules

- **Is it pure logic with branches** (pricing, validation, a state machine, a parser)? → **unit**. No I/O, runs in milliseconds, pinpoints the failure. This is the backbone and should be most of the suite.
- **Does it cross a boundary you own** — your database, the filesystem, in-process IPC? → **integration**, against the *real* dependency (a real test DB; see below). This is where migration/contract/SQL bugs surface — the bugs a unit test with a mocked DB structurally cannot catch.
- **Is it a user-observable journey across the full stack** (sign up → verify → log in; add to cart → pay → receipt)? → **e2e**, one per critical path. Not one per variation — test variations at the unit level.
- **Could a lower level prove the same thing?** Then use the lower level. Before writing an e2e test for a discount rule, ask whether a unit test on the discount function proves it in 2ms instead of 20s. The answer is usually yes.

### The pyramid, and why inverting it hurts

```
        /\          few    e2e          slow, broad blast radius, flakiest — critical paths only
       /  \         some   integration  real wiring, real DB — boundary crossings
      /____\        many    unit         fast, sharp failures — all the branchy logic
```

The **inverted pyramid / ice-cream cone** — mostly e2e, few unit — is slow (minutes, so it's skipped on save), has a broad blast radius (one broken login fails fifty journey tests), and e2e is the flakiest level. Fix: push tests down. Keep e2e for "the whole thing is wired together and a real user can complete this journey."

The opposite — *only* unit tests — ships integration bugs. You need the middle layer.

## The double taxonomy

"Mock" gets used for five distinct things. They differ in what they do and how they fail, and the difference decides which one is safe to reach for.

- **Dummy** — a placeholder passed only to satisfy a signature; never actually used. (A `null` logger you must pass but the test path never logs.) Harmless.
- **Stub** — returns canned answers to calls the test makes. (`repo.findRate()` always returns `0.1`.) Provides indirect *input* to the unit under test. Low-risk: it feeds state, doesn't assert on calls.
- **Spy** — a real or stub object that *records* how it was called, so the test can inspect afterward. Useful when the call itself is the behaviour (an email was sent), risky when used to assert internal call graphs (principle 1's trap).
- **Mock** — pre-programmed with expectations and *fails the test if they aren't met* in the right way/order. A strict mock asserts on the interaction. This is the highest-risk double — a mock that asserts call order is testing the implementation, not the behaviour.
- **Fake** — a working but lightweight implementation of the real thing (an in-memory repository, an in-memory payment gateway, an in-memory clone of the *same* DB engine). Behaves like the real dependency, so tests exercise real logic against it. (Swapping in a *different* engine — SQLite for Postgres — is the dialect-mismatch trap the real-DB section below warns against, not a safe fake.) Often the best double when many tests need the same collaborator.

**Rule of thumb on risk:** dummy < stub < fake < spy < mock. Prefer **fakes and stubs** (state-based: set up input, assert output). Reach for **spies/mocks** only when the *interaction* is the behaviour ("on success, the receipt is sent") — and even then, assert *that it happened*, not the exact call count and argument order unless those are part of the contract.

A second signal: 20 lines of mock setup for a 5-line assertion means the unit has too many dependencies. Fix the production design (extract the pure core).

## Fake at the seams (ports)

A double belongs at an **architectural seam** — a port, an interface, a boundary the design already draws. [[hexagonal-backend]] makes this natural: the repository port, the email-sender port, the clock are exactly the interfaces you swap. Faking at a seam is honest because the seam is a real contract; reaching *inside* a unit to stub a private helper is not — that couples the test to the implementation.

```ts
// The seam is the port. The unit under test depends on the interface, not the concrete adapter.
interface Clock { now(): Date }
interface OrderRepo { findPaid(userId: string): Promise<Order[]> }

// Unit test of the use case: fake both ports, exercise the real use-case logic.
const clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') }   // stub
const repo  = new InMemoryOrderRepo([paidOrder, openOrder])             // fake
const result = await summarizeOrders(repo, clock)                       // real logic runs
expect(result.paidCount).toBe(1)
```

If a dependency has no seam — the code `new`s a concrete client inline — that's a design problem the test is surfacing. Introduce the port, then fake it.

## Why integration tests use a real database

Mocking your own database is the single most common way a test passes while the system is broken.

A mocked DB returns whatever you told it to — it happily "accepts" a query the real database would reject for a missing column, a violated constraint, a migration that never ran, or a SQL dialect error. So a repository test against a mocked DB asserts that *your code calls a function you stubbed* — it proves nothing about whether the real SQL and the real schema agree.

Use a real test database in integration tests. Three workable strategies:
- **Test containers** — spin up a real Postgres/MySQL in Docker for the test run (`testcontainers` in most languages). Highest fidelity; the same engine you ship.
- **Transactional rollback** — wrap each test in a transaction and roll back at the end. Fast, perfectly isolated, no cleanup. Caveat: can't test code that itself commits or relies on cross-transaction visibility.
- **Same-family in-memory** — an in-memory build of the same engine. Faster than a container; only safe when it's the *same* engine (an in-memory clone of a *different* DB reintroduces the dialect-mismatch risk you were avoiding).

Pick per project; default to containers for fidelity, transactional rollback for speed. What you don't do is mock it.

## Contract tests across services

When service A calls service B, A's integration tests can't spin up the real B, and mocking B in A's tests re-creates the "passes while broken" problem at the service boundary — A's mock of B can drift from what B actually returns. **Contract tests** close that gap: A declares the requests it makes and the responses it expects; that contract is verified against B in B's own CI. If B changes its response shape, B's build fails against A's contract before the break reaches production. Consumer-driven contract testing (Pact and similar) is the usual tooling. Use this for independently-deployed services; for a monolith, an integration test across real in-process components is simpler.

## Taming flakiness

A flaky test — passes and fails without a code change — trains the team to ignore red, which is worse than having no test. Every flake is a determinism leak; fix the leak, don't add a retry.

- **Control time.** Inject the clock; use fake timers (`vi.useFakeTimers`, `freezegun`, a `Clock` port) and advance them. Never assert against the real `now`, and never `sleep` to "let time pass."
- **Control randomness and IDs.** Seed the RNG; inject the UUID/ID generator. A test that asserts on a random value is asserting on noise.
- **Isolate state.** Each test owns its fixtures and tears them down (transactional rollback, fresh temp dir, fresh in-memory store). If tests pass alone but fail together, you have shared mutable state — find it.
- **Kill order-dependence.** A test must pass run alone, and the suite must pass when **randomized**. Turn on the runner's shuffle (`pytest-randomly`, `--shuffle`, `go test -shuffle=on`) to surface coupling early.
- **Don't sleep — wait on a condition.** Replace `sleep(200)` with poll-until-true, await-a-signal, or fake-timer advance. A fixed sleep is flaky when too short and slow when too long, usually both.
- **Quarantine, don't ignore.** If a flake can't be fixed immediately, mark it quarantined (tracked, excluded from the gate) — never leave it failing intermittently in the main suite where it erodes trust in every red.
- **Retries are a last resort, and a smell.** Auto-retrying a flaky test hides the determinism leak instead of fixing it; a "passed on attempt 3" is still a bug in the test. Use retries only for genuinely external, irreducibly-flaky boundaries (a real third-party endpoint in an e2e test), and log when they trigger so the flake stays visible.

## Running the suite in one command

The run that *decides* pass/fail is always the full suite in a single process — not a loop of one invocation per file. Most runners auto-discover everything in one command (`pytest`, `go test ./...`, `cargo test`, `npm test`/`vitest`); monorepos have an aggregator (`pnpm -r test`, `turbo run test`, `nx run-many -t test`). Targeting one file is fine while iterating on a failure; the status-deciding run is the whole suite, once. (This is the execution contract the `/dev` `qa` agent follows.)
