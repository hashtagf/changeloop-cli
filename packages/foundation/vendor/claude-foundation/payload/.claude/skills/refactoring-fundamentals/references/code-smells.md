# Code smells — the catalog

A code smell is a surface symptom that *usually* points to a deeper structural problem. A smell is not a bug and not automatically wrong — it's a prompt to look closer and decide whether a refactor pays off (principle 5). Use this catalog to name *why* before you touch anything.

Each entry: what it looks like → why it costs you → the refactoring move(s) that resolve it (see `catalog.md` for mechanics).

Moved from `SKILL.md` — principles 5 and 6's full detail: refactoring with a purpose, and knowing when not to.

## Principle 5 (from SKILL.md): Refactor with a purpose — let smells and upcoming change drive it

**Rule:** Don't refactor for its own sake. Refactor when a *code smell* is actively costing you, or to *prepare* for a change you're about to make — "make the change easy, then make the easy change."

**Why:** Refactoring costs time and risk; without a purpose it's gold-plating. The payoff is real only when the code is what you keep paying to work around. The highest-leverage moment is *preparatory* refactoring — separating the restructure (safe, tested) from the behavior addition (new behavior, new tests), making both simpler than forcing a feature onto an awkward design.

**How to apply:**
- Name the trigger before you start: which smell, or which upcoming change does this enable? "It felt messy" is not a trigger; "Shotgun Surgery — every new payment type edits six files" is. The smell→move map is in `references/code-smells.md`.
- Preparatory refactoring: when about to add feature X, ask "what shape would make X trivial?" Refactor to that shape first (commit), then add X (commit). Two clean diffs beat one tangled one.
- Opportunistic tidying (the Boy Scout rule) is fine *in small doses and the right hat* — a rename or an extract you pass through. Anything bigger than a "tidying" gets its own planned, committed step, not a drive-by.
- Apply the Rule of Three: duplication is cheap to tolerate twice; the third occurrence earns the extraction.

**Example:**
```
Task: add a "gift card" payment method.
Naive: bolt a 7th case onto the same six switch statements scattered across the codebase (Shotgun Surgery gets worse).
Prepared: first refactor the six scattered switches into one PaymentMethod strategy (behavior identical, suite green, commit).
          THEN add GiftCard as one new strategy class (new behavior, new test, commit). The feature became a one-file change.
```

## Principle 6 (from SKILL.md): Know when NOT to refactor

**Rule:** Refactoring is a tool, not a virtue. Don't do it when the payoff is absent or the risk is unmanaged: code about to be deleted, a hard deadline with no test net, or a change so large it's really a rewrite in disguise.

**Why:** Restructuring code you're about to delete is waste. Refactoring untested, tangled code under deadline without a characterization net turns a working-but-ugly system into a broken one. "Let's just rewrite it properly" discards hard-won correctness, takes far longer than estimated, and usually produces a new mess. Knowing when to leave code alone matters as much as knowing how to change it.

**How to apply:**
- Skip it when: the code is scheduled for deletion; it's stable and rarely touched (refactor what costs you *weekly*, not what merely offends you); or you're against a deadline and the safety net doesn't exist yet — note the debt, schedule it, move on.
- Refactor vs rewrite test: if you're *estimating effort* on a batch of changes rather than making mechanical green-to-green moves, it's a rewrite. Default to incremental (principle 7) — reserve true rewrites for when the platform/language is genuinely a dead end.
- No tests + no time + must-change code: build the *minimum* characterization net around just the change point (find a seam), make the change, defer the broader cleanup.

**Example:**
```
"This module is ugly, let's rewrite it." → It's 4 years old, handles 30 edge cases encoded in 30 past bug fixes, and is touched
twice a year. A rewrite re-opens all 30. Decision: leave it. Refactor the module you touch every sprint instead.
```

## How to use this

1. You're about to refactor, or you're reading code that's hard to change. Find the smell that matches.
2. Confirm it's *costing* you — frequent edits, repeated bugs, slow comprehension. A smell in a stable backwater you never touch is not worth fixing (principle 6).
3. Apply the mapped move in small green steps.

---

## Bloaters — things that grew too big

**Long Function / Method.** A function you must scroll to read, or that has comment-delimited "sections." → Hard to name, hard to test, hides multiple jobs. **Move:** Extract Function (each section → a named function); Replace Temp with Query; Decompose Conditional; Split Phase when it does "compute then act."

**Large Class / God Object.** One class with dozens of fields and methods doing several jobs. → Low cohesion, every change risks unrelated behavior. **Move:** Extract Class (group fields that change together); Extract Superclass/Subclass; extract a strategy.

**Long Parameter List.** Four+ parameters, or booleans that select behavior. → Call sites are unreadable and easy to misorder. **Move:** Introduce Parameter Object (params that travel together → one type); Preserve Whole Object; Replace Parameter with Query; split a flag-driven function into two.

**Data Clumps.** The same three or four fields appear together in many places (`startDate, endDate`; `x, y, z`; `street, city, zip`). → The grouping is a missing concept. **Move:** Introduce Parameter Object / Extract Class to give the clump a name (`DateRange`, `Point`, `Address`). Ties to [[programming-fundamentals]] principle 1 (model the data first).

**Primitive Obsession.** Strings/ints standing in for domain concepts with rules (a `string` email, an `int` representing cents, a status code). → Validation scattered, illegal values representable everywhere. **Move:** Replace Primitive with Object / typed wrapper; Replace Type Code with Subclasses or Polymorphism. This is the constructive twin of [[programming-fundamentals]] principle 2 (make illegal states unrepresentable).

---

## Object-orientation abusers — inheritance/polymorphism used wrong

**Switch / Type-Code Statements.** A `switch` (or if/else chain) on a type field, *repeated* in several places. → Adding a new case means hunting down every switch (see Shotgun Surgery). **Move:** Replace Conditional with Polymorphism; Replace Type Code with Subclasses; Introduce Special Case / Null Object for the "missing" case.

**Repeated Switches.** The same conditional logic duplicated across the codebase. → The classic driver for a strategy/polymorphism refactor. **Move:** consolidate to one place, then Replace Conditional with Polymorphism.

**Temporary Field.** A field set only in certain circumstances, null otherwise. → Readers can't tell when it's valid. **Move:** Extract Class for the field + the code that uses it; Introduce Special Case.

**Refused Bequest.** A subclass uses little of what it inherits, or overrides to throw. → The hierarchy is wrong. **Move:** Push Down Method/Field; Replace Subclass with Delegate; prefer composition.

---

## Change preventers — one change forces many edits

**Divergent Change.** One module changes for many *different* reasons (add a payment type → edit it; change the report format → edit the same class). → Low cohesion; you can't reason about why it changes. **Move:** Split the module along the axes of change — Extract Class per reason. One module, one reason to change.

**Shotgun Surgery.** The opposite: one logical change forces small edits across many modules (add a payment type → touch six files). → High coupling; easy to miss a spot. **Move:** Move Function/Field to gather the scattered behavior into one place; Combine Functions into Class. This is the prototypical *preparatory refactoring* trigger (principle 5).

**Parallel Inheritance Hierarchies.** Every time you add a subclass to one hierarchy, you must add one to another. → A special case of Shotgun Surgery. **Move:** collapse by moving one hierarchy's reference into the other.

---

## Dispensables — things that add no value

**Duplicated Code.** The same expression/structure in more than one place. → Every fix must be applied N times; one gets missed. **Move:** Extract Function (same method); Pull Up Method (sibling classes); Extract Class. Apply the **Rule of Three** — tolerate it twice, extract on the third.

**Dead Code.** Unreachable or never-called code, unused parameters. → Pure cognitive tax; readers assume it matters. **Move:** delete it (version control is your history). Remove the parameter, the branch, the class.

**Speculative Generality.** Abstraction "for when we need it" that nobody uses — unused hooks, single-implementation interfaces, configurable things that are never configured. → Carrying cost with no payoff. **Move:** Inline the abstraction; Collapse Hierarchy; Remove Parameter. (Prevention: [[coding-discipline]] — build the minimum the task needs.)

**Comments (as deodorant).** A comment explaining *what* a confusing block does. → Often masks code that should be clearer. **Move:** Extract Function with an intention-revealing name; the function name replaces the comment. (Keep comments that explain *why* — those aren't a smell.)

**Lazy Element.** A class/function that isn't doing enough to justify its existence. → Indirection with no benefit. **Move:** Inline Function / Inline Class; Collapse Hierarchy.

---

## Couplers — excessive coupling between modules

**Feature Envy.** A method more interested in another object's data than its own (reaches through `other.a`, `other.b`, `other.c`). → Logic lives away from its data. **Move:** Move Function to the class that owns the data; Extract Function then move the envious part.

**Inappropriate Intimacy.** Two classes reaching deep into each other's internals. → Can't change one without the other. **Move:** Move Function/Field; Change Bidirectional Reference to Unidirectional; Extract Class for the shared concern.

**Message Chains.** `a.getB().getC().getD().doThing()`. → The caller is coupled to the whole navigation structure (Law of Demeter violation). **Move:** Hide Delegate; Extract Function for the chain.

**Middle Man.** A class that only delegates to another — most methods are one-line forwards. → Useless indirection. **Move:** Remove Middle Man (talk to the real object); Inline Function.

---

## Pointers

- Mechanics for every move: `catalog.md`.
- Deciding *whether* the smell is worth fixing (payoff vs about-to-be-deleted/stable-backwater): principle 6 above ("Know when NOT to refactor").
- A smell that signals a missing *concept* (Data Clumps, Primitive Obsession) is a [[programming-fundamentals]] data-modeling fix — this catalog routes you there; that skill says what the better shape is.
