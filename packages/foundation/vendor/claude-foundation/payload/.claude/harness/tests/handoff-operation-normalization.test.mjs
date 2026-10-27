import assert from "node:assert/strict";
import test from "node:test";
import {
  handoffRecordContentValid,
  handoffRecordIdentityValidity,
  handoffRecordValue,
  normalizeHandoffOperation,
  normalizeHandoffRecordInput,
  normalizedActivationProof,
  normalizedOperationReferences,
  recordHandoffOperation,
  requiredOperationString
} from "../runtime/workflow/handoff-runtime.mjs";

const fail = (message) => { throw new Error(message); };
const label = "change/handoffs.yaml operations[0]";

function operation(overrides = {}) {
  return {
    id: "H001",
    owner: "platform-team",
    environment: "production",
    authority: "change-manager",
    operation: "deploy release",
    timing: "post-land",
    activation: "activation-coupled",
    evidence: ["deployment-health", "tracking-reference"],
    runbook: "docs/runbook.md",
    rollback: "roll back deployment",
    claimIds: ["claim-b", "claim-a", "claim-a"],
    taskIds: ["t002", "T001", "T001"],
    ...overrides
  };
}

function context(overrides = {}) {
  return {
    assertNoSecretMaterial: () => {},
    safeId: (value, _pattern, _label, reject) => {
      const id = String(value || "").trim().toUpperCase();
      if (!/^H\d{3,}$/.test(id)) reject("invalid handoff id");
      return id;
    },
    defaultOwner: () => "devops-team",
    fail,
    ...overrides
  };
}

test("required operation strings trim values and enforce bounds", () => {
  assert.equal(requiredOperationString({ operation: " deploy " },
    "operation", label, fail), "deploy");
  assert.throws(() => requiredOperationString({}, "operation", label, fail),
    /\.operation is required/);
  assert.throws(() => requiredOperationString({ operation: "x".repeat(1001) },
    "operation", label, fail), /\.operation is too long/);
});

test("operation references deduplicate, sort, normalize tasks, and validate scope", () => {
  assert.deepEqual(normalizedOperationReferences(operation(), label, {
    claimIds: new Set(["claim-a", "claim-b"]),
    taskIds: new Set(["T001", "T002"])
  }, fail), {
    claimIds: ["claim-a", "claim-b"],
    taskIds: ["T001", "T002"]
  });
  assert.throws(() => normalizedOperationReferences(operation({ claimIds: [] }),
    label, {}, fail), /claimIds must be non-empty/);
  assert.throws(() => normalizedOperationReferences(operation({ claimIds: [" "] }),
    label, {}, fail), /claimIds must contain non-empty strings/);
  assert.throws(() => normalizedOperationReferences(operation({ taskIds: ["task"] }),
    label, {}, fail), /taskIds must contain stable task IDs/);
});

test("operation references reject unknown declared claims and tasks", () => {
  assert.throws(() => normalizedOperationReferences(operation(), label, {
    claimIds: new Set(["claim-a"])
  }, fail), /references unknown claim\(s\): claim-b/);
  assert.throws(() => normalizedOperationReferences(operation(), label, {
    taskIds: new Set(["T001"])
  }, fail), /references unknown task\(s\): T002/);
});

test("activation proof is required and claim-bound only for safe activation", () => {
  assert.equal(normalizedActivationProof({}, "activation-coupled",
    ["claim-a"], label, fail), null);
  assert.throws(() => normalizedActivationProof({ activationProof: {} },
    "activation-coupled", ["claim-a"], label, fail), /only valid/);
  assert.throws(() => normalizedActivationProof({}, "safe-before-activation",
    ["claim-a"], label, fail), /requires claimId and condition/);
  assert.throws(() => normalizedActivationProof({
    activationProof: { claimId: "claim-b", condition: "healthy" }
  }, "safe-before-activation", ["claim-a"], label, fail), /must be listed in claimIds/);
  assert.deepEqual(normalizedActivationProof({
    activationProof: { claimId: " claim-a ", condition: " healthy " }
  }, "safe-before-activation", ["claim-a"], label, fail), {
    claimId: "claim-a", condition: "healthy"
  });
});

test("normalization returns the canonical activation-coupled operation", () => {
  assert.deepEqual(normalizeHandoffOperation(context(), operation({
    id: " h007 ",
    owner: "",
    evidence: ["tracking-reference", "deployment-health", "tracking-reference"]
  }), 0, { id: "change" }), {
    id: "H007",
    owner: "devops-team",
    environment: "production",
    authority: "change-manager",
    operation: "deploy release",
    timing: "post-land",
    activation: "activation-coupled",
    evidence: ["deployment-health", "tracking-reference"],
    runbook: "docs/runbook.md",
    rollback: "roll back deployment",
    claimIds: ["claim-a", "claim-b"],
    taskIds: ["T001", "T002"]
  });
});

test("normalization includes canonical safe-before-activation proof", () => {
  const value = normalizeHandoffOperation(context(), operation({
    activation: "safe-before-activation",
    activationProof: { claimId: "claim-a", condition: "health is green" }
  }), 0);
  assert.deepEqual(value.activationProof, {
    claimId: "claim-a", condition: "health is green"
  });
});

test("normalization rejects shape, enum, evidence, owner, and secret failures", () => {
  assert.throws(() => normalizeHandoffOperation(context(), null, 0), /must be an object/);
  assert.throws(() => normalizeHandoffOperation(context(), operation({ timing: "during-land" }), 0),
    /timing must be pre-land\|post-land/);
  assert.throws(() => normalizeHandoffOperation(context(), operation({ activation: "manual" }), 0),
    /activation must be safe-before-activation\|activation-coupled/);
  assert.throws(() => normalizeHandoffOperation(context(), operation({ evidence: ["unknown"] }), 0),
    /evidence must contain supported evidence types/);
  assert.throws(() => normalizeHandoffOperation(context({ defaultOwner: () => "" }),
    operation({ owner: "" }), 0), /owner is required/);
  assert.throws(() => normalizeHandoffOperation(context({
    assertNoSecretMaterial: (_raw, secretLabel, reject) =>
      reject(`${secretLabel} cannot contain secret material`)
  }), operation(), 0), /cannot contain secret material/);
});

test("handoff record input validates status, authority, and required evidence", () => {
  const recordContext = { assertNoSecretMaterial: () => {}, fail };
  assert.deepEqual(normalizeHandoffRecordInput(recordContext, "change", {
    id: " h001 ", status: "completed", actor: " Nok ", reference: " OPS-1 ",
    evidence: " report-a, report-b, "
  }), {
    operationId: "H001", status: "completed", actor: "Nok", reference: "OPS-1",
    reason: "", evidenceReferences: ["report-a", "report-b"]
  });
  assert.throws(() => normalizeHandoffRecordInput(recordContext, "change", {
    status: "pending", actor: "Nok", reference: "OPS"
  }), /status must be/);
  assert.throws(() => normalizeHandoffRecordInput(recordContext, "change", {
    status: "accepted", reference: "OPS"
  }), /requires --actor/);
  assert.throws(() => normalizeHandoffRecordInput(recordContext, "change", {
    status: "completed", actor: "Nok", reference: "OPS"
  }), /requires --evidence/);
  assert.throws(() => normalizeHandoffRecordInput(recordContext, "change", {
    status: "rejected", actor: "Nok", reference: "OPS"
  }), /requires --reason/);
  assert.throws(() => normalizeHandoffRecordInput({
    ...recordContext,
    assertNoSecretMaterial: () => fail("secret")
  }, "change", {
    id: "H001", status: "accepted", actor: "Nok", reference: "OPS"
  }), /secret/);
});

test("handoff record value preserves history and prevents completed downgrade", () => {
  const recordContext = {
    operationDigest: () => "operation-digest", now: () => "now", fail
  };
  const selected = operation();
  const input = {
    status: "rejected", actor: "Nok", reference: "OPS", reason: "not approved",
    evidenceReferences: ["ignored"]
  };
  const value = handoffRecordValue(recordContext, "change", selected, input, {
    history: [{ status: "accepted" }]
  }, {});
  assert.equal(value.contractRevision, 0);
  assert.deepEqual(value.evidenceReferences, []);
  assert.equal(value.reason, "not approved");
  assert.equal(value.history.length, 2);
  assert.throws(() => handoffRecordValue(recordContext, "change", selected, {
    ...input, status: "accepted"
  }, { operationDigest: "operation-digest", status: "completed" }, {}),
  /cannot be downgraded/);
  const completed = handoffRecordValue(recordContext, "change", selected, {
    ...input, status: "completed", evidenceReferences: ["report"]
  }, { operationDigest: "operation-digest", status: "completed" }, {
    contractRevision: 3
  });
  assert.deepEqual(completed.evidenceReferences, ["report"]);
  assert.equal(completed.reason, null);
  assert.equal(completed.contractRevision, 3);
});

test("handoff record validity separates identity drift from status-specific content", () => {
  const base = {
    version: 1, changeId: "change", operationId: "H001", operationDigest: "digest",
    status: "accepted", actor: "Nok", reference: "OPS-1"
  };
  assert.equal(handoffRecordIdentityValidity(base, "change", "H001", "digest"), null);
  assert.equal(handoffRecordIdentityValidity({ ...base, version: 2 },
    "change", "H001", "digest"), "invalid");
  assert.equal(handoffRecordIdentityValidity({ ...base, changeId: "other" },
    "change", "H001", "digest"), "invalid");
  assert.equal(handoffRecordIdentityValidity({ ...base, operationId: "H002" },
    "change", "H001", "digest"), "invalid");
  assert.equal(handoffRecordIdentityValidity(base, "change", "H001", "other"), "stale");

  assert.equal(handoffRecordContentValid(base), true);
  for (const record of [
    { ...base, status: "pending" },
    { ...base, actor: " " },
    { ...base, reference: "" },
    { ...base, status: "completed" },
    { ...base, status: "completed", evidenceReferences: [] },
    { ...base, status: "rejected", reason: "" }
  ]) assert.equal(handoffRecordContentValid(record), false);
  assert.equal(handoffRecordContentValid({
    ...base, status: "completed", evidenceReferences: ["report-1"]
  }), true);
  assert.equal(handoffRecordContentValid({
    ...base, status: "rejected", reason: "not approved"
  }), true);
});

test("handoff record operation resolves, persists, and reports the operation", () => {
  const writes = [];
  const logs = [];
  const selected = operation();
  const operationContext = {
    handoffContract: () => ({ operations: [selected] }),
    recordPath: () => "/records/H001.json",
    operationDigest: () => "digest",
    pathExists: () => false,
    readJson: () => ({}),
    writeJson: (...args) => writes.push(args),
    loadRuntime: () => ({ contractRevision: 2 }),
    now: () => "now",
    assertNoSecretMaterial: () => {},
    fail,
    output: { log: (value) => logs.push(value) }
  };
  const record = recordHandoffOperation(operationContext, "change", {
    id: "H001", status: "accepted", actor: "Nok", reference: "OPS-1"
  });
  assert.equal(record.operationId, "H001");
  assert.equal(writes.length, 1);
  assert.match(logs[0], /HANDOFF H001 ACCEPTED/);
  assert.throws(() => recordHandoffOperation(operationContext, "change", {
    id: "H404", status: "accepted", actor: "Nok", reference: "OPS-1"
  }), /unknown handoff operation/);
});
