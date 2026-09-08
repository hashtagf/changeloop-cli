import assert from "node:assert/strict";
import test from "node:test";

import {
  convergencePlan, verificationPlanValue, verificationRisk
} from "../runtime/workflow/verification-plan.mjs";

function packet(overrides = {}) {
  return {
    changeId: "change",
    schema: "foundation-standard",
    impact: "medium",
    coupling: "isolated",
    reviewRequired: false,
    pendingTaskCount: 0,
    providers: [
      { provider: "test", validity: "valid", repositories: ["root"] },
      { provider: "static", validity: "missing", repositories: ["root"] }
    ],
    ...overrides
  };
}

test("risk routing preserves high assurance across security and multi-repo shapes", () => {
  assert.equal(verificationRisk(packet({
    schema: "foundation-rapid", impact: "low"
  })), "rapid");
  assert.equal(verificationRisk(packet()), "standard");
  assert.equal(verificationRisk(packet({ impact: "high" })), "high");
  assert.equal(verificationRisk(packet({ reviewRequired: true })), "high");
  assert.equal(verificationRisk(packet({
    providers: [{ provider: "contract", repositories: ["api", "web"] }]
  })), "high");
});

test("prove uses one boundary command and names the probes it replaces", () => {
  const plan = verificationPlanValue(packet(), "prove", (value) => `digest:${value.phase}`);
  assert.equal(plan.execution.command, "claude-foundation proof advance change");
  assert.ok(plan.execution.includes.includes("receipt-reuse"));
  assert.ok(plan.execution.avoidBefore.includes(
    "claude-foundation proof readiness change"));
  assert.equal(plan.evidence.measurement, "provider-validity");
  assert.deepEqual(plan.evidence.reusable, ["test"]);
  assert.deepEqual(plan.evidence.required, ["static"]);
  assert.equal(plan.planFingerprint, "digest:prove");
  assert.equal(plan.assurance, "unchanged-by-batching");
  assert.deepEqual(plan.convergence, {
    mode: "until-pass",
    findings: "aggregate-independent",
    repairLimit: null,
    rerun: "invalidated-dependencies",
    noProgress: "decision-and-resume",
    state: "preserve-same-change"
  });
});

test("every parent phase receives one unlimited convergent gate contract", () => {
  assert.equal(convergencePlan().repairLimit, null);
  for (const phase of ["change", "build", "prove", "land"]) {
    const plan = verificationPlanValue(packet(), phase);
    assert.equal(plan.convergence.mode, "until-pass");
    assert.equal(plan.convergence.rerun, "invalidated-dependencies");
    assert.equal(plan.convergence.noProgress, "decision-and-resume");
    assert.equal(plan.authority.status, "READY");
  }
});

test("build defers its single readiness check until tasks are complete", () => {
  const pending = verificationPlanValue(packet({ pendingTaskCount: 2 }), "build");
  assert.equal(pending.execution.command, null);
  assert.equal(pending.execution.deferredCommand,
    "claude-foundation proof readiness change");
  const complete = verificationPlanValue(packet({ pendingTaskCount: 0 }), "build");
  assert.equal(complete.execution.command,
    "claude-foundation proof readiness change");
  assert.equal(complete.execution.deferredCommand, null);
});

test("compacted provider displays never invent reuse decisions", () => {
  const plan = verificationPlanValue(packet({
    providers: { count: 50, digest: "providers" }
  }), "land");
  assert.equal(plan.risk, "standard");
  assert.equal(plan.evidence.measurement, "compacted-unavailable");
  assert.deepEqual(plan.evidence.reusable, []);
  assert.equal(plan.execution.command, "claude-foundation land advance change");
});

test("task packets keep phase verification with the parent boundary", () => {
  const plan = verificationPlanValue(packet({ packetType: "task" }), "build");
  assert.equal(plan.strategy, "parent-boundary");
  assert.deepEqual(plan.execution, { boundary: "parent", command: null });
  assert.equal(plan.evidence, undefined);
  assert.ok(JSON.stringify(plan).length < 250);
});
