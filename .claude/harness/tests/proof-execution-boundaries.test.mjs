import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExecutionAvailable,
  executionAvailabilityError,
  prepareProofExecution,
  proofExecutionAdvanceValue,
  proofExecutionResult,
  proofRunExecutionStops,
  proofRunOutcome,
  runProofExecutionNodes,
  stopProofRun,
  writeProofExecutionAdvance
} from "../runtime/evidence/proof-execution-runtime.mjs";

function preparationFixture(overrides = {}) {
  const calls = [];
  const state = { id: "change-a" };
  return {
    calls,
    state,
    context: {
      proofPreflight: (...args) => calls.push(["preflight", ...args]),
      pendingTasks: () => [],
      die: (message) => { throw new Error(message); },
      relevantSnapshot: () => ({ id: "snapshot-a", workspaceHash: "hash-a" }),
      loadRuntime: () => state,
      saveRuntime: (value) => calls.push(["save", value]),
      now: () => "2026-08-26T00:00:00.000Z",
      requiredProviders: () => ["inputs", "diff", "fresh"],
      receiptValidity: (_id, provider) => ({
        provider,
        validity: provider === "inputs" ? "reusable-inputs"
          : provider === "diff" ? "reusable-diff" : "valid"
      }),
      rebindReusableReceipt: (...args) => calls.push(["inputs", ...args]),
      rebindDiffBoundReceipt: (...args) => calls.push(["diff", ...args]),
      ...overrides
    }
  };
}

test("proof execution preparation starts a run and rebinds reusable receipts", () => {
  const fixture = preparationFixture();
  const result = prepareProofExecution(fixture.context, "change-a");

  assert.equal(result.snapshot.workspaceHash, "hash-a");
  assert.match(result.proofRunId, /^proof-\d+$/);
  assert.deepEqual(fixture.calls[0], ["preflight", "change-a", "prove", true]);
  assert.equal(fixture.calls.filter(([kind]) => kind === "save").length, 1);
  assert.equal(fixture.calls.filter(([kind]) => kind === "inputs").length, 1);
  assert.equal(fixture.calls.filter(([kind]) => kind === "diff").length, 1);
  assert.equal(fixture.state.activeProofRun.workspaceHash, "hash-a");
});

test("proof execution preparation accepts a supplied snapshot without preflight", () => {
  const fixture = preparationFixture({
    proofPreflight: () => assert.fail("preflight should be skipped"),
    relevantSnapshot: () => assert.fail("snapshot should be reused"),
    requiredProviders: () => []
  });
  const snapshot = { id: "snapshot-b", workspaceHash: "hash-b" };
  assert.equal(prepareProofExecution(fixture.context, "change-a", {
    preflight: false,
    snapshot
  }).snapshot, snapshot);
});

test("proof execution preparation refuses unchecked implementation tasks", () => {
  const fixture = preparationFixture({ pendingTasks: () => ["one", "two"] });
  assert.throws(() => prepareProofExecution(fixture.context, "change-a"),
    /2 implementation task\(s\) remain unchecked/);
});

test("execution availability diagnostics prioritize configuration before environment", () => {
  assert.equal(executionAvailabilityError({
    unconfigured: ["review"], unavailable: ["test"]
  }, "change-a"),
  "missing executable adapter for provider(s): review; record external receipts or configure evidence v2");
  assert.equal(executionAvailabilityError({
    unconfigured: [], unavailable: ["test", "lint"]
  }, "change-a"),
  "provider environment unavailable: test, lint; run doctor --stage prove --change change-a");
  assert.equal(executionAvailabilityError({ unconfigured: [], unavailable: [] }, "change-a"), null);
  assert.throws(() => assertExecutionAvailable({
    unconfigured: ["review"], unavailable: []
  }, "change-a"), /missing executable adapter/);
  assert.doesNotThrow(() => assertExecutionAvailable({
    unconfigured: [], unavailable: []
  }, "change-a"));
});

test("proof execution advance represents valid and invalid audits", () => {
  const snapshot = { workspaceHash: "hash-a" };
  const nodes = [{ provider: "test" }, { provider: "lint" }];
  const valid = proofExecutionAdvanceValue(
    "change-a", {}, snapshot, "proof-1", nodes,
    { valid: true, proof: { providers: ["test"] } });
  assert.equal(valid.status, "PASS");
  assert.equal(valid.command, "proof execute");
  assert.deepEqual(valid.executedProviders, ["test", "lint"]);
  assert.deepEqual(valid.next, [{
    kind: "land", command: "claude-foundation land check change-a"
  }]);

  const withoutProviders = proofExecutionAdvanceValue(
    "change-a", { command: "proof run" }, snapshot, "proof-2", nodes,
    { valid: true, proof: {} });
  assert.deepEqual(withoutProviders.providers, []);
  assert.equal(withoutProviders.command, "proof run");

  const invalid = proofExecutionAdvanceValue(
    "change-a", {}, snapshot, "proof-3", nodes, { valid: false });
  assert.equal(invalid.status, "ACTION_REQUIRED");
  assert.equal(invalid.stage, "proof-invalid");
  assert.equal(invalid.completed, false);
  assert.deepEqual(invalid.providers, []);
  assert.deepEqual(invalid.next, []);
});

test("proof execution advance is omitted without a managed executed provider", () => {
  const args = ["change-a", {}, { workspaceHash: "hash-a" }, "proof-1"];
  assert.equal(proofExecutionAdvanceValue(...args, [], { valid: true }), null);
  assert.equal(proofExecutionAdvanceValue(
    "change-a", { manageReservation: false }, { workspaceHash: "hash-a" },
    "proof-1", [{ provider: "test" }], { valid: true }), null);
});

test("proof execution nodes run the DAG or report fully reused receipts", async () => {
  const calls = [];
  const context = {
    runExecutionDag: async (...args) => calls.push(["run", ...args]),
    log: (message) => calls.push(["log", message])
  };
  await runProofExecutionNodes(
    context, "change-a", [{ provider: "test" }], "proof-1", { quiet: true });
  await runProofExecutionNodes(context, "change-a", [], "proof-2", { quiet: false });
  await runProofExecutionNodes(context, "change-a", [], "proof-3", { quiet: true });
  assert.equal(calls.filter(([kind]) => kind === "run").length, 1);
  assert.deepEqual(calls.filter(([kind]) => kind === "log"),
    [["log", "EXECUTION proof-2: all receipts reused"]]);
});

test("proof execution advance writer persists only a material advance", () => {
  const writes = [];
  const context = { writeAdvance: (...args) => writes.push(args) };
  const snapshot = { workspaceHash: "hash-a" };
  writeProofExecutionAdvance(context, "change-a", {}, snapshot, "proof-1",
    [{ provider: "test" }], { valid: true, proof: { providers: ["test"] } });
  writeProofExecutionAdvance(context, "change-a", {}, snapshot, "proof-2", [],
    { valid: true, proof: { providers: [] } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "change-a");
  assert.equal(writes[0][1].status, "PASS");
});

test("proof run boundaries stop non-ready work and project successful proof output", () => {
  const calls = [];
  const runtimeProcess = { exitCode: 0 };
  const readiness = { status: "BLOCKED", reason: "not ready" };
  assert.strictEqual(stopProofRun({
    printOutcome: (value) => calls.push(value),
    markBlocked: () => calls.push("blocked"),
    runtimeProcess
  }, readiness), readiness);
  assert.equal(calls[0].command, "proof run");
  assert.equal(calls[0].completed, false);
  assert.equal(calls[1], "blocked");
  assert.equal(runtimeProcess.exitCode, 2);

  const quietCalls = [];
  stopProofRun({
    printOutcome: () => quietCalls.push("printed"),
    markBlocked: () => quietCalls.push("blocked"),
    runtimeProcess: { exitCode: 0 }
  }, readiness, { quiet: true });
  assert.deepEqual(quietCalls, ["blocked"]);

  assert.equal(proofRunExecutionStops({ stage: "execution-indeterminate" }), true);
  assert.equal(proofRunExecutionStops({ status: "ACTION_REQUIRED" }), true);
  assert.equal(proofRunExecutionStops({ status: "PASS" }), false);
  assert.equal(proofRunExecutionStops(null), false);
  assert.deepEqual(proofRunOutcome("change-a", {
    workspaceHash: "hash-a", proofRunId: "proof-a", providers: ["test"]
  }), {
    version: 1, changeId: "change-a", command: "proof run", status: "PASS",
    completed: true, proofRunId: "proof-a", workspaceHash: "hash-a",
    providers: ["test"]
  });
  assert.deepEqual(proofRunOutcome("change-b", { workspaceHash: "hash-b" }), {
    version: 1, changeId: "change-b", command: "proof run", status: "PASS",
    completed: true, proofRunId: null, workspaceHash: "hash-b", providers: []
  });
});

test("proof execution result reflects audit validity", () => {
  assert.deepEqual(proofExecutionResult({ valid: true }, "proof-1"),
    { status: "PASS", proofRunId: "proof-1" });
  assert.deepEqual(proofExecutionResult({ valid: false }, "proof-2"),
    { status: "ACTION_REQUIRED", proofRunId: "proof-2" });
});
