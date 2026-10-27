# Coding Discipline — full rationale (pre-diet)

Verbatim/uncondensed text cut from `SKILL.md` when it was diet'd to fit the word budget. Nothing here is new; it's the fuller version of what the body now states compactly.

## Why this exists

Adapted from [Andrej Karpathy's observations on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876) (via the MIT-licensed [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)) and the [ponytail](https://github.com/DietrichGebert/ponytail) stance. The failure modes are **conduct** gaps, not knowledge gaps — the model already knows better but: makes silent wrong assumptions without checking, overcomplicates and bloats abstractions (1000 lines where 100 would do), and changes/removes code it doesn't understand as a side effect. This skill governs *how you show up to a code task*; the domain-fundamentals skills govern *what you build*. Run this as the stance check, then the layer-appropriate fundamental.

## 1. Think Before Coding — full rationale

**Why:** The most expensive LLM failure is picking one interpretation silently and running 200 lines down the wrong road. A 20-second clarification beats a 20-minute rewrite.

## 2. Simplicity First — full ladder text

**Why:** "Flexibility"/"configurability" nobody asked for is the most common self-inflicted complexity — a guess about a future that rarely arrives, and a tax on every reader until then.

Walk the **decision ladder** before writing — stop at the first rung that solves the *stated* problem, descend only when the rung above genuinely doesn't:
1. **Does it need to exist?** — if the stated problem doesn't require it, don't build it (principle 1's YAGNI, at code granularity).
2. **Does the standard library / language built-in solve it?** — reach for it before hand-rolling.
3. **Is there a native platform feature?** — the runtime, framework, or database may already do it.
4. **Does an already-installed dependency solve it?** — use what's in the lockfile before writing the code yourself. (Adding a *new* dependency is **not** a free rung — a dependency is its own complexity and trust boundary; [[security-fundamentals]] owns that call.)
5. **Can it be one line?** — the smallest correct expression wins.
6. **Only then** — write the minimum code that solves it.

**Lazy, not negligent:** the ladder trims *solution bloat*, never the trust-boundary validation, error/data-loss handling, authorization, or accessibility the task needs — those are required behaviour, not speculative extras. "One line" never means "skip the unhappy path." Mark a deliberate shortcut (stub, deferred generalisation, narrower-than-ideal impl) inline with a `ponytail: <upgrade path>` comment so the deferral is visible and harvestable, never silently lost.

Then, whatever rung you land on:
- No features, options, or config beyond what was asked. No error handling for impossible scenarios.
- No abstraction for a single call site. Inline first; extract only on the second real use.
- The test: *would a senior engineer call this overcomplicated?* If 200 lines could be 50, rewrite it.

**Defer to:** *write-time intent*. [[programming-fundamentals]] owns deeper code mechanics (complexity/Big-O, illegal states, pure core); `/simplify` owns the *post-hoc* cleanup pass on a diff. Don't pre-run the simplify catalog — just don't build the complexity.

## 3. Surgical Changes — full rationale

**Why:** Orthogonal edits — reformatting, "improving" a comment, refactoring code that wasn't broken — bloat the diff, bury the real change, and risk breaking code you didn't fully understand. Every changed line should trace to the request.

## 4. Goal-Driven Execution

**Why:** "Make it work" is unverifiable — you can't tell when you're done and the user becomes the test harness. A concrete criterion lets you iterate independently and *know* you've finished.

For multi-step work, write a brief plan where each step names its own verification:
```
1. [step] → verify: [check]
2. [step] → verify: [check]
```

**Defer to:** the *stance* lives here, the *machinery* elsewhere. In `/dev`, `qa` authors/runs tests and maps them to acceptance criteria. For a bug, [[debug-fundamentals]] owns "reproduce first, fix the cause, pin it with a regression test." Adopt the goal-driven framing; route actual verification to them.

## Relation to other skills

A thin **behavioral wrapper** that routes work to the skills owning each concern — it does not replace or re-teach them:

- [[brainstorming]] — the full ambiguity/scope conversation (principle 1 is its micro-version; escalate when design is genuinely open).
- [[programming-fundamentals]] — code mechanics (principle 2's intent → its concrete rules: illegal states, pure core, complexity).
- `/simplify` — post-hoc cleanup of a written diff (principle 2 prevents the mess; `/simplify` removes what slipped through).
- [[git-workflow]] — commits/branches/PRs (principle 3's surgical diffs make atomic commits possible).
- [[debug-fundamentals]] + `qa` agent — verification (principle 4 sets the stance; they author the tests).
