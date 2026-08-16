export const ADAPTERS = new Set([
  "command", "test-discovery", "playwright", "contract-digest", "external"
]);

export const INPUT_MODES = new Set([
  "browser-automation", "dom-event", "os-input", "both"
]);

export const PROVIDER_CONTRACTS = {
  "test": "Executable behavioral checks for the declared claim.",
  "discovery": "Expected tests were found and the discovered count meets the floor.",
  "browser": "Rendered behavior in a real browser with the required input capability.",
  "mutation": "A deliberate behavioral fault is detected by the evidence suite.",
  "state-identity": "State before, during, or after the change belongs to the intended actor and revision.",
  "integration": "Multiple components or external boundaries work together.",
  "compatibility": "Public or persisted contracts remain compatible across supported versions.",
  "performance": "Measured latency, throughput, resource, or size budgets are met.",
  "security-static": "Static security checks cover the changed trust boundary and unsafe sinks.",
  "cross-repo-contract": "Producer and consumer repositories agree on the same versioned contract.",
  "review": "Independent risk review covers the declared claims and unresolved findings.",
  "acceptance": "A named human accepts an explicitly subjective product or experience decision.",
  "static-analysis": "Compilation, type checking, linting, and applicable static quality gates pass.",
  "data-migration": "Schema or data evolution is forward-safe, backward-compatible, and rollback-aware.",
  "accessibility": "Rendered semantics, keyboard use, focus, contrast, and assistive access meet policy.",
  "resilience": "Timeout, retry, partial-failure, recovery, and degraded-dependency behavior is proven.",
  "observability": "Required logs, metrics, traces, and alerts expose success and failure safely.",
  "deployment": "Packaging, configuration, rollout health checks, and rollback behavior are proven.",
  "dependency-supply-chain": "Dependency vulnerability, license, lockfile, and provenance policy passes."
};

export const PROVIDERS = new Set(Object.keys(PROVIDER_CONTRACTS));

export function providerCapability(provider, config = null) {
  return config?.capability || (PROVIDERS.has(provider) ? provider : null);
}
