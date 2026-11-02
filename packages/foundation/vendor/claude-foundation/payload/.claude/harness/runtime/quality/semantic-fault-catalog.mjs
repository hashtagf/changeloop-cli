export const SEMANTIC_FAULT_CATALOG = Object.freeze({
  "application-js-ts": [
    "invert-condition", "remove-validation", "boundary-inclusive-exclusive",
    "skip-await", "replace-nullish-default", "drop-authorization-check"
  ],
  "application-go": [
    "ignore-returned-error", "invert-condition", "boundary-inclusive-exclusive",
    "skip-context-cancellation", "drop-lock", "drop-authorization-check"
  ],
  "application-python": [
    "invert-condition", "remove-validation", "boundary-inclusive-exclusive",
    "skip-await", "swallow-exception", "drop-authorization-check"
  ],
  "application-php": [
    "invert-condition", "remove-validation", "boundary-inclusive-exclusive",
    "skip-transaction", "swallow-exception", "drop-authorization-check"
  ],
  "script-bash": [
    "remove-errexit", "invert-exit-status", "remove-quoting",
    "skip-validation", "skip-cleanup", "remove-permission-check"
  ],
  "database-sql": [
    "remove-where", "change-join-kind", "skip-transaction", "remove-constraint",
    "reorder-migration", "skip-backfill", "boundary-inclusive-exclusive"
  ],
  "database-mongodb": [
    "remove-filter", "and-to-or", "remove-tenant-constraint", "remove-unique-index",
    "skip-schema-validation", "reorder-aggregation-stage", "skip-transaction"
  ],
  "web-markup": [
    "remove-label-binding", "remove-semantic-role", "break-keyboard-path",
    "remove-required-state"
  ],
  "web-style": [
    "remove-focus-indicator", "break-reduced-motion", "break-responsive-boundary",
    "replace-design-token"
  ]
});

export const PROFILE_REQUIRED_CONTROLS = Object.freeze({
  "application-js-ts": ["test", "static-analysis", "coverage", "complexity", "crap"],
  "application-go": ["test", "static-analysis", "coverage", "complexity", "crap"],
  "application-python": ["test", "static-analysis", "coverage", "complexity", "crap"],
  "application-php": ["test", "static-analysis", "coverage", "complexity", "crap"],
  "script-bash": ["test", "static-analysis", "state-identity", "semantic-mutation"],
  "database-sql": ["integration", "compatibility", "data-migration", "semantic-mutation"],
  "database-mongodb": ["integration", "compatibility", "data-migration", "semantic-mutation"],
  "web-markup": ["static-analysis", "browser", "accessibility"],
  "web-style": ["static-analysis", "browser", "accessibility"]
});

export function semanticFaultsForProfiles(profiles) {
  return [...new Set(profiles.flatMap((profile) => SEMANTIC_FAULT_CATALOG[profile] || []))].sort();
}

export function requiredControlsForProfiles(profiles) {
  return [...new Set(profiles.flatMap((profile) => PROFILE_REQUIRED_CONTROLS[profile] || []))].sort();
}
