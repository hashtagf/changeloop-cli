import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createAgentDispatchRuntime } from "../runtime/workflow/agent-dispatch.mjs";
import { routeRuntimeCommand } from "../runtime/core/cli-router.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const task = (id, repository = "root") => ({
  id,
  repository,
  model: { tier: "standard", family: "sonnet" }
});

function plan(overrides = {}) {
  return {
    graphRevision: "graph-v2-abc",
    graphIdentity: "abc",
    planDigest: "plan-abc",
    contractRevision: 2,
    workspaceHash: "workspace-abc",
    maxParallelAgents: 3,
    dispatchable: true,
    blockingReasons: [],
    recommendedExecution: "planned-agents",
    executionReason: "independent tasks",
    groups: [["T001", "T002"]],
    tasks: [task("T001", "api"), task("T002", "app")],
    sessionModel: null,
    ...overrides
  };
}

function runtime(planValue, leases = [], planSummaryBytes = 4096) {
  return createAgentDispatchRuntime({
    agentPlanValue: () => planValue,
    activeChangeLeases: () => leases,
    stableHash: hash,
    policy: () => ({ execution: { planSummaryBytes } }),
    fail: (message) => { throw new Error(message); }
  });
}

test("parallel decision is bounded and requires acquire before packet", () => {
  const value = runtime(plan({
    maxParallelAgents: 2,
    groups: [["T001", "T002", "T003"]],
    tasks: [task("T001"), task("T002"), task("T003")]
  })).dispatchValue("dispatch-change");

  assert.equal(value.action, "spawn-group");
  assert.equal(value.workerCount, 2);
  assert.equal(value.contextPolicy.acquireBeforePacket, true);
  assert.equal(value.contextPolicy.parentTranscript, "excluded");
  for (const worker of value.workers) {
    assert.match(worker.acquireCommand, /^claude-foundation agents acquire /);
    assert.match(worker.packetCommand, /^claude-foundation packet .* --task T/);
    assert.match(worker.releaseCommand, /^claude-foundation agents release /);
  }
});

test("owner suggestions are stable for the same graph task", () => {
  const dispatch = runtime(plan());
  const first = dispatch.dispatchValue("dispatch-change");
  const second = dispatch.dispatchValue("dispatch-change");
  assert.deepEqual(first.workers.map((worker) => worker.owner),
    second.workers.map((worker) => worker.owner));
});

test("a live lease returns wait and never another spawn group", () => {
  const value = runtime(plan(), [{
    taskId: "T001",
    owner: "worker-a",
    leaseId: "lease-a",
    fencingGeneration: 7,
    executionAttempt: 2,
    expiresAt: "2026-08-19T08:00:00.000Z"
  }]).dispatchValue("dispatch-change");

  assert.equal(value.action, "wait");
  assert.equal(value.activeWorkers[0].owner, "worker-a");
  assert.equal("workers" in value, false);
});

test("single-agent and completed plans preserve the cheap path", () => {
  const single = runtime(plan({
    recommendedExecution: "single-agent",
    executionReason: "one repository",
    groups: [["T001"]],
    tasks: [task("T001")],
    sessionModel: { tier: "standard", family: "sonnet" }
  })).dispatchValue("dispatch-change");
  assert.equal(single.action, "run-in-session");
  assert.match(single.packetCommand, /--phase build$/);

  const complete = runtime(plan({
    recommendedExecution: "proof-ready",
    executionReason: "all implementation tasks are complete",
    groups: [],
    tasks: []
  })).dispatchValue("dispatch-change");
  assert.equal(complete.action, "build-complete");
  assert.equal(complete.nextCommand,
    "claude-foundation proof readiness dispatch-change");
});

test("a non-dispatchable plan returns its existing blockers", () => {
  const value = runtime(plan({
    dispatchable: false,
    blockingReasons: ["scope path:root:src is active in another-change"]
  })).dispatchValue("dispatch-change");
  assert.equal(value.action, "blocked");
  assert.equal(value.reasons.count, 1);
  assert.deepEqual(value.reasons.preview,
    ["scope path:root:src is active in another-change"]);
  assert.match(value.reasons.digest, /^[a-f0-9]{64}$/);
  assert.equal("workers" in value, false);
});

test("oversized dispatch output returns a bounded recovery action", () => {
  const dispatch = runtime(plan({
    maxParallelAgents: 16,
    groups: [[...Array(16)].map((_, index) => `T${String(index + 1).padStart(3, "0")}`)],
    tasks: [...Array(16)].map((_, index) =>
      task(`T${String(index + 1).padStart(3, "0")}`, `repository-${"x".repeat(80)}-${index}`))
  }), [], 1024);
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { output += String(chunk); return true; };
  try {
    dispatch.showDispatch("dispatch-change");
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.ok(Buffer.byteLength(output) <= 1024);
  const value = JSON.parse(output);
  assert.ok(["spawn-group", "blocked"].includes(value.action));
  if (value.action === "spawn-group") assert.equal(value.workersTruncated, true);
  else assert.match(value.nextCommand, /agents plan/);
});

test("runtime router exposes the strict host dispatch command", async () => {
  let call = null;
  await routeRuntimeCommand("agent-dispatch", ["dispatch-change", "--pretty"], {
    parseStrictCommandFlags(values, label, spec) {
      assert.equal(label, "agents dispatch");
      assert.deepEqual(spec, { boolean: ["pretty"] });
      return {
        flags: { pretty: values.includes("--pretty") },
        rest: values.filter((value) => !value.startsWith("--"))
      };
    },
    showAgentDispatch(id, flags) { call = { id, flags }; },
    fail(message) { throw new Error(message); }
  });
  assert.deepEqual(call, { id: "dispatch-change", flags: { pretty: true } });
});
