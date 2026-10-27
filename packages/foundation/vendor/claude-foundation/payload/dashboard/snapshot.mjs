#!/usr/bin/env node

// Stable, read-only projection of Foundation runtime state for dashboard clients.
// Keep this module dependency-free: it ships with the Homebrew dashboard bundle.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 3;

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function epoch(value, fallback = 0) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function normalizeRemote(value) {
  return String(value || "").replace(/\.git$/, "")
    .replace(/^(?:git\+ssh|ssh|https?|git):\/\//, "")
    .replace(/^.*@/, "").replace(":", "/");
}

function lifecyclePhase(status) {
  if (status === "change" || status === "untracked") return "change";
  if (status === "building") return "build";
  if (status === "proven") return "prove";
  if (["applied", "archived"].includes(status)) return "land";
  return "change";
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function budgetProjection(value) {
  if (!value || typeof value !== "object") return null;
  const lifetime = value.lifetime || {};
  const window = value.window || {};
  return {
    lifetime: {
      usedRequests: finiteNumber(lifetime.usedRequests),
      usedTokens: finiteNumber(lifetime.usedTokens)
    },
    window: {
      id: typeof window.id === "string" ? window.id : null,
      usedRequests: finiteNumber(window.usedRequests),
      usedTokens: finiteNumber(window.usedTokens),
      targetRequests: finiteNumber(window.targetRequests),
      targetTokens: finiteNumber(window.targetTokens)
    }
  };
}

function readReceiptFile(dir, entry) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) return null;
  try {
    const raw = readFileSync(join(dir, entry.name));
    const value = JSON.parse(raw.toString("utf8"));
    return value && typeof value === "object" ? { name: entry.name, raw, value } : null;
  } catch {
    return null;
  }
}

function receiptDirectoryProjection(dir) {
  const providers = [];
  const receiptDigests = new Map();
  let proof = null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const receipt = readReceiptFile(dir, entry);
    if (!receipt) continue;
    // proof.json is the manifest the receipts roll up into, not a provider —
    // the harness skips it here for the same reason. Listing it produced a
    // phantom provider row, and reading its absence as the only signal meant a
    // receipt set containing failures reported the same "partial" as an
    // all-green set still waiting for `prove`.
    if (receipt.name === "proof.json") {
      proof = receipt.value;
      continue;
    }
    const provider = receipt.name.slice(0, -5);
    receiptDigests.set(provider, createHash("sha256").update(receipt.raw).digest("hex"));
    providers.push({
      provider,
      status: typeof receipt.value.status === "string" ? receipt.value.status : "unknown"
    });
  }
  providers.sort((a, b) => a.provider.localeCompare(b.provider));
  return { proof, providers, receiptDigests };
}

function proofIsFresh(proof, providers, receiptDigests) {
  const provenReceipts = Array.isArray(proof?.receipts) ? proof.receipts : null;
  const provenByProvider = new Map((provenReceipts || []).map((entry) =>
    [entry?.provider, entry?.sha256]));
  const excludedProviders = new Set((Array.isArray(proof?.excludedReceipts)
    ? proof.excludedReceipts : []).map((entry) => entry?.provider));
  return typeof proof?.status === "string" && provenReceipts !== null &&
    provenReceipts.every((entry) => typeof entry?.provider === "string" &&
      typeof entry?.sha256 === "string" && receiptDigests.get(entry.provider) === entry.sha256) &&
    providers.every((entry) => provenByProvider.has(entry.provider) ||
      excludedProviders.has(entry.provider));
}

function projectedReceiptStatus(providers, proof, proofFresh) {
  if (providers.some((item) => ["fail", "error"].includes(item.status))) return "failing";
  // This collector can validate receipt integrity, not live workspace inputs.
  // A recorded pass must never be presented as current proof.
  if (proofFresh) return "unverified";
  return providers.length ? "partial" : "missing";
}

function receiptProjection(root, id) {
  const dir = join(root, ".foundation", "receipts", id);
  if (!existsSync(dir)) return {
    status: "missing", recordedStatus: null, freshness: "stale-or-missing", providers: []
  };
  const { proof, providers, receiptDigests } = receiptDirectoryProjection(dir);
  const proofFresh = proofIsFresh(proof, providers, receiptDigests);
  // A proof is current only while every included receipt still has the digest
  // the proof certified and every extra receipt was explicitly excluded by
  // that proof. Any changed/new/missing receipt makes the projection partial;
  // fail/error remains the stronger live signal.
  return {
    status: projectedReceiptStatus(providers, proof, proofFresh),
    recordedStatus: proofFresh ? proof.status : null,
    freshness: proofFresh ? "unavailable" : "stale-or-missing",
    providers
  };
}

function blockerProjection(item) {
  if (typeof item === "string") return { code: "runtime-blocker" };
  if (!item || typeof item !== "object") return null;
  return { code: String(item.code || item.id || "runtime-blocker").slice(0, 128) };
}

function stateBlockers(state) {
  const blockers = [];
  const candidates = [state.blockers, state.pendingBlockers, state.land?.blockers];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      const blocker = blockerProjection(item);
      if (blocker) blockers.push(blocker);
    }
  }
  return blockers.slice(0, 50);
}

function operationTiming(root, id) {
  let lines;
  try { lines = readFileSync(join(root, ".foundation", "logs", id, "operations.jsonl"), "utf8").split("\n"); }
  catch { return {}; }
  const spans = {};
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || !["change", "build", "prove", "land"].includes(row.phase)) continue;
    const start = Date.parse(row.startedAt), end = Date.parse(row.finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    (spans[row.phase] ||= []).push([start, end]);
  }
  const measured = {};
  for (const [phase, intervals] of Object.entries(spans)) {
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0, previousEnd = -Infinity;
    for (const [start, end] of intervals) {
      total += Math.max(0, end - Math.max(start, previousEnd));
      previousEnd = Math.max(previousEnd, end);
    }
    measured[phase] = total;
  }
  return measured;
}

function projectState(root, state, project) {
  const id = String(state.id || "");
  const phase = lifecyclePhase(state.status);
  const started = epoch(state.createdAt);
  const finished = epoch(state.updatedAt, started);
  const done = state.status === "archived";
  const evidence = receiptProjection(root, id);
  const blockers = stateBlockers(state);
  return {
    change: {
      id,
      schema: typeof state.schema === "string" ? state.schema : "unknown",
      status: typeof state.status === "string" ? state.status : "unknown",
      phase,
      revision: Number(state.contractRevision || state.revision || 0),
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
      blockerCount: blockers.length,
      evidenceStatus: evidence.status
    },
    run: {
      id,
      type: typeof state.schema === "string" ? state.schema : "unknown",
      repo: project.name,
      repoId: project.repoId,
      branch: typeof state.workspace?.branch === "string" ? state.workspace.branch : project.branch,
      owner: typeof state.owner === "string" ? state.owner : project.owner,
      ownerEmail: typeof state.ownerEmail === "string" ? state.ownerEmail : project.ownerEmail,
      size: typeof state.size === "string" ? state.size : "",
      phase,
      lifecycleStatus: typeof state.status === "string" ? state.status : "unknown",
      started,
      finished,
      done,
      art: {},
      // Union of observed operation intervals per phase, not end-to-end time.
      // Missing measurements remain absent. No raw command telemetry leaves here.
      operationMs: operationTiming(root, id)
    },
    blockers,
    budget: budgetProjection(state.budget),
    evidence
  };
}

export function buildDashboardSnapshot(projectRoot, { generatedAt = new Date().toISOString() } = {}) {
  const root = resolve(projectRoot);
  const runtimeDir = join(root, ".foundation", "runtime");
  const versionPath = join(dirname(dirname(fileURLToPath(import.meta.url))), "VERSION");
  const foundationVersion = existsSync(versionPath) ? readFileSync(versionPath, "utf8").trim() : "unknown";
  const project = {
    name: basename(root),
    repoId: normalizeRemote(git(root, ["config", "--get", "remote.origin.url"])),
    branch: git(root, ["branch", "--show-current"]),
    owner: git(root, ["config", "user.name"]),
    ownerEmail: git(root, ["config", "user.email"])
  };
  const changes = [], runs = [], blockers = [], budgets = {}, evidence = {};
  let malformedStates = 0;
  if (existsSync(runtimeDir)) {
    for (const entry of readdirSync(runtimeDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const state = readJson(join(runtimeDir, entry.name));
      const expectedId = entry.name.slice(0, -5);
      if (!state || typeof state !== "object" || typeof state.id !== "string" ||
          state.id !== expectedId || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(state.id)) {
        malformedStates += 1;
        continue;
      }
      const projected = projectState(root, state, project);
      changes.push(projected.change);
      runs.push(projected.run);
      blockers.push(...projected.blockers.map((item) => ({ changeId: state.id, ...item })));
      if (projected.budget) budgets[state.id] = projected.budget;
      evidence[state.id] = projected.evidence;
    }
  }
  runs.sort((a, b) => b.finished - a.finished || a.id.localeCompare(b.id));
  const phases = { change: 0, build: 0, prove: 0, land: 0 };
  for (const change of changes) phases[change.phase] += 1;
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceSchema: "foundation-runtime-v2",
    foundationVersion,
    project,
    changes,
    runs,
    phases,
    blockers,
    budgets,
    evidence,
    diagnostics: { malformedStates },
    generatedAt
  };
}

function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--project");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
  if (!root) throw new Error("--project requires a path");
  process.stdout.write(`${JSON.stringify(buildDashboardSnapshot(root))}\n`);
}

// fileURLToPath, not URL.pathname: pathname is percent-encoded, so a space in
// the install path makes the comparison fail, main() never runs, and the exit
// code is still 0 — every snapshot silently produces nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(`claude-foundation: dashboard snapshot failed: ${error.message}`);
    process.exitCode = 1;
  }
}
