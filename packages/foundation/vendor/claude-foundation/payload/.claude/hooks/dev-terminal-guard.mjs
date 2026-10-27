#!/usr/bin/env node

import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { recordedPhaseContext } from "./phase-state.mjs";

export function devPrompt(transcript) {
  let prompt = "";
  for (const line of String(transcript || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.type === "last-prompt" && typeof row.lastPrompt === "string" &&
          /^\/dev(?:\s|$)/.test(row.lastPrompt.trim()))
        prompt = row.lastPrompt.trim();
    } catch { /* tolerate a partially flushed final line */ }
  }
  return prompt;
}

export function devResumeChange(prompt) {
  return String(prompt || "").match(/(?:^|\s)--resume\s+([^\s]+)/)?.[1] || null;
}

export function transcriptWallMs(transcript, nowMs = Date.now()) {
  for (const line of String(transcript || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const started = Date.parse(JSON.parse(line).timestamp || "");
      if (Number.isFinite(started)) return Math.max(0, nowMs - started);
    } catch { /* keep looking for the first timestamped row */ }
  }
  return null;
}

const HOST_PERMISSION_DENIAL = /(?:user (?:has )?(?:denied|rejected|declined)|tool use (?:was )?(?:denied|rejected)|permission to [^.\n]+ (?:was )?(?:denied|rejected)|permission request (?:was )?(?:denied|rejected)|(?:denied|rejected) (?:the )?permission request)/i;

function toolResultText(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return ""; }
}

export function latestHostPermissionBoundary(transcript) {
  let boundary = null;
  for (const line of String(transcript || "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type === "last-prompt" && typeof row.lastPrompt === "string" &&
        /^\/dev(?:\s|$)/.test(row.lastPrompt.trim())) {
      boundary = null;
      continue;
    }
    const results = Array.isArray(row.message?.content)
      ? row.message.content.filter((block) => block?.type === "tool_result") : [];
    for (const result of results) {
      const detail = [toolResultText(result.content), toolResultText(row.toolUseResult)]
        .filter(Boolean).join(" ");
      // Only the latest tool result is authoritative. A later successful
      // operation proves that the agent recovered from an earlier denial.
      boundary = HOST_PERMISSION_DENIAL.test(detail) ? {
        kind: "host-permission-denied"
      } : null;
    }
  }
  return boundary;
}

function pendingTerminalBoundary(changeId, hostBoundary, nextActionFor) {
  let nextAction = null;
  try { nextAction = nextActionFor(changeId); } catch { return null; }
  if (!["WAIT", "ASK_USER"].includes(nextAction?.action)) return null;
  if (nextAction.action === "WAIT" && nextAction.owner !== "external" &&
      !["external-authority", "resource-owner"].includes(nextAction.actor) &&
      nextAction.userState !== "WAITING_EXTERNAL") return null;
  return {
    applies: true,
    complete: false,
    stopAllowed: true,
    status: "BOUNDARY",
    blockerKind: nextAction.action === "ASK_USER"
      ? "user-decision-boundary" : "external-wait-boundary",
    changeId,
    phase: nextAction.legacyAction === "WAIT_RESOURCE" ? "build" : "prove",
    action: nextAction.action,
    actor: nextAction.actor || null,
    boundary: nextAction.boundary || null,
    reason: nextAction.reason || null
  };
}

export function evaluateDevTerminal({
  prompt, activeIds, proofFor, currentHash, auditProof,
  nextActionFor = () => null, hostBoundary = null, selectedChangeId = null,
  archivedThisSession = []
}) {
  if (!prompt) return { applies: false, complete: true };
  if (/\s--plan-only(?:\s|$)/.test(prompt))
    return { applies: true, complete: true, status: "PLAN_COMPLETE" };
  const explicit = selectedChangeId || devResumeChange(prompt);
  // A change this session archived is the delivered outcome, not a missing one.
  const archived = explicit
    ? archivedThisSession.find((name) => name.endsWith(`-${explicit}`))
    : !activeIds.length && archivedThisSession.length ? archivedThisSession.at(-1) : null;
  if (archived && !activeIds.includes(explicit))
    return { applies: true, complete: true, status: "ARCHIVED", changeId: explicit || archived };
  const changeId = explicit || (activeIds.length === 1 ? activeIds[0] : null);
  if (!changeId || !activeIds.includes(changeId)) return {
    applies: true, complete: false, status: "INCOMPLETE",
    blockerKind: explicit ? "selected-change-unavailable" :
      activeIds.length ? "ambiguous-active-change" : "missing-active-change",
    changeId: explicit, phase: activeIds.length ? "unknown" : "change",
    resumeAction: explicit
      ? `Agent: recover the selected change ${explicit} without switching to a sibling change.`
      : "Agent: select the change that belongs to this session before continuing."
  };
  // A permission the user just denied is their answer. Forcing the agent to
  // keep working would override it, so the turn may end and report instead.
  if (hostBoundary?.kind === "host-permission-denied") return {
    applies: true, complete: false, stopAllowed: true,
    status: "BOUNDARY", blockerKind: "host-permission-denied",
    changeId, phase: "prove", action: "ASK_USER", actor: "user",
    boundary: "host-permission",
    reason: "the user denied a tool permission; report what was blocked and the resume route",
    resumeAction: `Agent: resume ${changeId} with /dev --resume ${changeId} once the user allows it.`
  };
  const proof = proofFor(changeId);
  if (!proof || proof.status !== "pass") {
    const boundary = pendingTerminalBoundary(changeId, hostBoundary, nextActionFor);
    if (boundary) return boundary;
    return {
      applies: true, complete: false, stopAllowed: false,
      status: "INCOMPLETE", blockerKind: "proof-not-passing",
      changeId, phase: "prove",
      resumeAction: `Agent: invoke /dev --resume ${changeId}; continue the pending automatic lifecycle action.`
    };
  }
  const audit = auditProof(changeId);
  if (!audit.valid) {
    const boundary = pendingTerminalBoundary(changeId, hostBoundary, nextActionFor);
    if (boundary) return boundary;
    return {
      applies: true, complete: false, status: "INCOMPLETE", blockerKind: "proof-audit-failed",
      changeId, phase: "prove", resumeAction: `Agent: repair proof audit for ${changeId}, then run one fresh proof.`,
      detail: audit.reason
    };
  }
  const hash = currentHash(changeId);
  if (!hash || hash !== proof.workspaceHash) {
    const boundary = pendingTerminalBoundary(changeId, hostBoundary, nextActionFor);
    if (boundary) return boundary;
    return {
      applies: true, complete: false, status: "INCOMPLETE", blockerKind: "proof-stale",
      changeId, phase: "prove", resumeAction: `Agent: workspace changed after Prove; run one fresh proof for ${changeId}.`
    };
  }
  return { applies: true, complete: true, status: "PROVEN", changeId, phase: "prove" };
}

// The Stop hook has a 10s host timeout. Every CLI check shares one deadline
// under it, and a check that cannot finish in time fails open: an unverified
// terminal state must never trap the user in a turn that cannot end.
export const CHECK_BUDGET_MS = 8000;
// Tests may shorten the budget; nothing may lengthen it past the host timeout.
const budgetOverride = Number(process.env.FOUNDATION_DEV_TERMINAL_BUDGET_MS);
const checks = {
  deadline: Date.now() + (budgetOverride > 0
    ? Math.min(budgetOverride, CHECK_BUDGET_MS) : CHECK_BUDGET_MS),
  timedOut: false
};

function runCli(root, ...args) {
  const remaining = checks.deadline - Date.now();
  if (remaining < 500) {
    checks.timedOut = true;
    return { status: null, stdout: "", stderr: "dev terminal check budget exhausted" };
  }
  const child = spawnSync(process.execPath,
    [join(root, ".claude", "harness", "foundation.mjs"), ...args], {
      cwd: root, encoding: "utf8", timeout: remaining,
      env: {
        ...process.env,
        FOUNDATION_GUARDRAIL_MODE: "off",
        FOUNDATION_UPDATE_CHECK: "0",
        FOUNDATION_TELEMETRY: "0",
        FOUNDATION_READ_ONLY_INSPECTION: "1"
      }
    });
  if (child.error?.code === "ETIMEDOUT" || child.signal) checks.timedOut = true;
  return child;
}

function nextAction(root, id) {
  const child = runCli(root, "advance", id, "--inspect");
  if (child.status !== 0) return null;
  try { return JSON.parse(String(child.stdout || "").trim()); }
  catch { return null; }
}

function record(root, event, result) {
  try {
    const dir = join(root, ".foundation", "logs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const row = terminalVerdict(event, result);
    appendFileSync(join(dir, "dev-terminal.jsonl"), `${JSON.stringify({
      version: 1, at: new Date().toISOString(), sessionId: event.session_id || null,
      ...result
    })}\n`, { mode: 0o600 });
    const verdictDir = join(dir, "dev-terminal");
    mkdirSync(verdictDir, { recursive: true, mode: 0o700 });
    const session = String(event.session_id || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
    writeFileSync(join(verdictDir, `${session}.json`), `${JSON.stringify(row, null, 2)}\n`,
      { mode: 0o600 });
    writeFileSync(join(verdictDir, "latest.json"), `${JSON.stringify(row, null, 2)}\n`,
      { mode: 0o600 });
  } catch { /* terminal truth must not depend on telemetry storage */ }
}

export function terminalVerdict(event, result, at = new Date().toISOString()) {
  return {
    protocol: "foundation-dev-terminal-v1",
    at,
    sessionId: event.session_id || null,
    terminal: result.complete ? "complete" : "incomplete",
    ...result
  };
}

async function main() {
  let event = {};
  try { event = JSON.parse(readFileSync(0, "utf8")); } catch { return; }
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const transcriptPath = String(event.transcript_path || "");
  if (!transcriptPath || !existsSync(transcriptPath)) return;
  const transcript = readFileSync(transcriptPath, "utf8");
  const prompt = devPrompt(transcript);
  if (!prompt) return;
  const changes = join(root, "openspec", "changes");
  const activeIds = existsSync(changes) ? readdirSync(changes, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .map((entry) => entry.name).sort() : [];
  const recorded = recordedPhaseContext({
    projectRoot: root,
    sessionId: event.session_id || null,
    freshnessMs: 12 * 60 * 60 * 1000,
    pathExists: existsSync,
    readDirectory: (path) => readdirSync(path, { withFileTypes: true }),
    readText: readFileSync,
    nowMs: Date.now
  });
  const wallMs = transcriptWallMs(transcript);
  const sessionStart = wallMs === null ? null : Date.now() - wallMs;
  const archiveDir = join(changes, "archive");
  const archivedThisSession = sessionStart !== null && existsSync(archiveDir)
    ? readdirSync(archiveDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() &&
        statSync(join(archiveDir, entry.name)).mtimeMs >= sessionStart)
      .map((entry) => entry.name).sort()
    : [];
  const evaluated = evaluateDevTerminal({
    prompt,
    activeIds,
    archivedThisSession,
    selectedChangeId: devResumeChange(prompt) || recorded?.changeId || null,
    hostBoundary: latestHostPermissionBoundary(transcript),
    proofFor: (id) => {
      const path = join(root, ".foundation", "receipts", id, "proof.json");
      try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
    },
    auditProof: (id) => {
      const child = runCli(root, "proof-audit", id);
      return { valid: child.status === 0,
        reason: String(child.stderr || child.stdout || "proof audit failed").trim() };
    },
    nextActionFor: (id) => nextAction(root, id),
    currentHash: (id) => {
      const child = runCli(root, "hash", id);
      return child.status === 0 ? String(child.stdout || "").trim().split("\n").at(-1) : "";
    }
  });
  const result = {
    ...evaluated,
    ...(checks.timedOut && !evaluated.complete ? {
      stopAllowed: true, status: "UNVERIFIED", blockerKind: "terminal-check-timeout"
    } : {}),
    wallMs: transcriptWallMs(transcript),
    cost: null,
    costStatus: "provider-envelope-not-final-until-stop"
  };
  record(root, event, result);
  if (result.complete || result.stopAllowed) return;
  // Advisory only: forcing continuation looped turns and cost a CLI round per
  // Stop. The verdict above stays recorded as incomplete, so a stopped /dev is
  // never mistaken for passing proof.
  process.stdout.write(JSON.stringify({
    systemMessage: `/dev stopped before proof passed (${result.blockerKind} for ${result.changeId}). ${result.resumeAction || ""}`.trim()
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
