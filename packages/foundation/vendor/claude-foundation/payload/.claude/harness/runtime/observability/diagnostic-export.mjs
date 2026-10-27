// Shareable diagnostics deliberately exclude prose, paths, commands, payloads
// and user-selected identifiers. Enumeration allowlists are the export boundary.
const pick = (value, allowed) => allowed.includes(value) ? value : null;
const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0
  ? value : null;
const version = (value) => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value)
  ? value : null;
const digest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
  ? value : null;
const PROTOCOLS = ["runtimeApi", "advanceProtocol", "packetSchema", "providerProtocol",
  "proofProtocol", "feedbackSchema", "dashboardSnapshotSchema", "agentContractProtocol"];

export function diagnosticExport(feedback) {
  const next = feedback.nextAction || {};
  const cohort = feedback.sourceCohort || {};
  const timing = feedback.timing || {};
  return {
    version: 1,
    kind: "change-diagnostics",
    change: "change-1",
    sourceCohort: {
      runtimeVersion: version(cohort.runtimeVersion),
      contentDigest: digest(cohort.contentDigest),
      availability: pick(cohort.availability, ["available", "unavailable"]),
      protocolBundle: Object.fromEntries(PROTOCOLS.map((key) => [key,
        /^\d{1,6}$/.test(String(cohort.protocolBundle?.[key] ?? ""))
          ? String(cohort.protocolBundle[key]) : null]))
    },
    lifecycle: {
      action: pick(next.action, ["WORKING", "EDIT", "REPAIR", "RUN_EXTERNAL",
        "WAIT", "ASK_USER", "DONE", "UNAVAILABLE"]),
      owner: pick(next.owner, ["agent", "harness", "user", "external"]),
      userState: pick(next.userState, ["WORKING", "TARGET_REACHED", "DELIVERED",
        "WAITING_EXTERNAL", "NEEDS_DECISION"]),
      reached: pick(next.reached, ["build", "proven", "archived"]),
      boundary: pick(next.boundary, ["contract", "host-execution", "resource",
        "external-authority", "user-authority", "land-authority", "internal-lock",
        "internal-transaction", "repeated-no-progress", "inspection"]),
      recovery: pick(next.recovery?.type, ["EDIT", "AUTO_RECOVER", "RECONFIGURE",
        "ASK_USER", "PAUSE", "HANDOFF"])
    },
    timing: Object.fromEntries(["wallTimeMs", "activeTimeMs", "reviewerExecutionMs",
      "repairMs", "humanWaitMs", "unattributedMs"].map((key) => [key, number(timing[key])])),
    guards: Object.fromEntries(["lifecycle", "inspection"].map((kind) => [kind,
      Object.fromEntries(["blocked", "typed", "legacyUnavailable", "untypedCurrent"]
        .map((key) => [key, number(feedback.guards?.[kind]?.[key])]))])),
    usageAvailability: pick(feedback.usageAvailability?.classification, [
      "measured", "no-usage", "partial-measurement", "source-unsupported",
      "correlation-missing", "unavailable"
    ]),
    evidence: {
      availability: pick(feedback.readiness?.availability, ["available", "unavailable"]),
      reused: number(feedback.evidenceReuse?.count),
      providers: (feedback.readiness?.providers || []).slice(0, 50).map((row, index) => ({
        alias: `provider-${index + 1}`,
        status: pick(row.status, ["pass", "fail", "error", "inconclusive"]),
        validity: pick(row.validity, ["valid", "missing", "stale", "fail", "error",
          "inconclusive", "provider-version-stale", "prototype-evidence", "contract-stale",
          "provider-fingerprint-stale", "provider-inputs-stale", "incomplete-claims",
          "invalid-artifacts", "reusable-diff", "reusable-inputs", "execution-log-missing",
          "external-observation-missing", "external-provenance-missing", "external-evidence-missing",
          "review-version-stale", "review-not-independent", "review-not-diverse",
          "review-attempt-history-missing", "review-attempt-history-invalid",
          "review-repair-evidence-stale", "review-blockers", "acceptance-version-stale",
          "acceptance-invalid", "semantic-acceptance-version-stale", "semantic-acceptance-invalid"])
      })),
      truncated: feedback.readiness?.providersTruncated === true ||
        (feedback.readiness?.providers || []).length > 50
    },
    privacy: "allowlisted-metadata-only",
    measurement: "read-only-observation"
  };
}
