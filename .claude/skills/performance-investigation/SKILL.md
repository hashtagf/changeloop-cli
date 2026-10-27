---
name: performance-investigation
description: "Investigate measured latency, throughput, CPU, memory, or performance regressions. Use for slow paths, benchmark comparisons, or speedup claims. Establish representative baselines and explain limiting resources; use observability-fundamentals for telemetry design and debug-fundamentals for non-performance failures."
---

# Performance investigation

1. State the user-visible metric, workload, success/error counts, environment,
   versions, and whether the goal is diagnosis or an approved implementation.
2. Read the measurement code. Confirm real work and correct outputs occur inside
   the timed region; exclude no-ops, errors, and cache effects.
3. Capture comparable baselines. Tune both sides as deployed; alternate at
   least five runs per side for comparisons. Record spread and noise.
4. Profile separately from reported timing. Identify the limiter from observed
   counters or profiles and connect it to source. Check physical limits and
   the end-to-end share of any microbenchmark improvement.
5. Test one hypothesis at a time. Keep an improvement only when correctness
   holds and the result exceeds uncertainty. Otherwise report inconclusive.

Read [measurement details](references/measurement.md) for portable tools and
report fields. Keep raw runs as evidence, not a status ledger.
Diagnosis uses `investigate`; approved repair stays inside the returned Build
workspace. Project providers and harness receipts establish proof.
Never fabricate missing measurements, weaken a gate, or run paid workloads
without explicit authority.
