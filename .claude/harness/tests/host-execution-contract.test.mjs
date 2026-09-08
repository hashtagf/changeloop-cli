import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHostExecutionImporter, createHostExecutionStore, hostExecutionTelemetryRows,
  normalizeHostExecution, normalizedAttempt, normalizedAttempts,
  normalizedExecutionIdentity, normalizedExecutionTiming, normalizedUsage,
  resolveHostExecutionSource, sum
} from "../runtime/observability/host-execution-contract.mjs";

test("usage normalization accepts both host naming styles and rejects invented numbers", () => {
  assert.deepEqual(normalizedUsage(null), {
    inputTokens: null, outputTokens: null, cacheTokens: null, cost: null
  });
  assert.deepEqual(normalizedUsage({
    inputTokens: "1", outputTokens: 2, cacheTokens: 3, cost: "4.5"
  }), { inputTokens: 1, outputTokens: 2, cacheTokens: 3, cost: 4.5 });
  assert.deepEqual(normalizedUsage({
    input_tokens: 5, output_tokens: 6, cache_tokens: 7, cost_usd: 8
  }), { inputTokens: 5, outputTokens: 6, cacheTokens: 7, cost: 8 });
  assert.throws(() => normalizedUsage([]), /usage must be an object/);
  assert.throws(() => normalizedUsage("usage"), /usage must be an object/);
  assert.throws(() => normalizedUsage({ inputTokens: -1 }), /non-negative number/);
  assert.throws(() => normalizedUsage({ cost: "not-a-number" }), /non-negative number/);
});

test("attempt normalization validates identity, status, timestamps, and aliases", () => {
  assert.deepEqual(normalizedAttempt({
    status: "completed", model: "model-a",
    started_at: "2026-08-27T00:00:00Z",
    finished_at: "2026-08-27T00:00:01Z",
    duration_ms: "1000", fallback_reason: "retry",
    failure_class: "transient", usage: { input_tokens: 3 }
  }, 1), {
    attempt: 2,
    model: "model-a",
    status: "completed",
    startedAt: "2026-08-27T00:00:00.000Z",
    finishedAt: "2026-08-27T00:00:01.000Z",
    durationMs: 1000,
    fallbackReason: "retry",
    failureClass: "transient",
    usage: { inputTokens: 3, outputTokens: null, cacheTokens: null, cost: null }
  });
  assert.equal(normalizedAttempt({ attempt: 1, status: "failed" }, 9).attempt, 1);
  assert.throws(() => normalizedAttempt({ attempt: 0, status: "failed" }, 0),
    /positive integer/);
  assert.throws(() => normalizedAttempt({ attempt: 1.5, status: "failed" }, 0),
    /positive integer/);
  assert.throws(() => normalizedAttempt({ status: "running" }, 0), /unsupported/);
  assert.throws(() => normalizedAttempt({}, 0), /status is required/);
  assert.throws(() => normalizedAttempt({ status: "failed", model: 3 }, 0),
    /model must be a string/);
  assert.throws(() => normalizedAttempt({ status: "failed", startedAt: "yesterday" }, 0),
    /ISO timestamp/);
  assert.throws(() => normalizedAttempt({ status: "failed", durationMs: -1 }, 0),
    /non-negative number/);
});

test("attempt lists sort deterministically and reject duplicate numbers", () => {
  assert.deepEqual(normalizedAttempts({ attempts: [
    { attempt: 2, status: "failed" }, { attempt: 1, status: "completed" }
  ] }).map((attempt) => attempt.attempt), [1, 2]);
  assert.deepEqual(normalizedAttempts({ attempts: "none" }), []);
  assert.throws(() => normalizedAttempts({ attempts: [
    { attempt: 1, status: "failed" }, { attempt: 1, status: "completed" }
  ] }), /must be unique/);
});

test("execution identity and timing normalize aliases without copying payloads", () => {
  assert.deepEqual(normalizedExecutionIdentity({
    dispatch_id: " dispatch ", change_id: "change", source: "host",
    requested_model: "standard", actual_model: "model-a",
    instruction_manifest_digest: "sha256:digest"
  }, null), {
    dispatchId: "dispatch", changeId: "change", host: "host",
    requestedModel: "standard", actualModel: "model-a",
    instructionManifestDigest: "sha256:digest"
  });
  assert.equal(normalizedExecutionIdentity({ dispatchId: "d", changeId: "input" },
    "override").changeId, "override");
  assert.deepEqual(normalizedExecutionTiming({
    started_at: "2026-08-27T00:00:00Z", finished_at: null, duration_ms: "12"
  }), {
    startedAt: "2026-08-27T00:00:00.000Z", finishedAt: null, durationMs: 12
  });
  assert.throws(() => normalizedExecutionIdentity({ dispatchId: "d", host: {} }, null),
    /host must be a string/);
  assert.throws(() => normalizedExecutionTiming({ finishedAt: 1 }), /ISO timestamp/);
});

test("host execution normalization validates schema and emits the persistence contract", () => {
  const result = normalizeHostExecution({
    schemaVersion: "1", dispatch_id: "dispatch", status: "completed",
    source: "host", actual_model: "model-a", started_at: "2026-08-27T00:00:00Z",
    attempts: [{ status: "completed" }],
    usage: { output_tokens: 2 }, tools: { calls: 1, failures: 0 },
    result: { status: "completed", failure_class: "none" },
    prompt: "must-not-persist", messages: ["must-not-persist"]
  }, { changeId: "change", importedAt: "2026-08-27T00:00:02Z" });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.dispatchId, "dispatch");
  assert.equal(result.changeId, "change");
  assert.equal(result.importedAt, "2026-08-27T00:00:02.000Z");
  assert.equal(result.result.failureClass, "none");
  assert.equal("prompt" in result, false);
  assert.equal("messages" in result, false);

  const generatedTime = normalizeHostExecution({ dispatchId: "d", status: "failed" });
  assert.ok(Number.isFinite(Date.parse(generatedTime.importedAt)));
  assert.deepEqual(generatedTime.tools, { calls: null, failures: null });
  assert.throws(() => normalizeHostExecution(null), /must be an object/);
  assert.throws(() => normalizeHostExecution([]), /must be an object/);
  assert.throws(() => normalizeHostExecution({ schemaVersion: 2 }), /unsupported host/);
  assert.throws(() => normalizeHostExecution({ dispatchId: "d", status: "running" }),
    /unsupported result.status/);
  assert.throws(() => normalizeHostExecution({ dispatchId: "d", status: "failed",
    tools: { calls: 1.5 } }), /integer or null/);
});

test("nullable telemetry sums preserve unknown rather than coercing it to zero", () => {
  assert.equal(sum(null, null), null);
  assert.equal(sum(undefined, 2), 2);
  assert.equal(sum(3, null), 3);
  assert.equal(sum(3, undefined), 3);
  assert.equal(sum(3, 4), 7);
});

test("host execution importer validates input and records telemetry idempotently", () => {
  const calls = { loads: [], reads: [], appends: [], logs: [], failures: [] };
  let exists = true;
  let invalid = false;
  let duplicate = false;
  const execution = normalizeHostExecution({
    dispatchId: "dispatch", host: "host", status: "completed",
    usage: { inputTokens: 2 }
  }, { changeId: "change", importedAt: "2026-08-27T00:00:00Z" });
  const importer = createHostExecutionImporter({
    loadRuntime: (id) => calls.loads.push(id),
    resolveSource: (source) => `/resolved/${source}`,
    exists: () => exists,
    store: {
      importExecution: () => {
        if (invalid) throw new Error("bad schema");
        return { duplicate, execution };
      }
    },
    readJson: (path, fallback) => {
      calls.reads.push([path, fallback]);
      return path.endsWith("snapshot.json") ? { snapshot: true } : { input: true };
    },
    appendTelemetryRows: (...args) => {
      calls.appends.push(args);
      return 1;
    },
    snapshotPath: (id) => `/state/${id}/snapshot.json`,
    fail: (message) => {
      calls.failures.push(message);
      return { failed: message };
    },
    log: (message) => calls.logs.push(message)
  });

  const recorded = importer("change", "result.json");
  assert.equal(recorded.imported, 1);
  assert.equal(calls.loads[0], "change");
  assert.deepEqual(calls.reads, [
    ["/resolved/result.json", undefined],
    ["/state/change/snapshot.json", {}]
  ]);
  assert.equal(calls.appends[0][0], "change");
  assert.equal(calls.appends[0][1][0].inputTokens, 2);
  assert.equal(calls.appends[0][2], "host-execution");
  assert.deepEqual(calls.appends[0][3], { snapshot: { snapshot: true } });
  assert.match(calls.logs[0], /recorded; imported 1/);

  duplicate = true;
  importer("change", "result.json");
  assert.match(calls.logs[1], /duplicate; imported 1/);

  exists = false;
  assert.deepEqual(importer("change", "missing.json"), {
    failed: "host execution result not found: missing.json"
  });
  exists = true;
  invalid = true;
  assert.deepEqual(importer("change", "invalid.json"), {
    failed: "host execution result is invalid: bad schema"
  });
  assert.equal(calls.appends.length, 2);
});

test("host execution source resolves relative to the invoking workspace", () => {
  assert.equal(resolveHostExecutionSource("/workspace", "results/host.json"),
    "/workspace/results/host.json");
  assert.equal(resolveHostExecutionSource("/workspace", "/tmp/host.json"), "/tmp/host.json");
});

test("conflicting duplicate and out-of-order observations retain first accepted usage", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-host-conformance-"));
  try {
    const store = createHostExecutionStore({ root });
    const first = store.importExecution("change", {
      dispatchId: "attempt-new", status: "failed", usage: { inputTokens: 7 }
    });
    const bytes = readFileSync(first.path, "utf8");
    const duplicate = store.importExecution("change", {
      dispatchId: "attempt-new", status: "completed", usage: { inputTokens: 999 },
      revision: 999, lifecycle: "archived"
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(readFileSync(first.path, "utf8"), bytes);
    assert.equal(duplicate.execution.result.status, "failed");
    assert.deepEqual(hostExecutionTelemetryRows(duplicate.execution),
      hostExecutionTelemetryRows(first.execution));
    const historical = store.importExecution("change", {
      dispatchId: "attempt-old", status: "completed", usage: { inputTokens: 3 },
      finishedAt: "2020-01-01T00:00:00Z", lifecycle: "archived"
    });
    assert.equal(historical.imported, true);
    assert.equal(historical.execution.usage.inputTokens, 3);
    assert.equal("lifecycle" in historical.execution, false);
    assert.equal("revision" in duplicate.execution, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
