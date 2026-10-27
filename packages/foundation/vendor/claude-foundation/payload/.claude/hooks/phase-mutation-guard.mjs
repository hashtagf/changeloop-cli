#!/usr/bin/env node

// Phase-aware PreToolUse guard. The default auto mode blocks whenever an
// active Foundation phase is known and stays out of adoption-only sessions.
// Hosts may still select explicit audit/block/off behavior.

import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync,
  readdirSync, readFileSync, realpathSync, renameSync, statSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  looksMutatingShellCommand, normalizeHarnessCliInvocations, pinShellAnchor,
  shellMutationViolation
} from "./phase-guard-policy.mjs";
import { recordedPhaseContext } from "./phase-state.mjs";
import { devPrompt } from "./dev-terminal-guard.mjs";
import {
  gitPublicationOperations, isApprovalReply, promptExchange, promptRequestsDelivery,
  requestedGitPublication
} from "./prompt-authority.mjs";
import {
  workspaceCapabilityValue, workspaceMutationDecision
} from "../harness/runtime/core/execution-contract.mjs";

// Large enough that a real audit trail survives a working session, small enough
// that an unattended project never carries an unbounded file.
const AUDIT_MAX_BYTES = 1024 * 1024;

// How long a recorded phase governs. The loop writes a new row at every phase
// transition, so a row older than this means no Foundation phase is running
// and the guard has nothing to enforce.
const PHASE_FRESHNESS_MS = 12 * 60 * 60 * 1000;

const requestedMode = (process.env.FOUNDATION_GUARDRAIL_MODE || "auto").toLowerCase();
const configuredMode = new Set(["auto", "audit", "block", "off"]).has(requestedMode)
  ? requestedMode : "block";
if (configuredMode === "off") process.exit(0);

let event;
try {
  event = JSON.parse(await readStdin());
} catch {
  // A broken hook never stops the agent. Only a host that explicitly asked
  // for enforcement refuses an unreadable event, which could be any mutation.
  if (configuredMode === "block")
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: "phase guard: hook event is unreadable; retry the tool call"
    }));
  process.exit(0);
}

// Claude hook events already carry the authoritative transcript path. The
// SessionStart-exported environment is only a fallback: claude -p does not
// reliably propagate CLAUDE_ENV_FILE additions into later hook processes.
// Decide after parsing the event so a /dev session enters block mode before
// its first product mutation even when the exported environment is absent.
const transcriptPath = String(event.transcript_path ||
  process.env.FOUNDATION_CLAUDE_TRANSCRIPT_PATH || "");
const devSession = ["auto", "audit"].includes(configuredMode) &&
  currentTranscriptIsDev(transcriptPath);
const investigateSession = currentTranscriptIsInvestigate(transcriptPath);

const tool = String(event.tool_name || "");
const input = event.tool_input || {};
const mutatingTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// `npx claude-foundation …` and bin-path spellings match exactly as the bare CLI.
const harnessCommand = normalizeHarnessCliInvocations(String(input.command || ""));
const landAuthorityCommand = tool === "Bash" &&
  /^\s*(?:claude-foundation|node\s+(?:"[^"]*foundation\.mjs"|'[^']*foundation\.mjs'|\S*foundation\.mjs))\s+(?:(?:land(?:-|\s+)advance)|archive|sandbox\s+apply)\s+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\s*$/
    .test(harnessCommand);
const deliverAuthorityCommand = tool === "Bash" &&
  /^\s*(?:claude-foundation\s+deliver\s+advance|node\s+(?:"[^"]*foundation\.mjs"|'[^']*foundation\.mjs'|\S*foundation\.mjs)\s+delivery-advance)\s+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\s*$/
    .test(harnessCommand);
if (!mutatingTools.has(tool) && tool !== "Bash") process.exit(0);
if (tool === "Bash" && !landAuthorityCommand && !deliverAuthorityCommand &&
    !looksMutatingShellCommand(String(input.command || ""))) process.exit(0);

const projectRoot = canonical(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const recorded = recordedPhaseContext({
  projectRoot,
  sessionId: event.session_id || process.env.FOUNDATION_CLAUDE_SESSION_ID || null,
  freshnessMs: PHASE_FRESHNESS_MS,
  pathExists: existsSync,
  readDirectory: (path) => readdirSync(path, { withFileTypes: true }),
  readText: readFileSync,
  nowMs: Date.now
});
const landSession = landAuthorityCommand && currentTranscriptIsLand(transcriptPath);
const deliverInvocation = currentTranscriptIsDeliver(transcriptPath);
// "เปิด PR ให้เลย", "open a PR", or a yes to the delivery question the hook
// asked last turn is the user's /deliver for this one composite command. It
// authorizes nothing else in the turn.
const exchange = deliverAuthorityCommand || looksGitPublication()
  ? currentPromptExchange(transcriptPath) : { latest: "", previousTurn: "" };
const deliverSession = deliverAuthorityCommand && (deliverInvocation ||
  promptRequestsDelivery(exchange.latest) ||
  (isApprovalReply(exchange.latest) && exchange.previousTurn.includes("ASK_USER: delivering ")));
let gitAuthorityQuestion = null;
const phase = String(process.env.FOUNDATION_ACTIVE_PHASE ||
  (deliverInvocation ? "deliver" : recorded?.phase ||
    (landSession ? "land" : investigateSession.active ? "investigate" : ""))).toLowerCase();
const mode = devSession || landAuthorityCommand || deliverAuthorityCommand ||
  deliverInvocation || configuredMode === "block" ||
  (configuredMode === "auto" && Boolean(phase)) ? "block" : "audit";
// `land advance` is a compatibility alias. It is rewritten to the public
// proof-required route in every session and mode, /land included, so no
// spelling reaches Land by a path other than `advance --through archived`.
if (landAuthorityCommand && /\sland(?:-|\s+)advance\s/.test(harnessCommand)) {
  const changeArgument = harnessCommand.trim().match(/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\s*$/)?.[1];
  const routed = `claude-foundation advance ${changeArgument} --through archived`;
  recordAudit({ phase: phase || "unknown", tool, mode, outcome: "routed",
    reason: "land advance is an alias of advance --through archived",
    command: String(input.command || "") });
  respond({ ...input, command: routed },
    `phase guard routed '${harnessCommand.trim()}' to '${routed}', the public Land route. ` +
    "Land only on an explicit user instruction to land.");
  process.exit(0);
}
const recordedRuntime = recorded?.changeId ? runtimeState(recorded.changeId) : null;
const recordedWorkspace = recordedRuntime?.workspace?.path
  ? canonicalTarget(recordedRuntime.workspace.path, projectRoot) || "" : "";
// Each writable non-root repository of the change is edited in its own
// sandbox. The shared sandbox's copy of that repository (an empty or missing
// submodule directory) is its mirror: never the place its work lives.
const repositoryWorkspaces = Object.entries(recordedRuntime?.repositories || {})
  .filter(([id, record]) => id !== "root" && record?.access !== "read" && record?.mode !== "read" &&
    typeof (record?.path || record?.workspacePath) === "string")
  .map(([id, record]) => {
    const path = canonicalTarget(record.path || record.workspacePath, projectRoot);
    const target = record.targetPath ? canonicalTarget(record.targetPath, projectRoot) : null;
    const rel = target && isWithin(target, projectRoot) ? relative(projectRoot, target) : "";
    return { repository: id, path,
      mirror: recordedWorkspace && rel ? join(recordedWorkspace, rel) : null };
  })
  .filter((row) => row.path && (!recordedWorkspace || row.path !== recordedWorkspace));
const readOnlyRepositoryWorkspaces = Object.entries(recordedRuntime?.repositories || {})
  .filter(([id, record]) => id !== "root" && (record?.access === "read" || record?.mode === "read"))
  .map(([id, record]) => ({ repository: id,
    path: canonicalTarget(record?.path || record?.workspacePath || "", projectRoot) }))
  .filter((row) => row.path && (!recordedWorkspace || row.path !== recordedWorkspace));
const violations = [];
// Shell containment is inferred from command text, so it misreads program
// text (sed scripts, `$(…)` captures, scratch copies) as escapes and cost
// Builds whole turns. Outside Land and Deliver authority it records instead
// of blocking; structured Write/Edit targets stay enforced, and Land detects
// target edits made outside the sandbox. FOUNDATION_SHELL_GUARD=block restores
// shell blocking.
const shellAuditPhases = new Set(["investigate", "change", "build", "prove"]);
const shellGuardBlocks = (process.env.FOUNDATION_SHELL_GUARD || "").toLowerCase() === "block";
let shellAudit = null;

if (landAuthorityCommand && !landSession)
  violations.push("Land authority command requires the current /land invocation");
if (deliverAuthorityCommand && !deliverSession)
  violations.push("Deliver authority command requires the current /deliver invocation");

// Explicit block mode fails closed without context. Auto mode deliberately
// stays out of adoption-only sessions, but becomes block as soon as a current
// phase context or /dev transcript establishes lifecycle authority.
if (!phase && mode !== "block") process.exit(0);

if (!phase && prePhaseDraftMutationAllowed()) {
  // Atomic Change starts need one narrowly-scoped bootstrap write before a
  // lifecycle phase exists. Both the legacy change-start name and the v3
  // drafts directory are temporary data consumed by `change start`; neither
  // is product code or authority. Shell writes remain blocked so redirects
  // cannot smuggle additional mutations into the bootstrap boundary.
  process.exit(0);
} else if (!phase && tool === "Bash" && !shellGuardBlocks && violations.length === 0) {
  // Before a change exists the shell only reproduces, inspects, and writes the
  // draft the loop asks for. It is recorded, not refused: structured product
  // edits stay blocked, and Build isolation starts once the change does.
  recordAudit({ phase: "unknown", tool, mode, outcome: "shell-audit",
    reason: "no active phase", command: String(input.command || "") });
  process.exit(0);
} else if (!phase) {
  violations.push("active phase is unavailable; write the semantic draft to " +
    ".foundation/drafts/<change-id>.json and run 'claude-foundation change start " +
    "<draft> --inspect' before editing product files");
} else if (!new Set(["investigate", "change", "build", "prove", "land", "deliver"])
  .has(phase)) {
  violations.push(`unsupported active phase: ${phase}`);
} else if (phase === "deliver" && !deliverSession) {
  violations.push("Deliver permits mutations only through its trusted composite command");
} else if (tool === "Bash" && !landSession && !deliverSession) {
  inspectBash(String(input.command || ""));
} else {
  for (const rawPath of eventPaths(input)) inspectPath(rawPath);
}

if (violations.length === 0 && shellAudit !== null) {
  recordAudit({ phase, tool, mode, changeId: recorded?.changeId || null,
    outcome: "shell-audit", reason: shellAudit, command: String(input.command || "") });
  if (mode === "block") process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `phase guard (${phase}/Bash) recorded an unverified shell mutation: ` +
        `${shellAudit}. It ran unguarded; keep mutations inside the active phase workspace. ` +
        "Land reports target-checkout edits made outside the sandbox."
    }
  }));
  process.exit(0);
}

if (violations.length === 0) process.exit(0);

// The harness guides instead of refusing. A refused tool call costs the agent
// a turn and tells it nothing it can run; a redirected or routed call keeps
// the work moving on the path the workflow wants. Only a host that explicitly
// configures FOUNDATION_GUARDRAIL_MODE=block keeps the refusals below.
if (configuredMode === "auto") {
  guide();
  process.exit(0);
}
if (configuredMode === "audit") {
  recordAudit({ phase: phase || "unknown", tool, mode: "audit", outcome: "audit-only",
    reason: violations.join("; ") });
  process.exit(0);
}

const changeShellRecovery = phase === "change" && tool === "Bash"
  ? " Use Edit or Write for openspec/changes artifacts; Bash remains read-only during Change."
  : "";
const reason = `BLOCKED: phase guard (${phase || "unknown"}/${tool}): ${violations.join("; ")}. ` +
  `No mutation ran.${changeShellRecovery} Continue inside the active phase workspace, ` +
  "or ask the user only if scope or authority must change.";
recordAudit({ phase: phase || "unknown", tool, mode,
  outcome: mode === "block" ? "blocked" : "audit-only", reason });

if (mode === "block") {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function guide() {
  const changeId = recorded?.changeId || "<change>";
  const command = harnessCommand.trim();
  const changeArgument = command.match(/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\s*$/)?.[1] || changeId;
  if (landAuthorityCommand && !landSession) {
    // The internal Land routes become the public one, which owns the grant,
    // readiness, recovery, and the exact Land boundary.
    const routed = `claude-foundation advance ${changeArgument} --through archived`;
    recordAudit({ phase: phase || "unknown", tool, mode, outcome: "routed",
      reason: violations.join("; "), command: String(input.command || "") });
    respond({ ...input, command: routed },
      `phase guard routed '${command}' to '${routed}', the public Land route. Land only on an explicit user instruction to land.`);
    return;
  }
  if (gitAuthorityQuestion) {
    // A commit or push from the main checkout during Build or Prove is the
    // user's call, not the agent's: it does not run, and becomes the question.
    const message = `ASK_USER: ${gitAuthorityQuestion} from the main checkout during ${phase} was not run. ` +
      "Commit and push happen through /deliver or on the user's direct instruction; " +
      "ask the user, and on their yes run the same command again.";
    recordAudit({ phase, tool, mode, outcome: "routed",
      reason: violations.join("; "), command: String(input.command || "") });
    respond({ ...input, command: `printf '%s\\n' '${message.replaceAll("'", "")}'` }, message);
    return;
  }
  if (deliverAuthorityCommand && !deliverSession) {
    // Delivery commits, pushes, and opens a pull request: that is the user's
    // call. The command becomes the question the agent must ask.
    const message = `ASK_USER: delivering '${changeArgument}' commits, pushes, and opens a pull request. ` +
      `Ask the user; on their explicit yes they run /deliver ${changeArgument}.`;
    recordAudit({ phase: phase || "unknown", tool, mode, outcome: "routed",
      reason: violations.join("; "), command: String(input.command || "") });
    respond({ ...input, command: `printf '%s\\n' '${message.replaceAll("'", "")}'` }, message);
    return;
  }
  const redirected = mutatingTools.has(tool) ? redirectToWorkspace(input) : null;
  if (redirected) {
    recordAudit({ phase: phase || "unknown", tool, mode, outcome: "redirected",
      reason: violations.join("; ") });
    respond(redirected.input, `phase guard redirected ${redirected.from.join(", ")} to the isolated ` +
      `workspace (${redirected.to.join(", ")}); the main checkout changes only through Land. ` +
      "Read the workspace file first if the tool asks for it.");
    return;
  }
  recordAudit({ phase: phase || "unknown", tool, mode, outcome: "guided",
    reason: violations.join("; "), command: tool === "Bash" ? String(input.command || "") : undefined });
  respond(null, `phase guard (${phase || "no phase"}/${tool}) let this run: ${violations.join("; ")}. ${route()}`);
}

function route() {
  const id = recorded?.changeId || "<change>";
  if (!phase) return "To make this a tracked change, write .foundation/drafts/<change-id>.json and run " +
    "'claude-foundation change start <draft>'; edits made now become part of that change's starting surface.";
  if (phase === "investigate") return "Investigate records findings; turn them into a change with /change.";
  if (phase === "change") return `Product work belongs to Build: get spec approval, then run ` +
    `'claude-foundation advance ${id} --through build' and edit in the workspace it returns.`;
  if (phase === "build" || phase === "prove") return `Keep product edits in the isolated workspace` +
    `${recordedWorkspace ? ` (${recordedWorkspace})` : ""}; Land reports main-checkout edits made outside it.`;
  return "Land and Deliver own the main checkout; repair in the isolated workspace and resume " +
    `'claude-foundation advance ${id} --through archived', or start a new change for new work.`;
}

function respond(updatedInput, context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: "PreToolUse",
    ...(updatedInput ? { updatedInput } : {}),
    additionalContext: context
  } }));
}

// A product edit aimed at the main checkout while an isolated workspace
// exists is moved to the same path inside that workspace (or the workspace of
// the repository it belongs to), so the agent's intent lands where the
// workflow wants it instead of being refused.
function redirectToWorkspace(value) {
  if (!["build", "prove", "land"].includes(phase) || !recordedRuntime) return null;
  const pairs = [[projectRoot, recordedWorkspace],
    ...Object.values(recordedRuntime.repositories || {}).map((repository) =>
      [repository?.targetPath, repository?.workspacePath || repository?.path])]
    .map(([from, to]) => [from && canonicalTarget(from, projectRoot), to && canonicalTarget(to, projectRoot)])
    .filter(([from, to]) => from && to && existsSync(to));
  const machine = join(projectRoot, ".foundation");
  const from = [];
  const to = [];
  const next = { ...value };
  // The shared sandbox's copy of a repository moves to that repository's own
  // sandbox; nothing else under machine state is redirected.
  const mirrors = repositoryWorkspaces.filter((row) => row.mirror && existsSync(row.path))
    .map((row) => [row.mirror, row.path]);
  for (const key of ["file_path", "notebook_path"]) {
    if (typeof value[key] !== "string") continue;
    const target = canonicalTarget(value[key], projectRoot);
    if (!target) return null;
    const candidates = isWithin(target, machine) ? mirrors : pairs;
    const pair = candidates.filter(([source, workspace]) => isWithin(target, source) && !isWithin(target, workspace))
      .sort((left, right) => right[0].length - left[0].length)[0];
    if (!pair) return null;
    next[key] = join(pair[1], relative(pair[0], target));
    from.push(value[key]);
    to.push(next[key]);
  }
  return from.length ? { input: next, from, to } : null;
}

function inspectPath(rawPath) {
  if (phase === "deliver") {
    violations.push("Deliver permits mutations only through its trusted composite command");
    return;
  }
  const target = canonicalTarget(rawPath, projectRoot);
  if (!target) {
    violations.push("mutation target is missing or invalid");
    return;
  }
  if (scratchTarget(target)) return;

  const investigations = join(projectRoot, "openspec", "investigations");
  const prototypes = join(projectRoot, ".foundation", "prototypes");
  // A Build phase recorded before its sandbox exists still points at the main
  // checkout; treating that as the isolated workspace let product edits land
  // in the target. Only machine state and change packets are writable then.
  if (phase === "build" && !process.env.FOUNDATION_WORKSPACE_ROOT &&
      recordedRuntime?.workspace?.mode === "current") {
    if (!isWithin(target, join(projectRoot, ".foundation")) &&
        !isWithin(target, join(projectRoot, "openspec", "changes")))
      violations.push("the Build workspace has not been created yet; run " +
        `'claude-foundation advance ${recorded.changeId} --through build' to create it, then edit inside it`);
    return;
  }
  const workspace = process.env.FOUNDATION_WORKSPACE_ROOT || recordedWorkspace;
  // `.foundation` is machine state and otherwise writable, but a write into the
  // shared sandbox's copy of a selected repository would be work no Review,
  // Prove, or Land ever reads.
  const mirror = ["build", "prove"].includes(phase)
    ? repositoryWorkspaces.find((row) => row.mirror && isWithin(target, row.mirror)) : null;
  if (mirror) {
    violations.push(`repository '${mirror.repository}' is edited in its repository sandbox ` +
      `(${mirror.path}), not in the shared sandbox's copy of it`);
    return;
  }
  // A read-selected repository's sandbox is proof input, never a write root.
  const readOnly = ["build", "prove"].includes(phase)
    ? readOnlyRepositoryWorkspaces.find((row) => isWithin(target, row.path)) : null;
  if (readOnly) {
    violations.push(`repository '${readOnly.repository}' is read-only for this change`);
    return;
  }
  // Proof is bound to workspace content, so a repair inside the isolated
  // workspace after Prove only makes the proof stale; the next advance proves
  // it again. The main checkout stays read-only.
  if (phase === "prove" && workspace && workspaceCapabilityValue(
    recorded?.changeId || "active", {
      ...(recordedRuntime || {}), status: "building",
      workspace: { ...(recordedRuntime?.workspace || {}),
        path: canonicalTarget(workspace, projectRoot) }
    }).roots.some((root) => isWithin(target, canonicalTarget(root, projectRoot) || root)))
    return;
  const status = phase === "build" ? "building" : phase === "prove" ? "proven"
    : phase === "land" ? "applied" : "change";
  const capability = phase === "investigate" ? { phase: "investigate", roots: [] } :
    workspaceCapabilityValue(recorded?.changeId || "active", {
    ...(recordedRuntime || {}),
    status,
    workspace: {
      ...(recordedRuntime?.workspace || {}),
      path: workspace ? canonicalTarget(workspace, projectRoot) : null
    }
  });
  // Direct runtime fixtures and legacy consumers may establish Land through
  // the transaction marker before a repository projection is readable. Limit
  // that compatibility case to the current project; recorded modern state
  // always supplies the exact target roots above.
  if (phase === "land" && capability.roots.length === 0 && !recordedRuntime &&
      process.env.FOUNDATION_LAND_TRANSACTION === "1")
    capability.roots = [projectRoot];
  // Change can target any active change draft because the hook event does not
  // carry a trustworthy change ID on every host. The runtime still validates
  // the selected change before state transitions.
  if (phase === "change") capability.roots = [join(projectRoot, "openspec", "changes")];
  // Targets are canonical; compare them with canonical roots so a repository
  // sandbox spelled through a symlink is still in-workspace.
  if (phase === "build")
    capability.roots = capability.roots.map((root) => canonicalTarget(root, projectRoot) || root);
  const decision = workspaceMutationDecision({
    capability,
    target,
    foundationRoot: join(projectRoot, ".foundation"),
    investigationRoot: investigations,
    investigationStateRoot: join(projectRoot, ".foundation", "investigations"),
    prototypeRoot: investigateSession.compare
      ? approvedPrototypeTarget(target, investigations, prototypes) : null,
    investigationCompare: investigateSession.compare,
    additionalRoots: allowedPaths(),
    landTransaction: process.env.FOUNDATION_LAND_TRANSACTION === "1",
    contains: isWithin
  });
  if (!decision.allowed) violations.push(decision.reason);
}

function approvedPrototypeTarget(target, investigations, prototypes) {
  if (!isWithin(target, prototypes) || !existsSync(investigations)) return null;
  for (const entry of readdirSync(investigations, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const record = JSON.parse(readFileSync(join(investigations, entry.name), "utf8"));
      if (record?.mode !== "compare" || !Array.isArray(record.options)) continue;
      for (const option of record.options) {
        for (const declared of Array.isArray(option?.prototypePaths)
          ? option.prototypePaths : []) {
          const approved = canonicalTarget(declared, projectRoot);
          if (approved === target && isWithin(approved, join(prototypes, String(record.id || ""))))
            return approved;
        }
      }
    } catch { /* malformed records grant no write capability */ }
  }
  return null;
}

function inspectBash(command) {
  const workspace = process.env.FOUNDATION_WORKSPACE_ROOT || recordedWorkspace;
  const environment = {
    ...process.env,
    ...(recordedWorkspace && !process.env.FOUNDATION_WORKSPACE_ROOT
      ? { FOUNDATION_WORKSPACE_ROOT: recordedWorkspace } : {}),
    // Only the recorded runtime names repository roots; an inherited value
    // never widens what the shell may mutate.
    FOUNDATION_REPOSITORY_WORKSPACES_JSON: JSON.stringify(repositoryWorkspaces)
  };
  const inspection = workspace ? {
    canonicalTarget: (target) => canonicalTarget(target, workspace),
    contains: (target, root) => isWithin(target, canonical(root))
  } : null;
  if (gitPublicationFromMainCheckout(command, workspace, environment, inspection)) return;
  const violation = shellMutationViolation(phase, environment, command, inspection);
  if (!violation) return;
  const pinned = phase === "build" && mode === "block" && workspace
    ? pinnedWorkspaceCommand(command, workspace, environment, inspection) : null;
  const refusal = pinned === null ? violation : pinned.violation || null;
  if (refusal === null) return;
  if (shellAuditPhases.has(phase) && !shellGuardBlocks) shellAudit = refusal;
  else violations.push(refusal);
}

// `git commit` / `git push` during Build or Prove outside the isolated
// workspace targets the user's checkout or remote. It runs only when the
// user's latest prompt asked for it directly, or answered yes to the question
// this hook asked; otherwise it becomes that question. Returns true when the
// command is settled here.
function gitPublicationFromMainCheckout(command, workspace, environment, inspection) {
  if (!["build", "prove"].includes(phase)) return false;
  const operations = gitPublicationOperations(command);
  if (!operations.length) return false;
  if (workspace && (shellMutationViolation("build", environment, command, inspection) === null ||
      pinnedWorkspaceCommand(command, workspace, environment, inspection, "build")?.violation === null))
    return false;
  const requested = requestedGitPublication(exchange.latest);
  // A yes covers exactly the operations that question named.
  const asked = /ASK_USER: (.+?) from the main checkout during (build|prove)\b/
    .exec(exchange.previousTurn || "");
  const answered = Boolean(asked) && asked[2] === phase && isApprovalReply(exchange.latest) &&
    operations.every((operation) => asked[1].split(" and ").includes(operation));
  if (answered || operations.every((operation) => requested[operation.slice(4)])) {
    recordAudit({ phase, tool, mode, changeId: recorded?.changeId || null,
      outcome: "user-instructed", reason: `${operations.join(", ")} on the user's instruction`,
      command: String(command) });
    return true;
  }
  gitAuthorityQuestion = operations.join(" and ");
  violations.push(`${gitAuthorityQuestion} from the main checkout during ${phase} needs the user's ` +
    "direct instruction or /deliver");
  return true;
}

// The host reports where the shell is. That report is never authority — it
// cannot let a mutation run where the policy would refuse it — but a report
// inside the workspace is checked by pinning it into the command as a literal
// anchor, so the same policy proves the mutation. The command itself is not
// rewritten: it already runs in that directory, and a `cd … &&` prefix turns
// every test run into a compound command the host asks the user to approve. No report
// (OpenCode synthesizes events without one), a report outside the workspace,
// or a pinned form the policy still refuses keeps the refusal; a refusal of
// the pinned form is the more exact reason (an outside operand, a dynamic
// path) and replaces the anchor complaint.
function pinnedWorkspaceCommand(command, workspace, environment, inspection, policyPhase = phase) {
  const reported = typeof event.cwd === "string" ? event.cwd : "";
  if (!reported || !isAbsolute(reported)) return null;
  const canonicalCwd = canonicalTarget(reported, projectRoot);
  // The report may sit in the shared sandbox or in one of the change's
  // repository sandboxes; either is pinned and proven by the same policy.
  const home = canonicalCwd ? [workspace, ...repositoryWorkspaces.map((row) => row.path)]
    .find((root) => isWithin(canonicalCwd, canonical(root))) : null;
  if (!home) return null;
  // The workspace may be spelled through a symlink (macOS /var → /private/var,
  // a linked sandbox path) while the report is canonical, or the reverse; the
  // policy compares text, so also try the report re-spelled under the
  // workspace the policy was given.
  const respelled = resolve(home, relative(canonical(home), canonicalCwd));
  for (const directory of [...new Set([resolve(reported), canonicalCwd, respelled])]) {
    const pinned = pinShellAnchor(command, directory);
    if (pinned === null) continue;
    const violation = shellMutationViolation(policyPhase, environment, pinned, inspection);
    if (violation && violation.startsWith("Build shell mutations must start inside")) continue;
    return { command: pinned, violation };
  }
  return null;
}

function runtimeState(changeId) {
  try {
    return JSON.parse(readFileSync(join(projectRoot, ".foundation", "runtime",
      `${changeId}.json`), "utf8"));
  } catch { return null; }
}

function currentTranscriptIsDev(path) {
  if (!path || !existsSync(path)) return false;
  let descriptor = null;
  try {
    // The initiating prompt is near the transcript header. Bound this hot-path
    // read: the guard runs for every candidate mutation and long sessions can
    // otherwise add megabytes of I/O to each tool call.
    const bytes = Math.min(statSync(path).size, 512 * 1024);
    const buffer = Buffer.alloc(bytes);
    descriptor = openSync(path, "r");
    const read = readSync(descriptor, buffer, 0, bytes, 0);
    return Boolean(devPrompt(buffer.subarray(0, read).toString("utf8")));
  } catch { return false; }
  finally { if (descriptor !== null) closeSync(descriptor); }
}

// The prompt the user typed last. Claude Code appends the `last-prompt` row
// late — after the first tool calls of the turn — so a newly typed `/land` also
// counts through its own user row (`<command-name>/land</command-name>`).
// Whichever row appears later in the transcript wins.
function latestTypedPrompt(source) {
  let latest = "";
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.type === "last-prompt" && typeof row.lastPrompt === "string") {
        latest = row.lastPrompt.trim();
        continue;
      }
      if (row.type !== "user" || row.isMeta) continue;
      const content = row.message?.content;
      const text = typeof content === "string" ? content
        : Array.isArray(content) && !content.some((part) => part?.type === "tool_result")
          ? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
          : "";
      const command = text.match(/<command-name>\s*(\/[\w:-]+)\s*<\/command-name>/);
      if (command) {
        const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
        latest = args ? `${command[1]} ${args}` : command[1];
      } else if (text.trim() && !/^<(?:local-command|system-reminder)/.test(text.trim())) {
        latest = text.trim();
      }
    } catch { /* tolerate a partially flushed final line */ }
  }
  return latest;
}

function currentTranscriptIsLand(path) {
  if (!path || !existsSync(path)) return false;
  try {
    return /^\/land(?:\s|$)/.test(latestTypedPrompt(readFileSync(path, "utf8")));
  } catch { return false; }
}

function looksGitPublication() {
  return tool === "Bash" && gitPublicationOperations(String(input.command || "")).length > 0;
}

function currentPromptExchange(path) {
  if (!path || !existsSync(path)) return { latest: "", previousTurn: "" };
  try { return promptExchange(readFileSync(path, "utf8")); }
  catch { return { latest: "", previousTurn: "" }; }
}

function currentTranscriptIsDeliver(path) {
  if (!path || !existsSync(path)) return false;
  try {
    const source = readFileSync(path, "utf8");
    let latest = "";
    for (const line of source.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.type === "last-prompt" && typeof row.lastPrompt === "string")
          latest = row.lastPrompt.trim();
      } catch { /* tolerate a partially flushed final line */ }
    }
    return /^\/deliver(?:\s|$)/.test(latest);
  } catch { return false; }
}

function currentTranscriptIsInvestigate(path) {
  if (!path || !existsSync(path)) return { active: false, compare: false };
  try {
    const source = readFileSync(path, "utf8");
    let latest = "";
    for (const line of source.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.type === "last-prompt" && typeof row.lastPrompt === "string")
          latest = row.lastPrompt.trim();
      } catch { /* tolerate a partially flushed final line */ }
    }
    return {
      active: /^\/investigate(?:\s|$)/.test(latest),
      compare: /^\/investigate(?:\s|$)/.test(latest) && /(?:^|\s)--compare(?:\s|$)/.test(latest)
    };
  } catch { return { active: false, compare: false }; }
}

function appendStringPath(paths, value) {
  if (typeof value === "string") paths.push(value);
}

function eventPaths(value) {
  const paths = [];
  appendStringPath(paths, value.file_path);
  appendStringPath(paths, value.notebook_path);
  if (!Array.isArray(value.edits)) return paths;
  for (const edit of value.edits) appendStringPath(paths, edit?.file_path);
  return paths;
}

// The agent's own scratchpad (`<tmp>/claude-*`) and memory (`~/.claude`) are
// not product code. A path there is scratch unless it is the project itself or
// a repository the change writes.
function scratchTarget(target) {
  const memory = canonicalTarget(join(homedir(), ".claude"), projectRoot);
  const scratchpad = [tmpdir(), "/tmp"].map((root) => canonicalTarget(root, projectRoot))
    .filter(Boolean).some((root) => {
      const rel = relative(root, target).split(sep);
      return rel.length > 1 && rel[0].startsWith("claude-") && !rel[0].startsWith("..");
    });
  if (!scratchpad && !(memory && isWithin(target, memory))) return false;
  const owned = [projectRoot, process.env.FOUNDATION_WORKSPACE_ROOT,
    recordedRuntime?.workspace?.path,
    recordedRuntime?.workspace?.targetPath,
    ...Object.values(recordedRuntime?.repositories || {}).flatMap((repository) =>
      [repository?.path, repository?.workspacePath, repository?.targetPath])]
    .filter((path) => typeof path === "string" && path)
    .map((path) => canonicalTarget(path, projectRoot)).filter(Boolean);
  return !owned.some((root) => isWithin(target, root) || isWithin(root, target));
}

function prePhaseDraftMutationAllowed() {
  if (!new Set(["Write", "Edit", "MultiEdit"]).has(tool)) return false;
  const paths = eventPaths(input);
  if (paths.length === 0) return false;
  return paths.every((rawPath) => {
    const target = canonicalTarget(rawPath, projectRoot);
    if (!target) return false;
    const rel = relative(projectRoot, target).split(sep).join("/");
    // Scratch outside the project is not product code; before a phase exists
    // it is the only other place an agent can think on disk.
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return true;
    return /^(?:\.foundation\/change-start-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.json|\.foundation\/drafts\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.json)$/.test(rel);
  });
}

function allowedPaths() {
  try {
    const values = JSON.parse(process.env.FOUNDATION_ALLOWED_PATHS_JSON || "[]");
    return Array.isArray(values) ? values.map((value) => canonicalTarget(value, projectRoot)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function validTargetInput(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function existingTargetAncestor(absolute) {
  let cursor = absolute;
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    suffix.unshift(relative(parent, cursor));
    cursor = parent;
  }
  return { cursor, suffix };
}

function canonicalTarget(value, base) {
  if (!validTargetInput(value)) return null;
  const absolute = isAbsolute(value) ? resolve(value) : resolve(base, value);
  const ancestor = existingTargetAncestor(absolute);
  try {
    return resolve(realpathSync(ancestor.cursor), ...ancestor.suffix);
  } catch {
    return null;
  }
}

function canonical(value) {
  try { return realpathSync(resolve(value)); } catch { return resolve(value); }
}

function isWithin(target, root) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function recordAudit(row) {
  try {
    const logDir = join(projectRoot, ".foundation", "logs");
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    const auditPath = join(logDir, "guardrail-audit.jsonl");
    rotateAudit(auditPath);
    appendFileSync(auditPath, `${JSON.stringify({
      schemaVersion: 2,
      timestamp: new Date().toISOString(),
      ...row,
    })}\n`, { mode: 0o600 });
  } catch {
    // Audit storage failure must not transform audit-only rollout into a block.
  }
}

// An audit trail that deletes itself is not an audit trail, and one that grows
// without limit is a defect: this file reached 2,495 rows in a single
// repository and nothing in the runtime ever pruned it. One retained generation
// bounds it at 2x the cap while keeping recent history readable.
function rotateAudit(path) {
  try {
    if (!existsSync(path)) return;
    if (statSync(path).size < AUDIT_MAX_BYTES) return;
    renameSync(path, `${path}.1`);
  } catch {
    // A failed rotation must not lose the row that triggered it.
  }
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}
