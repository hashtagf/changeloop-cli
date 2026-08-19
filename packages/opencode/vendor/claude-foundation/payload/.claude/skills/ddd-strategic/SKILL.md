---
name: ddd-strategic
description: Decide business meaning, model ownership, and bounded contexts before choosing runtime architecture. Use for subdomain investment, ubiquitous language, context maps, domain discovery, aggregate sizing, or separating domain from integration events. Use architecture-fundamentals afterward for service/process communication and failure design. Skip generic CRUD, single-context implementation, and work without meaningful domain rules.
---

# Strategic DDD

Use this as the primary skill when the hard question is what a business concept
means, where that model is valid, or who owns it. Keep semantic boundaries
logical until architecture work proves a separate runtime boundary is useful.

## Rules

1. Classify each subdomain as core, supporting, or generic. Invest custom design
   in differentiation; prefer buy/borrow or pragmatic implementation elsewhere.
2. Discover boundaries from real workflows, events, actors, language shifts,
   policies, and clocks—not from a noun list or existing tables alone.
3. Maintain one ubiquitous language per bounded context. Record different
   meanings as different concepts even when teams currently share one word.
4. Name each context relationship: Shared Kernel, Customer/Supplier, Conformist,
   Anticorruption Layer, Open Host Service, Published Language, or Separate Ways.
5. Size aggregates around business invariants that require atomic change.
   Keep them small, reference other aggregates by identity, and coordinate
   across aggregates eventually.
6. Keep internal domain events rich and private. Translate cross-context
   integration events into narrow, versioned contracts at the boundary.

## Required outputs

Capture only artifacts that resolve the active decision:

- a glossary for changed terms;
- a context map for changed relationships;
- the invariant that justifies each affected aggregate boundary; and
- event classification plus translation ownership.

Put durable decisions in the active OpenSpec change; do not create a second
lifecycle or status document.

## Check before finishing

- Would domain experts agree with the terms and boundary?
- Is the build/buy/investment choice consistent with subdomain value?
- Does each aggregate boundary name a concrete invariant?
- Are logical bounded contexts being confused with deployable services?
- Can integration contracts evolve independently from internal models?

References: read `subdomain-classification.md` for investment decisions;
`event-storming.md` for discovery workshops; `bounded-contexts.md` for language
and context maps; `aggregate-design.md` for aggregate/event boundaries; and
`failure-modes.md` for diagnostics. Read only the active decision.

Use `programming-fundamentals` for value-object/module design,
`hexagonal-backend` inside one context, and `architecture-fundamentals` for
runtime boundaries after the model is clear.
