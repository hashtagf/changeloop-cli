import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// The change loop is a host-command surface, not a CLI route: `/build` lives in
// `.claude/commands/build.md` and never reaches cli.sh, so nothing in the
// command registry described it. `describe build` answered "unknown command"
// and `describe prove` answered with `proof finalize`, an internal low-level
// command — the agent asking was pointed away from the surface it is actually
// driven by. These are read from the shipped command files rather than copied
// into `commands.json`, because a second copy of a description is a second
// thing to keep current.
const LOOP_COMMAND_ORDER = [
  "investigate", "change", "build", "prove", "land", "changes", "dev"
];

const RUNTIME_COMMAND_ALIASES = {
  "audit-change": "change audit",
  "agent-plan": "agents plan",
  "agent-dispatch": "agents dispatch",
  "agent-task": "agents task",
  "agent-acquire": "agents acquire",
  "agent-release": "agents release",
  advance: "advance",
  feedback: "feedback",
  receipt: "evidence record",
  "run-provider": "evidence run",
  prove: "proof finalize",
  "host-execution-import": "telemetry host-import",
  validate: "change validate"
};

export function loopCommandFromSource(file, source) {
  const front = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) return null;
  const field = (key) =>
    (front[1].match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"))?.[1] || "").trim();
  const description = field("description");
  if (!description) return null;
  const name = basename(file, ".md");
  const hint = field("argument-hint");
  return {
    name: `/${name}`,
    usage: hint ? `/${name} ${hint}` : `/${name}`,
    surface: "host-command",
    description,
    file: `.claude/commands/${file}`
  };
}

export function orderedLoopCommands(found) {
  return [
    ...LOOP_COMMAND_ORDER.map((name) => found.get(name)).filter(Boolean),
    ...[...found.keys()].filter((name) => !LOOP_COMMAND_ORDER.includes(name))
      .sort().map((name) => found.get(name))
  ];
}

export function validateCommandRegistry(registry, fail) {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.commands) ||
      !Array.isArray(registry.runtimeCommands))
    fail("invalid command registry: expected version 1 commands and runtimeCommands arrays");
  const audiences = new Set(["agent", "conditional", "admin", "host", "internal"]);
  const kinds = new Set(["read", "write", "authority"]);
  const names = new Set();
  for (const entry of registry.commands) {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim() ||
        typeof entry.usage !== "string" || typeof entry.description !== "string" ||
        !audiences.has(entry.audience) || !kinds.has(entry.kind) ||
        typeof entry.idempotent !== "boolean")
      fail("invalid command registry entry");
    if (names.has(entry.name)) fail(`duplicate command registry entry '${entry.name}'`);
    names.add(entry.name);
  }
  const runtimeCommands = new Set();
  for (const runtimeCommand of registry.runtimeCommands) {
    if (typeof runtimeCommand !== "string" || !runtimeCommand.trim())
      fail("invalid runtime command registry entry");
    if (runtimeCommands.has(runtimeCommand))
      fail(`duplicate runtime command registry entry '${runtimeCommand}'`);
    runtimeCommands.add(runtimeCommand);
  }
  return registry;
}

export function normalizeCommandName(value) {
  return value.replace(/[\s-]+/g, "-");
}

export function resolveCliCommand(entries, target, aliased) {
  return entries.find((candidate) => candidate.name === aliased) ||
    entries.find((candidate) => normalizeCommandName(candidate.name) === target) ||
    entries.find((candidate) => normalizeCommandName(candidate.name).endsWith(`-${target}`)) ||
    entries.find((candidate) => normalizeCommandName(candidate.name).split("-").includes(target));
}

export function commandDescriptionSelection(entries, loop, name) {
  const target = normalizeCommandName(name.replace(/^\/+/, ""));
  const aliased = RUNTIME_COMMAND_ALIASES[target];
  const exact = entries.find((candidate) => normalizeCommandName(candidate.name) === target);
  const family = entries.filter((candidate) =>
    normalizeCommandName(candidate.name).startsWith(`${target}-`));
  const entry = resolveCliCommand(entries, target, aliased);
  const loopEntry = loop.find((candidate) =>
    normalizeCommandName(candidate.name.slice(1)) === target);
  return { target, aliased, exact, family, entry, loopEntry };
}

export function describeAllCommands(entries, loop, options, log = console.log) {
  if (options.json) {
    log(JSON.stringify([...loop, ...entries], null, 2));
    return;
  }
  if (loop.length) {
    log("Change loop (host commands, not CLI routes):\n");
    for (const entry of loop)
      log(`  ${entry.name.padEnd(22)} ${entry.description}`);
    log("");
    log("Describe the outcome to your coding agent; it runs routine commands and safe recovery.\n");
  }
  log("Commands (describe <command> for one):\n");
  for (const entry of entries)
    log(`  ${entry.name.padEnd(22)} ${entry.description}`);
  log("\nFile shapes:\n");
  log("  evidence.yaml, execution.yaml   openspec/schemas/<schema>/schema.yaml");
  log("  host execution, instruction     .claude/harness/runtime/contracts/");
  log("  authority response              authority status <change> --template");
}

export function describeLoopCommand(selection, options, log = console.log) {
  const { loopEntry, aliased, exact, family, entry } = selection;
  const related = !aliased && !exact && family.length > 1 ? family : [entry].filter(Boolean);
  if (options.json) {
    log(JSON.stringify({ ...loopEntry, related }, null, 2));
    return;
  }
  log(`${loopEntry.name} — ${loopEntry.description}\n`);
  log(`  usage:     ${loopEntry.usage}`);
  log(`  surface:   host command (${loopEntry.file})`);
  if (!related.length) return;
  log("\nRelated CLI commands:\n");
  for (const member of related)
    log(`  ${member.name.padEnd(22)} ${member.description}`);
}

export function describeCommandFamily(name, family, options, log = console.log) {
  if (options.json) {
    log(JSON.stringify(family, null, 2));
    return;
  }
  log(`${name} — ${family.length} commands:\n`);
  for (const member of family)
    log(`  ${member.name.padEnd(22)} ${member.description}`);
}

export function describeCliCommand(entry, options, log = console.log) {
  if (options.json) {
    log(JSON.stringify(entry, null, 2));
    return;
  }
  log(`${entry.name} — ${entry.description}\n`);
  log(`  usage:     ${entry.usage}`);
  log(`  audience:  ${entry.audience}`);
  log(`  kind:      ${entry.kind}${entry.idempotent ? " (idempotent)" : ""}`);
}

export function createCommandRegistry({ path, readJson, fail }) {
  let cache = null;
  let loopCache = null;

  // `path` is <project>/.claude/harness/commands.json; the command files sit one
  // directory up. A partial install that lacks them degrades to the CLI surface
  // alone rather than failing a read-only command.
  function loopCommands() {
    if (loopCache) return loopCache;
    const directory = join(dirname(dirname(path)), "commands");
    let files = [];
    try {
      files = readdirSync(directory).filter((file) => file.endsWith(".md"));
    } catch { loopCache = []; return loopCache; }
    const found = new Map();
    for (const file of files) {
      let source = "";
      try { source = readFileSync(join(directory, file), "utf8"); } catch { continue; }
      const name = basename(file, ".md");
      const entry = loopCommandFromSource(file, source);
      if (entry) found.set(name, entry);
    }
    // Loop order first, then anything the directory adds that this list has not
    // heard of, so a command file that ships is described the day it ships.
    loopCache = orderedLoopCommands(found);
    return loopCache;
  }

  function commandRegistry() {
    if (cache) return cache;
    cache = validateCommandRegistry(readJson(path), fail);
    return cache;
  }

  function describeCommand(name, options = {}) {
    const entries = [...commandRegistry().commands].sort((left, right) =>
      left.name.localeCompare(right.name));
    const loop = loopCommands();
    if (!name) {
      // Loop entries carry `surface`; CLI entries keep the exact shape they
      // always had, so a consumer reading this array is not re-broken to gain
      // the new rows.
      describeAllCommands(entries, loop, options);
      return;
    }
    const selection = commandDescriptionSelection(entries, loop, name);
    // The host command wins the bare word — `prove` names the loop step an agent
    // runs, not the internal `proof finalize` it happens to alias. The CLI
    // commands that share the word are still printed, so nothing is hidden.
    if (selection.loopEntry) {
      describeLoopCommand(selection, options);
      return;
    }
    if (!selection.aliased && !selection.exact && selection.family.length > 1) {
      describeCommandFamily(name, selection.family, options);
      return;
    }
    if (!selection.entry) {
      // The suggestion list spans both surfaces; a miss on `/investigate` used
      // to answer with sixty-seven CLI names and no mention of the loop.
      const known = [...loop, ...entries];
      const near = known.filter((candidate) => selection.target.split("-")
        .some((token) => normalizeCommandName(candidate.name).includes(token)));
      fail(`unknown command '${name}'\n  ${near.length ? "did you mean" : "known"}: ` +
        `${(near.length ? near : known).map((candidate) => candidate.name).join(", ")}`);
    }
    describeCliCommand(selection.entry, options);
  }

  function assertRegisteredRuntimeCommand(command, values = []) {
    if (!command) return;
    const registry = commandRegistry().runtimeCommands;
    if (registry.includes(command)) return;
    const word = values[0] && !values[0].startsWith("-") ? values[0] : null;
    const publicForm = word ? `${command} ${word}` : null;
    const known = publicForm &&
      commandRegistry().commands.some((entry) => entry.name === publicForm);
    const internal = known
      ? [`${command}-${word}`, word].find((candidate) => registry.includes(candidate))
      : null;
    if (internal)
      fail(`runtime command '${command}' is not registered\n` +
        `  '${publicForm}' is the CLI form: claude-foundation ${publicForm}\n` +
        `  this entrypoint takes the internal name: ${internal}`);
    fail(`runtime command '${command}' is not registered`);
  }

  return { commandRegistry, describeCommand, assertRegisteredRuntimeCommand };
}
