# Intake contract

Use this checklist before the single Decision Sheet.

## Read set

1. Read the complete PRD: changes, open questions, acceptance criteria,
   must-not-cut items, owner, and stated schedule.
2. Read the existing service backlog, decision table, follow-ups, and statuses.
3. Read service landscape, communication, data architecture, failure modes, then
   referenced ADRs and public contracts.
4. Inspect repository topology and follow the production call path.
5. Inspect helpers, fixtures, unit/integration/live providers, represented
   cardinality, and whether tests execute final wiring.
6. Read security-sensitive dependency source across all relevant error stages.
7. Trace dormant/legacy code being activated and compare its read, write, retry,
   replay, and error-classification semantics with the caller that will expose it.
8. For cross-service traffic, read the real producer, consumer, wire contract,
   delivery/retry/idempotency/ordering behavior, rollout, and rollback.
9. For operated runtime paths, read correlation/log/metric/trace conventions,
   alerts, dashboards, runbooks, and the operator question each signal answers.
10. Build a delivery authority matrix per environment: who may write cloud IAM
    and secrets, apply infrastructure, deploy/restart, and verify runtime health;
    whether merge is dark or auto-activating; and the authoritative runbook.

Targeted search may select files but does not replace reading a critical file or
call path. A fixture is not evidence of production composition without parity.

## Planning rules

- Split across repositories, independent deployments, external blockers, or
  unrelated acceptance stories. Put a spike alone.
- Prefer groups of one to four coherent tasks. A large task or new money/security
  flow normally stands alone.
- Map every acceptance criterion and must-not-cut item to a task.
- Map each task to real sources and each risk to failure source plus evidence
  class: static, unit, integration, live, review, or acceptance.
- High-risk composition/security claims name a production path and
  integration/live proof; record fixture gaps explicitly.
- Material test claims name stable critical case IDs and whether each oracle
  reaches production entry, real wire, contract parsing, or a failure path.
- Mutation claims name semantic mutants and the critical case that must kill
  each one; compile errors and non-applying mutants are not kills.
- Keep implementation in `tasks.md`. Declare every permission-bound operation
  in `handoffs.yaml` with owner, environment, required authority, timing,
  activation safety, evidence, runbook, rollback, and related task/claim IDs.
- `post-land + safe-before-activation` requires an activation-proof claim and a
  named accepted tracking reference before Land. All other incomplete external
  operations remain typed `WAITING_EXTERNAL` Land blockers.

## Backlog task fields

Record Topic, Description, Assignee, Due date, Sprint point, Depends on, Status,
observable completion, source anchors, risk, evidence class, production path,
and blocker owner. Use `TBD` for non-blocking scheduling data unless `--schedule`
requested it.

## Prohibited shortcuts

Do not re-ask sourced facts, run a one-question loop, launch a fresh-reader audit
loop, invent exact counts, ask for approval after writing the backlog, group a
blocked task with ready work, or begin implementation/review/publication.
