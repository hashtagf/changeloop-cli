import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { canonicalJson } from "../runtime/core/trust.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tasksRoot = join(sourceRoot, ".claude/tests/bench/tasks");

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function oracle(task, project) {
  const output = run("sh", [join(tasksRoot, task, "oracle/run.sh"), project], sourceRoot);
  return { output, value: JSON.parse(output), digest: digest(output) };
}

function configureInstalledProject(project) {
  run("git", ["init", "-q"], project);
  run("git", ["config", "user.email", "fixture@example.test"], project);
  run("git", ["config", "user.name", "Fixture"], project);
  run("bash", [join(sourceRoot, "install.sh"), project,
    "--source", sourceRoot, "--yes"], sourceRoot);
  const policyPath = join(project, "foundation.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.workflow.grounding = "optional";
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  run("git", ["add", "."], project);
  run("git", ["commit", "-qm", "corrected portfolio fixture"], project);
}

function provePortfolioCase({ project, id, command, claimId, caseId, partition,
  before, after }) {
  run("node", [".claude/harness/foundation.mjs", "new", id, "--rapid"], project);
  const change = join(project, "openspec", "changes", id);
  writeFileSync(join(change, "proposal.md"), `# Rapid change: ${id}\n\n## Why\n\nBind the corrected portfolio behavior to Proof.\n\n## What Changes\n\n- Record a signed semantic FAIL-to-PASS result.\n\n## Eligibility\n\n- **Impact:** low\n- **Coupling:** isolated\n- **Public contract:** no\n- **Persistent migration:** no\n- **Security trigger:** no\n- **Irreversible effect:** no\n`);
  writeFileSync(join(change, "tasks.md"), `# Tasks\n\n> This is the sole implementation ledger.\n\n- [x] **T001** Bind portfolio acceptance [claims:${claimId}] — verify: \`proof plan\`\n`);
  writeFileSync(join(change, "evidence.yaml"), `${JSON.stringify({
    version: 2,
    claims: [{ id: claimId, scenario: partition, impact: "medium",
      capabilities: ["test", "semantic-acceptance"] }]
  }, null, 2)}\n`);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  writeFileSync(join(change, "execution.yaml"), `${JSON.stringify({
    version: 1,
    providers: {
      test: { adapter: "command", capability: "test", command },
      "portfolio-semantic": {
        adapter: "external", capability: "semantic-acceptance",
        semanticAcceptance: { issuer: "foundation-portfolio-oracle", publicKey: publicPem },
        acceptanceCases: [{ id: caseId, claimId, partition, required: true,
          requiresFailToPass: true }]
      }
    },
    services: {}
  }, null, 2)}\n`);

  const collected = spawnSync("node", [".claude/harness/foundation.mjs",
    "proof-collect", id], { cwd: project, encoding: "utf8" });
  assert.equal(collected.status, 0, collected.stderr || collected.stdout);
  const workspaceHash = run("node", [".claude/harness/foundation.mjs",
    "hash", id, "portfolio-semantic"], project);
  const payload = {
    version: "1", changeId: id, provider: "portfolio-semantic", workspaceHash,
    issuer: "foundation-portfolio-oracle",
    cases: [{
      id: caseId, claimId, partition, status: "pass",
      observationDigest: after.digest,
      transition: {
        beforeStatus: before.value.verdict, afterStatus: after.value.verdict,
        beforeDigest: before.digest, afterDigest: after.digest
      }
    }]
  };
  const envelope = {
    version: "1", payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64")
  };
  // Keep the handoff envelope outside the consumer workspace: writing it under
  // the project after hashing would correctly invalidate its own binding.
  const envelopePath = join(dirname(project), `${id}-semantic-envelope.json`);
  writeFileSync(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
  run("node", [".claude/harness/foundation.mjs", "receipt", id,
    "portfolio-semantic", "pass", "--envelope", envelopePath], project);
  const plan = run("node", [".claude/harness/foundation.mjs", "proof-plan", id], project);
  assert.match(plan, /portfolio-semantic: valid/);

  writeFileSync(join(project, ".portfolio-drift"), "changed after semantic acceptance\n");
  assert.match(run("node", [".claude/harness/foundation.mjs", "proof-plan", id], project),
    /portfolio-semantic: stale/);
}

test("recent-window mutant is bound to signed portfolio Proof evidence", () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-window-portfolio-"));
  const project = join(temp, "portfolio-recent-window");
  mkdirSync(project, { recursive: true });
  try {
    cpSync(join(tasksRoot, "11-recent-window/seed"), project, { recursive: true });
    const before = oracle("11-recent-window", project);
    assert.equal(before.value.verdict, "fail");
    const source = join(project, "window.js");
    writeFileSync(source, readFileSync(source, "utf8").replace(
      "return items.slice(-n);",
      "const count = Math.trunc(Number(n));\n  return count > 0 ? items.slice(-count) : [];"));
    writeFileSync(join(project, "window.test.js"), `const assert = require("node:assert/strict");\nconst test = require("node:test");\nconst { lastN } = require("./window");\ntest("CASE-FRACTION", () => {\n  assert.deepEqual(lastN(["a", "b"], 0), []);\n  assert.deepEqual(lastN(["a", "b"], -1), []);\n  assert.deepEqual(lastN(["a", "b"], 0.4), []);\n});\n`);
    const after = oracle("11-recent-window", project);
    assert.equal(after.value.verdict, "pass");
    configureInstalledProject(project);
    provePortfolioCase({ project, id: "portfolio-recent-window",
      command: ["node", "--test"], claimId: "WINDOW-BOUNDARY",
      caseId: "CASE-FRACTION", partition: "zero, negative, and fractional windows",
      before, after });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Python bool-as-int mutant is bound to signed portfolio Proof evidence", () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-python-portfolio-"));
  const project = join(temp, "portfolio-python-validation");
  mkdirSync(project, { recursive: true });
  try {
    cpSync(join(tasksRoot, "15-python-api-validation/seed"), project, { recursive: true });
    const before = oracle("15-python-api-validation", project);
    assert.equal(before.value.verdict, "fail");
    const source = join(project, "user_api.py");
    writeFileSync(source, readFileSync(source, "utf8").replace(
      "not isinstance(seat_count, int)", "type(seat_count) is not int"));
    const testPath = join(project, "tests/test_user_api.py");
    writeFileSync(testPath, `${readFileSync(testPath, "utf8")}\nclass WorkspaceBooleanBoundaryTests(unittest.TestCase):\n    def test_boolean_is_not_an_integer_seat_count(self):\n        self.assertIn("seat_count", validate_workspace({"seat_count": True}))\n        self.assertEqual(create_workspace({"seat_count": True})["status"], 422)\n`);
    const after = oracle("15-python-api-validation", project);
    assert.equal(after.value.verdict, "pass");
    configureInstalledProject(project);
    provePortfolioCase({ project, id: "portfolio-python-validation",
      command: ["python3", "-m", "unittest", "discover", "-s", "tests"],
      claimId: "PYTHON-BOOLEAN-BOUNDARY", caseId: "CASE-BOOLEAN-NOT-INTEGER",
      partition: "boolean seat_count representation", before, after });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
