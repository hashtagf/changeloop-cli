import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createChangeValidationRuntime, durableDecisionMetadataIssues,
  groundingInteractionRequirements, semanticInvariantIssues
} from "../runtime/workflow/change-validation.mjs";
import { renderDraftDecisions } from "../runtime/workflow/change-lifecycle.mjs";

const fixture = mkdtempSync(join(tmpdir(), "foundation-grounding-policy-"));
const packet = join(fixture, "change");
mkdirSync(packet, { recursive: true });
mkdirSync(join(fixture, "specs"), { recursive: true });
writeFileSync(join(fixture, "requirement.md"), "approved requirement\n");
writeFileSync(join(fixture, "production.mjs"), "export const behavior = true;\n");
writeFileSync(join(fixture, "production.test.mjs"), "// test topology\n");
writeFileSync(join(fixture, "wire.json"), "{}\n");
writeFileSync(join(fixture, "activation.mjs"), "export const enabled = true;\n");
writeFileSync(join(fixture, "specs", "behavior.md"),
  "#### Scenario: Stable behavior\n");
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };
const repositorySelections = [];
const state = { id: "change-a", groundingRequired: true, status: "change",
  intent: "bounded change", impact: "medium", coupling: "isolated" };
let contract = {
  claims: [{ id: "claim-a", impact: "medium", capabilities: ["test", "review"] }]
};
let executionProviders = { test: { capability: "test", criticalCases: ["CASE-WIRE"] } };
let evidenceProviders = {};
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
  assert.deepEqual(groundingInteractionRequirements({
    coupling: "isolated", repositoryCount: 1, capabilities: ["test"],
    semantics: "an event feed calls an in-process consumer callback"
  }), { service: false, wire: false },
  "generic in-process event vocabulary does not invent a service boundary");
  assert.equal(groundingInteractionRequirements({
    coupling: "isolated", repositoryCount: 1, capabilities: ["test"],
    semantics: "publish to a Kafka event stream"
  }).service, true, "explicit distributed infrastructure still requires service grounding");
  const runtime = createChangeValidationRuntime({
    root: fixture,
    activeChangePath: () => packet,
    changePath: () => packet,
    walk: (_dir, visit) => visit(join(fixture, "specs", "behavior.md")),
    loadRuntime: () => state,
    saveRuntime: () => {},
    evidence: () => ({
      ...contract, providers: { ...evidenceProviders, ...executionProviders }
    }),
    selectedRepositories: (...args) => {
      repositorySelections.push(args);
      return [{ id: "root", workspacePath: fixture }];
    },
    providerCapability: (provider, config) => config?.capability || provider,
    providerConfig: () => null,
    resolvedAcceptance: () => ({ required: false, claimIds: [] }),
    reviewPolicy: () => ({ required: false, tier: state.groundingVersion === 2 ? "high" : "low" }),
    policyCapabilities: () => [],
    policyCapabilityTrigger: () => null,
    changedSurfaceResolvable: () => false,
    forecastCapabilities: () => ({ capabilities: [] }),
    rawExecution: () => ({ providers: executionProviders }),
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
  assert.deepEqual(repositorySelections.at(-1)[3], {
    changeDir: packet,
    useTargetPaths: true
  }, "root validation selects repositories from the root packet and target tree");

  const expectFailure = (value, expected, tasks = []) => {
    writeGrounding(value);
    assert.throws(() => runtime.groundingValue("change-a", state, packet, tasks), expected);
  };

  state.groundingVersion = 3;
  writeGrounding({
    version: 3,
    decisions: [{ id: "DEC-001", choice: "Keep the bounded behavior", reason: "User selected it" }]
  });
  assert.equal(runtime.groundingValue("change-a", state, packet).value.version, 3,
    "grounding v3 keeps only non-derived material decisions");
  expectFailure({
    version: 3,
    decisions: [{
      id: "DEC-001", choice: "Keep it", reason: "Selected",
      readSet: [{ path: "production.mjs" }]
    }]
  }, /grounding v3 stores decisions only/);
  delete state.groundingVersion;

  state.semanticInvariantsRequired = true;
  const semanticGrounding = valid();
  semanticGrounding.semanticInvariants = [{
    id: "INV-STABLE", statement: "Behavior remains stable", decisionIds: ["d1"],
    claimIds: ["claim-a"], specScenarios: ["Stable behavior"]
  }];
  writeGrounding(semanticGrounding);
  assert.equal(runtime.groundingValue("change-a", state, packet)
    .value.semanticInvariants[0].id, "INV-STABLE");
  state.semanticInvariantsRequired = false;

  const invalidV1 = [
    [(value) => { value.version = 4; }, /requires version 1, 2, or 3/],
    [(value) => { value.decisionBatch.status = "open"; }, /status must be locked/],
    [(value) => { value.decisionBatch.source = "guess"; }, /decisionBatch.source/],
    [(value) => { value.decisionBatch.reference = ""; }, /reference is required/],
    [(value) => { value.decisionBatch.mode = "rolling"; }, /decisionBatch.mode/],
    [(value) => { value.decisionBatch.lockedAt = "not-a-date"; }, /ISO-8601/],
    [(value) => { value.decisionBatch.decisions = []; }, /must record every locked/],
    [(value) => { value.decisionBatch.decisions[0].source = "mixed"; }, /decisions\[0\].source/],
    [(value) => { value.decisionBatch.decisions[0].question = ""; }, /question is required/],
    [(value) => { value.decisionBatch.decisions.push({
      ...value.decisionBatch.decisions[0]
    }); }, /id is duplicated/],
    [(value) => { value.readSet = []; }, /readSet must be non-empty/],
    [(value) => { value.readSet[0].repository = "other"; }, /unselected repository/],
    [(value) => { value.readSet[0].role = "unknown"; }, /role must be one of:/],
    [(value) => { value.readSet[0].mode = "partial"; }, /mode must be full\|targeted/],
    [(value) => { value.readSet[0].path = "/absolute"; }, /repository-relative/],
    [(value) => { value.readSet[0].sha256 = "bad"; }, /SHA-256/],
    [(value) => { value.readSet[0].role = "history"; }, /must read a requirement or backlog/],
    [(value) => { value.claims = []; }, /map every evidence claim exactly once/],
    [(value) => { value.claims[0].id = "unknown"; }, /unknown evidence claim/],
    [(value) => { value.claims[0].productionPath = []; }, /productionPath must be/],
    [(value) => { value.claims[0].productionPath[0] = null; }, /must be an object with repository and path/],
    [(value) => { value.claims[0].failurePaths = []; }, /failurePaths must be/],
    [(value) => { value.claims[0].failurePaths[0].failure = ""; }, /failure is required/],
    [(value) => { value.claims[0].evidenceClass = []; }, /evidenceClass must be/],
    [(value) => { value.claims[0].evidenceClass = ["unknown"]; }, /unsupported class/],
    [(value) => { value.claims[0].testDoubleGap = ""; }, /testDoubleGap/],
    [(value) => {
      value.claims[0].testDoubleGap = "unit double";
      value.claims[0].evidenceClass = ["test", "review"];
    }, /without integration or live evidence/],
    [(value) => { value.claims[0].evidenceClass = ["static"]; }, /is not declared by evidence.yaml/],
    [(value) => { value.derivedFacts = {}; }, /derivedFacts must be an array/],
    [(value) => { value.derivedFacts = [{ fact: "", command: "" }]; }, /requires fact and command/]
  ];
  for (const [mutate, expected] of invalidV1) {
    const value = valid();
    mutate(value);
    expectFailure(value, expected);
  }
  const aggregateDecision = valid();
  aggregateDecision.decisionBatch.source = "guess";
  aggregateDecision.decisionBatch.reference = "";
  writeGrounding(aggregateDecision);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    (error) => /decisionBatch.source/.test(error.message) &&
      /decisionBatch.reference is required/.test(error.message),
    "decision validation reports independent repairs in one pass");
  const aggregateReadSet = valid();
  aggregateReadSet.readSet[0].role = "unknown";
  aggregateReadSet.readSet[0].mode = "partial";
  writeGrounding(aggregateReadSet);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    (error) => /role must be one of/.test(error.message) &&
      /mode must be full\|targeted/.test(error.message),
    "readSet validation reports independent row repairs in one pass");
  const aggregateClaim = valid();
  aggregateClaim.claims[0].productionPath[0].path = "/absolute";
  aggregateClaim.claims[0].failurePaths[0].failure = "";
  aggregateClaim.claims[0].evidenceClass = ["unknown"];
  writeGrounding(aggregateClaim);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    (error) => /productionPath\[0\].path must be repository-relative/.test(error.message) &&
      /failurePaths\[0\].failure is required/.test(error.message) &&
      /evidenceClass contains unsupported class/.test(error.message) &&
      /supported: static\|unit\|test/.test(error.message),
    "claim validation reports path, failure, and evidence repairs in one pass");
  const implicitRoot = valid();
  delete implicitRoot.claims[0].productionPath[0].repository;
  delete implicitRoot.claims[0].failurePaths[0].repository;
  delete implicitRoot.readSet[1].repository;
  writeGrounding(implicitRoot);
  assert.equal(runtime.groundingValue("change-a", state, packet).value.version, 1,
    "omitted grounding repositories resolve to the selected root repository");

  const failureWithoutBaseline = valid();
  failureWithoutBaseline.claims[0].failurePaths[0] = {
    repository: "root", path: "activation.mjs", failure: "activation fails"
  };
  expectFailure(failureWithoutBaseline,
    /failurePaths\[0\] must appear in readSet with a baseline digest/);

  writeFileSync(join(packet, "grounding.yaml"), "not-json\n");
  assert.throws(() => runtime.groundingValue("change-a", state, packet), /JSON-compatible/);

  const sandboxPacket = join(fixture, "sandbox-change");
  mkdirSync(sandboxPacket, { recursive: true });
  writeFileSync(join(sandboxPacket, "grounding.yaml"),
    `${JSON.stringify(valid(), null, 2)}\n`);
  assert.equal(runtime.groundingValue("change-a", state, sandboxPacket).firstLock, true);
  assert.deepEqual(repositorySelections.at(-1)[3], {
    changeDir: sandboxPacket,
    useTargetPaths: false
  }, "active validation selects repositories from the active packet and sandbox tree");

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

  const cascade = v2();
  cascade.risk.tier = "low";
  cascade.nfrAssessment = {};
  cascade.productionEntry.paths[0].path = "missing-entry.mjs";
  cascade.readSet.push({
    repository: "root", path: "package.json", role: "dependency-source",
    mode: "full", sha256: "planned"
  });
  cascade.criticalCases = [{
    id: "CASE-UNBOUND", claimIds: ["claim-a"], oracle: "guess"
  }];
  cascade.derivedFacts = [{ fact: "", command: "" }];
  const cascadeTasks = [{
    id: "T-CASCADE", done: false,
    text: "create manifest [kind:implementation] [paths:package.json]"
  }];
  state.nfrAssessmentRequired = true;
  writeGrounding(cascade);
  assert.throws(() => runtime.groundingValue(
    "change-a", state, packet, cascadeTasks,
    [{ name: "cross-artifact contract", issues: [
      "design: decision 'DEC-001' contains content outside its metadata fields"
    ] }]
  ), (error) => [
    "[cross-artifact contract]", "[grounding risk and shape]",
    "[NFR assessment]", "[grounding source]", "[grounding readSet]",
    "[grounding task overlap]", "[critical case and mutant]",
    "[execution binding]", "[derived grounding facts]"
  ].every((heading) => error.message.includes(heading)),
  "independent Change defects are grouped into one bounded validation response");
  assert.throws(() => runtime.groundingValue(
    "change-a", state, packet, cascadeTasks,
    [{ name: "cross-artifact contract", issues: ["known defect"] }]
  ), (error) => error.message.includes("repair only fields named above") &&
      error.message.includes("standalone command without a pipe"),
  "grouped recovery prevents speculative rows and piped validation output");
  assert.throws(() => runtime.groundingValue(
    "change-a", state, packet, cascadeTasks,
    Array.from({ length: 20 }, (_, index) => ({
      name: `group-${index}`, issues: [`finding-${index}`, `detail-${index}`]
    }))
  ), (error) => {
    const lines = error.message.split("\n");
    return Array.from({ length: 20 }, (_, index) =>
      lines.some((line) => line.startsWith(`[group-${index}] `) &&
        line.includes(`finding-${index}; detail-${index}`))).every(Boolean);
  }, "grouped recovery renders one bounded line per independent group");
  state.nfrAssessmentRequired = false;

  const unreadableDependency = v2();
  unreadableDependency.productionEntry.paths = null;
  unreadableDependency.derivedFacts = [{ fact: "", command: "" }];
  writeGrounding(unreadableDependency);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    (error) => error.message.includes("[grounding risk and shape]") &&
      error.message.includes("[derived grounding facts]"),
    "an unreadable section skips its dependents without hiding independent findings");

  writeGrounding(v2());
  assert.throws(() => runtime.groundingValue(
    "change-a", state, packet, [], [{
      name: "cross-artifact contract",
      issues: Array.from({ length: 3000 }, (_, index) => `finding-${index}`)
    }]
  ), (error) => error.message.length < 17_000 &&
      error.message.includes("output truncated; repair these findings"),
  "grouped validation output is bounded before it enters the model context");

  const invalidV2 = [
    [(value) => { value.risk.tier = "extreme"; }, /risk.tier/],
    [(value) => { value.risk.classes = []; }, /risk.classes/],
    [(value) => { value.risk.rationale = ""; }, /risk.rationale/],
    [(value) => { value.productionEntry.status = "unknown"; }, /productionEntry.status/],
    [(value) => { value.productionEntry.sourceReason = ""; }, /productionEntry.sourceReason/],
    [(value) => { value.productionEntry.paths = null; }, /productionEntry.paths must be an array/],
    [(value) => { value.productionEntry.paths = []; }, /must be non-empty when applicable/],
    [(value) => { value.activationSemantics.failureSemanticChanges = null; }, /failureSemanticChanges/],
    [(value) => { value.productionEntry.status = "not-applicable"; value.productionEntry.paths = []; }, /productionEntry cannot be N\/A/],
    [(value) => { value.realWire.status = "not-applicable"; value.realWire.contracts = []; }, /realWire is required/],
    [(value) => { value.activationSemantics.status = "not-applicable"; value.activationSemantics.activatedPaths = []; }, /activationSemantics is required/],
    [(value) => { value.observability.status = "not-applicable"; value.observability.rows = []; }, /observability is required/],
    [(value) => { value.productionEntry.paths[0].repository = "other"; }, /unselected repository/],
    [(value) => { value.realWire.contracts[0].path = "/wire.json"; }, /repository-relative/],
    [(value) => { value.activationSemantics.activatedPaths[0].path = "missing.mjs"; }, /does not resolve/],
    [(value) => { value.readSet = value.readSet.filter((row) => row.path !== "wire.json"); }, /must appear in readSet with role/],
    [(value) => { value.serviceInteractions.rows[0].owner = ""; }, /requires non-empty fields: owner/],
    [(value) => {
      value.serviceInteractions.rows[0].owner = "";
      value.serviceInteractions.rows[0].producer = "";
    }, /requires non-empty fields: owner, producer/],
    [(value) => { value.serviceInteractions.rows.push({ ...value.serviceInteractions.rows[0] }); }, /id is duplicated/],
    [(value) => { value.observability.rows[0].interactionId = "missing"; }, /does not reference/],
    [(value) => { value.observability.rows = []; }, /observability.rows must be non-empty/],
    [(value) => { value.criticalCases = null; }, /criticalCases and mutants must be arrays/],
    [(value) => { value.criticalCases[0].id = ""; }, /id must be non-empty and unique/],
    [(value) => { value.criticalCases[0].claimIds = []; }, /claimIds must be non-empty/],
    [(value) => { value.criticalCases[0].claimIds = "claim-a"; },
      /claimIds must be non-empty/],
    [(value) => { value.criticalCases[0].oracle = "guess"; }, /oracle must be one of:/],
    [(value) => { value.mutants = [{ id: "", claimIds: ["claim-a"], class: "x", killerCaseId: "CASE-WIRE" }]; }, /mutants\[0\].id/],
    [(value) => { value.mutants = [{ id: "M1", claimIds: [], class: "", killerCaseId: "CASE-WIRE" }]; }, /requires claimIds and class/],
    [(value) => { value.mutants = [{ id: "M1", claimIds: "claim-a", class: "x", killerCaseId: "CASE-WIRE" }]; }, /requires claimIds and class/],
    [(value) => { value.mutants = [{ id: "M1", claimIds: ["claim-a"], class: "x", killerCaseId: "missing" }]; }, /killerCaseId/],
    [(value) => { value.criticalCases = []; },
      /material test claims .*bind its id in execution\.yaml provider\.criticalCases/s],
    [(value) => { value.criticalCases.push({
      ...value.criticalCases[0], id: "CASE-UNKNOWN", claimIds: ["unknown"]
    }); }, /references unknown claim/]
  ];
  for (const [mutate, expected] of invalidV2) {
    const value = v2();
    mutate(value);
    expectFailure(value, expected);
  }
  const malformedCriticalCoverage = v2();
  malformedCriticalCoverage.criticalCases[0].claimIds = "claim-a";
  writeGrounding(malformedCriticalCoverage);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    (error) => error.message.includes("claimIds must be non-empty") &&
      !error.message.includes("not iterable"),
  "malformed critical-case bindings never escape as a raw iterator error");
  const missingProductionSource = v2();
  missingProductionSource.readSet = missingProductionSource.readSet
    .filter((row) => row.path !== "production.mjs");
  expectFailure(missingProductionSource, /productionEntry.paths\[0\] must appear in readSet/);
  const aggregateSources = v2();
  aggregateSources.productionEntry.paths[0].path = "missing-production.mjs";
  aggregateSources.realWire.contracts[0].path = "missing-wire.json";
  writeGrounding(aggregateSources);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    (error) => /productionEntry.paths\[0\].path does not resolve/.test(error.message) &&
      /productionEntry.paths\[0\] must appear in readSet/.test(error.message) &&
      /realWire.contracts\[0\].path does not resolve/.test(error.message) &&
      /realWire.contracts\[0\] must appear in readSet/.test(error.message),
    "source validation reports path and readSet repairs in one pass");
  const unselectedWireSource = v2();
  unselectedWireSource.realWire.contracts[0].repository = "other";
  expectFailure(unselectedWireSource, /realWire.contracts\[0\] references an unselected/);
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

  contract.claims[0].capabilities.push("mutation");
  executionProviders = {
    test: { capability: "test", criticalCases: ["CASE-WIRE"] },
    mutationEmpty: {
      capability: "mutation", resultProtocol: "foundation-mutation-v2"
    },
    mutation: {
      capability: "mutation", resultProtocol: "foundation-mutation-v2",
      criticalCases: ["CASE-WIRE"], requiredMutants: ["M1"],
      mutantKillers: { M1: "CASE-WIRE" }
    }
  };
  const mutationGrounding = v2();
  mutationGrounding.claims[0].evidenceClass.push("mutation");
  mutationGrounding.mutants = [{
    id: "M1", claimIds: ["claim-a"], class: "polarity", killerCaseId: "CASE-WIRE"
  }];
  writeGrounding(mutationGrounding);
  assert.equal(runtime.groundingValue("change-a", state, packet).value.mutants[0].id, "M1");
  const missingMutationCoverage = structuredClone(mutationGrounding);
  missingMutationCoverage.mutants = [];
  expectFailure(missingMutationCoverage, /mutation claim 'claim-a' requires a named mutant/);
  const unknownMutantClaim = structuredClone(mutationGrounding);
  unknownMutantClaim.mutants.push({
    id: "M2", claimIds: ["missing"], class: "boundary", killerCaseId: "CASE-WIRE"
  });
  expectFailure(unknownMutantClaim, /mutants\[1\] references unknown claim/);
  executionProviders.mutation.requiredMutants = [];
  expectFailure(mutationGrounding, /must bind mutant 'M1'/);
  executionProviders.mutation.requiredMutants = ["M1"];
  executionProviders.mutation.mutantKillers.M1 = "OTHER";
  expectFailure(mutationGrounding, /mutantKillers.M1 must equal/);
  executionProviders.mutation.mutantKillers.M1 = "CASE-WIRE";
  delete executionProviders.mutation.criticalCases;
  expectFailure(mutationGrounding, /mutation provider must require killer critical case/);
  executionProviders = { test: { capability: "test", criticalCases: [] } };
  contract.claims[0].capabilities = contract.claims[0].capabilities
    .filter((capability) => capability !== "mutation");
  const unboundCriticalCase = v2();
  expectFailure(unboundCriticalCase, /must bind critical case 'CASE-WIRE'/);

  state.nfrAssessmentRequired = true;
  state.intent = "Keep p95 response latency below the approved performance budget";
  state.coupling = "isolated";
  contract = { claims: [{
    id: "claim-a", scenario: "p95 latency stays below 250 ms",
    impact: "medium", capabilities: ["test", "review", "performance"]
  }] };
  executionProviders = {
    test: { capability: "test", criticalCases: ["CASE-WIRE"] }
  };
  evidenceProviders = { performance: { capability: "performance" } };
  const nfr = v2();
  nfr.risk = { tier: "high", classes: ["performance"], rationale: "runtime latency budget" };
  nfr.realWire = { status: "not-applicable", sourceReason: "local function", contracts: [] };
  nfr.activationSemantics = {
    status: "not-applicable", sourceReason: "no dormant path",
    activatedPaths: [], failureSemanticChanges: []
  };
  nfr.serviceInteractions = {
    status: "not-applicable", sourceReason: "single process", rows: []
  };
  nfr.observability = {
    status: "not-applicable", sourceReason: "no operated boundary", rows: []
  };
  nfr.claims[0].evidenceClass = ["test", "review"];
  nfr.nfrAssessment = Object.fromEntries(Object.keys({
    performance: 1, capacity: 1, availability: 1, securityPrivacy: 1,
    accessibility: 1, operability: 1, compatibility: 1, recoverability: 1
  }).map((category) => [category, {
    status: category === "performance" ? "applicable" : "not-applicable",
    sourceReason: category === "performance" ? "approved latency budget" : `no ${category} risk`,
    target: category === "performance" ? "p95 <= 250 ms at 100 rps" : "none",
    claimIds: category === "performance" ? ["claim-a"] : []
  }]));
  const ownedTask = [{
    id: "T001", done: false,
    text: "Implement the latency budget [claims:claim-a] [paths:production.mjs]"
  }];
  writeGrounding(nfr);
  assert.equal(runtime.groundingValue("change-a", state, packet, ownedTask)
    .value.nfrAssessment.performance.status, "applicable");
  const invalidNfr = [
    [(value) => { value.nfrAssessment = null; }, /nfrAssessment is required/],
    [(value) => { value.nfrAssessment.unknown = {}; }, /unknown categories/],
    [(value) => { delete value.nfrAssessment.performance; }, /performance.status/],
    [(value) => { value.nfrAssessment.performance.status = "unknown"; }, /performance.status/],
    [(value) => { value.nfrAssessment.performance.sourceReason = ""; }, /sourceReason is required/],
    [(value) => { value.nfrAssessment.performance.claimIds = null; }, /claimIds must be an array/],
    [(value) => {
      value.nfrAssessment.performance.status = "not-applicable";
      value.nfrAssessment.performance.claimIds = [];
    }, /performance is required/],
    [(value) => { value.nfrAssessment.accessibility.claimIds = ["claim-a"]; },
      /claimIds must be empty/],
    [(value) => { value.nfrAssessment.performance.target = "fast"; }, /numeric threshold/],
    [(value) => { value.nfrAssessment.performance.claimIds = []; }, /claimIds must be non-empty/],
    [(value) => { value.nfrAssessment.performance.claimIds = ["missing"]; },
      /references unknown claim/]
  ];
  for (const [mutate, expected] of invalidNfr) {
    const value = structuredClone(nfr);
    mutate(value);
    expectFailure(value, expected, ownedTask);
  }
  const aggregateNfr = structuredClone(nfr);
  aggregateNfr.nfrAssessment.performance.target = "fast";
  aggregateNfr.nfrAssessment.accessibility.claimIds = ["claim-a"];
  writeGrounding(aggregateNfr);
  assert.throws(() => runtime.groundingValue("change-a", state, packet, ownedTask),
    (error) => /performance.target must contain a measurable numeric threshold/.test(error.message) &&
      /accessibility.claimIds must be empty when not applicable/.test(error.message),
    "NFR validation reports independent category repairs in one pass");
  const missingTarget = structuredClone(nfr);
  missingTarget.nfrAssessment.performance.target = "none";
  writeGrounding(missingTarget);
  assert.throws(() => runtime.groundingValue("change-a", state, packet, ownedTask),
    /performance.target is required/,
    "applicable NFRs require an observable target");
  const cascadingNfr = structuredClone(nfr);
  cascadingNfr.nfrAssessment.recoverability = {
    status: "applicable", sourceReason: "local recovery is material",
    target: "restart restores state", claimIds: ["claim-a"]
  };
  writeGrounding(cascadingNfr);
  assert.throws(() => runtime.groundingValue("change-a", state, packet, ownedTask),
    /resilience => availability must also be applicable/,
    "NFR capability recovery names downstream categories before the next validation");
  writeGrounding(nfr);
  assert.throws(() => runtime.groundingValue("change-a", state, packet, []),
    /no implementation task owner/,
    "applicable NFR claims require task ownership");
  const docsOnlyTask = [{
    id: "T002", done: false,
    text: "Document the latency budget [kind:mechanical-docs] [claims:claim-a]"
  }];
  assert.throws(() => runtime.groundingValue("change-a", state, packet, docsOnlyTask),
    /no implementation task owner/,
    "non-implementation tasks cannot own an applicable NFR claim");

  contract.claims[0].capabilities = ["test", "review"];
  expectFailure(nfr, /must declare one of: performance/, ownedTask);
  contract.claims[0].capabilities.push("performance");
  evidenceProviders = {};
  expectFailure(nfr, /no configured capable evidence provider/, ownedTask);

  state.intent = "Performance latency capacity scalability availability uptime reliability";
  state.coupling = "coupled";
  state.securityTriggers = ["authentication-boundary"];
  contract = { claims: [{
    id: "claim-a", scenario: "unauthorized access is denied below threshold 99",
    impact: "medium",
    capabilities: [
      "test", "integration", "review", "performance", "resilience",
      "security-static", "accessibility", "observability", "compatibility",
      "cross-repo-contract", "data-migration", "deployment"
    ]
  }] };
  executionProviders = {
    test: { capability: "test", criticalCases: ["CASE-WIRE"] }
  };
  evidenceProviders = Object.fromEntries([
    "performance", "resilience", "security-static", "accessibility", "observability",
    "compatibility", "cross-repo-contract", "data-migration", "deployment"
  ].map((capability) => [capability, { capability }]));
  const allNfr = v2();
  allNfr.readSet.push({
    repository: "root", path: "requirement.md", role: "dependency-source", mode: "full",
    sha256: digest(join(fixture, "requirement.md"))
  });
  for (const role of ["architecture", "composition-root"])
    allNfr.readSet.push({
      repository: "root", path: "requirement.md", role, mode: "full",
      sha256: digest(join(fixture, "requirement.md"))
    });
  allNfr.derivedFacts = [{ fact: "all NFR providers are configured", command: "verify-nfr" }];
  allNfr.nfrAssessment = Object.fromEntries(Object.keys({
    performance: 1, capacity: 1, availability: 1, securityPrivacy: 1,
    accessibility: 1, operability: 1, compatibility: 1, recoverability: 1
  }).map((category) => [category, {
    status: "applicable", sourceReason: `${category} is material`,
    target: `${category} threshold 99`, claimIds: ["claim-a"]
  }]));
  writeGrounding(allNfr);
  assert.equal(runtime.groundingValue("change-a", state, packet, ownedTask)
    .value.nfrAssessment.securityPrivacy.status, "applicable",
  "all NFR categories accept capable evidence, ownership, targets, and a security negative path");

  assert.deepEqual(durableDecisionMetadataIssues(`## Decisions\n\n- **Decision ID:** DEC-001\n  - **Status:** accepted\n  - **Decision:** Use bounded packets\n  - **Why:** Avoid transcript contamination\n  - **Rejected:** Parent transcript inheritance\n  - **Consequences:** Workers must regenerate packets\n  - **Supersedes:** none\n  - **Superseded by:** none\n\n## Compatibility and migration\n\nnone\n`), []);
  assert.match(durableDecisionMetadataIssues(`## Decisions\n\n- **Decision:** missing identity\n\n## Compatibility and migration\n`)[0], /Decision ID metadata/);
  assert.match(durableDecisionMetadataIssues(`## Decisions\n\n- **Decision:** legacy entry\n  - **Why:** old format\n\n- **Decision ID:** DEC-001\n  - **Status:** accepted\n  - **Decision:** Valid entry\n  - **Why:** grounded\n  - **Rejected:** none\n  - **Consequences:** bounded\n  - **Supersedes:** none\n  - **Superseded by:** none\n\n## Compatibility and migration\n`)[0], /legacy Decision entries/,
  "a valid decision cannot hide an unidentified legacy entry");
  const dangling = durableDecisionMetadataIssues(`## Decisions\n\n- **Decision ID:** DEC-001\n  - **Status:** superseded\n  - **Decision:** Old choice\n  - **Why:** historical\n  - **Rejected:** none\n  - **Consequences:** replaced\n  - **Supersedes:** none\n  - **Superseded by:** arbitrary prose\n\n## Compatibility and migration\n`);
  assert.ok(dangling.some((issue) => /must be none, DEC-<id>/.test(issue)),
    "supersession references use a stable navigable syntax");
  const reciprocal = durableDecisionMetadataIssues(`## Decisions\n\n- **Decision ID:** DEC-001\n  - **Status:** superseded\n  - **Decision:** Old choice\n  - **Why:** historical\n  - **Rejected:** none\n  - **Consequences:** replaced\n  - **Supersedes:** none\n  - **Superseded by:** DEC-002\n- **Decision ID:** DEC-002\n  - **Status:** accepted\n  - **Decision:** New choice\n  - **Why:** new evidence\n  - **Rejected:** old choice\n  - **Consequences:** migration\n  - **Supersedes:** DEC-001\n  - **Superseded by:** none\n\n## Compatibility and migration\n`);
  assert.deepEqual(reciprocal, [], "local supersession links are reciprocal");
  assert.deepEqual(semanticInvariantIssues([{
    id: "INV-API-SCOPE", statement: "API and UI use the same scope",
    decisionIds: ["DEC-001"], claimIds: ["claim-a"],
    specScenarios: ["API scope parity"]
  }], { claims: [{ id: "claim-a", capabilities: ["compatibility"] }] },
  new Set(["DEC-001"]), new Set(["API scope parity"]), { required: true }), []);
  assert.match(semanticInvariantIssues([], { claims: [{
    id: "claim-a", capabilities: ["compatibility"]
  }] }, new Set(), new Set(), { required: true })[0],
  /compatibility claim 'claim-a'/);
  assert.equal(renderDraftDecisions([]), "`none`",
    "a standard atomic draft with no durable decision renders an explicit none section");
  console.log("grounding policy tests: PASS");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
