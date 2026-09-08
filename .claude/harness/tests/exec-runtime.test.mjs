import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  symlinkSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildExecCommandViolation, createExecRuntime
} from "../runtime/observability/exec-runtime.mjs";

function rows(logs, id) {
  return readFileSync(join(logs, id, "operations.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
}

test("observed execution validates lifecycle and command presence", (t) => {
  const logs = mkdtempSync(join(tmpdir(), "foundation-exec-runtime-"));
  t.after(() => rmSync(logs, { recursive: true, force: true }));
  const workspace = join(logs, "workspace");
  mkdirSync(workspace);
  let status = "archived";
  const runtime = createExecRuntime({
    logs, loadRuntime: () => ({ status, workspace: { path: workspace } }),
    now: () => "2026-08-27T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  assert.throws(() => runtime.execObserved("change", [process.execPath]),
    /archived change is finished evidence/);
  status = "building";
  assert.throws(() => runtime.execObserved("change", []),
    /requires a command after --/);
  assert.throws(() => runtime.execObserved("change", [process.execPath], {
    phase: "land"
  }), /does not match change state 'building'/);
  assert.throws(() => runtime.execObserved("change", [
    "foundation-command-that-does-not-exist"
  ]), /could not start/);
});

test("observed execution records success, failure, signal death, and bounded commands", (t) => {
  const logs = mkdtempSync(join(tmpdir(), "foundation-exec-runtime-"));
  t.after(() => rmSync(logs, { recursive: true, force: true }));
  const workspace = join(logs, "workspace");
  mkdirSync(workspace);
  const runtime = createExecRuntime({
    logs, loadRuntime: () => ({ status: "building", workspace: { path: workspace } }),
    now: () => "2026-08-27T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  const priorPhase = process.env.FOUNDATION_PUBLIC_OPERATION;
  process.env.FOUNDATION_PUBLIC_OPERATION = "prove";
  try {
    assert.equal(runtime.execObserved("change", [process.execPath, "-e", ""], {
      phase: "build"
    }), 0);
    assert.equal(runtime.execObserved("change", [
      process.execPath, "-e", "process.exit(7)", "x".repeat(700)
    ]), 7);
    assert.equal(runtime.execObserved("change", [
      process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"
    ], { phase: "" }), 1);
    delete process.env.FOUNDATION_PUBLIC_OPERATION;
    assert.equal(runtime.execObserved("change", [process.execPath, "-e", ""]), 0);
  } finally {
    if (priorPhase === undefined) delete process.env.FOUNDATION_PUBLIC_OPERATION;
    else process.env.FOUNDATION_PUBLIC_OPERATION = priorPhase;
  }
  const values = rows(logs, "change");
  assert.equal(values.length, 4);
  assert.deepEqual(values.map(({ status, exitCode }) => ({ status, exitCode })), [
    { status: "completed", exitCode: 0 },
    { status: "failed", exitCode: 7 },
    { status: "failed", exitCode: 1 },
    { status: "completed", exitCode: 0 }
  ]);
  assert.equal(values[0].phase, "build");
  assert.equal(values[1].phase, "build");
  assert.equal(values[2].phase, "build");
  assert.equal(values[3].phase, "build");
  assert.equal(values[1].command.length, 512);
  assert.equal(values[0].measurement, "external-command-observed");
  assert.equal(values[0].requests, null);
  assert.ok(values.every((value) => value.durationMs >= 0));
});

test("Build exec runs in the isolated workspace and refuses path escapes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-exec-containment-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logs = join(root, "logs");
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  symlinkSync(outside, join(workspace, "escape"));
  assert.equal(buildExecCommandViolation(["touch", "file"], join(root, "missing")),
    "Build exec requires an existing isolated workspace");
  const runtime = createExecRuntime({
    logs,
    loadRuntime: () => ({ status: "building", workspace: { path: workspace } }),
    now: () => "2026-09-04T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });

  assert.equal(runtime.execObserved("change", [
    process.execPath, "-e",
    "require('node:fs').writeFileSync('cwd.txt', process.cwd())"
  ], { phase: "build" }), 0);
  assert.equal(readFileSync(join(workspace, "cwd.txt"), "utf8"), realpathSync(workspace));

  const escaped = join(outside, "escaped.txt");
  assert.throws(() => runtime.execObserved("change", ["touch", escaped], {
    phase: "build"
  }), /outside the isolated workspace/);
  assert.equal(existsSync(escaped), false);
  assert.throws(() => runtime.execObserved("change", ["touch", "escape/symlinked.txt"], {
    phase: "build"
  }), /outside the isolated workspace/);
  assert.equal(existsSync(join(outside, "symlinked.txt")), false);
});

test("exec preserves real phase overlaps but never bypasses phase mutation policy", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-exec-phase-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  let status = "building";
  const runtime = createExecRuntime({
    logs: join(root, "logs"),
    loadRuntime: () => ({ status, workspace: { path: workspace } }),
    now: () => "2026-09-04T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });

  assert.equal(runtime.execObserved("change", [process.execPath, "-e", ""], {
    phase: "prove"
  }), 0);
  status = "proven";
  assert.throws(() => runtime.execObserved("change", ["git", "push"], {
    phase: "land"
  }), /Land shell mutations require the runtime transaction marker/);
});
