import assert from "node:assert/strict";
import test from "node:test";

import {
  materialSecurityTriggers
} from "../runtime/workflow/security-policy.mjs";

test("business validation labels do not create a trust boundary", () => {
  const labels = [
    "untrusted-input", "type-confusion-validation-bypass", "schema-validation"
  ];
  for (const intent of [
    "Reject boolean seat counts in a workspace API",
    "Validate a checkout discount representation",
    "Show a form error for malformed profile fields"
  ]) assert.deepEqual(materialSecurityTriggers(labels, intent), []);
});

test("real security, data, and explicit custom risks remain material", () => {
  const validation = ["untrusted-input", "type-confusion-validation-bypass"];
  assert.deepEqual(materialSecurityTriggers(validation,
    "Prevent an authorization bypass in workspace validation"), validation);
  assert.deepEqual(materialSecurityTriggers(validation,
    "Block SQL injection from malformed filters"), validation);
  assert.deepEqual(materialSecurityTriggers(["manual-review"],
    "Migrate customer records"), ["manual-review"]);
});
