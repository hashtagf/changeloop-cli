---
name: refactoring-fundamentals
description: Reshape existing code while preserving observable behavior. Use for extract, move, rename, split, consolidate, deduplicate, untangle, or legacy restructuring when the requested outcome is structural rather than behavioral. Characterize untested behavior first and work in reversible green steps. Skip greenfield features, bug fixes, formatting-only work, and code scheduled for deletion.
---

# Refactoring fundamentals

Use this process skill before the construction skill that defines the target
shape.

## Rules

1. State the behavior-equivalence claim. If outputs, validation, errors, or
   externally visible effects change, separate that feature/fix from refactoring.
2. Capture a green baseline. If touched behavior lacks coverage, add a focused
   characterization or golden-master test before moving it.
3. Name the purpose: an observed smell or an imminent change made difficult by
   the current shape. Do not refactor from taste alone.
4. Apply one named, reversible move at a time and rerun the narrowest trustworthy
   check between moves.
5. Keep behavior-preserving and behavior-changing commits separate; do not edit
   expected assertions to make a structural change pass.
6. Keep large work shippable with Mikado, branch-by-abstraction, strangler, or
   expand-migrate-contract sequencing. Avoid flag-day rewrites.
7. Stop when the stated structural obstacle is removed. Leave unrelated cleanup
   for another change.

## Harness handoff

Record the equivalence claim, touched behavior, baseline provider, ordered
structural slices, and rollback point in the active OpenSpec change/tasks. Use
the harness receipts to prove the same behavior on the exact workspace; do not
create a second refactor ledger.

## Check before finishing

- Did the baseline pass before the first structural edit?
- Is each step reversible and behavior-preserving on its own?
- Does the target shape follow the owning construction skill?
- Are changed assertions evidence of an intentional separate behavior change?
- Can work stop safely after any completed slice?

References: read `refactoring-discipline.md` for equivalence/one-hat rules;
`characterization-tests.md` for legacy coverage; `code-smells.md` to diagnose;
`catalog.md` for safe moves; and `large-scale.md` for staged restructuring.
