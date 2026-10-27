import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scenarios = JSON.parse(readFileSync(resolve(root,
  ".claude/harness/fixtures/host-security-scenarios-v1.json"), "utf8"));
const capabilities = JSON.parse(readFileSync(resolve(root,
  ".claude/harness/adapters/host-capabilities.json"), "utf8"));
const authoritativeRunner = readFileSync(resolve(root, ".claude/tests/run-all.sh"), "utf8");

test("host security map covers every shipped host and required threat category", () => {
  assert.equal(scenarios.protocol, "foundation-host-security-scenarios-v1");
  assert.deepEqual([...scenarios.hosts].sort(), Object.keys(capabilities.hosts).sort());
  const categories = new Set(scenarios.scenarios.map((row) => row.category));
  for (const category of [
    "installed-host", "terminal-truth", "phase-isolation", "stale-proof",
    "explicit-land", "hostile-argument", "hostile-filename", "symlink", "path",
    "secret", "command-injection", "path-traversal"
  ]) assert.equal(categories.has(category), true, category);
});

test("every security scenario points to durable authoritative evidence", () => {
  const ids = new Set();
  for (const row of scenarios.scenarios) {
    assert.equal(ids.has(row.id), false, row.id);
    ids.add(row.id);
    assert.equal(existsSync(resolve(root, row.test)), true, row.test);
    const basename = row.test.split("/").at(-1);
    assert.match(authoritativeRunner, new RegExp(basename.replace(/[.*+?^${}()|[\]\\]/g,
      "\\$&")), `${row.id}: ${basename} is not registered in run-all`);
  }
});

test("host assurance never exceeds the installed live boundary", () => {
  for (const [host, row] of Object.entries(capabilities.hosts)) {
    const live = ["live", "runtime"].includes(row.liveMutationGuards.phase);
    if (live) {
      assert.match(row.workflowGuarantees.phaseIsolation, /live/, host);
      assert.equal(row.unattendedWrites.mode, "supported", host);
    } else {
      assert.equal(row.workflowGuarantees.phaseIsolation, "final-audit-only", host);
      assert.equal(row.unattendedWrites.mode, "blocked-without-equivalent-boundary", host);
    }
    assert.equal(row.workflowGuarantees.terminalTruth, "runtime-enforced", host);
    assert.equal(row.workflowGuarantees.staleProof, "runtime-enforced", host);
    assert.equal(row.workflowGuarantees.explicitLand, "runtime-enforced", host);
  }
});
