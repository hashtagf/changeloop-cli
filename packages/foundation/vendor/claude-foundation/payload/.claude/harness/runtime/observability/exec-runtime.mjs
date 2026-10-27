import { spawnSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdirSync, realpathSync, statSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  shellDisplayArgument as displayArgument, shellMutationViolation
} from "../core/shell-mutation-policy.mjs";

function phasesForStatus(status) {
  if (["change", "resolved"].includes(status)) return ["change"];
  // Evidence can begin while the implementation state is still `building`,
  // and Land begins from `proven`; preserve those real boundary overlaps while
  // rejecting phase labels that cannot follow from the lifecycle state.
  if (status === "building") return ["build", "prove"];
  if (status === "proven") return ["prove", "land"];
  if (status === "applied") return ["land"];
  return [];
}

function isWithin(target, root) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canonicalTarget(value, base) {
  let cursor = resolve(base, value);
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  try { return resolve(realpathSync(cursor), ...suffix); }
  catch { return null; }
}

function commandForPolicy(commandArgs, workspace) {
  const program = basename(commandArgs[0] || "");
  if (["sh", "bash", "zsh"].includes(program)) {
    const commandIndex = commandArgs.findIndex((value) => /^-[a-z]*c[a-z]*$/i.test(value));
    if (commandIndex >= 0 && commandArgs[commandIndex + 1])
      return `cd ${displayArgument(workspace)} && ${commandArgs[commandIndex + 1]}`;
  }
  return `cd ${displayArgument(workspace)} && ${[program, ...commandArgs.slice(1)]
    .map(displayArgument).join(" ")}`;
}

function executionCommandViolation(phase, commandArgs, workspace = null) {
  if (!phase) return "exec cannot derive a lifecycle phase from the change state";
  if (phase === "build") return buildExecCommandViolation(commandArgs, workspace);
  return shellMutationViolation(phase, process.env,
    commandArgs.map(displayArgument).join(" "));
}

export function buildExecCommandViolation(commandArgs, workspace) {
  const canonicalWorkspace = canonicalTarget(workspace, workspace);
  let workspaceIsDirectory = false;
  try {
    workspaceIsDirectory = Boolean(canonicalWorkspace &&
      statSync(canonicalWorkspace).isDirectory());
  }
  catch { workspaceIsDirectory = false; }
  if (!workspaceIsDirectory)
    return "Build exec requires an existing isolated workspace";
  return shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: canonicalWorkspace
  }, commandForPolicy(commandArgs, canonicalWorkspace), {
    canonicalTarget: (target) => canonicalTarget(target, canonicalWorkspace),
    contains: (target, root) => isWithin(target, realpathSync(root))
  });
}

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
    const allowedPhases = phasesForStatus(state.status);
    const runtimePhase = phase || allowedPhases[0] || null;
    if (phase && !allowedPhases.includes(phase))
      fail(`exec phase '${phase}' does not match change state '${state.status}' (` +
        `${allowedPhases.join("|") || "none"})`);
    let cwd;
    if (state.status === "building") {
      cwd = state.workspace?.path;
      if (!cwd) fail("Build exec requires an isolated workspace");
      try {
        cwd = realpathSync(cwd);
        if (!statSync(cwd).isDirectory()) throw new Error("workspace is not a directory");
      } catch { fail("Build exec requires an existing isolated workspace"); }
    }
    const violation = executionCommandViolation(runtimePhase, commandArgs, cwd);
    if (violation) fail(violation);
    const startedAtMs = Date.now();
    const startedAt = now();
    const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
      stdio: "inherit", cwd,
      env: cwd ? { ...process.env, FOUNDATION_WORKSPACE_ROOT: cwd } : process.env
    });
    if (result.error)
      fail(`exec could not start '${commandArgs[0]}': ${result.error.message}`);
    // Signal death has no exit status; a non-zero stand-in keeps the failure
    // visible to whatever invoked exec.
    const exitCode = result.status === null ? 1 : result.status;
    const path = join(logs, id, "operations.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      version: 2, changeId: id, operation: "exec",
      phase: phase || runtimePhase || process.env.FOUNDATION_PUBLIC_OPERATION || null,
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
