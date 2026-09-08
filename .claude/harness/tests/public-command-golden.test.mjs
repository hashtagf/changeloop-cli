import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = JSON.parse(readFileSync(resolve(root,
  ".claude/harness/fixtures/public-command-contract-v1.json"), "utf8"));
const registry = JSON.parse(readFileSync(resolve(root,
  ".claude/harness/commands.json"), "utf8"));

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicCliRows() {
  return registry.commands.filter((row) => row.audience !== "internal")
    .map(({ name, usage, audience, kind, idempotent, deprecated = false }) => ({
      name, usage, audience, kind, idempotent, deprecated
    }));
}

test("golden fixture freezes every public host and CLI command contract", () => {
  assert.equal(fixture.protocol, "foundation-public-command-golden-v1");
  const described = JSON.parse(execFileSync("bash", ["./cli.sh", "describe", "--json"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, CLAUDE_FOUNDATION_PROJECT: root }
  }));
  const hostRows = described.filter((row) => row.surface === "host-command");
  const cliRows = publicCliRows();
  assert.equal(hostRows.length, fixture.hostCommands.count);
  assert.equal(cliRows.length, fixture.cliCommands.count);
  assert.equal(digest(hostRows), fixture.hostCommands.sha256);
  assert.equal(digest(cliRows), fixture.cliCommands.sha256);
});

test("every frozen public command retains a successful non-mutating help route", () => {
  for (const row of publicCliRows()) {
    const result = spawnSync("bash", ["./cli.sh", ...row.name.split(" "), "--help"], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, CLAUDE_FOUNDATION_PROJECT: root }
    });
    assert.equal(result.status, 0, `${row.name}: ${result.stderr || result.stdout}`);
    assert.ok(result.stdout.trim(), `${row.name}: empty help response`);
  }
});

test("golden corpus keeps durable coverage for public outcome categories", () => {
  assert.deepEqual(Object.keys(fixture.observableOutcomeCoverage).sort(), [
    "blockedDecision", "invalidFlags", "recoveryCommand", "resumableFailure",
    "stdoutStderrAndExitStatus", "successAndRuntimeFiles"
  ]);
  for (const path of Object.values(fixture.observableOutcomeCoverage))
    assert.equal(existsSync(resolve(root, path)), true, path);
});
