import assert from "node:assert/strict";
import test from "node:test";

import {
  auditTraceability,
  claimTraceFindings,
  normalizedTraceLabel,
  scenarioTraceFindings,
  semanticTraceFindings,
  tasksIndexedByClaim,
  taskTraceFindings
} from "../runtime/evidence/traceability.mjs";

const claims = [
  { id: "happy-path", scenario: "User can save", impact: "low", capabilities: ["test"] },
  { id: "review-only", scenario: "Reviewer approves", impact: "high", capabilities: ["review", "acceptance"] }
];

test("trace labels normalize punctuation, case, and empty values", () => {
  assert.equal(normalizedTraceLabel("  User--CAN_save! "), "user can save");
  assert.equal(normalizedTraceLabel(null), "");
});

test("task index keeps known links and ignores unknown claims", () => {
  const indexed = tasksIndexedByClaim(claims, [
    { id: "T1", claims: ["happy-path", "missing"] },
    { id: "T2", claims: ["happy-path"] }
  ]);
  assert.deepEqual(indexed.get("happy-path"), ["T1", "T2"]);
  assert.deepEqual(indexed.get("review-only"), []);
  assert.equal(indexed.has("missing"), false);
});

test("task findings distinguish missing and unknown annotations", () => {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const findings = taskTraceFindings([
    { id: "T0", claims: [] },
    { id: "T1", claims: ["happy-path", "missing"] }
  ], byId);
  assert.deepEqual(findings.map((finding) => finding.code), [
    "task-without-claim", "unknown-task-claim"
  ]);
  assert.equal(findings[1].claimId, "missing");
  assert.deepEqual(taskTraceFindings([
    { id: "T2", claims: ["happy-path"] }
  ], byId), []);
});

test("claim findings report unlinked and unconfigured capabilities only", () => {
  const indexed = new Map([
    ["happy-path", ["T1"]], ["review-only", []], ["unmapped", []]
  ]);
  const findings = claimTraceFindings([
    ...claims,
    { id: "unmapped", scenario: "x", capabilities: ["mutation"] }
  ], indexed, new Set(["test"]));
  assert.deepEqual(findings.map((finding) => finding.code), [
    "claim-without-task", "claim-without-task", "claim-without-provider"
  ]);
  assert.equal(findings.at(-1).capability, "mutation");
});

test("scenario findings require an exact normalized claim label", () => {
  const scenarios = [
    { name: "User CAN save", path: "a.feature", key: "user can save" },
    { name: "happy_path", path: "b.feature", key: "happy path" },
    { name: "Partial save", path: "c.feature", key: "partial save" }
  ];
  const findings = scenarioTraceFindings(claims, scenarios);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].scenario, "Partial save");
  assert.equal(findings[0].normalized, "partial save");
  assert.match(findings[0].rule, /equals a claim id/);
  assert.deepEqual(scenarioTraceFindings(claims, []), []);
});

test("semantic findings require security negatives and migration recovery", () => {
  const risky = [{
    id: "migrate-data", scenario: "Move rows",
    capabilities: ["data-migration"]
  }];
  assert.deepEqual(semanticTraceFindings({ securityTriggers: ["auth"] }, risky)
    .map((finding) => finding.code), [
    "security-negative-path-missing", "migration-recovery-claim-missing"
  ]);
  const covered = [
    { id: "unauthorized-denied", scenario: "Another user is rejected", capabilities: [] },
    { id: "rollback-integrity", scenario: "Recover migration", capabilities: ["data-migration"] }
  ];
  assert.deepEqual(semanticTraceFindings({ securityTriggers: ["auth"] }, covered), []);
  assert.deepEqual(semanticTraceFindings({}, claims), []);
});

test("audit traceability returns pass with complete links", () => {
  const result = auditTraceability({
    id: "change", state: { schema: "foundation-standard" },
    contract: { claims, providers: { tests: {} } },
    tasks: [
      { id: "T1", claims: ["happy-path"] },
      { id: "T2", claims: ["review-only"] }
    ],
    scenarios: [{ name: "User can save", path: "a.feature", key: "user can save" }],
    configuredCapabilities: ["test"]
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.summary, {
    scenarios: 1, claims: 2, tasks: 2, linkedTasks: 2,
    linkedClaims: 2, configuredProviders: 1, errors: 0, warnings: 0
  });
  assert.deepEqual(result.claims[0].taskIds, ["T1"]);
});

test("audit traceability prioritizes errors over warnings", () => {
  const result = auditTraceability({
    id: "change", state: { schema: "rapid", securityTriggers: ["auth"] },
    contract: { claims: [claims[0]] },
    tasks: [{ id: "T0", claims: [] }, { id: "T1", claims: ["missing"] }]
  });
  assert.equal(result.status, "error");
  assert.equal(result.summary.errors, 1);
  assert.ok(result.summary.warnings >= 2);
  assert.deepEqual(result.scenarios, []);
});

test("audit traceability reports warning when no errors exist", () => {
  const result = auditTraceability({
    id: "change", state: { schema: "rapid" },
    contract: { claims: [claims[0]], providers: null },
    tasks: []
  });
  assert.equal(result.status, "warning");
  assert.equal(result.summary.configuredProviders, 0);
  assert.equal(result.summary.linkedTasks, 0);
});
