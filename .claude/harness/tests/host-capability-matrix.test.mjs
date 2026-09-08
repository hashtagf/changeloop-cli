import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const harness = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(join(harness, "adapters",
  "host-capabilities.json"), "utf8"));

test("every shipped host declares typed workflow guarantees", () => {
  assert.equal(contract.version, 2);
  assert.deepEqual(Object.keys(contract.hosts).sort(),
    ["claude-code", "codex", "cursor", "opencode"]);
  for (const [host, row] of Object.entries(contract.hosts)) {
    assert.equal(row.nativeDispatch, "available", host);
    assert.ok(row.workflowGuarantees, host);
    assert.equal(row.workflowGuarantees.terminalTruth, "runtime-enforced", host);
    assert.equal(row.workflowGuarantees.staleProof, "runtime-enforced", host);
    assert.equal(row.workflowGuarantees.explicitLand, "runtime-enforced", host);
    assert.ok(row.unattendedWrites?.mode, host);
    assert.ok(row.unattendedWrites?.requires, host);
  }
});

test("hosts without live hooks never claim phase-isolation parity", () => {
  for (const host of ["cursor", "codex"]) {
    const row = contract.hosts[host];
    assert.equal(row.liveMutationGuards.phase, "unavailable");
    assert.equal(row.workflowGuarantees.phaseIsolation, "final-audit-only");
    assert.equal(row.unattendedWrites.mode, "blocked-without-equivalent-boundary");
  }
  assert.match(contract.hosts["claude-code"].workflowGuarantees.phaseIsolation,
    /live-hook/);
  assert.match(contract.hosts.opencode.workflowGuarantees.phaseIsolation,
    /live-plugin/);
});
