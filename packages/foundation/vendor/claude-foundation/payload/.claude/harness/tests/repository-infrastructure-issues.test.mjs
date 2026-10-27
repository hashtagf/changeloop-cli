import assert from "node:assert/strict";
import {
  repositoryInfrastructureIssueRows,
  repositoryInfrastructureIssuesOperation,
  repositoryRuntimeState
} from "../runtime/evidence/proof-readiness.mjs";

const base = {
  provider: "test",
  repository: { id: "api", mode: "write", workspacePath: "/api" },
  runtime: { mode: "copy" },
  pathExists: () => true,
  git: () => ({ status: 0, stdout: "", stderr: "" })
};

assert.deepEqual(repositoryInfrastructureIssueRows(base), []);
assert.deepEqual(repositoryInfrastructureIssueRows({
  ...base,
  pathExists: () => false
}), ["provider 'test' repository 'api' workspace is missing"]);
assert.deepEqual(repositoryInfrastructureIssueRows({
  ...base,
  repository: { ...base.repository, mode: "read" },
  runtime: { mode: "reference", setup: { status: "failed" } }
}), [
  "provider 'test' repository 'api' is a live reference, not an isolated workspace",
  "provider 'test' repository 'api' setup failed"
]);
assert.deepEqual(repositoryInfrastructureIssueRows({
  ...base,
  repository: { ...base.repository, mode: "read" },
  runtime: { mode: "worktree" },
  git: (args, cwd) => {
    assert.deepEqual(args, ["status", "--porcelain"]);
    assert.equal(cwd, "/api");
    return { status: 0, stdout: " M src/a.js\n", stderr: "" };
  }
}), ["provider 'test' read-only repository 'api' changed: M src/a.js"]);
assert.deepEqual(repositoryInfrastructureIssueRows({
  ...base,
  repository: { ...base.repository, mode: "read" },
  runtime: { mode: "worktree" },
  git: () => ({ status: 1, stdout: "", stderr: "not a repository\n" })
}), ["provider 'test' read-only repository 'api' changed: not a repository"]);
assert.deepEqual(repositoryInfrastructureIssueRows({
  ...base,
  repository: { ...base.repository, mode: "read" },
  runtime: { mode: "worktree" },
  git: () => ({ status: 1, stdout: "", stderr: "" })
}), ["provider 'test' read-only repository 'api' changed: git status failed"]);

const state = {
  workspace: { mode: "reference" },
  repositories: { api: { mode: "worktree" } }
};
assert.equal(repositoryRuntimeState(state, { id: "api" }), state.repositories.api);
assert.equal(repositoryRuntimeState(state, { id: "root" }), state.workspace);
assert.deepEqual(repositoryRuntimeState(state, { id: "unknown" }), {});

let configured;
const issues = repositoryInfrastructureIssuesOperation({
  loadRuntime: () => state,
  requiredProviders: () => ["test", "duplicate", "missing"],
  providerConfig: (_id, provider) => provider === "test" ? { repository: "api" } : null,
  selectedRepositories: () => [],
  providerRepositories: (_id, provider, config) => {
    if (provider === "test") configured = config;
    if (provider === "missing") return [
      { id: "gone", mode: "write", workspacePath: "/gone" },
      { id: "gone", mode: "write", workspacePath: "/gone" }
    ];
    return [{
      id: provider === "duplicate" ? "root" : "api",
      mode: "read",
      workspacePath: provider === "duplicate" ? "/root" : "/api"
    }];
  },
  pathExists: (path) => path !== "/gone",
  git: () => ({ status: 0, stdout: "", stderr: "" }),
  gitHead: () => "head"
}, "c");
assert.deepEqual(configured, { repository: "api" });
assert.deepEqual(issues, [
  "provider 'duplicate' repository 'root' is a live reference, not an isolated workspace",
  "provider 'missing' repository 'gone' workspace is missing"
]);

const isolatedIssues = repositoryInfrastructureIssuesOperation({
  loadRuntime: () => ({
    workspace: { mode: "worktree", path: "/root", baseHead: "root-base" },
    repositories: {
      api: {
        mode: "worktree", path: "/api", targetPath: "/target/api",
        baseHead: "api-base", access: "write"
      }
    }
  }),
  requiredProviders: () => [],
  providerConfig: () => null,
  providerRepositories: () => [],
  selectedRepositories: () => [
    { id: "root", mode: "write", workspacePath: "/root" },
    { id: "api", mode: "write", workspacePath: "/api" }
  ],
  pathExists: (path) => path === "/root" || path === "/api",
  git: () => ({ status: 0, stdout: "", stderr: "" }),
  gitHead: (path) => path === "/api" ? null : "root-head"
}, "c");
assert.deepEqual(isolatedIssues,
  ["selected repository 'api' path is not a valid Git worktree"]);

const ownershipIssues = repositoryInfrastructureIssuesOperation({
  loadRuntime: () => ({
    workspace: { mode: "worktree", path: "/control-sandbox" },
    repositories: { api: {
      mode: "worktree",
      path: "/control/.foundation/repository-sandboxes/c/api",
      targetPath: "/target/api", baseHead: "base", access: "write"
    } }
  }),
  requiredProviders: () => [], providerConfig: () => null,
  providerRepositories: () => [],
  selectedRepositories: () => [{
    id: "api", path: "/target/api", mode: "write",
    workspacePath: "/target/api"
  }],
  pathExists: () => true,
  git: () => ({ status: 0, stdout: "", stderr: "" }),
  gitHead: () => "head",
  root: "/control",
  ownsWorktree: () => false
}, "c");
assert.deepEqual(ownershipIssues,
  ["selected repository 'api' worktree is not owned by its selected target"]);

const incompleteBindingIssues = repositoryInfrastructureIssuesOperation({
  loadRuntime: () => ({
    workspace: { mode: "worktree", path: "/control-sandbox" },
    repositories: { api: {
      mode: "worktree",
      path: "/control/.foundation/repository-sandboxes/c/api",
      targetPath: "/target/api", access: "write"
    } }
  }),
  requiredProviders: () => [], providerConfig: () => null,
  providerRepositories: () => [],
  selectedRepositories: () => [{
    id: "api", path: "/target/api", mode: "write",
    workspacePath: "/target/api"
  }],
  pathExists: () => true,
  git: () => ({ status: 0, stdout: "", stderr: "" }),
  gitHead: () => "head", root: "/control", ownsWorktree: () => true
}, "c");
assert.deepEqual(incompleteBindingIssues,
  ["selected repository 'api' isolated binding is missing baseHead"]);

const primaryBindingIssues = repositoryInfrastructureIssuesOperation({
  loadRuntime: () => ({
    workspace: { mode: "worktree", path: "/control-sandbox" },
    repositories: {}
  }),
  requiredProviders: () => ["test"], providerConfig: () => ({ repository: "api" }),
  providerRepositories: assert.fail,
  selectedRepositories: () => [{
    id: "api", path: "/target/api", mode: "write",
    workspacePath: "/target/api"
  }],
  pathExists: () => false,
  git: assert.fail, gitHead: assert.fail, root: "/control"
}, "c");
assert.deepEqual(primaryBindingIssues,
  ["selected repository 'api' isolated workspace is missing"]);
