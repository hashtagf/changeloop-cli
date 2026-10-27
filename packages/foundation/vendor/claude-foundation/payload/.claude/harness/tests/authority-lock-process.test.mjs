import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), "foundation-authority-process-lock-"));
const worker = join(fixture, "worker.mjs");
const authorityUrl = pathToFileURL(join(root,
  ".claude/harness/runtime/workflow/authority-runtime.mjs")).href;
const storeUrl = pathToFileURL(join(root,
  ".claude/harness/runtime/workflow/authority.mjs")).href;

const workerSource = `
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createAuthorityRuntime } from ${JSON.stringify(authorityUrl)};
import { createAuthorityStore } from ${JSON.stringify(storeUrl)};
const root = process.argv[2];
const readJson = (path, fallback = undefined) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; } };
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };
const store = createAuthorityStore({ root: join(root, "authority"), protocolVersion: "1", readJson, writeJson, now: () => new Date().toISOString() });
const runtime = createAuthorityRuntime({
  root, protocolVersion: "1", ciEvidenceProtocolVersion: "1", authorityStore: store,
  requiredProviders: () => ["review"], providerCapability: () => "review",
  providerConfig: () => ({ capability: "review", adapter: "external" }),
  reviewPacketValue: () => ({ version: 1, claims: [], changedSurface: { manifest: [] } }),
  loadRuntime: () => ({ id: "race", reviewHistory: null }), evidence: () => ({ claims: [] }),
  resolvedAcceptance: () => ({ required: false }), relevantHash: () => "workspace",
  validate: () => { const ms = Number(process.env.HOLD_MS || 0); if (ms) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  pendingTasks: () => [], claimsForProvider: () => [], stableHash, now: () => new Date().toISOString(),
  reviewPolicy: () => ({}), readJson, expandList: (value) => value, listCount: (value) => value.length,
  dispatchReviewAttempt: () => null, reviewAttemptByDigest: () => null,
  assertReviewDispatchAllowed: () => ({}), reviewHistoryState: () => ({}),
  foundationPolicy: () => ({ workflow: { reviewCircuit: "full-delta" } }),
  receiptPath: () => join(root, "receipt.json"), recordReceipt: () => {}, receiptValidity: () => ({ validity: "valid" }),
  fileDigest: () => "digest", providerWorkspaceHash: () => "workspace", providerRepository: () => null,
  providerWorkspace: () => root, gitHead: () => "head", validateSignedCiEnvelope: () => ({ valid: false }),
  providerClaims: () => [], fail
});
try { runtime.requestAuthority("race", { type: "review" }); }
catch (error) { process.stderr.write(String(error.message)); process.exit(1); }
`;

const child = (hold = 0) => {
  const processHandle = spawn(process.execPath, [worker, fixture], {
    env: { ...process.env, HOLD_MS: String(hold) }, stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  processHandle.stdout.on("data", (chunk) => { stdout += chunk; });
  processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => processHandle.on("exit", (code, signal) =>
    resolve({ code, signal, stdout, stderr })));
  return { processHandle, done };
};
const waitFor = async (condition, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for authority lock");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

let holder = null;
try {
  mkdirSync(join(fixture, ".foundation", "locks"), { recursive: true });
  writeFileSync(worker, workerSource);
  holder = child(30000);
  const lock = join(fixture, ".foundation", "locks", "authority-race.lock");
  await waitFor(() => existsSync(lock));
  const refused = await child().done;
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /already in progress/);
  holder.processHandle.kill("SIGKILL");
  await holder.done;
  holder = null;
  const recovered = await child().done;
  assert.equal(recovered.code, 0, recovered.stderr);
  assert.equal(existsSync(lock), false);
  console.log("authority process lock tests: PASS");
} finally {
  if (holder) {
    holder.processHandle.kill("SIGKILL");
    await holder.done;
  }
  rmSync(fixture, { recursive: true, force: true });
}
