import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
}).trim();

test("installed consumer activates npm lockfile consistency without provider wiring", () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-npm-lock-auto-"));
  const project = join(temp, "consumer");
  mkdirSync(project, { recursive: true });
  try {
    run("git", ["init", "-q"], project);
    run("git", ["config", "user.email", "fixture@example.test"], project);
    run("git", ["config", "user.name", "Fixture"], project);
    run("bash", [join(sourceRoot, "install.sh"), project,
      "--source", sourceRoot, "--yes"], sourceRoot);
    const policyPath = join(project, "foundation.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.workflow.grounding = "optional";
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    writeFileSync(join(project, "package.json"),
      '{"name":"lock-auto","version":"1.0.0","dependencies":{"local-dep":"file:./local-dep"}}\n');
    mkdirSync(join(project, "local-dep"));
    writeFileSync(join(project, "local-dep/package.json"),
      '{"name":"local-dep","version":"1.0.0"}\n');
    writeFileSync(join(project, "package-lock.json"), `${JSON.stringify({
      name: "lock-auto", version: "1.0.0", lockfileVersion: 3,
      packages: { "": { name: "lock-auto", version: "1.0.0",
        dependencies: { "local-dep": "file:./local-dep" } } }
    }, null, 2)}\n`);
    run("npm", ["install", "--package-lock-only", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], project);
    run("git", ["add", "."], project);
    run("git", ["commit", "-qm", "seed"], project);
    run("node", [".claude/harness/foundation.mjs", "new",
      "Npm lockfile automatic gate", "--rapid"], project);

    const id = "npm-lockfile-automatic-gate";
    const change = join(project, "openspec", "changes", id);
    writeFileSync(join(change, "proposal.md"), `# Rapid change: npm lockfile automatic gate

## Why

Keep the npm manifest and lockfile reproducible.

## What Changes

- Update package metadata and its lockfile together.

## Eligibility

- **Impact:** low
- **Coupling:** isolated
- **Public contract:** no
- **Persistent migration:** no
- **Security trigger:** no
- **Irreversible effect:** no
`);
    writeFileSync(join(change, "tasks.md"), `# Tasks

> This is the sole implementation ledger.

- [x] **T001** Update dependency metadata [claims:LOCK-1] — verify: \`npm lock check\`
`);
    writeFileSync(join(change, "evidence.yaml"), `${JSON.stringify({
      version: 2,
      claims: [{
        id: "LOCK-1", scenario: "npm manifest and lockfile agree", impact: "low",
        capabilities: ["dependency-supply-chain"]
      }]
    }, null, 2)}\n`);
    writeFileSync(join(change, "execution.yaml"),
      '{"version":1,"providers":{},"services":{}}\n');

    const manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
    manifest.version = "1.1.0";
    writeFileSync(join(project, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const failed = spawnSync("node", [".claude/harness/foundation.mjs", "proof-collect", id], {
      cwd: project, encoding: "utf8"
    });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /PROVIDER dependency-supply-chain: fail/);

    const lock = JSON.parse(readFileSync(join(project, "package-lock.json"), "utf8"));
    lock.version = "1.1.0";
    lock.packages[""].version = "1.1.0";
    writeFileSync(join(project, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    const passed = spawnSync("node", [".claude/harness/foundation.mjs", "proof-collect", id], {
      cwd: project, encoding: "utf8"
    });
    assert.equal(passed.status, 0, passed.stderr || passed.stdout);
    const receipt = JSON.parse(readFileSync(join(project, ".foundation", "receipts",
      id, "dependency-supply-chain.json"), "utf8"));
    assert.equal(receipt.status, "pass");
    assert.match(receipt.observed, /exit 0/);
    lock.packages = { "": lock.packages[""] };
    writeFileSync(join(project, "package-lock.json"), `${JSON.stringify(lock)}\n`);
    const missingGraph = spawnSync("node", [".claude/harness/foundation.mjs", "proof-collect", id], {
      cwd: project, encoding: "utf8"
    });
    assert.notEqual(missingGraph.status, 0, missingGraph.stdout);
    assert.match(missingGraph.stderr, /PROVIDER dependency-supply-chain: fail/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
