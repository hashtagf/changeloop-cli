# Refactoring Discipline — Behavior Held Constant, One Hat

Moved from `SKILL.md` — principles 1 and 2's full detail: the behavior-equivalence contract and the one-hat-per-commit discipline.

## Common failure modes (from SKILL.md > Why this exists)

Refactoring turns into breaking when:

- Restructuring code that has no tests, then "it still looks right" ships a behavior change nobody noticed.
- One commit that *both* renames things *and* fixes a bug — unreviewable, impossible to revert selectively.
- A big-bang "rewrite this module properly" that's 80% done for three weeks while `main` can't ship.
- Refactoring for its own sake — gold-plating code that was about to be deleted.
- Calling it "refactoring" while actually changing behavior, so no one writes the test that would have caught the regression.

## Principle 1 (from SKILL.md): Refactoring changes structure, never behavior

**Rule:** A refactoring changes the internal structure of code without changing its observable behavior. If a change alters what the system *does* — a different output, a new validation, a fixed bug — it is not a refactoring, and it must not travel under that name.

**Why:** The entire safety argument rests on this: held-constant behavior means existing tests are sufficient and reviewers read the diff as "same thing, better shape." Smuggling a behavior change into a "refactor" voids both — tests no longer pin the new behavior, and the reviewer waves through a functional change they thought was cosmetic.

**How to apply:**
- Before you start, state the one-line behavior-equivalence claim: *what stays observably identical, and how you'll verify it.* If you can't state it, you don't yet know whether this is a refactor.
- If partway through you discover you *need* a behavior change, stop, finish or revert the refactor, and do the behavior change as its own separate, named, tested step (see principle 2).
- "Observable" means at the boundary that matters: same return values, same persisted state, same emitted events, same error behavior. Internal call shapes are exactly what you're allowed to change.

**Example:**
```
Refactor:  Extract a 40-line `calculateInvoice()` into four named helpers. Same totals, same rounding, same DB writes. ✓
Not a refactor: "While extracting, I also fixed the rounding to round half-up." ← that's a fix. It changes output.
               Ship the extraction first (behavior identical), then the rounding fix as its own commit with its own test.
```

## Principle 2 (from SKILL.md): Wear one hat at a time

**Rule:** At any moment you are *either* refactoring (changing structure, adding no functionality, touching tests only to keep them compiling) *or* adding/changing functionality — never both. Each commit wears exactly one hat.

**Why:** A pure-refactor commit is safe to review fast and safe to revert wholesale; a pure-behavior commit is where the test suite focuses. A mixed commit is the worst of both: nobody can tell which of 200 lines actually changed behavior, and rolling back the regression also loses the cleanup.

**How to apply:**
- One commit = one hat. Refactor commits say `refactor(...)`; behavior commits say `feat(...)`/`fix(...)`. The split is visible in history, not just in your head.
- When adding a feature reveals that the code needs reshaping first, swap to the refactoring hat, make the structure ready, commit that, *then* swap back and add the feature. That ordering is principle 5 (preparatory refactoring).
- If you catch yourself editing test *assertions* (not just signatures/imports) mid-refactor, that's a red flag — you're probably changing behavior. Stop and check which hat you're wearing.

**Example:**
```
Bad:  one PR "refactor auth + add SSO" — 600 lines, reviewer can't isolate the security-relevant change.
Good: PR 1 `refactor(auth): extract TokenVerifier port` (behavior identical, suite green).
      PR 2 `feat(auth): add SSO adapter behind TokenVerifier` (new behavior, new tests).
```

## Pointers
- The safety net that makes the equivalence claim checkable: `characterization-tests.md`.
- The named, mechanical moves to execute the restructure: `catalog.md`.
- Per-step commits and the delivery channel for the one-hat split: [[git-workflow]].
