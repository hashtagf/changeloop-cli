import assert from "node:assert/strict";
import {
  mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertValidationPreflight,
  createChangeValidationRuntime,
  lockValidatedGrounding,
  normalizeValidationAcceptance,
  proposalClassificationIssues,
  reportDeclaredSurfaceForecast,
  reportValidationReviewAssurance,
  validateImplementationTasks,
  validationChangeDirectory,
  validationDocumentBudgets,
  validationPreflightIssues,
  warnValidationDocumentBudgets
} from "../runtime/workflow/change-validation.mjs";
import {
  createSpecDeltaValidator,
  existingCapabilityRequirementFindings
} from "../runtime/workflow/validation/spec-delta.mjs";

const fail = (message) => { throw new Error(message); };

test("existing capability spec operations report every invalid delta shape", () => {
  const findings = existingCapabilityRequirementFindings(
    "accounts",
    new Set(["Existing", "Removed with migration", "Duplicate"]),
    [
      { name: "Existing", section: "ADDED Requirements", body: "" },
      { name: "Missing modified", section: "MODIFIED Requirements", body: "" },
      { name: "Missing removed", section: "REMOVED Requirements", body: "" },
      {
        name: "Removed with migration", section: "REMOVED Requirements",
        body: "**Migration:** move clients to v2"
      },
      { name: "Duplicate", section: "MODIFIED Requirements", body: "" },
      { name: "Duplicate", section: "ADDED Requirements", body: "" },
      { name: "Unknown", section: "CUSTOM Requirements", body: "" },
      { name: "Unknown", section: "", body: "" }
    ]
  );
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.requirement]), [
    ["added-preexisting", "Existing"],
    ["target-absent", "Missing modified"],
    ["target-absent", "Missing removed"],
    ["removal-migration-missing", "Missing removed"],
    ["added-preexisting", "Duplicate"],
    ["ambiguous", "Duplicate"],
    ["ambiguous", "Unknown"]
  ]);
  assert.match(findings.find((finding) => finding.kind === "ambiguous" &&
    finding.requirement === "Unknown").detail, /CUSTOM Requirements, unrecognized/);
});

test("valid existing capability operations produce no findings", () => {
  assert.deepEqual(existingCapabilityRequirementFindings(
    "accounts",
    new Set(["Modified", "Removed"]),
    [
      { name: "New", section: "ADDED Requirements", body: "" },
      { name: "Modified", section: "MODIFIED Requirements", body: "" },
      {
        name: "Removed", section: "REMOVED Requirements",
        body: "**Compatibility:** existing clients receive a deprecation response"
      }
    ]
  ), []);
});

test("existing capability collector handles missing, non-markdown, new and current specs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "spec-delta-collector-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const change = join(root, "openspec", "changes", "change-a");
  const canonical = join(root, "openspec", "specs", "accounts", "spec.md");
  const delta = join(change, "specs", "accounts", "spec.md");
  const newCapability = join(change, "specs", "new-capability", "spec.md");
  for (const path of [canonical, delta, newCapability])
    mkdirSync(dirname(path), { recursive: true });
  writeFileSync(canonical, [
    "# Accounts", "", "## Requirements", "",
    "### Requirement: Existing", "",
    "#### Scenario: Existing works", "- **WHEN** called", "- **THEN** pass", ""
  ].join("\n"));
  writeFileSync(delta, [
    "## ADDED Requirements", "",
    "### Requirement: Existing", "",
    "#### Scenario: Existing works", "- **WHEN** called", "- **THEN** pass", ""
  ].join("\n"));
  writeFileSync(newCapability, [
    "## ADDED Requirements", "", "### Requirement: New", ""
  ].join("\n"));
  writeFileSync(join(change, "specs", "notes.txt"), "ignored\n");
  const walk = (directory, visit) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, visit); else visit(path);
    }
  };
  const validator = createSpecDeltaValidator({
    root,
    activeChangePath: (id) => id === "missing"
      ? join(root, "openspec", "changes", "missing") : change,
    walk,
    fail
  });
  assert.deepEqual(validator.existingCapabilityOperationFindings("missing"), []);
  assert.deepEqual(validator.existingCapabilityOperationFindings("change-a")
    .map((finding) => finding.kind), ["added-preexisting"]);

  const scenarioChange = join(root, "scenario-change");
  const scenarioSpec = join(scenarioChange, "specs", "accounts", "spec.md");
  mkdirSync(dirname(scenarioSpec), { recursive: true });
  writeFileSync(scenarioSpec, [
    "#### Scenario: Unscoped behavior", "",
    "### Requirement: First", "", "#### Scenario: First behavior", "",
    "### Requirement: Second", "", "#### Scenario: Second behavior", ""
  ].join("\n"));
  writeFileSync(join(dirname(scenarioSpec), "ignored.txt"),
    "#### Scenario: Ignored behavior\n");
  assert.deepEqual(validator.changeSpecScenarios("change-a", scenarioChange), [
    {
      name: "First behavior", requirement: "First",
      path: "scenario-change/specs/accounts/spec.md", key: "first behavior"
    },
    {
      name: "Second behavior", requirement: "Second",
      path: "scenario-change/specs/accounts/spec.md", key: "second behavior"
    },
    {
      name: "Unscoped behavior", requirement: null,
      path: "scenario-change/specs/accounts/spec.md", key: "unscoped behavior"
    }
  ]);
  assert.deepEqual(validator.changeSpecScenarios("change-a", join(root, "absent")), []);
});

function validationRuntimeFixture() {
  const root = mkdtempSync(join(tmpdir(), "foundation-validation-phases-"));
  const packet = join(root, "change-a");
  let activePacket = packet;
  let durablePacket = packet;
  const state = {
    id: "change-a",
    status: "change",
    schema: "foundation-rapid",
    impact: "medium",
    coupling: "isolated",
    size: "s",
    groundingRequired: false,
    acceptance: { decision: "not-required" }
  };
  const contract = {
    claims: [{ id: "claim-a", impact: "medium", capabilities: [] }],
    providers: {}
  };
  const saved = [];
  const handoffs = [];
  const writes = [];
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, "proposal.md"), "# Proposal\nBounded change.\n");
  writeFileSync(join(packet, "tasks.md"),
    "- [ ] T001 Implement behavior [claims:claim-a] [paths:src/runtime.mjs]\n");
  writeFileSync(join(packet, "evidence.yaml"), "version: 1\n");
  const runtime = createChangeValidationRuntime({
    root,
    activeChangePath: () => activePacket,
    changePath: () => durablePacket,
    walk: () => {},
    loadRuntime: () => state,
    saveRuntime: (value) => saved.push(structuredClone(value)),
    evidence: () => contract,
    selectedRepositories: () => [{
      id: "root", mode: "write", workspacePath: root, relativePath: "."
    }],
    providerCapability: (provider, config) => config?.capability || provider,
    providerConfig: (_id, provider) => contract.providers[provider],
    resolvedAcceptance: () => ({ required: false, version: 2, claimIds: [] }),
    reviewPolicy: () => ({ required: true, independenceWaived: false }),
    reviewAssurancePosture: () => ({ summary: "fresh independent review" }),
    policyCapabilities: () => [],
    policyCapabilityTrigger: () => null,
    changedSurfaceResolvable: () => true,
    forecastCapabilities: () => ({ capabilities: ["review"] }),
    rawExecution: () => ({ providers: {} }),
    handoffContract: (id, value) => handoffs.push({ id, value }),
    contractFingerprint: () => "fingerprint",
    commandExists: (command) => command !== "missing",
    stableHash: () => "hash",
    fileDigest: () => "digest",
    pathInside: () => true,
    knownProviders: new Set(),
    writeJson: (path, value) => writes.push({ path, value: structuredClone(value) }),
    now: () => "2026-08-26T00:00:00Z",
    fail
  });
  return {
    runtime, state, contract, saved, handoffs, packet, writes,
    setPacketPaths(active, durable) {
      activePacket = active;
      durablePacket = durable;
    }
  };
}

test("validation preflight reports every unresolved prerequisite", () => {
  assert.deepEqual(validationPreflightIssues("change-a", {
    resolutionRequired: true, resolvedAt: null,
    impact: "", coupling: "", acceptance: { decision: "undecided" }
  }, ["design.md", "tasks.md"]), [
    "missing change artifacts: design.md, tasks.md",
    "resolve decisions for 'change-a' before validation: claude-foundation change resolve change-a --impact <low|medium|high> --coupling <isolated|coupled> --acceptance-required|--acceptance-not-required",
    "resolve impact for 'change-a'",
    "resolve coupling for 'change-a'",
    "acceptance decision is unresolved for 'change-a'; ask the user whether subjective human acceptance is required, then resolve with --acceptance-required or --acceptance-not-required"
  ]);
  assert.deepEqual(validationPreflightIssues("change-a", {
    resolutionRequired: true, resolvedAt: "now",
    impact: "medium", coupling: "isolated", acceptance: { decision: "not-required" }
  }), []);
  assert.deepEqual(validationPreflightIssues("legacy-change", {
    impact: "medium", coupling: "isolated", acceptance: { decision: "not-required" }
  }), []);
  assert.throws(() => assertValidationPreflight("change-a", {
    status: "archived", impact: "medium", coupling: "isolated"
  }, [], fail), /already archived/);
  assert.throws(() => assertValidationPreflight("change-a", {
    status: "change", impact: "", coupling: "isolated"
  }, [], fail), /validation preflight failed/);
  assert.doesNotThrow(() => assertValidationPreflight("change-a", {
    status: "change", impact: "medium", coupling: "isolated"
  }, [], fail));
});

test("versioned proposals remain authoritative for impact and coupling", () => {
  const proposal = [
    "# Change", "", "## Impact", "",
    "- **Impact:** medium", "- **Coupling:** isolated", ""
  ].join("\n");
  assert.deepEqual(proposalClassificationIssues({
    version: 2, impact: "medium", coupling: "isolated"
  }, proposal), []);
  assert.deepEqual(proposalClassificationIssues({
    version: 2, impact: "low", coupling: "coupled"
  }, proposal), [
    "proposal.md impact 'medium' disagrees with compiled runtime impact 'low'; re-resolve the agreement instead of editing machine state",
    "proposal.md coupling 'isolated' disagrees with compiled runtime coupling 'coupled'; re-resolve the agreement instead of editing machine state"
  ]);
  assert.deepEqual(proposalClassificationIssues({
    version: 2, impact: "medium", coupling: "isolated"
  }, "# Legacy-shaped proposal\n"), []);
  assert.deepEqual(proposalClassificationIssues({
    version: 1, impact: "low", coupling: "isolated"
  }, "# Legacy-shaped proposal\n"), []);
});

test("validation selects root or active packet without hiding state", () => {
  const state = { id: "change-a" };
  assert.equal(validationChangeDirectory("change-a", "root", state,
    () => "/active", () => "/root"), "/root");
  assert.equal(validationChangeDirectory("change-a", "active", state,
    (id, received) => `/active/${id}/${received.id}`, () => "/root"),
  "/active/change-a/change-a");
});

test("implementation task validation preserves IDs and rejects malformed gates", () => {
  const tasks = [
    { id: "T001", done: false, text: "Implement runtime/workflow/land-runtime.mjs" },
    { id: "T002", done: true, text: "Run /prove" }
  ];
  assert.deepEqual(validateImplementationTasks(tasks, fail), ["T001", "T002"]);
  assert.throws(() => validateImplementationTasks([
    { id: "", done: false, text: "Implement" }
  ], fail), /stable ID/);
  assert.throws(() => validateImplementationTasks([
    { id: "T001", done: false, text: "First" },
    { id: "T001", done: false, text: "Second" }
  ], fail), /duplicate task IDs/);
  assert.throws(() => validateImplementationTasks([
    { id: "T001", done: false, text: "Then run `/land`" }
  ], fail), /lifecycle gate/);
});

test("acceptance normalization validates scope and persists resolved policy", () => {
  const claims = [{ id: "claim-a" }, { id: "claim-b" }];
  assert.throws(() => normalizeValidationAcceptance("change-a", {}, claims, {
    required: true, version: 2, claimIds: ["unknown"]
  }, fail), /unknown claim/);
  assert.throws(() => normalizeValidationAcceptance("change-a", {}, claims, {
    required: true, version: 2, claimIds: []
  }, fail), /nothing is in scope/);

  const warnings = [];
  const legacyState = {};
  const legacy = normalizeValidationAcceptance("change-a", legacyState, claims, {
    required: true, version: 1, claimIds: [], reason: "human sign-off"
  }, fail, (message) => warnings.push(message), "2026-08-26T00:00:00Z");
  assert.deepEqual(legacy.claimIds, ["claim-a", "claim-b"]);
  assert.equal(legacyState.acceptance.scopeOrigin, "legacy-all");
  assert.equal(legacyState.acceptance.declaredAt, "2026-08-26T00:00:00Z");
  assert.match(warnings[0], /migrated legacy acceptance scope/);

  const capabilityState = { acceptance: { declaredAt: "existing" } };
  normalizeValidationAcceptance("change-a", capabilityState, claims, {
    required: true,
    version: 2,
    claimIds: ["claim-a"],
    scopeOrigin: "claim-capability"
  }, fail, (message) => warnings.push(message), "ignored");
  assert.equal(capabilityState.acceptance.reason, "declared evidence capability");
  assert.equal(capabilityState.acceptance.declaredAt, "existing");
  assert.match(warnings.at(-1), /claim-capability|acceptance stays required/);

  const untouched = {};
  assert.equal(normalizeValidationAcceptance("change-a", untouched, claims, {
    required: false, version: 2, claimIds: []
  }, fail).required, false);
  assert.equal(untouched.acceptance, undefined);
});

test("document budgets follow size and impact policy", () => {
  assert.equal(validationDocumentBudgets({ size: "XS", impact: "high" })["design.md"], 1400);
  assert.equal(validationDocumentBudgets({ size: "m", impact: "low" })["tasks.md"], 900);
  assert.equal(validationDocumentBudgets({ size: "m", impact: "high" })["proposal.md"], 1600);
});

test("document budget warnings inspect only existing oversized artifacts", () => {
  const warnings = [];
  const content = new Map([
    ["/packet/proposal.md", Array(901).fill("word").join(" ")],
    ["/packet/tasks.md", "short"]
  ]);
  warnValidationDocumentBudgets("/packet", { size: "s", impact: "high" },
    (path) => content.has(path), (path) => content.get(path),
    (message) => warnings.push(message));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /proposal\.md is 901 words/);
});

test("declared surface forecast reports wiring actions and review consequence", () => {
  const warnings = [];
  reportDeclaredSurfaceForecast("change-a", {}, false, new Set(),
    () => ({ capabilities: ["test"] }), (message) => warnings.push(message));
  assert.deepEqual(warnings, []);
  reportDeclaredSurfaceForecast("change-a", { declaredSurface: ["src/**"] }, true,
    new Set(), () => ({ capabilities: ["test"] }),
    (message) => warnings.push(message));
  assert.deepEqual(warnings, []);
  reportDeclaredSurfaceForecast("change-a", { declaredSurface: ["src/**"] }, false,
    new Set(["test"]), () => ({ capabilities: ["test"] }),
    (message) => warnings.push(message));
  assert.deepEqual(warnings, []);
  reportDeclaredSurfaceForecast("change-a", { declaredSurface: ["src/**"] }, false,
    new Set(), () => ({ capabilities: ["test", "review"] }),
    (message) => warnings.push(message));
  assert.equal(warnings.length, 5);
  assert.match(warnings[1], /evidence init change-a --write/);
  assert.match(warnings[3], /fresh reviewer/);
});

test("review assurance report is quiet when unavailable and explains active gates", () => {
  const notes = [];
  assert.equal(reportValidationReviewAssurance(true, true,
    { required: true }, { summary: "high" }, (message) => notes.push(message)), null);
  assert.equal(reportValidationReviewAssurance(false, false,
    { required: true }, null, (message) => notes.push(message)), null);
  assert.equal(reportValidationReviewAssurance(false, true,
    { required: false }, null, (message) => notes.push(message)), null);
  const assurance = { summary: "independent reviewer configured" };
  assert.equal(reportValidationReviewAssurance(false, true,
    { required: true, independenceWaived: false }, assurance,
    (message) => notes.push(message)), assurance);
  assert.equal(notes.length, 3);
  assert.match(notes[0], /assurance posture/);
  assert.match(notes[1], /requires review evidence/);
});

test("grounding lock records first lock and closes a pending reopen", () => {
  const untouched = { id: "change-a" };
  lockValidatedGrounding(untouched, null, null, null);
  assert.deepEqual(untouched, { id: "change-a" });

  const locked = {};
  lockValidatedGrounding(locked, {
    firstLock: true, digest: "digest-a", lockedAt: "locked-at"
  }, "fingerprint", "completed-at");
  assert.equal(locked.groundingDigest, "digest-a");
  assert.equal(locked.groundingReopens, undefined);

  const reopened = {
    groundingReopens: [{ reason: "prior" }],
    groundingReopenPending: { reason: "scope changed" }
  };
  lockValidatedGrounding(reopened, {
    firstLock: true, digest: "digest-b", lockedAt: "new-lock"
  }, "fingerprint", "completed-at");
  assert.deepEqual(reopened.groundingReopens.at(-1), {
    reason: "scope changed",
    newDigest: "digest-b",
    newLockedAt: "new-lock",
    contractFingerprint: "fingerprint",
    completedAt: "completed-at"
  });
  assert.equal(reopened.groundingReopenPending, undefined);
});

test("artifact gaps cover rapid and standard packet requirements", () => {
  const fixture = validationRuntimeFixture();
  assert.deepEqual(fixture.runtime.changeArtifactGaps(fixture.state, fixture.packet), []);

  fixture.state.groundingRequired = true;
  fixture.state.version = 2;
  fixture.state.externalOperationsVersion = 1;
  assert.deepEqual(fixture.runtime.changeArtifactGaps(fixture.state, fixture.packet), [
    "grounding.yaml", "execution.yaml", "repositories.yaml", "handoffs.yaml"
  ]);

  fixture.state.schema = "foundation-standard";
  assert.deepEqual(fixture.runtime.changeArtifactGaps(fixture.state, fixture.packet), [
    "design.md", "grounding.yaml", "execution.yaml", "repositories.yaml",
    "handoffs.yaml", "specs/**/*.md"
  ]);
});

test("evidence initialization previews and mirrors durable provider wiring", () => {
  const fixture = validationRuntimeFixture();
  const active = join(fixture.packet, "active");
  const durable = join(fixture.packet, "durable");
  fixture.setPacketPaths(active, durable);
  fixture.contract.claims[0].capabilities = ["test"];
  fixture.contract.providers.external = { adapter: "external" };
  fixture.contract.providers.broken = { adapter: "command", command: ["missing"] };
  writeFileSync(join(fixture.packet, "..", "package.json"), JSON.stringify({
    scripts: { test: "node --test" }
  }));

  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  try {
    fixture.runtime.initializeEvidence("change-a");
    assert.equal(fixture.writes.length, 0);
    fixture.runtime.initializeEvidence("change-a", { write: true });
    fixture.runtime.showEvidenceDoctor("change-a");
  } finally {
    console.log = originalLog;
  }

  assert.equal(fixture.writes.length, 2);
  assert.equal(fixture.writes[0].path, join(durable, "execution.yaml"));
  assert.equal(fixture.writes[1].path, join(active, "execution.yaml"));
  assert.deepEqual(fixture.writes[0].value, fixture.writes[1].value);
  assert.equal(fixture.writes[0].value.providers.test.adapter, "test-discovery");
  assert.ok(messages.some((message) => message.includes('"write": false')));
  assert.ok(messages.some((message) => message.includes('"written"')));
  assert.ok(messages.some((message) => message.includes("EVIDENCE DOCTOR change-a")));
  assert.ok(messages.some((message) => message.includes("OK       external")));
  assert.ok(messages.some((message) => message.includes("CANDIDATE test")));
  assert.ok(messages.some((message) => message.includes("BLOCKED  review")));
  assert.ok(messages.some((message) => message.includes("BLOCKED  broken")));
  assert.ok(messages.some((message) => message.includes("evidence init change-a --write")));
});

test("traceability audit renders text and JSON and marks invalid links", () => {
  const fixture = validationRuntimeFixture();
  const messages = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = (message) => messages.push(String(message));
  try {
    fixture.runtime.showTraceabilityAudit("change-a");
    fixture.runtime.showTraceabilityAudit("change-a", { json: true });
    assert.notEqual(process.exitCode, 1);

    writeFileSync(join(fixture.packet, "tasks.md"),
      "- [ ] T001 Implement behavior [claims:unknown] [paths:src/runtime.mjs]\n");
    fixture.runtime.showTraceabilityAudit("change-a");
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
  assert.ok(messages.some((message) => message.includes("TRACEABILITY change-a: PASS")));
  assert.ok(messages.some((message) => message.includes('"changeId": "change-a"')));
  assert.ok(messages.some((message) => message.includes("unknown-task-claim")));
});

test("validation runtime orchestrates contract, state, advisory, and review phases", () => {
  const fixture = validationRuntimeFixture();
  const quiet = fixture.runtime.validate("change-a", "root", { quiet: true });
  assert.deepEqual(quiet, {
    version: 1, changeId: "change-a", reviewAssurance: null,
    authorityPreflight: { status: "READY", blockers: [], decision: null }
  });
  assert.equal(fixture.saved.length, 1);
  assert.equal(fixture.handoffs[0].id, "change-a");
  assert.deepEqual(fixture.state.evidenceCapabilities, []);
  assert.deepEqual(fixture.state.executionSurface, {
    version: 2, taskCount: 1, claimCount: 1, providerCount: 0,
    repositoryCount: 1, criticalCaseCount: 0, externalAuthorityCount: 0,
    reviewTier: null, securityTriggerCount: 0
  });

  fixture.state.declaredSurface = ["src/**"];
  fixture.contract.claims[0].impact = "high";
  const messages = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (message) => messages.push(String(message));
  console.log = (message) => messages.push(String(message));
  try {
    const visible = fixture.runtime.validate("change-a", "active");
    assert.equal(visible.reviewAssurance.summary, "fresh independent review");
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  assert.equal(fixture.state.reviewRequired, true);
  assert.equal(fixture.saved.length, 2);
  assert.ok(messages.some((message) => message.includes("review assurance posture")));
  assert.ok(messages.some((message) => message.includes("VALID change-a")));

  writeFileSync(join(fixture.packet, "design.md"),
    "# Design\n\n## Decisions\n\nnone\n\n## Compatibility and migration\n\nnone\n");
  fixture.state.decisionMetadataRequired = true;
  assert.equal(fixture.runtime.validate("change-a", "root", { quiet: true }).changeId,
    "change-a");
});

test("optional grounding still enforces cross-artifact task claims", () => {
  const fixture = validationRuntimeFixture();
  writeFileSync(join(fixture.packet, "tasks.md"),
    "- [ ] T001 Implement behavior [claims:unknown] [paths:src/runtime.mjs]\n");
  assert.throws(() => fixture.runtime.validate("change-a", "root", { quiet: true }),
    /references unknown claim\(s\): unknown/);
});
