import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWaivableCapability,
  revokeGateWaiver,
  waiveGateOperation,
  waiverRequest
} from "../runtime/workflow/change-validation.mjs";

const fail = (message) => { throw new Error(message); };

test("waiver request trims authority fields and requires capability and decision", () => {
  assert.deepEqual(waiverRequest({
    capability: " test ", "decision-ref": " decision:1 ", reason: " why "
  }, fail), { capability: "test", decisionRef: "decision:1", reason: "why" });
  assert.throws(() => waiverRequest({}, fail), /requires --capability/);
  assert.throws(() => waiverRequest({ capability: "test" }, fail),
    /requires --decision-ref/);
});

function fixture({ required = ["test"], state = {} } = {}) {
  const saves = [];
  const logs = [];
  const context = {
    loadRuntime: () => state,
    saveRuntime: (value) => saves.push(value),
    requiredProviders: () => required,
    providerCapability: (_provider, config) => config.capability,
    providerConfig: (_id, provider) => ({ capability: provider }),
    now: () => "recorded-at",
    fail,
    log: (message) => logs.push(message)
  };
  return { context, state, saves, logs };
}

test("waivable capability validates reason, protected routes, duplicates, and requirement", () => {
  const world = fixture();
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "test", reason: ""
  }, []), /requires --reason/);
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "review", reason: "why"
  }, []), /review cannot be waived/);
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "acceptance", reason: "why"
  }, []), /withdraw the requirement/);
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "test", reason: "why"
  }, [{ capability: "test" }]), /already waived/);
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "missing", reason: "why"
  }, []), /nothing to waive/);
  assert.doesNotThrow(() => assertWaivableCapability(world.context, "change", {
    capability: "test", reason: "why"
  }, []));
  const aliased = fixture({ required: ["provider-id"] });
  aliased.context.providerConfig = () => ({ capability: "security-static" });
  assert.doesNotThrow(() => assertWaivableCapability(
    aliased.context, "change", { capability: "security-static", reason: "why" }, []));
});

test("waiver revocation removes the gate and writes the recovery message", () => {
  const world = fixture({ state: {
    waivers: [{ capability: "test" }, { capability: "other" }]
  } });
  revokeGateWaiver(world.context, "change", world.state, world.state.waivers,
    { capability: "test" });
  assert.deepEqual(world.state.waivers, [{ capability: "other" }]);
  assert.equal(world.saves.length, 1);
  assert.match(world.logs[0], /WAIVER REVOKED change\/test/);
  assert.throws(() => revokeGateWaiver(
    world.context, "change", world.state, world.state.waivers,
    { capability: "missing" }), /no recorded waiver/);
});

test("waive operation records durable authority and supports legacy empty state", () => {
  const world = fixture();
  waiveGateOperation(world.context, "change", {
    capability: "test", "decision-ref": "decision:1", reason: "risk accepted"
  });
  assert.deepEqual(world.state.waivers, [{
    capability: "test", reason: "risk accepted",
    authority: { kind: "host-user-decision", reference: "decision:1" },
    recordedAt: "recorded-at"
  }]);
  assert.equal(world.saves.length, 1);
  assert.match(world.logs[0], /GATE WAIVED change\/test/);
  assert.match(world.logs[0], /decision: decision:1/);
});

test("waive operation handles revocation and refuses archived changes", () => {
  const revoke = fixture({ state: { waivers: [{ capability: "test" }] } });
  waiveGateOperation(revoke.context, "change", {
    capability: "test", "decision-ref": "decision:2", revoke: true
  });
  assert.deepEqual(revoke.state.waivers, []);
  assert.match(revoke.logs[0], /WAIVER REVOKED/);

  const archived = fixture({ state: { status: "archived" } });
  assert.throws(() => waiveGateOperation(archived.context, "change", {
    capability: "test", "decision-ref": "decision:3", reason: "why"
  }), /already archived/);
  assert.equal(archived.saves.length, 0);
});
