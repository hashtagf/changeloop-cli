# Bisection

Reading code linearly is O(n); bisecting is O(log n) — a 200-commit regression is 8 steps, not 200. Almost *any* search space bisects, not just commits.

## The general shape

Works when: (1) there's a **search space** (commits, lines, fields, items, configs, versions); (2) you can **test any point** for a binary good/bad; (3) the answer is **monotonic** — flips once at a boundary, never back. Then find the boundary in log₂(n) steps.

## `git bisect` for regressions

### Manual
```bash
git bisect start
git bisect bad                    # current commit is broken
git bisect good <known-good-sha>  # this commit was fine
# git checks out the midpoint → run repro → mark good/bad:
git bisect good   # or: git bisect bad
# repeat until "<sha> is the first bad commit"
git bisect reset
```

### Automated (preferred) — script exits 0=good, non-zero=bad
```bash
git bisect start <bad-sha> <good-sha>
git bisect run ./scripts/repro.sh   # 0=good, non-zero=bad, 125=skip
git bisect reset
```

### Script anatomy
```bash
#!/usr/bin/env bash
# repro.sh — exit 0 if bug absent, 1 if present, 125 if untestable here
set -u
make build > /dev/null 2>&1 || exit 125   # build broke → skip
./run-repro.sh > /dev/null 2>&1
case $? in
  0) exit 0 ;;   # bug not present → good
  1) exit 1 ;;   # bug present → bad
  *) exit 125 ;; # weird → skip
esac
```
**125 = skip** (build broken, infra missing) — use when the test is *uninformative*, not when the bug is absent.

### Pitfalls
- **Repro must be deterministic** — a flake inside `git bisect run` marks random commits bad. Get to ~100% first.
- **Inverted** (finding when a bug was *fixed*) — swap good/bad, or use `--term-old`/`--term-new`.
- **Lockfile/submodule drift** — bisecting across a lockfile update runs old code on new deps; rebuild deps each step or pin.
- **Slow builds** kill velocity (log₂(n) *full builds*) — cache or test a pre-built artifact.
- **Refactor commits** break intermediate builds — `git bisect skip` them.

## Bisect inside one commit — where in the code?

Print at the midpoint of the suspect call stack:
```ts
function chargeOrder(order) {
  validate(order)
  console.log('after validate:', order.total)   // ← midpoint
  const taxed = applyTax(order)
}
```
Already wrong at the midpoint → bug upstream; still right → downstream. Move the log, repeat. 3–4 logs pinpoint the line.

## Bisect inputs — which field?

40-field payload fails, 5-field minimal passes. Bisect the extra fields:
```python
base = minimal_passing_payload
extra = failing_fields_not_in_base   # list of (key, value)
lo, hi = 0, len(extra)               # invariant: base+extra[:lo] passes, base+extra[:hi] fails
while hi - lo > 1:
    mid = (lo + hi) // 2
    if fails({**base, **dict(extra[:mid])}): hi = mid
    else: lo = mid
# trigger is extra[lo]
```
Same pattern for large files, long arrays, nested objects, API-call sequences.

## Bisect dependencies / flags

- **Which version?** Pin the lockfile, revert entries in halves, test each; the failing half has the culprit. Single suspect package → `git bisect` *its* repo between working and broken versions.
- **Which flag?** All-on = bug, all-off = no bug → turn off half; still present → it's in the on-half, else the off-half. `log₂(20) ≈ 5` flips, not 2²⁰ combos.

## When bisection doesn't apply

- **Multiple bugs** — good/bad no longer monotonic; change the repro to target one bug.
- **No known-good point** ("always been broken") — nothing to bisect against; log and search the call stack.
- **Data, not code** — bisect the data (which row/user?), not git history.

Every 500-line file or 200-commit log: ask *what binary question halves this?* Almost always there is one.
