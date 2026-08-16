import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createChangeValidationRuntime } from "../runtime/workflow/change-validation.mjs";

const fixture = mkdtempSync(join(tmpdir(), "foundation-grounding-policy-"));
const packet = join(fixture, "change");
mkdirSync(packet, { recursive: true });
writeFileSync(join(fixture, "requirement.md"), "approved requirement\n");
writeFileSync(join(fixture, "production.mjs"), "export const behavior = true;\n");
writeFileSync(join(fixture, "production.test.mjs"), "// test topology\n");
writeFileSync(join(fixture, "wire.json"), "{}\n");
writeFileSync(join(fixture, "activation.mjs"), "export const enabled = true;\n");
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };
const state = { id: "change-a", groundingRequired: true, status: "change",
  intent: "bounded change", impact: "medium", coupling: "isolated" };
let contract = {
  claims: [{ id: "claim-a", impact: "medium", capabilities: ["test", "review"] }]
};
const valid = () => ({
  version: 1,
  decisionBatch: {
    status: "locked", source: "user-batch", reference: "decision:1",
    mode: "single-batch", lockedAt: "2026-08-13T00:00:00Z",
    decisions: [{ id: "d1", question: "scope?", answer: "bounded", source: "user-batch" }]
  },
  readSet: [
    { repository: "root", path: "requirement.md", role: "requirement", mode: "full", sha256: digest(join(fixture, "requirement.md")) },
    { repository: "root", path: "production.mjs", role: "production-path", mode: "full", sha256: digest(join(fixture, "production.mjs")) },
    { repository: "root", path: "production.test.mjs", role: "test-topology", mode: "full", sha256: digest(join(fixture, "production.test.mjs")) }
  ],
  claims: [{
    id: "claim-a",
    productionPath: [{ repository: "root", path: "production.mjs" }],
    failurePaths: [{ repository: "root", path: "production.mjs", failure: "negative branch" }],
    evidenceClass: ["test", "review"],
    testDoubleGap: "none"
  }],
  derivedFacts: []
});
const writeGrounding = (value) =>
  writeFileSync(join(packet, "grounding.yaml"), `${JSON.stringify(value, null, 2)}\n`);

try {
  const runtime = createChangeValidationRuntime({
    root: fixture,
    activeChangePath: () => packet,
    changePath: () => packet,
    walk: () => {},
    loadRuntime: () => state,
    saveRuntime: () => {},
    evidence: () => contract,
    selectedRepositories: () => [{ id: "root", workspacePath: fixture }],
    providerCapability: () => null,
    providerConfig: () => null,
    resolvedAcceptance: () => ({ required: false, claimIds: [] }),
    reviewPolicy: () => ({ required: false, tier: state.groundingVersion === 2 ? "high" : "low" }),
    policyCapabilities: () => [],
    policyCapabilityTrigger: () => null,
    changedSurfaceResolvable: () => false,
    forecastCapabilities: () => ({ capabilities: [] }),
    rawExecution: () => state.groundingVersion === 2 ? ({ providers: {
      test: { criticalCases: ["CASE-WIRE"] }
    } }) : ({ providers: {} }),
    commandExists: () => true,
    stableHash,
    fileDigest: digest,
    pathInside: (base, path) => path === base || path.startsWith(`${base}/`),
    knownProviders: new Set(),
    writeJson: () => {},
    now: () => "2026-08-13T00:00:00Z",
    fail
  });

  writeGrounding(valid());
  assert.equal(runtime.groundingValue("change-a", state, packet).firstLock, true);

  const missing = valid();
  missing.claims[0].productionPath[0].path = "missing.mjs";
  writeGrounding(missing);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /does not resolve inside repository/);

  const outside = valid();
  outside.claims[0].productionPath[0].path = "../outside.mjs";
  writeGrounding(outside);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /does not resolve inside repository/);

  const unselected = valid();
  unselected.claims[0].productionPath[0].repository = "other";
  writeGrounding(unselected);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /unselected repository/);

  const unhashed = valid();
  unhashed.readSet[1].role = "runtime-path";
  writeGrounding(unhashed);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /must appear in readSet with role production-path/);

  const locked = valid();
  writeGrounding(locked);
  state.groundingDigest = stableHash(locked);
  writeFileSync(join(fixture, "requirement.md"), "contradicted requirement\n");
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /sha256 does not match the baseline file/,
    "immutable requirement inputs must be rehashed after the ledger is locked");

  writeFileSync(join(fixture, "requirement.md"), "approved requirement\n");
  state.groundingDigest = null;
  state.groundingVersion = 2;
  state.intent = "Activate RabbitMQ callback wire contract";
  contract = {
    claims: [{
      id: "claim-a", impact: "medium",
      capabilities: ["test", "integration", "review"]
    }]
  };
  const v2 = () => ({
    version: 2,
    decisionBatch: valid().decisionBatch,
    risk: { tier: "high", classes: ["queue", "activation"], rationale: "existing queue path" },
    productionEntry: {
      status: "applicable", sourceReason: "runtime entry",
      paths: [{ repository: "root", path: "production.mjs" }]
    },
    realWire: {
      status: "applicable", sourceReason: "message contract",
      contracts: [{ repository: "root", path: "wire.json" }]
    },
    activationSemantics: {
      status: "applicable", sourceReason: "existing path becomes live",
      activatedPaths: [{ repository: "root", path: "activation.mjs" }],
      failureSemanticChanges: ["malformed callback becomes indeterminate"]
    },
    serviceInteractions: {
      status: "applicable", sourceReason: "producer and consumer cross a broker",
      rows: [{
        id: "rabbit-callback", owner: "member", producer: "bank-test",
        consumer: "member", contract: "wire.json", delivery: "at-least-once",
        timeoutRetry: "bounded retry", idempotency: "source_ref",
        ordering: "per source_ref", consistency: "eventual",
        rollout: "dev flag", rollback: "disable consumer"
      }]
    },
    observability: {
      status: "applicable", sourceReason: "operated broker boundary",
      rows: [{
        interactionId: "rabbit-callback", correlation: "source_ref",
        structuredEvents: "received/rejected", sli: "valid callback rate",
        alert: "rejection spike", runbook: "callback recovery",
        operatorQuestion: "which source_ref failed?"
      }]
    },
    readSet: [
      { repository: "root", path: "requirement.md", role: "requirement", mode: "full", sha256: digest(join(fixture, "requirement.md")) },
      { repository: "root", path: "production.mjs", role: "production-path", mode: "full", sha256: digest(join(fixture, "production.mjs")) },
      { repository: "root", path: "production.test.mjs", role: "test-topology", mode: "full", sha256: digest(join(fixture, "production.test.mjs")) },
      { repository: "root", path: "wire.json", role: "contract", mode: "full", sha256: digest(join(fixture, "wire.json")) },
      { repository: "root", path: "activation.mjs", role: "runtime-path", mode: "full", sha256: digest(join(fixture, "activation.mjs")) }
    ],
    claims: [{
      id: "claim-a",
      productionPath: [{ repository: "root", path: "production.mjs" }],
      failurePaths: [{ repository: "root", path: "activation.mjs", failure: "malformed payload" }],
      evidenceClass: ["test", "integration", "review"], testDoubleGap: "none"
    }],
    criticalCases: [{
      id: "CASE-WIRE", claimIds: ["claim-a"], oracle: "real-wire"
    }],
    mutants: [], derivedFacts: []
  });
  const missingReadSet = v2();
  delete missingReadSet.readSet;
  writeGrounding(missingReadSet);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /readSet must be non-empty/,
    "a missing Grounding v2 read set fails with a typed validation message");
  writeGrounding(v2());
  assert.equal(runtime.groundingValue("change-a", state, packet).value.version, 2);
  contract.claims[0].capabilities.push("deployment");
  const deploymentEvidence = v2();
  deploymentEvidence.claims[0].evidenceClass.push("deployment");
  writeGrounding(deploymentEvidence);
  assert.equal(runtime.groundingValue("change-a", state, packet)
    .value.claims[0].evidenceClass.includes("deployment"), true,
  "deployment handoff evidence maps to the declared deployment capability");
  const falseNa = v2();
  falseNa.serviceInteractions = {
    status: "not-applicable", sourceReason: "claimed local", rows: []
  };
  writeGrounding(falseNa);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /serviceInteractions is required/,
    "queue-backed changes cannot self-assert service interactions as N/A");
  const missingWire = v2();
  missingWire.realWire.contracts[0].path = "missing-wire.json";
  writeGrounding(missingWire);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /does not resolve inside repository/,
    "real-wire references must resolve inside a selected repository");
  console.log("grounding policy tests: PASS");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
