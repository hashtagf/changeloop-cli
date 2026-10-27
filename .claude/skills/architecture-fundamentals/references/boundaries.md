# Boundaries

Moved from `SKILL.md` — principles 1 and 2's full rule/why/how-to-apply/example, ahead of the topic-organized detail below.

## Principle 1 (from SKILL.md): Draw the boundaries before the boxes

**Rule:** Decide what's *one thing* before deciding whether to put it in one module, one service, or one team. Boundaries follow the domain, not the org chart or the technology you happen to like.

**Why:** Every painful rewrite is a boundary problem. Conway's Law: the system mirrors your communication structure — if you don't choose boundaries deliberately, your org chart, your last hire, and your "we already have a service for that" reflex will choose them for you, and those choices last a decade.

**How to apply:**
- Name the **bounded contexts** — clusters of concepts where words have one definition. "Customer" in billing is not the same as "customer" in CRM; one model cannot serve both. The boundary goes where the language changes.
- Within a bounded context, prefer the **smallest deployment unit that lets the team own a coherent piece of business value**. A new service is a permanent operational cost — separate deploy, monitoring, on-call, a network call where a function call used to be. Pay that cost only when the boundary buys genuine independence a module couldn't. **The 2024 Fowler/Newman consensus is "monolith unless you have a really good reason"** — extraction to services (via the strangler fig, see below) happens when a specific piece earns its way out. Starting microservices-first is a known anti-pattern.
- **Boundaries hide implementation.** If exposing internals is the only way to make a feature work across a boundary, the boundary is in the wrong place. Move it before cementing it.
- Watch the "two services that always deploy together" smell. They're really one. Either merge them, or fix the contract so changes don't ripple.

**Example:**
```
Wrong: split "user profile" and "user authentication" into two services because they "feel different".
       Every signup touches both. Every login changes both. They redeploy in lockstep forever.
       Two services' worth of operational cost for one cohesive concept.

Right: one Identity service owns the user concept end-to-end. Months later, when notifications grow
       into a multi-channel product with its own backlog and on-call rotation, pull it out then —
       when the boundary has earned its cost.
```

## Principle 2 (from SKILL.md): One owner per piece of data

**Rule:** Every piece of state has exactly one component that owns its write path. Everyone else reads through that owner — via API, an event stream, or a read-only projection — and never writes directly to the owner's store.

**Why:** Two writers to the same data = two truths, no tie-breaker. "The data is right in service A but the dashboard shows it wrong" and "we changed it in one place but the other place never noticed" both trace back to unnamed ownership. A single owner is one place to enforce invariants, run migrations, and add new fields.

**How to apply:**
- Pick the component whose **business rules govern the data** — that's the owner. Billing owns invoices, even though Support reads them.
- Other components have three legitimate options, in order of preference:
  1. **Read through the owner's API.** Always consistent at read time, costs a network hop.
  2. **Subscribe to the owner's event stream** and build a local projection. Fast reads, eventually consistent, requires the outbox pattern (see [[queue-fundamentals]]).
  3. **Shared read-only view or read replica.** Last resort — couples the consumer to the owner's storage schema.
- **No shared writable store.** "We'll just have both services write to the same table to keep things simple" is the single most regretted decision in service-oriented systems. The "simplicity" lasts six weeks; the cleanup lasts six quarters.
- If two components genuinely co-own a concept, you have two concepts hiding inside one name. Each owns its own version.

**Example:**
```
Wrong: Orders and Inventory both write to `products` table. Schema migrations need both teams.
       Bugs ping-pong: "who set the stock to -1?"

Right: Catalog owns `products`. Inventory writes to its own `stock_levels` keyed by product ID.
       Orders reads display name through Catalog's API. One owner per row, one place for invariants.
```

## Bounded contexts

A **bounded context** is a region of the domain where a word means one thing. "Order" inside Checkout (an in-progress cart waiting to be paid) is a different concept from "Order" inside Fulfillment (a packed box on a truck) and from "Order" inside Finance (a line on a revenue ledger). Trying to model all three as one `Order` entity produces a class with thirty fields, most of them nullable, and ten rules about when each field applies. That class becomes the thing no one wants to touch.

**The boundary goes where the language changes.** When you find yourself saying "an order, but in *this* context, means..." that's the bounded context emerging. Each context has its own ubiquitous language — the words, definitions, and invariants that engineers and domain experts share inside the boundary. Across the boundary, you translate: Checkout's `OrderId` is Fulfillment's `ShipmentReference` is Finance's `RevenueLineKey`. They identify the same business reality from different angles, but they aren't the same concept.

**A context map** is the diagram of how bounded contexts relate. Common relationships:

- **Customer/Supplier** — one context depends on another, but the supplier serves the customer's needs (downstream has a say in the upstream contract).
- **Conformist** — one context just accepts whatever the other publishes (downstream has no say; takes what it gets).
- **Anti-corruption layer** — a translation shell that prevents an external context's model from leaking into yours (see below).
- **Shared kernel** — a small, jointly maintained subset of the model that both sides agree on. Expensive to keep in sync; use sparingly.
- **Published language** — a context publishes events or APIs as a stable contract; consumers code against the contract, not the producer's internals.

**Practical move.** Before drawing services on a whiteboard, list the bounded contexts. For each, name the words that have a unique definition there. If the same word means the same thing across two contexts, they might be the same context. If a word means three different things in three places, you have three contexts.

## Module vs service: the cost of a process boundary

A new service is a permanent operational cost: separate deploy pipeline, separate monitoring, separate on-call rotation, separate scaling decision, separate auth story for inter-service calls, separate failure mode, and a network call where a function call used to be. That cost is paid every day, by everyone who touches the system.

A new **module** (or package, or library) inside the same deployment unit costs nothing operationally. You get the boundary benefit (independent code, clear ownership of types, restricted dependencies) without the operational tax.

**Default to modules.** Extract a service only when the boundary buys you something a module can't:

- **Independent scaling.** This component handles 100× the traffic of the others, or has a wildly different resource profile (GPU-bound, memory-bound).
- **Independent deploy cadence.** Two teams genuinely need to ship at different speeds, and coordinating a deploy is the bottleneck.
- **Independent failure domain.** A failure in this component must not bring the rest of the system down (e.g., a flaky third-party integration isolated behind its own process).
- **Independent technology.** A piece genuinely needs a different stack (a Python ML model embedded in a Go monolith, say).
- **Regulatory or security isolation.** PCI scope, GDPR data residency, or similar — the data must live in a separately governed component.

If none of those apply, a module is enough. You can always extract later, and "later" is cheaper than the operational debt of a premature service.

**The cost of a network call.** A function call inside a process takes nanoseconds and cannot fail in the "did the other side receive this?" sense. A network call takes milliseconds, can time out, can succeed-but-not-respond, can be retried into duplicates, and pulls in every principle in this skill. Don't pay that cost casually.

## Conway's Law (and the inverse maneuver)

> "Any organization that designs a system... will inevitably produce a design whose structure is a copy of the organization's communication structure." — Melvin Conway, 1968

Conway's Law isn't an opinion; it's an observation that holds in every codebase. Two teams will produce two components, with a contract between them, even if a single component would have been simpler — because the contract is also a way to control who breaks whose build. Three teams will produce three components. The system's seams will be wherever team communication is most expensive.

**Inverse Conway maneuver:** if you want the system to have a particular shape, organize the teams to match. If you want four loosely coupled services, you need four teams (or four sub-teams), each owning one, with clear interfaces between them. Trying to build "microservices" with one team produces one big tangle disguised as four repos.

**Practical implications:**

- Reorgs change architectures, whether anyone meant them to or not. After a reorg, watch where the system starts to bifurcate.
- The fastest way to ossify a boundary is to put a team on each side of it. The fastest way to dissolve a boundary is to give both sides to one team.
- If you want a boundary to *move*, you may have to move the people first.
- Hiring a single contractor to build "the whole platform" produces a monolith. Splitting the work across three vendors produces three subsystems with contracts between them, regardless of what the architecture diagram said.

## Extracting a service from a monolith: the strangler fig

When a chunk of a monolith has earned its way out — independent scale, independent deploy, clear bounded context — extract it incrementally. Don't big-bang. The pattern is the **strangler fig**: new code grows around the old; the old is gradually starved; eventually the old can be removed entirely.

**The recipe:**

1. **Identify the seam.** Pick a bounded context. Name the use cases that belong to it. Name the data it owns.
2. **Put a facade in front of the old code.** All callers go through the facade. The facade is the interface the new service will eventually present.
3. **Implement one use case in the new service.** The facade routes that use case to the new service; everything else still hits the old code.
4. **Migrate data carefully.** If the new service owns data the old code still reads, dual-write during the transition: writes go to both, reads go to the new service (or to the old, with verification). Eventually flip reads to the new service exclusively, then turn off the old write path.
5. **Repeat for the next use case** until the old code's role in this context is empty.
6. **Delete the old code.** The fig has strangled the tree.

**Why it works:** at every step, the system is shippable. You can roll back any single migration without unwinding the whole effort. The riskiest step is data migration; everything else is plumbing.

**Why big-bang fails:** "We'll have a one-month feature freeze and switch over on Saturday" — by Sunday, you have two systems that disagree about reality, no rollback path, and a war room. The cost overrun on these projects routinely exceeds 2× and sometimes never finishes.

## Anti-corruption layers

When you must integrate with a system you don't control — a legacy monolith, a third-party API, a system with bizarre or hostile data model — wrap it in an **anti-corruption layer (ACL)**. The ACL translates between the external system's model and your own clean model. Outside the ACL, you see your model; inside the ACL, the messiness is contained.

**Why this matters:** without an ACL, the external system's choices (their field names, their enums, their nullability quirks, their non-idempotent endpoints) leak into your domain. Six months later, your domain entities have `external_legacy_status_code_v2` fields and your code is half yours, half theirs.

**Shape of an ACL:**

- A driven adapter (in [[hexagonal-backend]] terms) that implements your port using the external system's API.
- A translation layer that maps external types ↔ your domain types. The translation is the *only* place the external types are mentioned.
- Defensive handling for the external system's quirks: rate limits, weird auth, undocumented enum values, breaking changes between versions.

**Practical move:** when you integrate with a partner's API, do not pass their JSON shape into your business logic. Define your own input/output types; translate at the boundary. If they ship a v2, you change the translation; nothing else.

## Boundary smells

Smells that the boundary is in the wrong place or doesn't exist:

- **Two services always deploy together.** They're really one. Either merge them, or fix the contract so changes don't ripple.
- **A change in one service requires a change in another service's database migration.** The shared schema is a hidden coupling. Each service should own its own schema.
- **The team for service A has to ask the team for service B to approve every change.** The boundary is in the wrong place — it cuts through a single coherent piece of business value.
- **"Just give me direct access to your DB."** When this conversation happens between teams, ownership has not been named. Refuse direct DB access; expose an API or an event stream instead.
- **One word means different things in different parts of the codebase, but it's still one type/class.** You have bounded contexts trying to emerge.
- **The same business rule is enforced in three different places.** Either the rule belongs in one owner (and the others should read from it), or each of the three places has its own concept that happens to share a name.
- **An "Orchestrator" service that calls four other services in sequence for every request.** Either the orchestration is a real use case (and is fine), or you've made a hub-and-spoke that turns every request into a fan-out and reduces three independent failure modes to one.
- **A "common" or "shared" service that everything depends on.** It will be the bottleneck for every change and the single point of failure for every outage. Push shared concerns into libraries (compile-time dependency) rather than runtime dependencies.

The fix for most smells is the same: re-examine the bounded contexts, rename the ambiguous concept, move the boundary, or merge the components. None of these are cheap, but all of them are cheaper than living with the smell forever.
