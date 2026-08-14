import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// A build-phase command — a container build, a package install, a full test
// run — is usually the largest block of wall time the loop spends outside the
// model, and operations.jsonl never saw it: the exit hook records only the
// harness's own invocations. `exec` runs the command with inherited stdio,
// passes its exit code through untouched, and appends one observed-duration
// row so `metrics` can report external execution time next to harness
// operation time and evidence execution time.
export function createExecRuntime({ logs, loadRuntime, now, fail }) {
  function execObserved(id, commandArgs, { phase } = {}) {
    const state = loadRuntime(id);
    if (state.status === "archived")
      fail("an archived change is finished evidence; exec records nothing against it");
    if (!commandArgs.length) fail("exec requires a command after --");
    const startedAtMs = Date.now();
    const startedAt = now();
    const result = spawnSync(commandArgs[0], commandArgs.slice(1), { stdio: "inherit" });
    if (result.error)
      fail(`exec could not start '${commandArgs[0]}': ${result.error.message}`);
    // Signal death has no exit status; a non-zero stand-in keeps the failure
    // visible to whatever invoked exec.
    const exitCode = result.status === null ? 1 : result.status;
    const path = join(logs, id, "operations.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      version: 2, changeId: id, operation: "exec",
      phase: phase || process.env.FOUNDATION_PUBLIC_OPERATION || null,
      command: commandArgs.join(" ").slice(0, 512),
      status: exitCode === 0 ? "completed" : "failed", exitCode,
      startedAt, finishedAt: now(),
      durationMs: Date.now() - startedAtMs,
      requests: null, inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, cacheTokens: null, cost: null,
      measurement: "external-command-observed"
    })}\n`);
    return exitCode;
  }
  return { execObserved };
}
