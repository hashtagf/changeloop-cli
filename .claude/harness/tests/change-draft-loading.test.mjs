import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  atomicStartPreflight, createChangeLifecycle, synchronizeProposalClassification
} from "../runtime/workflow/change-lifecycle.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-change-draft-"));
const draftPath = join(root, "draft.json");
let grounding = "optional";
let warnings = "";
const priorError = console.error;
console.error = (message) => { warnings += `${message}\n`; };
const baseDraft = () => ({
  version: 1,
  intent: "Load one atomic draft",
  why: "A bounded reason",
  currentState: "The current state",
  compatibility: "Backward compatible",
  changes: ["Change behavior"],
  nonGoals: ["No unrelated work"],
  decisions: [{ choice: "Use the draft", why: "Atomic" }],
  risks: [{ risk: "Invalid input", mitigation: "Validate", owner: "runtime" }],
  tasks: [{ id: "T1", outcome: "Implement", verify: "test" }],
  claims: [{ id: "claim-1", scenario: "Works" }],
  specs: [{
    name: "drafting", operation: "added", requirement: "Load a draft",
    description: "The runtime SHALL validate a draft.",
    scenarios: [{ name: "Valid", when: "a draft is loaded", then: "it is accepted" }]
  }],
  domainLanguage: [{ term: "Draft", meaning: "Atomic input", avoid: "Prompt chain" }],
  externalOperations: [],
  acceptance: { required: false, reason: null, claimIds: [] },
  impact: "low",
  coupling: "isolated",
  securityTriggers: [],
  execution: { version: 1, providers: { test: { adapter: "test" } } }
});
const writeDraft = (value) => {
  writeFileSync(draftPath, `${JSON.stringify(value, null, 2)}\n`);
  return "draft.json";
};
const fail = (message) => { throw new Error(message); };
const lifecycle = createChangeLifecycle({
  root,
  policy: () => ({ workflow: { grounding } }),
  securityTerms: [], fail,
  pathInside: (parent, candidate) => {
    const rel = relative(parent, candidate);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  },
  readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
  measureStage: (_stage, operation) => operation(),
  writeJson: () => {}, slugify: (value) => value, changePath: () => root,
  loadRuntime: () => ({}), saveRuntime: () => {}, setOperationChangeId: () => {},
  initialBudget: () => ({}), gitHead: () => "head", preexistingDirty: () => [],
  now: () => "2026-08-26T00:00:00.000Z", bindClaudeSession: () => {},
  validate: () => {}, createSandbox: () => {}, showPacket: () => {}
});
const rejected = (mutate, pattern) => {
  const draft = baseDraft();
  mutate(draft);
  assert.throws(() => lifecycle.loadDraft(writeDraft(draft)), pattern);
};
const startRejected = (mutate, pattern) => {
  const draft = baseDraft();
  mutate(draft);
  assert.throws(() => lifecycle.startAtomic(writeDraft(draft)), pattern);
};

try {
  assert.equal(synchronizeProposalClassification([
    "## Impact", "", "- **Impact:** low | medium | high",
    "- **Coupling:** isolated | coupled", ""
  ].join("\n"), { impact: "high", coupling: "coupled" }), [
    "## Impact", "", "- **Impact:** high", "- **Coupling:** coupled", ""
  ].join("\n"));
  assert.throws(() => lifecycle.loadDraft("missing.json"), /JSON file inside the project/);
  const outside = join(tmpdir(), `outside-draft-${process.pid}.json`);
  writeFileSync(outside, "{}\n");
  assert.throws(() => lifecycle.loadDraft(outside), /JSON file inside the project/);
  rmSync(outside, { force: true });

  for (const field of ["why", "currentState", "compatibility"])
    rejected((draft) => { draft[field] = " "; }, new RegExp(`non-empty '${field}'`));
  rejected((draft) => { draft.changes = null; }, /non-empty 'changes' array/);
  for (const field of ["nonGoals", "decisions", "risks", "tasks", "claims", "specs"])
    rejected((draft) => { draft[field] = []; }, new RegExp(`non-empty '${field}' array`));

  rejected((draft) => { draft.domainLanguage = "invalid"; }, /must be an array/);
  for (const field of ["term", "meaning", "avoid"])
    rejected((draft) => { draft.domainLanguage[0][field] = ""; },
      new RegExp(String.raw`domainLanguage\[0\]\.${field} is required`));
  rejected((draft) => { draft.domainLanguage = [null]; }, /domainLanguage\[0\]\.term/);
  const withoutLanguage = baseDraft();
  delete withoutLanguage.domainLanguage;
  assert.equal(lifecycle.loadDraft(writeDraft(withoutLanguage)).domainLanguage, undefined);
  const emptyLanguage = baseDraft();
  emptyLanguage.domainLanguage = [];
  assert.deepEqual(lifecycle.loadDraft(writeDraft(emptyLanguage)).domainLanguage, []);

  rejected((draft) => { draft.externalOperations = {}; }, /externalOperations must be an array/);
  const noOperations = baseDraft();
  delete noOperations.externalOperations;
  assert.equal(lifecycle.loadDraft(writeDraft(noOperations)).externalOperations, undefined);
  grounding = "required";
  rejected(() => {}, /requires grounding.version 2/);
  const grounded = baseDraft();
  grounded.grounding = { version: 2 };
  assert.equal(lifecycle.loadDraft(writeDraft(grounded)).grounding.version, 2);
  grounding = "optional";

  for (const field of ["name", "requirement", "description"])
    rejected((draft) => { draft.specs[0][field] = ""; },
      new RegExp(String.raw`specs\[0\]\.${field} is required`));
  rejected((draft) => { draft.specs[0].operation = "renamed"; },
    /operation must be added\|modified\|removed/);
  rejected((draft) => { draft.specs[0].scenarios = []; },
    /scenarios must be non-empty for added/);
  for (const field of ["name", "when", "then"])
    rejected((draft) => { draft.specs[0].scenarios[0][field] = ""; },
      new RegExp(String.raw`scenarios\[0\]\.${field} is required`));

  const legacy = baseDraft();
  delete legacy.specs[0].operation;
  delete legacy.specs[0].scenarios;
  legacy.specs[0].scenario = "Legacy";
  legacy.specs[0].when = "legacy fields are supplied";
  legacy.specs[0].then = "they normalize";
  legacy.specs.push({ ...legacy.specs[0], name: "second" });
  warnings = "";
  assert.equal(lifecycle.loadDraft(writeDraft(legacy)).specs.length, 2);
  assert.equal(warnings.match(/legacy draft specs/g)?.length, 1);

  const modified = baseDraft();
  modified.specs[0].operation = "MODIFIED";
  assert.equal(lifecycle.loadDraft(writeDraft(modified)).specs[0].operation, "MODIFIED");
  rejected((draft) => {
    delete draft.specs[0].scenarios;
    delete draft.specs[0].scenario;
    delete draft.specs[0].when;
    delete draft.specs[0].then;
  }, /scenarios must be non-empty/);
  rejected((draft) => {
    draft.specs[0].operation = "removed";
    draft.specs[0].scenarios = [];
    delete draft.specs[0].migration;
  }, /migration is required/);
  const removed = baseDraft();
  removed.specs[0].operation = "removed";
  removed.specs[0].scenarios = [];
  removed.specs[0].migration = "Remove callers first";
  assert.equal(lifecycle.loadDraft(writeDraft(removed)).specs[0].migration,
    "Remove callers first");

  startRejected((draft) => { draft.version = 4; }, /start draft requires version 1, 2, or 3/);
  startRejected((draft) => { draft.intent = " "; }, /non-empty 'intent'/);
  startRejected((draft) => { delete draft.acceptance; }, /acceptance.required true\|false/);
  startRejected((draft) => { draft.acceptance.required = "false"; }, /acceptance.required true\|false/);
  startRejected((draft) => { draft.acceptance = { required: true }; }, /acceptance.reason/);
  startRejected((draft) => { draft.acceptance.reason = "not allowed"; },
    /acceptance.reason and acceptance.claimIds require/);
  startRejected((draft) => { draft.acceptance.claimIds = ["claim-1"]; },
    /acceptance.reason and acceptance.claimIds require/);
  startRejected((draft) => { draft.impact = "critical"; }, /impact must be low\|medium\|high/);
  startRejected((draft) => { draft.coupling = "shared"; }, /coupling must be isolated\|coupled/);
  startRejected((draft) => { draft.securityTriggers = {}; }, /array of non-empty strings/);
  startRejected((draft) => { draft.securityTriggers = [""]; }, /array of non-empty strings/);
  startRejected((draft) => { delete draft.execution; }, /executable evidence wiring/);
  startRejected((draft) => { draft.execution.version = 2; }, /executable evidence wiring/);
  startRejected((draft) => { delete draft.execution.providers; }, /executable evidence wiring/);
  startRejected((draft) => { draft.execution.providers = {}; }, /executable evidence wiring/);

  const incomplete = baseDraft();
  incomplete.version = 4;
  incomplete.intent = "";
  delete incomplete.acceptance;
  incomplete.impact = "critical";
  incomplete.coupling = "shared";
  incomplete.securityTriggers = {};
  incomplete.externalOperations = {};
  delete incomplete.execution;
  const aggregate = atomicStartPreflight(incomplete, { groundingRequired: true });
  assert.equal(aggregate.issues.length, 10);
  assert.match(aggregate.issues.join("\n"), /version 1, 2, or 3[\s\S]*non-empty 'intent'[\s\S]*acceptance.required[\s\S]*impact must be[\s\S]*coupling must be[\s\S]*securityTriggers[\s\S]*executable evidence[\s\S]*grounding.version[\s\S]*nfrAssessment/);

  for (const mutate of [
    () => {},
    (draft) => { delete draft.impact; },
    (draft) => { delete draft.coupling; },
    (draft) => { delete draft.securityTriggers; },
    (draft) => { draft.impact = "medium"; },
    (draft) => { draft.coupling = "coupled"; },
    (draft) => { draft.securityTriggers = ["none"]; },
    (draft) => { draft.securityTriggers = ["authentication"]; },
    (draft) => { draft.reviewRequired = true; },
    (draft) => { draft.acceptance = { required: true, reason: "User decision", claimIds: [] }; },
    (draft) => { draft.size = "M"; }
  ]) startRejected(mutate, /change already exists/);

  grounding = "required";
  startRejected((draft) => { draft.grounding = { version: 2 }; draft.impact = "medium"; },
    /every grounding.nfrAssessment category/);
  const categories = [
    "performance", "capacity", "availability", "securityPrivacy",
    "accessibility", "operability", "compatibility", "recoverability"
  ];
  startRejected((draft) => {
    draft.impact = "medium";
    draft.grounding = { version: 2, nfrAssessment: Object.fromEntries(categories.map((key) =>
      [key, { status: "not-applicable" }])) };
  }, /change already exists/);
  grounding = "optional";

  const valid = baseDraft();
  assert.deepEqual(lifecycle.loadDraft(writeDraft(valid)), valid);
  const derived = baseDraft();
  derived.version = 2;
  delete derived.tasks[0].id;
  delete derived.claims[0].id;
  assert.equal(lifecycle.loadDraft(writeDraft(derived)).tasks[0].id, "T001");
  assert.deepEqual(lifecycle.loadDraft(writeDraft(derived)).tasks[0].claims,
    ["Works"]);
  console.error = priorError;
  console.log("change draft loading tests: PASS");
} finally {
  console.error = priorError;
  rmSync(root, { recursive: true, force: true });
}
