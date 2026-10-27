import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveUpdateAdvisory, updateBoundary, updateNotificationDirective
} from "./update-advisory.mjs";

export const HOST_INSTRUCTION_PROTOCOL = 1;
export const HOST_COMMANDS = Object.freeze([
  "investigate", "change", "build", "prove", "land", "changes", "feature", "dev"
]);

const COMMAND_FILES = new Map(HOST_COMMANDS.map((name) => [name, `${name}.md`]));
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = resolve(HERE, "../../../..");

export class HostInstructionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HostInstructionError";
    this.code = code;
  }
}

function parseCommandSource(source) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter)
    throw new HostInstructionError("instruction_unavailable",
      "The installed command instruction has invalid frontmatter.");
  const field = (name) =>
    (frontmatter[1].match(new RegExp(`^${name}:[ \\t]*(.+)$`, "m"))?.[1] || "").trim();
  const description = field("description");
  const argumentHint = field("argument-hint");
  const instruction = source.slice(frontmatter[0].length).trim();
  if (!description || !instruction)
    throw new HostInstructionError("instruction_unavailable",
      "The installed command instruction is incomplete.");
  return { description, argumentHint, instruction };
}

function readInstalled(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new HostInstructionError("instruction_unavailable",
      "The installed Foundation instruction is unavailable.");
  }
}

export function resolveHostInstruction(command, options = {}) {
  const packageRoot = options.packageRoot || DEFAULT_PACKAGE_ROOT;
  const protocol = Number(options.protocol ?? HOST_INSTRUCTION_PROTOCOL);
  const argumentsValue = options.arguments ?? "";

  if (protocol !== HOST_INSTRUCTION_PROTOCOL)
    throw new HostInstructionError("unsupported_protocol",
      `Host instruction protocol '${options.protocol}' is not supported.`);
  if (!COMMAND_FILES.has(command))
    throw new HostInstructionError("unknown_host_command",
      `Unknown Foundation host command '${command || ""}'.`);
  if (command === "changes" && argumentsValue !== "")
    throw new HostInstructionError("unexpected_arguments",
      "The changes command does not accept arguments.");

  const commandPath = join(packageRoot, ".claude", "commands", COMMAND_FILES.get(command));
  const source = parseCommandSource(readInstalled(commandPath));
  const foundationVersion = readInstalled(join(packageRoot, "VERSION")).trim();
  if (!foundationVersion)
    throw new HostInstructionError("instruction_unavailable",
      "The installed Foundation version is unavailable.");

  return {
    protocol: HOST_INSTRUCTION_PROTOCOL,
    command,
    description: source.description,
    instruction: source.instruction.replaceAll("$ARGUMENTS", () => String(argumentsValue)),
    argumentMode: source.argumentHint ? "required" : "none",
    foundationVersion
  };
}

export async function resolveHostInstructionWithUpdate(command, options = {}) {
  const instruction = resolveHostInstruction(command, options);
  const trigger = updateBoundary(command);
  if (!trigger) return instruction;
  const update = await resolveUpdateAdvisory({
    installedVersion: instruction.foundationVersion,
    cachePath: options.cachePath,
    env: options.env,
    fetchImpl: options.fetchImpl,
    now: options.now,
    timeoutMs: options.timeoutMs,
    ttlMs: options.ttlMs,
    refresh: options.refreshUpdate === true
  });
  return {
    ...instruction,
    update: { ...update, trigger },
    notification: updateNotificationDirective(update, trigger, options)
  };
}

export function parseHostInstructionArguments(argv) {
  const args = [...argv];
  const command = args.shift() || "";
  const options = { protocol: HOST_INSTRUCTION_PROTOCOL, format: "json", arguments: "" };
  while (args.length) {
    const flag = args.shift();
    if (!["--protocol", "--format", "--arguments"].includes(flag) || !args.length)
      throw new HostInstructionError("invalid_host_request",
        "Expected --protocol, --format, or --arguments followed by a value.");
    const value = args.shift();
    if (flag === "--protocol") options.protocol = value;
    if (flag === "--format") options.format = value;
    if (flag === "--arguments") options.arguments = value;
  }
  if (options.format !== "json")
    throw new HostInstructionError("unsupported_format", "Only JSON output is supported.");
  return { command, options };
}

export function hostInstructionResponse(argv, options = {}) {
  try {
    const parsed = parseHostInstructionArguments(argv);
    return { status: 0, body: resolveHostInstruction(parsed.command,
      { ...parsed.options, packageRoot: options.packageRoot }) };
  } catch (error) {
    const known = error instanceof HostInstructionError;
    return {
      status: 1,
      body: {
        protocol: HOST_INSTRUCTION_PROTOCOL,
        error: {
          code: known ? error.code : "instruction_unavailable",
          message: known ? error.message : "The installed Foundation instruction is unavailable."
        }
      }
    };
  }
}

export async function hostInstructionResponseWithUpdate(argv, options = {}) {
  try {
    const parsed = parseHostInstructionArguments(argv);
    return { status: 0, body: await resolveHostInstructionWithUpdate(parsed.command,
      { ...parsed.options, ...options }) };
  } catch (error) {
    const known = error instanceof HostInstructionError;
    return {
      status: 1,
      body: {
        protocol: HOST_INSTRUCTION_PROTOCOL,
        error: {
          code: known ? error.code : "instruction_unavailable",
          message: known ? error.message : "The installed Foundation instruction is unavailable."
        }
      }
    };
  }
}

async function main() {
  const result = await hostInstructionResponseWithUpdate(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.body)}\n`);
  process.exitCode = result.status;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)))
  await main();
