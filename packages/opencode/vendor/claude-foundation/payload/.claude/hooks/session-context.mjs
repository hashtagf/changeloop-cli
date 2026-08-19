#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nextCommand } from "../harness/runtime/core/next-step.mjs";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR || join(HOOK_DIR, "..", ".."));
// A digest that grows without bound stops being a digest. Active changes are
// few by design; orphan runtime state is the row that accumulates silently.
const ORPHAN_PREVIEW = 5;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function exportSessionIdentity(input) {
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile || !input.session_id || !input.transcript_path) return;
  appendFileSync(envFile,
    `export FOUNDATION_CLAUDE_SESSION_ID=${shellQuote(input.session_id)}\n` +
    `export FOUNDATION_CLAUDE_TRANSCRIPT_PATH=${shellQuote(input.transcript_path)}\n`);
}

function readState(runtimeDir, id) {
  const path = join(runtimeDir, `${id}.json`);
  if (!existsSync(path)) return { status: "untracked" };
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return { status: "invalid-runtime-json" }; }
}

// Where the loop stands, stated without being asked.
//
// Deliberately hash-free: `relevantHash` walks the entire workspace, and this
// hook runs under a 5s timeout on every startup, resume, clear, and compact.
// Status is cheap and honest. Proof freshness is the one thing a hash buys,
// so this names `changes` for it rather than implying an answer it did not
// compute — a wrong "ready to land" is worse than an absent one.
function workflowDigest() {
  const changesDir = join(ROOT, "openspec", "changes");
  const runtimeDir = join(ROOT, ".foundation", "runtime");
  if (!existsSync(changesDir)) return null;
  const active = readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .map((entry) => entry.name).sort();

  const lines = [];
  lines.push("Agent note: translate this machine digest into the user's language; never paste it verbatim.");
  if (!active.length)
    lines.push(
      "Foundation: no active change.",
      "  next: /investigate to explore a problem, or /change to commit to an outcome."
    );
  else {
    lines.push(`Foundation: ${active.length} active change(s).`);
    for (const id of active) {
      const status = readState(runtimeDir, id).status || "unknown";
      lines.push(`  ${id} [${status}] next: ${nextCommand(status, id)}`);
    }
    lines.push("  Proof freshness is not checked here; run `claude-foundation changes` for readiness.");
  }

  const orphans = existsSync(runtimeDir)
    ? readdirSync(runtimeDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5))
      .filter((id) => !active.includes(id) &&
        readState(runtimeDir, id).status !== "archived")
      .sort()
    : [];
  if (orphans.length) {
    const preview = orphans.slice(0, ORPHAN_PREVIEW).join(", ");
    const rest = orphans.length > ORPHAN_PREVIEW
      ? ` (+${orphans.length - ORPHAN_PREVIEW} more)` : "";
    lines.push(`  orphan runtime state, no active change: ${preview}${rest}; run \`claude-foundation changes\`.`);
  }
  return lines.join("\n");
}

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8")); }
catch { /* stdin shape is the host's contract, not this hook's to enforce */ }
// Both halves are best-effort and independently guarded: neither telemetry
// identity nor a workflow digest is worth blocking a Claude session over, and
// one failing must not take the other down with it.
try { exportSessionIdentity(input); } catch { /* best-effort */ }
try {
  const digest = workflowDigest();
  if (digest) process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: digest }
  }));
} catch { /* best-effort */ }
