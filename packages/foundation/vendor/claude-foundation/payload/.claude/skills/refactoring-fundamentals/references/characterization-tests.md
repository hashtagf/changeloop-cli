# Characterization tests — the safety net for changing untested code

This is the deep technique behind principle 3 and the home of the `/dev` **baseline-capture contract**. Drawn from Michael Feathers, *Working Effectively with Legacy Code*.

The core problem: you must change code that has no tests. You can't safely refactor without a net, and you can't write "correct" unit tests because you don't yet know what correct *is* — the code is the only spec. The resolution: stop asking "what *should* this do?" and pin "what does it *actually* do, right now?"

## Principle 3 (from SKILL.md): Get green before you touch; if there's no test, characterize first

**Rule:** Refactoring is only safe on top of a passing test that exercises the behavior you're about to move. If that behavior isn't covered, write a *characterization test* that pins its current actual behavior — including any bugs — before you change a line.

**Why:** The test is why you're allowed to restructure aggressively — it tells you after each step that behavior is still identical. Feathers' move for legacy code: "cover, *then* modify" — capture what the code *actually does* (not what it should do), make that the baseline, then refactor. Skipping this is the single biggest cause of refactors that silently break things.

**How to apply:**
- Covered already? Run the suite, confirm green, then refactor. Green-to-green is the loop.
- Uncovered? Before touching the code, write characterization tests: feed representative inputs, capture whatever the code returns/writes *now*, and assert that. A golden-master / snapshot test is the fast path when output is large. Pin the behavior even where it looks wrong — fixing it is a separate, later hat.
- Can't get the code under test because it's too tangled to instantiate? Find a *seam* — a place to break a dependency so you can call the unit in isolation — before you refactor the logic. The deep technique (seams, cover-and-modify, golden master) is in `references/characterization-tests.md`.
- In `/dev` this baseline is the brownfield **lock** step; when the workflow schedules characterization capture is owned by `WORKFLOW.md > Greenfield vs brownfield` (its understand → lock → change discipline) — don't restate it here.

**Example:**
```
Task: untangle a 200-line `exportReport()` with zero tests.
Wrong: start extracting functions immediately → no way to know if output changed.
Right: golden-master first — run exportReport on 5 saved fixtures, snapshot the exact bytes, assert them.
       NOW extract functions one at a time, re-running the snapshot after each. Any drift = you broke something. Found instantly.
```

## What a characterization test is

> A characterization test documents the **actual** behavior of a piece of code — not its intended behavior.

You feed the code representative inputs, observe whatever it currently produces (return value, persisted rows, emitted events, even the exact exception), and write an assertion that locks *that* in. The test now fails the moment behavior changes — which is exactly the signal a refactor needs.

Crucially: **pin the behavior even where it looks wrong.** If the code has a bug, the characterization test asserts the buggy output. You are not fixing anything yet (that would be a different hat — principle 2). You're building the net. Once the net is green, *then* you can decide to fix the bug as a separate, tested behavior change.

### When the baseline reveals a bug — the mechanism
Don't leave this at "a later hat" — pin it with a trace so it isn't lost:
1. Assert the wrong output as-is, and mark the assertion `// pinned-bug: <what's wrong>` — grep-able, mirrors the `ponytail:` marker.
2. **Never fix it inline in the refactor.** A behaviour change riding a refactor is exactly what the baseline exists to catch, and it makes the equivalence diff unreadable. Pin, mark, move on.
3. In `/dev`: `engineer` pins + notes it, `qa`'s Baseline verify treats a `pinned-bug:` assertion as *expected* (not a red to chase green), and `retro` appends the `fix` follow-up (`F-<run-id>-NN` — retro owns that counter, so engineer never mints the id). Fixing it later is its own `/dev fix` run whose regression test flips the pinned assertion deliberately. Outside `/dev`: pin, comment, file a ticket — same rule, lighter bookkeeping.

### Writing one when you don't know the expected value
A useful trick: assert a value you *know is wrong*, run the test, and let the failure message tell you the actual output. Then paste the actual value into the assertion. You've now characterized it.

```
test("exportReport characterization", () => {
  expect(exportReport(fixtureA)).toBe("PLACEHOLDER")   // run → failure prints the real output
})
// → "Expected PLACEHOLDER, got '2024-Q1|rev=10432|...'"  → lock that in:
  expect(exportReport(fixtureA)).toBe("2024-Q1|rev=10432|...")
```

## Golden master / approval testing

**Snapshot or hand-assert?** Hand-assert when the behaviour is a handful of semantically meaningful values — assert them directly; a targeted regression reads clearly and tells you *what* broke. Golden-master (snapshot the whole output) when it's large, opaque, or positional (a generated file, an HTML page, a big JSON blob, a report), where field-by-field asserts are unreadable. Reach back for hand-assert if a snapshot diff would be too coarse to localize the regression.

1. Run the code on a set of representative inputs (the more varied, the more behavior you pin).
2. Capture the full output to an approved/golden file.
3. The test re-runs the code and diffs against the golden file; any difference fails.
4. Refactor. The diff stays empty → behavior preserved. The diff shows exactly what drifted → you broke (or intentionally changed) something, visible to the byte.

This is the fastest way to throw a wide net around legacy behavior before a big restructure. Generate inputs broadly — random or combinatorial inputs often surface behavior you didn't know existed.

**Comparison precision (the Baseline contract's *how compared*).** A golden master is only as good as its diff. Before capturing, normalize what legitimately varies — timestamps, generated ids, map/set ordering, float rounding — or the master is flaky and every run cries wolf. State the comparison mode explicitly: **exact bytes** · **normalized** (which fields masked) · **numeric tolerance**. That statement *is* the `what · where · how compared` that `qa`'s Baseline contract asks for.

### Running one in practice (pick your stack's equivalent)
Characterization is a technique, not a library — every ecosystem ships a golden-master/approval mechanism; use it rather than hand-rolling file I/O:
- **JS/TS** — Jest/Vitest `toMatchSnapshot()` (inline/opaque) or `toMatchFileSnapshot()` / `jest-file-snapshot` for a real golden file; `approvals` (Node).
- **Python** — `syrupy` or `pytest --snapshot-update`; `approvaltests`.
- **Go** — golden files under `testdata/`, gated by a `-update` flag (`if *update { os.WriteFile(golden, got, 0o644) }`).
- **Java/.NET/others** — the `ApprovalTests.*` family.

**Where golden files live + the update rule:** commit the golden beside the test (`__snapshots__/`, `testdata/`, `*.approved.*`) so it's reviewed in the diff. Regenerating a golden (`-u`/`--update`) is a **reviewed, intentional behaviour change** — it does NOT bypass `qa`'s "never weaken an assertion to go green": an unexplained golden churn inside a refactor diff is a red flag, not a convenience. A changed golden either proves a behaviour change you meant (spec it) or one you didn't (a bug you just caught).

### The canonical shape (language-agnostic)
```
// arrange: representative fixtures (the more varied, the wider the net)
for (const fixture of fixtures) {
  const actual = subjectUnderChange(fixture)       // run the UNTOUCHED code
  expect(actual).toMatchGolden(`golden/${fixture.name}`)  // diff vs committed golden; -u regenerates
}
// a fixture whose golden is knowingly wrong → keep it, mark: // pinned-bug: <desc>
```
One golden per fixture, named by fixture — a failing case points straight at the input that drifted.

## Seams — getting tangled code under test at all

Often you can't even *call* the unit in isolation: it news up a database connection in its constructor, calls a global clock, hits the network. Feathers' concept:

> A **seam** is a place where you can alter behavior without editing in that place — and an **enabling point** is where you choose which behavior.

Seams are how you insert a test double to break the dependency that's stopping you from testing. Common kinds:
- **Object seam** (most useful in OO/typed code): the dependency is called through a method/interface you can override or inject. Extract the hard dependency behind a parameter or interface, pass a fake in the test. (This is a [[hexagonal-backend]] port in miniature.)
- **Preprocessing / link seam**: language-level substitution (build flags, link-time swaps, module mocking) when you can't change the call site cleanly.

Finding and exploiting a seam is itself a tiny, careful refactor — and one of the few you may have to do *without* a full net. Keep it minimal (e.g., "extract the `new Clock()` into a constructor parameter"), lean on automated/IDE moves, and change as little as possible to get the seam in.

**When even a seam is too risky — add tested code beside the untested code.** If breaking the dependency is itself a big change, don't cut it — grow next to it. Feathers' low-risk moves:
- **Sprout method/class** — write the new behaviour as a fresh, fully-tested function/class and call it from the old code with a one-line insertion. The legacy body stays untested; the new logic is born covered.
- **Wrap method/class** — rename the old method, add a new one under the original name that calls the old plus your step (or a wrapper/decorator class). You add behaviour *around* untested code without editing its body.
These buy a tested foothold when characterizing the whole unit up front is too expensive.

## The cover-and-modify workflow (the legacy change algorithm)

Feathers' loop:

1. **Identify change points** — where the new behavior or restructure must happen.
2. **Find test points** — where you can observe the effects.
3. **Break dependencies** — introduce seams so the code can run under a test harness (keep these edits tiny and mechanical).
4. **Write characterization tests** — cover the current behavior around the change point.
5. **Make changes and refactor** — with a net, apply the catalog moves in small green steps.

**Cover, then modify.** The temptation is to start changing immediately; that's exactly backwards.

## How much to cover

You don't need 100% — you need the behavior *that your change could affect*. Characterize the change point and its blast radius (what reads the same state, what the same function feeds). **In `/dev` that list already exists:** the brownfield **understand** step wrote every caller/blast-radius symbol with a `path#anchor` into `plan.md > Current state` — characterize *those*, and you've covered exactly what the change can reach, no more. A focused net you can build in an hour beats a comprehensive suite you never finish, and beats refactoring blind every time.

**Partial coverage is the common case.** Rarely is the *whole* blast radius untested — lean on the existing suite where it already exercises a touched symbol, and characterize only the **uncovered slice**. The baseline task fills the gap, it doesn't re-test what's already green; `qa` verifies the union (existing suite + new baseline) covers every blast-radius symbol before the change.

## The /dev baseline-capture contract

This technique is what the `/dev` workflow's refactor path operationalizes:
- **plan** (`lead`): when the touched behavior isn't already covered, `tasks.md` task 1 is "capture characterization baseline for `<behaviour>` at `path#anchor`."
- **implement** (`engineer`): write the characterization/golden-master tests first, confirm they pass on the unchanged code, commit them *before* the structural change.
- **test** (`qa`): verify a baseline existed and the refactor still satisfies it; *no baseline + uncovered behavior = blocking gap* (the equivalence claim is unverifiable). Recorded in `tests.md > Baseline`.

The before→after diff against that baseline is the proof the refactor preserved behavior — the whole point of principle 1.

## Pointers
- The moves you apply once covered: `catalog.md`.
- Sequencing a large, multi-day cover-and-modify effort while staying shippable: `large-scale.md`.
- Where the side-effect dependency *belongs* once you've seamed it out: [[hexagonal-backend]].
