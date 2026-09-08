import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  createPacketRuntime,
  priorReviewValue,
  reviewArtifactValue,
  reviewChangedSurface,
  reviewContractArtifactValues,
  reviewEvidenceRows,
  reviewSurfaceRows,
  reviewSurfaceWorkspace
} from "../runtime/workflow/packet-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-packet-value-"));
let activePath = join(root, "openspec", "changes", "packet-test");
const leasesRoot = join(root, "leases");
mkdirSync(join(activePath, "specs"), { recursive: true });
for (const name of ["proposal.md", "tasks.md", "evidence.yaml"])
  writeFileSync(join(activePath, name), `${name}\n`);

const state = {
  intent: "test packets", schema: "foundation-standard", status: "BUILDING",
  revision: 2, contractRevision: 3, executionRevision: 4,
  impact: "medium", coupling: "connected", reviewRequired: true,
  workspace: { path: root }
};
const repositories = {
  root: {
    id: "root", type: "control", mode: "worktree", relativePath: ".",
    workspacePath: root, dependsOn: []
  },
  other: {
    id: "other", type: "service", mode: "worktree", relativePath: "other",
    workspacePath: join(root, "other"), baseHead: "selected-other", dependsOn: ["root"]
  }
};
const baseTasks = [
  {
    id: "T1", done: false, kind: "implementation", repository: "root",
    dependsOn: [], paths: ["src/**"], resources: ["workspace-write"],
    claims: ["c1"], text: "implement root"
  },
  {
    id: "T2", done: true, kind: "implementation", repository: "other",
    dependsOn: ["T1"], paths: ["other/**"], resources: [], claims: ["c2"],
    text: "implement other"
  },
  {
    id: "T3", done: false, kind: "inventory", repository: "root",
    dependsOn: [], paths: [], resources: [], claims: [], text: "inventory"
  }
];
let tasks = structuredClone(baseTasks);
let contract = {
  claims: [
    { id: "c1", scenario: "root scenario", capabilities: ["test"], repositories: ["root"] },
    { id: "c2", scenario: "other scenario", capabilities: ["test"], repositories: ["other"] }
  ],
  invariants: ["preserve packet behavior"]
};
let providers = ["global", "root-provider", "other-provider", "uncovered"];
let surface = [
  { repositoryId: "root", path: "src/a.js" },
  { repositoryId: "root", path: "docs/readme.md" },
  { repositoryId: "other", path: "lib/b.js" }
];
let attempts = [];
let compositeHash = "composite-hash";
let instructionManifest = null;
const packetLimits = {
  global: 1_000_000, repository: 1_000_000, task: 1_000_000, review: 1_000_000
};
const contextMetrics = [];
const priorStdoutWrite = process.stdout.write.bind(process.stdout);
let stdout = "";
process.stdout.write = (chunk) => {
  stdout += String(chunk);
  return true;
};
const receiptHashes = [];
const configs = {
  "root-provider": { adapter: "command", repository: "root" },
  "other-provider": { adapter: "command", repository: "other" },
  uncovered: { adapter: "command", repository: "root" }
};
const providerClaims = {
  global: [], "root-provider": [{ id: "c1" }],
  "other-provider": [{ id: "c2" }], uncovered: [{ id: "missing" }]
};
const providerCapabilities = {};
const providerReceiptPaths = {};
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
};
const compactList = (rows, limit) => rows.length <= limit ? rows : {
  count: rows.length, preview: rows.slice(0, limit), digest: stableHash(rows)
};

const surfaceContext = {
  root,
  canonicalChangedSurface: () => [
    { repositoryId: "root", path: "file.js" },
    { repositoryId: "root", path: "directory" },
    { repositoryId: "other", path: "missing.js" },
    { repositoryId: "other", path: "unreadable.js" }
  ],
  repositoryById: (_id, repositoryId) => repositories[repositoryId],
  pathExists: (path) => !path.endsWith("missing.js"),
  fileStat: (path) => {
    if (path.endsWith("unreadable.js")) throw new Error("permission denied");
    return { isDirectory: () => path.endsWith("directory") };
  },
  directoryHash: () => "directory-hash",
  fileDigest: () => "file-hash",
  stableHash,
  compactList
};
assert.equal(reviewSurfaceWorkspace(surfaceContext, "change", {
  workspace: { path: "/root-workspace" }
}, "root"), "/root-workspace");
assert.equal(reviewSurfaceWorkspace(surfaceContext, "change", {
  repositories: { other: { path: "/other-workspace" } }
}, "other"), "/other-workspace");
assert.equal(reviewSurfaceWorkspace(surfaceContext, "change", {}, "other"),
  repositories.other.workspacePath);
const projectedSurface = reviewSurfaceRows(surfaceContext, "change", {
  workspace: { path: root }, repositories: { other: { path: repositories.other.workspacePath } }
});
assert.deepEqual(projectedSurface.map((row) => row.identity),
  ["file-hash", "directory-hash", "deleted", "unreadable"]);
const smallSurface = reviewChangedSurface(surfaceContext, "change", {
  workspace: { path: root, baseHead: "root-base" },
  repositories: { other: { path: repositories.other.workspacePath, baseHead: "other-base" } }
}, projectedSurface);
assert.equal(smallSurface.paths.length, 4);
assert.equal(smallSurface.inspection[0].baseHead, "root-base");
assert.equal(smallSurface.inspection[1].baseHead, "other-base");
const currentSurface = reviewChangedSurface(surfaceContext, "change", {
  workspace: { mode: "current", path: root, baseHead: "root-base" }, repositories: {}
}, [{ repositoryId: "other", path: "src/current.js" }]);
assert.equal(currentSurface.inspection[0].baseHead, "selected-other",
  "review metadata must expose the same selected base used by changed-surface diffing");
const largeRows = Array.from({ length: 61 }, (_, index) => ({
  repositoryId: "root", path: `src/file-${index}.js`, kind: "code", identity: String(index)
}));
const largeSurface = reviewChangedSurface(surfaceContext, "change", {}, largeRows);
assert.equal(largeSurface.count, 61);
assert.equal(largeSurface.groups[0].prefix, "root/src");
assert.equal(largeSurface.inspection[0].paths.length, 20);
assert.equal(largeSurface.inspection[0].truncated, true);

assert.equal(reviewArtifactValue({
  pathExists: () => false, fileStat: () => null,
  directoryHash: () => "unused", fileDigest: () => "unused"
}, root, "missing"), null);
assert.deepEqual(reviewArtifactValue({
  pathExists: () => true, fileStat: () => ({ isDirectory: () => false }),
  directoryHash: () => "directory", fileDigest: () => "file"
}, root, "proposal.md"), { relativePath: "proposal.md", sha256: "file" });
const artifacts = reviewContractArtifactValues((name) => name === "present"
  ? { relativePath: name, sha256: "digest" } : null, ["present", "missing"]);
assert.deepEqual(Object.keys(artifacts.contractArtifacts), ["present"]);
assert.equal(artifacts.manifest[0].identity, "digest");
mkdirSync(join(activePath, "specs", "nested"), { recursive: true });
writeFileSync(join(activePath, "specs", "nested", "spec.md"), "nested requirement\n");
const nestedArtifacts = reviewContractArtifactValues((name) => ({
  relativePath: name, sha256: name
}), ["specs"], activePath);
assert.deepEqual(nestedArtifacts.manifest.map((row) => row.path), ["specs/nested/spec.md"]);
assert.equal(nestedArtifacts.contractArtifacts.specs.relativePath, "specs");

const evidenceRows = reviewEvidenceRows({
  requiredProviders: () => ["test", "review", "receipt"],
  providerConfig: (_id, provider) => ({ capability: provider }),
  providerCapability: (_provider, config) => config.capability,
  receiptValidity: (_id, provider) => provider === "test"
    ? { validity: "fresh", status: "pass", receipt: {
      observed: "ok", artifacts: [{ path: "report.json" }], references: ["run"]
    } }
    : { validity: "stale" },
  receiptPath: (_id, provider) => `/receipts/${provider}.json`,
  pathExists: (path) => path.endsWith("receipt.json"),
  readJson: () => ({ status: "fail", observed: "saved receipt" })
}, "change", "hash");
assert.deepEqual(evidenceRows.map((row) => row.provider), ["test", "receipt"]);
assert.equal(evidenceRows[0].artifacts[0], "report.json");
assert.equal(evidenceRows[1].status, "fail");
assert.equal(evidenceRows[1].observed, "saved receipt");
assert.equal(priorReviewValue(null), null);
assert.deepEqual(priorReviewValue({}), {
  round: null, status: null, workspaceHash: null,
  observed: null, findings: null, scope: null
});
assert.deepEqual(priorReviewValue({
  status: "fail", workspaceHash: "hash", observed: "reviewed",
  review: { round: 2, findings: { unresolvedBlockers: 1 }, scope: ["src"] }
}), {
  round: 2, status: "fail", workspaceHash: "hash", observed: "reviewed",
  findings: { unresolvedBlockers: 1 }, scope: ["src"]
});

const runtime = createPacketRuntime({
  ROOT: root, PACKET_SCHEMA_VERSION: "4", REVIEW_PACKET_SCHEMA_VERSION: "1",
  leasesRoot, loadRuntime: () => state, foundationVersion: "1.0.0",
  installedCliVersion: "1.0.0", readJson, activeChangePath: () => activePath,
  canonicalChangedSurface: () => surface, evidence: () => contract,
  taskBlocks: () => tasks, taskMetadata: (task) => task,
  repositoryById: (_id, repositoryId) => repositories[repositoryId],
  claimsForProvider: (_id, provider) => providerClaims[provider] || [],
  relevantSnapshot: () => ({ workspaceHash: compositeHash }),
  snapshotPath: () => "snapshot", singleRelevantSnapshot: () => ({ workspaceHash: "repo-hash" }),
  requiredProviders: () => providers,
  receiptValidity: (_id, provider, hash) => {
    receiptHashes.push([provider, hash]);
    return { validity: "fresh", status: "pass" };
  },
  providerConfig: (_id, provider) => configs[provider] || null,
  adapterResources: (provider) => [`resource:${provider}`], stableHash,
  compactStrings: (values = [], limit) => values.slice(0, limit),
  providerRepositories: (_id, _provider, config) => config?.repository
    ? [repositories[config.repository]] : [repositories.root, repositories.other],
  modelForTask: () => ({ tier: "standard" }), compactList,
  fileDigest: (path) => `file:${basename(path)}`, directoryHash: () => "directory:specs",
  ensureBudgetState: () => ({ mode: "active" }), budgetDecision: () => ({ allowed: true }),
  scopedReviewClaims: (claims) => claims, relevantHash: () => "review-hash",
  providerCapability: (provider) => providerCapabilities[provider] || "test",
  receiptPath: (_id, provider) =>
    providerReceiptPaths[provider] || join(root, "missing-receipt.json"),
  contractFingerprint: () => "fingerprint", reviewPolicy: () => ({}),
  resolvedAcceptance: () => ({}), handoffReadiness: () => ({ status: "ready" }),
  deliveredAiAttempts: () => attempts, serializedJson: JSON.stringify,
  foundationPolicy: () => ({ execution: { packetBytes: packetLimits } }),
  recordContextMetric: (...args) => contextMetrics.push(args),
  recordInstructionManifest: () => instructionManifest,
  fail: (message) => { throw new Error(message); }
});

try {
  const global = runtime.packetValue("packet-test");
  assert.equal(global.packetType, "global");
  assert.equal(global.tasks.count, 3);
  assert.deepEqual(global.tasks.byRepository, [
    { repository: "other", count: 1 }, { repository: "root", count: 2 }
  ]);
  assert.equal(global.claims.length, 2);
  assert.equal(global.claims[0].scenario, undefined);
  assert.equal(global.references["proposal.md"].sha256, "file:proposal.md");
  assert.equal(global.references.specs.sha256, "directory:specs");
  assert.deepEqual(global.invariants, {
    count: 1, digest: stableHash(contract.invariants), reference: "evidence.yaml#invariants"
  });
  assert.equal(global.repairContext, undefined);
  assert.equal(global.authorityPreflight.status, "READY");

  state.riskBasedCiRequired = true;
  state.impact = "high";
  const authorityBlocked = runtime.packetValue("packet-test");
  assert.equal(authorityBlocked.authorityPreflight.status, "NEEDS_USER_DECISION");
  assert.equal(authorityBlocked.authorityPreflight.blockers[0].code,
    "SIGNED_CI_CONFIGURATION_REQUIRED");
  assert.match(authorityBlocked.authorityPreflight.blockers[0].next,
    /change validate packet-test/);
  state.riskBasedCiRequired = false;
  state.impact = "medium";

  receiptHashes.length = 0;
  const repository = runtime.packetValue("packet-test", "root");
  assert.equal(repository.packetType, "repository");
  assert.equal(repository.repository.id, "root");
  assert.deepEqual(repository.changedFiles, ["src/a.js", "docs/readme.md"]);
  assert.deepEqual(repository.claims.map((claim) => claim.id), ["c1"]);
  assert.equal(repository.claims[0].scenario, "root scenario");
  assert.equal(repository.providers.some((row) => row.provider === "other-provider"), false);
  assert.equal(repository.providers.some((row) => row.provider === "uncovered"), false);
  assert.equal(receiptHashes.find(([provider]) => provider === "global")[1], "composite-hash");
  assert.equal(receiptHashes.find(([provider]) => provider === "root-provider")[1], "repo-hash");

  const savedActivePath = activePath;
  const savedWorkspace = state.workspace;
  const savedRootWorkspace = repositories.root.workspacePath;
  const savedDependsOn = repositories.root.dependsOn;
  const savedRevision = state.revision;
  const savedContractRevision = state.contractRevision;
  const savedExecutionRevision = state.executionRevision;
  activePath = root;
  writeFileSync(join(root, "tasks.md"), "# Tasks\n");
  state.workspace = {};
  delete state.revision;
  delete state.contractRevision;
  delete state.executionRevision;
  delete repositories.root.workspacePath;
  delete repositories.root.dependsOn;
  compositeHash = null;
  const defaults = runtime.packetValue("packet-test", "root");
  assert.equal(defaults.revision, 0);
  assert.equal(defaults.contractRevision, 0);
  assert.equal(defaults.executionRevision, 0);
  assert.equal(defaults.changePath, ".");
  assert.deepEqual(defaults.repository.dependsOn, []);
  assert.equal(defaults.workspacePath, root);
  assert.equal(defaults.compositeWorkspaceHash, null);
  activePath = savedActivePath;
  state.workspace = savedWorkspace;
  state.revision = savedRevision;
  state.contractRevision = savedContractRevision;
  state.executionRevision = savedExecutionRevision;
  repositories.root.workspacePath = savedRootWorkspace;
  repositories.root.dependsOn = savedDependsOn;
  compositeHash = "composite-hash";

  const task = runtime.packetValue("packet-test", null, "t1");
  assert.equal(task.packetType, "task");
  assert.deepEqual(task.changedFiles, ["src/a.js"]);
  assert.equal(task.tasks[0].model.tier, "standard");
  assert.equal(task.executionAuthority.status, "unleased");
  assert.equal(task.workerContract.role, "leased-task-worker");
  assert.equal(task.authorityPreflight, undefined,
    "workers inherit the parent preflight instead of duplicating authority policy");

  const leasePath = join(leasesRoot, "tasks", "packet-test", "T1.json");
  mkdirSync(dirname(leasePath), { recursive: true });
  writeFileSync(leasePath, JSON.stringify({
    leaseId: "lease-1", graphRevision: 1, graphIdentity: "graph", planDigest: "plan",
    contractRevision: 3, workspaceHash: "repo-hash", fencingGeneration: 2,
    executionAttempt: 1, repository: "root", paths: ["src/**"], claimIds: ["c1"],
    outputSchema: "result-v1", expiresAt: "2099-01-01T00:00:00.000Z"
  }));
  assert.equal(runtime.packetValue("packet-test", null, "T1").executionAuthority.leaseId, "lease-1");
  writeFileSync(leasePath, JSON.stringify({ graphRevision: 1 }));
  assert.equal(runtime.packetValue("packet-test", null, "T1").executionAuthority.status, "unleased");

  state.workspace.mode = "worktree";
  stdout = "";
  assert.equal(runtime.showPacket("packet-test"), undefined);
  assert.equal(JSON.parse(stdout).packetType, "global");
  assert.equal(contextMetrics.at(-1)[1], "packet-global");
  assert.equal(contextMetrics.at(-1)[3].repositoryId, null);

  const savedContract = contract;
  const savedProviders = providers;
  contract = {
    claims: Array.from({ length: 41 }, (_, index) => ({
      id: `bulk-${index}`, scenario: `scenario ${index}`, capabilities: ["test"]
    })),
    invariants: []
  };
  providers = Array.from({ length: 31 }, (_, index) => `bulk-provider-${index}`);
  stdout = "";
  runtime.showPacket("packet-test");
  assert.equal(contextMetrics.at(-1)[3].claims, 41);
  assert.equal(contextMetrics.at(-1)[3].providers, 31);
  contract = savedContract;
  providers = savedProviders;

  delete state.workspace.mode;
  assert.throws(() => runtime.showPacket("packet-test", { phase: "build" }),
    /requires an isolated workspace/);
  state.workspace.mode = "copy";
  instructionManifest = {
    schemaVersion: 1, manifestDigest: "manifest-digest",
    execution: { requestedModel: "standard" }
  };
  stdout = "";
  runtime.showPacket("packet-test", {
    phase: "build", task: "T1", pretty: true,
    planDigest: "plan-digest", graphRevision: 2,
    graphIdentity: "graph-identity", graphNode: "T1"
  });
  const shownTask = JSON.parse(stdout);
  assert.equal(shownTask.instructionProvenance.manifestDigest, "manifest-digest");
  assert.equal(shownTask.planDigest, "plan-digest");
  assert.equal(shownTask.graphRevision, 2);
  assert.equal(shownTask.graphIdentity, "graph-identity");
  assert.equal(shownTask.graphNode, "T1");
  assert.equal(contextMetrics.at(-1)[3].taskId, "T1");
  instructionManifest = null;

  assert.throws(() => runtime.showPacket("packet-test", { phase: "review", task: "T1" }),
    /does not accept --task/);
  stdout = "";
  runtime.showPacket("packet-test", { phase: "review" });
  assert.equal(JSON.parse(stdout).packetType, "review");
  assert.equal(contextMetrics.at(-1)[1], "packet-review");

  const reviewProviders = providers;
  const reviewSurface = surface;
  providers = [...providers, "review-provider", "acceptance-provider"];
  providerCapabilities["review-provider"] = "review";
  providerCapabilities["acceptance-provider"] = "acceptance";
  providerReceiptPaths["review-provider"] = join(root, "review-receipt.json");
  writeFileSync(providerReceiptPaths["review-provider"], JSON.stringify({
    status: "fail", workspaceHash: "prior-hash", observed: "prior review",
    review: {
      round: 2, findings: { unresolvedBlockers: 1 }, scope: ["src/a.js"]
    }
  }));
  writeFileSync(join(activePath, "grounding.yaml"), JSON.stringify({
    decisionBatch: "decision-1", readSet: [{ path: "proposal.md" }], claims: ["c1"]
  }));
  surface = Array.from({ length: 61 }, (_, index) => ({
    repositoryId: "root", path: `src/review-${index}.js`
  }));
  const detailedReview = runtime.reviewPacketValue("packet-test");
  assert.equal(detailedReview.changedSurface.count, 61);
  assert.equal(detailedReview.changedSurface.inspection[0].truncated, true);
  assert.equal(detailedReview.grounding.decisionBatch, "decision-1");
  assert.equal(detailedReview.priorReview.round, 2);
  assert.equal(detailedReview.unresolvedFindings, 1);
  assert.equal(detailedReview.evidence.some((row) =>
    ["review-provider", "acceptance-provider"].includes(row.provider)), false);
  assert.ok(detailedReview.changedSurface.manifest.some((row) =>
    row.repositoryId === "contract" && row.path === "grounding.yaml"));
  providers = reviewProviders;
  surface = reviewSurface;

  const priorConsoleError = console.error;
  let warning = "";
  console.error = (message) => { warning += String(message); };
  packetLimits.review = 1;
  stdout = "";
  const summary = runtime.showPacket("packet-test", { phase: "review", pretty: true });
  assert.equal(summary.display.status, "truncated");
  assert.equal(JSON.parse(stdout).display.status, "truncated");
  assert.match(warning, /review packet display truncated/);
  assert.equal(contextMetrics.at(-1)[1], "packet-review-display");
  packetLimits.review = 1_000_000;
  console.error = priorConsoleError;

  packetLimits.global = 1;
  assert.throws(() => runtime.showPacket("packet-test"), /packet exceeds 1 bytes/);
  packetLimits.global = 1_000_000;

  attempts = [{
    resultStatus: "fail", attempt: 2, digest: "review-digest", workspaceHash: "repo-hash",
    findings: [
      { id: "F1", severity: "major", path: "src/a.js", message: "repair me", claimIds: ["c1"] },
      { id: "F2", severity: "blocker", path: null, message: "global blocker" },
      { id: "F3", severity: "minor", path: "src/a.js", message: "minor" },
      { id: "F4", severity: "major", path: "other/lib.js", message: "other repo" }
    ]
  }];
  const repair = runtime.packetValue("packet-test", "root").repairContext;
  assert.deepEqual(repair.findings.map((finding) => finding.id), ["F1", "F2"]);
  attempts = [{ resultStatus: "pass", findings: [] }];
  assert.equal(runtime.packetValue("packet-test").repairContext, undefined);
  attempts = [{ resultStatus: "fail", findings: [{ id: "F", severity: "minor" }] }];
  assert.equal(runtime.packetValue("packet-test").repairContext, undefined);

  surface = Array.from({ length: 55 }, (_, index) => ({
    repositoryId: "root", path: `src/group-${index % 2}/file-${index}.js`
  }));
  const compacted = runtime.packetValue("packet-test", null, "T1").changedFiles;
  assert.equal(compacted.count, 55);
  assert.equal(compacted.groups.length, 2);

  assert.throws(() => runtime.packetValue("packet-test", null, "missing"), /unknown task/);
  assert.throws(() => runtime.packetValue("packet-test", "other", "T1"), /not assigned/);
  tasks = [{ ...baseTasks[0], claims: ["unknown"] }];
  assert.throws(() => runtime.packetValue("packet-test", null, "T1"), /unknown claim/);
  tasks = [{ ...baseTasks[0], claims: [] }];
  contract = { claims: [], invariants: null };
  assert.throws(() => runtime.packetValue("packet-test", null, "T1"), /has no claims/);
  tasks = [{ ...baseTasks[2] }];
  assert.equal(runtime.packetValue("packet-test", null, "T3").claims.length, 0);

  tasks = [structuredClone(baseTasks[0])];
  contract = { claims: [structuredClone(contract.claims?.[0] || {
    id: "c1", scenario: "root scenario", capabilities: ["test"], repositories: ["root"]
  })], invariants: [] };
  providers = ["uncovered"];
  assert.throws(() => runtime.packetValue("packet-test", null, "T1"), /no provider coverage/);

  priorStdoutWrite("packet value tests: PASS\n");
} finally {
  process.stdout.write = priorStdoutWrite;
  rmSync(root, { recursive: true, force: true });
}
