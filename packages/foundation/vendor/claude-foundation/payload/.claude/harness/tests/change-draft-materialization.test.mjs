import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createChangeLifecycle,
  deriveDraftBookkeeping,
  draftDomainRows,
  groupDraftSpecs,
  materializeDraftSpecs,
  renderDraftDesign,
  renderDraftProposal,
  renderDraftSpecDocument,
  renderDraftTask,
  renderDraftTasks
} from "../runtime/workflow/change-lifecycle.mjs";

test("draft bookkeeping derives mechanical IDs and unambiguous bindings", () => {
  const value = deriveDraftBookkeeping({
    claims: [{ scenario: "Zero window returns nothing" }],
    tasks: [{ outcome: "Implement", paths: ["window.js"], verify: "node --test" }],
    execution: { providers: { test: { adapter: "test-discovery" } } },
    grounding: {
      claims: [{ productionPath: [] }],
      criticalCases: [{ input: "zero", expected: "empty" }]
    }
  }, (text) => text.toLowerCase().replaceAll(" ", "-"));
  assert.equal(value.claims[0].id, "zero-window-returns-nothing");
  assert.equal(value.tasks[0].id, "T001");
  assert.deepEqual(value.tasks[0].claims, ["zero-window-returns-nothing"]);
  assert.equal(value.grounding.claims[0].id, "zero-window-returns-nothing");
  assert.equal(value.grounding.criticalCases[0].id, "CC-001");
  assert.deepEqual(value.grounding.criticalCases[0].claimIds,
    ["zero-window-returns-nothing"]);
  assert.deepEqual(value.execution.providers.test.criticalCases, ["CC-001"]);
  assert.deepEqual(value.execution.providers.test.command,
    ["sh", "-lc", "node --test"]);
});

test("draft bookkeeping never guesses ambiguous multi-claim task bindings", () => {
  const value = deriveDraftBookkeeping({
    claims: [{ id: "one" }, { id: "two" }],
    tasks: [{ outcome: "A" }, { outcome: "B" }]
  }, String);
  assert.equal(value.tasks[0].claims, undefined);
  assert.equal(value.tasks[1].claims, undefined);
});

const draft = () => ({
  title: "Draft title", why: "Because", changes: ["One", "Two"],
  impact: "low", coupling: "isolated", surfaces: ["api", "ui"],
  securityTriggers: ["authentication"], nonGoals: ["No migration"],
  currentState: "Current", compatibility: "Compatible",
  domainLanguage: [{ term: "Draft", meaning: "Atomic input", avoid: "Chain" }],
  decisions: [{ choice: "Use JSON", why: "Atomic" }],
  risks: [{ risk: "Bad input", mitigation: "Validate", owner: "runtime" }],
  tasks: [
    {
      outcome: "Implement", verify: "npm test", repository: "api", kind: "code",
      paths: ["src/**"], dependsOn: ["T000"], resources: ["database"],
      claims: ["claim-1"], model: "strong", inputSchema: "request-v1",
      outputSchema: "result-v1"
    },
    { id: "CUSTOM", outcome: "Document", verify: "npm run docs" }
  ],
  claims: [{ id: "claim-1" }],
  execution: { version: 1 }, externalOperations: [{ id: "deploy" }],
  repositories: [{ id: "api" }], grounding: { version: 2 },
  specs: [
    {
      name: "Draft API", operation: "added", requirement: "Create",
      description: "Create it", scenarios: [{ name: "A", when: "x", then: "y" }]
    },
    {
      name: "Draft API", operation: "modified", requirement: "Change",
      description: "Change it", scenarios: [{ name: "B", when: "x", then: "z" }]
    },
    {
      name: "Old API", operation: "removed", requirement: "Remove",
      description: "Remove it", migration: "Move first", scenarios: []
    }
  ]
});

test("draft renderers preserve defaults, metadata and markdown sections", () => {
  const value = draft();
  assert.match(renderDraftProposal(value, { intent: "Fallback" }), /# Change: Draft title/);
  const defaults = { ...value, title: null, impact: null, coupling: null,
    surfaces: null, securityTriggers: null };
  const defaultProposal = renderDraftProposal(defaults, { intent: "Fallback" });
  for (const expected of [
    "# Change: Fallback", "**Impact:** medium", "**Coupling:** coupled",
    "**Affected surfaces:** code", "**Security triggers:** none"
  ]) assert.ok(defaultProposal.includes(expected));
  assert.match(renderDraftDesign(value), /Draft \| Atomic input \| Chain/);
  assert.match(draftDomainRows([]), /introduces no project-specific term/);
  assert.equal(renderDraftTask(value.tasks[0], 0),
    "- [ ] **T001** Implement [repo:api] [kind:code] [model:strong] [paths:src/**] [depends:T000] [resources:database] [claims:claim-1] [input-schema:request-v1] [output-schema:result-v1] — verify: `npm test`");
  assert.match(renderDraftTasks(value.tasks), /\*\*CUSTOM\*\* Document/);
});

test("spec grouping and document rendering order operations", (t) => {
  const value = draft();
  const grouped = groupDraftSpecs(value.specs, (name) => name.toLowerCase().replaceAll(" ", "-"));
  assert.equal(grouped.get("draft-api").length, 2);
  const rendered = renderDraftSpecDocument(grouped.get("draft-api"),
    (spec) => `REQ:${spec.requirement}`);
  assert.ok(rendered.indexOf("ADDED Requirements") < rendered.indexOf("MODIFIED Requirements"));
  const root = mkdtempSync(join(tmpdir(), "draft-spec-render-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  materializeDraftSpecs({
    basePath: root, specs: value.specs,
    slugify: (name) => name.toLowerCase().replaceAll(" ", "-"),
    renderRequirement: (spec) => `REQ:${spec.requirement}`
  });
  assert.match(readFileSync(join(root, "specs", "draft-api", "spec.md"), "utf8"),
    /REQ:Create[\s\S]*REQ:Change/);
  assert.match(readFileSync(join(root, "specs", "old-api", "spec.md"), "utf8"),
    /REMOVED Requirements/);
});

function lifecycleFixture(t, schema) {
  const root = mkdtempSync(join(tmpdir(), "draft-materialize-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = {
    intent: "State intent", impact: "high", coupling: "coupled", schema,
    groundingRequired: schema === "foundation-standard"
  };
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  writeJson(join(root, "evidence.yaml"), { version: 1, claims: [] });
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: {} }), securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: () => true,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")), writeJson,
    slugify: (name) => name.toLowerCase().replaceAll(" ", "-"),
    changePath: () => root, loadRuntime: () => state
  });
  return { root, lifecycle };
}

test("materializeDraft writes rapid artifacts without standard-only files", (t) => {
  const { root, lifecycle } = lifecycleFixture(t, "foundation-rapid");
  lifecycle.materializeDraft("change", draft());
  assert.match(readFileSync(join(root, "proposal.md"), "utf8"), /Draft title/);
  assert.match(readFileSync(join(root, "tasks.md"), "utf8"), /T001/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "evidence.yaml"), "utf8")).claims,
    [{ id: "claim-1" }]);
  assert.equal(existsSync(join(root, "design.md")), false);
});

test("materializeDraft writes standard design, grounding, repositories and specs", (t) => {
  const { root, lifecycle } = lifecycleFixture(t, "foundation-standard");
  lifecycle.materializeDraft("change", draft());
  assert.match(readFileSync(join(root, "design.md"), "utf8"), /## Decisions/);
  assert.equal(JSON.parse(readFileSync(join(root, "grounding.yaml"), "utf8")).version, 2);
  assert.equal(JSON.parse(readFileSync(join(root, "execution.yaml"), "utf8")).version, 1);
  assert.equal(JSON.parse(readFileSync(join(root, "repositories.yaml"), "utf8")).version, 1);
  assert.match(readFileSync(join(root, "specs", "draft-api", "spec.md"), "utf8"),
    /Scenario: A[\s\S]*Scenario: B/);
});
