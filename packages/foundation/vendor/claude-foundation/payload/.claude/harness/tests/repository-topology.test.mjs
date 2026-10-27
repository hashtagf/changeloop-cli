import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";

import {
  assertCatalogDependencies,
  assertCatalogRepository,
  assertSelectedDependencies,
  buildRepositoryCatalog,
  createRepositoryTopology,
  mergeCatalogRepositories,
  normalizeCatalogRepositoryPath,
  normalizedSelectionEntry,
  normalizedCatalogRepository,
  parseDiscoveredSubmodules,
  compositeRepositorySelection,
  repositoryBaseHead,
  repositoryDisplayRow,
  repositoryDisplayState,
  selectRepositories,
  selectedRepository,
  selectedRepositoryRow,
  selectedRepositoryRuntimeIssue
} from "../runtime/workflow/repository-topology.mjs";
import { worktreeOwnedByTarget } from "../runtime/core/repository-binding.mjs";

const fail = (message) => { throw new Error(message); };

function fixture({
  git = () => ({ status: 0, stdout: "", stderr: "" }),
  gitHead = () => null
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-repository-source-"));
  const sandbox = join(root, ".foundation", "sandboxes", "change");
  const targetChange = join(root, "openspec", "changes", "change");
  const activeChange = join(sandbox, "openspec", "changes", "change");
  for (const path of [targetChange, activeChange, join(root, "child"), join(sandbox, "child")])
    mkdirSync(path, { recursive: true });
  writeFileSync(join(root, "openspec", "repositories.yaml"), JSON.stringify({
    version: 1,
    repositories: [{ id: "child", type: "git", path: "child", mode: "write" }]
  }));
  writeFileSync(join(targetChange, "repositories.yaml"), JSON.stringify({
    version: 1,
    repositories: [
      { id: "root", mode: "write" },
      { id: "child", mode: "write", dependsOn: ["root"] }
    ]
  }));
  writeFileSync(join(activeChange, "repositories.yaml"), JSON.stringify({
    version: 1,
    repositories: [{ id: "root", mode: "write" }]
  }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const state = {
    workspace: { mode: "worktree", path: sandbox },
    repositories: { child: { path: join(sandbox, "child") } }
  };
  const topology = createRepositoryTopology({
    root,
    slugify: (value) => value,
    readJson: (path) => JSON.parse(execFileSync("cat", [path], { encoding: "utf8" })),
    canonicalPath: (path) => resolve(path),
    pathInside: (parent, child) => {
      const rel = relative(parent, child);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    activeChangePath: () => activeChange,
    loadRuntime: () => state,
    git,
    gitHead,
    fail
  });
  return { root, sandbox, targetChange, activeChange, state, topology, fail };
}

test("repository selection follows the packet source without changing the default", () => {
  const f = fixture();
  try {
    const active = f.topology.selected("change", f.state);
    assert.deepEqual(active.map((row) => row.id), ["root"]);
    assert.equal(active[0].workspacePath, f.sandbox);

    const target = f.topology.selected("change", f.state, f.fail, {
      changeDir: f.targetChange,
      useTargetPaths: true
    });
    assert.deepEqual(target.map((row) => row.id), ["root", "child"]);
    assert.equal(target[0].workspacePath, f.root);
    assert.equal(target[1].workspacePath, join(f.root, "child"));
    assert.deepEqual(target[1].dependsOn, ["root"]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("worktree ownership is bound to the selected Git repository", () => {
  const root = workspacePath();
  try {
    const first = join(root, "first");
    const second = join(root, "second");
    const linked = join(root, "linked");
    for (const repository of [first, second]) {
      mkdirSync(repository);
      execFileSync("git", ["init", "-q"], { cwd: repository });
      execFileSync("git", ["config", "user.name", "Foundation Test"],
        { cwd: repository });
      execFileSync("git", ["config", "user.email", "foundation@example.invalid"],
        { cwd: repository });
      writeFileSync(join(repository, "tracked.txt"), "tracked\n");
      execFileSync("git", ["add", "tracked.txt"], { cwd: repository });
      execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repository });
    }
    execFileSync("git", ["worktree", "add", "--detach", linked, "HEAD"],
      { cwd: first });
    assert.equal(worktreeOwnedByTarget(linked, first), true);
    assert.equal(worktreeOwnedByTarget(linked, second), false);
    assert.equal(worktreeOwnedByTarget(join(root, "missing"), first), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selection entries and catalog lookup retain string and object forms", () => {
  const object = { id: "child", mode: "read" };
  assert.deepEqual(normalizedSelectionEntry("root"), { id: "root" });
  assert.equal(normalizedSelectionEntry(object), object);

  const catalogValue = { repositories: [{ id: "root" }] };
  assert.equal(selectedRepository(catalogValue, "change", { id: "root" }, fail).id,
    "root");
  assert.throws(() => selectedRepository(
    catalogValue, "change", { id: "missing" }, fail
  ), /references unknown repository 'missing'/);
});

test("selected repository rows preserve runtime and target path precedence", () => {
  const heads = [];
  const base = {
    repository: {
      id: "child", path: "/root/child", mode: "write", dependsOn: ["root"]
    },
    entry: { id: "child", mode: "read", dependsOn: [] },
    root: "/root",
    canonicalPath: (path) => `canonical:${path}`,
    gitHead: (path) => { heads.push(path); return "git-head"; }
  };
  const runtime = selectedRepositoryRow({
    ...base,
    state: { repositories: { child: { path: "/sandbox/child", baseHead: "base" } } },
    options: {}
  });
  assert.equal(runtime.mode, "read");
  assert.deepEqual(runtime.dependsOn, []);
  assert.equal(runtime.baseHead, "base");
  assert.equal(runtime.workspacePath, "canonical:/sandbox/child");
  assert.deepEqual(heads, []);

  const target = selectedRepositoryRow({ ...base, state: {}, options: { useTargetPaths: true } });
  assert.equal(target.baseHead, "git-head");
  assert.equal(target.workspacePath, "canonical:/root/child");
  assert.deepEqual(heads, ["/root/child"]);

  const rootRow = selectedRepositoryRow({
    ...base, repository: { id: "root", path: "/root" }, entry: { id: "root" },
    state: { workspace: { path: "/sandbox" } }, options: {}
  });
  assert.equal(rootRow.mode, undefined);
  assert.deepEqual(rootRow.dependsOn, []);
  assert.equal(rootRow.workspacePath, "canonical:/sandbox");

  const isolatedState = {
    workspace: { mode: "worktree", path: "/sandbox" }, repositories: {}
  };
  assert.match(selectedRepositoryRuntimeIssue({
    ...base, state: isolatedState, options: {}
  }), /missing repository 'child'/);
  const ownerRoot = workspacePath();
  const ownerPath = join(ownerRoot, ".foundation", "repository-sandboxes",
    "change", "child");
  mkdirSync(ownerPath, { recursive: true });
  try {
    assert.match(selectedRepositoryRuntimeIssue({
      repository: { ...base.repository, path: join(ownerRoot, "child") },
      entry: base.entry,
      root: ownerRoot,
      changeId: "change",
      canonicalPath: resolve,
      ownsWorktree: () => false,
      state: { workspace: { mode: "worktree" }, repositories: { child: {
        mode: "worktree", path: ownerPath,
        targetPath: join(ownerRoot, "child"), baseHead: "base", access: "read"
      } } },
      options: {}
    }), /not owned by its selected target/);
  } finally {
    rmSync(ownerRoot, { recursive: true, force: true });
  }
  assert.throws(() => selectedRepositoryRow({
    ...base, state: isolatedState, options: {}
  }), /missing repository 'child'/);
  assert.equal(selectedRepositoryRuntimeIssue({
    ...base,
    state: { workspace: { mode: "current" }, repositories: {} },
    options: {}
  }), null);
  assert.equal(repositoryBaseHead({ id: "child", baseHead: "selected" }, {
    workspace: { mode: "current" }, repositories: {}
  }), "selected");
  assert.equal(repositoryBaseHead({ id: "child", baseHead: "selected" }, isolatedState), null);
  assert.equal(compositeRepositorySelection([{ id: "root" }]), false);
  assert.equal(compositeRepositorySelection([{ id: "child" }]), true);
});

test("selection composition defaults to root and rejects duplicates and missing dependencies", () => {
  const repositories = [
    { id: "root", path: "/root", mode: "write", dependsOn: [] },
    { id: "child", path: "/root/child", mode: "write", dependsOn: ["root"] }
  ];
  const input = (selection) => ({
    id: "change", catalogValue: { repositories }, selection, state: {}, options: {},
    root: "/root", canonicalPath: (path) => path, gitHead: () => null,
    reportFailure: fail
  });
  assert.deepEqual(selectRepositories(input(null)).map((row) => row.id), ["root"]);
  assert.deepEqual(selectRepositories(input({ repositories: ["root", "child"] }))
    .map((row) => row.id), ["root", "child"]);
  assert.throws(() => selectRepositories(input({ repositories: ["root", "root"] })),
    /repeats 'root'/);
  assert.throws(() => selectRepositories(input({ repositories: ["child"] })),
    /must select dependency 'root'/);
});

test("dependency validation accepts complete selections and reports the first gap", () => {
  const complete = [
    { id: "root", dependsOn: [] }, { id: "child", dependsOn: ["root"] }
  ];
  assert.doesNotThrow(() => assertSelectedDependencies(complete, "change", fail));
  assert.throws(() => assertSelectedDependencies(
    [{ id: "child", dependsOn: ["missing"] }], "change", fail
  ), /must select dependency 'missing'/);
});

test("gitmodule parsing keeps complete sections and supported fields", () => {
  const rows = parseDiscoveredSubmodules(`ignored = before
[submodule "API Service"]
  path = services/api
  url = git@example/api.git
  branch = main
  ignored = value
[submodule "missing path"]
  url = git@example/missing.git
[submodule "web"]
  path = apps/web
`, (value) => value.toLowerCase().replaceAll(" ", "-"));
  assert.deepEqual(rows, [{
    id: "api-service", name: "API Service", type: "submodule",
    path: "services/api", url: "git@example/api.git", branch: "main"
  }, { id: "web", name: "web", type: "submodule", path: "apps/web" }]);
});

test("catalog merging and normalization preserve discovered metadata and defaults", () => {
  const discovered = [
    { id: "api", path: "services/api", type: "submodule", url: "git:api" },
    { id: "web", path: "apps/web", type: "submodule" }
  ];
  const configured = { repositories: [
    { id: "api-custom", path: "services/api", mode: "read" },
    { id: "web", path: "elsewhere" },
    { id: "docs", path: "docs" }
  ] };
  const result = mergeCatalogRepositories(configured, discovered);
  assert.deepEqual(result.merged.map((row) => row.id), ["api-custom", "web", "docs"]);
  assert.equal(result.merged[0].url, "git:api");
  assert.equal(result.merged[0].mode, "read");

  assert.deepEqual(normalizedCatalogRepository(
    { path: "services/api" }, discovered, fail
  ), {
    id: "api", path: "services/api", type: "submodule", url: "git:api",
    mode: "write", dependsOn: []
  });
  assert.deepEqual(normalizedCatalogRepository(
    { id: "docs", path: "docs", type: "external", dependsOn: ["root"] },
    discovered, fail
  ), {
    id: "docs", path: "docs", type: "external", mode: "write", dependsOn: ["root"]
  });
  assert.throws(() => normalizedCatalogRepository(null, discovered, fail),
    /entries must be objects/);
});

test("catalog entry validation rejects each malformed identity and policy field", () => {
  const valid = { id: "api", type: "git", mode: "write", dependsOn: [] };
  assert.doesNotThrow(() => assertCatalogRepository(valid, new Set(), fail));
  const invalid = [
    [{ ...valid, id: "Bad" }, /invalid repository id/],
    [valid, /duplicate repository id/, new Set(["api"])],
    [{ ...valid, type: "other" }, /invalid type/],
    [{ ...valid, mode: "other" }, /mode must be/],
    [{ ...valid, dependsOn: "root" }, /dependsOn must be an array/],
    [{ ...valid, dependsOn: [1] }, /dependsOn must be an array/],
    [{ ...valid, setupCommand: "" }, /setupCommand must be/],
    [{ ...valid, setupCommand: 1 }, /setupCommand must be/]
  ];
  for (const [row, pattern, ids = new Set()] of invalid)
    assert.throws(() => assertCatalogRepository(row, ids, fail), pattern);
  assert.doesNotThrow(() => assertCatalogRepository(
    { ...valid, setupCommand: null }, new Set(), fail));
  assert.doesNotThrow(() => assertCatalogRepository(
    { ...valid, setupCommand: "npm ci" }, new Set(), fail));
});

test("catalog paths and dependencies enforce containment and uniqueness", () => {
  const root = "/control";
  const inside = (parent, child) => child === parent || child.startsWith(`${parent}/`);
  const first = { id: "api", path: "api" };
  const paths = new Set();
  normalizeCatalogRepositoryPath(first, paths, root, resolve, inside, fail);
  assert.equal(first.path, "/control/api");
  assert.equal(first.relativePath, "api");
  assert.throws(() => normalizeCatalogRepositoryPath(
    { id: "copy", path: "api" }, paths, root, resolve, inside, fail
  ), /duplicate repository path 'api'/);
  assert.throws(() => normalizeCatalogRepositoryPath(
    { id: "outside", path: "../outside" }, new Set(), root, resolve, inside, fail
  ), /path escapes the control root/);
  const trusted = { id: "trusted", path: "../trusted", allowOutsideRoot: true };
  normalizeCatalogRepositoryPath(trusted, new Set(), root, resolve, inside, fail);
  assert.equal(trusted.path, "/trusted");

  const ids = new Set(["root", "api"]);
  assert.doesNotThrow(() => assertCatalogDependencies([
    { id: "api", dependsOn: ["root"] }
  ], ids, fail));
  assert.throws(() => assertCatalogDependencies([
    { id: "api", dependsOn: ["missing"] }
  ], ids, fail), /depends on unknown repository 'missing'/);
});

test("repository catalog builds merged rows and reports unconfigured submodule drift", () => {
  const result = buildRepositoryCatalog({
    root: "/control",
    configured: { version: 1, repositories: [
      { id: "api", path: "api", dependsOn: ["root"] },
      { id: "docs", path: "docs", type: "external", mode: "read" }
    ] },
    discovered: [
      { id: "api", path: "api", type: "submodule" },
      { id: "web", path: "web", type: "submodule" }
    ],
    canonicalPath: resolve,
    pathInside: (parent, child) => child === parent || child.startsWith(`${parent}/`),
    fail
  });
  assert.deepEqual(result.repositories.map((row) => row.id), ["root", "api", "web", "docs"]);
  assert.deepEqual(result.drift.map((row) => row.id), ["web"]);
  assert.equal(result.repositories[1].type, "submodule");
});

test("repository display helpers distinguish filesystem, git, and selection states", () => {
  const root = workspacePath();
  try {
    assert.equal(repositoryDisplayState(join(root, "missing"), null, null), "missing");
    assert.equal(repositoryDisplayState(root, null, null), "not-git");
    assert.equal(repositoryDisplayState(root, "abcdef", { stdout: " M file" }), "dirty");
    assert.equal(repositoryDisplayState(root, "abcdef", { stdout: "" }), "clean");
    const repo = { id: "api", type: "git", relativePath: "api" };
    assert.equal(repositoryDisplayRow(repo, "1234567890abcdef", "clean", new Set(["api"])),
      "api\tgit\tapi\tclean\t1234567890ab\tselected");
    assert.match(repositoryDisplayRow(repo, null, "not-git", new Set()), /excluded$/);
    assert.equal(repositoryDisplayRow(repo, null, "not-git", null),
      "api\tgit\tapi\tnot-git\t-");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function workspacePath() {
  return mkdtempSync(join(tmpdir(), "foundation-repository-display-"));
}

test("topology public methods cover discovery, selections, lookup, and display", () => {
  const f = fixture();
  const priorLog = console.log;
  const priorError = console.error;
  const logs = [];
  const errors = [];
  console.log = (value) => logs.push(String(value));
  console.error = (value) => errors.push(String(value));
  try {
    assert.deepEqual(f.topology.discoveredSubmodules(), []);
    writeFileSync(join(f.root, ".gitmodules"), `
[submodule "extra"]
  path = extra
`);
    mkdirSync(join(f.root, "extra"));
    assert.equal(f.topology.discoveredSubmodules()[0].id, "extra");
    assert.deepEqual(f.topology.changeSelection("change").repositories,
      [{ id: "root", mode: "write" }]);
    assert.deepEqual(f.topology.selectionIdsAt(f.targetChange), ["child", "root"]);
    assert.deepEqual(f.topology.selectionIdsAt(join(f.root, "absent")), ["root"]);
    assert.equal(f.topology.byId("change", "root", f.state).id, "root");
    assert.throws(() => f.topology.byId("change", "child", f.state),
      /does not select repository 'child'/);
    const catalog = f.topology.catalog();
    assert.deepEqual(catalog.drift.map((row) => row.id), ["extra"]);
    f.topology.show("change");
    assert.equal(logs.some((row) => row.includes("root\troot\t.\tnot-git")), true);
    assert.equal(logs.some((row) => row.endsWith("excluded")), true);
    assert.match(errors[0], /unregistered submodule 'extra'/);

    f.topology.show();
    assert.equal(logs.some((row) => row === "root\troot\t.\tnot-git\t-"), true);

    const catalogPath = join(f.root, "openspec", "repositories.yaml");
    writeFileSync(catalogPath, "{\"version\":2,\"repositories\":[]}");
    assert.throws(() => f.topology.catalog(), /requires version 1/);
    writeFileSync(catalogPath, "{\"version\":1,\"repositories\":{}}");
    assert.throws(() => f.topology.catalog(), /requires version 1/);
    unlinkSync(catalogPath);
    assert.deepEqual(f.topology.catalog().repositories.map((row) => row.id), ["root", "extra"]);

    writeFileSync(join(f.activeChange, "repositories.yaml"), "{\"version\":1,\"repositories\":[]}");
    assert.throws(() => f.topology.changeSelection("change"), /non-empty repositories array/);
    writeFileSync(join(f.activeChange, "repositories.yaml"), "{\"version\":2,\"repositories\":[]}");
    assert.throws(() => f.topology.selectionIdsAt(f.activeChange), /requires version 1/);
  } finally {
    console.log = priorLog;
    console.error = priorError;
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("topology display queries git only for repositories with heads", () => {
  const statuses = [];
  const f = fixture({
    gitHead: (path) => path.endsWith("child") ? "1234567890abcdef" : "abcdef1234567890",
    git: (args, path) => {
      statuses.push([args, path]);
      return { stdout: path.endsWith("child") ? " M file" : "" };
    }
  });
  const priorLog = console.log;
  const logs = [];
  console.log = (value) => logs.push(String(value));
  try {
    f.topology.show();
    assert.equal(logs.some((row) => row.includes("root\troot\t.\tclean")), true);
    assert.equal(logs.some((row) => row.includes("child\tgit\tchild\tdirty")), true);
    assert.equal(statuses.length, 2);
    rmSync(join(f.root, "child"), { recursive: true, force: true });
    logs.length = 0;
    f.topology.show();
    assert.equal(logs.some((row) => row.includes("child\tgit\tchild\tmissing")), true);
  } finally {
    console.log = priorLog;
    rmSync(f.root, { recursive: true, force: true });
  }
});
