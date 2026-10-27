---
name: architecture-fundamentals
description: Design or review relationships between runtime components, services, processes, deployable units, APIs, and events. Use for service extraction, cross-component ownership, sync versus async calls, consistency, resilience, scaling, and contract evolution. Use ddd-strategic first when business meaning or bounded contexts are unclear. Skip module/class boundaries inside one process; use programming-fundamentals for those.
---

# Architecture fundamentals

Use this as the primary skill when the hard decision crosses a runtime,
deployment, ownership, or failure boundary. Decide architecture; let the
Change Loop owns lifecycle, scope, evidence, and Land.

## Rules

1. Define semantic boundaries before choosing modules, services, or teams.
   Split by cohesive ownership and change, not technology or the org chart.
2. Give every durable fact exactly one write owner. Let other components read
   through its contract, event stream, or derived projection.
3. Choose each interaction deliberately: synchronous only when the caller needs
   the result now; asynchronous when work or propagation may complete later.
4. Treat every cross-process call as fallible. Budget latency and add timeouts,
   bounded retries with jitter, breakers/bulkheads, and graceful degradation as
   the failure model requires.
5. Default cross-boundary state to eventual consistency. Name the staleness
   budget; confine strong consistency to one transactional boundary.
6. Make each critical path operable with structured events, correlation,
   metrics/traces, an SLI, an owner, and a rollback or recovery path.
7. Evolve API and event contracts additively. Version unavoidable breaks,
   instrument deprecation, and allow old and new consumers to overlap.

## Decision record

For each changed boundary, record in the active OpenSpec design:

- responsibility and data owner;
- callers/consumers and sync or async rationale;
- latency, failure, retry, and consistency expectations;
- contract compatibility and migration path; and
- operational owner, SLI, rollout, and rollback.

Do not create a parallel architecture plan or status ledger.

## Check before finishing

- Can each state mutation be traced to one owner?
- Do synchronous chains fit the latency and availability budget?
- Are duplicate, delayed, missing, and out-of-order effects handled where
  relevant?
- Can components deploy and roll back during a compatibility window?
- Can an operator locate a failed hop and recover safely?

References: read `references/boundaries.md` for split/merge/extraction;
`communication.md` for sync/async, consistency, and contracts;
`resilience.md` for failure, scaling, rollout, and capacity; and
`observability.md` for system-level operability. Read only the active decision.

Use `queue-fundamentals` after choosing a cross-process async boundary,
`api-design-fundamentals` for the published endpoint contract, and
`hexagonal-backend` for dependency direction inside one service.
