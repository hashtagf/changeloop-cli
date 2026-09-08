import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { canonicalJson } from "../runtime/core/trust.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd, encoding: "utf8", stdio: options.stdio || ["ignore", "pipe", "pipe"]
  }).trim();
}

test("installed consumer records and invalidates signed semantic acceptance", () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-semantic-seam-"));
  const project = join(temp, "consumer");
  const envelopePath = join(temp, "semantic-envelope.json");
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
    writeFileSync(join(project, "subject.txt"), "stable behavior\n");
    writeFileSync(join(project, "subject.test.mjs"), `import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("CASE-BASE", () => assert.equal(readFileSync("subject.txt", "utf8"), "stable behavior\\n"));
`);
    run("git", ["add", "."], project);
    run("git", ["commit", "-qm", "seed"], project);
    run("node", [".claude/harness/foundation.mjs", "new",
      "Semantic acceptance seam", "--rapid"], project);

    const id = "semantic-acceptance-seam";
    const change = join(project, "openspec", "changes", id);
    writeFileSync(join(change, "proposal.md"), `# Rapid change: Semantic acceptance seam

## Why

Prove a signed semantic verdict at an installed consumer boundary.

## What Changes

- Record a content-bound semantic acceptance receipt.

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

- [x] **T001** Record signed verdict [claims:SEM-1] — verify: \`proof plan\`
`);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    writeFileSync(join(change, "evidence.yaml"), `${JSON.stringify({
      version: 2,
      claims: [{
        id: "SEM-1", scenario: "Fractional boundary is correct", impact: "medium",
        capabilities: ["test", "semantic-acceptance"]
      }]
    }, null, 2)}\n`);
    writeFileSync(join(change, "execution.yaml"), `${JSON.stringify({
      version: 1,
      providers: {
        test: {
          adapter: "command", capability: "test",
          command: ["sh", "-c",
            "printf 'TAP version 13\\nok 1 - CASE-BASE\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n'"],
          reportFormat: "tap", criticalCases: ["CASE-BASE"]
        },
        "hidden-semantic": {
          adapter: "external", capability: "semantic-acceptance",
          semanticAcceptance: { issuer: "fixture-hidden-oracle", publicKey: publicPem },
          acceptanceCases: [{
            id: "SEM-FRACTION", claimId: "SEM-1",
            partition: "fractional threshold", required: true,
            sourceProvider: "test", criticalCaseId: "CASE-BASE"
          }]
        }
      },
      services: {}
    }, null, 2)}\n`);

    const proofRun = spawnSync("node", [".claude/harness/foundation.mjs", "proof-collect", id], {
      cwd: project, encoding: "utf8"
    });
    assert.equal(proofRun.status, 0, proofRun.stderr || proofRun.stdout);
    const sourceReceiptPath = join(project, ".foundation", "receipts", id, "test.json");
    const sourceReceiptBefore = readFileSync(sourceReceiptPath, "utf8");
    assert.deepEqual(JSON.parse(sourceReceiptBefore).criticalCases,
      [{ id: "CASE-BASE", status: "pass" }]);

    const workspaceHash = run("node", [".claude/harness/foundation.mjs",
      "hash", id, "hidden-semantic"], project);
    const payload = {
      version: "1", changeId: id, provider: "hidden-semantic",
      workspaceHash, issuer: "fixture-hidden-oracle",
      cases: [{
        id: "SEM-FRACTION", claimId: "SEM-1", partition: "fractional threshold",
        status: "pass", observationDigest: "a".repeat(64)
      }]
    };
    const envelope = {
      version: "1", payload,
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey)
        .toString("base64")
    };
    writeFileSync(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
    run("node", [".claude/harness/foundation.mjs", "receipt", id,
      "hidden-semantic", "pass", "--envelope", envelopePath], project);
    assert.match(run("node", [".claude/harness/foundation.mjs", "proof-plan", id],
      project), /hidden-semantic: valid/);

    const receiptPath = join(project, ".foundation", "receipts", id,
      "hidden-semantic.json");
    const receiptBefore = readFileSync(receiptPath, "utf8");
    envelope.payload.cases[0].observationDigest = "b".repeat(64);
    writeFileSync(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
    const tampered = spawnSync("node", [".claude/harness/foundation.mjs", "receipt", id,
      "hidden-semantic", "pass", "--envelope", envelopePath], {
      cwd: project, encoding: "utf8"
    });
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /signature is invalid/);
    assert.equal(readFileSync(receiptPath, "utf8"), receiptBefore);

    const alteredSource = JSON.parse(sourceReceiptBefore);
    alteredSource.criticalCases[0].status = "fail";
    writeFileSync(sourceReceiptPath, `${JSON.stringify(alteredSource, null, 2)}\n`);
    assert.match(run("node", [".claude/harness/foundation.mjs", "proof-plan", id],
      project), /hidden-semantic: semantic-acceptance-invalid/);
    writeFileSync(sourceReceiptPath, sourceReceiptBefore);

    writeFileSync(join(project, "subject.txt"), "changed behavior\n");
    assert.match(run("node", [".claude/harness/foundation.mjs", "proof-plan", id],
      project), /hidden-semantic: stale/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
