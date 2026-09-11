import assert from "node:assert/strict";
import test from "node:test";

import {
  coordinatorAction, createAdvanceRuntime, hasValidLandGrant,
  prepareAdvanceBuild, runAdvanceProof
} from "../runtime/workflow/advance-runtime.mjs";
import {
  feedbackSnapshotValue, operationCauseCoverage, reviewRepairIntervals, intervalDuration
} from "../runtime/observability/feedback-runtime.mjs";

const stableHash = (value) => `hash:${JSON.stringify(value)}`;
const base = {
  id: "change-a",
  state: { status: "building" },
  dispatch: { action: "build-complete" },
  workspaceHash: "workspace-a",
  proofCursor: {},
  authorityRequests: [],
  stableHash
};

test("advance phase operations measure harness-owned Build and Prove work", async () => {
  const calls = [];
  const measureAsync = async (stage, operation) => {
    calls.push(stage);
    return operation();
  };
  const runQuietly = (operation) => operation();
  await prepareAdvanceBuild({
    measureAsync, runQuietly,
    prepareBuildSandbox: (id) => calls.push(["sandbox", id]),
    prepareExecution: (id, options) => calls.push(["execution", id, options])
  }, "change-a");
  await runAdvanceProof({
    measureAsync, runQuietly,
    proofAdvance: (id, options) => calls.push(["proof", id, options])
  }, "change-a");
  assert.deepEqual(calls, [
    "build.prepare", ["sandbox", "change-a"],
    ["execution", "change-a", { stage: "build" }],
    "prove.execute", ["proof", "change-a", { quiet: true }]
  ]);
});

test("advance land grant adapter projects only current validity", () => {
  assert.equal(hasValidLandGrant({ valid: () => ({ valid: true }) }, "change-a"), true);
  assert.equal(hasValidLandGrant({ valid: () => ({ valid: false }) }, "change-a"), false);
});

test("advance returns bounded Build work without invoking a model", () => {
  const value = coordinatorAction({
    ...base,
    dispatch: { action: "run-in-session", packetCommand: "packet",
      task: { taskId: "T001" } },
    plan: { tasks: [{ id: "T001", text: "Implement behavior",
      repository: "root", paths: ["src/**"] }] }
  });
  assert.equal(value.action, "EDIT");
  assert.equal(value.legacyAction, "EXECUTE_TASK");
  assert.equal(value.boundary, "host-execution");
  assert.equal(value.resumeCommand, "claude-foundation advance change-a");
});

test("advance exposes current review findings as a repair graph", () => {
  const value = coordinatorAction({
    ...base,
    latestReview: {
      digest: "attempt-a", workspaceHash: "workspace-a", resultStatus: "fail",
      findings: [{
        id: "F1", severity: "major", path: "src/a.mjs",
        claimIds: ["claim-a"], verificationCaseIds: ["case-a"]
      }]
    }
  });
  assert.equal(value.action, "REPAIR");
  assert.equal(value.legacyAction, "EXECUTE_REPAIR_BATCH");
  assert.equal(value.repairGraph.nodes[0].findingIds[0], "F1");
  assert.equal(value.repairGraph.nodes[0].sourceAttemptDigest, "attempt-a");
});

test("changed repair workspace routes to invalidated evidence", () => {
  const value = coordinatorAction({
    ...base,
    workspaceHash: "workspace-b",
    latestReview: {
      digest: "attempt-a", workspaceHash: "workspace-a", resultStatus: "fail",
      findings: [{ id: "F1", severity: "major", path: "src/a.mjs" }]
    }
  });
  assert.equal(value.action, "RUN_EXTERNAL");
  assert.equal(value.legacyAction, "RUN_INVALIDATED_EVIDENCE");
  assert.equal(value.boundary, null);
  assert.equal(value.command, "claude-foundation proof advance change-a");
});

test("advance returns configured review and user authority boundaries", () => {
  const review = coordinatorAction({
    ...base,
    authorityRequests: [{
      requestId: "review-1", type: "review", status: "requested"
    }],
    authorityActions: [{
      requestId: "review-1",
      command: "claude-foundation authority run change-a --request review-1 --subject-actor implementation-agent"
    }]
  });
  assert.equal(review.action, "RUN_EXTERNAL");
  assert.equal(review.legacyAction, "RUN_CONFIGURED_REVIEW");
  assert.equal(review.boundary, "external-authority");

  const decision = coordinatorAction({
    ...base,
    proofCursor: { status: "NEEDS_USER_DECISION", decision: {
      id: "D1", kind: "work-decision", summary: "Choose the product behavior"
    } }
  });
  assert.equal(decision.action, "ASK_USER");
  assert.equal(decision.legacyAction, "REQUEST_DECISION");
  assert.equal(decision.boundary, "user-authority");
});

test("Land readiness forbids implicit delivery authority", () => {
  const value = coordinatorAction({
    ...base, state: { status: "proven" },
    proofCursor: { status: "PASS", workspaceHash: "workspace-a" }
  });
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.legacyAction, "LAND_READY");
  assert.deepEqual(value.forbidden, ["commit", "push", "publish", "open-pr", "waive"]);
});

test("successful proof and current review request supersede stale review failure", () => {
  const failedReview = {
    digest: "attempt-a", workspaceHash: "workspace-a", resultStatus: "fail",
    findings: [{ id: "F1", severity: "major", path: "src/a.mjs" }]
  };
  const proven = coordinatorAction({
    ...base, workspaceHash: "workspace-b", latestReview: failedReview,
    proofCursor: { status: "PASS", workspaceHash: "workspace-b" }
  });
  assert.equal(proven.action, "ASK_USER");
  assert.equal(proven.legacyAction, "LAND_READY");

  const requested = coordinatorAction({
    ...base, workspaceHash: "workspace-b", latestReview: failedReview,
    authorityRequests: [{ requestId: "review-2", type: "review", status: "requested" }],
    authorityActions: [{
      requestId: "review-2",
      command: "claude-foundation authority run change-a --request review-2 --subject-actor implementation-agent"
    }]
  });
  assert.equal(requested.action, "RUN_EXTERNAL");
  assert.equal(requested.legacyAction, "RUN_CONFIGURED_REVIEW");
  assert.equal(requested.requestId, "review-2");
});

test("advance rejects stale proof and stops when bounded review needs an external verdict", () => {
  const stale = coordinatorAction({
    ...base, state: { status: "proven" },
    proofCursor: { status: "PASS", workspaceHash: "workspace-old" }
  });
  assert.equal(stale.action, "RUN_EXTERNAL");
  assert.equal(stale.legacyAction, "RUN_PROOF");

  const capped = coordinatorAction({
    ...base,
    authorityRequests: [{ requestId: "review-3", type: "review", status: "requested" }],
    authorityActions: [{ requestId: "review-3", command: "claude-foundation authority status change-a --request review-3 --template" }]
  });
  assert.equal(capped.action, "WAIT");
  assert.equal(capped.legacyAction, "WAIT_EXTERNAL");
  assert.equal(capped.actor, "external-authority");
  assert.match(capped.reason, /external verdict is pending/);
  assert.match(capped.command, /authority status/);
});

test("advance stops on proof preflight before starting expensive evidence", () => {
  const unavailable = coordinatorAction({
    ...base,
    proofPreflight: {
      status: "INFRASTRUCTURE_ERROR",
      unavailableProviders: ["browser"],
      next: [{ command: "claude-foundation doctor --stage prove --change change-a" }]
    }
  });
  assert.equal(unavailable.action, "REPAIR");
  assert.equal(unavailable.legacyAction, "REPAIR_PROVIDER_ENVIRONMENT");
  assert.equal(unavailable.boundary, "resource");
  assert.match(unavailable.command, /doctor --stage prove/);

  const invalid = coordinatorAction({
    ...base,
    proofPreflight: {
      status: "CONFIGURATION_ERROR", issues: ["critical case missing"], next: []
    }
  });
  assert.equal(invalid.action, "REPAIR");
  assert.equal(invalid.legacyAction, "REPAIR_PROOF_CONTRACT");
  assert.equal(invalid.boundary, "contract");
});

test("advance uses proof readiness hash and does not hash failed infrastructure again", () => {
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building" }),
    agentDispatchValue: () => ({ action: "build-complete" }),
    proofReadinessValue: () => ({
      status: "INFRASTRUCTURE_ERROR",
      workspaceHash: null,
      issues: ["selected repository 'api' isolated workspace is missing"],
      repositoryIssues: ["selected repository 'api' isolated workspace is missing"],
      unavailableProviders: [],
      next: [{
        command: "claude-foundation sandbox create change-a --all"
      }]
    }),
    relevantHash: assert.fail,
    deliveredAiAttempts: () => [], authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash
  });
  const value = runtime.advanceValue("change-a");
  assert.equal(value.action, "REPAIR");
  assert.equal(value.legacyAction, "REPAIR_PROVIDER_ENVIRONMENT");
  assert.equal(value.command,
    "claude-foundation sandbox create change-a --all");
});

test("advance --through runs deterministic proof and Land until archived", async () => {
  const state = { status: "building", workspace: { path: "/tmp/change" } };
  let proofRuns = 0;
  let landRuns = 0;
  let grants = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => proofRuns ? { status: "PASS", workspaceHash: "workspace-a" } : {},
    proofAdvancePath: () => "/proof.json",
    stableHash,
    hasLandGrant: () => grants > 0,
    authorizeLand: () => { assert.equal(state.status, "proven"); grants += 1; },
    runProof: async () => {
      proofRuns += 1;
      state.status = "proven";
      return { progressed: true, completed: true };
    },
    runLand: async () => {
      landRuns += 1;
      state.status = "archived";
    }
  });
  const value = await runtime.advanceThrough("change-a", "archived");
  assert.equal(value.action, "DONE");
  assert.equal(value.reached, "archived");
  assert.equal(proofRuns, 1);
  assert.equal(landRuns, 1);
  assert.equal(grants, 1);
});

test("advance --through build stops before proof and preserves one resume route", async () => {
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building", workspace: { path: "/tmp/change" } }),
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}),
    proofAdvancePath: () => "/proof.json",
    stableHash
  });
  const value = await runtime.advanceThrough("change-a", "build");
  assert.equal(value.action, "DONE");
  assert.equal(value.reached, "build");
  assert.equal(value.resume, null);
  assert.equal(value.next, "claude-foundation advance change-a --through proven");
});

test("advance --through records each phase once", async () => {
  const state = { status: "change", workspace: { path: "/tmp/change" } };
  const phases = [];
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    prepareBuild: async () => { state.status = "building"; },
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    recordPhase: (_id, phase) => phases.push(phase),
    output: () => {}
  });
  await runtime.showAdvance("change-a", { through: "build" });
  assert.deepEqual(phases, ["build"]);
});

test("plain advance prepares the amended agreement before choosing work", async () => {
  let prepared = false;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building", workspace: { path: "/tmp/change" } }),
    prepareBuild: async () => { prepared = true; },
    agentDispatchValue: () => {
      assert.equal(prepared, true);
      return { action: "run-in-session", packetCommand: "packet", task: { taskId: "T002" } };
    },
    agentPlanValue: () => ({ tasks: [{ id: "T002", text: "New amended task",
      repository: "root", paths: ["src/**"] }] }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    output: () => {}
  });
  const value = await runtime.advanceThrough("change-a", null);
  assert.equal(value.action, "EDIT", JSON.stringify(value));
});

test("advance preserves exact runtime failures in a repair envelope", () => {
  const reason = "isolated runtime state is missing repository 'api'; repair it with 'claude-foundation sandbox create change-a --all'";
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building" }),
    agentDispatchValue: () => { throw new Error(reason); },
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash
  });
  const value = runtime.advanceValue("change-a");
  assert.equal(value.action, "REPAIR");
  assert.equal(value.legacyAction, "REPAIR_BUILD_RUNTIME");
  assert.equal(value.reason, reason);
  assert.equal(value.command,
    "claude-foundation sandbox create change-a --all");
  assert.equal(value.resume, "claude-foundation advance change-a");
});

test("advance --through converts prepare and Land failures without rejecting", async () => {
  const preparing = { status: "change" };
  const prepareRuntime = createAdvanceRuntime({
    loadRuntime: () => preparing,
    prepareBuild: async () => { throw new Error("root sandbox unavailable"); },
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }), readJson: () => ({}),
    proofAdvancePath: () => "/proof.json", stableHash
  });
  const prepare = await prepareRuntime.advanceThrough("change-a", "archived");
  assert.equal(prepare.action, "REPAIR");
  assert.equal(prepare.legacyAction, "REPAIR_BUILD_RUNTIME");
  assert.equal(prepare.reason, "root sandbox unavailable");
  assert.equal(prepare.resume,
    "claude-foundation advance change-a --through archived");

  const landing = { status: "proven" };
  const landRuntime = createAdvanceRuntime({
    loadRuntime: () => landing,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({ status: "PASS", workspaceHash: "workspace-a" }),
    proofAdvancePath: () => "/proof.json", stableHash,
    hasLandGrant: () => true,
    runLand: async () => { throw new Error("land conflict route"); }
  });
  const land = await landRuntime.advanceThrough("change-a", "archived");
  assert.equal(land.action, "REPAIR");
  assert.equal(land.legacyAction, "REPAIR_LAND_RUNTIME");
  assert.equal(land.reason, "land conflict route");
  assert.equal(land.command, "claude-foundation land check change-a");
});

test("advance convergence follows semantic progress beyond 32 proof runs", async () => {
  const state = { status: "building", revision: 0 };
  let proofRuns = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => `workspace-${state.revision}`,
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    runProof: async () => {
      proofRuns += 1;
      state.revision += 1;
      if (proofRuns === 40) state.status = "proven";
      return { progressed: true, completed: proofRuns === 40 };
    }
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.action, "DONE");
  assert.equal(value.reached, "proven");
  assert.equal(proofRuns, 40);
});

test("advance convergence stops only after repeated unchanged automation", async () => {
  const state = { status: "building", revision: 1 };
  let proofRuns = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }), readJson: () => ({}),
    proofAdvancePath: () => "/proof.json", stableHash,
    runProof: async () => { proofRuns += 1; return { progressed: false }; }
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.boundary, "repeated-no-progress");
  assert.equal(value.decision.kind, "repair-no-progress");
  assert.equal(proofRuns, 2);
});

test("a weak host can finish by reading one action and calling its resume", async () => {
  const state = { status: "building", workspace: { path: "/tmp/change" } };
  let edited = false;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => edited
      ? { action: "build-complete" }
      : { action: "run-in-session", task: { taskId: "T001" } },
    agentPlanValue: () => ({
      tasks: [{
        id: "T001", text: "Implement bounded behavior — verify: `npm test`",
        paths: ["src/**"], repository: "root"
      }]
    }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => state.status === "proven"
      ? { status: "PASS", workspaceHash: "workspace-a" } : {},
    proofAdvancePath: () => "/proof.json", stableHash,
    hasLandGrant: () => true,
    runProof: async () => { state.status = "proven"; return { progressed: true }; },
    runLand: async () => { state.status = "archived"; }
  });
  const first = await runtime.advanceThrough("change-a", "archived");
  assert.equal(first.action, "EDIT");
  assert.deepEqual(first.allowedPaths, ["src/**"]);
  assert.deepEqual(first.verification, ["npm test"]);
  assert.equal(first.resume, "claude-foundation advance change-a --through archived");
  assert.ok(JSON.stringify(first).length < 8192, "action stays within the bounded host context");
  edited = true;
  const second = await runtime.advanceThrough("change-a", "archived");
  assert.equal(second.action, "DONE");
  assert.equal(second.reached, "archived");
});

test("feedback classifies observed review repair without inventing wait", () => {
  const operations = [{
    version: 3, operation: "proof-advance", status: "completed",
    startedAt: "2026-09-03T06:10:51.110Z"
  }];
  const attempts = [
    {
      status: "completed", resultStatus: "fail", digest: "review-a",
      timestamp: "2026-09-03T05:31:14.991Z",
      completedAt: "2026-09-03T05:40:00.506Z", workspaceHash: "workspace-a",
      findings: [{ id: "F1", severity: "major" }]
    },
    {
      status: "completed", resultStatus: "fail", digest: "review-b",
      timestamp: "2026-09-03T06:14:12.373Z",
      completedAt: "2026-09-03T06:19:28.083Z", workspaceHash: "workspace-b",
      findings: []
    }
  ];
  const intervals = reviewRepairIntervals(operations, attempts);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].durationMs, 1_850_604);
  assert.match(intervals[0].basis, /later-changed-workspace/);

  const snapshot = feedbackSnapshotValue({
    changeId: "change-a",
    metrics: {
      unattributedWaitMs: 2_000_000, humanWaitMs: null,
      evidenceObservationGroups: [{
        commandExecutionId: "exec-1", providers: ["test", "compatibility"],
        independent: false
      }]
    },
    operations,
    reviewAttempts: attempts,
    nextAction: { action: "RUN_PROOF" }
  });
  assert.equal(snapshot.timing.repairMs, 1_850_604);
  assert.equal(snapshot.timing.humanWaitMs, null);
  assert.equal(snapshot.timing.unattributedMs, 149_396);
  assert.equal(snapshot.evidenceObservationGroups[0].independent, false);
});

test("feedback derives repair on advance and excludes resumes after the next review", () => {
  const attempts = [
    { status: "completed", resultStatus: "fail", digest: "a", workspaceHash: "a",
      completedAt: "2026-09-11T00:00:00Z", findings: [{ id: "F1", severity: "major" }] },
    { status: "completed", resultStatus: "pass", workspaceHash: "b",
      timestamp: "2026-09-11T00:05:00Z" }
  ];
  const operation = { operation: "advance", startedAt: "2026-09-11T00:03:00Z" };
  const intervals = reviewRepairIntervals([operation], attempts);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].durationMs, 180000);
  assert.deepEqual(reviewRepairIntervals([
    { ...operation, startedAt: "2026-09-11T00:06:00Z" }
  ], attempts), []);
  const snapshot = feedbackSnapshotValue({ changeId: "a", metrics: {},
    operations: [operation], reviewAttempts: attempts });
  assert.equal(snapshot.timing.repairTimingAvailability, "derived");
  const overlapped = feedbackSnapshotValue({ changeId: "a", operations: [operation],
    reviewAttempts: attempts, metrics: {
      unattributedWaitMs: 600000, humanWaitMs: 60000,
      humanWaitSpans: [{ from: "2026-09-11T00:01:00Z", to: "2026-09-11T00:02:00Z" }]
    } });
  assert.equal(overlapped.timing.unattributedMs, 420000,
    "human wait inside repair is subtracted only once");
  const activeOverlap = feedbackSnapshotValue({ changeId: "a",
    operations: [operation, { operation: "exec", startedAt: "2026-09-11T00:01:00Z",
      finishedAt: "2026-09-11T00:02:00Z" }], reviewAttempts: attempts,
    metrics: { unattributedWaitMs: 600000 } });
  assert.equal(activeOverlap.timing.unattributedMs, 480000,
    "repair overlapping an observed operation is not subtracted from idle twice");
  const legacy = feedbackSnapshotValue({ changeId: "a", operations: [operation],
    reviewAttempts: attempts, metrics: { unattributedWaitMs: 600000, humanWaitMs: 60000 } });
  assert.equal(legacy.timing.unattributedMs, null,
    "legacy totals cannot establish overlap without boundaries");
});

test("timing unions duplicate and overlapping intervals without inventing measurements", () => {
  const row = (from, to) => ({ from: `2026-09-11T00:00:${from}Z`, to: `2026-09-11T00:00:${to}Z` });
  assert.equal(intervalDuration([row("00", "10"), row("05", "15"),
    row("00", "10"), row("20", "25")]), 20000);
  assert.equal(intervalDuration([row("00", "00")]), 0);
  assert.equal(intervalDuration([{ from: "invalid", to: null }]), null);
});

test("feedback keeps missing timing unknown and retains measured zero", () => {
  const snapshot = (reviewAttempts) => feedbackSnapshotValue({
    changeId: "change-a", metrics: {}, reviewAttempts
  }).timing;
  assert.equal(snapshot([]).reviewerExecutionMs, null);
  assert.equal(snapshot([]).repairMs, null);
  assert.equal(snapshot([{ timestamp: "invalid" }]).reviewerExecutionMs, null);
  const measured = { timestamp: "2026-09-05T00:00:00Z",
    completedAt: "2026-09-05T00:00:00Z" };
  assert.equal(snapshot([measured]).reviewerExecutionMs, 0);
  assert.equal(snapshot([measured]).reviewerTimingAvailability, "complete");
  assert.equal(snapshot([measured, {}]).reviewerTimingAvailability, "partial");
});

test("feedback keeps legacy blocker cause explicitly unavailable", () => {
  assert.deepEqual(operationCauseCoverage([
    { version: 2, status: "blocked" },
    { version: 3, status: "blocked", blocker: { code: "budget-exhausted" } },
    { version: 3, status: "failed" }
  ]), { blocked: 2, typed: 1, legacyUnavailable: 1, untypedCurrent: 0 });
});
