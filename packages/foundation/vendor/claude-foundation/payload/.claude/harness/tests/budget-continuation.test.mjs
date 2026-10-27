import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBudgetContinuationAvailable,
  assertBudgetContinuationEligible,
  budgetCheckpointValue,
  budgetContinuationInputs,
  budgetContinuationReadiness,
  budgetContinuationUnblock,
  continueBudgetWindow,
  createBudgetReporter,
  nextBudgetContinuationWindow,
  persistBudgetContinuation
} from "../runtime/workflow/budget-commands.mjs";

const fail = (message) => { throw new Error(message); };
const stop = (_id, code, decision) => {
  const error = new Error(code);
  error.decision = decision;
  throw error;
};

test("budget reporter formats measured state and limits quiet output to warnings", () => {
  const decisions = [
    { measured: true, ratio: 0.5, action: "CONTINUE", recommendation: "BUILD", limiter: "tokens", mode: "active" },
    { measured: false, ratio: 0.2, action: "WAIT", recommendation: "MEASURE", limiter: null, mode: "active" },
    { measured: true, ratio: 0.7, action: "STOP", recommendation: "RESCOPE", limiter: "requests", mode: "active" },
    { measured: true, ratio: 0.1, action: "STOP", recommendation: "ASK", limiter: "tokens", mode: "operator-required", userActionRequired: true }
  ];
  const reporter = createBudgetReporter({ applyBudgetDecision: () => decisions.shift() });
  const logs = [];
  const warnings = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (value) => logs.push(String(value));
  console.error = (value) => warnings.push(String(value));
  try {
    assert.equal(reporter.reportBudget("change", {}).ratio, 0.5);
    assert.equal(reporter.reportBudget("change", {}, true).measured, false);
    reporter.reportBudget("change", {}, true);
    reporter.reportBudget("change", {}, true);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.deepEqual(logs, ["BUDGET change: 50.0% CONTINUE BUILD (tokens)"]);
  assert.deepEqual(warnings, [
    "WARNING: BUDGET change: 70.0% STOP RESCOPE (requests)",
    "WARNING: BUDGET change: 10.0% STOP ASK (tokens) [NEEDS_USER_DECISION]"
  ]);
});

test("continuation inputs require trimmed reason and decision identity", () => {
  assert.deepEqual(budgetContinuationInputs({
    reason: "  finish proof ", "decision-ref": " user-1 "
  }, fail), { reason: "finish proof", decisionRef: "user-1" });
  assert.throws(() => budgetContinuationInputs({ "decision-ref": "user" }, fail),
    /requires --reason/);
  assert.throws(() => budgetContinuationInputs({ reason: "why" }, fail),
    /requires --decision-ref/);
});

test("continuation availability requires an exhaustion decision and accepts approvals up to the ceiling", () => {
  const context = {
    fail, blockWithDecision: stop,
    foundationPolicy: () => ({ execution: { maxContinuationWindows: 3 } })
  };
  const budget = { window: { usedTokens: 4, targetTokens: 10 } };
  assert.throws(() => assertBudgetContinuationAvailable(
    context, "change", budget, { mode: "completion-only" }), /after exhaustion/);
  assert.equal(assertBudgetContinuationAvailable(
    context, "change", budget, { mode: "operator-required" }), 0);
  assert.throws(() => assertBudgetContinuationAvailable(
    context, "change", budget, { mode: "active" }), /after exhaustion/);
  budget.window.extensionNumber = 2;
  assert.equal(assertBudgetContinuationAvailable(
    context, "change", budget, { mode: "operator-required" }), 2);
  budget.window.extensionNumber = 3;
  try {
    assertBudgetContinuationAvailable(context, "change", budget, { mode: "operator-required" });
    assert.fail("expected stop");
  } catch (error) {
    assert.equal(error.message, "budget-continuation-spent");
    assert.equal(error.decision.recommended, "pause");
    assert.deepEqual(error.decision.options.map(({ id }) => id), [
      "revise-contract", "new-budget", "abandon", "pause"
    ]);
    assert.deepEqual(error.decision.window, { used: 4, target: 10 });
    assert.deepEqual(error.decision.extensions, { used: 3, maximum: 3 });
  }
});

function readinessContext(overrides = {}) {
  return {
    activeChangePath: () => "/change",
    changeArtifactGaps: () => [],
    pendingTasks: () => [],
    readinessBudgetPolicy: (status) => ({ eligible: true, class: status }),
    proofReadinessValue: () => ({
      status: "READY", pendingTasks: [], externalProviders: [],
      unavailableProviders: [], budget: { eligible: false, class: "deterministic" }
    }),
    ...overrides
  };
}

test("continuation readiness prioritizes artifacts, tasks, then proof", () => {
  const pending = budgetContinuationReadiness(readinessContext({
    pendingTasks: () => [{ id: "T1" }, { text: "unnumbered" }]
  }), "change", {});
  assert.equal(pending.status, "NEEDS_CODE_CHANGE");
  assert.deepEqual(pending.pendingTasks, ["T1", "unnumbered"]);

  let pendingCalled = false;
  const artifacts = budgetContinuationReadiness(readinessContext({
    changeArtifactGaps: () => ["proposal.md", "tasks.md"],
    pendingTasks: () => { pendingCalled = true; return [{ id: "T1" }]; }
  }), "change", {});
  assert.equal(pendingCalled, false);
  assert.equal(artifacts.status, "CONFIGURATION_ERROR");
  assert.deepEqual(artifacts.issues, [
    "missing change artifact: proposal.md", "missing change artifact: tasks.md"
  ]);

  const proof = budgetContinuationReadiness(readinessContext(), "change", {});
  assert.equal(proof.status, "READY");
});

test("continuation unblock maps every ineligible work class", () => {
  const expected = {
    "external-authority": "external-evidence",
    infrastructure: "restore-provider",
    "active-work": "wait",
    deterministic: "run-proof",
    unknown: "run-proof"
  };
  for (const [kind, id] of Object.entries(expected))
    assert.equal(budgetContinuationUnblock({ budget: { class: kind } }).id, id);
  assert.equal(budgetContinuationUnblock({}).id, "run-proof");
});

test("checkpoint exposes the user decision and exact durable resume route", () => {
  const state = {};
  const value = budgetCheckpointValue({
    ...readinessContext({ pendingTasks: () => [{ id: "T1" }] }),
    loadRuntime: () => state,
    ensureBudgetState: () => ({ window: {
      id: "run-1", sequence: 4, extensionNumber: 2
    } }),
    applyBudgetDecision: () => ({
      measured: true, mode: "operator-required", userActionRequired: true,
      decision: { prompt: "Choose continue, rescope, or pause." }
    })
  }, "change");
  assert.equal(value.status, "NEEDS_USER_DECISION");
  assert.equal(value.forecast.status, "USER_DECISION_REQUIRED");
  assert.deepEqual(value.remainingWork.pendingTasks, ["T1"]);
  assert.equal(value.checkpoint.resumeCommand, null);
  assert.equal(value.checkpoint.afterContinuationCommand,
    "claude-foundation packet change --phase build");
  assert.equal(value.checkpoint.sequence, 4);
  assert.match(value.userPrompt, /Choose continue/);
});

test("checkpoint routes deterministic proof without asking for more model budget", () => {
  const value = budgetCheckpointValue({
    ...readinessContext(),
    loadRuntime: () => ({}),
    ensureBudgetState: () => ({ window: { id: "run", sequence: 1 } }),
    applyBudgetDecision: () => ({
      measured: true, mode: "operator-required", userActionRequired: true,
      decision: { prompt: "Choose more budget." }
    })
  }, "change");
  assert.equal(value.status, "READY_TO_RESUME");
  assert.equal(value.forecast.status, "NO_ADDITIONAL_MODEL_BUDGET_NEEDED");
  assert.equal(value.checkpoint.resumeCommand,
    "claude-foundation proof advance change");
  assert.equal(value.userPrompt, null);
});

test("eligible continuation passes and ineligible readiness produces a typed stop", () => {
  const context = { blockWithDecision: stop };
  assert.doesNotThrow(() => assertBudgetContinuationEligible(
    context, "change", { budget: { eligible: true } }));
  try {
    assertBudgetContinuationEligible(context, "change", {
      status: "WAITING", budget: {
        eligible: false, class: "external-authority", reason: "needs approval"
      }
    });
    assert.fail("expected stop");
  } catch (error) {
    assert.equal(error.message, "budget-continuation-rejected");
    assert.equal(error.decision.recommended, "external-evidence");
    assert.match(error.decision.summary, /needs approval/);
  }
  try {
    assertBudgetContinuationEligible(context, "change", { status: "READY" });
    assert.fail("expected stop");
  } catch (error) {
    assert.equal(error.decision.budgetClass, "READY");
    assert.match(error.decision.summary, /no model-completable work remains/);
  }
});

test("next continuation window filters usage and retains extension root", () => {
  let received;
  const context = {
    logs: "/logs",
    readJsonLines: () => [
      { runId: "run-2", inputTokens: 3 }, { runId: "other", inputTokens: 9 }
    ],
    eventUsage: (events) => { received = events; return { tokens: 3 }; },
    budgetWindow: (id, targets, usage, sequence, reason) =>
      ({ id, targets, usage, sequence, reason })
  };
  const result = nextBudgetContinuationWindow(context, "change", { run: "run-2" }, {
    targetRequests: "4", targetTokens: "100"
  }, { id: "run-1", extensionRootId: "root", sequence: 2 }, 0);
  assert.deepEqual(received, [{ runId: "run-2", inputTokens: 3 }]);
  assert.equal(result.runId, "run-2");
  assert.deepEqual(result.window.targets, { requests: 4, tokens: 100 });
  assert.equal(result.window.sequence, 3);
  assert.equal(result.window.extensionRootId, "root");
  assert.equal(result.window.extensionNumber, 1);

  const fallback = nextBudgetContinuationWindow(context, "change", {}, {
    targetRequests: 1, targetTokens: 2
  }, { id: "prior", sequence: 0 }, 0);
  assert.equal(fallback.runId, "prior");
  assert.equal(fallback.window.extensionRootId, "prior");
});

test("persistence audits success and restores the previous window on failure", () => {
  const prior = { id: "prior" };
  const budget = { window: { id: "next" } };
  const calls = [];
  persistBudgetContinuation({
    saveRuntime: () => calls.push("save"),
    appendBudgetAudit: () => calls.push("audit")
  }, "change", {}, budget, prior, { id: "next" }, "why", "decision");
  assert.deepEqual(calls, ["save", "audit"]);

  let saves = 0;
  const failed = { window: { id: "next" } };
  assert.throws(() => persistBudgetContinuation({
    saveRuntime: () => { saves += 1; },
    appendBudgetAudit: () => { throw new Error("disk full"); }
  }, "change", {}, failed, prior, {}, "why", "decision"), /disk full/);
  assert.equal(saves, 2);
  assert.equal(failed.window, prior);

  const doubleFailure = { window: { id: "next" } };
  assert.throws(() => persistBudgetContinuation({
    saveRuntime: () => { throw new Error("save failed"); },
    appendBudgetAudit: () => {}
  }, "change", {}, doubleFailure, prior, {}, "why", "decision"), /save failed/);
  assert.equal(doubleFailure.window, prior);
});

function continuationFixture(overrides = {}) {
  const state = {};
  const budget = {
    targetRequests: 5, targetTokens: 100,
    window: { id: "run-1", sequence: 0, usedTokens: 100, targetTokens: 100 }
  };
  const calls = { saved: 0, audited: [] };
  return {
    state, budget, calls,
    context: {
      logs: "/logs",
      loadRuntime: () => state,
      saveRuntime: () => { calls.saved += 1; },
      ensureBudgetState: () => budget,
      applyBudgetDecision: () => ({ mode: "operator-required" }),
      changeArtifactGaps: () => [], activeChangePath: () => "/change",
      pendingTasks: () => [{ id: "T1" }],
      readinessBudgetPolicy: () => ({ eligible: true, class: "model-work" }),
      proofReadinessValue: () => { throw new Error("not expected"); },
      eventUsage: () => ({ tokens: 0 }), budgetWindow: (id) => ({ id, sequence: 1 }),
      readJsonLines: () => [],
      appendBudgetAudit: (...args) => calls.audited.push(args),
      foundationPolicy: () => ({ execution: { maxContinuationWindows: 3 } }),
      blockWithDecision: stop, fail,
      ...overrides
    }
  };
}

test("continuation orchestration advances, persists, audits, and reports", () => {
  const f = continuationFixture();
  const prior = console.log;
  const rows = [];
  console.log = (value) => rows.push(String(value));
  try {
    continueBudgetWindow(f.context, "change", {
      reason: "finish", "decision-ref": "user-1", run: "run-2"
    });
  } finally { console.log = prior; }
  assert.equal(f.budget.window.id, "run-2");
  assert.equal(f.budget.window.extensionNumber, 1);
  assert.equal(f.calls.saved, 1);
  assert.equal(f.calls.audited[0][1], "continue");
  assert.match(rows[0], /BUDGET CONTINUED change/);
});
