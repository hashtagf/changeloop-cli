import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addChangedSurfaceSource,
  changedSurfaceRows,
  createChangePolicy,
  repositoryBaseHead,
  sortChangedSurface
} from "../runtime/workflow/change-policy.mjs";

test("changed-surface helpers normalize, exclude, merge and sort rows", () => {
  const sources = new Map();
  const add = (path, source, repositoryId = "root") => addChangedSurfaceSource({
    sources, path, source, repositoryId, changeId: "c",
    excludedWorkspaceDirs: new Set([".foundation"]),
    isCurrentChangePath: (candidate) => candidate === "changes/c/state.json"
  });
  add("", "dirty");
  add(".foundation/cache", "dirty");
  add("changes/c/state.json", "dirty");
  add("openspec/changes/c/tasks.md", "dirty");
  add("src\\index.js", "dirty");
  add("src/index.js", "committed");
  assert.deepEqual(changedSurfaceRows("root", sources), [{
    repositoryId: "root", path: "src/index.js", sources: ["committed", "dirty"]
  }]);
  assert.deepEqual(sortChangedSurface([
    { repositoryId: "root", path: "z" },
    { repositoryId: "api", path: "z" },
    { repositoryId: "root", path: "a" }
  ]).map((row) => `${row.repositoryId}/${row.path}`), ["api/z", "root/a", "root/z"]);
  assert.equal(repositoryBaseHead({ id: "root" }, {
    repositories: { root: { baseHead: "repo-base" } }, workspace: { baseHead: "workspace-base" }
  }), "repo-base");
  assert.equal(repositoryBaseHead({ id: "root" }, { workspace: { baseHead: "workspace-base" } }),
    "workspace-base");
  assert.equal(repositoryBaseHead({ id: "root", baseHead: "selected-base" }, {
    workspace: { mode: "current" }, repositories: {}
  }), null);
  assert.equal(repositoryBaseHead({ id: "api", baseHead: "selected-base" }, {
    workspace: { mode: "current" }, repositories: {}
  }), "selected-base");
  assert.equal(repositoryBaseHead({ id: "api", baseHead: "selected-base" }, {
    workspace: { mode: "worktree" }, repositories: { api: { baseHead: "sandbox-base" } }
  }), "sandbox-base");
  assert.equal(repositoryBaseHead({ id: "api", baseHead: "selected-base" }, {
    workspace: { mode: "worktree" }, repositories: {}
  }), null);
  assert.equal(repositoryBaseHead({ id: "api" }, { repositories: {} }), null);
});

function policyFixture({ heads, diffStatus = 0, workspaceManifest = () => ({}) }) {
  const state = {
    workspace: { path: "/root", baseHead: "base-root" },
    repositories: { api: { baseHead: "head-api" } }
  };
  const repositories = [
    { id: "root", workspacePath: "/root" },
    { id: "api", workspacePath: "/api" }
  ];
  const policy = createChangePolicy({
    root: "/root", excludedWorkspaceDirs: new Set([".foundation"]), providers: {},
    gitHead: (workspace) => heads[workspace] || null,
    git: (args, workspace) => {
      if (args[0] === "diff")
        return { status: diffStatus, stdout: "src/both.js\0src/committed.js\0" };
      return { status: 0, stdout: workspace === "/root" ? "dirty-root" : "dirty-api" };
    },
    porcelainStatusRecords: (output) => output === "dirty-root"
      ? [
          { path: "src\\dirty.js" }, { path: ".foundation/cache" },
          { path: "openspec/changes/c/tasks.md" }, { path: "src/both.js" }
        ]
      : [{ path: "lib/api.js", origPath: "lib/old-api.js" }],
    workspaceManifest, loadRuntime: () => state,
    selectedRepositories: () => repositories,
    isCurrentChangePath: () => false,
    readJson: () => ({}), fileDigest: () => "digest",
    fail: (message) => { throw new Error(message); }
  });
  return { policy, state };
}

test("canonicalChangedSurface combines committed and dirty repository paths", () => {
  const { policy } = policyFixture({ heads: { "/root": "head-root", "/api": "head-api" } });
  assert.deepEqual(policy.canonicalChangedSurface("c"), [
    { repositoryId: "api", path: "lib/api.js", sources: ["dirty"] },
    { repositoryId: "api", path: "lib/old-api.js", sources: ["dirty"] },
    { repositoryId: "root", path: "src/both.js", sources: ["committed", "dirty"] },
    { repositoryId: "root", path: "src/committed.js", sources: ["committed"] },
    { repositoryId: "root", path: "src/dirty.js", sources: ["dirty"] }
  ]);
});

test("canonicalChangedSurface rejects missing and unreadable base comparisons", () => {
  const missing = policyFixture({ heads: { "/root": "head-root", "/api": "head-api" } });
  missing.state.workspace.baseHead = null;
  assert.throws(() => missing.policy.canonicalChangedSurface("c", missing.state), /missing baseHead/);
  const unreadable = policyFixture({
    heads: { "/root": "head-root", "/api": "head-api" }, diffStatus: 1
  });
  assert.throws(() => unreadable.policy.canonicalChangedSurface("c"), /from base base-root/);
});

test("canonicalChangedSurface compares manifests for a headless root copy", () => {
  const { policy, state } = policyFixture({
    heads: {}, workspaceManifest: () => ({ "same.js": "a", "new.js": "b" })
  });
  state.workspace.mode = "copy";
  state.workspace.baseline = { "same.js": "a", "old.js": "c" };
  state.repositories = {};
  assert.deepEqual(policy.canonicalChangedSurface("c", state), [
    { repositoryId: "root", path: "new.js", sources: ["dirty"] },
    { repositoryId: "root", path: "old.js", sources: ["dirty"] }
  ]);
});

function capabilityPolicy({ root = "/root", rules = [], providers = [] } = {}) {
  return createChangePolicy({
    root,
    excludedWorkspaceDirs: new Set([".foundation"]),
    providers: new Set(providers),
    gitHead: () => null,
    git: () => ({ status: 0, stdout: "" }),
    porcelainStatusRecords: () => [],
    workspaceManifest: () => ({}),
    loadRuntime: () => ({ workspace: { path: root } }),
    selectedRepositories: () => [{ id: "root", workspacePath: root }],
    isCurrentChangePath: () => false,
    readJson: () => ({ rules }),
    fileDigest: () => "digest",
    fail: (message) => { throw new Error(message); }
  });
}

test("capability policy recognizes defaults, ignores packets, and validates custom rules", () => {
  const policy = capabilityPolicy({
    providers: ["review"],
    rules: [
      { paths: "src/", capabilities: ["review"] },
      { paths: ["ignored/"], capabilities: "review" },
      { paths: [42, "src/custom/**"], capabilities: ["review", "unknown"] },
      { paths: ["exact.txt"], capabilities: ["review"] }
    ]
  });
  const result = policy.capabilitiesForPaths([
    "openspec/changes/c/tasks.md",
    "root/openspec/changes/c/evidence.yaml",
    "package-lock.json",
    "db/migrations/001.sql",
    "ui/Button.tsx",
    "api/openapi.yaml",
    "src/auth/session.js",
    ".github/workflows/ci.yml",
    "src/custom/file.js",
    "exact.txt"
  ]);

  assert.deepEqual(result.capabilities, [
    "accessibility",
    "compatibility",
    "data-migration",
    "dependency-supply-chain",
    "deployment",
    "review",
    "security-static"
  ]);
  assert.deepEqual(result.triggers["dependency-supply-chain"], ["package-lock.json"]);
  assert.deepEqual(result.triggers.review, ["src/auth/session.js", "src/custom/file.js", "exact.txt"]);
  assert.equal(result.triggers.unknown, undefined);
});

test("committed consumer quality configuration activates static analysis for executable surfaces", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-consumer-quality-policy-"));
  try {
    mkdirSync(join(root, "quality"), { recursive: true });
    writeFileSync(join(root, "quality", "foundation-quality.json"), "{}\n");
    const policy = capabilityPolicy({ root });
    assert.deepEqual(policy.capabilitiesForPaths(["src/app.ts"]).capabilities,
      ["static-analysis"]);
    assert.deepEqual(policy.capabilitiesForPaths(["README.md"]).capabilities, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("forecast expands declared globs across files while respecting ignored trees", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src", "nested"), { recursive: true });
  mkdirSync(join(root, "src", "node_modules"), { recursive: true });
  mkdirSync(join(root, "src", ".git"), { recursive: true });
  writeFileSync(join(root, "src", "Button.tsx"), "export {};");
  writeFileSync(join(root, "src", "nested", "Dialog.test.tsx"), "export {};");
  writeFileSync(join(root, "src", "node_modules", "Hidden.tsx"), "export {};");
  writeFileSync(join(root, "src", ".git", "Hidden.tsx"), "export {};");

  const policy = capabilityPolicy({ root });
  const forecast = policy.forecastCapabilities([
    "",
    "./src/**/*.tsx",
    "src/?utton.tsx",
    "missing/**/*.tsx",
    "README.md"
  ]);

    assert.deepEqual(forecast.capabilities, ["accessibility"]);
  assert.equal(forecast.triggers.accessibility[0], "src/**/*.tsx");
});

test("surface resolvability distinguishes selection errors and missing repository bases", () => {
  const base = {
    root: "/root", excludedWorkspaceDirs: new Set(), providers: new Set(),
    git: () => ({ status: 0, stdout: "" }), porcelainStatusRecords: () => [],
    workspaceManifest: () => ({}), isCurrentChangePath: () => false,
    readJson: () => ({}), fileDigest: () => "digest",
    fail: (message) => { throw new Error(message); }
  };
  const throwing = createChangePolicy({
    ...base,
    gitHead: () => "head",
    loadRuntime: () => ({}),
    selectedRepositories: () => { throw new Error("selection failed"); }
  });
  assert.equal(throwing.changedSurfaceResolvable("c"), false);

  let state = { workspace: {}, repositories: {} };
  const repositories = [
    { id: "root", workspacePath: "/root" },
    { id: "copy", workspacePath: "/copy" },
    { id: "api", workspacePath: "/api" }
  ];
  const policy = createChangePolicy({
    ...base,
    gitHead: (workspace) => workspace === "/copy" ? null : "head",
    loadRuntime: () => state,
    selectedRepositories: () => repositories
  });
  assert.equal(policy.changedSurfaceResolvable("c"), false);
  state = {
    workspace: { mode: "current", baseHead: "root-base" }, repositories: {}
  };
  repositories[2].baseHead = "target-api";
  assert.equal(policy.changedSurfaceResolvable("c"), true);
  assert.deepEqual(policy.canonicalChangedSurface("c"), []);
  state.workspace.mode = "worktree";
  assert.equal(policy.changedSurfaceResolvable("c"), false);
  state = {
    workspace: { baseHead: "root-base" },
    repositories: { api: { baseHead: "api-base" } }
  };
  assert.equal(policy.changedSurfaceResolvable("c"), true);
  state = {
    workspace: {},
    repositories: { root: { baseHead: "root-base" }, api: { baseHead: "api-base" } }
  };
  assert.equal(policy.changedSurfaceResolvable("c"), true);
});

test("policy analysis caches results and exposes first capability trigger", () => {
  let loads = 0;
  const policy = createChangePolicy({
    root: "/root", excludedWorkspaceDirs: new Set(), providers: new Set(),
    gitHead: () => "head",
    git: (args) => args[0] === "diff"
      ? { status: 0, stdout: "src/auth/login.js\0" }
      : { status: 0, stdout: "" },
    porcelainStatusRecords: () => [], workspaceManifest: () => ({}),
    loadRuntime: () => {
      loads += 1;
      return { workspace: { baseHead: "base" }, repositories: {} };
    },
    selectedRepositories: () => [{ id: "root", workspacePath: "/root" }],
    isCurrentChangePath: () => false, readJson: () => ({}),
    fileDigest: () => "digest", fail: (message) => { throw new Error(message); }
  });

  assert.deepEqual(policy.policyCapabilities("c"), ["review", "security-static"]);
  assert.equal(policy.policyCapabilityTrigger("c", "review"), "root/src/auth/login.js");
  assert.equal(policy.policyCapabilityTrigger("c", "deployment"), null);
  assert.equal(loads, 1);
  policy.clearPolicyCache("c");
  policy.policyCapabilities("c");
  assert.equal(loads, 2);
  policy.clearPolicyCache();
  policy.policyCapabilities("c");
  assert.equal(loads, 3);
});

test("changed file discovery handles git failures, renames, copies, and headless workspaces", () => {
  let head = "head";
  let gitResult = { status: 0, stdout: "records" };
  let manifest = {};
  const policy = createChangePolicy({
    root: "/root", excludedWorkspaceDirs: new Set(), providers: new Set(),
    gitHead: () => head,
    git: () => gitResult,
    porcelainStatusRecords: () => [
      { path: "src/new.js", origPath: "src/old.js" },
      { path: "src/new.js" }
    ],
    workspaceManifest: () => manifest,
    loadRuntime: () => ({}), selectedRepositories: () => [],
    isCurrentChangePath: () => false, readJson: () => ({}),
    fileDigest: () => "digest", fail: (message) => { throw new Error(message); }
  });

  assert.deepEqual(policy.changedFilesInWorkspace("c", "/root"), [
    "src/new.js", "src/old.js"
  ]);
  assert.deepEqual(policy.changedFiles("c", { workspace: {} }), [
    "src/new.js", "src/old.js"
  ]);
  gitResult = { status: 1, stdout: "" };
  assert.deepEqual(policy.changedFilesInWorkspace("c", "/root", "head"), []);

  head = null;
  assert.deepEqual(policy.changedFilesInWorkspace("c", "/root"), []);
  manifest = { "same.js": "same", "new.js": "new" };
  assert.deepEqual(policy.changedFiles("c", {
    workspace: {
      path: "/copy", mode: "copy",
      baseline: { "fallback.js": "old" },
      sandboxBaseline: { "same.js": "same", "old.js": "old" }
    }
  }), ["new.js", "old.js"]);
  assert.deepEqual(policy.changedFiles("c", {
    workspace: { path: "/copy", mode: "reference", baseline: {} }
  }), []);
});
