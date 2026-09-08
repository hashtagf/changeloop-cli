import assert from "node:assert/strict";
import test from "node:test";
import {
  proofPreflightAdvisory,
  proofPreflightBlockers,
  proofPreflightFailure,
  proofPreflightOperation
} from "../runtime/evidence/proof-readiness.mjs";

function readiness(overrides = {}) {
  return {
    status: "READY",
    workspaceHash: "workspace-hash",
    issues: [],
    externalProviders: [],
    unavailableProviders: [],
    pendingTasks: [],
    advisories: [],
    next: [],
    ...overrides
  };
}

test("preflight blockers preserve every blocker category", () => {
  assert.deepEqual(proofPreflightBlockers(readiness({
    issues: ["configuration drift"],
    repositoryIssues: ["api binding missing"],
    externalProviders: ["review"],
    unavailableProviders: ["test:command-missing"],
    pendingTasks: [{ id: "task-1" }, { id: "task-2" }]
  })), [
    "configuration drift",
    "api binding missing",
    "provider 'review' has no executable adapter or valid external receipt",
    "provider unavailable: test:command-missing",
    "2 implementation task(s) remain unchecked"
  ]);
});

test("preflight failure renders recovery and full-detail route", () => {
  const value = readiness({ status: "NEEDS_USER_DECISION" });
  assert.equal(proofPreflightFailure("change", value, ["review required"], [
    "    claude-foundation authority request change --type review"
  ]), "proof preflight failed: review required\n\nhow to clear this (NEEDS_USER_DECISION):\n" +
    "    claude-foundation authority request change --type review\n\n" +
    "full detail: claude-foundation proof readiness change");
  assert.equal(proofPreflightFailure("change", value, ["review required"], []),
    "proof preflight failed: review required\n\nfull detail: claude-foundation proof readiness change");
});

test("preflight operation rejects blockers with rendered recovery", () => {
  const value = readiness({
    status: "CONFIGURATION_ERROR",
    issues: ["configuration drift"],
    next: [{ verify: "claude-foundation change validate change" }]
  });
  assert.throws(() => proofPreflightOperation({
    proofReadinessValue: (id, stage) => {
      assert.equal(id, "change");
      assert.equal(stage, "land");
      return value;
    },
    recoveryLines: () => ["    claude-foundation change validate change"],
    fail: (message) => { throw new Error(message); }
  }, "change", "land"), /how to clear this \(CONFIGURATION_ERROR\):[\s\S]*change validate/);
});

test("ready preflight reports stage, workspace and both advisory forms", () => {
  const logs = [];
  const errors = [];
  const value = readiness({ advisories: [
    {
      capability: "accessibility",
      reason: "user-waived",
      authority: { reference: "ADR-7" },
      detail: "not applicable"
    },
    { capability: "security", trigger: "auth/**" }
  ] });
  assert.equal(proofPreflightOperation({
    proofReadinessValue: () => value,
    recoveryLines: () => [],
    fail: assert.fail,
    output: {
      log: (message) => logs.push(message),
      error: (message) => errors.push(message)
    }
  }, "change", "build"), true);
  assert.match(logs[0], /PROOF PREFLIGHT change: ready[\s\S]*stage: build[\s\S]*workspace-hash/);
  assert.equal(errors[0],
    "  WAIVED accessibility: withdrawn by ADR-7 — not applicable; not blocking");
  assert.equal(errors[1],
    "  ADVISORY security: inferred from auth/** with no provider wired; not blocking");
});

test("quiet ready preflight emits nothing", () => {
  const output = { log: assert.fail, error: assert.fail };
  assert.equal(proofPreflightOperation({
    proofReadinessValue: () => readiness(),
    recoveryLines: () => [],
    fail: assert.fail,
    output
  }, "change", "prove", true), true);
});

test("advisory fallbacks retain established wording", () => {
  assert.equal(proofPreflightAdvisory({ capability: "review", reason: "user-waived" }),
    "  WAIVED review: withdrawn by user decision; not blocking");
  assert.equal(proofPreflightAdvisory({ capability: "resilience" }),
    "  ADVISORY resilience: inferred from the changed surface with no provider wired; not blocking");
});
