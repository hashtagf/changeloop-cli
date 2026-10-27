import assert from "node:assert/strict";
import test from "node:test";

import {
  createModelRouter,
  defaultTaskModelTier,
  modelForTaskOperation,
  taskIsHighRisk
} from "../runtime/workflow/agent-planning.mjs";

const models = {
  fast: { family: "fast-family", fallbackTier: null },
  standard: { family: "standard-family", fallbackTier: "fast" },
  deep: { family: "deep-family", fallbackTier: "standard" }
};
const selectedPolicy = { models };
const fail = (message) => { throw new Error(message); };

test("task risk recognizes impact, security triggers, and drift-blocking kinds", () => {
  assert.equal(taskIsHighRisk({ impact: "high" }, { kind: "code" }), true);
  assert.equal(taskIsHighRisk({ securityTriggers: ["auth"] }, { kind: "code" }), true);
  assert.equal(taskIsHighRisk({}, { kind: "architecture" }), true);
  assert.equal(taskIsHighRisk({ securityTriggers: [] }, { kind: "code" }), false);
});

test("default model tier selects deep, fast, and standard lanes", () => {
  assert.equal(defaultTaskModelTier({ kind: "migration" }, true), "deep");
  for (const kind of ["inventory", "logs", "mechanical-docs"])
    assert.equal(defaultTaskModelTier({ kind }, false), "fast");
  assert.equal(defaultTaskModelTier({ kind: "code" }, false), "standard");
  assert.equal(defaultTaskModelTier({ kind: "inventory" }, true), "standard");
});

function context(state = {}) {
  return { loadRuntime: () => state, policy: () => selectedPolicy, fail };
}

test("model operation routes default tiers and resolves fallback families", () => {
  assert.deepEqual(modelForTaskOperation(context(), "change", {
    id: "TASK-1", kind: "inventory"
  }, selectedPolicy), {
    tier: "fast", family: "fast-family", fallbackTier: null,
    fallbackFamily: null, reason: "inventory task"
  });
  assert.deepEqual(modelForTaskOperation(context(), "change", {
    id: "TASK-2", kind: "code"
  }, selectedPolicy), {
    tier: "standard", family: "standard-family", fallbackTier: "fast",
    fallbackFamily: "fast-family", reason: "code task"
  });
  assert.equal(modelForTaskOperation(context(), "change", {
    id: "TASK-3", kind: "architecture"
  }, selectedPolicy).tier, "deep");
});

test("requested tiers are validated and fast is promoted for high risk", () => {
  assert.equal(modelForTaskOperation(context({ impact: "high" }), "change", {
    id: "TASK-1", kind: "inventory", requestedModel: "fast"
  }, selectedPolicy).tier, "standard");
  assert.equal(modelForTaskOperation(context(), "change", {
    id: "TASK-2", kind: "code", requestedModel: "deep"
  }, selectedPolicy).tier, "deep");
  assert.throws(() => modelForTaskOperation(context(), "change", {
    id: "TASK-X", kind: "code", requestedModel: "turbo"
  }, selectedPolicy), /TASK-X.*fast\|standard\|deep/);
});

test("model router uses configured policy by default and accepts an override", () => {
  const router = createModelRouter({
    loadRuntime: () => ({}), policy: () => selectedPolicy, fail
  });
  assert.equal(router.modelForTask("change", {
    id: "TASK-1", kind: "code"
  }).family, "standard-family");
  assert.equal(router.modelForTask("change", {
    id: "TASK-2", kind: "code", requestedModel: "deep"
  }, { models: { ...models, deep: { family: "override", fallbackTier: null } } })
    .family, "override");
});
