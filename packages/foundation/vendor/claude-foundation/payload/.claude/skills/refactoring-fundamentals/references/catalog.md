# The refactoring catalog — moves and mechanics

Named refactorings are the vocabulary of principle 4 (small reversible steps). Each is a transformation with a *tested sequence of micro-steps* that never leaves the code red. Prefer named moves over freehand edits, and prefer your IDE/LSP's automated version when available.

**Golden rule under every move: run the tests after each micro-step; commit when green.** If a step reddens the suite, undo that one step — never push through.

## Principle 4 (from SKILL.md): Small reversible steps, green between every one

**Rule:** Move in the smallest behavior-preserving steps the catalog offers — Extract Function, Inline, Move, Rename, Replace Conditional with Polymorphism — running the tests after each and committing per step. Refactoring is a sequence of tiny safe moves, not one big edit.

**Why:** Named moves are mechanical transformations with known mechanics; done one at a time with a green run between, a mistake is caught instantly and the diff is trivial to undo. This is the bright line between refactoring (code stays working at every step) and rewriting (throws away correctness, re-discovers every edge case). If you're estimating effort across a batch of changes, that's a rewrite — treat it as principle 7.

**How to apply:**
- Prefer the catalog's named moves over freehand edits — they have a tested sequence of micro-steps that never goes red. See `references/catalog.md`.
- Run the test suite (or the affected subset) after each move. Commit when green. A refactor branch should be green at every commit, never "green again by Friday."
- Lean on automated refactorings (IDE/LSP rename, extract) when available — they're behavior-preserving by construction and faster than hand-editing.
- If a single step can't be made small and safe, you're missing a precursor step (often a characterization test or a seam). Add it first.

**Example:**
```
Goal: replace a 6-branch type-code switch with polymorphism.
Steps (green after each, one commit each):
  1. Extract the switch into its own method.   2. Introduce the subclass hierarchy (empty overrides).
  3. Move one branch into its subclass.  4. …repeat per branch…  5. Make the base method abstract.
Each step is reversible; if step 3 reddens the suite, you undo one tiny commit, not a day's work.
```

## Contents
- Composing functions (Extract, Inline, Extract Variable, Replace Temp with Query, Split Phase)
- Moving things (Move Function/Field, Extract Class, Inline Class)
- Data & types (Introduce Parameter Object, Replace Primitive with Object, Replace Magic Literal)
- Simplifying conditionals (Decompose Conditional, Guard Clauses, Replace Conditional with Polymorphism, Null Object)
- API shape (Rename, Separate Query from Modifier, Parameterize Function)

---

## Composing functions

### Extract Function
The workhorse. Turn a fragment into a named function.
**When:** a block needs a comment to explain it; a fragment is duplicated; a function is too long.
**Mechanics:** 1) Create a new function named for *intent* (what, not how). 2) Copy the fragment in. 3) Check for variables the fragment reads (→ parameters) and writes (→ return values; if more than one is written, extract a smaller piece or return an object). 4) Replace the original fragment with a call. 5) Test.

### Inline Function
The inverse — when the body is as clear as the name, or indirection isn't earning its keep (Middle Man, Lazy Element).
**Mechanics:** 1) Confirm it isn't polymorphic (don't inline an override). 2) Replace each call with the body. 3) Delete the function. 4) Test after each call site.

### Extract Variable / Inline Variable
Name a sub-expression to explain it (`const isEligible = age >= 18 && hasConsent`). Inline when the name adds nothing.
**Mechanics (extract):** introduce an immutable local, copy the expression, replace occurrences one at a time, test.

### Replace Temp with Query
A local variable computed from other state → a function, so the value is available everywhere and the extracted code below it has fewer locals to thread.
**When:** precedes Extract Function on a long method full of temps — it shrinks the parameter/return tangle.

### Split Phase
Separate "compute" from "act," or one kind of processing from another, into sequential phases with a clear intermediate data structure.
**When:** a function does X then uses X's result to do Y, and the two are entangled. Splitting makes each phase independently testable. (Realizes [[programming-fundamentals]] principle 4, pure core / effectful shell: load → compute → write.)

---

## Moving things

### Move Function / Move Field
Relocate a function or field to the class/module it actually belongs with.
**When:** Feature Envy (it uses another object's data more than its own); to gather Shotgun-Surgery'd behavior into one home.
**Mechanics:** 1) Check what it references in the source context. 2) Copy to the target, adapt. 3) Turn the source into a delegating call or redirect callers. 4) Test. 5) Remove the original when no caller needs it.

### Extract Class
Split a class doing two jobs into two classes.
**When:** Large Class, Divergent Change, a Data Clump or Temporary Field that wants its own home.
**Mechanics:** 1) Create the new class. 2) Move the related fields (Move Field). 3) Move the methods that use them (Move Function), innermost first. 4) Review both classes' interfaces. 5) Test throughout.

### Inline Class
The inverse — a class no longer pulls its weight; fold it into its main user.

---

## Data & types

### Introduce Parameter Object
Replace a recurring group of parameters/fields with a single object.
**When:** Long Parameter List, Data Clumps. `(startDate, endDate)` → `DateRange`. The new type becomes a home for related behavior (`range.contains(d)`), which often pulls in Feature-Envy logic from elsewhere.

### Replace Primitive with Object
A primitive that has rules or behavior → a small class/typed wrapper.
**When:** Primitive Obsession. `string email` → `Email` (validates in its constructor); `int` cents → `Money`. The constructor enforces the invariant once — the constructive form of [[programming-fundamentals]] principle 2.

### Replace Magic Literal
A bare `0.1`, `"ADMIN"`, `86400` → a named constant. Cheap, high readability payoff.

---

## Simplifying conditionals

### Decompose Conditional
Extract the condition, the then-branch, and the else-branch into named functions: `if (isSummer(date)) charge = summerRate(qty) else charge = winterRate(qty)`. The structure stays; the intent becomes legible.

### Replace Nested Conditional with Guard Clauses
Flatten `if (ok) { if (ok2) { … } }` into early returns for the exceptional cases, leaving the main path un-indented.
**When:** arrow-shaped code; a function where the "real" work is buried three indents deep.

### Replace Conditional with Polymorphism
A `switch`/if-chain on a type code → a method per subclass (or strategy).
**When:** Repeated Switches, Switch Statements smell. This is the highest-value conditional refactor and the canonical multi-step example.
**Mechanics:** 1) Extract the switch into its own method if it isn't already. 2) Create the subclass/strategy structure. 3) Move **one** branch into its type's override; test. 4) Repeat per branch, one commit each. 5) Make the base method abstract once every branch has moved. Each step is green and reversible.

### Introduce Special Case / Null Object
Replace repeated `if (x == null)` / `if (x == MISSING)` checks scattered across callers with a special-case object that responds sensibly to the same messages.
**When:** the same null/absent check appears in many places. Removes a class of NPEs and the duplicated guards.

---

## API shape

### Rename (Function / Variable / Field)
The cheapest high-value move — a name that states intent. Almost always automatable via LSP rename (safe across all references).
**When:** the name lies, hedges, or abbreviates. See [[programming-fundamentals]] naming reference for what a good name is.

### Separate Query from Modifier
Split a function that *returns a value and also* has a side effect into a pure query + a separate command.
**When:** a "get" that also mutates (Command-Query Separation violation). Makes the query safe to call freely and the mutation explicit. (Ties to [[programming-fundamentals]] principle 3.)

### Parameterize Function / Remove Flag Argument
Merge near-identical functions by adding a parameter; *or* split a boolean-flag function (`setReadOnly(true/false)`) into two intention-named functions (`makeReadOnly()`, `makeWritable()`).

---

## Pointers
- Which smell calls for which move: `code-smells.md`.
- Doing these safely with no test net: `characterization-tests.md` (cover first).
- Sequencing many of these into a large change without a long branch: `large-scale.md`.
