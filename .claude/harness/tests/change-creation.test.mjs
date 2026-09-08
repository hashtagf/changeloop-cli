import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  createChangeLifecycle,
  initialChangeState,
  priorChangeResidue
} from "../runtime/workflow/change-lifecycle.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-change-creation-"));
const changesRoot = join(root, "openspec", "changes");
const templateNames = [
  "proposal.md", "tasks.md", "evidence.yaml", "execution.yaml",
  "repositories.yaml", "handoffs.yaml", "grounding.yaml", "design.md", "spec.md"
];
for (const schema of ["foundation-standard", "foundation-rapid"]) {
  const templateRoot = join(root, "openspec", "schemas", schema, "templates");
  mkdirSync(templateRoot, { recursive: true });
  for (const name of templateNames)
    writeFileSync(join(templateRoot, name), `${name}: <title> replace-with-stable-claim-id\n`);
}

let groundingRequired = true;
let states = [];
const operationIds = [];
const bindings = [];
const fail = (message) => { throw new Error(message); };
const lifecycle = createChangeLifecycle({
  root,
  policy: () => ({
    workflow: { grounding: groundingRequired ? "required" : "optional" },
    land: { riskBasedCi: true }
  }),
  securityTerms: [],
  fail,
  pathInside: () => true,
  readJson: () => ({}),
  writeJson: () => {},
  slugify: (value) => value.toLowerCase().replaceAll(" ", "-"),
  changePath: (id) => join(changesRoot, id),
  loadRuntime: () => ({}),
  saveRuntime: (state) => { states.push(state); },
  setOperationChangeId: (id) => { operationIds.push(id); },
  initialBudget: (schema, id) => ({ schema, id }),
  gitHead: () => "head",
  preexistingDirty: () => ({ tracked: ["existing"] }),
  now: (() => {
    let tick = 0;
    return () => `time-${++tick}`;
  })(),
  bindClaudeSession: (id, phase) => { bindings.push({ id, phase }); },
  validate: () => {},
  createSandbox: () => {},
  showPacket: () => {}
});

const priorLog = console.log;
const logs = [];
console.log = (message) => logs.push(String(message));
try {
  const standard = lifecycle.createChange("Standard Change", {});
  assert.equal(standard, "standard-change");
  assert.equal(states[0].schema, "foundation-standard");
  assert.equal(states[0].groundingRequired, true);
  assert.equal(states[0].groundingVersion, 2);
  assert.equal(states[0].riskBasedCiRequired, true);
  assert.equal(states[0].resolutionRequired, true);
  assert.equal(states[0].resolvedAt, null);
  assert.equal(states[0].acceptance.decision, "undecided");
  assert.equal(states[0].createdAt, "time-1");
  assert.equal(states[0].updatedAt, "time-2");
  assert.deepEqual(states[0].workspace.preexisting, { tracked: ["existing"] });
  assert.equal(existsSync(join(changesRoot, standard, "design.md")), true);
  assert.equal(existsSync(join(changesRoot, standard, "grounding.yaml")), true);
  assert.match(readFileSync(join(changesRoot, standard, "proposal.md"), "utf8"),
    /Standard Change standard-change-outcome/);
  assert.match(readFileSync(join(changesRoot, standard, ".openspec.yaml"), "utf8"),
    /^schema: foundation-standard/);
  assert.match(logs[0],
    /resolve decisions with change resolve standard-change before authoring or validation/);

  groundingRequired = false;
  const rapid = lifecycle.createChange("Rapid Change", { rapid: true, id: "rapid-id" });
  assert.equal(rapid, "rapid-id");
  assert.equal(states[1].schema, "foundation-rapid");
  assert.equal(states[1].impact, "low");
  assert.equal(states[1].coupling, "isolated");
  assert.equal(states[1].riskBasedCiRequired, false);
  assert.equal(states[1].resolutionRequired, false);
  assert.equal(states[1].resolvedAt, null);
  assert.equal(states[1].acceptance.decision, "not-required");
  assert.equal(existsSync(join(changesRoot, rapid, "design.md")), false);
  assert.equal(existsSync(join(changesRoot, rapid, "grounding.yaml")), false);
  assert.match(readFileSync(join(changesRoot, rapid, ".openspec.yaml"), "utf8"),
    /skip_specs: true/);
  assert.match(logs[1], /complete artifacts, validate, then \/build rapid-id/);
  assert.deepEqual(operationIds, ["standard-change", "rapid-id"]);
  assert.deepEqual(bindings, [
    { id: "standard-change", phase: "change" },
    { id: "rapid-id", phase: "change" }
  ]);

  assert.throws(() => lifecycle.createChange("Standard Change", {}), /already exists/);
  const residuePath = join(root, ".foundation", "runtime", "old.json");
  mkdirSync(dirname(residuePath), { recursive: true });
  writeFileSync(residuePath, "{}\n");
  assert.deepEqual(priorChangeResidue(root, "old"), [residuePath]);
  assert.throws(() => lifecycle.createChange("Old", {}), /recorded history remains.*runtime\/old.json/);

  const rapidState = initialChangeState({
    root, id: "direct", intent: "Direct", schema: "foundation-rapid",
    groundingRequired: false, riskBasedCi: true,
    gitHead: () => null, preexistingDirty: () => [],
    initialBudget: () => ({}), now: () => "now"
  });
  assert.equal(rapidState.nfrAssessmentRequired, false);
  assert.equal(rapidState.workspace.baseHead, null);
} finally {
  console.log = priorLog;
  rmSync(root, { recursive: true, force: true });
}
