---
name: testing-fundamentals
description: "Use when implementing a task whose requirement has scenarios to prove: write a failing-first test per scenario, especially boundary, error, and regression ones, and choose test level and doubles. Skip docs, pure renames, and other work with no behavior to prove; harness receipts establish proof."
---

# Testing fundamentals

A red test must fail for the predicted behavior, not setup errors. Exercise
the real user path.

Use this skill to translate a behavior or risk into trustworthy executable
evidence. The OpenSpec claim defines what must be true; this skill selects the
test design; the harness runs providers and binds receipts.

## Rules

1. Assert observable behavior—return, persisted state, emitted contract, or
   error—not private call order or implementation shape.
2. Use the cheapest level that can prove the claim: unit for local decisions,
   integration for real boundaries, contract tests between independently
   evolving components, and a few e2e tests for critical journeys.
3. Cover the contract, boundaries, failure paths, concurrency where relevant,
   and every shipped bug. Skip framework behavior and trivial accessors.
4. Double only at a real seam when the collaborator is slow, costly,
   nondeterministic, or outside scope. Use the real DB/protocol in the focused
   integration test that claims to prove that boundary.
5. Make tests isolated and deterministic: own state, inject time/randomness/IDs,
   avoid sleeps and order dependence, and clean resources reliably.
6. Give each test one behavioral reason to fail; use clear
   arrange-act-assert structure and behavior-named cases.
7. Use coverage to locate untested critical branches, not as a substitute for
   meaningful assertions or as a percentage-chasing target.

## Check before finishing

- Does each test map to a behavior, boundary, failure, or regression claim?
- Would a behavior-preserving refactor leave it green?
- Is the chosen level capable of proving the real risk?
- Does the test fail for the intended reason on the old/broken behavior?
- Can the configured project provider run it without hidden local state?

Do not create a parallel test plan or manual completion claim. Put durable
claims in OpenSpec and executable commands in the harness evidence contract.

References: read `test-design.md` for cases/assertions; `test-doubles-and-levels.md`
for level and seam choices; and `coverage.md` for coverage interpretation.
Use `debug-fundamentals` for reproduction and `refactoring-fundamentals` for
characterization-before-reshape.

For executable surface checks, read [verification drivers](references/verification-drivers.md).
