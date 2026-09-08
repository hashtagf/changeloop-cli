#!/usr/bin/env node

// Phase-aware PreToolUse guard. The default auto mode blocks whenever an
// active Foundation phase is known and stays out of adoption-only sessions.
// Hosts may still select explicit audit/block/off behavior.

import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync,
  readdirSync, readFileSync, realpathSync, renameSync, statSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  looksMutatingShellCommand, pinShellAnchor, shellMutationViolation
} from "./phase-guard-policy.mjs";
import { recordedPhaseContext } from "./phase-state.mjs";
import { devPrompt } from "./dev-terminal-guard.mjs";
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
  // A broken hook must not brick an audit-mode host — but a host that asked
  // for enforcement asked for it on the event axis too: an unreadable event
  // could be any mutation, so allowing it would fail open exactly where the
  // guard was told not to.
  if (configuredMode === "block" ||
      (configuredMode === "auto" && process.env.FOUNDATION_ACTIVE_PHASE))
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

const tool = String(event.tool_name || "");
const input = event.tool_input || {};
const mutatingTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const landAuthorityCommand = tool === "Bash" &&
  /^\s*(?:claude-foundation|node\s+(?:"[^"]*foundation\.mjs"|'[^']*foundation\.mjs'|\S*foundation\.mjs))\s+(?:(?:land(?:-|\s+)advance)|archive|sandbox\s+apply)\s+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\s*$/
    .test(String(input.command || ""));
if (!mutatingTools.has(tool) && tool !== "Bash") process.exit(0);
if (tool === "Bash" && !landAuthorityCommand &&
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
const phase = String(process.env.FOUNDATION_ACTIVE_PHASE || recorded?.phase ||
  (landSession ? "land" : "")).toLowerCase();
const mode = devSession || landAuthorityCommand || configuredMode === "block" ||
  (configuredMode === "auto" && Boolean(phase)) ? "block" : "audit";
const recordedRuntime = recorded?.changeId ? runtimeState(recorded.changeId) : null;
const recordedWorkspace = recordedRuntime?.workspace?.path
  ? canonicalTarget(recordedRuntime.workspace.path, projectRoot) || "" : "";
const violations = [];
// A Build shell command rewritten with the reported working directory as its
// literal anchor. Set only when the policy accepts the pinned form.
let pinnedCommand = null;

if (landAuthorityCommand && !landSession)
  violations.push("Land authority command requires the current /land invocation");

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
} else if (!phase) {
  violations.push("active phase is unavailable");
} else if (!new Set(["change", "build", "prove", "land"]).has(phase)) {
  violations.push(`unsupported active phase: ${phase}`);
} else if (tool === "Bash" && !landSession) {
  inspectBash(String(input.command || ""));
} else {
  for (const rawPath of eventPaths(input)) inspectPath(rawPath);
}

if (violations.length === 0) {
  if (pinnedCommand !== null) {
    recordAudit({ phase, tool, mode, reason:
      "phase guard: pinned the reported shell directory as the Build workspace anchor" });
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...input, command: pinnedCommand }
      }
    }));
  }
  process.exit(0);
}

const changeShellRecovery = phase === "change" && tool === "Bash"
  ? " Use Edit or Write for openspec/changes artifacts; Bash remains read-only during Change."
  : "";
const reason = `BLOCKED: phase guard (${phase || "unknown"}/${tool}): ${violations.join("; ")}. ` +
  `No mutation ran.${changeShellRecovery} Continue inside the active phase workspace, ` +
  "or ask the user only if scope or authority must change.";
recordAudit({ phase: phase || "unknown", tool, mode, reason });

if (mode === "block") {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function inspectPath(rawPath) {
  const target = canonicalTarget(rawPath, projectRoot);
  if (!target) {
    violations.push("mutation target is missing or invalid");
    return;
  }

  const investigations = join(projectRoot, "openspec", "investigations");
  const workspace = process.env.FOUNDATION_WORKSPACE_ROOT || recordedWorkspace;
  const status = phase === "build" ? "building" : phase === "prove" ? "proven"
    : phase === "land" ? "applied" : "change";
  const capability = workspaceCapabilityValue(recorded?.changeId || "active", {
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
  const decision = workspaceMutationDecision({
    capability,
    target,
    foundationRoot: join(projectRoot, ".foundation"),
    investigationRoot: investigations,
    additionalRoots: allowedPaths(),
    landTransaction: process.env.FOUNDATION_LAND_TRANSACTION === "1",
    contains: isWithin
  });
  if (!decision.allowed) violations.push(decision.reason);
}

function inspectBash(command) {
  const workspace = process.env.FOUNDATION_WORKSPACE_ROOT || recordedWorkspace;
  const environment = {
    ...process.env,
    ...(recordedWorkspace && !process.env.FOUNDATION_WORKSPACE_ROOT
      ? { FOUNDATION_WORKSPACE_ROOT: recordedWorkspace } : {})
  };
  const inspection = workspace ? {
    canonicalTarget: (target) => canonicalTarget(target, workspace),
    contains: (target, root) => isWithin(target, canonical(root))
  } : null;
  const violation = shellMutationViolation(phase, environment, command, inspection);
  if (!violation) return;
  const pinned = phase === "build" && mode === "block" && workspace
    ? pinnedWorkspaceCommand(command, workspace, environment, inspection) : null;
  if (pinned === null) violations.push(violation);
  else if (pinned.violation) violations.push(pinned.violation);
  else pinnedCommand = pinned.command;
}

// The host reports where the shell is. That report is never authority — it
// cannot let a mutation run where the policy would refuse it — but a report
// inside the workspace can be pinned into the command as a literal anchor, so
// the same policy proves the mutation and an unanchored write an agent meant
// for its sandbox runs there instead of costing a refused turn. No report
// (OpenCode synthesizes events without one), a report outside the workspace,
// or a pinned form the policy still refuses keeps the refusal; a refusal of
// the pinned form is the more exact reason (an outside operand, a dynamic
// path) and replaces the anchor complaint.
function pinnedWorkspaceCommand(command, workspace, environment, inspection) {
  const reported = typeof event.cwd === "string" ? event.cwd : "";
  if (!reported || !isAbsolute(reported)) return null;
  const canonicalCwd = canonicalTarget(reported, projectRoot);
  if (!canonicalCwd || !isWithin(canonicalCwd, canonical(workspace))) return null;
  // The workspace may be spelled through a symlink (macOS /var → /private/var,
  // a linked sandbox path) while the report is canonical, or the reverse; the
  // policy compares text, so also try the report re-spelled under the
  // workspace the policy was given.
  const respelled = resolve(workspace, relative(canonical(workspace), canonicalCwd));
  for (const directory of [...new Set([resolve(reported), canonicalCwd, respelled])]) {
    const pinned = pinShellAnchor(command, directory);
    if (pinned === null) continue;
    const violation = shellMutationViolation(phase, environment, pinned, inspection);
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

function currentTranscriptIsLand(path) {
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
    return /^\/land(?:\s|$)/.test(latest);
  } catch { return false; }
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

function prePhaseDraftMutationAllowed() {
  if (!new Set(["Write", "Edit", "MultiEdit"]).has(tool)) return false;
  const paths = eventPaths(input);
  if (paths.length === 0) return false;
  return paths.every((rawPath) => {
    const target = canonicalTarget(rawPath, projectRoot);
    if (!target) return false;
    const rel = relative(projectRoot, target).split(sep).join("/");
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
      schemaVersion: 1,
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
