import assert from "node:assert/strict";
import test from "node:test";

import {
  durableDecisionBlockIssues,
  durableDecisionGraphIssues,
  durableDecisionMetadataIssues,
  durableDecisionReciprocityIssues,
  durableDecisionReferenceIssues,
  durableDecisionSection,
  durableDecisionStatusIssues,
  durableDecisionValues,
  localDecisionReference,
  parseDurableDecisions
} from "../runtime/workflow/change-validation.mjs";

const fields = [
  "Status", "Decision", "Why", "Rejected", "Consequences",
  "Supersedes", "Superseded by"
];

function decisionBlock(id, overrides = {}, extra = "") {
  const values = {
    Status: "accepted",
    Decision: "Use bounded packets",
    Why: "Keep execution deterministic",
    Rejected: "Unbounded execution",
    Consequences: "Packets are explicit",
    Supersedes: "none",
    "Superseded by": "none",
    ...overrides
  };
  const metadata = fields
    .filter((field) => values[field] !== null)
    .map((field) => `  - **${field}:** ${values[field]}`)
    .join("\n");
  return `- **Decision ID:** ${id}\n${metadata}${extra}`;
}

function design(section) {
  return `## Decisions\n\n${section}\n\n## Compatibility and migration\n\nnone\n`;
}

function parsed(section) {
  const value = durableDecisionSection(design(section));
  assert.equal(value.issues, null);
  return parseDurableDecisions(value.section, value.starts);
}

test("decision section recognizes missing, none, legacy, and unidentified content", () => {
  assert.deepEqual(durableDecisionMetadataIssues(""),
    ["design.md requires a Decisions section"]);
  assert.deepEqual(durableDecisionMetadataIssues(design("`none`.")), []);
  assert.match(durableDecisionMetadataIssues(design(
    "- **Decision:** legacy"))[0], /legacy Decision entries/);
  assert.match(durableDecisionMetadataIssues(design(
    "<!-- template only -->"))[0], /stable Decision ID/);
});

test("decision blocks report prefix, identity, duplication, fields, and status issues", () => {
  const malformed = [
    "intro outside a block",
    decisionBlock("bad", { Status: "proposed", Why: null }, "\nfree text"),
    decisionBlock("bad")
  ].join("\n");
  const result = parsed(malformed);
  assert.ok(result.issues.some((issue) => /outside a Decision ID block/.test(issue)));
  assert.ok(result.issues.some((issue) => /ID must match/.test(issue)));
  assert.ok(result.issues.some((issue) => /is duplicated/.test(issue)));
  assert.ok(result.issues.some((issue) => /outside its metadata fields/.test(issue)));
  assert.ok(result.issues.some((issue) => /requires Why/.test(issue)));
  assert.ok(result.issues.some((issue) => /Status must be/.test(issue)));
});

test("decision value and block helpers preserve valid metadata", () => {
  const block = decisionBlock("DEC-ONE");
  const values = durableDecisionValues(block);
  assert.equal(values.Status, "accepted");
  assert.deepEqual(durableDecisionBlockIssues(
    block, "DEC-ONE", new Set(), values), []);
});

test("decision references accept none and external IDs but reject invalid local IDs", () => {
  const decision = {
    id: "DEC-ONE", label: "decision 'DEC-ONE'", values: {}
  };
  const byId = new Map([[decision.id, decision]]);
  assert.deepEqual(durableDecisionReferenceIssues(
    decision, "Supersedes", "none", byId), []);
  assert.deepEqual(durableDecisionReferenceIssues(
    decision, "Supersedes", "other-change#DEC-TWO", byId), []);
  assert.match(durableDecisionReferenceIssues(
    decision, "Supersedes", "prose", byId)[0], /must be none/);
  assert.match(durableDecisionReferenceIssues(
    decision, "Supersedes", "DEC-ONE", byId)[0], /cannot reference itself/);
  assert.match(durableDecisionReferenceIssues(
    decision, "Supersedes", "DEC-MISSING", byId)[0], /unknown local decision/);
  assert.equal(localDecisionReference("DEC-ONE"), "DEC-ONE");
  assert.equal(localDecisionReference("change#DEC-ONE"), null);
});

test("decision status requires superseded and accepted states to match replacement metadata", () => {
  assert.match(durableDecisionStatusIssues({
    label: "decision 'DEC-ONE'", values: { Status: "superseded" }
  }, "none")[0], /must name its replacement/);
  assert.match(durableDecisionStatusIssues({
    label: "decision 'DEC-ONE'", values: { Status: "accepted" }
  }, "DEC-TWO")[0], /must have superseded status/);
  assert.deepEqual(durableDecisionStatusIssues({
    label: "decision 'DEC-ONE'", values: { Status: "accepted" }
  }, "none"), []);
});

test("decision graph validates both directions of reciprocal local links", () => {
  const oldDecision = {
    id: "DEC-OLD",
    label: "decision 'DEC-OLD'",
    values: { Status: "superseded", Supersedes: "none", "Superseded by": "DEC-NEW" }
  };
  const newDecision = {
    id: "DEC-NEW",
    label: "decision 'DEC-NEW'",
    values: { Status: "accepted", Supersedes: "none", "Superseded by": "none" }
  };
  const byId = new Map([[oldDecision.id, oldDecision], [newDecision.id, newDecision]]);
  assert.match(durableDecisionReciprocityIssues(
    oldDecision, "none", "DEC-NEW", byId)[0], /reciprocal Supersedes/);
  oldDecision.values["Superseded by"] = "none";
  newDecision.values.Supersedes = "DEC-OLD";
  assert.match(durableDecisionReciprocityIssues(
    newDecision, "DEC-OLD", "none", byId)[0], /reciprocal Superseded by/);

  oldDecision.values["Superseded by"] = "DEC-NEW";
  assert.deepEqual(durableDecisionGraphIssues([oldDecision, newDecision]), []);
  assert.deepEqual(durableDecisionMetadataIssues(design([
    decisionBlock("DEC-OLD", { Status: "superseded", "Superseded by": "DEC-NEW" }),
    decisionBlock("DEC-NEW", { Supersedes: "DEC-OLD" })
  ].join("\n"))), []);
});

test("decision graph treats missing reference metadata as invalid empty values", () => {
  const issues = durableDecisionGraphIssues([{
    id: "DEC-ONE",
    label: "decision 'DEC-ONE'",
    values: {}
  }]);
  assert.equal(issues.filter((issue) => /must be none/.test(issue)).length, 2);
  assert.deepEqual(durableDecisionGraphIssues([]), []);
});
