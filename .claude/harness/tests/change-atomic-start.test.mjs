import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createChangeLifecycle } from "../runtime/workflow/change-lifecycle.mjs";
import { assertSpecApproval, reviewWindowRemaining, REVIEW_WINDOW_MS } from "../runtime/core/user-decisions.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function draft(overrides = {}) {
  return {
    version: 1,
    id: "atomic-change",
    intent: "Create one atomic change",
    why: "Avoid partial change state",
    currentState: "Draft creation can fail after persistence",
    compatibility: "No compatibility impact",
    changes: ["Publish the agreement only after validation"],
    nonGoals: ["No product implementation"],
    decisions: [{ choice: "Use rollback", why: "Keep retries clean" }],
    risks: [{ risk: "Partial state", mitigation: "Rollback", owner: "runtime" }],
    tasks: [{ id: "T001", outcome: "Implement atomically", verify: "npm test" }],
    claims: [{
      id: "atomic-outcome", scenario: "Atomic start succeeds", impact: "low",
      capabilities: ["test"]
    }],
    specs: [{
      name: "atomic-change", operation: "added", requirement: "Atomic start",
      description: "The runtime SHALL avoid partial state.",
      scenarios: [{ name: "Rollback", when: "start fails", then: "state is removed" }]
    }],
    acceptance: { required: false, reason: null, claimIds: [] },
    impact: "low",
    coupling: "isolated",
    securityTriggers: [],
    execution: {
      version: 1,
      providers: { test: { adapter: "test-discovery", command: ["npm", "test"] } },
      services: {}
    },
    ...overrides
  };
}

function fixture(t, { validationFailure = null, sandboxFailure = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-atomic-start-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const changes = join(root, "openspec", "changes");
  const runtime = join(root, ".foundation", "runtime");
  const calls = { draftReads: 0, rollback: 0, sequence: [] };
  for (const schema of ["foundation-rapid", "foundation-standard"]) {
    const templates = join(root, "openspec", "schemas", schema, "templates");
    mkdirSync(templates, { recursive: true });
    writeFileSync(join(templates, "proposal.md"), "# <title>\n");
    writeFileSync(join(templates, "tasks.md"), "- [ ] **T001** replace-with-task\n");
    writeJson(join(templates, "evidence.yaml"), {
      version: 2,
      claims: [{
        id: "replace-with-stable-claim-id", scenario: "replace-with", impact: "low",
        capabilities: ["test"]
      }]
    });
    writeJson(join(templates, "execution.yaml"), { version: 1, providers: {}, services: {} });
    writeJson(join(templates, "repositories.yaml"), {
      version: 1, repositories: [{ id: "root", mode: "write", dependsOn: [] }]
    });
    writeJson(join(templates, "handoffs.yaml"), { version: 1, operations: [] });
    writeFileSync(join(templates, "design.md"), "# Design for <title>\n");
    writeFileSync(join(templates, "spec.md"), "## ADDED Requirements\n");
  }
  const draftPath = join(root, "draft.json");
  writeJson(draftPath, draft());
  const fail = (message) => { throw new Error(message); };
  const lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" }, land: {} }),
    securityTerms: ["authentication"],
    fail,
    pathInside: () => true,
    readJson: (path) => {
      if (path === draftPath) calls.draftReads += 1;
      return JSON.parse(readFileSync(path, "utf8"));
    },
    writeJson,
    slugify: (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    changePath: (id) => join(changes, id),
    loadRuntime: (id) => JSON.parse(readFileSync(join(runtime, `${id}.json`), "utf8")),
    saveRuntime: (state) => writeJson(join(runtime, `${state.id}.json`), state),
    setOperationChangeId: () => {},
    initialBudget: () => ({}),
    gitHead: () => "head",
    preexistingDirty: () => ({}),
    now: () => "2026-09-02T00:00:00.000Z",
    bindClaudeSession: () => { calls.sequence.push("bind"); },
    validate: (...args) => {
      calls.sequence.push({ validate: args });
      if (validationFailure) throw new Error(validationFailure);
    },
    createSandbox: () => {
      calls.sequence.push("sandbox");
      if (sandboxFailure) throw new Error(sandboxFailure);
    },
    showPacket: () => { calls.sequence.push("packet"); },
    measureStage: (_stage, operation) => operation(),
    trapFailures: (operation) => operation(),
    rollbackStart: (id) => {
      calls.rollback += 1;
      rmSync(join(changes, id), { recursive: true, force: true });
      rmSync(join(runtime, `${id}.json`), { force: true });
      return [];
    }
  });
  return { root, changes, runtime, draftPath, lifecycle, calls };
}

test("atomic start reads once, validates explicitly, then publishes agreement state", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath);
  assert.equal(value.calls.draftReads, 1);
  assert.equal(value.calls.rollback, 0);
  assert.deepEqual(value.calls.sequence.map((entry) =>
    typeof entry === "string" ? entry : "validate"),
  ["validate", "bind"]);
  assert.deepEqual(value.calls.sequence[0].validate, ["atomic-change", "root"]);
  assert.equal(existsSync(join(value.changes, "atomic-change")), true);
  assert.equal(existsSync(join(value.runtime, "atomic-change.json")), true);
  assert.equal(JSON.parse(readFileSync(join(value.runtime, "atomic-change.json"))).status, "change");
});

test("atomic start consumes its transient draft only after success", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath, { consumeDraft: true });
  assert.equal(existsSync(value.draftPath), false);
  assert.equal(existsSync(join(value.changes, "atomic-change")), true);
});

test("spec approval is explicit, content-bound, and separate from edits", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath);
  const statePath = join(value.runtime, "atomic-change.json");
  const state = () => JSON.parse(readFileSync(statePath));
  assert.throws(() => assertSpecApproval(value.root, "atomic-change", state()), { code: "SPEC_APPROVAL_REQUIRED" });
  assert.throws(() => value.lifecycle.resolveChange("atomic-change", { "approve-spec": true }), /decision-ref/);
  assert.throws(() => value.lifecycle.resolveChange("atomic-change", {
    "approve-spec": true, "decision-ref": "fixture://approval", impact: "high"
  }), /separately from agreement edits/);
  value.lifecycle.resolveChange("atomic-change", { "approve-spec": true, "decision-ref": "fixture://approval" });
  assert.doesNotThrow(() => assertSpecApproval(value.root, "atomic-change", state()));
  writeFileSync(join(value.changes, "atomic-change", "proposal.md"), "Different behavior");
  assert.throws(() => assertSpecApproval(value.root, "atomic-change", state()), { code: "SPEC_APPROVAL_REQUIRED" });
});

test("review continuation requires authority and preserves the previous window", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath);
  const path = join(value.runtime, "atomic-change.json");
  const state = JSON.parse(readFileSync(path));
  state.reviewWindow = { deadline: "2026-09-01T00:30:00Z" };
  writeJson(path, state);
  assert.throws(() => value.lifecycle.resolveChange("atomic-change", { "continue-review": true }), /decision-ref/);
  value.lifecycle.resolveChange("atomic-change", { "continue-review": true, "decision-ref": "fixture://continue" });
  const next = JSON.parse(readFileSync(path));
  assert.deepEqual(next.reviewWindowHistory, [state.reviewWindow]);
  assert.equal(next.reviewWindow.decisionRef, "fixture://continue");
  assert.equal(reviewWindowRemaining(next, Date.parse("2026-09-02T00:00:00Z")), REVIEW_WINDOW_MS);
});

test("atomic start removes change and runtime state after late validation failure", (t) => {
  const value = fixture(t, { validationFailure: "invalid compiled packet" });
  assert.throws(() => value.lifecycle.startAtomic(value.draftPath, { consumeDraft: true }),
    /invalid compiled packet; partial atomic start rolled back/);
  assert.equal(value.calls.rollback, 1);
  assert.equal(existsSync(join(value.changes, "atomic-change")), false);
  assert.equal(existsSync(join(value.runtime, "atomic-change.json")), false);
  assert.equal(existsSync(value.draftPath), true);
  assert.deepEqual(value.calls.sequence.map((entry) =>
    typeof entry === "string" ? entry : "validate"), ["validate"]);
});

test("atomic start defers sandbox creation even when the later sandbox would fail", (t) => {
  const value = fixture(t, { sandboxFailure: "sandbox unavailable" });
  value.lifecycle.startAtomic(value.draftPath);
  assert.equal(value.calls.rollback, 0);
  assert.equal(existsSync(join(value.changes, "atomic-change")), true);
  assert.equal(existsSync(join(value.runtime, "atomic-change.json")), true);
  assert.deepEqual(value.calls.sequence.map((entry) =>
    typeof entry === "string" ? entry : "validate"), ["validate", "bind"]);
});

test("atomic start never rolls back a pre-existing change", (t) => {
  const value = fixture(t);
  const existing = join(value.changes, "atomic-change");
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, "owned-by-user"), "keep\n");
  assert.throws(() => value.lifecycle.startAtomic(value.draftPath), /change already exists/);
  assert.equal(value.calls.rollback, 0);
  assert.equal(readFileSync(join(existing, "owned-by-user"), "utf8"), "keep\n");
});
