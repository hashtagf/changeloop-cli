import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { normalizeSemanticDraft, semanticDraftTemplate } from "../runtime/workflow/semantic-draft.mjs";
import { createChangeLifecycle, draftNeedsDesign } from "../runtime/workflow/change-lifecycle.mjs";
import {
  appendRequirementToSpec, compileSemanticAmendment, updateTaskClaimAnnotation
} from "../runtime/workflow/semantic-amendment.mjs";

const slugify = (value) => String(value).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function semanticDraft(overrides = {}) {
  return {
    version: 3,
    intent: "Keep payment retries safe",
    impact: "medium",
    coupling: "coupled",
    requirements: [
      {
        key: "payment-retry",
        capability: "payment-control",
        operation: "added",
        scenarios: [
          { key: "success", kind: "success", name: "Retry succeeds", when: "a retry succeeds", then: "one payment is recorded" },
          { key: "timeout", kind: "failure", name: "Retry times out", when: "a retry times out", then: "the request remains retryable" }
        ],
        outcome: "record at most one payment"
      },
      {
        key: "audit-result",
        capability: "payment-observability",
        operation: "added",
        scenario: "A payment attempt completes",
        outcome: "An audit result is available"
      }
    ],
    tasks: [
      {
        key: "implement-retry",
        outcome: "Implement bounded retry handling",
        covers: ["payment-retry"],
        paths: ["src/payment/**"],
        verify: "npm test -- payment-retry"
      },
      {
        key: "record-audit",
        outcome: "Record the payment result",
        covers: ["audit-result"],
        dependsOn: ["implement-retry"],
        paths: ["src/audit/**"],
        verify: "npm test -- payment-audit"
      }
    ],
    evidence: {
      "payment-retry": { capabilities: ["test"] },
      "audit-result": { capabilities: ["test"] }
    },
    integrations: [{
      key: "payment-api",
      kind: "external-api",
      documentation: { source: "https://provider.example/api", version: "2026-08" },
      concerns: ["authentication", "timeout", "retry", "compatibility"],
      relatesTo: ["payment-retry"]
    }],
    ...overrides
  };
}

test("semantic compiler creates stable cross-ledger links from semantic keys", () => {
  const result = normalizeSemanticDraft(semanticDraft(), slugify);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.draft.claims.map((claim) => claim.id), [
    "payment-retry-success", "payment-retry-timeout", "audit-result"
  ]);
  assert.deepEqual(result.draft.tasks.map((task) => task.id), ["T001", "T002"]);
  assert.deepEqual(result.draft.tasks[0].claims,
    ["payment-retry-success", "payment-retry-timeout"]);
  assert.deepEqual(result.draft.tasks[1].dependsOn, ["T001"]);
  assert.ok(result.draft.claims[0].capabilities.includes("integration"));
  assert.ok(result.draft.claims[0].capabilities.includes("security-static"));
  assert.ok(result.draft.claims[0].capabilities.includes("resilience"));
  assert.ok(result.draft.claims[0].capabilities.includes("compatibility"));
  assert.equal(result.draft._derivedExecution, true);
  assert.ok(result.draft.execution.providers.test);
  assert.ok(result.draft.execution.providers.integration);
});

test("semantic compiler aggregates unknown references, cycles, and placeholders", () => {
  const value = semanticDraft({
    requirements: [{
      key: "replace-with-key", capability: "change", scenario: "When",
      outcome: "Then"
    }],
    tasks: [{
      key: "one", outcome: "TODO", covers: ["missing"], dependsOn: ["one"],
      verify: "npm test"
    }],
    evidence: { ghost: { capabilities: ["test"] } },
    integrations: []
  });
  const result = normalizeSemanticDraft(value, slugify);
  const message = result.issues.join("\n");
  assert.match(message, /placeholder/);
  assert.match(message, /unknown requirement 'ghost'/);
  assert.match(message, /covers references unknown requirement/);
  assert.match(message, /dependencies contain a cycle/);
  assert.match(message, /requirements have no implementation task/);
});

test("integration contracts require explicit success and failure scenarios", () => {
  const value = semanticDraft();
  delete value.requirements[0].scenarios[1].kind;
  const result = normalizeSemanticDraft(value, slugify);
  assert.match(result.issues.join("\n"), /related scenario with kind 'failure'/);
});

test("semantic draft validates local integration documentation references", (t) => {
  const root = mkdtempSync(join(tmpdir(), "semantic-integration-doc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "provider.md"), "# Provider API\n");
  const draft = semanticDraft();
  draft.integrations[0].documentation.source = "docs/provider.md";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: { grounding: "optional" } }), securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: (parent, candidate) => {
      const rel = relative(parent, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    slugify, changePath: () => root, loadRuntime: () => ({})
  });
  assert.equal(lifecycle.loadDraft("draft.json").integrations[0]
    .documentation.source, "docs/provider.md");
  draft.integrations[0].documentation.source = "docs/missing.md";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"),
    /documentation.source must reference an existing regular file/);

  draft.integrations[0].documentation.source = "docs";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"), /existing regular file/);

  const outside = mkdtempSync(join(tmpdir(), "semantic-integration-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "provider.md"), "# Outside\n");
  symlinkSync(join(outside, "provider.md"), join(root, "docs", "outside.md"));
  draft.integrations[0].documentation.source = "docs/outside.md";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"), /existing regular file/);

  draft.integrations[0].documentation.source = "file:///etc/passwd";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"), /must use HTTPS/);

  draft.integrations[0].documentation.source = "https://provider.example/api";
  draft.integrations[0].documentation.version = "latest";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"), /must identify a fixed version/);
});

test("modified requirements merge every canonical scenario before rendering", () => {
  const source = semanticDraft({
    requirements: [{
      key: "retry-policy", capability: "payment-control", operation: "modified",
      requirement: "Retry policy", outcome: "record one result",
      scenarios: [{ name: "New rejection", when: "the provider rejects", then: "the rejection is recorded" }]
    }],
    tasks: [{
      key: "modify-retry", outcome: "Modify retry policy", covers: ["retry-policy"],
      paths: ["src/payment/**"], verify: "npm test"
    }],
    evidence: { "retry-policy": { capabilities: ["test"] } },
    integrations: []
  });
  const canonical = [
    "# payment-control", "", "## Requirements", "",
    "### Requirement: Retry policy", "", "The system SHALL retain existing behavior.", "",
    "#### Scenario: Existing success", "", "- **WHEN** a retry succeeds", "- **THEN** one result is recorded", ""
  ].join("\n");
  const result = normalizeSemanticDraft(source, slugify, {
    loadCanonicalSpec: () => canonical
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.draft.specs[0].scenarios.map((row) => row.name),
    ["Existing success", "New rejection"]);
});

test("semantic template is compact and delegates bookkeeping", () => {
  const template = semanticDraftTemplate();
  assert.equal(template.version, 3);
  assert.ok(template.requirements[0].key);
  assert.ok(template.tasks[0].covers.length);
  assert.equal(template.claims, undefined);
  assert.equal(template.specs, undefined);
  assert.equal(template.execution, undefined);
  assert.equal(template.grounding, undefined);
});

test("semantic materialization omits virtual-default files and writes typed extensions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "semantic-materialize-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = {
    intent: "Keep payment retries safe", impact: "medium", coupling: "coupled",
    schema: "foundation-standard", groundingRequired: false,
    artifactDefaultsVersion: 2, decisionMetadataRequired: true
  };
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  writeJson(join(root, "evidence.yaml"), { version: 1, claims: [] });
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: { grounding: "optional" } }), securityTerms: [],
    fail: (message) => { throw new Error(message); }, pathInside: () => true,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")), writeJson,
    slugify, changePath: () => root, loadRuntime: () => state
  });
  const compiled = normalizeSemanticDraft(semanticDraft(), slugify).draft;
  assert.equal(draftNeedsDesign(compiled), true);
  lifecycle.materializeDraft("payment", compiled);
  assert.ok(existsSync(join(root, "design.md")));
  assert.ok(existsSync(join(root, "specs", "payment-control", "spec.md")));
  assert.equal(existsSync(join(root, "execution.yaml")), false);
  assert.equal(existsSync(join(root, "repositories.yaml")), false);
  assert.equal(existsSync(join(root, "handoffs.yaml")), false);
  const evidence = JSON.parse(readFileSync(join(root, "evidence.yaml"), "utf8"));
  assert.equal(evidence.claims[0].requirementKey, "payment-retry");
  assert.ok(evidence.providers.test);
  assert.match(readFileSync(join(root, "tasks.md"), "utf8"), /\[key:implement-retry\]/);
  assert.match(readFileSync(join(root, "design.md"), "utf8"), /payment-api/);
});

test("semantic amendment preserves completed tasks and custom spec sections", () => {
  const tasksContent = [
    "# Tasks", "",
    "- [x] **T001** Existing outcome [key:existing-task] [claims:existing-claim] — verify: `npm test`",
    ""
  ].join("\n");
  const compiled = compileSemanticAmendment({
    amendment: {
      version: 1,
      reason: "A malformed row was discovered during Build",
      addRequirements: [{
        key: "malformed-row",
        capability: "mutation-control",
        operation: "added",
        scenario: "A malformed row exists",
        outcome: "It is reported without blocking unrelated work"
      }],
      updateTasks: [{
        key: "existing-task", covers: ["existing-behavior", "malformed-row"]
      }],
      evidence: { "malformed-row": { capabilities: ["test"] } }
    },
    contract: {
      version: 1,
      claims: [{
        id: "existing-claim", requirementKey: "existing-behavior",
        scenario: "Existing behavior", capabilities: ["test"]
      }],
      providers: { test: { adapter: "test-discovery", command: ["sh", "-lc", "npm test"] } }
    },
    tasksContent,
    slugify,
    renderTask: () => { throw new Error("no new task expected"); }
  });
  assert.deepEqual(compiled.issues, []);
  assert.match(compiled.tasksContent, /^- \[x\].*existing-claim,malformed-row/m);
  assert.equal(compiled.claims.at(-1).id, "malformed-row");
  const original = [
    "# mutation-control", "", "## ADDED Requirements", "",
    "### Requirement: Existing", "", "The system SHALL keep this.", "",
    "## Operator notes", "", "Preserve this manual section.", ""
  ].join("\n");
  const amended = appendRequirementToSpec(original, compiled.specs[0]);
  assert.match(amended, /Requirement: Existing[\s\S]*Requirement: malformed-row/);
  assert.ok(amended.indexOf("Requirement: malformed-row") < amended.indexOf("## Operator notes"));
  assert.match(amended, /## Operator notes[\s\S]*Preserve this manual section/);
  assert.equal(updateTaskClaimAnnotation(
    "- [ ] **T001** Work — verify: `npm test`", ["a"]),
  "- [ ] **T001** Work [claims:a] — verify: `npm test`");
});

test("semantic amendment rejects unknown task references without writing", () => {
  const compiled = compileSemanticAmendment({
    amendment: {
      version: 1,
      addRequirements: [{
        key: "new", capability: "change", scenario: "Input", outcome: "Output"
      }],
      updateTasks: [{ key: "missing", covers: ["new"] }],
      evidence: { new: { capabilities: ["test"] } }
    },
    contract: { version: 1, claims: [] },
    tasksContent: "# Tasks\n",
    slugify,
    renderTask: () => ""
  });
  assert.match(compiled.issues.join("\n"), /unknown task 'missing'/);
});

test("semantic amendment never silently replaces a completed task contract", () => {
  const compiled = compileSemanticAmendment({
    amendment: {
      version: 1,
      addRequirements: [{
        key: "new", capability: "change", scenario: "Input", outcome: "Output"
      }],
      updateTasks: [{
        key: "existing", covers: ["old", "new"],
        outcome: "A different outcome", verify: "npm run test:new"
      }],
      evidence: { new: { capabilities: ["test"] } }
    },
    contract: {
      version: 1,
      claims: [{ id: "old", requirementKey: "old", capabilities: ["test"] }]
    },
    tasksContent: "# Tasks\n\n- [x] **T001** Existing [key:existing] " +
      "[claims:old] — verify: `npm test`\n",
    slugify,
    renderTask: () => ""
  });
  assert.match(compiled.issues.join("\n"),
    /cannot replace outcome or verify; add a new task/);
  assert.equal(compiled.tasksContent, undefined);
});

test("change amend installs atomically and restores files and state on validation failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "semantic-amend-transaction-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "payment-change";
  const change = join(root, "openspec", "changes", id);
  mkdirSync(join(change, "specs", "payment-control"), { recursive: true });
  writeFileSync(join(change, "tasks.md"), [
    "# Tasks", "",
    "- [x] **T001** Existing outcome [key:existing-task] [claims:existing-claim] — verify: `npm test`",
    ""
  ].join("\n"));
  writeFileSync(join(change, "evidence.yaml"), `${JSON.stringify({
    version: 1,
    claims: [{
      id: "existing-claim", requirementKey: "existing-behavior",
      scenario: "Existing behavior", capabilities: ["test"]
    }],
    providers: { test: { adapter: "test-discovery", command: ["sh", "-lc", "npm test"] } }
  }, null, 2)}\n`);
  writeFileSync(join(change, "specs", "payment-control", "spec.md"), [
    "# payment-control", "", "## ADDED Requirements", "",
    "### Requirement: Existing", "", "The system SHALL keep this.", "",
    "## Operator notes", "", "Preserve this manual section.", ""
  ].join("\n"));
  const amendmentPath = join(root, "amendment.json");
  const writeAmendment = (key) => writeFileSync(amendmentPath, `${JSON.stringify({
    version: 1,
    reason: `Add ${key}`,
    addRequirements: [{
      key, capability: "payment-control", operation: "added",
      scenario: `${key} is observed`, outcome: `${key} is handled`
    }],
    updateTasks: [{ key: "existing-task", covers: ["existing-behavior", key] }],
    evidence: { [key]: { capabilities: ["test"] } }
  }, null, 2)}\n`);
  let state = {
    id, status: "building", semanticDraftVersion: 3,
    revision: 0, contractRevision: 0, executionRevision: 0
  };
  let rejectValidation = false;
  const lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" } }),
    securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: (parent, candidate) => {
      const rel = relative(parent, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`),
    slugify,
    changePath: () => change,
    loadRuntime: () => state,
    saveRuntime: (value) => { state = structuredClone(value); },
    validate: () => {
      assert.match(readFileSync(join(change, "tasks.md"), "utf8"), /\[x\]/);
      if (rejectValidation) throw new Error("synthetic validator failure");
    },
    now: () => "2026-09-03T00:00:00.000Z"
  });
  const priorLog = console.log;
  console.log = () => {};
  try {
    writeAmendment("malformed-row");
    lifecycle.amendChange(id, "amendment.json");
    assert.equal(state.contractRevision, 1);
    assert.equal(state.amendments.length, 1);
    assert.match(readFileSync(join(change, "tasks.md"), "utf8"),
      /\[x\].*existing-claim,malformed-row/);
    const spec = readFileSync(join(change, "specs", "payment-control", "spec.md"), "utf8");
    assert.ok(spec.indexOf("Requirement: malformed-row") < spec.indexOf("## Operator notes"));

    const before = {
      tasks: readFileSync(join(change, "tasks.md"), "utf8"),
      evidence: readFileSync(join(change, "evidence.yaml"), "utf8"),
      spec: readFileSync(join(change, "specs", "payment-control", "spec.md"), "utf8"),
      state: structuredClone(state)
    };
    writeAmendment("second-behavior");
    rejectValidation = true;
    assert.throws(() => lifecycle.amendChange(id, "amendment.json"),
      /synthetic validator failure; semantic amendment rolled back/);
    assert.equal(readFileSync(join(change, "tasks.md"), "utf8"), before.tasks);
    assert.equal(readFileSync(join(change, "evidence.yaml"), "utf8"), before.evidence);
    assert.equal(readFileSync(join(change, "specs", "payment-control", "spec.md"), "utf8"), before.spec);
    assert.deepEqual(state, before.state);
  } finally {
    console.log = priorLog;
  }
});
