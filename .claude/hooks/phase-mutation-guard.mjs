#!/usr/bin/env node

// Phase-aware PreToolUse guard. Rollout is deliberately audit-only by default.
// Hosts enable enforcement with FOUNDATION_GUARDRAIL_MODE=block after exporting
// FOUNDATION_ACTIVE_PHASE and, for Build, FOUNDATION_WORKSPACE_ROOT.

import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync,
  realpathSync, renameSync, statSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Large enough that a real audit trail survives a working session, small enough
// that an unattended project never carries an unbounded file.
const AUDIT_MAX_BYTES = 1024 * 1024;

// How long a recorded phase governs. The loop writes a new row at every phase
// transition, so a row older than this means no Foundation phase is running
// and the guard has nothing to enforce.
const PHASE_FRESHNESS_MS = 12 * 60 * 60 * 1000;

const mode = (process.env.FOUNDATION_GUARDRAIL_MODE || "audit").toLowerCase();
if (mode === "off") process.exit(0);

let event;
try {
  event = JSON.parse(await readStdin());
} catch {
  // A broken hook must not brick an audit-mode host — but a host that asked
  // for enforcement asked for it on the event axis too: an unreadable event
  // could be any mutation, so allowing it would fail open exactly where the
  // guard was told not to.
  if (mode === "block")
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: "phase guard: hook event is unreadable; retry the tool call"
    }));
  process.exit(0);
}

const tool = String(event.tool_name || "");
const input = event.tool_input || {};
const mutatingTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
if (!mutatingTools.has(tool) && tool !== "Bash") process.exit(0);
if (tool === "Bash" && !looksMutating(String(input.command || ""))) process.exit(0);

const projectRoot = canonical(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const phase = String(process.env.FOUNDATION_ACTIVE_PHASE || recordedPhase()).toLowerCase();
const violations = [];

// Block mode still fails closed: a host that asked for enforcement gets it
// even when the phase cannot be established. Audit mode does not — recording
// "phase unavailable" there appended a row on every mutating call of every
// stock install, which is noise, not an audit trail.
if (!phase && mode !== "block") process.exit(0);

if (!phase) {
  violations.push("active phase is unavailable");
} else if (!new Set(["change", "build", "prove", "land"]).has(phase)) {
  violations.push(`unsupported active phase: ${phase}`);
} else if (tool === "Bash") {
  inspectBash(String(input.command || ""));
} else {
  for (const rawPath of eventPaths(input)) inspectPath(rawPath);
}

if (violations.length === 0) process.exit(0);

const reason = `phase guard (${phase || "unknown"}/${tool}): ${violations.join("; ")}`;
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

  if (isWithin(target, join(projectRoot, ".foundation"))) return;

  // Investigation notes are exploratory documentation, not product or
  // instruction files; /investigate writes them and records no phase, so a
  // phase left behind by an earlier packet must not block them.
  const investigations = join(projectRoot, "openspec", "investigations");

  if (phase === "change") {
    if (!isWithin(target, join(projectRoot, "openspec", "changes")) &&
        !isWithin(target, investigations))
      violations.push("Change may write only OpenSpec change drafts, investigation notes, or .foundation state");
    return;
  }

  if (phase === "prove") {
    if (!isWithin(target, investigations))
      violations.push("Prove keeps product and instruction files read-only");
    return;
  }

  if (phase === "land") {
    if (process.env.FOUNDATION_LAND_TRANSACTION !== "1")
      violations.push("Land mutations require the runtime transaction marker");
    return;
  }

  if (phase === "build") {
    const workspace = process.env.FOUNDATION_WORKSPACE_ROOT;
    if (!workspace) {
      violations.push("Build workspace is unavailable");
      return;
    }
    const roots = [canonicalTarget(workspace, projectRoot), ...allowedPaths()];
    if (!roots.some((root) => root && isWithin(target, root)))
      violations.push("Build mutation is outside its isolated workspace and declared paths");
  }
}

function inspectBash(command) {
  if (!looksMutating(command)) return;
  if (phase === "prove" || phase === "change") {
    violations.push(`${phase === "prove" ? "Prove" : "Change"} cannot run mutating shell commands`);
  } else if (phase === "land" && process.env.FOUNDATION_LAND_TRANSACTION !== "1") {
    violations.push("Land shell mutations require the runtime transaction marker");
  } else if (phase === "build" && !process.env.FOUNDATION_WORKSPACE_ROOT) {
    violations.push("Build shell mutations require an isolated workspace");
  }
}

function looksMutating(command) {
  // Conservative command-word screening. This intentionally does not claim to
  // be a shell sandbox; enforcement of arbitrary shell effects belongs to the host.
  const stripped = command.replace(/(['"])(?:\\.|(?!\1).)*\1/g, " ");
  // `git rm` is spelled with the git verb list, not the bare `rm` alternative:
  // that one only matches after a shell separator, so `rm` inside `git rm`
  // never did. cherry-pick/revert/stash/am/pull all write the working tree,
  // and `sed -i` edits files in place — all five read as non-mutating before.
  return /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:rm|mv|cp|ln|install|mkdir|rmdir|touch|truncate|tee|chmod|chown|patch|git\s+(?:commit|push|merge|rebase|checkout|switch|restore|reset|clean|apply|rm|mv|cherry-pick|revert|stash|am|pull|worktree|submodule)|npm\s+(?:install|publish)|pnpm\s+(?:install|publish)|yarn\s+(?:add|install|publish))\b/m.test(stripped)
    // In-place editors: the file is the effect, not an argument to a reader.
    || /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:sed|perl|ruby)\s+(?:-\S+\s+)*-\S*i/m.test(stripped)
    // A redirect only mutates when it targets a real file; >/dev/null and
    // 2>/dev/null are how read-only commands silence noise, and >&2 / 2>&1
    // are fd duplication, not writes.
    || /(?:^|[^<])(?:>>?|2>>?)\s*(?!&)(?!\/dev\/null(?:[\s;&|)]|$))\S/m.test(stripped);
}

// The host is not the only thing that knows the phase. Every `/build`,
// `/prove` and `/land` runs `packet <change> --phase <phase>`, which appends a
// row here — so on a stock install, where nothing exports
// FOUNDATION_ACTIVE_PHASE, this is what the guard reads.
function recordedPhase() {
  try {
    const logs = join(projectRoot, ".foundation", "logs");
    if (!existsSync(logs)) return "";
    let newest = null;
    for (const entry of readdirSync(logs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(logs, entry.name, "phase-context.jsonl");
      if (!existsSync(path)) continue;
      const last = readFileSync(path, "utf8").split("\n").filter(Boolean).at(-1);
      if (!last) continue;
      let row;
      try { row = JSON.parse(last); } catch { continue; }
      const at = Date.parse(row?.timestamp || "");
      if (!Number.isFinite(at)) continue;
      if (!newest || at > newest.at) newest = { at, phase: String(row.phase || "") };
    }
    if (!newest || Date.now() - newest.at > PHASE_FRESHNESS_MS) return "";
    return newest.phase;
  } catch {
    return "";
  }
}

function eventPaths(value) {
  const paths = [];
  if (typeof value.file_path === "string") paths.push(value.file_path);
  if (typeof value.notebook_path === "string") paths.push(value.notebook_path);
  if (Array.isArray(value.edits)) {
    for (const edit of value.edits) if (typeof edit?.file_path === "string") paths.push(edit.file_path);
  }
  return paths;
}

function allowedPaths() {
  try {
    const values = JSON.parse(process.env.FOUNDATION_ALLOWED_PATHS_JSON || "[]");
    return Array.isArray(values) ? values.map((value) => canonicalTarget(value, projectRoot)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function canonicalTarget(value, base) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  const absolute = isAbsolute(value) ? resolve(value) : resolve(base, value);
  let cursor = absolute;
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    suffix.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }
  try {
    if (lstatSync(cursor).isSymbolicLink()) cursor = realpathSync(cursor);
    else cursor = realpathSync(cursor);
    return resolve(cursor, ...suffix);
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
