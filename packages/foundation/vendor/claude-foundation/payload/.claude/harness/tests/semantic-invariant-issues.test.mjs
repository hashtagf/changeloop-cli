import assert from "node:assert/strict";
import test from "node:test";

import {
  compatibilityInvariantBindingIssues,
  semanticInvariantCollectionIssues,
  semanticInvariantIdentityIssues,
  semanticInvariantIssues,
  semanticInvariantReferenceIssues
} from "../runtime/workflow/change-validation.mjs";

test("semantic invariant identity validates stable unique IDs and statements", () => {
  const ids = new Set();
  assert.deepEqual(semanticInvariantIdentityIssues({
    id: "INV-API", statement: "API parity"
  }, "row", ids), []);
  assert.deepEqual(semanticInvariantIdentityIssues({
    id: "inv-api", statement: ""
  }, "next", ids), [
    "next.id 'inv-api' is duplicated",
    "next.statement is required"
  ]);
  assert.deepEqual(semanticInvariantIdentityIssues(null, "empty", ids), [
    "empty.id must match INV-<stable-id>",
    "empty.statement is required"
  ]);
});

test("semantic invariant collections require every non-empty array", () => {
  assert.deepEqual(semanticInvariantCollectionIssues({
    decisionIds: [], claimIds: "claim", specScenarios: null
  }, "row"), [
    "row.decisionIds must be a non-empty array",
    "row.claimIds must be a non-empty array",
    "row.specScenarios must be a non-empty array"
  ]);
  assert.deepEqual(semanticInvariantCollectionIssues({
    decisionIds: ["DEC-1"], claimIds: ["claim"], specScenarios: ["scenario"]
  }, "row"), []);
});

test("semantic invariant references bind claims and report unknown targets in order", () => {
  const context = {
    decisionIds: new Set(["DEC-1"]),
    claims: new Map([["known", { id: "known" }]]),
    scenarioNames: new Set(["known scenario"]),
    boundClaims: new Set()
  };
  assert.deepEqual(semanticInvariantReferenceIssues({
    decisionIds: ["DEC-1", "DEC-X"],
    claimIds: ["known", "missing"],
    specScenarios: ["KNOWN SCENARIO", "missing scenario"]
  }, "row", context), [
    "row references unknown decision 'DEC-X'",
    "row references unknown claim 'missing'",
    "row references unknown spec scenario 'missing scenario'"
  ]);
  assert.deepEqual([...context.boundClaims], ["known", "missing"]);
  assert.deepEqual(semanticInvariantReferenceIssues({}, "empty", context), []);
});

test("compatibility binding recognizes either compatibility capability", () => {
  const claims = new Map([
    ["plain", { id: "plain", capabilities: ["test"] }],
    ["compat", { id: "compat", capabilities: ["compatibility"] }],
    ["cross", { id: "cross", capabilities: ["cross-repo-contract"] }],
    ["empty", { id: "empty" }]
  ]);
  assert.deepEqual(compatibilityInvariantBindingIssues(
    claims, new Set(["compat"])), [
    "compatibility claim 'cross' requires a semantic invariant binding; add {id, statement, decisionIds:[...], claimIds:[...], specScenarios:[...]} to grounding.yaml semanticInvariants"
  ]);
});

test("semantic invariant operation preserves required and complete contracts", () => {
  assert.deepEqual(semanticInvariantIssues(undefined, {}, new Set(), new Set(), {
    required: true
  }), ["grounding.yaml semanticInvariants must be an array"]);
  assert.deepEqual(semanticInvariantIssues([{
    id: "INV-API", statement: "API parity",
    decisionIds: ["DEC-1"], claimIds: ["compat"],
    specScenarios: ["API Scenario"]
  }], { claims: [{ id: "compat", capabilities: ["compatibility"] }] },
  new Set(["DEC-1"]), new Set(["api scenario"]), { required: true }), []);
});

test("semantic invariant operation retains row issue ordering and unbound claims", () => {
  assert.deepEqual(semanticInvariantIssues([null, {
    id: "bad", statement: "ok", decisionIds: ["DEC-X"],
    claimIds: ["missing"], specScenarios: ["unknown"]
  }], { claims: [{ id: "compat", capabilities: ["compatibility"] }] },
  new Set(), new Set(), { required: false }), [
    "semanticInvariants[0].id must match INV-<stable-id>",
    "semanticInvariants[0].statement is required",
    "semanticInvariants[0].decisionIds must be a non-empty array",
    "semanticInvariants[0].claimIds must be a non-empty array",
    "semanticInvariants[0].specScenarios must be a non-empty array",
    "semanticInvariants[1].id must match INV-<stable-id>",
    "semanticInvariants[1] references unknown decision 'DEC-X'",
    "semanticInvariants[1] references unknown claim 'missing'",
    "semanticInvariants[1] references unknown spec scenario 'unknown'",
    "compatibility claim 'compat' requires a semantic invariant binding; add {id, statement, decisionIds:[...], claimIds:[...], specScenarios:[...]} to grounding.yaml semanticInvariants"
  ]);
});
