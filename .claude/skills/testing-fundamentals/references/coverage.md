# Coverage — Flashlight, Not Goal

Moved from `SKILL.md` — principle 7's full detail: using coverage to find untested code instead of chasing a percentage.

## Principle 7 (from SKILL.md): Coverage is a flashlight, not a goal

**Rule:** Use coverage to *find* untested code — especially uncovered branches on critical paths — not as a target to hit. A percentage is a floor and a diagnostic, never the objective.

**Why:** Coverage measures lines run, not whether tests asserted anything meaningful — 100% line coverage with no assertions is achievable. A coverage *target* distorts effort: the cheapest path to 85% is testing trivial code while the gnarly pricing branch stays dark. Used as a flashlight instead: the uncovered branches in important code are the real worklist. Branch coverage beats line coverage — the dangerous gap is usually the `else` you forgot, which line coverage counts as covered.

**How to apply:**
- Read the coverage *report*, not the coverage *number*. Look at which branches in important code are red, and write tests for the ones that matter.
- Prioritize uncovered branches on critical and error paths over chasing a percentage across trivial code.
- Prefer branch/condition coverage to line coverage for finding the real gaps.
- If you set a CI threshold, treat it as a ratchet that catches *drops* on changed code, not a bar that justifies testing trivia to clear it — the point is *don't ship changed logic nothing exercises*, not *pad the number*. (`/dev` applies exactly this as advisory per-level diff-coverage floors on the changed code; the floor numbers and escalation are `/dev` policy in `WORKFLOW.md`.) Read the report for the dark branches, then decide.
- 70% coverage of the hard logic beats 100% coverage that skips it.

**Example:**
```
Coverage report says 92% overall — looks great. Then you read it:

  pricing/discount.ts   54%   ← the branchy core is half-dark
  pricing/tier.ts       48%   ← the refund edge case is uncovered
  models/dto.ts        100%   ← trivial getters, padding the number

The 92% is a lie of averages. The flashlight says: write tests for the
two red files on the critical path; ignore the 100% on the DTOs.
```

## Pointers
- What to test once the flashlight finds a dark branch: `test-design.md`.
- Choosing the level for the new test: `test-doubles-and-levels.md`.
