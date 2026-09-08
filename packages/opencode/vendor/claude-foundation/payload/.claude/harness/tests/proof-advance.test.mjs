import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertProofCollectionOutcomes,
  beginProofCollection,
  createProofExecutionRuntime,
  persistProofCollectionArtifacts,
  proofCollectionOutcome,
  rebindProofCollectionReceipts,
  settleProofCollection,
  stopProofCollection
} from "../runtime/evidence/proof-execution-runtime.mjs";
import { createReceiptValidity } from "../runtime/evidence/receipt-validity.mjs";

function fixture(options = {}) {
  let state = { version: 2, id: "change-a", status: "building" };
  let phase = options.phase || "review";
  let executions = 0;
  let executionNeeded = options.executionNeeded ?? true;
  let executionFailuresRemaining = Number(
    options.failExecutionCount ?? (options.failExecutionOnce ? 1 : 0));
  let finalizations = 0;
  let blocked = 0;
  let closures = 0;
  const closureWorkspaceHashes = [];
  let proof = null;
  const requests = [...(options.requests || [])];
  const now = () => "2026-08-14T00:00:00.000Z";
  let workspaceHash = "workspace-a";
  const externalProviders = () => phase === "review"
    // Production validation sorts provider names, so acceptance appears first.
    // The controller must still select review by capability.
    ? ["acceptance", "review"]
    : phase === "acceptance" ? ["acceptance"]
    : phase === "external" ? ["external"] : [];
  const readiness = () => phase === "blocked" ? {
    version: 1,
    changeId: "change-a",
    status: "CONFIGURATION_ERROR",
    workspaceHash,
    issues: ["broken topology"],
    externalProviders: [],
    unavailableProviders: [],
    pendingTasks: [],
    next: [{ kind: "revise-configuration" }]
  } : {
    version: 1,
    changeId: "change-a",
    status: phase === "ready" ? "READY" : "NEEDS_USER_DECISION",
    workspaceHash,
    issues: [],
    externalProviders: externalProviders(),
    unavailableProviders: [],
    pendingTasks: [],
    next: []
  };
  const runtime = createProofExecutionRuntime({
    proofReadinessValue: readiness,
    relevantSnapshot: () => ({ id: "snapshot-a", workspaceHash }),
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    now,
    requiredProviders: () => ["test", "review", "acceptance"],
    receiptValidity: (_id, provider) => ({
      validity: options.receiptOverrides?.[provider] || (provider === "test"
        ? (executionNeeded ? "missing" : "valid")
        : provider === "review"
          ? (phase === "review" ? "missing" : "valid")
          : (phase === "ready" ? "valid" : "missing"))
    }),
    rebindReusableReceipt: () => {},
    executionNodes: () => ({
      nodes: executionNeeded ? [{ provider: "test", covers: ["test"] }] : [],
      unconfigured: externalProviders(),
      unavailable: []
    }),
    collectableExecutionNodes: (_id, nodes) => ({ nodes, blocked: [] }),
    startRequiredServices: async () => [],
    runExecutionDag: async (_id, nodes) => {
      if (executionFailuresRemaining > 0) {
        executionFailuresRemaining -= 1;
        throw new Error("simulated provider interruption");
      }
      if (nodes.length) executions += 1;
      if (nodes.length) executionNeeded = false;
      return nodes.map((node) => ({ provider: node.provider, status: "pass" }));
    },
    durableArtifact: () => { throw new Error("no service artifacts expected"); },
    pendingTasks: () => [],
    proofPreflight: () => {},
    prove: () => {
      finalizations += 1;
      proof = {
        version: 2,
        status: "pass",
        proofRunId: `proof-${finalizations}`,
        workspaceHash,
        providers: ["test", "review", "acceptance"]
      };
      state = { ...state, status: "proven" };
    },
    proofAudit: () => options.invalidAudit
      ? { valid: false, reason: "invalid-proof" }
      : proof ? { valid: true, proof } : { valid: false, reason: "missing-proof" },
    readJson: () => proof,
    proofPath: () => "proof.json",
    providerCapability: (provider) => provider,
    providerConfig: (_id, provider) => ({
      adapter: provider === "test" ? "command" : "external"
    }),
    providerWorkspaceHash: (_id, provider, fallback) =>
      options.providerHashes?.[provider] || fallback,
    deliveredAiAttempts: () => options.deliveredAiAttempts || [],
    recordDeterministicReviewClosure: (_id, _provider, closureWorkspaceHash) => {
      closures += 1;
      closureWorkspaceHashes.push(closureWorkspaceHash);
      const result = options.closureResult || null;
      if (result?.closed) phase = "ready";
      return result;
    },
    authorityStatusValue: () => ({ requests: requests.map((request) => ({ ...request })) }),
    requestAuthority: (_id, flags) => {
      const provider = flags.type;
      const existing = requests.find((request) => request.provider === provider &&
        request.workspaceHash === workspaceHash &&
        ["requested", "dispatched", "pending"].includes(request.status));
      if (existing) return existing;
      const request = {
        requestId: `${provider}-${requests.length + 1}`,
        type: flags.type,
        provider,
        status: "requested",
        workspaceHash
      };
      requests.push(request);
      return request;
    },
    markBlocked: () => { blocked += 1; },
    die: (message) => { throw new Error(message); }
  });
  return {
    runtime,
    requests,
    setPhase: (next) => { phase = next; },
    moveWorkspace: (next) => {
      workspaceHash = next;
      executionNeeded = true;
      phase = "review";
    },
    counters: () => ({ executions, finalizations, blocked, closures }),
    closureWorkspaceHashes: () => [...closureWorkspaceHashes],
    state: () => state
  };
}

async function quiet(operation) {
  const priorLog = console.log;
  const priorError = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return await operation(); }
  finally {
    console.log = priorLog;
    console.error = priorError;
  }
}

async function captured(operation) {
  const lines = [];
  const priorLog = console.log;
  console.log = (...values) => lines.push(values.join(" "));
  try {
    const result = await operation();
    return { result, output: lines.join("\n") };
  } finally {
    console.log = priorLog;
  }
}

async function within(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

{
  const priorExitCode = process.exitCode;
  const blockedRun = fixture({ phase: "blocked" });
  const blocked = await quiet(() => blockedRun.runtime.proofRun("change-a"));
  assert.equal(blocked.status, "CONFIGURATION_ERROR");
  assert.equal(blockedRun.counters().blocked, 1);
  assert.equal(process.exitCode, 2);
  process.exitCode = priorExitCode;

  const successfulRun = fixture({ phase: "ready" });
  const passed = await quiet(() => successfulRun.runtime.proofRun("change-a"));
  assert.equal(passed.status, "PASS");
  assert.equal(passed.completed, true);
  assert.equal(passed.workspaceHash, "workspace-a");
  assert.deepEqual(passed.providers, ["test", "review", "acceptance"]);
  assert.deepEqual(successfulRun.counters(), {
    executions: 1, finalizations: 1, blocked: 0, closures: 0
  });

  const invalidRun = fixture({ phase: "ready", invalidAudit: true });
  const actionRequired = await quiet(() => invalidRun.runtime.proofRun("change-a"));
  assert.equal(actionRequired.status, "ACTION_REQUIRED");
  assert.match(actionRequired.proofRunId, /^proof-/);
}

{
  const readiness = { status: "CONFIGURATION_ERROR", issues: ["missing adapter"] };
  const printed = [];
  let blocked = 0;
  const runtimeProcess = { exitCode: 0 };
  assert.equal(stopProofCollection({
    printOutcome: (outcome) => printed.push(outcome),
    markBlocked: () => { blocked += 1; },
    runtimeProcess
  }, readiness), readiness);
  assert.deepEqual(printed, [{
    ...readiness, command: "proof collect", completed: false
  }]);
  assert.equal(blocked, 1);
  assert.equal(runtimeProcess.exitCode, 2);
  stopProofCollection({
    printOutcome: () => assert.fail("quiet collection stop must not print"),
    markBlocked: () => { blocked += 1; },
    runtimeProcess
  }, readiness, { quiet: true });
  assert.equal(blocked, 2);
}

{
  let state = { status: "building" };
  const snapshot = { id: "snapshot-a", workspaceHash: "workspace-a" };
  const proofRunId = beginProofCollection({
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    now: () => "2026-08-27T00:00:00.000Z",
    timestamp: () => 42
  }, "change-a", snapshot);
  assert.equal(proofRunId, "collect-42");
  assert.deepEqual(state.activeProofRun, {
    id: "collect-42",
    snapshotId: "snapshot-a",
    workspaceHash: "workspace-a",
    startedAt: "2026-08-27T00:00:00.000Z",
    mode: "collect"
  });
}

{
  const rebound = [];
  const validities = {
    inputs: "reusable-inputs",
    diff: "reusable-diff",
    current: "valid"
  };
  const snapshot = { workspaceHash: "workspace-a" };
  rebindProofCollectionReceipts({
    requiredProviders: () => Object.keys(validities),
    receiptValidity: (_id, provider) => ({ validity: validities[provider], provider }),
    rebindReusableReceipt: (_id, row) => rebound.push(`inputs:${row.provider}`),
    rebindDiffBoundReceipt: (_id, row) => rebound.push(`diff:${row.provider}`)
  }, "change-a", snapshot, "collect-42");
  assert.deepEqual(rebound, ["inputs:inputs", "diff:diff"]);
}

{
  assert.doesNotThrow(() => assertProofCollectionOutcomes([
    { provider: "test", status: "pass" }
  ]));
assert.throws(() => assertProofCollectionOutcomes([
  { provider: "test", status: "fail" },
  { provider: "lint", status: "error" }
]), /evidence collection failed: test:fail, lint:error/);

assert.throws(() => assertProofCollectionOutcomes([{
  provider: "test",
  status: "fail",
  observations: [
    { kind: "critical-case", id: "CC001", status: "missing" },
    { kind: "critical-case", id: "CC002", status: "pass" }
  ]
}]), /critical cases non-passing: CC001=missing; tag each covering test title with its literal \[case-id\] and rerun proof advance/);
}

{
  let state = { activeProofRun: { id: "collect-42" } };
  const durableCalls = [];
  persistProofCollectionArtifacts({
    stopAll: () => [{ path: "service-a.log" }, { path: "service-b.log" }],
    durableArtifact: (id, kind, runId, artifact) => {
      durableCalls.push({ id, kind, runId, artifact });
      return { path: artifact.path, digest: `digest-${durableCalls.length}` };
    },
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; }
  }, "change-a", "collect-42", [{ pid: 1 }]);
  assert.equal(durableCalls.length, 2);
  assert.deepEqual(durableCalls[0], {
    id: "change-a",
    kind: "service",
    runId: "collect-42",
    artifact: { path: "service-a.log", type: "service-log", required: true }
  });
  assert.deepEqual(state.collectedServiceArtifacts, [
    { path: "service-a.log", digest: "digest-1" },
    { path: "service-b.log", digest: "digest-2" }
  ]);
}

{
  const readiness = { status: "NEEDS_USER_DECISION", externalProviders: ["review"] };
  const outcome = proofCollectionOutcome(
    "change-a",
    { workspaceHash: "workspace-a" },
    "collect-42",
    [{ provider: "test", status: "pass" }],
    { blocked: ["browser"] },
    readiness
  );
  assert.deepEqual(outcome.executedProviders, ["test"]);
  assert.deepEqual(outcome.blockedExecutableProviders, ["browser"]);
  assert.deepEqual(outcome.remainingExternalProviders, ["review"]);
  const writes = [];
  const prints = [];
  const managed = settleProofCollection({
    writeAdvance: (_id, value) => {
      writes.push(value);
      return { ...value, progressed: true };
    },
    printOutcome: (value) => prints.push(value)
  }, "change-a", outcome, readiness, { includeReadiness: true });
  assert.equal(writes[0].stage, "evidence-collected");
  assert.equal(managed.progressed, true);
  assert.equal(managed.readiness, readiness);
  assert.equal(prints.length, 1);
  const unmanaged = settleProofCollection({
    writeAdvance: () => assert.fail("unmanaged collection must not write an advance"),
    printOutcome: () => assert.fail("quiet collection must not print")
  }, "change-a", outcome, readiness, {
    manageReservation: false,
    quiet: true,
    includeReadiness: false
  });
  assert.equal(unmanaged, outcome);
}

const serialized = fixture();
let releaseMutation;
let mutationStarted;
const mutationStartedPromise = new Promise((resolve) => { mutationStarted = resolve; });
const mutationGate = new Promise((resolve) => { releaseMutation = resolve; });
const mutationHolder = serialized.runtime.guardProofMutation(
  "change-a", "authority record", async () => {
    mutationStarted();
    await mutationGate;
    return "recorded";
  });
await within(mutationStartedPromise, 5_000,
  "guardProofMutation never entered its critical section");
const contendedMutation = await captured(() =>
  serialized.runtime.guardProofMutation(
    "change-a", "evidence receipt", () => "must-not-run"));
assert.equal(contendedMutation.result.status, "IN_PROGRESS");
assert.equal(JSON.parse(contendedMutation.output).status, "IN_PROGRESS");
releaseMutation();
assert.equal(await mutationHolder, "recorded",
  "all public proof mutations must share one per-change lock");

const flow = fixture();
const first = await quiet(() => flow.runtime.proofAdvance("change-a"));
assert.equal(first.status, "WAITING_EXTERNAL");
assert.equal(first.stage, "review");
assert.equal(first.progressed, true);
assert.equal(flow.counters().executions, 1,
  "the first advance executes available project evidence once");
assert.deepEqual(flow.requests.map((request) => request.type), ["review"],
  "review is requested before acceptance");

const unchangedReview = await quiet(() => flow.runtime.proofAdvance("change-a"));
assert.equal(unchangedReview.status, "WAITING_EXTERNAL");
assert.equal(unchangedReview.stage, "review");
assert.equal(unchangedReview.progressed, false,
  "an unchanged wait must be reported as a resumable no-op");
assert.equal(flow.counters().executions, 1,
  "an unchanged wait must not rerun executable evidence");
assert.equal(flow.requests.length, 1,
  "an unchanged wait must reuse the open authority request");

flow.requests[0].status = "completed";
flow.setPhase("acceptance");
const acceptance = await quiet(() => flow.runtime.proofAdvance("change-a"));
assert.equal(acceptance.stage, "acceptance");
assert.deepEqual(flow.requests.map((request) => request.type), ["review", "acceptance"]);
const unchangedAcceptance = await quiet(() => flow.runtime.proofAdvance("change-a"));
assert.equal(unchangedAcceptance.progressed, false);
assert.equal(flow.requests.length, 2,
  "acceptance waiting must also reuse its open request");

const externalEvidence = fixture({ phase: "external", executionNeeded: false });
const externalWait = await quiet(() =>
  externalEvidence.runtime.proofAdvance("change-a"));
assert.equal(externalWait.status, "WAITING_EXTERNAL");
assert.equal(externalWait.stage, "external-evidence");
assert.deepEqual(externalWait.providers, ["external"]);

const unclassified = fixture({
  phase: "unclassified",
  executionNeeded: false,
  receiptOverrides: { acceptance: "valid" }
});
await assert.rejects(() => quiet(() =>
  unclassified.runtime.proofAdvance("change-a")),
/could not classify readiness/,
"an unclassified decision state fails instead of spinning");

flow.requests[1].status = "completed";
flow.setPhase("ready");
const passed = await quiet(() => flow.runtime.proofAdvance("change-a"));
assert.equal(passed.status, "PASS");
assert.equal(flow.counters().finalizations, 1);
const alreadyPassed = await quiet(() => flow.runtime.proofAdvance("change-a"));
assert.equal(alreadyPassed.status, "PASS");
assert.equal(alreadyPassed.reused, true);
assert.equal(flow.counters().finalizations, 1,
  "a fresh existing proof must not be finalized again");

flow.moveWorkspace("workspace-b");
const movedWorkspace = await quiet(() => flow.runtime.proofAdvance("change-a"));
assert.equal(movedWorkspace.status, "WAITING_EXTERNAL");
assert.equal(movedWorkspace.stage, "review");
assert.equal(flow.counters().executions, 2,
  "a proof whose audited artifacts are intact but whose workspace moved is not reused");
assert.equal(flow.counters().finalizations, 1,
  "the moved workspace must earn fresh authority before finalization");

const rejected = fixture({
  requests: [{
    requestId: "review-rejected", type: "review", provider: "review",
    status: "rejected", workspaceHash: "workspace-a"
  }]
});
const rejectedResult = await quiet(() => rejected.runtime.proofAdvance("change-a"));
assert.equal(rejectedResult.status, "ACTION_REQUIRED");
assert.equal(rejectedResult.stage, "review-rejected");
assert.equal(rejectedResult.cursor.stage, "review-rejected");
assert.deepEqual(rejectedResult.cursor.requestIds, ["review-rejected"]);
assert.equal(rejected.requests.length, 1,
  "a rejected unchanged review must not create a doomed follow-up request");
const rejectedAgain = await quiet(() => rejected.runtime.proofAdvance("change-a"));
assert.equal(rejectedAgain.status, "NEEDS_USER_DECISION");
assert.equal(rejectedAgain.route, "NO_PROGRESS_DECISION");
assert.equal(rejectedAgain.progressed, false);
assert.equal(rejectedAgain.decision.kind, "repair-no-progress");
assert.equal(rejectedAgain.cursor.route, "NO_PROGRESS_DECISION");
assert.deepEqual(rejectedAgain.cursor.decision, rejectedAgain.decision,
  "the durable cursor preserves the exact work decision");
assert.deepEqual(rejectedAgain.cursor.next, rejectedAgain.next,
  "the durable cursor preserves the exact resume choices");
assert.equal(rejectedAgain.next[0].command,
  "claude-foundation packet change-a --phase build",
  "an unchanged rejected review pauses with supported choices and a resume route");

const failedReceipt = fixture({
  receiptOverrides: { review: "fail" },
  deliveredAiAttempts: [{
    digest: "attempt-failed", attempt: 1, workspaceHash: "review-subject-a",
    resultStatus: "fail", findings: [{
      id: "F-BLOCK", severity: "major", path: "src/app.mjs", line: 1,
      message: "repair this", claimIds: ["claim-a"],
      verificationCaseIds: ["CASE-A"]
    }]
  }],
  providerHashes: { review: "review-subject-a" }
});
const failedReceiptResult = await quiet(() =>
  failedReceipt.runtime.proofAdvance("change-a"));
assert.equal(failedReceiptResult.route, "AUTO_REPAIR");
assert.deepEqual(failedReceiptResult.repairBatch.findingIds, ["F-BLOCK"],
  "a real failed review receipt reaches the bounded repair route");
const failedReceiptAgain = await quiet(() =>
  failedReceipt.runtime.proofAdvance("change-a"));
assert.equal(failedReceiptAgain.status, "NEEDS_USER_DECISION",
  "a repeated failed receipt pauses against the stable review subject");
assert.equal(failedReceiptAgain.route, "NO_PROGRESS_DECISION");
assert.equal(failedReceiptAgain.repairPlan.tasks.length, 1,
  "the no-progress decision preserves the claim-bound repair plan");
assert.deepEqual(failedReceiptAgain.cursor.repairPlan, failedReceiptAgain.repairPlan,
  "the durable cursor preserves the repair plan across process restarts");

const failedTestEvidence = fixture({
  executionNeeded: false,
  receiptOverrides: { test: "fail" }
});
const failedTestResult = await quiet(() =>
  failedTestEvidence.runtime.proofAdvance("change-a"));
assert.equal(failedTestResult.status, "ACTION_REQUIRED");
assert.equal(failedTestResult.route, "AUTO_REPAIR");
assert.equal(failedTestResult.stage, "evidence-failed");
assert.equal(failedTestResult.repairPlan.tasks[0].findingIds[0], "test:fail");
const failedTestAgain = await quiet(() =>
  failedTestEvidence.runtime.proofAdvance("change-a"));
assert.equal(failedTestAgain.status, "NEEDS_USER_DECISION");
assert.equal(failedTestAgain.route, "NO_PROGRESS_DECISION");
assert.equal(failedTestAgain.progressed, false,
  "unchanged failed evidence pauses instead of repeating an identical repair");
assert.equal(failedTestAgain.next[0].command,
  "claude-foundation packet change-a --phase build");

const productiveRepairs = fixture({
  receiptOverrides: { review: "fail" },
  deliveredAiAttempts: [{
    digest: "attempt-repairable", attempt: 1, workspaceHash: "workspace-a",
    resultStatus: "fail", findings: [{
      id: "F-PRODUCT", severity: "major", path: "src/app.mjs", line: 1,
      message: "repair this", claimIds: ["claim-a"],
      verificationCaseIds: ["CASE-A"]
    }]
  }]
});
const productiveFirst = await quiet(() =>
  productiveRepairs.runtime.proofAdvance("change-a"));
assert.equal(productiveFirst.status, "ACTION_REQUIRED");
assert.equal(productiveFirst.cursor.repairCycle, 1);
productiveRepairs.moveWorkspace("workspace-b");
const productiveSecond = await quiet(() =>
  productiveRepairs.runtime.proofAdvance("change-a"));
assert.equal(productiveSecond.status, "ACTION_REQUIRED");
assert.equal(productiveSecond.progressed, true);
assert.equal(productiveSecond.cursor.repairCycle, 2);
productiveRepairs.moveWorkspace("workspace-c");
const productiveThird = await quiet(() =>
  productiveRepairs.runtime.proofAdvance("change-a"));
assert.equal(productiveThird.status, "ACTION_REQUIRED");
assert.equal(productiveThird.progressed, true);
assert.equal(productiveThird.cursor.repairCycle, 3,
  "productive repairs continue without a fixed cycle limit");

const subjectRequest = fixture({
  requests: [{
    requestId: "review-subject-request", type: "review", provider: "review",
    status: "rejected", workspaceHash: "review-subject-a"
  }],
  providerHashes: { review: "review-subject-a" }
});
const subjectRequestResult = await quiet(() =>
  subjectRequest.runtime.proofAdvance("change-a"));
assert.equal(subjectRequestResult.stage, "review-rejected",
  "proof matches unscoped authority requests in the review-hash domain");

const blocked = fixture({ phase: "blocked" });
const blockedResult = await quiet(() => blocked.runtime.proofAdvance("change-a"));
assert.equal(blockedResult.status, "CONFIGURATION_ERROR");
assert.equal(blocked.counters().blocked, 1,
  "a real configuration blocker remains a blocked operation");
assert.equal(blocked.counters().executions, 0);

process.exitCode = 0;
const blockedCollection = fixture({ phase: "blocked" });
const blockedCollectionResult = await quiet(() =>
  blockedCollection.runtime.proofCollect("change-a"));
assert.equal(blockedCollectionResult.status, "CONFIGURATION_ERROR");
assert.equal(blockedCollection.counters().blocked, 1,
  "proof collect preserves a typed readiness stop without starting providers");
assert.equal(blockedCollection.counters().executions, 0);
process.exitCode = 0;

process.exitCode = 0;
const interrupted = fixture({ phase: "ready", failExecutionOnce: true });
await assert.rejects(
  quiet(() => interrupted.runtime.proofAdvance("change-a")),
  /simulated provider interruption/);
const indeterminate = await quiet(() =>
  interrupted.runtime.proofAdvance("change-a"));
assert.equal(indeterminate.status, "ACTION_REQUIRED");
assert.equal(indeterminate.stage, "execution-indeterminate");
assert.equal(interrupted.counters().executions, 0,
  "an interrupted reservation must not retry provider side effects automatically");
process.exitCode = 0;
const recovered = await quiet(() => interrupted.runtime.proofAdvance("change-a", {
  "retry-indeterminate": true,
  "decision-ref": "host:user-inspected-provider-side-effects"
}));
assert.equal(recovered.status, "PASS");
assert.equal(interrupted.counters().executions, 1,
  "an indeterminate run resumes only after an explicit durable decision reference");

for (const command of ["proofCollect", "proofExecute", "proofRun"]) {
  process.exitCode = 0;
  const lowerLevelInterrupted = fixture({ phase: "ready", failExecutionOnce: true });
  await assert.rejects(
    quiet(() => lowerLevelInterrupted.runtime[command]("change-a")),
    /simulated provider interruption/);
  const lowerLevelRecovery = await quiet(() =>
    lowerLevelInterrupted.runtime.proofAdvance("change-a"));
  assert.equal(lowerLevelRecovery.status, "ACTION_REQUIRED");
  assert.equal(lowerLevelRecovery.stage, "execution-indeterminate");
  assert.equal(lowerLevelInterrupted.counters().executions, 0,
    `a crashed retained ${command} command must reserve before execution and must not be retried automatically by proof advance`);
}

const twiceInterrupted = fixture({ phase: "ready", failExecutionCount: 2 });
await assert.rejects(
  quiet(() => twiceInterrupted.runtime.proofAdvance("change-a")),
  /simulated provider interruption/);
await quiet(() => twiceInterrupted.runtime.proofAdvance("change-a"));
process.exitCode = 0;
await assert.rejects(quiet(() => twiceInterrupted.runtime.proofAdvance("change-a", {
  "retry-indeterminate": true,
  "decision-ref": "host:first-inspection"
})), /simulated provider interruption/);
await quiet(() => twiceInterrupted.runtime.proofAdvance("change-a"));
process.exitCode = 0;
await assert.rejects(quiet(() => twiceInterrupted.runtime.proofAdvance("change-a", {
  "retry-indeterminate": true,
  "decision-ref": "host:first-inspection"
})), /decision was already consumed/,
"one decision reference must not authorize repeated crash retries");
const secondRecovery = await quiet(() =>
  twiceInterrupted.runtime.proofAdvance("change-a", {
    "retry-indeterminate": true,
    "decision-ref": "host:second-inspection"
  }));
assert.equal(secondRecovery.status, "PASS");

const rejectedAcceptance = fixture({
  phase: "acceptance",
  requests: [{
    requestId: "acceptance-rejected", type: "acceptance", provider: "acceptance",
    status: "rejected", workspaceHash: "workspace-a"
  }]
});
const rejectedAcceptanceResult = await quiet(() =>
  rejectedAcceptance.runtime.proofAdvance("change-a"));
assert.equal(rejectedAcceptanceResult.status, "ACTION_REQUIRED");
assert.equal(rejectedAcceptanceResult.stage, "acceptance-rejected");
assert.equal(rejectedAcceptance.requests.length, 1,
  "a terminal acceptance outcome must not create another request automatically");

process.exitCode = 0;
const staleCompletedReview = fixture({
  executionNeeded: false,
  receiptOverrides: { review: "review-version-stale" },
  requests: [{
    requestId: "review-old-version", type: "review", provider: "review",
    status: "completed", workspaceHash: "workspace-a"
  }]
});
const staleCompletedResult = await quiet(() =>
  staleCompletedReview.runtime.proofAdvance("change-a"));
assert.equal(staleCompletedResult.status, "WAITING_EXTERNAL");
assert.equal(staleCompletedResult.stage, "review");
assert.equal(staleCompletedReview.requests.length, 2,
  "a completed request whose receipt protocol is stale must create one fresh request instead of being misclassified as a rejection");

process.exitCode = 0;
const failedProvider = fixture({
  phase: "ready",
  executionNeeded: false,
  receiptOverrides: { test: "fail" }
});
const failedProviderResult = await quiet(() =>
  failedProvider.runtime.proofAdvance("change-a"));
assert.equal(failedProviderResult.status, "ACTION_REQUIRED");
assert.equal(failedProviderResult.stage, "evidence-failed");
assert.equal(failedProvider.counters().executions, 0,
  "a known failed provider result must not be rerun in an automatic fix loop");

process.exitCode = 0;
const finalDeltaClosure = fixture({
  executionNeeded: false,
  providerHashes: { review: "review-provider-workspace" },
  deliveredAiAttempts: [
    { resultStatus: "pass" },
    { resultStatus: "fail" }
  ],
  closureResult: {
    closed: true,
    route: "REVIEW_ROUTE_COMPLETE",
    findingIds: ["F-FINAL"]
  }
});
const closedDeltaResult = await quiet(() =>
  finalDeltaClosure.runtime.proofAdvance("change-a"));
assert.equal(closedDeltaResult.status, "PASS");
assert.equal(finalDeltaClosure.counters().closures, 1);
assert.deepEqual(finalDeltaClosure.closureWorkspaceHashes(),
  ["review-provider-workspace"],
  "deterministic closure must bind the review provider hash, not the global workspace hash");
assert.equal(finalDeltaClosure.requests.length, 0,
  "current critical-case evidence closes the final AI delta without a third review request");

process.exitCode = 0;
const unmappedDelta = fixture({
  executionNeeded: false,
  deliveredAiAttempts: [
    { resultStatus: "fail" },
    { resultStatus: "fail" }
  ],
  closureResult: {
    closed: false,
    route: "AUTO_REPAIR",
    reason: "finding is not yet bound to a passing critical case"
  }
});
const unmappedDeltaResult = await quiet(() =>
  unmappedDelta.runtime.proofAdvance("change-a"));
assert.equal(unmappedDeltaResult.status, "ACTION_REQUIRED");
assert.equal(unmappedDeltaResult.route, "AUTO_REPAIR");
assert.equal(unmappedDelta.requests.length, 0,
  "an unproven final fix returns to Build without asking the user or dispatching another reviewer");

process.exitCode = 0;
const singleDocument = fixture();
const capturedResult = await captured(() =>
  singleDocument.runtime.proofAdvance("change-a"));
assert.deepEqual(JSON.parse(capturedResult.output), capturedResult.result,
  "proof advance stdout must be exactly one parseable JSON document");
assert.ok(Buffer.byteLength(capturedResult.output) < 8_192,
  "proof advance output must fit in a compact host-control response");

const hugeAuthority = fixture({
  executionNeeded: false,
  requests: [{
    requestId: "review-large-packet",
    type: "review",
    provider: "review",
    status: "requested",
    workspaceHash: "workspace-a",
    packetDigest: "a".repeat(64),
    packet: { payload: "x".repeat(64_000) }
  }]
});
const compactAuthority = await captured(() =>
  hugeAuthority.runtime.proofAdvance("change-a"));
const compactDocument = JSON.parse(compactAuthority.output);
assert.ok(Buffer.byteLength(compactAuthority.output) < 8_192,
  "proof advance must not echo full authority packets");
assert.equal(compactDocument.requests[0].packet, undefined);
assert.equal(compactDocument.requests[0].packetDigest, "a".repeat(64));
assert.match(compactDocument.requests[0].packetCommand, /authority status/);

const receiptFixture = mkdtempSync(join(tmpdir(), "proof-advance-receipt-"));
try {
  const staleFailedReceiptPath = join(receiptFixture, "review.json");
  writeFileSync(staleFailedReceiptPath, `${JSON.stringify({
    providerProtocolVersion: "1",
    reviewProtocolVersion: "1",
    contractFingerprint: "contract-a",
    provider: "review",
    status: "fail",
    workspaceHash: "workspace-before-correction",
    review: { findings: { unresolvedBlockers: 4 } }
  })}\n`);
  const validity = createReceiptValidity({
    evidenceVault: receiptFixture,
    providerProtocolVersion: "1",
    adapterProtocolVersion: "1",
    reviewProtocolVersion: "1",
    acceptanceProtocolVersion: "1",
    receiptPath: () => staleFailedReceiptPath,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    receiptPrototypeEvidence: () => false,
    contractFingerprint: () => "contract-a",
    providerConfig: () => ({ adapter: "external" }),
    providerCapability: () => "review",
    reviewProvenanceResult: () => ({ complete: true, independent: true, diverse: true }),
    reviewPolicy: () => ({ independence: "required", diversity: "preferred" }),
    reviewAttemptByDigest: () => null,
    reviewAttemptIsValid: () => true,
    resolvedAcceptance: () => ({}),
    claimsForProvider: () => [],
    stableHash: (value) => JSON.stringify(value),
    adapterFingerprint: () => "adapter",
    providerWorkspaceHash: () => "workspace-after-correction",
    providerInputIdentity: () => ({ mode: "workspace", fingerprint: "inputs" }),
    validateArtifact: () => true,
    relevantHash: () => "workspace-after-correction"
  }).receiptValidity("change-a", "review", "workspace-after-correction");
  assert.equal(validity.validity, "stale",
    "a failed review from the pre-correction workspace must become stale before its blockers are considered");
} finally {
  rmSync(receiptFixture, { recursive: true, force: true });
}

// A review wait must never prescribe a command the wave cap will refuse: with
// every allotted AI wave delivered, `authority run` is guaranteed to block, so
// the wait must route to the external recording template instead.
{
  const capped = fixture({
    deliveredAiAttempts: [
      { digest: "wave-1", resultStatus: "fail" },
      { digest: "wave-2", resultStatus: "pass" }
    ]
  });
  const wait = await quiet(() => capped.runtime.proofAdvance("change-a"));
  assert.equal(wait.status, "WAITING_EXTERNAL");
  assert.equal(wait.stage, "review");
  const command = wait.next?.[0]?.command || "";
  assert.match(command, /authority status .* --template/,
    "an exhausted AI review route prescribes the external recording template");
  assert.doesNotMatch(command, /authority run/,
    "an exhausted AI review route must not prescribe a blocked authority run");
}
{
  const open = fixture();
  const wait = await quiet(() => open.runtime.proofAdvance("change-a"));
  assert.equal(wait.status, "WAITING_EXTERNAL");
  assert.match(wait.next?.[0]?.command || "",
    /authority run .* --subject-actor implementation-agent$/,
    "an unexhausted AI review route prescribes an executable authority command");
}

process.exitCode = 0;

console.log("proof advance tests: PASS");
