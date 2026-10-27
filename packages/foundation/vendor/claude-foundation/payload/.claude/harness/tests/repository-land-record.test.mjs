import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createLandRuntime } from "../runtime/workflow/land-runtime.mjs";
import { canonicalJson } from "../runtime/core/trust.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-repository-land-"));
const transactions = join(root, "transactions");
const proofFile = join(root, "proof.json");
const envelopeFile = join(root, "signed-ci.json");
const id = "land-child";
const commit = "a".repeat(40);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
let repository = {
  id: "child", type: "git", mode: "write", path: join(root, "child-target"),
  workspacePath: join(root, "child-sandbox"), relativePath: "child", dependsOn: [],
  ci: { issuers: {
    "fixture-ci": {
      algorithm: "ed25519",
      publicKey: publicKey.export({ type: "spki", format: "pem" })
    }
  } }
};
const state = {
  status: "archived", archivedAt: "2026-08-26T00:00:00.000Z",
  schema: "foundation-standard", impact: "medium",
  workspace: { path: root },
  repositories: {
    child: { path: repository.workspacePath, baseHead: "base" }
  }
};
let gitMode = "ok";
let branch = "feature/land";
let head = commit;
let graph = null;
const saves = [];
const writes = [];
let output = "";
let warnings = "";
const priorLog = console.log;
const priorError = console.error;
console.log = (message) => { output += `${message}\n`; };
console.error = (message) => { warnings += `${message}\n`; };

const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  writes.push([path, value]);
};
const git = (args, cwd) => {
  if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
    if (gitMode === "branch-error") return { status: 1, stdout: "", stderr: "error" };
    return { status: 0, stdout: `${branch}\n`, stderr: "" };
  }
  if (args[0] === "rev-parse")
    return gitMode === "missing-commit"
      ? { status: 1, stdout: "", stderr: "missing" }
      : { status: 0, stdout: `${commit}\n`, stderr: "" };
  if (args[0] === "status") {
    if (gitMode === "status-error") return { status: 1, stdout: "", stderr: "error" };
    if (gitMode === "dirty") return { status: 0, stdout: " M file.js\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  }
  if (args[0] === "merge-base") return { status: 0, stdout: "", stderr: "" };
  if (args[0] === "ls-files")
    return { status: 0, stdout: `160000 ${commit} 0\tchild\n`, stderr: "" };
  throw new Error(`unexpected git call ${args.join(" ")} at ${cwd}`);
};
const runtime = createLandRuntime({
  root, transactions, loadRuntime: () => state,
  saveRuntime: (value) => saves.push(structuredClone(value)),
  pendingApplyTransactions: () => [], recoverPendingApply: () => {},
  assertNoDroppedScenarios: () => {}, blockingDrift: () => [],
  proofAudit: () => ({ valid: true }), proofPath: () => proofFile,
  readJson, writeJson, clearSnapshotCache: () => {}, relevantHash: () => "workspace-hash",
  requiredProviders: () => [], receiptValidity: () => ({ validity: "valid" }),
  fileDigest: () => "digest", receiptPath: () => join(root, "receipt.json"),
  handoffReadiness: () => ({ status: "ready" }), verifyAppliedProjection: () => ({ valid: true }),
  selectedRepositories: () => [repository], repositoryById: () => repository,
  git, gitHead: () => head, ciEvidenceProtocolVersion: "1",
  stableHash: (value) => JSON.stringify(value), agentPlanValue: () => ({ graph }),
  now: () => "2026-08-26T00:00:00.000Z",
  blockWithDecision: () => { throw new Error("blocked"); },
  fail: (message) => { throw new Error(message); }
});

const flags = (extra = {}) => ({
  repo: "child", commit: "candidate", "decision-ref": "host://land-child", ...extra
});
const writeSignedEnvelope = (status = "pass") => {
  const payload = {
    version: 1, issuer: "fixture-ci", changeId: id, provider: "land:child",
    workspaceHash: commit, commit, status,
    runUrl: "https://ci.example.invalid/runs/42",
    artifacts: [{ name: "report.json", sha256: "b".repeat(64) }]
  };
  writeJson(envelopeFile, {
    version: 1, payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64")
  });
  return envelopeFile;
};

try {
  assert.throws(() => runtime.recordRepositoryLand(id, {}), /requires --repo/);
  assert.throws(() => runtime.recordRepositoryLand(id, { repo: "child", commit: "candidate" }),
    /requires --decision-ref/);

  repository = { ...repository, id: "root" };
  assert.throws(() => runtime.recordRepositoryLand(id, flags()), /not a writable child/);
  repository = { ...repository, id: "child", mode: "read" };
  assert.throws(() => runtime.recordRepositoryLand(id, flags()), /not a writable child/);
  repository = { ...repository, mode: "write" };
  const savedRuntime = state.repositories.child;
  state.repositories.child = {};
  assert.throws(() => runtime.recordRepositoryLand(id, flags()), /has no sandbox/);
  state.repositories.child = savedRuntime;

  gitMode = "missing-commit";
  assert.throws(() => runtime.recordRepositoryLand(id, flags()), /not available/);
  gitMode = "ok";
  head = "c".repeat(40);
  assert.throws(() => runtime.recordRepositoryLand(id, flags()), /HEAD must equal/);
  head = commit;
  gitMode = "status-error";
  assert.throws(() => runtime.recordRepositoryLand(id, flags()), /must be clean/);
  gitMode = "dirty";
  assert.throws(() => runtime.recordRepositoryLand(id, flags()), /must be clean/);
  gitMode = "ok";

  assert.throws(() => runtime.recordRepositoryLand(id, flags({ ci: "error" })),
    /--ci must be pass\|fail\|pending/);
  assert.throws(() => runtime.recordRepositoryLand(id, flags({ "ci-required": true, ci: "pass" })),
    /requires CI evidence/);
  state.riskBasedCiRequired = true;
  state.impact = "high";
  assert.throws(() => runtime.recordRepositoryLand(id, flags({ ci: "pass" })),
    /requires CI evidence/);
  state.riskBasedCiRequired = false;
  state.impact = "medium";
  assert.throws(() => runtime.recordRepositoryLand(id, flags({
    "ci-attestation": join(root, "missing.json")
  })), /CI attestation rejected.*not found/);

  const signed = writeSignedEnvelope();
  assert.throws(() => runtime.recordRepositoryLand(id, flags({
    ci: "fail", "ci-attestation": signed
  })), /contradicts the signed CI attestation/);

  branch = "main";
  warnings = "";
  output = "";
  runtime.recordRepositoryLand(id, flags());
  assert.equal(state.repositories.child.land.ci, null);
  assert.equal(state.repositories.child.land.ciRequirement, "optional");
  assert.equal(state.repositories.child.land.binding, "runtime-state-only");
  assert.match(warnings, /default branch/);
  assert.match(warnings, /runtime state/);
  assert.match(output, /ci: unknown \(self-reported\)/);

  repository = { ...repository, type: "submodule" };
  branch = "feature/land";
  warnings = "";
  graph = { revision: 2, identity: "graph-id" };
  writeJson(proofFile, {
    proofRunId: "proof-1", status: "pass",
    aggregateGraphProof: { graphIdentity: "graph-id" }
  });
  runtime.recordRepositoryLand(id, flags({
    ci: "pass", "ci-required": true, "ci-attestation": signed
  }));
  assert.equal(state.repositories.child.land.ciProvenance.kind, "signed-ci");
  assert.equal(state.repositories.child.land.ciRequirement, "explicit");
  assert.equal(state.repositories.child.land.binding, "root-gitlink");
  assert.equal(warnings, "");

  state.riskBasedCiRequired = true;
  state.impact = "high";
  runtime.recordRepositoryLand(id, flags({ ci: "pass", "ci-attestation": signed }));
  assert.equal(state.repositories.child.land.ciRequirement, "risk-policy");
  assert.equal(state.repositories.child.land.ciRequired, true);

  gitMode = "branch-error";
  runtime.recordRepositoryLand(id, flags({ ci: "pass", "ci-attestation": signed }));
  assert.equal(saves.length > 0, true);
  assert.equal(writes.some(([path]) => path.endsWith("land-preparation.json")), true);
  priorLog("repository land record tests: PASS");
} finally {
  console.log = priorLog;
  console.error = priorError;
  rmSync(root, { recursive: true, force: true });
}
