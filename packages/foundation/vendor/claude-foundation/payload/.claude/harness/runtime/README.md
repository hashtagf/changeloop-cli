# Harness runtime architecture

`foundation.mjs` is the compatibility entrypoint and composition root. Runtime
implementation is grouped by domain:

- `core/` — CLI parsing/routing, process execution, shared trust, the compiled
  execution contract, convergent gates, authority policy, lifecycle reducer,
  and read-only runtime/proof/journal projections.
- `evidence/` — evidence contracts, artifacts, proof, review, CI, signed semantic
  acceptance, and provider execution.
- `workflow/` — change, agent, repository, sandbox, authority, Land, and archive state machines.
- `observability/` — telemetry ingestion, normalization, and read-only metrics reporting.
- `contracts/` — portable schemas for instruction provenance and host execution results.
- `reliability/` — opt-in bounded primitives for explicitly idempotent infrastructure operations.

## Dependency rules

1. The entrypoint creates stores and runtimes through explicit factory dependencies.
2. Domain modules should not import `foundation.mjs` or mutate another domain's private state.
3. Dependencies point from `workflow` to `evidence`, then to `core`/`contracts`;
   reverse edges are forbidden. Direct cross-domain imports are limited to stable pure
   helpers and contracts along that direction. Stateful behavior is injected as a callback.
4. Pure validation and normalization stay separate from filesystem/process adapters.
5. Public CLI compatibility remains in `foundation.mjs` and `core/cli-router.mjs`.

These rules keep subsystem tests bounded and prevent the compatibility entrypoint from
growing back into a monolith.

The deterministic architecture suite enforces this graph:

```text
contracts / core / reliability
            ^
 evidence / observability
            ^
         workflow
            ^
       composition root
```
