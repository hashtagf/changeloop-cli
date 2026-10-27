// Declared work types and the shared light-work and behavior-neutral sets.
// Kept in contracts because Change validation (workflow) and test
// discrimination (evidence) both consume them.
export const WORK_TYPES = Object.freeze([
  "feature", "bugfix", "refactor", "api", "library", "ui", "data", "migration",
  "async", "integration", "config", "performance", "dependency", "deprecation",
  "infra", "observability", "privacy", "experiment", "client-release", "ml",
  "data-fix", "security", "cicd",
  "docs", "test", "chore"
]);

// Light work owes no design; behavior-neutral work's tests pass before and after.
export const LIGHT_WORK = new Set(["docs", "test", "chore"]);
// A dependency bump intends unchanged behavior, so no failing-before test can
// exist for it; its proof is the full regression suite plus supply-chain checks.
export const BEHAVIOR_NEUTRAL_WORK = new Set(["refactor", "config", "dependency", ...LIGHT_WORK]);
