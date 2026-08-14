---
name: plan-writing
description: Write or improve an active OpenSpec change's design.md and tasks.md after proposal and delta requirements are clear. Use when implementation needs meaningful sequencing, compatibility, migration, rollback, cross-component decisions, or task dependencies. Skip rapid changes whose agreement and implementation path are already obvious.
---

# OpenSpec design and tasks

Planning produces no parallel plan artifact. It completes the active OpenSpec
change.

## `design.md`

Record only load-bearing information:

- verified current-state anchors;
- decisions and the constraints that forced them;
- public compatibility and persisted-data consequences;
- rollout and rollback;
- risks mapped to evidence owners.

Do not repeat proposal or requirement prose. Do not narrate a lifecycle.

## `tasks.md`

This is the sole ledger. Each checkbox is a coherent implementation outcome with
an affected surface and a focused verification. Order dependencies first. Mark
parallel work only when files/symbols and verification are genuinely independent.
Group large changes by behavioral slice; each slice must be provable.

Do not create one native task per checkbox, agent-role handoffs, planning/testing
phases, or a second status store. Finish by checking that every delta scenario has
an implementation owner and an evidence claim. Use harness task annotations only
for real repository, dependency, path, provider, or resource constraints; do not
encode speculative concurrency.
