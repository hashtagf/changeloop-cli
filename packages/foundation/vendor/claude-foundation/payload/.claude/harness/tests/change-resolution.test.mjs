import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createChangeLifecycle } from "../runtime/workflow/change-lifecycle.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-change-resolution-"));
const changeDir = join(root, "openspec", "changes", "change-1");
const templateDir = join(root, "openspec", "schemas", "foundation-standard", "templates");
mkdirSync(changeDir, { recursive: true });
mkdirSync(templateDir, { recursive: true });
for (const name of ["design.md", "grounding.yaml", "spec.md"])
  writeFileSync(join(templateDir, name), "<title> replace-with-stable-claim-id\n");

let state;
let saved;
let grounding = "optional";
let riskBasedCi = false;
let output = "";
const priorLog = console.log;
console.log = (message) => { output += `${message}\n`; };
const fail = (message) => { throw new Error(message); };
const baseState = () => ({
  id: "change-1",
  intent: "Improve accessibility guidance",
  schema: "foundation-standard",
  status: "change",
  impact: "low",
  coupling: "isolated",
  securityTriggers: ["none"],
  reviewRequired: false,
  acceptance: { decision: "undecided", required: false },
  contractRevision: 0
});
const lifecycle = createChangeLifecycle({
  root,
  policy: () => ({ workflow: { grounding }, land: { riskBasedCi } }),
  securityTerms: ["access", "auth token", "a+b"], fail,
  pathInside: () => true, readJson: () => ({}), writeJson: () => {},
  slugify: (value) => String(value).toLowerCase().replaceAll(" ", "-"),
  changePath: () => changeDir,
  loadRuntime: () => state,
  saveRuntime: (value) => { saved = value; },
  setOperationChangeId: () => {}, initialBudget: () => ({}), gitHead: () => "head",
  preexistingDirty: () => [], now: () => "2026-08-26T00:00:00.000Z",
  bindClaudeSession: () => {}, validate: () => {}, createSandbox: () => {}, showPacket: () => {}
});
const run = (flags = {}, overrides = {}) => {
  state = { ...baseState(), ...overrides };
  saved = null;
  output = "";
  lifecycle.resolveChange("change-1", flags);
  assert.equal(saved, state);
  return state;
};
const rejected = (flags, pattern, overrides = {}) => {
  state = { ...baseState(), ...overrides };
  assert.throws(() => lifecycle.resolveChange("change-1", flags), pattern);
};

try {
  rejected({ "reopen-grounding": true }, /requires --decision-ref and --reopen-reason/);
  rejected({ "reopen-grounding": true, "decision-ref": "D2", "reopen-reason": "revise" },
    /already has an open revision/, { groundingReopenPending: { version: 1 }, groundingDigest: "old" });
  rejected({ "reopen-grounding": true, "decision-ref": "D2", "reopen-reason": "revise" },
    /currently locked grounding ledger/);
  rejected({ "reopen-grounding": true, "decision-ref": "D2", "reopen-reason": "revise" },
    /decision-ref was already used/, { groundingDigest: "old", groundingReopens: [{ decisionRef: "D2" }] });
  rejected({ "decision-ref": "D2" }, /require --reopen-grounding/);
  rejected({ "reopen-reason": "revise" }, /require --reopen-grounding/);
  const reopened = run({
    "reopen-grounding": true, "decision-ref": " D2 ", "reopen-reason": " revise "
  }, { groundingDigest: "old", groundingLockedAt: "then" });
  assert.deepEqual(reopened.groundingReopenPending, {
    version: 1, decisionRef: "D2", reason: "revise", priorDigest: "old",
    priorLockedAt: "then", openedAt: "2026-08-26T00:00:00.000Z"
  });
  assert.equal(reopened.groundingDigest, undefined);
  assert.equal(reopened.groundingLockedAt, undefined);
  assert.equal(reopened.contractRevision, 1);

  rejected({ ambiguity: "maybe" }, /ambiguity must be clear\|unclear/);
  rejected({ size: "huge" }, /size must be xs\|s\|m\|l/);
  rejected({ surface: " , " }, /surface requires at least one path or glob/);
  const attributes = run({
    ambiguity: "unclear", impact: "medium", coupling: "coupled", size: "M",
    surface: " src/b.js,src/a.js, src/b.js "
  });
  assert.equal(attributes.ambiguity, "unclear");
  assert.equal(attributes.resolvedAt, "2026-08-26T00:00:00.000Z");
  assert.equal(attributes.size, "m");
  assert.deepEqual(attributes.declaredSurface, ["src/a.js", "src/b.js"]);
  assert.match(output, /surface: src\/a.js, src\/b.js/);
  run({});

  const boundary = run({}, { intent: "Improve accessibility guidance", securityTriggers: [] });
  assert.deepEqual(boundary.securityTriggers, []);
  assert.equal(boundary.reviewRequired, false);
  const inferred = run({ security: "none, manual" }, {
    intent: "Rotate an AUTH-TOKEN and an a+b marker", securityTriggers: ["none", "manual"]
  });
  assert.deepEqual(inferred.securityTriggers, ["manual", "auth token", "a+b"]);
  assert.equal(inferred.reviewRequired, true);
  const businessValidation = run({
    security: "untrusted-input,type-confusion-validation-bypass,schema-validation"
  }, { intent: "Reject boolean seat counts in workspace API validation", securityTriggers: [] });
  assert.deepEqual(businessValidation.securityTriggers, []);
  assert.equal(businessValidation.reviewRequired, false);
  const trustBoundaryValidation = run({
    security: "untrusted-input,type-confusion-validation-bypass"
  }, { intent: "Reject an auth token bypass in workspace API validation", securityTriggers: [] });
  assert.deepEqual(trustBoundaryValidation.securityTriggers,
    ["auth token", "untrusted-input", "type-confusion-validation-bypass"]);
  assert.equal(trustBoundaryValidation.reviewRequired, true);
  assert.equal(run({}, { impact: "high", securityTriggers: [] }).reviewRequired, true);
  assert.equal(run({}, { impact: "medium", coupling: "coupled", securityTriggers: [] }).reviewRequired, true);
  assert.equal(run({}, { impact: "low", coupling: "coupled", securityTriggers: [] }).reviewRequired, false);
  assert.equal(run({ review: true }, { securityTriggers: [] }).reviewRequired, true);

  rejected({ "acceptance-required": true, "acceptance-not-required": true }, /cannot combine/);
  rejected({ "acceptance-reason": "needed" }, /require --acceptance-required/);
  rejected({ "acceptance-claims": "claim-1" }, /require --acceptance-required/);
  rejected({ "acceptance-required": true }, /requires --acceptance-reason/);
  const accepted = run({
    "acceptance-required": true,
    "acceptance-reason": " User-visible behavior ",
    "acceptance-claims": " claim-2, ,claim-1 "
  });
  assert.deepEqual(accepted.acceptance.claimIds, ["claim-2", "claim-1"]);
  assert.equal(accepted.acceptance.scopeOrigin, "explicit");
  assert.equal(run({ "acceptance-not-required": true }).acceptance.decision, "not-required");
  run({}, { acceptance: { required: true } });
  assert.match(output, /acceptance: required/);
  run({}, { acceptance: undefined });
  assert.match(output, /acceptance: legacy-not-required/);

  const rapid = run({}, { schema: "foundation-rapid", securityTriggers: [] });
  assert.equal(rapid.schema, "foundation-rapid");
  grounding = "required";
  riskBasedCi = true;
  const upgraded = run({ impact: "medium" }, {
    schema: "foundation-rapid", securityTriggers: [], groundingRequired: false
  });
  assert.equal(upgraded.schema, "foundation-standard");
  assert.equal(upgraded.upgradedFrom, "foundation-rapid");
  assert.equal(upgraded.groundingRequired, true);
  assert.equal(upgraded.riskBasedCiRequired, true);
  assert.equal(existsSync(join(changeDir, "design.md")), true);
  assert.equal(existsSync(join(changeDir, "grounding.yaml")), true);
  assert.equal(existsSync(join(changeDir, "specs", "change", "spec.md")), true);
  assert.match(output, /upgraded from foundation-rapid/);

  // Signed CI follows the current policy on every resolve, and a user's
  // waiver outlives later policy reads. A consumer sat in Build with the
  // requirement pinned from a historical `riskBasedCi: true` default and no
  // route but a hand edit of foundation.json, which the guard refuses there.
  riskBasedCi = false;
  assert.equal(run({}, { riskBasedCiRequired: true }).riskBasedCiRequired, false);
  riskBasedCi = true;
  assert.equal(run({}, { riskBasedCiRequired: false }).riskBasedCiRequired, true);
  rejected({ "ci-not-required": true }, /--ci-not-required requires --decision-ref/);
  const waived = run({ "ci-not-required": true, "decision-ref": "CI-WAIVER-1" },
    { riskBasedCiRequired: true });
  assert.equal(waived.riskBasedCiRequired, false);
  assert.deepEqual(waived.ciWaiver,
    { version: 1, decisionRef: "CI-WAIVER-1", declaredAt: "2026-08-26T00:00:00.000Z" });
  assert.match(output, /signed CI: waived \(CI-WAIVER-1\)/);
  assert.equal(run({}, { riskBasedCiRequired: false, ciWaiver: waived.ciWaiver }).riskBasedCiRequired,
    false, "a recorded waiver is not undone by a later policy read");
  const waivedUpgrade = run({ impact: "medium" }, {
    schema: "foundation-rapid", securityTriggers: [], groundingRequired: false,
    riskBasedCiRequired: false, ciWaiver: waived.ciWaiver
  });
  assert.equal(waivedUpgrade.schema, "foundation-standard");
  assert.equal(waivedUpgrade.riskBasedCiRequired, false, "a schema upgrade keeps the waiver");
  assert.doesNotMatch(run({}, { riskBasedCiRequired: true }) && output, /signed CI: waived/);

  console.log = priorLog;
  priorLog("change resolution tests: PASS");
} finally {
  console.log = priorLog;
  rmSync(root, { recursive: true, force: true });
}
