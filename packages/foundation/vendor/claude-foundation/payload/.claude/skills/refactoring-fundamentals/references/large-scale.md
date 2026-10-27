# Large-scale refactoring

Keep each structural slice independently verifiable and compatible. Large
diffs do not justify weakening safety, creating a separate scheduler, or
mutating Git. For separately delivered slices use separately approved changes;
each delivery still ends at archived under its own Land authority.

## Mikado

1. Name the structural goal and equivalence check.
2. Try the smallest useful move within allowed Build scope.
3. Diagnose failures and identify prerequisites.
4. Undo only your exploratory edits, preserving baseline and other work.
5. Feed necessary dependencies into Change revision/amendment. Keep the
   discovery graph transient; tasks.md remains the sole implementation ledger.
6. Implement leaves first and verify each move.

The harness owns task checkboxes and dispatch. A dependency graph is design
analysis, not authorization to check off tasks, create workers, or commit.

## Branch by abstraction

Introduce a seam over the old implementation, verify equivalence, add the new
implementation behind it, migrate consumers in bounded slices, then remove the
old path after compatibility evidence. The term names an in-code technique;
it does not mean creating a Git branch.

## Strangler

Introduce a routing/facade boundary and migrate one supported capability at a
time. Keep data ownership, compatibility, rollback, and operational observation
explicit. Cross-process boundaries belong to architecture-fundamentals.
Production switching and rollout need their separate authority.

## Expand, migrate, contract

Add the new form alongside the old, migrate verified consumers, then remove
the old contract only after evidence supports removal. A local symbol search
does not establish that remote or persisted consumers have migrated.
Use change-impact-analysis for uncertainty and database-fundamentals for
backfill, locks, and schema compatibility.

Not every data migration is reversible. State the actual rollback or forward
recovery route and destructive point; never promise reversibility without
evidence.

## Completion

Keep each step green where possible, use flags only when they simplify safe
overlap, and separate structural changes from intentional behavior changes.
Check the actual changed surface and rerun invalidated checks. If no safe
sequence exists, treat the proposal as a rewrite and settle its risks in Change.

Build stays isolated; proof comes from configured providers; Land preserves
HEAD/index and leaves uncommitted target diffs. No daily merge or per-step
commit is required by this technique. Read installed WORKFLOW.md for delivery
and [catalog](catalog.md) for the local moves.
