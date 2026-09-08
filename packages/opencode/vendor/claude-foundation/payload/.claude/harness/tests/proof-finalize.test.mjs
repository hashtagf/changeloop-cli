import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createProofRuntime } from "../runtime/evidence/proof-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-proof-finalize-"));
const id = "finalize-proof";
const proofFile = join(root, "proofs", `${id}.json`);
let receiptDirectory = join(root, "receipts", id);
let state = {
  status: "building", graphExecutionVersion: 2, contractRevision: 4,
  collectedServiceArtifacts: [{ path: "collected.log", required: true }]
};
let surfaceIssues = [];
let leases = [];
let pending = [];
let snapshot = { id: "snapshot-1", workspaceHash: "workspace-hash", repositories: ["root"] };
let providers = ["test"];
let validity = { test: "valid" };
let graph = null;
let advisory = ["observability"];
let provenance = { manifestDigest: "manifest" };
let repositories = [];
let gitResult = { status: 0, stdout: "", stderr: "" };
const saves = [];
const writes = [];
const cleared = [];
let output = "";
const priorLog = console.log;
console.log = (message) => { output += `${message}\n`; };

const fileDigest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  writes.push([path, value]);
};
const receiptPath = (_id, provider) => join(receiptDirectory, `${provider}.json`);
const seedReceipt = (provider, value = {}) => writeJson(receiptPath(id, provider), {
  provider, status: "pass", contractFingerprint: "contract-current", ...value
});
seedReceipt("test", { repositoryId: "root", repositoryIds: ["root"] });
seedReceipt("bare");
seedReceipt("old-provider", { contractFingerprint: "contract-old", status: "fail" });
seedReceipt("extra-provider", { observed: "extra" });
writeJson(join(receiptDirectory, "proof.json"), { ignored: true });
writeFileSync(join(receiptDirectory, "ignored.txt"), "ignored\n");

const runtime = createProofRuntime({
  root, protocolVersion: "1", loadRuntime: () => state,
  saveRuntime: (value) => saves.push(structuredClone(value)),
  validate: () => {}, changedSurfaceIssues: () => surfaceIssues,
  activeChangeLeases: () => leases, pendingTasks: () => pending,
  clearSnapshotCache: (changeId) => cleared.push(changeId),
  relevantSnapshot: () => snapshot, requiredProviders: () => providers,
  advisoryCapabilities: () => advisory,
  receiptValidity: (_id, provider) => ({
    provider, validity: validity[provider] || "valid",
    receipt: readJson(receiptPath(id, provider), {})
  }),
  proofRunRoot: (_id, runId) => join(root, "runs", runId),
  receiptPath, fileDigest, protocolDescriptor: () => ({ proof: "v1" }),
  contractFingerprint: () => "contract-current", executionFingerprint: () => "execution-current",
  proofPath: () => proofFile, writeJson, readJson,
  pathInside: (parent, candidate) => relative(parent, candidate).startsWith("..") === false,
  validateArtifact: () => true, instructionProvenance: () => provenance,
  agentPlanValue: () => ({ graph }), savedAgentPlan: null, taskResult: null,
  taskPacketWasPrecompleted: null, legacyExecutionPolicy: () => true,
  selectedRepositories: () => repositories,
  git: () => gitResult, now: () => "2026-08-26T00:00:00.000Z",
  fail: (message) => { throw new Error(message); }
});

const resetReady = () => {
  state = {
    status: "building", graphExecutionVersion: 2, contractRevision: 4,
    collectedServiceArtifacts: [{ path: "collected.log", required: true }]
  };
  surfaceIssues = [];
  leases = [];
  pending = [];
  snapshot = { id: "snapshot-1", workspaceHash: "workspace-hash", repositories: ["root"] };
  providers = ["test"];
  validity = { test: "valid" };
  repositories = [];
  gitResult = { status: 0, stdout: "", stderr: "" };
};

try {
  state.status = "archived";
  assert.throws(() => runtime.finalize(id), /already archived/);
  resetReady();
  surfaceIssues = ["undeclared path"];
  assert.throws(() => runtime.finalize(id), /changed-surface authority failed/);
  resetReady();
  leases = [{ taskId: "T1" }];
  assert.throws(() => runtime.finalize(id), /active agent leases block proof/);
  resetReady();
  pending = [{ id: "T1" }, { id: "T2" }];
  assert.throws(() => runtime.finalize(id), /2 implementation task/);

  resetReady();
  repositories = [{ id: "docs", mode: "read", workspacePath: join(root, "docs") }];
  state.repositories = { docs: { mode: "copy" } };
  runtime.finalize(id, "read-copy", { quiet: true });
  resetReady();
  repositories = [{ id: "docs", mode: "read", workspacePath: join(root, "docs") }];
  state.repositories = { docs: { mode: "worktree" } };
  gitResult = { status: 1, stdout: "", stderr: "git failed" };
  assert.throws(() => runtime.finalize(id), /read-only repository.*changed/);

  resetReady();
  state.activeProofRun = { workspaceHash: "executed-hash" };
  validity = { test: "stale" };
  assert.throws(() => runtime.finalize(id), /workspace hash changed while providers ran/);
  resetReady();
  validity = { test: "missing" };
  assert.throws(() => runtime.finalize(id), /no evidence has been executed/);
  resetReady();
  providers = ["test", "lint"];
  validity = { test: "expired", lint: "missing" };
  assert.throws(() => runtime.finalize(id), /test:expired.*lint:missing/s);

  resetReady();
  providers = ["test", "bare"];
  validity = { test: "valid", bare: "valid" };
  graph = {
    revision: 5, identity: "graph-5", claims: [],
    nodes: [
      {
        id: "task:T1", kind: "task", required: true, lifecycle: "build",
        repository: "root", paths: [], claims: [], resources: []
      },
      {
        id: "provider:test", kind: "provider", required: true, lifecycle: "prove",
        repository: "root", claims: ["claim-1"]
      },
      {
        id: "provider:multi", kind: "provider", required: true, lifecycle: "prove",
        repositories: ["root", "service"], claims: []
      },
      { id: "ignored", kind: "provider", required: false, lifecycle: "prove" },
      { id: "land", kind: "provider", required: true, lifecycle: "land" }
    ],
    edges: [
      { id: "edge-task", to: "task:T1" },
      { id: "edge-provider", to: "provider:test" },
      { id: "edge-ignored", to: "ignored" }
    ]
  };
  state.activeProofRun = {
    id: "active-run", workspaceHash: "workspace-hash",
    serviceArtifacts: [{ path: "active.log", required: true }]
  };
  output = "";
  runtime.finalize(id);
  const graphProof = readJson(proofFile, {});
  assert.equal(graphProof.proofRunId, "active-run");
  assert.equal(graphProof.aggregateGraphProof.graphIdentity, "graph-5");
  assert.deepEqual(graphProof.aggregateGraphProof.requiredEdges, ["edge-task", "edge-provider"]);
  assert.deepEqual(graphProof.nodeProofs.map((row) => row.source), [
    "legacy-policy", "provider-receipt", "provider-receipt"
  ]);
  assert.deepEqual(graphProof.artifacts, [{ path: "active.log", required: true }]);
  const testReceipt = graphProof.receipts.find((row) => row.provider === "test");
  const bareReceipt = graphProof.receipts.find((row) => row.provider === "bare");
  assert.equal(testReceipt.repositoryId, "root");
  assert.deepEqual(testReceipt.repositoryIds, ["root"]);
  assert.equal(bareReceipt.repositoryId, null);
  assert.deepEqual(bareReceipt.repositoryIds, []);
  assert.deepEqual(graphProof.excludedReceipts.map((row) => row.validity),
    ["not-required", "contract-stale"]);
  assert.match(output, /excluded receipts/);
  assert.equal(state.status, "proven");
  assert.equal(state.collectedServiceArtifacts, undefined);

  resetReady();
  graph = null;
  advisory = [];
  provenance = null;
  snapshot = { id: "snapshot-2", workspaceHash: "workspace-two" };
  receiptDirectory = join(root, "empty-receipts");
  providers = [];
  output = "";
  runtime.finalize(id, "requested-run", { quiet: false });
  const simpleProof = readJson(proofFile, {});
  assert.equal(simpleProof.proofRunId, "requested-run");
  assert.equal(simpleProof.aggregateGraphProof, null);
  assert.equal(simpleProof.repositories, null);
  assert.deepEqual(simpleProof.receipts, []);
  assert.deepEqual(simpleProof.excludedReceipts, []);
  assert.deepEqual(simpleProof.artifacts, [{ path: "collected.log", required: true }]);
  assert.equal(simpleProof.instructionProvenance, null);
  assert.match(output, /PROVEN finalize-proof/);
  assert.doesNotMatch(output, /excluded receipts/);

  assert.equal(cleared.length > 0, true);
  assert.equal(saves.length > 0, true);
  assert.equal(writes.some(([path]) => path.endsWith("manifest.json")), true);
  assert.equal(existsSync(proofFile), true);
  priorLog("proof finalize tests: PASS");
} finally {
  console.log = priorLog;
  rmSync(root, { recursive: true, force: true });
}
