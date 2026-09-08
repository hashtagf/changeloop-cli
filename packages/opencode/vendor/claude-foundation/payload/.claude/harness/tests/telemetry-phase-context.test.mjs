import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  buildPhaseContextRow,
  createTelemetryRuntime,
  phaseContextMode,
  phaseTelemetryHost,
  phaseTelemetryMode,
  recommendedPhaseModelTier
} from "../runtime/observability/telemetry-runtime.mjs";

const jsonLines = (path) => {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  } catch { return []; }
};

test("phase context classifiers cover every host, model and retention mode", () => {
  assert.equal(phaseTelemetryHost({}, "s", {}), "claude-code");
  assert.equal(phaseTelemetryHost(null, "s", { CODEX_THREAD_ID: "thread" }), "codex");
  assert.equal(phaseTelemetryHost(null, "s", {}), "generic-host");
  assert.equal(phaseTelemetryHost(null, null, {}), "unknown");
  assert.equal(phaseTelemetryMode({}, "s"), "automatic-transcript");
  assert.equal(phaseTelemetryMode(null, "s"), "explicit-import");
  assert.equal(phaseTelemetryMode(null, null), "unavailable");
  assert.deepEqual(["change", "build", "prove", "land", "other"].map(recommendedPhaseModelTier),
    ["deep", "standard", "fast", "fast", "standard"]);
  assert.equal(phaseContextMode(null, null), "unavailable");
  assert.equal(phaseContextMode(null, "s"), "initial");
  assert.equal(phaseContextMode({ sessionId: "s" }, "s"), "retained");
  assert.equal(phaseContextMode({ sessionId: "old" }, "s"), "fresh");
});

test("buildPhaseContextRow preserves attribution and prior context", () => {
  assert.deepEqual(buildPhaseContextRow({
    id: "c", phase: "prove", prior: { phase: "build", sessionId: "old" },
    host: null, sessionId: "new",
    env: {
      CODEX_THREAD_ID: "thread", FOUNDATION_MODEL_ID: "model",
      FOUNDATION_PHASE_TRIGGER: "manual"
    }, timestamp: "now"
  }), {
    version: 1, changeId: "c", phase: "prove", sessionId: "new",
    telemetryHost: "codex", telemetryMode: "explicit-import", contextMode: "fresh",
    recommendedModelTier: "fast", actualModel: "model", trigger: "manual",
    priorPhase: "build", priorSessionId: "old", timestamp: "now"
  });
  const minimal = buildPhaseContextRow({
    id: "c", phase: "other", prior: null, host: null, sessionId: null,
    env: {}, timestamp: "now"
  });
  assert.equal(minimal.actualModel, null);
  assert.equal(minimal.priorPhase, null);
});

function runtime(root, overrides = {}) {
  return createTelemetryRuntime({
    root, logs: root, now: () => "2026-08-26T00:00:00.000Z",
    readJsonLinesTolerant: jsonLines,
    ...overrides
  });
}

test("recordPhaseContext records initial, retained, fresh, unavailable and Claude modes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "phase-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keys = [
    "FOUNDATION_SESSION_ID", "CODEX_THREAD_ID", "FOUNDATION_CLAUDE_TRANSCRIPT_PATH",
    "FOUNDATION_CLAUDE_SESSION_ID", "FOUNDATION_MODEL_ID", "FOUNDATION_PHASE_TRIGGER"
  ];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  });
  for (const key of keys) delete process.env[key];
  const value = runtime(root);
  process.env.FOUNDATION_SESSION_ID = "session-a";
  value.recordPhaseContext("change", "change");
  value.recordPhaseContext("change", "build");
  process.env.FOUNDATION_SESSION_ID = "session-b";
  value.recordPhaseContext("change", "prove");
  delete process.env.FOUNDATION_SESSION_ID;
  value.recordPhaseContext("change", "land");
  const transcript = join(root, "transcript.jsonl");
  writeFileSync(transcript, "\n");
  process.env.FOUNDATION_CLAUDE_TRANSCRIPT_PATH = transcript;
  process.env.FOUNDATION_CLAUDE_SESSION_ID = "claude-session";
  process.env.FOUNDATION_MODEL_ID = "claude-model";
  value.recordPhaseContext("change", "build");
  const rows = jsonLines(join(root, "change", "phase-context.jsonl"));
  assert.deepEqual(rows.map((row) => row.contextMode),
    ["initial", "retained", "fresh", "unavailable", "initial"]);
  assert.equal(rows.at(-1).telemetryHost, "claude-code");
  assert.equal(rows.at(-1).telemetryMode, "automatic-transcript");
  assert.equal(rows.at(-1).actualModel, "claude-model");
});

test("recordPhaseContext remains best-effort and emits debug diagnostics", (t) => {
  const root = mkdtempSync(join(tmpdir(), "phase-context-error-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const priorDebug = process.env.FOUNDATION_TELEMETRY_DEBUG;
  const priorError = console.error;
  t.after(() => {
    if (priorDebug === undefined) delete process.env.FOUNDATION_TELEMETRY_DEBUG;
    else process.env.FOUNDATION_TELEMETRY_DEBUG = priorDebug;
    console.error = priorError;
  });
  process.env.FOUNDATION_TELEMETRY_DEBUG = "1";
  let warning = "";
  console.error = (message) => { warning = message; };
  const value = runtime(root, {
    readJsonLinesTolerant: () => { throw new Error("ledger unavailable"); }
  });
  assert.doesNotThrow(() => value.recordPhaseContext("change", "build"));
  assert.match(warning, /phase telemetry unavailable: ledger unavailable/);
});
