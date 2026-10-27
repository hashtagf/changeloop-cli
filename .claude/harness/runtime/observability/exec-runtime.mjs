import { spawnSync } from "node:child_process";
import { resumeThrough } from "../core/next-step.mjs";
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

const AUDITED_PHASES = new Set(["investigate", "change", "build", "prove"]);

function shellGuardBlocks() {
  return (process.env.FOUNDATION_SHELL_GUARD || "").toLowerCase() === "block";
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

function executionCommandViolation(phase, commandArgs, workspace = null, cwd = workspace) {
  if (!phase) return "exec cannot derive a lifecycle phase from the change state";
  if (phase === "build") return buildExecCommandViolation(commandArgs, workspace, cwd);
  return shellMutationViolation(phase, process.env,
    commandArgs.map(displayArgument).join(" "));
}

// `cwd` is where the child starts inside `workspace` (a subdirectory the
// caller stood in); relative operands resolve there, containment stays bound
// to the workspace root.
export function buildExecCommandViolation(commandArgs, workspace, cwd = workspace) {
  const canonicalWorkspace = canonicalTarget(workspace, workspace);
  let workspaceIsDirectory = false;
  try {
    workspaceIsDirectory = Boolean(canonicalWorkspace &&
      statSync(canonicalWorkspace).isDirectory());
  }
  catch { workspaceIsDirectory = false; }
  if (!workspaceIsDirectory)
    return "Build exec requires an existing isolated workspace";
  const start = cwd && canonicalTarget(cwd, canonicalWorkspace);
  const base = start && isWithin(start, canonicalWorkspace) ? start : canonicalWorkspace;
  return shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: canonicalWorkspace
  }, commandForPolicy(commandArgs, base), {
    canonicalTarget: (target) => canonicalTarget(target, base),
    contains: (target, root) => isWithin(target, realpathSync(root))
  });
}

function canonicalDirectory(path) {
  if (typeof path !== "string" || !path) return null;
  try {
    const value = realpathSync(path);
    return statSync(value).isDirectory() ? value : null;
  } catch { return null; }
}

function execRefusal(fail, message, code) {
  fail(message, 1, { code, owner: "agent", boundary: "contract" });
  // A fail callback that returns must still never fall through to running.
  throw new Error(message);
}

// Where an exec child starts. A multi-repository change builds in a shared
// sandbox whose submodule directories are mirrors (links to the repository
// sandboxes, or recorded commits of unselected ones), plus one sandbox per
// selected repository; a check for such a repository only works in its own
// sandbox. Order: explicit `--repo`/`--task`; then the caller's
// directory (inside a repository sandbox, the shared sandbox's mirror of a
// repository, or the main checkout's copy of one, it maps to the same relative
// directory inside that repository's sandbox); then the pending tasks when
// they all belong to one repository; finally the shared sandbox. Every result
// is a recorded sandbox of this change, never the main checkout.
export function resolveExecWorkspace({
  id, state, root = null, callerCwd = null, repository = null, task = null,
  tasks = [], fail
}) {
  const route = `claude-foundation exec ${id} --repo <repository> -- <command…>`;
  const shared = canonicalDirectory(state.workspace?.path);
  if (!shared) {
    if (repository || task)
      execRefusal(fail, `exec --${repository ? "repo" : "task"} needs the change's ` +
        `isolated Build workspace, which does not exist in state '${state.status}'; ` +
        `run 'claude-foundation advance ${id} --through ${resumeThrough(state)}' first`,
      "EXEC_WORKSPACE_MISSING");
    return null;
  }
  const checkout = canonicalDirectory(root);
  if (checkout && isWithin(checkout, shared))
    execRefusal(fail, "exec never runs in the main checkout, and the change's workspace " +
      `resolves to it; run 'claude-foundation advance ${id} --through ${resumeThrough(state)}' to ` +
      "create the isolated workspace", "EXEC_WORKSPACE_NOT_ISOLATED");
  const sandboxes = new Map([["root", { path: shared, target: checkout, mirror: null }]]);
  for (const [name, record] of Object.entries(state.repositories || {})) {
    if (name === "root") continue;
    const path = canonicalDirectory(record?.path || record?.workspacePath);
    if (!path || path === shared || (checkout && isWithin(checkout, path))) continue;
    const target = canonicalDirectory(record?.targetPath);
    const relativeTarget = target && checkout && isWithin(target, checkout)
      ? relative(checkout, target) : "";
    sandboxes.set(name, {
      path, target, mirror: relativeTarget ? join(shared, relativeTarget) : null
    });
  }
  const named = (name, source) => {
    const sandbox = sandboxes.get(name);
    if (!sandbox)
      execRefusal(fail, `exec ${source} names repository '${name}', which has no sandbox ` +
        `in change '${id}' (known: ${[...sandboxes.keys()].join(", ")}); run \`${route}\` ` +
        "with one of them", "EXEC_REPOSITORY_UNKNOWN");
    return { repository: name, ...sandbox };
  };
  let explicit = repository ? named(repository, "--repo") : null;
  if (task) {
    const wanted = String(task).toUpperCase();
    const row = tasks.find((candidate) => String(candidate.id || "").toUpperCase() === wanted);
    if (!row)
      execRefusal(fail, `exec --task names '${task}', which is not a task of change ` +
        `'${id}'; run \`claude-foundation exec ${id} --task <task-id> -- <command…>\` ` +
        "with a task id from its tasks.md", "EXEC_TASK_UNKNOWN");
    const owner = named(row.repository || "root", `--task ${row.id}`);
    if (explicit && explicit.repository !== owner.repository)
      execRefusal(fail, `exec --task ${row.id} belongs to repository '${owner.repository}', ` +
        `not '${explicit.repository}'; pass only one of --repo and --task`,
      "EXEC_REPOSITORY_CONFLICT");
    explicit = owner;
  }
  const caller = canonicalDirectory(callerCwd);
  const machine = checkout ? join(checkout, ".foundation") : null;
  // The caller's directory expressed inside one candidate sandbox, or null.
  const located = (sandbox) => {
    if (!caller) return null;
    if (isWithin(caller, sandbox.path)) return caller;
    for (const source of [sandbox.mirror, sandbox.target])
      if (source && isWithin(caller, source) &&
          !(source === sandbox.target && machine && isWithin(caller, machine)))
        return join(sandbox.path, relative(source, caller));
    return null;
  };
  // A mapped directory that does not exist in the sandbox (untracked in the
  // checkout, say) starts at the sandbox root instead.
  const start = (sandbox, cwd) => {
    const directory = canonicalDirectory(cwd);
    return {
      repository: sandbox.repository,
      workspace: sandbox.path,
      cwd: directory && isWithin(directory, sandbox.path) ? directory : sandbox.path
    };
  };
  if (explicit) return start(explicit, located(explicit));
  const byCaller = [...sandboxes.keys()].filter((name) => name !== "root")
    .map((name) => ({ repository: name, ...sandboxes.get(name) }))
    .map((sandbox) => [sandbox, located(sandbox)])
    .filter(([, cwd]) => cwd)
    .sort((left, right) => right[1].length - left[1].length);
  if (byCaller.length) return start(...byCaller[0]);
  const rootSandbox = { repository: "root", ...sandboxes.get("root") };
  const sharedCwd = located(rootSandbox);
  if (sharedCwd && sharedCwd !== shared) return start(rootSandbox, sharedCwd);
  const pending = [...new Set(tasks.filter((row) => !row.done)
    .map((row) => row.repository || "root"))];
  if (pending.length === 1 && sandboxes.has(pending[0]))
    return start({ repository: pending[0], ...sandboxes.get(pending[0]) }, null);
  const elsewhere = pending.filter((name) => name !== "root" && sandboxes.has(name));
  if (elsewhere.length)
    console.error("NOTICE: exec runs in the shared sandbox; pending tasks also belong to " +
      `repository ${elsewhere.map((name) => `'${name}'`).join(", ")}, whose checks run ` +
      `in its own sandbox: \`${route}\``);
  return start(rootSandbox, null);
}

// A build-phase command — a container build, a package install, a full test
// run — is usually the largest block of wall time the loop spends outside the
// model, and operations.jsonl never saw it: the exit hook records only the
// harness's own invocations. `exec` runs the command with inherited stdio,
// passes its exit code through untouched, and appends one observed-duration
// row so `metrics` can report external execution time next to harness
// operation time and evidence execution time.
export function createExecRuntime({
  logs, loadRuntime, now, fail, assertApproval = null, root = null, changeTasks = null,
  // The CLI wrapper changes to the project root before starting the runtime,
  // so it hands over the directory the caller actually stood in.
  callerCwd = () => process.env.FOUNDATION_CALLER_CWD || process.cwd(),
  // Brings the change's sandboxes current (the root sandbox's nested
  // repository paths) before a check runs in one of them.
  prepareWorkspace = () => {}
}) {
  function execObserved(id, commandArgs, { phase, repository = null, task = null } = {}) {
    const state = loadRuntime(id);
    assertApproval?.(id, state);
    if (state.status === "archived")
      fail("an archived change is finished evidence; exec records nothing against it");
    if (!commandArgs.length) fail("exec requires a command after --");
    const allowedPhases = phasesForStatus(state.status);
    const runtimePhase = phase || allowedPhases[0] || null;
    if (phase && !allowedPhases.includes(phase))
      fail(`exec phase '${phase}' does not match change state '${state.status}' (` +
        `${allowedPhases.join("|") || "none"})`);
    let cwd;
    let workspace;
    if (state.status === "building") {
      if (!state.workspace?.path) fail("Build exec requires an isolated workspace");
      if (!canonicalDirectory(state.workspace.path))
        fail("Build exec requires an existing isolated workspace");
    }
    // Build edits, and proof after Build reads, the isolated workspaces, so a
    // check run then belongs there too, never in the main checkout.
    if (["building", "proven"].includes(state.status) || repository || task) {
      let tasks = [];
      try { tasks = changeTasks ? changeTasks(id, state) || [] : []; }
      catch { tasks = []; }
      const resolved = resolveExecWorkspace({
        id, state, root, callerCwd: callerCwd(), repository, task, tasks, fail
      });
      if (resolved) ({ cwd, workspace } = resolved);
      if (resolved) prepareWorkspace(id);
    }
    const violation = executionCommandViolation(runtimePhase, commandArgs, workspace, cwd);
    // The same text-inferred shell policy as the live hook, enforced the same
    // way: outside Land it records instead of refusing, because it misreads
    // program text as escapes. A missing workspace is structural and refuses.
    if (violation && (!AUDITED_PHASES.has(runtimePhase) || shellGuardBlocks() ||
        /requires an (?:existing )?isolated workspace/.test(violation)))
      fail(violation);
    if (violation) console.error(`NOTICE: exec recorded an unverified shell mutation: ${violation}`);
    const startedAtMs = Date.now();
    const startedAt = now();
    const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
      stdio: "inherit", cwd,
      env: cwd ? { ...process.env, FOUNDATION_WORKSPACE_ROOT: workspace } : process.env
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
