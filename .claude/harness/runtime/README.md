# Harness runtime architecture

`foundation.mjs` is the compatibility entrypoint and composition root. Runtime
implementation is grouped by domain:

- `core/` — CLI parsing/routing, process execution, and shared trust primitives.
- `evidence/` — evidence contracts, artifacts, proof, review, CI, and provider execution.
- `workflow/` — change, agent, repository, sandbox, authority, Land, and archive state machines.
- `observability/` — telemetry ingestion, normalization, and read-only metrics reporting.
- `contracts/` — portable schemas for instruction provenance and host execution results.
- `reliability/` — opt-in bounded primitives for explicitly idempotent infrastructure operations.

## Dependency rules

1. The entrypoint creates stores and runtimes through explicit factory dependencies.
2. Domain modules should not import `foundation.mjs` or mutate another domain's private state.
3. Cross-domain behavior is injected as a callback; direct imports are reserved for stable
   primitives in `core/` or helpers in the same domain.
4. Pure validation and normalization stay separate from filesystem/process adapters.
5. Public CLI compatibility remains in `foundation.mjs` and `core/cli-router.mjs`.

These rules keep subsystem tests bounded and prevent the compatibility entrypoint from
growing back into a monolith.
