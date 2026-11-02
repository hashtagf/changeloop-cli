# Subdomain classification

## Principle 1 (from SKILL.md): Classify the subdomain before applying DDD

**Rule:** Before designing aggregates, drawing context maps, or running event storming, classify the subdomain: **core** (your differentiator — full custom design), **supporting** (necessary but not differentiating — build pragmatically), or **generic** (commodity — buy or use off-the-shelf). DDD investment follows the classification.

**Why:** The most common DDD failure is "we did it everywhere." Teams apply full tactical DDD to a 5-table admin tool and pay full tax for zero domain leverage — then under-invest in the one subdomain that actually differentiates by shipping it as anemic CRUD. Classification flips both errors at once.

**How to apply:**
- **Core** is the subdomain that gives the business its reason to exist. Invest senior engineers, deep domain conversations, full tactical DDD if it earns its cost, event sourcing/CQRS if justified. *Always* build in-house.
- **Supporting** is necessary infrastructure that isn't the moat — internal tools, admin surfaces, workflow glue. Build pragmatically: clean module, rich enough model, no heroic abstraction. Often a well-modularised piece of a monolith.
- **Generic** is commodity — auth, billing infrastructure, search, email, storage, payment processing for standard cases. *Buy* it (Auth0, Stripe, Algolia, SendGrid, S3) or use a well-maintained OSS package. Every "but we have unique requirements" justification on a generic subdomain deserves three rounds of "are you sure?" before any code lands.
- The boundary is not fixed. Re-classify periodically — a core subdomain today (a recommendation algorithm) can become supporting tomorrow; a generic subdomain can become supporting when your scale outgrows the commodity.
- See [[subdomain-classification]] for the differentiation test, the Wardley mapping relationship, and the build/buy/borrow decision frame.

**Example:**
```
Wrong: small e-commerce startup builds custom auth, billing, search, and transactional email.
       All four are generic. 60% of engineering quarters on commodity work; the actual
       differentiator — curated recommendations — ships as anemic CRUD with a single SQL query.

Right: Auth/billing/search/email → generic, buy. Order management/inventory → supporting, clean
       modules in the monolith. Recommendations → core, full design effort, dedicated team.
```

## The three categories

A **subdomain** is a coherent area of the business problem space — not a piece of the software, but a piece of *what the business does*. A typical company has 5–30 subdomains in active use; some are visible to customers, some are internal infrastructure.

Each subdomain falls into one of three categories:

### Core

The subdomain that *defines* the business — what customers actually pay for, what competitors can't easily copy, where investment compounds into a lasting moat. The recommendation engine for a media platform. The matching algorithm for a marketplace. The risk model for an underwriter. The pricing engine for a yield-management airline. The interaction loop for a creative tool.

**Investment level:** maximum. Senior engineers, deep domain conversations, willingness to rewrite, willingness to invest in advanced techniques (event sourcing, CQRS, ML pipelines, custom DSLs) when they earn their cost. *Always* build in-house; the moat is the point.

**DDD payoff:** highest. The full strategic + tactical toolkit pays off here — ubiquitous language with domain experts, careful aggregate design, full bounded-context discovery via Event Storming. The cost of getting the model wrong is the cost of the moat eroding.

### Supporting

A subdomain that is **necessary** to run the business but isn't differentiating — the workflows, internal tools, reporting, integration glue, admin surfaces, and operational machinery that surround the core. Order management for an e-commerce platform whose moat is search ranking. Internal billing reconciliation for a SaaS whose moat is the product itself. The customer success dashboard for a B2B tool.

**Investment level:** pragmatic. Clean modular code, rich-enough types to enforce the rules, but no heroic abstraction effort. Often a well-modularised piece of a monolith rather than its own service. Senior engineers visit; they don't live here.

**DDD payoff:** moderate. Bounded contexts and ubiquitous language are still worth it — the supporting subdomain still has business rules, still has domain experts, still has the same translation tax if its language is sloppy. Full tactical DDD is usually overkill — rich-enough types and clear repositories are enough. CRUD-with-rich-types is the right default shape.

### Generic

A subdomain that is essentially **commodity** — every company in your industry has roughly the same version of it, and a solved off-the-shelf solution exists. Auth (Auth0, Cognito, Clerk, Keycloak). Transactional email (SendGrid, Postmark, SES). Payment processing for standard cases (Stripe, Adyen, Braintree). Full-text search (Algolia, Elasticsearch, Typesense, Meilisearch). Object storage (S3, GCS, R2). Standard analytics (Mixpanel, Amplitude, PostHog). Standard error tracking (Sentry, Bugsnag, Rollbar). Standard observability (Datadog, Honeycomb, Grafana Cloud).

**Investment level:** minimal. *Buy* or use a well-maintained OSS package. The only code you write is integration glue and configuration. Senior engineers should never write generic-subdomain code unless the rest of the business has shut down for the day.

**DDD payoff:** zero. There is no domain to model here that isn't already modeled by the vendor or library. Applying aggregates, repositories, and value objects to a wrapper around Stripe is the canonical over-engineering case — you're modeling a model that already exists, and paying for the privilege.

## The differentiation test

The cleanest test for which category a subdomain falls into:

> **Would the business lose any of its differentiation if we used a commodity version of this subdomain?**

- **Yes, significantly** → core. The business *is* this subdomain (in part).
- **No, but we'd lose efficiency / operational fit / data quality / brand polish** → supporting. The subdomain matters but isn't the moat.
- **No, and a commodity version would arguably be better than anything we'd build** → generic. Buy it.

Apply the test honestly. Engineers consistently overrate the differentiation of in-house implementations of generic subdomains — "but our auth has special requirements" is true about almost no organization's auth. Domain experts and product leaders, not engineers, are the right people to answer the differentiation question.

## The build / buy / borrow lens

A practical decision frame that maps onto the three categories:

| Subdomain | Decision | Why |
|---|---|---|
| Core | **Build.** | This *is* the business. Outsourcing it outsources your moat. |
| Supporting | **Build pragmatically, or buy a flexible base and customise.** | Need operational fit; not worth the cost of full custom design. Watch for SaaS that turns into a constraint as you grow. |
| Generic | **Buy, or borrow (OSS).** | Solved problem. Time spent here is time stolen from core. |

The most common mistake on this lens is treating supporting as if it were core (over-engineering the admin tool because it's "interesting") or treating core as if it were generic (shipping the differentiator as anemic CRUD because "the framework already does that"). Both are visible in retrospectives; both are unbearable to fix later.

## Wardley mapping as a sharper version of the same idea

[Simon Wardley's mapping technique](https://medium.com/wardleymaps) decomposes a value chain into components and places each on an evolution axis:

```
GENESIS  →  CUSTOM-BUILT  →  PRODUCT (+ rental)  →  COMMODITY (+ utility)
```

The mapping to DDD subdomain categories is direct and useful:

- **Genesis / Custom-Built** → core. Novel, evolving, no off-the-shelf solution exists, your investment compounds.
- **Product** → supporting. A solution exists (frameworks, SaaS) but customisation and operational fit matter.
- **Commodity / Utility** → generic. Use the utility.

Wardley maps add two refinements that DDD-classification alone misses:

1. **Subdomains move along the axis over time.** What was core five years ago may be commodity today (consider how recommendation algorithms have shifted as off-the-shelf retrieval and ranking improved). Re-mapping periodically is the discipline.
2. **The map shows dependencies.** A core component sitting on top of a custom-built dependency is a fragility — the custom-built piece will be a permanent cost. Pushing dependencies toward commodity is a structural strategy, not a code refactor.

The full Wardley mapping technique is its own discipline; for DDD purposes, the three-axis mental model is what to keep.

## Subdomains drift between classifications

The classification is not fixed:

- **Core → supporting:** the differentiator has moved. Many "platforms" started with a core "let users post content" subdomain that is now generic SaaS; the differentiation is now in algorithmic distribution, moderation tooling, or creator economics. The old core is now supporting.
- **Supporting → generic:** a SaaS vendor finally builds your custom internal tool well enough to buy. (This is how billing infrastructure, customer support tools, and ETL pipelines have evolved over the last decade.)
- **Generic → supporting:** your scale or specific requirements outgrew the off-the-shelf solution. A multi-currency, multi-payout-channel marketplace eventually outgrows plain Stripe and needs a custom payments orchestration layer — *not* because payments are core, but because the integration surface has grown enough to justify owning the orchestration.
- **Supporting → core:** rare but happens. A piece of internal infrastructure becomes so good it becomes a product itself (consider how Shopify's internal merchant tools became the platform). Worth recognising when it's happening.

**Re-classify at least annually**, and any time the business strategy or competitive landscape shifts meaningfully. Treating a subdomain as core when it has drifted to supporting wastes engineering capacity on a non-moat; treating a subdomain as generic when it has drifted to supporting under-invests in something that has earned more attention.

## Worked examples

### Example 1: e-commerce startup

| Subdomain | Classification | Decision |
|---|---|---|
| Product catalog & search | Supporting (initially) → could become core if curation is the differentiator | Build pragmatically; consider Algolia or Typesense for search. |
| Authentication | Generic | Buy (Auth0 / Clerk). |
| Payments | Generic (initially) | Buy (Stripe). Re-classify only when scale or unique flows demand more. |
| Order management | Supporting | Build as a clean module; rich enough to enforce state machines and invariants. |
| Recommendations (the differentiator) | Core | Build. Full DDD, full attention, dedicated team, possibly event-sourced. |
| Transactional email | Generic | Buy (SendGrid / Postmark). |
| Internal admin tools | Supporting | Build pragmatically; resist the urge to over-engineer. |

The classification predicts where the team's senior engineers should spend their time: recommendations and (eventually) the parts of order management that interact with recommendations. The rest of the stack is integration and pragmatic CRUD.

### Example 2: B2B SaaS for regulated industry (e.g., insurance back-office)

| Subdomain | Classification | Decision |
|---|---|---|
| Authentication & RBAC | Generic | Buy. |
| Policy underwriting (the differentiator) | Core | Build with full DDD. Ubiquitous language must match underwriters' terminology exactly. Aggregates carefully sized around regulatory invariants. |
| Claims processing | Core (if differentiated) or Supporting (if standard) — *check with the business*. | Depends. |
| Billing & invoicing | Supporting | Build as a clean module; reuse OSS components where possible (PDF generation, ledger). |
| Customer portal | Supporting | Build pragmatically. |
| Document storage | Generic | Buy (S3 + a tagging layer). |
| Reporting & dashboards | Supporting (or generic if a BI tool suffices) | Often buy a BI layer; build only the queries on top. |

The regulated nature of the industry means even the supporting subdomains have real business rules — but only the core subdomains warrant full Event Storming, full aggregate-design discipline, and dedicated domain-expert conversations.

### Example 3: developer tools (e.g., a CI/CD platform)

| Subdomain | Classification | Decision |
|---|---|---|
| Build orchestration & caching (the differentiator) | Core | Build. |
| Source-control integration | Generic | Use the provider's API; thin adapter. |
| Authentication | Generic | Buy. |
| Billing | Generic | Buy (Stripe). |
| Workspace / team management | Supporting | Build pragmatically. |
| Observability of customer builds | Supporting → potentially Core (if differentiation moves here) | Watch for drift. |
| Plugin / extension framework | Core (if a differentiator) | Build with deliberate API design. |

For a tools company, the differentiator is usually the build orchestration itself — the speed, the caching strategy, the parallelism — and that's where DDD investment compounds. Workspace management is forgettable; orchestration is the moat.

## Practical move

When starting a DDD project — or auditing an existing one — produce a one-page subdomain map:

1. List the 5–30 subdomains the system has or needs.
2. Classify each (core / supporting / generic).
3. For each generic subdomain currently being built in-house: name the reason explicitly, and check it survives the "are you sure?" test.
4. For each core subdomain: confirm it's getting senior-engineer attention and full-DDD investment.
5. For each supporting subdomain: confirm it isn't over-engineered (no extracted services for an admin tool nobody calls 10 times a day) and isn't under-built (no anemic CRUD on something that has real state-machine rules).

The map itself is the artifact. Re-do it once a year. The conversations it forces — "wait, why are we building auth ourselves?" / "we keep saying X is core but we have one mid-level engineer on it" — are the entire point.
