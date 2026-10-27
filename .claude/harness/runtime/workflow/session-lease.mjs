import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { resumeThrough } from "../core/next-step.mjs";

// A session-mode Build task runs in the coordinating session itself, one task
// at a time. The agent used to acquire the lease, implement, release it, and
// tick tasks.md for every task. `advance` now issues the lease with the task
// and, on the next mutating `advance`, runs the task's own focused check
// (`— verify: \`...\``) in its workspace: a pass marks the task [x] in the
// isolated tasks.md and releases the lease with the same observed-write and
// scope checks. A failing or absent check leaves the task pending (a task the
// agent ticked itself is still accepted). Parallel groups keep explicit
// per-worker leases.
export const SESSION_OWNER_PREFIX = "session-";

export function sessionLeaseOwner(id, taskId, stableHash) {
  return `${SESSION_OWNER_PREFIX}${taskId.toLowerCase()}-${
    stableHash({ changeId: id, taskId, kind: "session-lease" }).slice(0, 12)}`;
}

export function isSessionOwner(owner) {
  return String(owner || "").startsWith(SESSION_OWNER_PREFIX);
}

// Whether the agent has marked exactly this task complete in the ledger.
export function taskLineChecked(content, taskId) {
  return new RegExp(`^\\s*-\\s*\\[[xX]\\]\\s*\\*{0,2}${taskId}\\*{0,2}\\b`, "m").test(content);
}

const TASK_LINE = (taskId) =>
  new RegExp(`^(\\s*-\\s*\\[)\\s(\\]\\s*\\*{0,2}${taskId}\\*{0,2}\\b.*)$`, "m");

// The pending ledger line's focused check and repository, or null when the
// task has no runnable check (no verify, or the amendment marker "existing").
export function taskCheck(content, taskId, { ticked = false } = {}) {
  const pattern = ticked
    ? new RegExp(`^\\s*-\\s*\\[[xX]\\]\\s*\\*{0,2}${taskId}\\*{0,2}\\b.*$`, "m")
    : TASK_LINE(taskId);
  const line = String(content || "").match(pattern)?.[0];
  if (!line) return null;
  const command = line.match(/—\s*verify:\s*`([^`]+)`/i)?.[1]?.trim() || "";
  if (!command || command === "existing") return null;
  return { taskId, command, repository: line.match(/\[repo:([^\]\s]+)\]/)?.[1] || "root" };
}

// The ledger line's `[depends: ...]` task ids, upper-cased like the plan.
export function taskDependencies(content, taskId) {
  const line = String(content || "").split("\n").find((row) =>
    new RegExp(`^\\s*-\\s*\\[[ xX]\\]\\s*\\*{0,2}${taskId}\\*{0,2}\\b`).test(row));
  const value = line?.match(/\[depends:\s*([^\]]*)\]/i)?.[1] || "";
  return value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
}

export function tickTaskLine(content, taskId) {
  return String(content).replace(TASK_LINE(taskId), "$1x$2");
}

export function untickTaskLine(content, taskId) {
  return String(content).replace(
    new RegExp(`^(\\s*-\\s*\\[)[xX](\\]\\s*\\*{0,2}${taskId}\\*{0,2}\\b.*)$`, "m"), "$1 $2");
}

// The primitive's refusal names `agents acquire`; a harness-owned lease is
// renewed by resuming, so the repair names that route instead.
function sessionScopeError(id, detail, through = "build") {
  const error = new Error(`${detail}. Revert edits that belong to another active task, ` +
    `then resume with 'claude-foundation advance ${id} --through ${through}'`);
  error.owner = "agent";
  error.boundary = "task-scope";
  return error;
}

export function createSessionLeaseRuntime({
  loadRuntime, activeChangeLeases, acquire, release, discard, stableHash,
  runCheck = null, saveRuntime = null,
  // (id, taskId) => reason | null. A behavior-changing task whose declared
  // paths have no diff did nothing: its verify passing proves nothing.
  taskChangeIssue = null
}) {
  const failedChecks = new Map();

  // Completion needs a change: a verify that already passed on unchanged code
  // hands the task back (counted like any repeated verify failure) instead of
  // ticking it. Refactor, docs, and chore work is never refused here.
  function completedWithoutChange(id, taskId, command) {
    const reason = taskChangeIssue?.(id, taskId) || null;
    if (!reason) return false;
    failedChecks.set(`${id}\0${taskId}`, { taskId, command, exitCode: null, output: reason });
    return true;
  }
  function ledgerPath(id) {
    const state = loadRuntime(id);
    const base = state.workspace?.path || null;
    return base ? join(base, "openspec", "changes", id, "tasks.md") : null;
  }

  function checked(id, taskId) {
    const path = ledgerPath(id);
    return Boolean(path && existsSync(path) &&
      taskLineChecked(readFileSync(path, "utf8"), taskId));
  }

  // Runs the handed-off task's focused check and ticks the isolated ledger on
  // a pass. The check is the approved task's own command in its workspace;
  // the harness never invents one and never ticks on a failure.
  function completeByCheck(id, taskId) {
    if (!runCheck || checked(id, taskId)) {
      if (!checked(id, taskId)) return false;
      const path = ledgerPath(id);
      if (!completedWithoutChange(id, taskId, null)) return true;
      writeFileSync(path, untickTaskLine(readFileSync(path, "utf8"), taskId));
      return false;
    }
    const path = ledgerPath(id);
    if (!path || !existsSync(path)) return false;
    const check = taskCheck(readFileSync(path, "utf8"), taskId);
    if (!check) return false;
    const result = runCheck(id, check);
    if (result?.status !== "pass") {
      failedChecks.set(`${id}\0${taskId}`, {
        taskId, command: check.command, exitCode: result?.exitCode ?? null,
        output: String(result?.output || "").slice(-2000)
      });
      return false;
    }
    if (completedWithoutChange(id, taskId, check.command)) return false;
    failedChecks.delete(`${id}\0${taskId}`);
    writeFileSync(path, tickTaskLine(readFileSync(path, "utf8"), taskId));
    return true;
  }

  // Releases every harness-issued session lease whose task the agent ticked.
  // Release itself renews authority a moved graph made stale. A lease past
  // its TTL is still the harness's own: a long task must not skip its
  // observed-write check.
  function settle(id) {
    const settled = [];
    for (const lease of activeChangeLeases(id, { includeExpired: true })) {
      if (!isSessionOwner(lease.owner) || !completeByCheck(id, lease.taskId)) continue;
      releaseOwned(id, lease.taskId, { owner: lease.owner, "lease-id": lease.leaseId });
      settled.push(lease.taskId);
    }
    // A single-agent plan takes no lease; the handed-off tasks are recorded
    // on the runtime instead so only work the agent was given is checked.
    const state = loadRuntime(id);
    const handoff = state.sessionHandoff?.taskIds || [];
    if (handoff.length && saveRuntime) {
      // Dependency order: a task whose dependency failed in this batch is not
      // verified or ticked; it is handed back with that dependency.
      const remaining = [];
      for (const taskId of handoff) {
        const path = ledgerPath(id);
        const blockedBy = path && existsSync(path)
          ? taskDependencies(readFileSync(path, "utf8"), taskId).filter((dep) => remaining.includes(dep))
          : [];
        if (blockedBy.length) {
          // A self-ticked dependent is reopened so it returns with its dependency.
          if (taskLineChecked(readFileSync(path, "utf8"), taskId))
            writeFileSync(path, untickTaskLine(readFileSync(path, "utf8"), taskId));
          failedChecks.set(`${id}\0${taskId}`, {
            taskId, command: null, exitCode: null, blockedBy,
            output: `not verified: depends on ${blockedBy.join(", ")}, whose verify failed`
          });
          remaining.push(taskId);
        } else if (!completeByCheck(id, taskId)) remaining.push(taskId);
        else recordVerified(id, taskId);
      }
      settled.push(...handoff.filter((taskId) => !remaining.includes(taskId)));
      const current = loadRuntime(id);
      if (remaining.length) current.sessionHandoff = { ...current.sessionHandoff, taskIds: remaining };
      else delete current.sessionHandoff;
      saveRuntime(current);
    }
    return settled;
  }

  // Every completion carries one kind of authority: a result the harness
  // records under its own lease after the task's verify passed. A no-lease
  // session handoff gets the same record here; if the plan cannot grant it
  // yet, the next advance re-verifies the ticked task.
  function recordVerified(id, taskId) {
    const owner = sessionLeaseOwner(id, taskId, stableHash);
    let granted;
    try {
      granted = acquire(id, taskId, { owner }, { quiet: true });
    } catch { return; /* reverify settles it on the next advance */ }
    try {
      releaseOwned(id, taskId, { owner, "lease-id": granted.leaseId });
    } catch (error) {
      if (error?.boundary === "task-scope") throw error;
    }
  }

  // An out-of-scope write is the agent's to revert; the handoff stays pending.
  function releaseOwned(id, taskId, flags) {
    try {
      release(id, taskId, flags, { quiet: true });
    } catch (error) {
      const message = String(error?.message || error);
      const scope = message.match(/^(task '[^']+' changed outside granted scope: [^;]+)/);
      if (scope) {
        let through = "build";
        try { through = resumeThrough(loadRuntime(id)); } catch { /* keep the bounded route */ }
        throw sessionScopeError(id, scope[1], through);
      }
      throw error;
    }
  }

  function withCheckFailures(id, value) {
    const failures = (value.tasks || []).map((task) =>
      failedChecks.get(`${id}\0${task.id}`)).filter(Boolean);
    return failures.length ? { ...value, verificationFailures: failures } : value;
  }

  function recordHandoff(id, value) {
    if (!saveRuntime) return value;
    const state = loadRuntime(id);
    const taskIds = (value.tasks || []).map((task) => task.id).filter(Boolean);
    if (JSON.stringify(state.sessionHandoff?.taskIds || []) === JSON.stringify(taskIds)) return value;
    state.sessionHandoff = { version: 1, taskIds };
    saveRuntime(state);
    return value;
  }

  // Grants the single session task its lease and tells the agent the harness
  // owns it. Parallel groups and non-EDIT actions pass through unchanged.
  function issue(id, value) {
    // Only a leased session task: a single-agent plan never took leases.
    if (value?.action === "EDIT" && value.execution?.mode === "session" &&
        !value.execution?.leases?.length && value.tasks?.length)
      return withCheckFailures(id, recordHandoff(id, value));
    if (value?.action === "EDIT" && value.execution?.mode === "parallel" &&
        value.execution?.leases?.length)
      return withCheckFailures(id, issueGroup(id, value));
    if (value?.action !== "EDIT" || value.execution?.mode !== "session" ||
        value.tasks?.length !== 1 || value.execution?.leases?.length !== 1)
      return value?.action === "EDIT" ? withCheckFailures(id, value) : value;
    const taskId = value.tasks[0].id;
    const owner = sessionLeaseOwner(id, taskId, stableHash);
    const granted = acquire(id, taskId, { owner }, { quiet: true });
    return withCheckFailures(id, {
      ...value,
      execution: {
        ...value.execution,
        leases: [],
        managedLease: { taskId, owner, leaseId: granted.leaseId, managedBy: "harness" }
      },
      instructions: [
        `Implement ${taskId} inside ${value.workspace} within its allowed paths.`,
        "Run its focused checks; do not acquire or release the lease, and do not edit tasks.md.",
        "When the checks pass, run the resume command: advance reruns the task's verify check, " +
        `marks ${taskId} [x] when it passes, releases the lease, and checks the observed writes ` +
        "against the task scope.",
        "A needed file outside the task paths is fine; Prove records it into the change surface.",
        // Keep the plan's own notes, such as a stale record to re-verify.
        ...(value.instructions || [])
      ]
    });
  }

  // A parallel worker releases its lease; the harness, not the worker, ticks
  // the ledger. Each accepted result is ticked once its verify check passes
  // in the workspace; a failure stays pending with its output.
  function tickAccepted(id, taskIds = []) {
    const ticked = [];
    for (const taskId of taskIds) {
      const path = ledgerPath(id);
      if (!path || !existsSync(path) || checked(id, taskId)) continue;
      const check = taskCheck(readFileSync(path, "utf8"), taskId);
      if (check && runCheck) {
        const result = runCheck(id, check);
        if (result?.status !== "pass") {
          failedChecks.set(`${id}\0${taskId}`, {
            taskId, command: check.command, exitCode: result?.exitCode ?? null,
            output: String(result?.output || "").slice(-2000)
          });
          continue;
        }
      }
      if (completedWithoutChange(id, taskId, check?.command || null)) continue;
      failedChecks.delete(`${id}\0${taskId}`);
      writeFileSync(path, tickTaskLine(readFileSync(path, "utf8"), taskId));
      ticked.push(taskId);
    }
    return ticked;
  }

  // A ticked task whose execution record went stale (an amendment, an
  // expired lease, work finished outside a lease) is implemented, not
  // pending. The harness re-verifies it under its own lease: the task's check
  // must pass, and the result is recorded against the current authority.
  // A task a live worker holds, an unticked task, a failing check, or one
  // blocked behind an unverified dependency stays with the plan.
  function reverify(id, rows = []) {
    const verified = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const { taskId } of rows) {
        if (verified.includes(taskId) || !checked(id, taskId)) continue;
        if (activeChangeLeases(id).some((lease) =>
          lease.taskId === taskId && !isSessionOwner(lease.owner))) continue;
        const path = ledgerPath(id);
        const check = path && existsSync(path)
          ? taskCheck(readFileSync(path, "utf8"), taskId, { ticked: true }) : null;
        if (check && runCheck) {
          const result = runCheck(id, check);
          if (result?.status !== "pass") {
            failedChecks.set(`${id}\0${taskId}`, {
              taskId, command: check.command, exitCode: result?.exitCode ?? null,
              output: String(result?.output || "").slice(-2000)
            });
            continue;
          }
        }
        const owner = sessionLeaseOwner(id, taskId, stableHash);
        try {
          const granted = acquire(id, taskId, { owner }, { quiet: true });
          release(id, taskId, { owner, "lease-id": granted.leaseId }, { quiet: true });
        } catch { continue; }
        verified.push(taskId);
        progressed = true;
      }
    }
    return verified;
  }

  // A parallel group runs in native workers, but its leases are the
  // harness's, exactly as for a session task: `advance` acquires them here and
  // settles each on resume (verify, tick, release, scope check). The parent
  // only spawns workers and waits; nobody acquires, releases, or ticks.
  function issueGroup(id, value) {
    const managedLeases = [];
    try {
      for (const worker of value.execution.leases) {
        const owner = sessionLeaseOwner(id, worker.taskId, stableHash);
        const granted = acquire(id, worker.taskId, { owner }, { quiet: true });
        managedLeases.push({ taskId: worker.taskId, owner, leaseId: granted.leaseId, managedBy: "harness" });
      }
    } catch (error) {
      // A partial group never runs; return the leases it already took.
      for (const lease of managedLeases) {
        try { discard(id, lease.taskId, lease.owner); } catch { /* the next advance renews or reclaims it */ }
      }
      throw error;
    }
    return {
      ...value,
      execution: {
        ...value.execution,
        leases: [],
        workers: value.execution.leases.map((worker) => ({
          taskId: worker.taskId, repository: worker.repository || null,
          model: worker.model || null, packetCommand: worker.packetCommand
        })),
        managedLeases
      },
      instructions: [
        "Spawn one native worker per execution.workers entry and give it only the output of " +
        "its packetCommand and the repository state; never replay this transcript.",
        "Each worker implements only its task inside its allowed paths and runs the task's " +
        "focused check. Nobody acquires or releases a lease or edits tasks.md.",
        "Wait for every worker, then run the resume command once: advance reruns each task's " +
        "verify, ticks the passing tasks, releases their leases, and hands back only failures.",
        ...(value.instructions || [])
      ]
    };
  }

  // An explicit lease primitive supersedes the harness-held one: the caller
  // took the task over, so the held lease is dropped without a completion.
  function yieldTo(id) {
    for (const lease of activeChangeLeases(id))
      if (isSessionOwner(lease.owner)) discard(id, lease.taskId, lease.owner);
  }

  return { settle, issue, yieldTo, reverify, tickAccepted };
}

// Runs one task's focused check in the task's isolated repository, in the
// foreground and bounded. The command is the approved ledger's own verify.
export function runTaskCheck({
  loadRuntime, spawn = spawnSync, env = process.env, timeoutMs = 10 * 60 * 1000
}, id, check) {
  const state = loadRuntime(id);
  const cwd = state.repositories?.[check.repository]?.path ||
    (check.repository === "root" ? state.workspace?.path : null);
  if (!cwd) return {
    status: "unavailable", exitCode: null,
    output: `no isolated workspace is recorded for repository '${check.repository}'`
  };
  const result = spawn("sh", ["-c", check.command], {
    cwd, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024
  });
  return {
    status: result.status === 0 && !result.error ? "pass" : "fail",
    exitCode: result.status ?? null,
    output: `${result.stdout || ""}${result.stderr || ""}${result.error ? `\n${result.error.message}` : ""}`
  };
}
