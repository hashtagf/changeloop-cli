# Failure modes and operational concerns

Moved from `SKILL.md` — the diagnostic table and cross-cutting operational notes that don't map to a single principle's reference file.

## Failure-mode diagnostics

| Symptom | Failure | Fix |
|---|---|---|
| Entities are bags of getters/setters; all logic in `*Service` classes; logic duplicated across services. | **Anemic domain model.** | Move invariants into entity methods; private setters; constructors validate; see [[programming-fundamentals]]. |
| Transactional contention under load; large object graphs loaded for small operations. | **Aggregate too big.** | Find true invariants (principle 5); split; reference by ID; integrate with domain events. |
| Cross-aggregate try/catch + compensating writes; business rules silently violated under concurrency. | **Aggregate too small.** | Merge — the missing invariant *is* the boundary. |
| Internal domain events published directly as integration events; downstream breaks on every internal rename. | **Leaky bounded context.** | Separate domain and integration events (principle 6); introduce ACL or Published Language. |
| Developers use technical terms (`record`, `row`, `DTO`) in standups; domain experts use different words; bugs trace back to "we thought we agreed." | **Missing ubiquitous language.** | Glossary per context (principle 3); rename in code. |
| Team applies aggregates, repositories, and value objects to a 5-table admin tool. | **Strategic skipped.** | Classify the subdomain (principle 1); if generic or trivial supporting, use boring CRUD with rich-enough types. |
| Internal field rename ripples to forty files because every layer speaks the upstream vendor's vocabulary. | **Missing ACL.** | Insert a translation layer at the boundary (principle 4). |
| Two teams co-own a "shared" library nobody wants to touch. | **Shared Kernel rot.** | Give the kernel an owner or split it; shared-kernel-by-default is the trap. |

## Below the principles: operational concerns

- **Domain experts are the bottleneck.** Strategic DDD's primary lever is the developer/domain-expert conversation. Without access to domain experts, most of the payoff is unavailable — you're in DDD Lite territory (~30% of the value, per Three Dots Labs).
- **Context boundaries can be logical, not physical.** Two bounded contexts can live in one deployable (a well-modularised monolith). The boundary is about *model and language*; deployment shape is a separate decision (see [[architecture-fundamentals]]).
- **CQRS and Event Sourcing are amplifiers, not requirements.** They pair naturally with aggregates but have their own cost and failure modes. Plain CRUD-shaped persistence with rich aggregates is a fine starting shape for most contexts.
- **Conway's Law is a design input.** One bounded context per stream-aligned team is the modern default. If team shape doesn't fit context shape, either reorganise or accept the friction.
- **ORMs and aggregates have an awkward relationship.** Lazy loading, cascade rules, identity tracking — ORMs are built for the entity-graph view. The compromises (eager-load the whole aggregate, suppress lazy loading inside the boundary, repository hides the ORM) are workable but not free.
