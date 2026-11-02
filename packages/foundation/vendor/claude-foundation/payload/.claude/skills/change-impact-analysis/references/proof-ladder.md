# Proof ladder for impact claims

A plausible impact writeup reads the same whether or not it is true. Rank each
material safety fact by how far it was proven, and report that rank instead of
a confident summary.

## Find the load-bearing safety fact

Most changes that look risky are safe because of one fact, such as "this call
only discards entries that no reader can reach." Name that load-bearing safety
fact first. If it holds, most candidate risks clear together; if it fails, the
rest of the analysis is moot. Spend effort proving it with real code before
cataloguing unlikely risks.

## The five levels

1. **Someone said so.** A comment, a ticket, a teammate, or your own belief.
   Worth nothing alone; it only names what to check.
2. **Read the code.** A cited `file:line` in this repository or in the pinned
   dependency's own source shows the behavior.
3. **Found every consumer.** Callers plus what symbol search misses: persisted
   rows and files, serialized or wire formats, configuration and feature flags,
   other processes or languages reading the same bytes, and timing paths such as
   microtasks, teardown or unmount, retries, and redelivery. An empty search is
   a recorded answer, not an omission.
4. **Ran it through a project tool.** A test or script that calls the real code
   and fails loudly if the fact is wrong.
5. **Reproduced in the running application.** The failure case was driven
   through the real surface and did not occur.

Execution at levels 4 and 5 counts as evidence only through a harness provider
and its receipt. A pasted transcript or "I ran it" is level 1. Add the check to
the agreement's evidence contract so Prove executes it.

## Say where it stopped

For every material fact, report the highest level reached and why it stopped
there: cost, missing access, or no executable surface. Never call a risk
cleared from a lower level than the risk requires; a timing or persisted-data
risk is not cleared at level 2. Mark a fact unproven when it never left level 1
and feed it to the agreement as an assumption or open risk.

Report shape:

- **Safety fact** — statement, level reached, citation or provider.
- **Confirmed risks** — failure path, `file:line`, likelihood, cost, check.
- **Cleared** — what was checked, the level, and why it is fine.
- **Unproven** — what remains and the cheapest check that would settle it.
