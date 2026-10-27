import { arch, cpus, platform } from "node:os";
import { environmentIdentity } from "./task-check-evidence.mjs";

// Benchmark evidence: a duration measured on head alone says nothing about
// whether the change made anything slower. The benchmark adapter runs the
// provider's own command on the base source (the test-discrimination scratch
// tree: base archive plus the change's non-product files) and on head,
// alternating base, head, base, head ... so machine drift lands on both sides,
// in one execution environment. It passes when every head run exits 0 and the
// head median is at most maxRegressionPercent slower than the base median. A
// base that cannot be built or run is no verdict and never blocks: the receipt
// records the comparison as unavailable and head exit codes decide.
export const BENCHMARK_VERSION = 1;
export const BENCHMARK_DEFAULT_RUNS = 5;
export const BENCHMARK_MIN_RUNS = 3;
export const BENCHMARK_DEFAULT_MAX_REGRESSION_PERCENT = 10;

export function benchmarkSettings(config = {}) {
  const runs = config?.runs === undefined ? BENCHMARK_DEFAULT_RUNS : config.runs;
  const maxRegressionPercent = config?.maxRegressionPercent === undefined
    ? BENCHMARK_DEFAULT_MAX_REGRESSION_PERCENT : config.maxRegressionPercent;
  const issues = [];
  if (!Number.isInteger(runs) || runs < BENCHMARK_MIN_RUNS)
    issues.push(`runs must be an integer of at least ${BENCHMARK_MIN_RUNS}`);
  if (typeof maxRegressionPercent !== "number" || !Number.isFinite(maxRegressionPercent) ||
      maxRegressionPercent < 0)
    issues.push("maxRegressionPercent must be a number of at least 0");
  return { runs, maxRegressionPercent, issues };
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round2 = (value) => Math.round(value * 100) / 100;

// Positive means head is slower. Null when the base median is not a positive
// duration, so a ratio would be meaningless.
export function regressionPercent(baseMedianMs, headMedianMs) {
  if (!(baseMedianMs > 0) || !Number.isFinite(headMedianMs)) return null;
  return round2((headMedianMs - baseMedianMs) / baseMedianMs * 100);
}

// null for a clean exit 0, otherwise why the run is not a measurement.
export function benchmarkRunFailure(result) {
  if (result?.timedOut) return "timed-out";
  if (result?.error || result?.status === null || result?.status === undefined)
    return "spawn-error";
  return result.status === 0 ? null : `exit-${result.status}`;
}

export function benchmarkComparison(baseSamples, headSamples, maxRegressionPercent) {
  const baseMedianMs = median(baseSamples);
  const headMedianMs = median(headSamples);
  const percent = regressionPercent(baseMedianMs, headMedianMs);
  if (percent === null)
    return { status: "unavailable", reason: "base-median-not-positive", baseMedianMs, headMedianMs };
  return {
    status: "compared", baseMedianMs, headMedianMs, regressionPercent: percent,
    maxRegressionPercent, regressed: percent > maxRegressionPercent
  };
}

// One descriptor: both sides run with the same environment on this machine.
export function benchmarkEnvironment(environment, stableHash) {
  const processors = cpus();
  return {
    platform: platform(), arch: arch(), node: process.version,
    cpuModel: processors[0]?.model || null, cpuCount: processors.length,
    identity: environmentIdentity(environment, stableHash)
  };
}

export function performanceRegressionFinding(provider, benchmark) {
  const comparison = benchmark?.comparison;
  if (comparison?.status !== "compared" || !comparison.regressed) return null;
  const { baseMedianMs, headMedianMs, regressionPercent: percent, maxRegressionPercent } = comparison;
  return {
    id: `${provider}:performance-regression`,
    provider,
    classification: "product",
    severity: "error",
    rootCause: "performance-regression",
    message: `provider '${provider}' head median ${headMedianMs}ms is ${percent}% slower than ` +
      `base median ${baseMedianMs}ms, above the ${maxRegressionPercent}% threshold; ` +
      "remove the slowdown so the head median stays within the threshold",
    baseMedianMs, headMedianMs, regressionPercent: percent, threshold: maxRegressionPercent,
    claimIds: [], criticalCaseIds: []
  };
}

// The regression finding a failed benchmark receipt carries, or null.
export function receiptRegressionFinding(provider, receipt) {
  return receipt?.status === "fail" && receipt.adapter === "benchmark"
    ? performanceRegressionFinding(provider, receipt.benchmark) : null;
}

function benchmarkObservation(benchmark, headFailure) {
  const { comparison } = benchmark;
  const runs = `${benchmark.headSamples.length}/${benchmark.runs} head run(s)`;
  if (headFailure) return `benchmark head run failed (${headFailure}) after ${runs}`;
  if (comparison.status !== "compared")
    return `benchmark comparison unavailable (${comparison.reason}); verdict from ${runs} exit 0`;
  return `benchmark ${benchmark.runs} alternating base/head runs; base median ${
    comparison.baseMedianMs}ms; head median ${comparison.headMedianMs}ms; regression ${
    comparison.regressionPercent}% (threshold ${comparison.maxRegressionPercent}%)`;
}

export function createBenchmarkRuntime({
  prepareBaseTree, isProductPath, fileDigest, runCommand, removeTree, stableHash
}) {
  // { status, benchmark, results, observed }. `results` are the head runs, in
  // order, for the execution log.
  async function measure({ config, workspace, baseHead, command, args, env, timeoutMs }) {
    const settings = benchmarkSettings(config);
    const benchmark = {
      version: BENCHMARK_VERSION, runs: settings.runs,
      maxRegressionPercent: settings.maxRegressionPercent, order: "alternating-base-first",
      baseHead: baseHead || null, baseSamples: [], headSamples: [], headExitCodes: [],
      environment: benchmarkEnvironment(env, stableHash), comparison: null
    };
    if (settings.issues.length) {
      benchmark.comparison = { status: "not-evaluated", reason: settings.issues.join("; ") };
      return { status: "error", benchmark, results: [],
        observed: `benchmark configuration invalid: ${benchmark.comparison.reason}` };
    }
    let unavailable = baseHead ? null : "no-base-head";
    let prepared = null;
    if (!unavailable) {
      try { prepared = prepareBaseTree(workspace, baseHead, isProductPath, fileDigest); }
      catch { prepared = null; }
      if (!prepared) unavailable = "base-tree-unavailable";
    }
    const options = (cwd) => ({ cwd, timeoutMs, env });
    const results = [];
    let headFailure = null;
    // One alternating round of `runs` base/head pairs into `round`.
    const measureRound = async (runs, round) => {
      for (let run = 0; run < runs && !headFailure; run += 1) {
        if (!unavailable) {
          const base = await runCommand(command, args, options(prepared.tree));
          const failure = benchmarkRunFailure(base);
          if (failure) unavailable = `base-${failure}`;
          else round.baseSamples.push(base.durationMs);
        }
        const head = await runCommand(command, args, options(workspace));
        results.push(head);
        round.headExitCodes.push(head?.status ?? null);
        headFailure = benchmarkRunFailure(head);
        if (!headFailure) round.headSamples.push(head.durationMs);
      }
    };
    const evaluate = (round) => headFailure
      ? { status: "not-evaluated", reason: `head-${headFailure}` }
      : unavailable ? { status: "unavailable", reason: unavailable }
        : benchmarkComparison(round.baseSamples, round.headSamples,
          settings.maxRegressionPercent);
    try {
      await measureRound(settings.runs, benchmark);
      benchmark.comparison = evaluate(benchmark);
      // A single noisy round must not hand the agent an unfixable repair: a
      // regression is confirmed by a fresh round with twice the runs, and the
      // confirmation decides the verdict. Both rounds stay in the receipt.
      if (benchmark.comparison.regressed) {
        const confirmation = { runs: settings.runs * 2, baseSamples: [], headSamples: [],
          headExitCodes: [], comparison: null };
        await measureRound(confirmation.runs, confirmation);
        confirmation.comparison = evaluate(confirmation);
        benchmark.confirmation = confirmation;
      }
    } finally {
      if (prepared) removeTree(prepared.scratch);
    }
    if (benchmark.confirmation) {
      benchmark.firstComparison = benchmark.comparison;
      benchmark.comparison = benchmark.confirmation.comparison;
    }
    const status = headFailure
      ? (headFailure.startsWith("exit-") ? "fail" : "error")
      : benchmark.comparison.regressed ? "fail" : "pass";
    return { status, benchmark, results, observed: benchmarkObservation(benchmark, headFailure) };
  }

  return { measure };
}
