import { canonicalJson } from "../core/trust.mjs";

export const ADAPTERS = new Set([
  "command", "test-discovery", "playwright", "contract-digest", "benchmark", "external"
]);

export const INPUT_MODES = new Set([
  "browser-automation", "dom-event", "os-input", "both"
]);

export const PROVIDER_CONTRACTS = {
  "test": "Executable behavioral checks for the declared claim.",
  "discovery": "Expected tests were found and the discovered count meets the floor.",
  "browser": "Rendered behavior in a real browser with the required input capability.",
  "mutation": "A deliberate behavioral fault is detected by the evidence suite.",
  "changed-quality": "Changed functions meet complexity, coverage, and CRAP-score policy without regressing from their baseline.",
  "state-identity": "State before, during, or after the change belongs to the intended actor and revision.",
  "integration": "Multiple components or external boundaries work together.",
  "compatibility": "Public or persisted contracts remain compatible across supported versions.",
  "performance": "Measured latency, throughput, resource, or size budgets are met.",
  "concurrency": "Concurrent and asynchronous paths keep their ordering, isolation, and completion guarantees under contention.",
  "security-static": "Static security checks cover the changed trust boundary and unsafe sinks.",
  "cross-repo-contract": "Producer and consumer repositories agree on the same versioned contract.",
  "review": "Independent risk review covers the declared claims and unresolved findings.",
  "acceptance": "A named human accepts an explicitly subjective product or experience decision.",
  "semantic-acceptance": "A signed external oracle verdict covers every declared behavior partition without exposing hidden oracle content.",
  "static-analysis": "Compilation, type checking, linting, and applicable static quality gates pass.",
  "data-migration": "Schema or data evolution is forward-safe, backward-compatible, and rollback-aware.",
  "accessibility": "Rendered semantics, keyboard use, focus, contrast, and assistive access meet policy.",
  "resilience": "Timeout, retry, partial-failure, recovery, and degraded-dependency behavior is proven.",
  "observability": "Required logs, metrics, traces, and alerts expose success and failure safely.",
  "deployment": "Packaging, configuration, rollout health checks, and rollback behavior are proven.",
  "dependency-supply-chain": "Dependency vulnerability, license, lockfile, and provenance policy passes.",
  "evaluation": "A model or ranking evaluation reports a score at or above its declared threshold.",
  "release-health": "Post-release crash, error, and adoption signals stay healthy during rollout.",
  "parity": "The new implementation matches the reference behavior on the declared comparison set.",
  "plan-check": "An infrastructure or migration plan contains only the declared changes.",
  "experiment-guardrail": "Experiment guardrail metrics stay within their declared bounds after release."
};

// The adapter each capability defaults to. Pre-Land capabilities run as a
// project command; post-release capabilities are signals observed after
// release, so they are recorded from external evidence.
export const CAPABILITY_ADAPTERS = Object.freeze({
  concurrency: "command",
  evaluation: "command",
  parity: "command",
  "plan-check": "command",
  "release-health": "external",
  "experiment-guardrail": "external"
});

// When a capability's evidence exists. Absent means "pre-land": it gates
// proof and Land. "post-release" capabilities exist only after the change
// ships, so they are rollout gates recorded in the handoff and never block
// proof or Land.
export const CAPABILITY_PHASES = Object.freeze({
  "release-health": "post-release",
  "experiment-guardrail": "post-release"
});

export function capabilityPhase(capability) {
  return CAPABILITY_PHASES[capability] || "pre-land";
}

export function isPostReleaseCapability(capability) {
  return capabilityPhase(capability) === "post-release";
}

// Splits required provider names into the ones that gate proof and Land and
// the post-release rollout gates, which are deferred (neither failed nor
// pending). `providerCapability(name, config)` resolves each name.
export function splitPostReleaseProviders(required, providers = {}, capabilityOf = providerCapability) {
  const blocking = [];
  const rolloutGates = [];
  for (const provider of required || []) {
    const config = providers?.[provider];
    const capability = (config ? capabilityOf(provider, config) : null) || provider;
    if (isPostReleaseCapability(capability))
      rolloutGates.push({ provider, capability, phase: "post-release", status: "deferred",
        gate: "rollout" });
    else blocking.push(provider);
  }
  return { blocking, rolloutGates };
}

// A proof finalized before rollout gates existed has no rolloutGates field: it
// owes none, so readers see an empty list. `deferred` keeps only the gates the
// rollout still waits on (a waived capability is recorded, not owed).
export function proofRolloutGates(proof, { deferred = false } = {}) {
  const gates = Array.isArray(proof?.rolloutGates) ? proof.rolloutGates : [];
  return deferred ? gates.filter((gate) => gate?.status !== "waived") : gates;
}

// Machine-readable evaluation result: a command prints this JSON on stdout or
// writes it to its configured report. The claim passes only when
// score >= threshold; a provider-level `threshold` applies when the result
// omits one. Anything else (missing or non-numeric values) fails closed.
export const EVALUATION_PROTOCOL = "foundation-evaluation-v1";

export function evaluationResult(report, config = {}) {
  const number = (value) => (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
    ? Number(value) : null;
  // A result for another protocol is not this contract's score, so it fails
  // closed naming both; an omitted protocol keeps the documented shape.
  if (report?.protocol !== undefined && report.protocol !== EVALUATION_PROTOCOL)
    return { status: "fail", score: null, threshold: null,
      observed: `evaluation result protocol '${report.protocol}' is not ${EVALUATION_PROTOCOL}` };
  const score = number(report?.score);
  const threshold = number(report?.threshold ?? config?.threshold);
  if (score === null || threshold === null)
    return { status: "fail", score, threshold,
      observed: `evaluation result missing ${score === null ? "score" : "threshold"}` };
  const status = score >= threshold ? "pass" : "fail";
  return { status, score, threshold,
    observed: `evaluation score ${score} ${status === "pass" ? ">=" : "<"} threshold ${threshold}` };
}

export const PROVIDERS = new Set(Object.keys(PROVIDER_CONTRACTS));

// A provider command without timeoutMs gets ten minutes: long enough for an
// ordinary suite, so a slow suite is not reported as a broken one.
export const DEFAULT_PROVIDER_TIMEOUT_MS = 600000;

export function providerTimeoutMs(config) {
  return Number(config?.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS);
}

// The reason a timed-out provider failed, with the limit and where to raise it.
export function providerTimeoutDetail(provider, config) {
  return `timed out after ${providerTimeoutMs(config)}ms; raise providers.${provider}.timeoutMs ` +
    "in evidence.yaml when the command needs longer";
}

export function providerCapability(provider, config = null) {
  return config?.capability || (PROVIDERS.has(provider) ? provider : null);
}

// Capabilities whose contract a behavioral test run cannot establish by
// itself: static security analysis, failure injection, version compatibility,
// migration safety, and producer/consumer agreement.
export const SPECIALIST_CAPABILITIES = new Set([
  "security-static", "resilience", "compatibility", "data-migration", "cross-repo-contract"
]);

// Key order never distinguishes two values: `{ A: 1, B: 2 }` equals `{ B: 2, A: 1 }`.
const sameValue = (left, right) => canonicalJson(left ?? null) === canonicalJson(right ?? null);
const sameSet = (left, right) => sameValue(
  Array.isArray(left) ? [...left].sort() : left, Array.isArray(right) ? [...right].sort() : right);

// Everything that shapes how and where a command runs besides its argv. A
// specialist provider that differs in any of these (its own service, readiness
// probe, declared environment, timeout, resources, or ordering) runs in a
// context of its own, so it is not a repeat of the test run.
function sameExecutionContext(left, right) {
  return sameValue(left.repository, right.repository) &&
    sameValue(left.repositories, right.repositories) &&
    sameValue(left.env, right.env) && sameSet(left.envFrom, right.envFrom) &&
    sameValue(left.environment, right.environment) &&
    sameValue(left.service, right.service) && sameValue(left.readiness, right.readiness) &&
    providerTimeoutMs(left) === providerTimeoutMs(right) &&
    sameSet(left.resources, right.resources) && sameSet(left.dependsOn, right.dependsOn);
}

// The test provider whose execution a specialist provider merely repeats, or
// null. A command provider that runs exactly a test provider's argv, in the
// same repository and execution context, with no critical cases of its own,
// observes only those tests: its exit code says nothing about its own
// capability, so it must never be credited as that capability.
export function aliasedTestProvider(providers = {}, provider, config = providers?.[provider]) {
  if (!config || config.adapter !== "command" || !Array.isArray(config.command) ||
      !SPECIALIST_CAPABILITIES.has(providerCapability(provider, config)) ||
      (config.criticalCases || []).length) return null;
  for (const [name, other] of Object.entries(providers || {}).sort(([a], [b]) =>
    (a < b ? -1 : a > b ? 1 : 0))) {
    if (name === provider || providerCapability(name, other) !== "test" ||
        !["command", "test-discovery"].includes(other?.adapter)) continue;
    if (sameValue(other.command, config.command) && sameExecutionContext(other, config))
      return name;
  }
  return null;
}

// The configuration a provider that would only repeat a test run resolves
// to: never executed, naming what it repeated. While review is required the
// required set drops it and records it as `covered-by-review`; when review is
// waived it stays required and needs a project-owned command, verifiable
// external evidence, or its own waiver. Every other configuration is returned
// as is.
export function unobservedAliasConfig(providers, provider, config) {
  const aliasOf = aliasedTestProvider(providers, provider, config);
  if (!aliasOf) return config;
  return {
    adapter: "external",
    capability: providerCapability(provider, config),
    ...(config.claims !== undefined ? { claims: config.claims } : {}),
    ...(config.repository !== undefined ? { repository: config.repository } : {}),
    ...(config.repositories !== undefined ? { repositories: config.repositories } : {}),
    aliasOf
  };
}

// Every configured provider that only repeats a test run, sorted by name:
// `{ provider, capability, aliasOf }`. Review covers these capabilities.
export function reviewCoveredProviders(providers = {}) {
  return Object.keys(providers || {}).sort().flatMap((provider) => {
    const aliasOf = aliasedTestProvider(providers, provider);
    return aliasOf
      ? [{ provider, capability: providerCapability(provider, providers[provider]), aliasOf }]
      : [];
  });
}
