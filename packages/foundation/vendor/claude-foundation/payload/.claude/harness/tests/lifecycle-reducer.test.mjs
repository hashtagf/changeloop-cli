import assert from "node:assert/strict";
import test from "node:test";

import {
  lifecycleTransitionValue, transitionLifecycleState
} from "../runtime/core/lifecycle-reducer.mjs";

test("lifecycle reducer returns one typed transition outcome", () => {
  const state = { status: "change" };
  assert.deepEqual(transitionLifecycleState(state, "building", "sandbox-created"), {
    version: 1, from: "change", to: "building", changed: true,
    outcome: "transitioned", reason: "sandbox-created"
  });
  assert.equal(state.status, "building");
  assert.equal(transitionLifecycleState(state, "building").outcome, "unchanged");
});

test("lifecycle reducer permits recovery edges and rejects impossible resurrection", () => {
  assert.equal(lifecycleTransitionValue({ status: "change" }, "proven").to,
    "proven");
  assert.equal(lifecycleTransitionValue({ status: "resolved" }, "building").to,
    "building");
  assert.equal(lifecycleTransitionValue({ status: "proven" }, "building",
    "proof-invalidated").to, "building");
  assert.equal(lifecycleTransitionValue({ status: "applied" }, "proven").to,
    "proven");
  assert.equal(lifecycleTransitionValue({ status: "applied" }, "archived").to,
    "archived");
  assert.throws(() => lifecycleTransitionValue({ status: "archived" }, "building"),
    /invalid lifecycle transition/);
  assert.throws(() => lifecycleTransitionValue({ status: "change" }, "unknown"),
    /unknown lifecycle target/);
});
