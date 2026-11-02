# Bounded contexts

## Principle 3 (from SKILL.md): One ubiquitous language per bounded context

**Rule:** Inside a bounded context, code, conversations, tickets, dashboards, schemas, and API contracts all use the *same words the domain experts use*, with the same meanings. Across contexts, the same word may mean a different thing — that's correct. Translation, if needed, happens at the boundary via an anticorruption layer or published language, never in code that pretends one model serves both contexts.

**Why:** The translation tax — `record` in code, `row` in DB, `entity` in API, `account` in CRM, `user` in talk-track — is paid on every conversation, review, onboarding, and bug report, forever. Worse, when language drifts, bugs drift: developers and domain experts agree they understood each other and then ship the wrong thing because "an active customer" meant two different things.

**How to apply:**
- **Build a glossary per bounded context.** Twenty terms, one sentence each, ratified by domain experts. Living document. Code must use these terms verbatim.
- **Rename ruthlessly.** When the glossary says `policy`, rename `record`/`entry`/`agreement`/`contract` to `policy` across the codebase, DB schema, API, dashboards, and runbooks. The translation cost is paid once at rename time and saved forever after. (This deliberate, glossary-driven rename is a scoped change — not the incidental adjacent-code rename [[coding-discipline]]'s *surgical-changes* warns against.)
- **The same word in two contexts is two different concepts.** `IdentityCustomer` and `BillingCustomer` can both exist, different fields, invariants, lifecycles. They share an ID but not a model.
- **The smell:** developers and domain experts have parallel vocabularies. Domain expert says "renewal grace period"; engineer says "the field on the subscription table that controls whether we still let them log in for 7 days." Close it by adopting the expert's term in code.

**Example:**
```
Wrong: insurance system uses `Policy` in three contexts (underwriting: draft proposal; billing:
       recurring relationship; claims: coverage agreement). One class with thirty nullable fields.
       Every bug is "we treated a quoted policy as a billable one."

Right: three bounded contexts, three named concepts: `Quote` (underwriting), `BillableSubscription`
       (billing), `CoverageAgreement` (claims). Each has its own fields and lifecycle. The shared
       identifier is a `PolicyNumber`. Translation at explicit integration points.
```

## Principle 4 (from SKILL.md): Name the relationship between contexts deliberately

**Rule:** For each pair of bounded contexts that must integrate, pick one of the seven context-mapping patterns and *name it* — in the context map, in team vocabulary, and (when relevant) in code. The pattern names what the contract is, who owns the translation, and what the failure modes are.

**Why:** Most cross-context pain is unnamed coupling. Two contexts agreed-by-accident to share a model and now neither can evolve. The seven names let two teams have a five-minute conversation about which one applies instead of a six-month conversation about who broke the build.

**How to apply (the seven patterns):**

| Pattern | When to use it | Cost / risk |
|---|---|---|
| **Shared Kernel** — two contexts jointly own a small shared model. | Concept is genuinely identical in both contexts AND teams cooperate closely. Examples: a `Money` type, a small shared protobuf. | Brittle; any change needs coordination. Use *sparingly* — most "shared" things differ subtly between contexts. |
| **Customer / Supplier** — downstream depends on upstream but has political pull on upstream's roadmap. | Both teams inside the same org; supplier *accepts responsibility* for serving customer's needs. | Real cooperation cost; works only when the relationship the pattern names is real. |
| **Conformist** — downstream slavishly accepts whatever upstream publishes. | Upstream won't accommodate (different org, vendor, regulator) AND downstream model fits cleanly onto upstream. | Couples downstream forever to upstream's choices. Acceptable when upstream is stable and fine. |
| **Anticorruption Layer (ACL)** — translation shell at the boundary. | Upstream's model leaks concepts you don't want in your domain: vendor APIs, legacy systems. **Most common defensive pattern.** | Real translation code at the boundary; pay it deliberately, not implicitly throughout the codebase. |
| **Open Host Service (OHS)** — upstream publishes a stable, deliberately-designed protocol for *many* consumers. | Upstream is consumed by enough downstreams that pairwise integration is unmaintainable. Pair with Published Language. | Upstream pays the cost of a stable public surface forever. |
| **Published Language** — a shared, deliberately-designed interchange schema neither side owns. | Industry-standard formats (HL7, FIX, ISO 20022) or internal org-standard schemas in a schema registry. | Governance cost — but replaces N pairwise translations. |
| **Separate Ways** — explicit decision *not* to integrate. | Integration genuinely isn't worth its cost; two contexts are near-duplicates by accident. | The cost of *not* using this when it applies is dragging a useless integration for years. |

- **A context map** is a single diagram listing every integrating pair and the pattern between them. Keep it one page. Update when the relationship changes.
- **Most common patterns in practice:** ACL when integrating with anything outside your team's control; OHS + Published Language when you are upstream for many consumers; Customer/Supplier for two friendly internal teams; Separate Ways when someone proposes an integration nobody actually needs.
- **Be suspicious of:** Shared Kernel (ages badly) and Conformist (often means you skipped the ACL conversation).
- See [[bounded-contexts]] for the full pattern catalog, context-map drawing recipe, and ACL depth.

**Example:**
```
Wrong: platform integrates with a legacy ERP; maps cryptic field names (`STK_BAL`, `LOC_CD`,
       `WHSE_NUM`) directly into its types. Six months in, half the domain model speaks the
       ERP's language; renaming ERP fields requires touching forty files.

Right: platform puts an ACL at the boundary. `LegacyErpInventoryAdapter` emits clean
       `InventoryLevel` values in the platform's ubiquitous language. When the ERP changes,
       only one module changes. The rest of the codebase stays unpoisoned.
```

## What a bounded context actually is

A **bounded context** is the region of the domain inside which a model is consistent and the language is shared. It is not a service. It is not a module. It is not a team boundary. It is a *linguistic + semantic* boundary — the area where every concept has one definition that everyone (engineers, domain experts, the database schema, the API, the dashboards) agrees on.

The boundary is wherever the language changes meaning. Inside Checkout, `Order` means *an in-progress cart waiting to be paid*. Inside Fulfillment, `Order` means *a packed box on a truck*. Inside Finance, `Order` means *a line on a revenue ledger*. Trying to model all three with one `Order` class produces a class with thirty fields, half nullable, with comments like "only set during checkout, ignore in CRM context." That god-object becomes the thing no one wants to touch — and the bug pattern follows: every feature that touches `Order` requires understanding the whole graph, every change breaks something elsewhere, every developer learns to fear the class.

The fix is to **accept that the same word means different things in different contexts**, and to draw the boundary exactly where the meaning changes. Each context has its own `Order` (or its own renamed concept — `Cart`, `Shipment`, `RevenueLineItem`), each with the fields and invariants that apply in *that* context, and nothing else. The contexts identify the same business reality through a shared identifier (`OrderId`, or the moral equivalent), but they do not share a model.

## Bounded context vs service vs module

These are three different things that DDD newcomers consistently conflate:

| Concept | What it is | Examples |
|---|---|---|
| **Bounded context** | A linguistic and model boundary. The region inside which language is shared. | Checkout. Fulfillment. Finance. Identity. Risk. |
| **Service** | A deployment unit — its own process, deploy pipeline, monitoring, on-call. | A separate process called `checkout-service`. A worker that consumes a queue. A standalone HTTP API. |
| **Module** | A code-organisation unit — a package, namespace, or library. | A folder in a monolith. A Go module. A Java package. A TypeScript sub-project. |

The relationships:

- **One bounded context typically lives in one deployment unit** (one service, or one module inside a monolith). Splitting a single bounded context across multiple services is usually a smell — you have two halves of one model talking over a network, paying every microservices cost for zero independence benefit. (Exception: scaling, where the same context is deployed as multiple replicas of the same code. That's not splitting; that's replication.)
- **A deployment unit can host multiple bounded contexts** — a modular monolith is several bounded contexts in one process, each in its own module with clear internal boundaries. This is the right starting shape for most systems. (See [[architecture-fundamentals]] on monolith vs microservices.)
- **A service can be entirely inside one context**, or **straddle a boundary** (a BFF that joins two contexts for the UI's convenience — that's a published-language adapter, not a context of its own).

The takeaway: decide bounded contexts first, deployment shape second. Bounded contexts come from the domain. Deployment shape comes from operational requirements (scaling, deploy independence, team ownership). They can be made to coincide, and often should, but they're separate decisions made for separate reasons.

## Ubiquitous language as a discipline

Inside a bounded context, **code uses the same words as domain experts**, with the same meanings — not approximations, not technical translations, not "what the database column is called." The discipline is naming, but the payoff is correctness.

Symptoms that the language is missing or has drifted:

- Developers and domain experts use parallel vocabularies. Domain expert says "renewal grace period"; engineer says "the field on the subscription table that controls whether we still let them log in for 7 days."
- The same concept has 3+ names in the codebase: `record`, `row`, `entry`, `entity`, `account`, `user`. Each name has a slightly different connotation in someone's head; nobody has written down which is which.
- Bug reports use words that don't appear in the code. The QA engineer says "this affects all suspended customers," but the codebase has no `Customer.suspended` — it has `Account.status = 'INACTIVE'` and a separate `BillingState.dunning = true` flag.
- Code comments are doing translation work. `// 'pending' here means the underwriter hasn't reviewed it yet — not pending payment, that's different`. Each comment is evidence the names aren't carrying their meaning.

The cost of these symptoms isn't readability — it's bugs. When developers and domain experts walk away from a meeting believing they agreed, but the words meant different things in each head, the wrong thing gets shipped. The bug surfaces in production weeks later when someone's idea of "active" turned out not to match the system's idea of "active."

## Building and maintaining the glossary

The practical artifact for ubiquitous language is a **per-context glossary**. One file, one bounded context, twenty terms, one sentence per term.

```markdown
# Underwriting context — glossary

- **Quote**: a draft policy proposal that has not yet been bound. May be priced (we've calculated a premium) without being bound (the applicant has not accepted).
- **Bind**: the act of converting a Quote into a Policy. Irreversible without a Cancellation.
- **Risk Class**: the underwriting category assigned during evaluation. Determines pricing tier and exclusion set. One of: Preferred, Standard, Substandard, Declined.
- **Effective Date**: the date the policy's coverage begins. May be future-dated up to 90 days.
- **Bound Date**: the date the bind happened. Distinct from the Effective Date.
... (15 more)
```

The glossary lives in the repo (so it's versioned alongside the code that implements it), is **ratified by domain experts** (not invented by engineers), and is enforced in code review (does this PR use words that aren't in the glossary?).

When the language evolves — domain experts start using a new word, or the meaning of an existing word sharpens — the glossary and the code update together, in the same PR. The translation tax is paid once at rename time and saved forever after.

For multi-context projects, each context has its own glossary file. The same word may appear in two glossaries with different definitions; that's the entire point of the bounded-context boundary.

## The seven context-mapping patterns

When two bounded contexts must integrate, the relationship between them takes one of seven shapes. Each has a name, a use case, and a cost. The patterns are not modes you can mix-and-match casually; each names a specific *political and technical* contract between two teams (or one team and an external vendor).

### Shared Kernel

**What it is:** Two contexts jointly own a small subset of the model — same code, both teams modify it, both teams accept that changes need coordination.

**When to use it:** The shared concept is genuinely identical in both contexts (a `Money` type, a shared `Address` value object, a small core protobuf used by both sides) AND the two teams cooperate closely (often inside one larger team, with high-bandwidth communication).

**Cost:** Brittle. Any change to the kernel requires coordination. The kernel tends to grow over time (more things get pulled in because "it's easier") and then become the place where every team's least-favorite code lives because no one fully owns it.

**Use sparingly.** Most "shared" things turn out to differ subtly between contexts and would have been better as two separate types translated at the boundary. When you find yourself reaching for shared kernel, ask first: is this really *identical* in both contexts, or just *similar*?

### Customer / Supplier

**What it is:** Downstream depends on upstream, but downstream has political pull on upstream's roadmap. Upstream *accepts responsibility* for serving downstream's needs.

**When to use it:** Both teams are inside the same org. The customer's needs are negotiable into the supplier's priorities. The supplier prioritises and ships the customer's required features on a reasonable schedule.

**Cost:** Real cooperation cost on both sides. Works only when both sides actually have the relationship the pattern names — if "we'll add it to the backlog" really means "in a year, maybe," the pattern is fictional.

### Conformist

**What it is:** Downstream slavishly accepts whatever upstream publishes, with no translation. The downstream model conforms to the upstream model's shape and language.

**When to use it:** Upstream won't accommodate the downstream (different org, vendor, regulator, very-large-internal-team-with-its-own-priorities) AND the downstream model fits cleanly onto the upstream model — there's no real friction between the upstream's vocabulary and the downstream's needs.

**Cost:** Couples downstream forever to upstream's choices. When the upstream renames a field, the downstream renames a field. When the upstream changes meaning, the downstream changes meaning. Acceptable when the upstream model is genuinely fine and stable; dangerous when it's neither — in that case, use an ACL instead.

### Anticorruption Layer (ACL)

**What it is:** A translation shell sitting at the boundary, converting the upstream's model into the downstream's language. The downstream codebase sees only its own clean types; the messy upstream concepts are contained in one module.

**When to use it:** Upstream's model leaks concepts you don't want in your domain. Vendor APIs with cryptic field names and inconsistent null semantics. Legacy systems with stored-procedure logic embedded in the API. Third-party SaaS with idiosyncratic conventions. **This is the most common defensive pattern in real systems**, and the one most often skipped — teams optimistically map upstream fields directly into their own types and pay for it later.

**Cost:** The translation is real code with real maintenance cost. Pay it deliberately at the boundary, not implicitly throughout the codebase. The investment is small at adoption time and pays back every time the upstream changes (or is replaced).

**Shape:** an ACL is usually a single module — `LegacyErpInventoryAdapter`, `StripePaymentAdapter`, `SalesforceCrmAdapter` — that exposes clean methods returning clean types in your ubiquitous language. The adapter knows the upstream's quirks; the rest of the codebase doesn't.

### Open Host Service (OHS)

**What it is:** Upstream publishes a stable, deliberately-designed protocol for *many* consumers. The protocol is the public surface; it is documented, versioned, and treated as a contract.

**When to use it:** The upstream context is consumed by enough downstreams (internal teams, partners, public API users) that pairwise integration would be unmaintainable. The cost of designing and maintaining a stable public API replaces the cost of N pairwise integrations.

**Cost:** The upstream pays the cost of a stable public surface forever — versioning discipline, deprecation lifecycles, backwards-compatible evolution. Worth it when the consumer count is high; expensive overhead when it isn't.

**Often paired with Published Language** (below) to define what the OHS speaks.

### Published Language

**What it is:** A shared, deliberately-designed interchange schema that neither side owns — both producer and consumer code against the published spec, not against each other's internals.

**When to use it:** Industry-standard interchange formats (HL7 in healthcare, FIX in finance, ISO 20022 in payments, OpenAPI specs for public APIs); org-standard internal interchange formats (internal `OrderCreated.v1` schemas registered in a schema registry). Always paired with an Open Host Service on the producer side.

**Cost:** Governance — somebody runs the schema registry, somebody publishes the spec, somebody enforces compatibility rules. But the governance cost replaces N pairwise translations and the brittleness that comes with them.

**Schema registries** (Confluent Schema Registry, AWS Glue Schema Registry, Buf Schema Registry, OpenAPI spec hosting) are the right operational tool here. They encode compatibility rules (backward, forward, full) and reject breaking changes in CI before they ship.

### Separate Ways

**What it is:** The explicit decision *not* to integrate. The two contexts coexist without exchanging data; if data needs to flow, it flows manually (CSV export, periodic sync, etc.) or not at all.

**When to use it:** The integration genuinely isn't worth its cost. The two contexts are near-duplicates by accident of history, or the data they'd share isn't valuable enough to justify the coupling, or the cost of any integration would exceed the benefit.

**Cost:** Honesty. The team admits "we don't integrate these." Often a hard pattern to *propose*, because someone always wants to integrate everything; harder still to *defend* when a stakeholder asks "but couldn't we just sync them?" The right answer is sometimes "no, because the integration would cost more than the value we'd get from it."

The cost of *not* using Separate Ways when it applies is dragging an integration nobody actually needed for years. The cost of using it when it doesn't apply is two systems that should have been one.

## Drawing a context map

A **context map** is a single diagram listing every pair of integrating bounded contexts and the pattern between them. Keep it short — one page. Keep it current — update it when a relationship changes.

Format that works in practice:

```
                        ┌─────────────────┐
                        │   Underwriting  │
                        │     (Core)      │
                        └────────┬────────┘
                                 │
                  Published      │       ACL
                  Language       │  (we shield ourselves from
                  (PolicyBound)  │   the legacy ratings API)
                                 ▼
                        ┌─────────────────┐         OHS
                        │     Billing     │ ───────────────────▶  External
                        │  (Supporting)   │   (PolicyBilling.v2)   accounting
                        └────────┬────────┘                        partners
                                 │
                  Customer/      │
                  Supplier       │
                  (Billing reads │
                   Coverage refs)│
                                 ▼
                        ┌─────────────────┐
                        │     Claims      │
                        │     (Core)      │
                        └─────────────────┘
```

The diagram is half the value. The *conversation* that produces it — "what do we actually publish to whom, who depends on what, where's the translation?" — is the other half.

Update the context map any time:

- A new bounded context is added.
- An integration is added between two existing contexts.
- A pattern changes (e.g., what was a shared kernel becomes an ACL when one team takes ownership).
- The team-ownership shape changes (a reorg often forces a context-map update; see Conway's Law in [[architecture-fundamentals]]).

## Anti-corruption layers in depth

The ACL is worth a deeper look because it's the most useful pattern and the most often skipped.

### What an ACL contains

An ACL is a module (often a single file at first, larger as the upstream surface grows) with three responsibilities:

1. **Talking to the upstream** — HTTP client, SDK calls, message subscription, whatever transport. This is the only place in your codebase that knows the upstream's wire format.
2. **Translating types** — converting upstream's representations into your bounded context's clean types. Upstream's `STK_BAL: -1` (their convention for "out of stock") becomes your `InventoryLevel.outOfStock()`. Upstream's `LOC_CD: "WHS_42"` becomes your `Warehouse.id("warehouse-42")`. The translation is explicit; the rest of your code never sees the upstream's vocabulary.
3. **Handling upstream's failure modes** — timeouts, retries, the upstream's particular flavor of error responses, malformed payloads, schema changes you didn't ask for. The ACL is the failure boundary; the rest of your codebase sees only the clean types or a clean error.

### What an ACL is not

- **Not a thin pass-through wrapper.** A wrapper that just renames `STK_BAL` to `stockBalance` is not an ACL — it's a cosmetic rename. The point is to translate *concepts*, not field names.
- **Not a "we'll add an ACL later" promise.** The cost of retrofitting an ACL over a codebase that already speaks the upstream's vocabulary is much higher than the cost of adding it on day one.
- **Not infinitely big.** The ACL is sized to the upstream's complexity. A simple upstream needs a small ACL. A complex, legacy, idiosyncratic upstream needs a bigger ACL with more translation logic.

### When you don't need an ACL

The upstream's model is genuinely fine — well-named, well-documented, stable, uses concepts that fit cleanly into your context. In that case, **Conformist** is a reasonable choice. The risk: you've now coupled your domain to the upstream's choices forever. Make the call consciously, not by accident.

## Boundary smells

Signals that a context boundary is in the wrong place, or that a needed pattern hasn't been applied:

- **The same word means different things in two places of the codebase**, but both places use the same class. Sign of a boundary inside what's currently treated as one context. Either name the two concepts distinctly, or split the context.
- **Every feature touches two "contexts" together.** They're really one context that's been split prematurely. Merge them.
- **One team can't ship without coordinating with another team for every release.** Either the boundary is wrong, the integration pattern is wrong (often a missing ACL or a missing OHS), or the team-ownership shape doesn't match the context shape.
- **The codebase has a class with thirty fields, half nullable.** Almost always a god-object spanning multiple contexts pretending to be one.
- **Bug reports use words that don't appear in the code.** Missing ubiquitous language (principle 3).
- **A "small change" to an upstream's API field broke five downstreams.** Missing OHS + Published Language (downstreams coded against the upstream's internal shape) or missing ACL (downstreams haven't insulated themselves).
- **Two teams co-own a "shared library" that no one wants to touch.** Shared Kernel rot. Either give it an owner or split it.
- **An external vendor's vocabulary is leaking into your domain code.** Missing ACL.

The general remedy: name the boundary, name the pattern, do the (usually small) refactor to make the boundary real. Skipping these conversations is how the codebase becomes the thing the team is afraid to change.
