---
name: grill-task-gu
description: Ground an approved PRD in architecture and production code, settle every material choice in one Decision Sheet, and write a dependency-ordered backlog ready for one Foundation change per group. Use for grill-task-gu, PRD grooming, backlog creation, or /feature intake.
---

# Grill Task Gu

Produce `full discovery → one Decision Sheet → backlog + coverage → handoff`.
Never implement or run a one-question interview.

## Required intake

Read [references/intake-contract.md](references/intake-contract.md) completely.
Then resolve the PRD and existing backlog. Read every selected critical file end
to end and follow the production path from configuration/composition root through
the caller, adapter, dependency, and corresponding tests. For security behavior,
read every relevant rejection stage in dependency source.

Maintain a private read set of repository, path, role, mode, digest, and supported
fact. Reuse locked decisions. Discoverable facts come from sources; reversible
safe defaults are recommended; only observable product/scope/risk choices are
material. Assignee and date are non-blocking unless `--schedule` is present.

Before the sheet, trace conditional production entry points, real serialized
bytes, dormant code being activated, and failure classifiers. For every
cross-service call or message, settle owner, producer, consumer, contract,
delivery, timeout/retry, idempotency, ordering, consistency, rollout, and
rollback. For every operated boundary, settle correlation, structured events,
SLI, alert, runbook, and the operator question the telemetry must answer.
Source-proven `N/A` rows stay in the same sheet and are never asked later.

## Single user gate

Before asking, draft task outcomes, dependency groups, two-way requirement
coverage, source grounding, and risk-to-evidence mappings. Present one Decision
Sheet containing every material choice, recommended defaults, alternatives,
effects, proposed groups, risk tier, critical test cases, required mutants,
service interactions, observability, and external blockers. Ask for approval or
all overrides together. Record the answer; do not ask a second approval question.

Later phases must reuse the locked sheet. Only evidence proving the agreement
unsafe permits one exception: collect every newly opened decision into one
reopen sheet, record its reference, and revise the same change atomically.
Retirement requires separate user authority. Ordinary findings return to Build.

## Output and audit

Write `docs/backlog/{service}/{PRD-ID}.md` with stable task IDs, locked decisions,
dependency groups, coverage, and evidence readiness. Preserve existing IDs and
statuses. Each task names its observable completion, source anchors, risk,
evidence class, production path for composition/security claims, and blocker
owner. New tasks are `Pending`; task status remains the sole delivery ledger.

Before writing, verify both directions: every requirement maps to a task, every
task maps to real source, groups are acyclic, and the first ready group has no
placeholder, unresolved decision, or blocked task. Derive precise counts from
source or omit them. Finish by naming the first ready group and anchors; do not
start `/change`, Land, commit, push, or open a PR.
