import assert from "node:assert/strict";
import test from "node:test";
import {
  collectProviderInputFiles,
  normalizedProviderInputPatterns,
  providerInputIdentityOperation,
  providerInputRoots,
  sortProviderInputFiles
} from "../runtime/evidence/evidence-contract.mjs";

function entry(name, kind = "file") {
  return {
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink"
  };
}

function matches(rel, pattern) {
  if (pattern.endsWith("/**"))
    return rel === pattern.slice(0, -3) || rel.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return rel.startsWith(prefix) && !rel.slice(prefix.length).includes("/");
  }
  return rel === pattern || rel.startsWith(`${pattern.replace(/\/$/, "")}/`);
}

test("input patterns normalize separators, leading dot slashes, duplicates, and order", () => {
  assert.deepEqual(normalizedProviderInputPatterns([
    ".\\src\\**", "./src/**", "api:openapi.yaml", "api:openapi.yaml"
  ]), ["api:openapi.yaml", "src/**"]);
  assert.deepEqual(normalizedProviderInputPatterns(), []);
});

test("input roots split global and repository-scoped patterns", () => {
  const roots = providerInputRoots({
    canonicalPath: (path) => path,
    repositoryById: (id, repositoryId) => {
      assert.equal(id, "change");
      return { workspacePath: `/${repositoryId}` };
    }
  }, "change", "/root", ["src/**", "api:openapi.yaml", "api:schemas/**"]);
  assert.deepEqual([...roots], [
    ["/root", ["src/**"]],
    ["/api", ["openapi.yaml", "schemas/**"]]
  ]);
});

test("file collection recurses, excludes machine directories, and includes symlinks", () => {
  const tree = new Map([
    ["/root", [
      entry("src", "directory"), entry("node_modules", "directory"),
      entry("README.md"), entry("pipe", "other")
    ]],
    ["/root/src", [entry("b.js"), entry("a.js", "symlink")]]
  ]);
  const files = [];
  collectProviderInputFiles({
    readDirectory: (path) => tree.get(path) || [],
    excludedDirectories: new Set(["node_modules"]),
    inputPatternMatches: matches,
    filesystemEntryIdentity: (path) => `identity:${path}`
  }, "/root", "/root", ["src/*"], null, files);
  assert.deepEqual(files, [
    { path: "src/b.js", identity: "identity:/root/src/b.js" },
    { path: "src/a.js", identity: "identity:/root/src/a.js" }
  ]);
});

test("file sorting uses stable codepoint order", () => {
  const files = [{ path: "z" }, { path: "A" }, { path: "a" }, { path: "B" }];
  assert.equal(sortProviderInputFiles(files), files);
  assert.deepEqual(files.map((row) => row.path), ["A", "B", "a", "z"]);
});

function baseContext(overrides = {}) {
  return {
    providerConfig: () => ({}),
    providerWorkspace: () => "/root",
    providerWorkspaceHash: () => "computed-global-hash",
    canonicalPath: (path) => path,
    repositoryById: (_id, repositoryId) => ({ workspacePath: `/${repositoryId}` }),
    repositoryLabel: (_id, path) => path.slice(1),
    pathExists: () => true,
    readDirectory: () => [],
    excludedDirectories: new Set(["node_modules", ".git"]),
    inputPatternMatches: matches,
    filesystemEntryIdentity: (path) => `identity:${path}`,
    stableHash: (value) => JSON.stringify(value),
    ...overrides
  };
}

test("global identity uses supplied run hash before computing workspace hash", () => {
  const context = baseContext({ providerWorkspaceHash: assert.fail });
  assert.deepEqual(providerInputIdentityOperation(context,
    "change", "test", {}, "run-hash"), {
    mode: "global",
    patterns: [],
    files: [],
    fingerprint: JSON.stringify({ mode: "global", workspaceHash: "run-hash" })
  });
  const computed = providerInputIdentityOperation(baseContext(), "change", "test", {});
  assert.match(computed.fingerprint, /computed-global-hash/);
});

test("declared identity binds root and labeled repository files", () => {
  const tree = new Map([
    ["/root", [entry("src", "directory")]],
    ["/root/src", [entry("z.js"), entry("A.js")]],
    ["/api", [entry("openapi.yaml"), entry("ignored.txt")]]
  ]);
  const config = {
    inputs: ["./src/**", "api:openapi.yaml", ".\\src\\**"]
  };
  const value = providerInputIdentityOperation(baseContext({
    readDirectory: (path) => tree.get(path) || []
  }), "change", "test", config);
  assert.equal(value.mode, "declared");
  assert.deepEqual(value.patterns, ["api:openapi.yaml", "src/**"]);
  assert.deepEqual(value.files, [
    { path: "api:openapi.yaml", identity: "identity:/api/openapi.yaml" },
    { path: "src/A.js", identity: "identity:/root/src/A.js" },
    { path: "src/z.js", identity: "identity:/root/src/z.js" }
  ]);
  assert.equal(value.fingerprint, JSON.stringify({
    mode: "declared", patterns: value.patterns, files: value.files
  }));
});

test("declared identity skips absent and empty roots without falling back global", () => {
  const value = providerInputIdentityOperation(baseContext({ pathExists: () => false }),
    "change", "test", { inputs: ["src/**"] });
  assert.equal(value.mode, "declared");
  assert.deepEqual(value.files, []);
});
