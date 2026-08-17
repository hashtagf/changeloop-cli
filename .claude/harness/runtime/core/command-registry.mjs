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
  "agent-task": "agents task",
  "agent-acquire": "agents acquire",
  "agent-release": "agents release",
  receipt: "evidence record",
  "run-provider": "evidence run",
  prove: "proof finalize",
  "host-execution-import": "telemetry host-import",
  validate: "change validate"
};

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
      const front = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!front) continue;
      const field = (key) =>
        (front[1].match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"))?.[1] || "").trim();
      const description = field("description");
      if (!description) continue;
      const name = basename(file, ".md");
      const hint = field("argument-hint");
      found.set(name, {
        name: `/${name}`,
        usage: hint ? `/${name} ${hint}` : `/${name}`,
        surface: "host-command",
        description,
        file: `.claude/commands/${file}`
      });
    }
    // Loop order first, then anything the directory adds that this list has not
    // heard of, so a command file that ships is described the day it ships.
    loopCache = [
      ...LOOP_COMMAND_ORDER.map((name) => found.get(name)).filter(Boolean),
      ...[...found.keys()].filter((name) => !LOOP_COMMAND_ORDER.includes(name))
        .sort().map((name) => found.get(name))
    ];
    return loopCache;
  }

  function commandRegistry() {
    if (cache) return cache;
    const registry = readJson(path);
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
    cache = registry;
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
      if (options.json) {
        console.log(JSON.stringify([...loop, ...entries], null, 2)); return;
      }
      if (loop.length) {
      console.log("Change loop (host commands, not CLI routes):\n");
        for (const entry of loop)
          console.log(`  ${entry.name.padEnd(22)} ${entry.description}`);
      console.log("");
      console.log("Describe the outcome to your coding agent; it runs routine commands and safe recovery.\n");
      }
      console.log("Commands (describe <command> for one):\n");
      for (const entry of entries)
        console.log(`  ${entry.name.padEnd(22)} ${entry.description}`);
      console.log("\nFile shapes:\n");
      console.log("  evidence.yaml, execution.yaml   openspec/schemas/<schema>/schema.yaml");
      console.log("  host execution, instruction     .claude/harness/runtime/contracts/");
      console.log("  authority response              authority status <change> --template");
      return;
    }
    const normalize = (value) => value.replace(/[\s-]+/g, "-");
    const target = normalize(name.replace(/^\/+/, ""));
    const aliased = RUNTIME_COMMAND_ALIASES[target];
    const exact = entries.find((candidate) => normalize(candidate.name) === target);
    const family = entries.filter((candidate) =>
      normalize(candidate.name).startsWith(`${target}-`));
    const resolve = () => entries.find((candidate) => candidate.name === aliased) ||
      entries.find((candidate) => normalize(candidate.name) === target) ||
      entries.find((candidate) => normalize(candidate.name).endsWith(`-${target}`)) ||
      entries.find((candidate) => normalize(candidate.name).split("-").includes(target));
    // The host command wins the bare word — `prove` names the loop step an agent
    // runs, not the internal `proof finalize` it happens to alias. The CLI
    // commands that share the word are still printed, so nothing is hidden.
    const loopEntry = loop.find((candidate) =>
      normalize(candidate.name.slice(1)) === target);
    if (loopEntry) {
      const related = !aliased && !exact && family.length > 1
        ? family
        : [resolve()].filter(Boolean);
      if (options.json) {
        console.log(JSON.stringify({ ...loopEntry, related }, null, 2)); return;
      }
      console.log(`${loopEntry.name} — ${loopEntry.description}\n`);
      console.log(`  usage:     ${loopEntry.usage}`);
      console.log(`  surface:   host command (${loopEntry.file})`);
      if (related.length) {
        console.log("\nRelated CLI commands:\n");
        for (const member of related)
          console.log(`  ${member.name.padEnd(22)} ${member.description}`);
      }
      return;
    }
    if (!aliased && !exact && family.length > 1) {
      if (options.json) { console.log(JSON.stringify(family, null, 2)); return; }
      console.log(`${name} — ${family.length} commands:\n`);
      for (const member of family)
        console.log(`  ${member.name.padEnd(22)} ${member.description}`);
      return;
    }
    const entry = resolve();
    if (!entry) {
      // The suggestion list spans both surfaces; a miss on `/investigate` used
      // to answer with sixty-seven CLI names and no mention of the loop.
      const known = [...loop, ...entries];
      const near = known.filter((candidate) => target.split("-")
        .some((token) => normalize(candidate.name).includes(token)));
      fail(`unknown command '${name}'\n  ${near.length ? "did you mean" : "known"}: ` +
        `${(near.length ? near : known).map((candidate) => candidate.name).join(", ")}`);
    }
    if (options.json) { console.log(JSON.stringify(entry, null, 2)); return; }
    console.log(`${entry.name} — ${entry.description}\n`);
    console.log(`  usage:     ${entry.usage}`);
    console.log(`  audience:  ${entry.audience}`);
    console.log(`  kind:      ${entry.kind}${entry.idempotent ? " (idempotent)" : ""}`);
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
