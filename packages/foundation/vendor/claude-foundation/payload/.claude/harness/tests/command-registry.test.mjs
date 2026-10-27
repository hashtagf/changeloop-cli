import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  commandDescriptionSelection,
  createCommandRegistry,
  describeAllCommands,
  describeCliCommand,
  describeCommandFamily,
  describeLoopCommand,
  loopCommandFromSource,
  normalizeCommandName,
  orderedLoopCommands,
  resolveCliCommand,
  validateCommandRegistry
} from "../runtime/core/command-registry.mjs";

const fail = (message) => { throw new Error(message); };

function entry(name, overrides = {}) {
  return {
    name, usage: `claude-foundation ${name}`, description: `${name} description`,
    audience: "agent", kind: "read", idempotent: true, ...overrides
  };
}

function capture(run) {
  const prior = console.log;
  const rows = [];
  console.log = (value) => rows.push(String(value));
  try { return { value: run(), rows }; }
  finally { console.log = prior; }
}

test("loop command parser requires frontmatter description and retains argument hints", () => {
  assert.equal(loopCommandFromSource("none.md", "body"), null);
  assert.equal(loopCommandFromSource("none.md", "---\nargument-hint: <id>\n---\n"), null);
  assert.deepEqual(loopCommandFromSource("build.md", [
    "---", "description: Build the change", "argument-hint: <change> [--all]", "---", "body"
  ].join("\r\n")), {
    name: "/build", usage: "/build <change> [--all]", surface: "host-command",
    description: "Build the change", file: ".claude/commands/build.md"
  });
  assert.equal(loopCommandFromSource("land.md", "---\ndescription: Land safely\n---\n").usage,
    "/land");
});

test("loop ordering prioritizes the lifecycle and sorts newly shipped commands", () => {
  const found = new Map([
    ["zeta", { name: "/zeta" }], ["build", { name: "/build" }],
    ["alpha", { name: "/alpha" }], ["change", { name: "/change" }]
  ]);
  assert.deepEqual(orderedLoopCommands(found).map((row) => row.name),
    ["/change", "/build", "/alpha", "/zeta"]);
});

test("registry validation rejects every malformed shape and duplicate", () => {
  const valid = { version: 1, commands: [entry("change validate")],
    runtimeCommands: ["validate"] };
  assert.equal(validateCommandRegistry(valid, fail), valid);
  for (const value of [null, {}, { version: 2, commands: [], runtimeCommands: [] },
    { version: 1, commands: {}, runtimeCommands: [] },
    { version: 1, commands: [], runtimeCommands: {} }])
    assert.throws(() => validateCommandRegistry(value, fail), /invalid command registry:/);

  const malformed = [
    null,
    entry("", {}),
    { ...entry("x"), usage: 1 },
    { ...entry("x"), description: 1 },
    { ...entry("x"), audience: "unknown" },
    { ...entry("x"), kind: "unknown" },
    { ...entry("x"), idempotent: "yes" }
  ];
  for (const command of malformed)
    assert.throws(() => validateCommandRegistry({
      version: 1, commands: [command], runtimeCommands: []
    }, fail), /invalid command registry entry/);
  assert.throws(() => validateCommandRegistry({
    version: 1, commands: [entry("x"), entry("x")], runtimeCommands: []
  }, fail), /duplicate command registry entry 'x'/);
  for (const runtimeCommand of [null, ""])
    assert.throws(() => validateCommandRegistry({
      version: 1, commands: [], runtimeCommands: [runtimeCommand]
    }, fail), /invalid runtime command registry entry/);
  assert.throws(() => validateCommandRegistry({
    version: 1, commands: [], runtimeCommands: ["one", "one"]
  }, fail), /duplicate runtime command registry entry 'one'/);
});

test("command matching honors aliases, exact names, suffixes, and token matches", () => {
  const entries = [
    entry("change validate"), entry("proof finalize"), entry("agents plan"),
    entry("change audit"), entry("proof collect")
  ];
  assert.equal(normalizeCommandName("proof  finalize"), "proof-finalize");
  assert.equal(resolveCliCommand(entries, "validate", "change validate").name,
    "change validate");
  assert.equal(resolveCliCommand(entries, "proof-finalize").name, "proof finalize");
  assert.equal(resolveCliCommand(entries, "finalize").name, "proof finalize");
  assert.equal(resolveCliCommand(entries, "plan").name, "agents plan");
  assert.equal(resolveCliCommand(entries, "missing"), undefined);

  const loop = [{ name: "/prove", usage: "/prove", description: "Prove", file: "prove.md" }];
  const selection = commandDescriptionSelection(entries, loop, "/prove");
  assert.equal(selection.target, "prove");
  assert.equal(selection.aliased, "proof finalize");
  assert.equal(selection.entry.name, "proof finalize");
  assert.equal(selection.loopEntry.name, "/prove");
  const family = commandDescriptionSelection(entries, [], "proof");
  assert.equal(family.family.length, 2);
  assert.equal(family.exact, undefined);
});

test("description renderers preserve text and JSON contracts", () => {
  const entries = [entry("proof collect"), entry("proof finalize", { idempotent: false })];
  const loop = [{
    name: "/prove", usage: "/prove <id>", surface: "host-command",
    description: "Prove safely", file: ".claude/commands/prove.md"
  }];
  const logs = [];
  describeAllCommands(entries, loop, {}, (value) => logs.push(String(value)));
  assert.match(logs.join("\n"), /Change loop.*Commands.*File shapes/s);
  const allJson = [];
  describeAllCommands(entries, [], { json: true }, (value) => allJson.push(value));
  assert.equal(JSON.parse(allJson[0]).length, 2);

  const selection = commandDescriptionSelection(entries, loop, "prove");
  const loopText = [];
  describeLoopCommand(selection, {}, (value) => loopText.push(String(value)));
  assert.match(loopText.join("\n"), /surface:.*Related CLI commands/s);
  const loopJson = [];
  describeLoopCommand(selection, { json: true }, (value) => loopJson.push(value));
  assert.equal(JSON.parse(loopJson[0]).name, "/prove");
  const familyRelated = [];
  describeLoopCommand({
    loopEntry: loop[0], aliased: null, exact: null, family: entries, entry: undefined
  }, {}, (value) => familyRelated.push(String(value)));
  assert.equal(familyRelated.filter((row) => row.includes("proof ")).length, 2);
  const noRelated = [];
  describeLoopCommand({
    loopEntry: { ...loop[0], name: "/orphan" }, aliased: null, exact: null,
    family: [], entry: undefined
  }, {}, (value) => noRelated.push(String(value)));
  assert.doesNotMatch(noRelated.join("\n"), /Related CLI/);

  const familyText = [];
  describeCommandFamily("proof", entries, {}, (value) => familyText.push(String(value)));
  assert.match(familyText[0], /2 commands/);
  const familyJson = [];
  describeCommandFamily("proof", entries, { json: true }, (value) => familyJson.push(value));
  assert.equal(JSON.parse(familyJson[0]).length, 2);

  const cliText = [];
  describeCliCommand(entries[0], {}, (value) => cliText.push(String(value)));
  assert.match(cliText.join("\n"), /audience:.*idempotent/s);
  const nonIdempotent = [];
  describeCliCommand(entries[1], {}, (value) => nonIdempotent.push(String(value)));
  assert.doesNotMatch(nonIdempotent.at(-1), /idempotent/);
  const cliJson = [];
  describeCliCommand(entries[0], { json: true }, (value) => cliJson.push(value));
  assert.equal(JSON.parse(cliJson[0]).name, "proof collect");
});

function registryFixture(t, { commands = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-command-registry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, ".claude", "harness", "commands.json");
  const commandDir = join(root, ".claude", "commands");
  mkdirSync(join(root, ".claude", "harness"), { recursive: true });
  if (commands) {
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(join(commandDir, "prove.md"),
      "---\ndescription: Prove the change\nargument-hint: <change>\n---\n");
    writeFileSync(join(commandDir, "alpha.md"),
      "---\ndescription: Alpha command\n---\n");
    writeFileSync(join(commandDir, "ignored.txt"), "ignored\n");
    writeFileSync(join(commandDir, "no-front.md"), "body\n");
    mkdirSync(join(commandDir, "unreadable.md"));
  }
  const value = {
    version: 1,
    commands: [
      entry("proof finalize"), entry("proof collect"), entry("change validate"),
      entry("agents plan"), entry("evidence record", { idempotent: false })
    ],
    runtimeCommands: ["prove", "validate", "agent-plan"]
  };
  let reads = 0;
  const registry = createCommandRegistry({
    path,
    readJson: () => { reads += 1; return value; },
    fail
  });
  return { registry, reads: () => reads, value };
}

test("registry facade caches sources and describes every selection mode", (t) => {
  const f = registryFixture(t);
  assert.equal(f.registry.commandRegistry(), f.value);
  assert.equal(f.registry.commandRegistry(), f.value);
  assert.equal(f.reads(), 1);

  const all = capture(() => f.registry.describeCommand());
  assert.match(all.rows.join("\n"), /Change loop.*Commands/s);
  const allJson = capture(() => f.registry.describeCommand(null, { json: true }));
  assert.equal(JSON.parse(allJson.rows[0])[0].name, "/prove");

  const loop = capture(() => f.registry.describeCommand("prove"));
  assert.match(loop.rows.join("\n"), /\/prove.*Related CLI commands/s);
  const loopJson = capture(() => f.registry.describeCommand("/prove", { json: true }));
  assert.equal(JSON.parse(loopJson.rows[0]).related[0].name, "proof finalize");

  const family = capture(() => f.registry.describeCommand("proof"));
  assert.match(family.rows[0], /2 commands/);
  const familyJson = capture(() => f.registry.describeCommand("proof", { json: true }));
  assert.equal(JSON.parse(familyJson.rows[0]).length, 2);

  const exact = capture(() => f.registry.describeCommand("change-validate"));
  assert.match(exact.rows[0], /change validate/);
  const exactJson = capture(() => f.registry.describeCommand("agent-plan", { json: true }));
  assert.equal(JSON.parse(exactJson.rows[0]).name, "agents plan");

  assert.throws(() => f.registry.describeCommand("proof-missing"), /did you mean.*proof/s);
  assert.throws(() => f.registry.describeCommand("zzzz"), /known:.*\/prove/s);
});

test("registry facade degrades without host commands and validates runtime dispatch", (t) => {
  const f = registryFixture(t, { commands: false });
  const all = capture(() => f.registry.describeCommand());
  assert.doesNotMatch(all.rows.join("\n"), /Change loop/);
  assert.doesNotThrow(() => f.registry.assertRegisteredRuntimeCommand());
  assert.doesNotThrow(() => f.registry.assertRegisteredRuntimeCommand("prove"));
  assert.throws(() => f.registry.assertRegisteredRuntimeCommand("missing"),
    /runtime command 'missing' is not registered/);
  assert.throws(() => f.registry.assertRegisteredRuntimeCommand("change", ["validate"]),
    /'change validate' is the CLI form.*validate/s);
  assert.throws(() => f.registry.assertRegisteredRuntimeCommand("agents", ["--json"]),
    /runtime command 'agents' is not registered/);
});
