# Bounded hillclimb

Use this when approved work must move one metric toward a target through
repeated attempts. Diagnosis without approved repair stays read-only.

## Stop predicate

Write the stop predicate before the first attempt: the target metric value
paired with a minimum attempt count, or a confirmed plateau. A plateau is
confirmed when consecutive attempts from at least two mechanism classes stay
inside run-to-run spread. Reaching the target early does not end the climb
before the minimum attempt count; running out of ideas is not a plateau.

## Freeze the harness

Before climbing, prove the measuring harness is sensitive: run two contrasting
workloads, such as small and large input or cold and warm cache, and confirm
the reported difference exceeds spread in the expected direction. A harness that
cannot separate them cannot judge an attempt. Then freeze it. Do not edit the
harness, workload, inputs, or correctness checks during the climb; a needed
harness repair ends the climb, and the new harness needs a fresh baseline.

## Order hypotheses by cost

Each hypothesis names the mechanism that should move the metric and the limiter
it targets. Try mechanisms in this order, cheapest first:

1. Skip the work entirely.
2. Do it once and reuse the result.
3. Do less of it.
4. Defer it until it is needed.
5. Move it off the waiting path.
6. Run independent parts concurrently.
7. Make each unit cheaper.

Test one hypothesis per attempt. A hypothesis without a mechanism is a guess;
profile again instead.

## Run each attempt

Change the workspace for one hypothesis, run correctness checks, then measure
with the frozen harness as described in [measurement details](measurement.md).
Keep the edit only when correctness holds and the gain exceeds spread;
otherwise revert it by editing the workspace back. Never keep a regression in
an unmeasured dimension such as memory or error rate.

Record every attempt, kept or reverted, as raw-run evidence outside managed
skills:

| Field | Content |
|---|---|
| id | Sequential attempt number |
| hypothesis | Mechanism and targeted limiter |
| change | Files and edit summary |
| before / after | Median, spread, and run count |
| delta | Change with units |
| correctness | Check results |
| verdict | kept, reverted, or inconclusive |

The attempt record is evidence, not version-control history and not lifecycle
state; the harness owns task status.

## Pivot on a plateau

When attempts in one mechanism class stop exceeding spread, re-profile and move
to the next class in the order above instead of tuning the same mechanism. If
every class plateaus below target, stop and report the limiter, best result, and
the remaining gap.

## Prove the final claim

The final improvement claim compares the original baseline with the kept state
through the harness: the `benchmark` provider or the project's own measurement
tool, never the attempt record alone. Paid or production workloads require
explicit authority.
