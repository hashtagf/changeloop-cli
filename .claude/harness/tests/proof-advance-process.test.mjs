import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync,
  renameSync, rmSync, utimesSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createProofExecutionRuntime } from "../runtime/evidence/proof-execution-runtime.mjs";

const SELF = fileURLToPath(import.meta.url);

const NO_FALLBACK = Symbol("no-fallback");
function readJson(path, fallback = NO_FALLBACK) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (fallback !== NO_FALLBACK) return fallback;
    throw error;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function processFixture(root) {
  const worldPath = join(root, "world.json");
  const runtimePath = join(root, "runtime.json");
  const finalProofPath = join(root, "proof.json");
  const cursorPath = join(root, "proof-advance.json");
  const lockPath = join(root, "proof.lock");
  const executionLog = join(root, "provider-executions.log");
  const startedPath = join(root, "provider-started");
  const world = () => readJson(worldPath);
  return createProofExecutionRuntime({
    proofReadinessValue: () => ({
      version: 1,
      changeId: "change-a",
      status: "READY",
      workspaceHash: world().workspaceHash,
      issues: [],
      externalProviders: [],
      unavailableProviders: [],
      pendingTasks: [],
      next: []
    }),
    relevantSnapshot: () => ({
      id: `snapshot-${world().workspaceHash}`,
      workspaceHash: world().workspaceHash
    }),
    loadRuntime: () => readJson(runtimePath),
    saveRuntime: (state) => writeJson(runtimePath, state),
    now: () => new Date().toISOString(),
    requiredProviders: () => ["test"],
    receiptValidity: () => ({ validity: world().testValid ? "valid" : "missing" }),
    rebindReusableReceipt: () => {},
    executionNodes: () => ({
      nodes: world().testValid ? [] : [{ provider: "test", covers: ["test"] }],
      unconfigured: [],
      unavailable: []
    }),
    collectableExecutionNodes: (_id, nodes) => ({ nodes, blocked: [] }),
    startRequiredServices: async () => [],
    runExecutionDag: async (_id, nodes) => {
      appendFileSync(executionLog, `${process.pid}\n`);
      writeFileSync(startedPath, `${process.pid}\n`);
      if (process.env.PROOF_ADVANCE_HOLD === "1") {
        const releasePath = join(root, "provider-release");
        const deadline = Date.now() + 5_000;
        while (!existsSync(releasePath) && Date.now() < deadline) await delay(10);
      }
      writeJson(worldPath, { ...world(), testValid: true });
      return nodes.map((node) => ({ provider: node.provider, status: "pass" }));
    },
    durableArtifact: () => { throw new Error("no service artifact expected"); },
    pendingTasks: () => [],
    proofPreflight: () => {},
    prove: (_id, proofRunId) => {
      const proof = {
        version: 4,
        proofProtocolVersion: "4",
        status: "pass",
        proofRunId,
        workspaceHash: world().workspaceHash,
        providers: ["test"]
      };
      writeJson(finalProofPath, proof);
      writeJson(runtimePath, { ...readJson(runtimePath), status: "proven" });
    },
    proofAudit: () => existsSync(finalProofPath)
      ? { valid: true, proof: readJson(finalProofPath) }
      : { valid: false, reason: "missing-proof" },
    readJson,
    writeJson,
    proofPath: () => finalProofPath,
    proofAdvancePath: () => cursorPath,
    proofAdvanceLockPath: () => lockPath,
    providerConfig: (_id, provider) => ({
      adapter: provider === "test" ? "command" : "external"
    }),
    die: (message) => { throw new Error(message); },
    markBlocked: () => {}
  });
}

async function runWorker(root) {
  const runtime = processFixture(root);
  await runtime.proofAdvance("change-a");
}

function child(root, env = {}) {
  const processHandle = spawn(process.execPath, [SELF, "worker", root], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  processHandle.stdout.setEncoding("utf8");
  processHandle.stderr.setEncoding("utf8");
  return processHandle;
}

function completion(processHandle) {
  let stdout = "";
  let stderr = "";
  processHandle.stdout.on("data", (chunk) => { stdout += chunk; });
  processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve) => processHandle.on("close", (status) =>
    resolve({ status, stdout, stderr })));
}

async function waitFor(path) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path) && Date.now() < deadline) await delay(10);
  assert.ok(existsSync(path), `timed out waiting for ${path}`);
}

async function parentTest() {
  const root = mkdtempSync(join(tmpdir(), "proof-advance-process-"));
  try {
    writeJson(join(root, "world.json"), {
      workspaceHash: "workspace-a",
      testValid: false
    });
    writeJson(join(root, "runtime.json"), {
      version: 2,
      id: "change-a",
      status: "building"
    });

    const first = child(root, { PROOF_ADVANCE_HOLD: "1" });
    const firstDone = completion(first);
    await waitFor(join(root, "provider-started"));
    const concurrent = spawnSync(process.execPath, [SELF, "worker", root], {
      encoding: "utf8",
      env: process.env
    });
    assert.equal(concurrent.status, 0, concurrent.stderr);
    const concurrentOutcome = JSON.parse(concurrent.stdout);
    assert.equal(concurrentOutcome.status, "IN_PROGRESS");
    writeFileSync(join(root, "provider-release"), "release\n");
    const firstResult = await firstDone;
    assert.equal(firstResult.status, 0, firstResult.stderr);
    assert.equal(JSON.parse(firstResult.stdout).status, "PASS");
    assert.equal(readFileSync(join(root, "provider-executions.log"), "utf8")
      .trim().split("\n").length, 1,
    "two processes contending for one change must execute the provider once");

    const resumed = spawnSync(process.execPath, [SELF, "worker", root], {
      encoding: "utf8",
      env: process.env
    });
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).reused, true,
      "a new process must reuse the durable proof and cursor");

    writeJson(join(root, "world.json"), {
      workspaceHash: "workspace-b",
      testValid: false
    });
    rmSync(join(root, "provider-started"), { force: true });
    writeJson(join(root, "proof.lock"), {
      version: 1,
      pid: 99999999,
      token: "dead-owner",
      acquiredAt: "2026-08-14T00:00:00.000Z"
    });
    rmSync(join(root, "provider-release"), { force: true });
    const recoveryA = child(root, { PROOF_ADVANCE_HOLD: "1" });
    const recoveryB = child(root, { PROOF_ADVANCE_HOLD: "1" });
    const recoveryAPromise = completion(recoveryA);
    const recoveryBPromise = completion(recoveryB);
    const firstRecovery = await Promise.race([
      recoveryAPromise.then((result) => ({ index: 0, result })),
      recoveryBPromise.then((result) => ({ index: 1, result }))
    ]);
    assert.equal(firstRecovery.result.status, 0, firstRecovery.result.stderr);
    assert.equal(JSON.parse(firstRecovery.result.stdout).status, "IN_PROGRESS",
      "the non-owner must return while the elected stale-lock recoverer is held");
    writeFileSync(join(root, "provider-release"), "release\n");
    const recovered = await Promise.all([recoveryAPromise, recoveryBPromise]);
    recovered.forEach((result) => assert.equal(result.status, 0, result.stderr));
    assert.deepEqual(recovered.map((result) => JSON.parse(result.stdout).status).sort(),
      ["IN_PROGRESS", "PASS"],
      "two simultaneous stale-lock recoverers must elect exactly one owner");
    assert.equal(readFileSync(join(root, "provider-executions.log"), "utf8")
      .trim().split("\n").length, 2,
    "a dead process lock must be recovered without double execution");

    writeJson(join(root, "world.json"), {
      workspaceHash: "workspace-c",
      testValid: false
    });
    writeFileSync(join(root, "proof.lock"), "");
    const initializing = spawnSync(process.execPath, [SELF, "worker", root], {
      encoding: "utf8",
      env: process.env
    });
    assert.equal(initializing.status, 0, initializing.stderr);
    const initializingOutcome = JSON.parse(initializing.stdout);
    assert.equal(initializingOutcome.status, "IN_PROGRESS");
    assert.equal(initializingOutcome.next[0].kind,
      "retry-after-lock-initialization");
    assert.ok(initializingOutcome.next[0].retryAfterMs > 0,
      "a fresh ownerless descriptor must give a bounded recovery instruction");
    const old = new Date(Date.now() - 20_000);
    utimesSync(join(root, "proof.lock"), old, old);
    const residueRecovered = spawnSync(process.execPath, [SELF, "worker", root], {
      encoding: "utf8",
      env: process.env
    });
    assert.equal(residueRecovered.status, 0, residueRecovered.stderr);
    assert.equal(JSON.parse(residueRecovered.stdout).status, "PASS");
    assert.equal(readFileSync(join(root, "provider-executions.log"), "utf8")
      .trim().split("\n").length, 3,
    "an old create-before-write lock residue must be recoverable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log("proof advance process tests: PASS");
}

if (process.argv[2] === "worker") await runWorker(process.argv[3]);
else await parentTest();
