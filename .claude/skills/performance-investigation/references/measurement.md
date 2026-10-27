# Measurement details

## Scope and authority

A diagnosis is read-only investigation. Any instrumentation or repair inside an
active change follows the returned workspace and allowed paths. Production load,
paid evaluations, deployments, and data mutations require their own authority.
Never stop unrelated processes to make a benchmark quiet.

## Portable observation

Use tools already available in the project and operating system. On Linux,
CPU/core/load, I/O wait, and syscall counters may come from `nproc`, `uptime`,
`pidstat`, or `strace`. On macOS use `sysctl -n hw.logicalcpu`, `uptime`,
Activity Monitor, or project-supported Instruments captures. On Windows use the
available PowerShell/CIM counters or project-supported profiler. Tool absence is
a coverage gap, not a reason to invent a reading or install globally.

For JavaScript use the project's runtime profiler; for a query inspect its real
plan and rows; for memory include allocation, retained objects, GC, and restart.
Watch the load generator as well as the service. Profiles inform the hypothesis
but must not contaminate reported timing.

## Explain the number

Write the claim sentence before measuring: metric, workload, expected direction,
and the limiter it should move. Ask "why not double?" of every result: name the
resource or dependency that capped the gain. The verdict is inconclusive when
the run count, spread, or limiter is missing.

For repeated attempts toward a metric target, follow the
[hillclimb](hillclimb.md) procedure.

## Comparable work

Pin source revisions, lockfiles, toolchain, configuration, input sizes,
concurrency, cache state, and correctness checks. Before optimization capture
the same workload on the old implementation. Use release/production settings
for an adoption comparison. A settings mismatch measures configurations.

Alternate A/B rather than all A then all B. Include warmup separately; retain at
least five measured runs per side for a comparison. Report median, range, and
errors with units. If the gap is smaller than run variation, report no measurable
difference. Use stronger statistics when the project's measurement method
requires them. One requested ballpark run is labelled as one run and is not an
adoption verdict.

Check resource arithmetic and the maximum possible end-to-end benefit. Verify
that requests arrived, outputs are correct, rows were persisted, and lazy work
was consumed. Faster rejected requests are not a speedup.

## Report and recovery

State faster, slower, no measurable difference, or inconclusive with scope,
run count, spread, limiter, correctness results, artifact paths, and missing
coverage. Raw files remain outside managed skills; reference them from the
existing agreement/evidence where needed. If measurement setup is wrong,
repair the instrument before the product. Follow the harness's named repair
and resume routes; this report neither creates a receipt nor grants Land.
