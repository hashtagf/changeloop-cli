import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createAgentDispatchRuntime } from "../runtime/workflow/agent-dispatch.mjs";
import { createLeaseRuntime } from "../runtime/workflow/lease-runtime.mjs";
import { routeRuntimeCommand } from "../runtime/core/cli-router.mjs";

const NO_FALLBACK = Symbol("no-fallback");
function readJson(path, fallback = NO_FALLBACK) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (fallback !== NO_FALLBACK) return fallback;
    throw error;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

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
  assert.deepEqual(value.contextPolicy.capacity, {
    source: "host-available-native-worker-slots",
    upperBound: 2,
    selectInReturnedOrder: true,
    acquireOnlyImmediatelySpawnable: true
  });
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

test("a singleton planned frontier stays in the current session under a lease", () => {
  const dispatch = runtime(plan({
    groups: [["T001"]],
    tasks: [task("T001", "api")]
  }));
  const first = dispatch.dispatchValue("dispatch-change");
  const second = dispatch.dispatchValue("dispatch-change");

  assert.equal(first.version, 3);
  assert.equal(first.action, "run-leased-in-session");
  assert.equal(first.task.taskId, "T001");
  assert.equal(first.task.repository, "api");
  assert.deepEqual(first.task.model, { tier: "standard", family: "sonnet" });
  assert.equal(first.task.owner, second.task.owner);
  assert.match(first.task.acquireCommand,
    /^claude-foundation agents acquire dispatch-change T001 --owner /);
  assert.match(first.task.packetCommand,
    /^claude-foundation packet dispatch-change --task T001$/);
  assert.match(first.task.releaseCommand,
    /^claude-foundation agents release dispatch-change T001 --owner /);
  assert.match(first.task.releaseCommand, /--lease-id '<lease-id-from-acquire>'$/);
  assert.deepEqual(first.contextPolicy, {
    source: "leased-task-packet",
    parentTranscript: "retained",
    acquireBeforePacket: true
  });
  assert.equal("workers" in first, false);
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

test("a legacy live lease exposes unknown optional fencing fields as null", () => {
  const value = runtime(plan(), [{
    taskId: "T001", owner: "worker-a", expiresAt: "2026-08-19T08:00:00.000Z"
  }]).dispatchValue("dispatch-change");
  assert.equal(value.activeWorkers[0].leaseId, null);
  assert.equal(value.activeWorkers[0].fencingGeneration, null);
  assert.equal(value.activeWorkers[0].executionAttempt, null);
});

function leaseRuntimeFixture(root, planValue) {
  return createLeaseRuntime({
    leases: root,
    stableHash: hash,
    agentPlanValue: () => planValue,
    policy: () => ({ execution: { leaseMinutes: 45 } }),
    readJson,
    writeJson,
    now: () => new Date().toISOString(),
    fail: (message) => { throw new Error(message); }
  });
}

test("an unexpired on-disk lease survives a simulated host restart and forces wait, never a duplicate dispatch", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-dispatch-lease-"));
  const changeId = "restart-change";
  const planValue = plan({
    maxParallelAgents: 3,
    groups: [["T001", "T002"]],
    tasks: [task("T001", "api"), task("T002", "app")]
  });
  planValue.tasks.forEach((entry) => { entry.dependsOn = []; entry.leaseKeys = [`path:root:${entry.id}`]; });

  // A prior host session acquires T001's lease with plenty of time left.
  const priorSession = leaseRuntimeFixture(root, planValue);
  priorSession.acquire(changeId, "T001", { owner: "worker-a" });

  // Simulate a host restart: a brand-new process constructs fresh runtime
  // closures against the same on-disk lease directory, with no in-memory
  // state carried over from the process that acquired the lease.
  const restartedLeases = leaseRuntimeFixture(root, planValue);
  const restartedDispatch = createAgentDispatchRuntime({
    agentPlanValue: () => planValue,
    activeChangeLeases: restartedLeases.active,
    stableHash: hash,
    policy: () => ({ execution: { planSummaryBytes: 4096 } }),
    fail: (message) => { throw new Error(message); }
  });

  const value = restartedDispatch.dispatchValue(changeId);
  assert.equal(value.action, "wait");
  assert.equal(value.activeWorkers[0].taskId, "T001");
  assert.equal(value.activeWorkers[0].owner, "worker-a");
  assert.equal("workers" in value, false);
  assert.equal("task" in value, false);

  // Calling dispatch again post-restart must keep returning wait, never
  // flip to a duplicate spawn-group or run-leased-in-session decision while
  // the lease remains live.
  const again = restartedDispatch.dispatchValue(changeId);
  assert.equal(again.action, "wait");
});

test("boundary: once the lease expires, a restarted host stops waiting and dispatches normally", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-dispatch-lease-expiry-"));
  const changeId = "expiry-change";
  const planValue = plan({
    maxParallelAgents: 3,
    groups: [["T001"]],
    tasks: [task("T001", "api")]
  });
  planValue.tasks.forEach((entry) => { entry.dependsOn = []; entry.leaseKeys = [`path:root:${entry.id}`]; });

  const priorSession = leaseRuntimeFixture(root, planValue);
  priorSession.acquire(changeId, "T001", { owner: "worker-a" });
  const taskLeasePath = join(root, "tasks", changeId, "T001.json");
  const resourceLeasePath = priorSession.leasePath("path:root:T001");
  const expired = { ...readJson(taskLeasePath), expiresAt: "2000-01-01T00:00:00.000Z" };
  writeJson(taskLeasePath, expired);
  writeJson(resourceLeasePath, { ...readJson(resourceLeasePath), expiresAt: "2000-01-01T00:00:00.000Z" });

  const restartedLeases = leaseRuntimeFixture(root, planValue);
  const restartedDispatch = createAgentDispatchRuntime({
    agentPlanValue: () => planValue,
    activeChangeLeases: restartedLeases.active,
    stableHash: hash,
    policy: () => ({ execution: { planSummaryBytes: 4096 } }),
    fail: (message) => { throw new Error(message); }
  });

  const value = restartedDispatch.dispatchValue(changeId);
  assert.equal(value.action, "run-leased-in-session");
  assert.equal(value.task.taskId, "T001");
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

test("dispatch rejects missing changes and empty planned frontiers", () => {
  assert.throws(() => runtime(plan()).dispatchValue(),
    /agents dispatch requires <change>/);
  assert.throws(() => runtime(plan({ groups: [], tasks: [] }))
    .dispatchValue("dispatch-change"), /has no dispatchable task group/);
  assert.throws(() => runtime(plan({ groups: [["missing"]], tasks: [] }))
    .dispatchValue("dispatch-change"), /has no dispatchable task group/);
});

test("dispatch writes an ordinary decision without truncating it", () => {
  const dispatch = runtime(plan());
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { output += String(chunk); return true; };
  try {
    dispatch.showDispatch("dispatch-change");
  } finally {
    process.stdout.write = originalWrite;
  }
  const value = JSON.parse(output);
  assert.equal(value.action, "spawn-group");
  assert.equal(value.workersTruncated, undefined);
});

test("oversized dispatch output returns a bounded recovery action", () => {
  const planValue = plan({
    maxParallelAgents: 16,
    groups: [[...Array(16)].map((_, index) => `T${String(index + 1).padStart(3, "0")}`)],
    tasks: [...Array(16)].map((_, index) =>
      task(`T${String(index + 1).padStart(3, "0")}`, `repository-${"x".repeat(80)}-${index}`))
  });
  const full = runtime(planValue).dispatchValue("dispatch-change");
  const oneWorker = {
    ...full,
    workerCount: 1,
    totalReadyWorkerCount: full.workers.length,
    workersTruncated: true,
    workersDigest: hash(full.workers),
    workers: full.workers.slice(0, 1)
  };
  const limit = Buffer.byteLength(JSON.stringify(oneWorker));
  const dispatch = runtime(planValue, [], limit);
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { output += String(chunk); return true; };
  try {
    dispatch.showDispatch("dispatch-change");
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.ok(Buffer.byteLength(output) <= limit);
  const value = JSON.parse(output);
  assert.equal(value.action, "spawn-group");
  assert.equal(value.workersTruncated, true);
  assert.equal(value.workers.length, 1);
});

test("oversized wait output truncates active workers deterministically", () => {
  const active = [...Array(16)].map((_, index) => ({
    taskId: `T${String(index + 1).padStart(3, "0")}`,
    owner: `worker-${"x".repeat(80)}-${index}`,
    leaseId: `lease-${index}`,
    fencingGeneration: index + 1,
    executionAttempt: 1,
    expiresAt: "2026-08-19T08:00:00.000Z"
  }));
  const dispatch = runtime(plan(), active, 1024);
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { output += String(chunk); return true; };
  try {
    dispatch.showDispatch("dispatch-change", { pretty: true });
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.ok(Buffer.byteLength(output) <= 1024);
  const value = JSON.parse(output);
  assert.equal(value.action, "wait");
  assert.equal(value.activeWorkerCount, 16);
  assert.equal(value.activeWorkersTruncated, true);
  assert.ok(value.activeWorkers.length < 16);
  assert.match(value.activeWorkersDigest, /^[a-f0-9]{64}$/);
});

test("dispatch fails closed when even its recovery decision exceeds the limit", () => {
  const dispatch = runtime(plan(), [], 1);
  assert.throws(() => dispatch.showDispatch("dispatch-change"),
    /recovery decision exceeds 1 bytes/);
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
