# Aggregate design

## Principle 5 (from SKILL.md): Size aggregates around invariants, not entities

**Rule:** An aggregate is a *transactional consistency boundary* — the smallest set of entities and value objects that must change atomically to keep a business invariant true. Design aggregates *small*, reference other aggregates *by identity*, modify *one aggregate per transaction*, and let everything outside the boundary be *eventually consistent*. The test: "what business rule is invalidated if these two things are modified in separate transactions?" If you can't name one, they belong in different aggregates.

**Why:** The classic DDD-gone-wrong shape is an oversized aggregate — a `Project` owning all `Releases` owning all `Sprints` owning all `BacklogItems` — and it fails in production via transactional contention: two users modify the same root, the optimistic lock collides, retries pile up, throughput collapses. Vernon's empirical observation: ~70% of well-designed aggregates are a single root entity with only value-typed properties; ~30% have 2–3 entities total. Bigger is almost always a smell.

**How to apply (Vernon's four rules):**
1. **Model true invariants in consistency boundaries.** An aggregate's job is to enforce one or a few business rules atomically. Everything else lives outside.
2. **Design small aggregates.** Default to root + value-typed properties. Add entities only when an invariant *requires* them in the same transaction. Beware `0..*` collections inside an aggregate — they grow unbounded.
3. **Reference other aggregates by identity.** Hold an `OrderId`, not a reference to the `Order` object. Cross-aggregate modification becomes impossible by construction.
4. **Use eventual consistency outside the aggregate.** Aggregate A commits → emits domain event → handler updates aggregate B in a *separate* transaction. Combine with the **outbox** pattern (see [[queue-fundamentals]]).

- **The sizing test.** Before putting two entities in the same aggregate, name the invariant that breaks if they're in separate transactions. "It's convenient to load them together" is not an invariant — that's a query concern, solvable with a read model.
- **The collection trap.** Bounded, small collections inside the aggregate are fine (a `Cart` with ≤50 items). Unbounded collections (`Project.backlogItems`, `Customer.orders`) mean the items are their own aggregates referenced by ID.
- **When the rule pushes back:** if the business *requires* strong consistency across what looks like two aggregates, they're probably one. Verify by asking the domain expert "what breaks if these are inconsistent for 200ms?"
- **Aggregates and the rest of the library:** the code inside is governed by [[programming-fundamentals]] (illegal states unrepresentable, invariants in constructors); persistence via [[hexagonal-backend]]'s repository ports; the transaction by [[database-fundamentals]]; emitted events cross to [[queue-fundamentals]] when leaving the context.
- See [[aggregate-design]] for the four rules with worked examples, the sizing test, the Vernon Scrum-aggregate split walkthrough, and ORM/persistence concerns.

**Example:**
```
Wrong: `Project` aggregate owns `Release` → `Sprint` → `BacklogItem`. Adding an item loads the
       entire graph, modifies the root, saves. Two users adding items concurrently fight for the
       root's optimistic lock. Under load, throughput collapses.

Right: four aggregates — `Project` (id, name, code, owner), `Release` (id, project_id, name,
       window), `Sprint` (id, release_id, capacity, start, end), `BacklogItem` (id, sprint_id,
       title, story_points, state). Each holds *its own* invariants. Cross-aggregate coordination
       via domain events in separate transactions. Throughput scales with aggregates touched.
```

## Principle 6 (from SKILL.md): Separate internal domain events from cross-context integration events

**Rule:** Domain events *inside* one bounded context can be rich, evolve freely, and use the full ubiquitous language. Events crossing *into* another context (or external consumers) are a *contract* — narrower, versioned, deliberately stable, often a different shape. Don't publish your internal event directly as an integration event; that couples model evolution to every downstream forever.

**Why:** Internal domain events and integration events look similar but have opposite lifecycle properties. Internal events are *implementation detail*: rename a field, restructure an aggregate, and the internal event changes in lockstep in one repo. Integration events are *contract*: every change must respect every downstream consumer, deploy on a different schedule, and survive consumer versions not yet upgraded. Conflating them is one of the top DDD failure modes — every internal refactor breaks downstream, and "small" changes ship over quarters.

**How to apply:**
- **Two distinct event types in the codebase.** `OrderConfirmed` (internal domain event, rich, evolves with the model) and `OrderConfirmedV1` (integration event, narrow contract, versioned, lives in a schema registry). The integration event is *produced from* the internal at the boundary, never *equated* to it.
- **Integration events are smaller, not bigger.** Strip internal-only fields, denormalise what downstream consumers actually need, version explicitly. Tolerant readers make backwards-compatible evolution safe.
- **Outbox pattern for the publish.** Internal events emitted by the aggregate inside the same DB transaction as the state change; an outbox relay publishes the translated, contract-shaped integration event to the broker. This is [[queue-fundamentals]]' territory operationally — this skill's contribution is *which event is which* and *where the translation happens*.
- **Naming convention.** Domain events use the ubiquitous language verbatim (`PolicyBound`, `ClaimSubmitted`). Integration events use the same verb with a version suffix (`PolicyBoundV1`). The version is part of the name, not a header.
- **Schema registries** (Avro/Protobuf/JSON Schema) encode compatibility rules and reject breaking changes in CI.
- **The cross-context boundary is the same line as the language boundary (principle 3).** Translation of payload and translation of language happen at the same point.

**Example:**
```
Wrong: Billing publishes its internal `InvoiceCreated` event directly to the broker. It carries
       `pricing_engine_version`, `applied_promotion_tree`, `tax_jurisdiction_resolution_trace`
       — internal debug fields. Three downstream consumers code against them. Six months later,
       Billing rewrites its pricing engine; all three consumers break overnight.

Right: Billing emits an internal `InvoiceCreated` to its own outbox. A relay translates each into
       `InvoiceCreatedV1` — invoice id, customer ref, amount, currency, line items, due date —
       and publishes that to the broker. Internal evolution and external contract are decoupled.
```

## What an aggregate actually is

An **aggregate** is a *transactional consistency boundary*: the smallest cluster of entities and value objects that must change atomically to keep a business invariant true. It has a single **root entity** (the aggregate root) — the only object outside code can hold a reference to. All access to the aggregate's internals goes through the root.

Three properties together define an aggregate:

1. **Atomic commit.** Everything inside the aggregate is saved (or rolled back) in one transaction.
2. **Encapsulated invariants.** The aggregate's job is to enforce one or a few business rules that span its entities. Outside code can't violate those rules because it can't reach inside.
3. **Identity-based references** *from* other aggregates. Other aggregates hold an `AggregateId`, not an object reference, so they cannot accidentally modify state across boundaries.

Three things an aggregate is *not*:

- **It is not a "domain object."** Most things in a domain are not aggregates — value objects, services, events, factories, repositories all exist alongside aggregates.
- **It is not the same as a database table.** One aggregate often maps to multiple tables; rarely, multiple small aggregates map to one table.
- **It is not the unit of authorization or display.** Authorization is a separate concern; UI display models are read-side concerns (often projections).

## Vernon's four rules

[Vaughn Vernon's "Effective Aggregate Design"](https://www.dddcommunity.org/library/vernon_2011/) (a three-part essay, then expanded into chapters of *Implementing Domain-Driven Design*) is the canonical reference for aggregate sizing. The four rules:

### Rule 1: Model true invariants in consistency boundaries

The aggregate's purpose is to enforce a business invariant *atomically*. If the rule "a sprint's committed story points must not exceed its capacity" must be true *immediately* (not eventually), then `Sprint` and its `BacklogItem`s must be inside one aggregate. If the rule is "the customer's display name should eventually match their CRM record" — eventually being measured in seconds — then `Customer` and `CrmRecord` are in different aggregates linked by ID.

The discipline: **name the invariant before drawing the aggregate boundary.** "I want these together because it's convenient" is not an invariant.

### Rule 2: Design small aggregates

Vernon's empirical observation: ~70% of well-designed aggregates are a single root entity holding only value-typed properties; ~30% have 2–3 entities total. Larger than that is almost always a smell, and almost always traces back to ignoring rule 1 (no real invariant — just convenience).

The cost of an oversized aggregate is paid every time the aggregate is loaded, saved, locked, or cached:

- **Memory:** large object graphs hydrated for small operations.
- **Concurrency:** every operation on any entity inside the aggregate competes for the same optimistic-lock version.
- **Throughput:** more concurrent updates colliding means more retries; under load, throughput collapses.
- **Coupling:** code that wants to modify one entity ends up depending on the whole graph being loaded.

Small aggregates trade these costs for the cost of eventual consistency between aggregates — and eventual consistency is almost always acceptable for the kinds of "consistency" that get incorrectly modeled as in-aggregate.

### Rule 3: Reference other aggregates by identity

Inside an aggregate, hold *value objects and child entities by reference* (you own them, you can mutate them through the root). Across aggregates, hold *only the other aggregate's ID*, not a reference to the other aggregate's root.

```typescript
// Wrong — aggregate boundary violated
class Order {
  constructor(
    public readonly id: OrderId,
    public readonly customer: Customer,   // ← Customer is a separate aggregate
    public readonly items: OrderItem[],
  ) {}
}

// Right — reference by identity
class Order {
  constructor(
    public readonly id: OrderId,
    public readonly customerId: CustomerId,   // ← just the identifier
    public readonly items: OrderItem[],       // ← OrderItems are inside this aggregate
  ) {}
}
```

The reason this matters: with an object reference, code inside the `Order` aggregate can call `this.customer.deactivate()` and silently violate the `Customer` aggregate's invariants. With an ID, that operation is *syntactically impossible* — the code that wants to modify the customer must load the customer aggregate through its own repository. The boundary is enforced by the type system, not by convention.

### Rule 4: Use eventual consistency outside the aggregate

When two aggregates need to coordinate (a state change in one drives a change in another), the path is:

1. Aggregate A handles a command, mutates state, emits a domain event, commits.
2. The domain event is published (via the outbox pattern — see [[queue-fundamentals]]) so that publication is exactly-as-often as commit.
3. An event handler loads aggregate B in a *separate* transaction and applies the corresponding change.
4. The two aggregates are eventually consistent — there's a window (often milliseconds) where they're out of sync.

This is *fine* for almost all cases. The cases where it isn't fine — where the inconsistency window genuinely breaks the business — are the cases where the two entities belong inside the same aggregate (rule 1).

The combination of rules 3 and 4 means: cross-aggregate consistency is *opt-in*, not *opt-out*. You can only violate it deliberately, by loading two aggregates in the same transaction (which the type system makes awkward, and which Vernon recommends against).

## The sizing test

Before placing two entities in the same aggregate, run this test:

> **What business rule is invalidated if these two things are modified in separate transactions?**

If you can name a specific rule with a specific stakeholder who would care, they belong in the same aggregate. If the best you can come up with is "it'd be inconsistent for a few hundred milliseconds," they belong in *different* aggregates and the answer is eventual consistency.

Common failures of the test:

- **"It's convenient to load them together."** Not an invariant. Solve with a read model (a projection that denormalises both aggregates' data for display purposes).
- **"They share an ID."** Not an invariant. Sharing an ID is what cross-aggregate references *do* — it's the basis for eventual consistency, not for in-aggregate composition.
- **"They always change together."** Suspicious. *Always* — really? Often two things change together in the happy path but can change independently in edge cases (retries, manual corrections, compensating transactions). If even one such edge case exists, eventual consistency is correct.
- **"The user expects them to be in sync."** Almost always actually means "the user expects them to be in sync within a reasonable time window" — which is eventual consistency, not strong consistency.

Genuine in-aggregate invariants pass the test cleanly:

- "An order's items' total must equal the order's total." → items + order in one aggregate.
- "A sprint's committed story points must not exceed its capacity." → sprint + items in one aggregate (assuming items belong to one sprint).
- "An account's balance must never go negative." → account + transactions affecting balance in one aggregate.

## The canonical example: splitting the Scrum aggregate

Vernon's most famous worked example: a Scrum-tracking application originally modeled as a single deep aggregate.

### The wrong design

```typescript
// One big aggregate
class Project {
  id: ProjectId
  name: string
  releases: Release[]  // 0..*
}

class Release {
  name: string
  sprints: Sprint[]    // 0..*
}

class Sprint {
  capacity: number
  items: BacklogItem[] // 0..*
}

class BacklogItem {
  title: string
  storyPoints: number
  state: 'open' | 'in_progress' | 'done'
}
```

Adding a backlog item: load the entire `Project` graph, navigate to the right sprint, append to its `items`, save the whole graph.

**Problems that hit in production:**

- Two users on the same project adding items at once: both load the project, both modify a sprint, both save — optimistic-lock collision, one retries, throughput plummets.
- The project graph for a year-old project loads megabytes of data for a one-row insert.
- The transaction holds locks on the project row, the release row, the sprint row, and the items table — concurrent updates anywhere in the graph contend.
- Adding a backlog item to sprint A is blocked by someone adding a backlog item to sprint B in the same project. The boundary is wildly too big.

### The right design (post-split)

```typescript
// Four small aggregates linked by ID

class Project {
  id: ProjectId
  name: string
  code: string
  ownerId: UserId
  // Invariant: project must have unique code within the org. That's it.
}

class Release {
  id: ReleaseId
  projectId: ProjectId    // ← reference by ID
  name: string
  window: DateRange
  // Invariant: release window must be valid. That's it.
}

class Sprint {
  id: SprintId
  releaseId: ReleaseId    // ← reference by ID
  capacity: number
  window: DateRange
  committedPoints: number
  // Invariant: committed points <= capacity. Enforced when items are committed.
}

class BacklogItem {
  id: BacklogItemId
  sprintId: SprintId | null    // ← reference by ID, nullable when unassigned
  title: string
  storyPoints: number
  state: 'open' | 'in_progress' | 'done'
  // Invariant: state transitions follow the rule (open → in_progress → done, no skip).
}
```

**Cross-aggregate coordination** (e.g., "when a backlog item is committed to a sprint, the sprint's committed-points must update"):

1. `BacklogItem.commitToSprint(sprintId)` — emits `BacklogItemCommittedToSprint(itemId, sprintId, storyPoints)`. Commits.
2. Event handler loads `Sprint(sprintId)`, calls `Sprint.recordCommitment(storyPoints)`. Sprint's invariant checks; if violated, raise a `CommitmentRejected` event and a compensating action moves the item back to unassigned.
3. UI shows the eventually-consistent state, possibly with "syncing" affordance for the brief window.

**Properties of the new design:**

- Each aggregate is small (1 entity + value objects).
- Each aggregate has *one* real invariant.
- Concurrent operations across the project don't contend (adding a backlog item to sprint A doesn't lock anything in sprint B).
- Loading is cheap — small aggregate, small graph.
- The cross-aggregate consistency is eventual; the inconsistency window is acceptable for the business.

This is the prototype of "find the invariant, split around it." Most large-aggregate problems in real codebases collapse into a similar split when the invariants are stated explicitly.

## Aggregates within bounded contexts

Aggregates live *inside* bounded contexts. A bounded context typically contains:

- **Multiple aggregates** — usually 3–10, occasionally more.
- **Value objects** used by aggregates (`Money`, `Address`, `DateRange`, etc.).
- **Domain services** for logic that doesn't fit naturally on one aggregate (pricing rules that span several aggregates, for example).
- **Repositories** (ports in the hexagonal sense — see [[hexagonal-backend]]).
- **Domain events** emitted by aggregates.
- **Application services / use cases** that orchestrate commands across one or more aggregates.

An aggregate **never spans bounded contexts**. If you find yourself wanting an aggregate to "know about" entities in another context, that's a sign of either (a) a missing translation layer (an ACL — see [[bounded-contexts]]) or (b) two contexts that should be one.

Cross-context coordination works the same way as cross-aggregate coordination, just with an extra step: instead of an in-process event handler, the trigger is an *integration event* published to a broker and consumed by another context's handler. The semantics (eventual consistency, idempotency, retries) are the same; the operational machinery is heavier. See principle 6 in [[../SKILL]] for the domain-event vs integration-event distinction.

## Aggregates and persistence

Aggregates need to be persisted, and persistence introduces practical concerns:

### Repositories load and save whole aggregates

A `ProjectRepository.save(project)` saves *the whole aggregate* (the project root and anything inside its boundary), atomically, in one transaction. `ProjectRepository.findById(id)` loads the whole aggregate. Partial loads or partial saves are a smell — they suggest either the aggregate boundary is wrong (too big) or the operation is bypassing the aggregate (violating encapsulation).

For aggregates whose internals include bounded collections (an `Order` with line items, a `Sprint` with capacity assignments), loading the whole aggregate is fine — bounded means bounded. For aggregates whose internals are unbounded by accident (a `Project` that somehow accumulated all backlog items ever), the aggregate is too big (rule 2).

### One aggregate per transaction

A use case modifying *one* aggregate runs in one transaction. A use case that *appears* to modify two aggregates is really modifying one and emitting an event that asynchronously modifies the other. The outbox pattern ([[queue-fundamentals]]) keeps the event publication atomic with the aggregate save.

There are rare cases where two aggregates *must* be in the same transaction (e.g., transferring money between two accounts, where compliance requires the two writes to be atomic). When you encounter one, ask first: are these really two aggregates? Often the answer is "no, they're one aggregate" (e.g., a `Transfer` aggregate that owns both leg entries, with the accounts referenced by ID).

### ORMs and aggregates have an awkward relationship

ORMs (Hibernate, Entity Framework, SQLAlchemy, Active Record, Doctrine, Sequelize) are built for entity-graph navigation. Aggregates push back on parts of that:

- **Lazy loading** — convenient for ORMs, hostile to aggregates (you can't easily reason about what's loaded). Aggregates typically *eager-load* their whole graph.
- **Cascade rules** — the ORM might cascade-delete entities across aggregate boundaries. Configure cascades to *stay inside* the aggregate; cross-aggregate cascades are violations of the boundary.
- **Identity tracking / sessions** — ORMs often track every entity loaded in a session, including ones from "other aggregates" if you traverse object graphs. The discipline is to load other aggregates *through their own repositories*, not by following references.
- **Implicit dirty checking** — convenient for CRUD, awkward for aggregates (you want explicit `save(aggregate)` to be the only commit path).

Workable compromises:

- **Eager-load the whole aggregate** in the repository's `findById` query. Suppress lazy loading inside the aggregate boundary.
- **Use repository-per-aggregate**, not generic CRUD repositories. The repository is the place that knows about the aggregate's persistence shape; the rest of the codebase doesn't.
- **Treat the ORM as an implementation detail of the repository** — the application layer shouldn't know whether the repository is backed by Hibernate, raw SQL, or Mongo. (This is exactly the hexagonal-port-and-adapter discipline from [[hexagonal-backend]].)

In Go, where there is no dominant ORM, the discipline is easier — sqlc/pgx with hand-written queries fits aggregates naturally. In TypeScript, Prisma and Drizzle are reasonable; TypeORM and Sequelize have more friction. In Python, SQLAlchemy with explicit session boundaries is workable; Django ORM is harder. In Ruby, Active Record's model-as-database-row default is hostile to aggregates — adoption typically means putting ActiveRecord *inside* the repository and exposing aggregate-shaped objects above it.

## Aggregates and events

Aggregates emit **domain events** as part of their command methods. A typical aggregate command:

```typescript
class Order {
  // ... fields ...

  place(items: LineItem[]): DomainEvent[] {
    // 1. Validate (raise an error if illegal)
    if (items.length === 0) throw new EmptyOrderError()

    // 2. Mutate (apply state changes)
    this.items = items
    this.status = OrderStatus.Placed
    this.placedAt = clock.now()

    // 3. Emit (record what happened)
    return [new OrderPlaced({
      orderId: this.id,
      customerId: this.customerId,
      items: items.map(i => ({ sku: i.sku, qty: i.qty, price: i.unitPrice })),
      total: this.computeTotal(),
      placedAt: this.placedAt,
    })]
  }
}
```

The events are *outputs* of the command, alongside the state change. The application layer (use case) collects them and hands them to the outbox at save time.

Two common shapes:

1. **Return events from the method**, as above. Explicit; easy to test; works in any language.
2. **Accumulate events on the aggregate** (`this.pendingEvents.push(...)`), flushed at save time. Slightly more convenient for chained commands; slightly easier to forget to flush. Common in Java / C# / Python.

Either is fine. The point is: events are *first-class output* of aggregate commands, not log lines tacked on at the end.

Events emitted by aggregates are **internal domain events** — they speak the bounded context's ubiquitous language, can change shape as the model evolves, and are usually consumed by handlers within the same bounded context. When events need to *cross* the context boundary, they're translated at the boundary into **integration events** — narrower, versioned, contract-shaped. See principle 6 in [[../SKILL]] for the distinction.

## Common anti-patterns

### Aggregate too big (the most common)

Symptoms: transactional contention, large object-graph loads, unbounded `0..*` collections inside the aggregate. Fix: find the real invariants, split.

### Aggregate too small

Symptoms: cross-aggregate try/catch with compensating writes, business rules silently violated under concurrency, retries that lose work. Fix: merge — the missing invariant is the boundary.

### Aggregate with no real invariants

Symptoms: the aggregate is a CRUD entity dressed up — `Customer.update(fields)`, no real rules, no real commands. Fix: drop the aggregate ceremony. A plain repository-and-DTO is fine for subdomains without invariants. (And re-check the subdomain classification — if this is generic or trivial supporting, you may be over-engineering.)

### Aggregate that holds object references to other aggregates

Symptoms: code can call `order.customer.deactivate()`. Fix: replace the reference with the customer's ID; if you need customer data, load it explicitly through the customer's repository.

### Aggregate boundary that crosses bounded contexts

Symptoms: the aggregate's fields use vocabulary from two contexts ("the `Order` has a `policyType` field because the underwriting team needs it"). Fix: split — the aggregate belongs to one context, with translation at the boundary for fields needed elsewhere.

### Application-service god-method

Symptoms: a use case that orchestrates 5+ aggregates in one method, with all the logic in the use case instead of the aggregates. Fix: push the rules into the aggregates (one aggregate per use case where possible); the use case becomes thin orchestration. Domain services help when logic genuinely spans aggregates but doesn't belong to any one of them.

### Anemic aggregate

Symptoms: the aggregate is a record with getters and setters; the logic lives in a `*Service`; the aggregate is just data. Fix: move methods onto the aggregate; private the setters; constructors validate. See [[programming-fundamentals]] for the underlying principle (illegal states unrepresentable).
