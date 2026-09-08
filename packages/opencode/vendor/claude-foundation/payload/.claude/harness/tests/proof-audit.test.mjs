import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createProofRuntime } from "../runtime/evidence/proof-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-proof-audit-"));
const id = "audit-proof";
const proofFile = join(root, "proof.json");
const runRoot = join(root, "runs", "run-1");
const receiptFile = join(runRoot, "receipts", "test.json");
const nodeResultFile = join(runRoot, "nodes", "T1.json");
mkdirSync(dirname(receiptFile), { recursive: true });
mkdirSync(dirname(nodeResultFile), { recursive: true });
writeFileSync(receiptFile, `${JSON.stringify({ provider: "test", artifacts: [] })}\n`);
writeFileSync(nodeResultFile, "node result\n");

const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const entry = (path, extra = {}) => ({
  path: relative(root, path).replaceAll("\\", "/"),
  sha256: digest(path), size: statSync(path).size, ...extra
});
const baseProof = () => ({
  version: 2, proofProtocolVersion: 1, status: "pass", proofRunId: "run-1",
  workspaceHash: "workspace", graphIdentity: null, graphRevision: null,
  receipts: [entry(receiptFile, { provider: "test" })], artifacts: []
});
const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
};
const writeProof = (proof) => writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`);
let invalidArtifact = null;
let output = "";
const priorLog = console.log;
console.log = (message) => { output += `${message}\n`; };

const runtime = createProofRuntime({
  root, protocolVersion: "1", loadRuntime: () => ({}), saveRuntime: () => {},
  validate: () => {}, changedSurfaceIssues: () => [], activeChangeLeases: () => [],
  pendingTasks: () => [], clearSnapshotCache: () => {}, relevantSnapshot: () => ({}),
  requiredProviders: () => [], advisoryCapabilities: () => [], receiptValidity: () => ({}),
  proofRunRoot: (_id, runId) => join(root, "runs", runId), receiptPath: () => receiptFile,
  fileDigest: digest, protocolDescriptor: () => ({}), contractFingerprint: () => "contract",
  executionFingerprint: () => "execution", proofPath: () => proofFile,
  writeJson: () => {}, readJson,
  pathInside: (parent, candidate) => {
    const rel = relative(parent, candidate);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  },
  validateArtifact: (artifact) => artifact.name !== invalidArtifact,
  instructionProvenance: () => null, now: () => "2026-08-26T00:00:00.000Z",
  fail: (message) => { throw new Error(message); }
});

const reasonFor = (mutate = () => {}) => {
  const proof = baseProof();
  mutate(proof);
  writeProof(proof);
  return runtime.audit(id, true).reason;
};

try {
  assert.equal(runtime.audit(id, true).reason, "missing-proof");
  assert.equal(reasonFor((proof) => { proof.status = "fail"; }), "missing-proof");
  assert.equal(reasonFor((proof) => { delete proof.proofProtocolVersion; }), "proof-version-stale");
  assert.equal(reasonFor((proof) => { proof.proofProtocolVersion = 2; }), "proof-version-stale");
  assert.equal(reasonFor((proof) => { proof.receipts = null; }), "missing-receipt-manifest");
  assert.equal(reasonFor((proof) => { proof.receipts = []; }), "missing-receipt-manifest");

  const aggregate = () => ({
    version: 1, status: "pass", graphIdentity: "graph", graphRevision: 3,
    workspaceHash: "workspace", requiredNodes: ["task:T1"], coveredNodes: ["task:T1"],
    requiredEdges: ["edge-1"], coveredEdges: ["edge-1"]
  });
  const withAggregate = () => {
    const proof = baseProof();
    proof.graphIdentity = "graph";
    proof.graphRevision = 3;
    proof.aggregateGraphProof = aggregate();
    proof.nodeProofs = [{ nodeId: "task:T1", status: "pass", source: "legacy-policy" }];
    return proof;
  };
  for (const mutate of [
    (proof) => { proof.aggregateGraphProof.status = "fail"; },
    (proof) => { proof.aggregateGraphProof.graphIdentity = "other"; },
    (proof) => { proof.aggregateGraphProof.graphRevision = 4; },
    (proof) => { proof.aggregateGraphProof.workspaceHash = "other"; }
  ]) {
    const proof = withAggregate();
    mutate(proof);
    writeProof(proof);
    assert.equal(runtime.audit(id, true).reason, "aggregate-graph-proof-identity");
  }
  let proof = withAggregate();
  proof.aggregateGraphProof.coveredNodes = [];
  writeProof(proof);
  assert.equal(runtime.audit(id, true).reason, "aggregate-graph-proof-incomplete");
  proof = withAggregate();
  proof.aggregateGraphProof.coveredEdges = [];
  writeProof(proof);
  assert.equal(runtime.audit(id, true).reason, "aggregate-graph-proof-incomplete");
  proof = withAggregate();
  proof.nodeProofs = [];
  writeProof(proof);
  assert.equal(runtime.audit(id, true).reason, "aggregate-node-proof-missing");
  proof = withAggregate();
  proof.nodeProofs[0].status = "fail";
  writeProof(proof);
  assert.equal(runtime.audit(id, true).reason, "aggregate-node-proof-missing");
  proof = withAggregate();
  delete proof.aggregateGraphProof.requiredNodes;
  delete proof.aggregateGraphProof.coveredNodes;
  delete proof.aggregateGraphProof.requiredEdges;
  delete proof.aggregateGraphProof.coveredEdges;
  delete proof.nodeProofs;
  writeProof(proof);
  assert.equal(runtime.audit(id, true).valid, true);

  proof = withAggregate();
  proof.nodeProofs = [{
    nodeId: "task:T1", status: "pass", source: "accepted-lease-result",
    resultAuthority: entry(nodeResultFile)
  }];
  writeProof(proof);
  assert.equal(runtime.audit(id, true).valid, true);
  proof.nodeProofs[0].resultAuthority.sha256 = "bad";
  writeProof(proof);
  assert.equal(runtime.audit(id, true).reason, "node-result-tampered:task:T1");
  proof = withAggregate();
  proof.nodeProofs = [{ nodeId: null, status: "pass", source: "accepted-lease-result" }];
  proof.aggregateGraphProof.requiredNodes = [];
  proof.aggregateGraphProof.coveredNodes = [];
  writeProof(proof);
  assert.equal(runtime.audit(id, true).reason, "node-result-tampered:unknown");

  const outside = join(root, "outside.json");
  writeFileSync(outside, "outside\n");
  assert.equal(reasonFor((value) => { value.receipts[0] = entry(outside); }),
    "receipt-tampered:unknown");
  assert.equal(reasonFor((value) => { value.receipts[0].path = "runs/run-1/missing.json"; }),
    "receipt-tampered:test");
  const directory = join(runRoot, "directory");
  mkdirSync(directory, { recursive: true });
  assert.equal(reasonFor((value) => {
    value.receipts[0] = { path: relative(root, directory), sha256: "x", size: 0, provider: "test" };
  }), "receipt-tampered:test");
  assert.equal(reasonFor((value) => { value.receipts[0].sha256 = "bad"; }),
    "receipt-tampered:test");
  assert.equal(reasonFor((value) => { value.receipts[0].size += 1; }),
    "receipt-tampered:test");

  writeFileSync(receiptFile, `${JSON.stringify({ provider: "test" })}\n`);
  writeProof(baseProof());
  assert.equal(runtime.audit(id, true).valid, true);
  writeFileSync(receiptFile, `${JSON.stringify({
    provider: "test",
    artifacts: [{ name: "optional", required: false }, { name: "valid", required: true }]
  })}\n`);
  writeProof(baseProof());
  assert.equal(runtime.audit(id, true).valid, true);
  invalidArtifact = "valid";
  writeProof(baseProof());
  assert.equal(runtime.audit(id, true).reason, "artifact-tampered:test");
  proof = baseProof();
  delete proof.receipts[0].provider;
  writeProof(proof);
  assert.equal(runtime.audit(id, true).reason, "artifact-tampered:unknown");
  invalidArtifact = "proof-required";
  proof = baseProof();
  proof.artifacts = [
    { name: "proof-optional", required: false },
    { name: "proof-required", required: true }
  ];
  writeProof(proof);
  assert.equal(runtime.audit(id, true).reason, "proof-artifact-tampered");
  invalidArtifact = null;

  proof = baseProof();
  delete proof.artifacts;
  writeProof(proof);
  assert.equal(runtime.audit(id, true).valid, true);

  proof = baseProof();
  proof.artifacts = [{ name: "proof-required", required: true }];
  writeProof(proof);
  output = "";
  assert.equal(runtime.audit(id, false).valid, true);
  assert.match(output, /PROOF AUDIT audit-proof: valid/);
  output = "";
  assert.equal(runtime.audit(id, true).valid, true);
  assert.equal(output, "");

  console.log = priorLog;
  console.log("proof audit tests: PASS");
} finally {
  console.log = priorLog;
  rmSync(root, { recursive: true, force: true });
}
