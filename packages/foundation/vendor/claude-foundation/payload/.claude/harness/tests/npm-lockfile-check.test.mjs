import assert from "node:assert/strict";
import test from "node:test";

import { npmLockfileConsistency, checkNpmWorkspace } from "../runtime/evidence/npm-lockfile-check.mjs";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("npm lockfile consistency accepts a synchronized root package", () => {
  assert.deepEqual(npmLockfileConsistency({
    name: "demo", version: "1.0.0", dependencies: { alpha: "^1.0.0" }
  }, {
    lockfileVersion: 3,
    packages: { "": { name: "demo", version: "1.0.0", dependencies: { alpha: "^1.0.0" } } }
  }), []);
});

test("npm lockfile consistency rejects stale identity and dependencies", () => {
  const issues = npmLockfileConsistency({
    name: "new-name", private: true, devDependencies: { beta: "2.0.0" }
  }, {
    lockfileVersion: 3,
    packages: { "": { name: "old-name", devDependencies: { stale: "1.0.0" } } }
  });
  assert.ok(issues.some((issue) => issue.includes("package name")));
  assert.ok(issues.some((issue) => issue.includes("devDependencies.beta")));
  assert.ok(issues.some((issue) => issue.includes("devDependencies.stale")));
});

test("install-plan validation catches missing graph entries without mutating the project", () => {
  const root = mkdtempSync(join(tmpdir(), "lock-plan-"));
  try {
    mkdirSync(join(root, "local"));
    writeFileSync(join(root, "local/package.json"), JSON.stringify({ name: "local-dep", version: "1.0.0" }));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0",
      dependencies: { "local-dep": "file:./local" }, scripts: { preinstall: "touch script-ran" } }));
    execFileSync("npm", ["install", "--package-lock-only", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, stdio: "pipe" });
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules/sentinel"), "keep");
    const before = readFileSync(join(root, "package-lock.json"), "utf8");
    assert.equal(checkNpmWorkspace(root).status, "pass");
    assert.equal(readFileSync(join(root, "package-lock.json"), "utf8"), before);
    assert.equal(readFileSync(join(root, "node_modules/sentinel"), "utf8"), "keep");
    assert.equal(existsSync(join(root, "script-ran")), false);
    const lock = JSON.parse(before);
    lock.packages = { "": lock.packages[""] };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
    assert.equal(checkNpmWorkspace(root).status, "fail");
    for (const result of [{ status: null, error: new Error("npm unavailable") },
      { status: 1, stderr: "npm error code ENOTCACHED" }]) {
      assert.equal(checkNpmWorkspace(root, { spawn: () => result }).status, "error");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
