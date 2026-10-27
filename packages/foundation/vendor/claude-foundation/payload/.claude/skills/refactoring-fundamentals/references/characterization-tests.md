# Characterization tests

Characterization records actual behavior before structural changes. It proves
equivalence over the tested surface, not that existing behavior is correct or
that every requirement is satisfied.

## Capture the baseline

1. Read the active agreement and trace touched consumers. Reuse existing tests
   that exercise the actual boundary; characterize only uncovered behavior.
2. Find observable outputs: returned values, persisted rows, serialized bytes,
   emitted events, and errors. Include relevant failure/concurrency cases.
3. Run representative fixtures on unchanged code in the allowed workspace.
   Define exact bytes, explicit normalization, or numeric tolerance before
   recording outputs. Mask only legitimate variation, never meaningful errors.
4. Add focused assertions or golden files beside the test and verify that the
   baseline passes for the intended reason. Keep outputs credential-free.
5. Apply small structural moves and rerun affected checks. A changed result is
   drift to investigate, not permission to regenerate the golden.

Hand assertions suit a few meaningful values; snapshots suit large structured
or positional outputs. Use the project's existing test tooling. Inspect a
placeholder failure's actual output before accepting it; the exception may
reflect broken setup instead of the behavior being characterized.

## Known defects

Label a known defect in the test and distinguish it from approved behavior.
Preserving it during a pure refactor does not resolve the defect. If fixing it
is already in scope, implement the intentional behavior change as a distinct
tested slice. Otherwise report the finding or propose a follow-up; do not
create tickets, retro IDs, or an alternative backlog without authority.
A security or correctness defect cannot be waived merely by pinning it.

## Seams and legacy code

Introduce the smallest seam needed to observe the behavior: inject a clock or
port, replace a link-time dependency, or use a focused adapter test. A seam
change is itself a risky edit; keep it mechanical and test what you can.
Do not replace the real boundary with a mock when claiming integration proof.

If a broad seam is too risky, sprout a tested helper or wrap the old method
with a minimal insertion. These are techniques for limiting the changed
surface, not a license to add unrelated functionality.

## Harness workflow

Planning records the equivalence claim, current-state anchors, affected
consumers, baseline check, and ordered slices in Change inputs. Revise before
Build or amend after it starts; never edit the compiled packet directly.
Implementation and local checks stay in returned Build paths. Golden files
are reviewed source changes, not instructions to commit.

The harness verifies tasks and binds provider receipts to the actual workspace.
A before/after comparison is supporting evidence; it cannot write proof or
replace a missing required provider. No lead/engineer/qa/retro role dispatch,
plan.md, tests.md, or secondary baseline ledger is created by this skill.

Read [catalog](catalog.md) for safe moves and
[large-scale](large-scale.md) for staged restructuring.
