import assert from "node:assert/strict";

import {
  compareGateProgress,
  gateProgressValue,
  gateRepairPlan,
  noProgressDecision,
  normalizeGateFindings
} from "../runtime/core/convergent-gate.mjs";

const findings = [{
  id: "F-2",
  phase: "build",
  gate: "focused-checks",
  failureClass: "product",
  severity: "major",
  provider: "test",
  reason: "shared parser defect",
  message: "fractional values remain accepted",
  path: "src/window.mjs",
  claimIds: ["CLAIM-2", "CLAIM-1"],
  verificationCaseIds: ["CASE-FRACTION"]
}, {
  id: "F-1",
  phase: "build",
  gate: "focused-checks",
  classification: "product",
  severity: "major",
  provider: "test",
  rootCause: "shared parser defect",
  message: "negative values remain accepted",
  paths: ["src/window.mjs"],
  claimIds: ["CLAIM-1"],
  criticalCaseIds: ["CASE-NEGATIVE"]
}];

const reversed = normalizeGateFindings([...findings].reverse());
assert.deepEqual(reversed, normalizeGateFindings(findings),
  "finding normalization must be order independent");

const first = gateProgressValue({
  phase: "build",
  gate: "focused-checks",
  findings,
  changedPaths: ["src/window.mjs"],
  completedTasks: ["T-1"],
  evidence: [{ provider: "test", validity: "fail" }],
  strategy: { id: "normalize-input" },
  workspaceHash: "workspace-a"
});
const same = gateProgressValue({
  phase: "build",
  gate: "focused-checks",
  findings: [...findings].reverse(),
  changedPaths: ["src/window.mjs"],
  completedTasks: ["T-1"],
  evidence: [{ validity: "fail", provider: "test" }],
  strategy: { id: "normalize-input" },
  workspaceHash: "workspace-a"
});
assert.equal(compareGateProgress(first, same).progressed, false,
  "reordered equivalent observations must be no progress");

const changedStrategy = gateProgressValue({
  ...same,
  strategy: { id: "reject-non-integer" }
});
assert.equal(compareGateProgress(first, changedStrategy).progressed, true,
  "a new repair strategy is meaningful progress even before findings change");

const plan = gateRepairPlan(findings, { phase: "build", gate: "focused-checks" });
assert.equal(plan.tasks.length, 1,
  "findings with one root cause must become one repair task");
assert.deepEqual(plan.tasks[0].findingIds, ["F-1", "F-2"]);
assert.deepEqual(plan.tasks[0].claimIds, ["CLAIM-1", "CLAIM-2"]);
assert.deepEqual(plan.tasks[0].criticalCaseIds, ["CASE-FRACTION", "CASE-NEGATIVE"]);

const decision = noProgressDecision({
  changeId: "change-a",
  phase: "build",
  gate: "focused-checks",
  progress: same,
  findings,
  attemptedStrategies: [{ id: "normalize-input", result: "same-findings" }],
  resumeCommand: "claude-foundation packet change-a --phase build"
});
assert.equal(decision.status, "NEEDS_USER_DECISION");
assert.equal(decision.reason, "NO_PROGRESS");
assert.equal(decision.decision.recommended, "change-strategy");
assert.match(decision.decision.summary, /same findings/);
assert.ok(decision.decision.options.every((option) => option.id && option.outcome));
assert.ok(decision.decision.options.some((option) => option.id === "pause"));
assert.ok(decision.decision.options.length >= 4,
  "the user receives supported alternatives instead of raw failure");
assert.equal(decision.next[0].command,
  "claude-foundation packet change-a --phase build");
