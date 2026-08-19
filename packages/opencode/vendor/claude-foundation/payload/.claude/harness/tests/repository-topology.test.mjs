import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";

import { createRepositoryTopology } from
  "../runtime/workflow/repository-topology.mjs";

function fixture() {
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
  const fail = (message) => { throw new Error(message); };
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
    git: () => ({ status: 0, stdout: "", stderr: "" }),
    gitHead: () => null,
    fail
  });
  return { root, sandbox, targetChange, state, topology, fail };
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
