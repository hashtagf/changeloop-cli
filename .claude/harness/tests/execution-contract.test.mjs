import assert from "node:assert/strict";
import test from "node:test";

import {
  compileExecutionContractValue, workspaceCapabilityValue,
  workspaceMutationDecision
} from "../runtime/core/execution-contract.mjs";

test("workspace capabilities are derived from lifecycle phase", () => {
  assert.equal(workspaceCapabilityValue("x", { status: "change" }).mode,
    "agreement-only");
  assert.deepEqual(workspaceCapabilityValue("x", {
    status: "building", workspace: { path: "/sandbox/x" }
  }).roots, ["/sandbox/x"]);
  assert.equal(workspaceCapabilityValue("x", { status: "proven" }).mode,
    "evidence-state-only");
  assert.equal(workspaceCapabilityValue("x", { status: "unexpected" }).mode,
    "fail-closed");
});

test("one versioned contract binds risk evidence authority workspace budgets and Land", () => {
  const authority = {
    status: "READY",
    requirements: { signedCi: { required: true } }
  };
  const value = compileExecutionContractValue({
    changeId: "change-a",
    state: {
      status: "building", revision: 2, contractRevision: 3, executionRevision: 4,
      impact: "high", coupling: "coupled", securityTriggers: ["auth"],
      workspace: { path: "/sandbox/a" }, budget: { requests: { limit: 20 } }
    },
    review: { tier: "high", required: true },
    providers: ["test", "ci", "test"],
    providerCapabilities: { test: "test", ci: "test" },
    authority,
    repositories: [{ id: "root", mode: "write", dependsOn: [] }],
    handoffs: { status: "WAITING_EXTERNAL", blocking: ["DEPLOY-1"] }
  });
  assert.equal(value.version, 1);
  assert.deepEqual(value.revisions, { change: 2, contract: 3, execution: 4 });
  assert.deepEqual(value.evidence.providers, ["ci", "test"]);
  assert.equal(value.workspace.mode, "isolated-workspace");
  assert.equal(value.land.signedCiRequired, true);
  assert.deepEqual(value.land.blockingHandoffs, ["DEPLOY-1"]);
  assert.match(value.fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("risk-relevant changes alter the execution contract fingerprint", () => {
  const base = {
    changeId: "change-a",
    state: { status: "change", revision: 1, impact: "low", coupling: "isolated" },
    authority: { status: "READY", requirements: { signedCi: { required: false } } }
  };
  const first = compileExecutionContractValue(base);
  const changed = compileExecutionContractValue({
    ...base, state: { ...base.state, impact: "high" }
  });
  assert.notEqual(first.fingerprint, changed.fingerprint);
});

test("the shared capability check fails closed for wrong-side mutations", () => {
  const contains = (target, root) => target === root || target.startsWith(`${root}/`);
  assert.equal(workspaceMutationDecision({
    capability: { phase: "build", roots: ["/sandbox"] },
    target: "/sandbox/src/a.js", foundationRoot: "/project/.foundation",
    investigationRoot: "/project/openspec/investigations", contains
  }).allowed, true);
  assert.match(workspaceMutationDecision({
    capability: { phase: "build", roots: ["/sandbox"] },
    target: "/project/src/a.js", foundationRoot: "/project/.foundation",
    investigationRoot: "/project/openspec/investigations", contains
  }).reason, /outside its isolated workspace/);
  assert.match(workspaceMutationDecision({
    capability: { phase: "land", roots: ["/project/.foundation"] },
    target: "/project/src/a.js", foundationRoot: "/project/.foundation",
    investigationRoot: "/project/openspec/investigations", contains
  }).reason, /transaction marker/);
});
