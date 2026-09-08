import assert from "node:assert/strict";
import test from "node:test";
import { upgradeEvidenceOperation } from "../runtime/evidence/proof-readiness.mjs";

function context({
  state = { status: "active", revision: 0, executionRevision: 0 },
  evidence = { version: 1 },
  execution,
  proofExists = false
} = {}) {
  const writes = new Map();
  const removed = [];
  const logs = [];
  let saved;
  const paths = {
    evidence: "/changes/change/evidence.yaml",
    execution: "/changes/change/execution.yaml",
    proof: "/proofs/change.json"
  };
  return {
    writes,
    removed,
    logs,
    saved: () => saved,
    operation: {
      loadRuntime: () => state,
      fail: (message) => { throw new Error(message); },
      changePath: () => "/changes/change",
      proofPath: () => paths.proof,
      readJson: (path) => path === paths.evidence ? evidence : execution,
      writeJson: (path, value) => writes.set(path, structuredClone(value)),
      saveRuntime: (value) => { saved = structuredClone(value); },
      pathExists: (path) => path === paths.execution ? execution !== undefined : proofExists,
      remove: (path) => removed.push(path),
      output: { log: (message) => logs.push(message) }
    }
  };
}

test("evidence upgrade rejects archived and unknown contracts", () => {
  assert.throws(() => upgradeEvidenceOperation(context({
    state: { status: "archived" }
  }).operation, "change"), /already archived/);
  assert.throws(() => upgradeEvidenceOperation(context({
    evidence: { version: 3 }
  }).operation, "change"), /unknown evidence version '3'/);
});

test("version one upgrade creates execution wiring and clears stale proof", () => {
  const harness = context({
    state: { status: "active" },
    evidence: { version: 1, providers: { test: { command: ["npm", "test"] } }, claims: [] },
    proofExists: true
  });

  upgradeEvidenceOperation(harness.operation, "change");

  assert.deepEqual(harness.writes.get("/changes/change/evidence.yaml"), {
    version: 2,
    claims: []
  });
  assert.deepEqual(harness.writes.get("/changes/change/execution.yaml"), {
    version: 1,
    providers: { test: { command: ["npm", "test"] } },
    services: {}
  });
  assert.deepEqual(harness.saved(), {
    status: "active",
    version: 2,
    revision: 1,
    executionRevision: 1
  });
  assert.deepEqual(harness.removed, ["/proofs/change.json"]);
  assert.match(harness.logs[0], /EVIDENCE change:[\s\S]*configure execution.yaml/);
});

test("version two upgrade preserves execution overrides and increments revisions", () => {
  const harness = context({
    state: { status: "active", revision: 4, executionRevision: 7 },
    evidence: {
      version: 2,
      providers: { test: { command: ["old"] }, review: { external: true } }
    },
    execution: {
      version: 1,
      providers: { test: { command: ["new"] } },
      services: { api: { command: ["serve"] } }
    }
  });

  upgradeEvidenceOperation(harness.operation, "change");

  assert.deepEqual(harness.writes.get("/changes/change/evidence.yaml"), { version: 2 });
  assert.deepEqual(harness.writes.get("/changes/change/execution.yaml"), {
    version: 1,
    providers: {
      test: { command: ["new"] },
      review: { external: true }
    },
    services: { api: { command: ["serve"] } }
  });
  assert.deepEqual(harness.saved(), {
    status: "active",
    version: 2,
    revision: 5,
    executionRevision: 8
  });
  assert.deepEqual(harness.removed, []);
});
