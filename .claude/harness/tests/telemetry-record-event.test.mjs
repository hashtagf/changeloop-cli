import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  assertUniqueTelemetryRequest,
  buildTelemetryEvent,
  recordTelemetryEvent,
  telemetryCacheUsage,
  validateTelemetryEventFlags
} from "../runtime/observability/telemetry-runtime.mjs";

const fail = (message) => { throw new Error(message); };

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "telemetry-record-event-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logs = join(root, "logs");
  const state = { activeProofRun: { workspaceHash: "workspace", snapshotId: "snap" } };
  const calls = { repositories: [], sync: [], saved: 0, reported: 0 };
  const context = {
    root, logs,
    now: () => "2026-08-26T00:00:00.000Z",
    loadRuntime: () => state,
    readJson: () => ({ workspaceHash: "disk", id: "disk-id" }),
    snapshotPath: () => join(root, "snapshot.json"),
    repositoryById: (...args) => calls.repositories.push(args),
    activeChangePath: () => root,
    taskBlocks: () => [{ id: "T001" }],
    fail,
    readFile: (path, encoding) => path.endsWith("tasks.md")
      ? "- [ ] T001 task" : readFileSync(path, encoding),
    append: appendFileSync,
    readJsonLines: (path) => readFileSync(path, "utf8").trim().split("\n").map(JSON.parse),
    synchronizeBudgetUsage: (...args) => calls.sync.push(args),
    saveRuntime: () => { calls.saved += 1; },
    reportBudget: () => { calls.reported += 1; },
    ...overrides
  };
  return { root, logs, state, calls, context };
}

test("cache usage distinguishes missing, read, write, and combined counters", () => {
  assert.deepEqual(telemetryCacheUsage({}), {
    cacheReadTokens: null, cacheCreationTokens: null, cacheTokens: null
  });
  assert.deepEqual(telemetryCacheUsage({ cache: "2" }), {
    cacheReadTokens: 2, cacheCreationTokens: null, cacheTokens: 2
  });
  assert.deepEqual(telemetryCacheUsage({ "cache-create": 3 }), {
    cacheReadTokens: null, cacheCreationTokens: 3, cacheTokens: 3
  });
  assert.equal(telemetryCacheUsage({ cache: 0, "cache-create": 4 }).cacheTokens, 4);
});

test("event flag validation normalizes tasks and validates repositories and numbers", (t) => {
  const f = fixture(t);
  const flags = { repo: "api", task: "t001", input: "4", cost: 0 };
  validateTelemetryEventFlags(f.context, "change", f.state, flags);
  assert.equal(flags.task, "T001");
  assert.equal(f.calls.repositories.length, 1);
  assert.throws(() => validateTelemetryEventFlags(f.context, "change", f.state, {
    task: "T999"
  }), /unknown task 'T999'/);
  for (const field of ["input", "output", "cache", "cache-create", "cost", "duration"])
    assert.throws(() => validateTelemetryEventFlags(
      f.context, "change", f.state, { [field]: "not-a-number" }),
    new RegExp(`--${field} must be numeric`));
});

test("event builder preserves identities, measurements, and snapshot fallback", (t) => {
  const f = fixture(t);
  const event = buildTelemetryEvent(f.context, "change", {
    run: "run", operation: "prove", agent: "agent", model: "model",
    request: "request", parent: "parent", input: "1", output: 2,
    cache: 3, "cache-create": 4, cost: "5", duration: 6,
    tool: "shell", repo: "api", task: "T001"
  }, { workspaceHash: "hash", id: "legacy-snapshot" });
  assert.deepEqual(event, {
    version: 2, runId: "run", operationId: "prove", agentId: "agent",
    modelId: "model", requestId: "request", parentRequestId: "parent",
    timestamp: "2026-08-26T00:00:00.000Z", inputTokens: 1, outputTokens: 2,
    cacheReadTokens: 3, cacheCreationTokens: 4, cacheTokens: 7,
    cost: 5, durationMs: 6, tool: "shell", repositoryId: "api", taskId: "T001",
    workspaceHash: "hash", workspaceSnapshotId: "legacy-snapshot",
    changeId: "change", source: "host-execution-contract"
  });
  const minimal = buildTelemetryEvent(f.context, "change", {}, {});
  assert.equal(minimal.runId, "change");
  assert.equal(minimal.operationId, "unknown");
  assert.equal(minimal.workspaceSnapshotId, null);
});

test("unique request validation accepts new ids and rejects duplicates or corrupt ledgers", (t) => {
  const f = fixture(t);
  const path = join(f.root, "events.jsonl");
  assert.doesNotThrow(() => assertUniqueTelemetryRequest(f.context, path, "new"));
  appendFileSync(path, '{"requestId":"prior"}\n');
  assert.doesNotThrow(() => assertUniqueTelemetryRequest(f.context, path, "new"));
  assert.throws(() => assertUniqueTelemetryRequest(f.context, path, "prior"), /duplicate/);
  appendFileSync(path, 'invalid\n');
  assert.throws(() => assertUniqueTelemetryRequest(f.context, path, "new"),
    /invalid telemetry ledger/);
});

test("event recording appends, synchronizes budget, saves, and reports", (t) => {
  const f = fixture(t);
  const flags = { request: "request-1", task: "t001", input: 4, cache: 2 };
  recordTelemetryEvent(f.context, "change", flags);
  const path = join(f.logs, "change", "events.jsonl");
  const event = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(event.requestId, "request-1");
  assert.equal(event.taskId, "T001");
  assert.equal(f.calls.sync[0][2], "change");
  assert.deepEqual(f.calls.sync[0].slice(3), ["external-events", 1]);
  assert.equal(f.calls.saved, 1);
  assert.equal(f.calls.reported, 1);
  assert.throws(() => recordTelemetryEvent(f.context, "change", flags), /duplicate/);
});

test("event recording requires request identity and reads disk snapshot without active proof", (t) => {
  const f = fixture(t);
  f.state.activeProofRun = null;
  assert.throws(() => recordTelemetryEvent(f.context, "change", {}),
    /requires --request/);
  recordTelemetryEvent(f.context, "change", { request: "disk-request" });
  const event = JSON.parse(readFileSync(
    join(f.logs, "change", "events.jsonl"), "utf8"));
  assert.equal(event.workspaceHash, "disk");
  assert.equal(event.workspaceSnapshotId, "disk-id");
});
