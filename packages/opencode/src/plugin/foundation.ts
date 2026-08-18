import type { Config, Hooks, PluginInput } from "@opencode-ai/plugin"
import { Option, Schema } from "effect"
import TEMPLATE_INVESTIGATE from "./foundation/investigate.txt"
import TEMPLATE_CHANGE from "./foundation/change.txt"
import TEMPLATE_BUILD from "./foundation/build.txt"
import TEMPLATE_PROVE from "./foundation/prove.txt"
import TEMPLATE_LAND from "./foundation/land.txt"
import TEMPLATE_CHANGES from "./foundation/changes.txt"
import TEMPLATE_FEATURE from "./foundation/feature.txt"
import TEMPLATE_DEV from "./foundation/dev.txt"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const protocol = 1
const maxOutputBytes = 256 * 1024
const timeoutMs = 5_000

type FoundationCommand = keyof typeof FOUNDATION_COMMANDS
type FoundationFailureCode =
  | "foundation_cli_missing"
  | "foundation_cli_timeout"
  | "foundation_host_api_unsupported"
  | "foundation_response_invalid"

type FoundationProcessOptions = {
  executable?: string[]
  maxOutputBytes?: number
  timeoutMs?: number
}

type FoundationInstructionResult = { ok: true; instruction: string } | { ok: false; code: FoundationFailureCode }
type FoundationAgentContractResult = { ok: true; contract: string } | { ok: false; code: FoundationFailureCode }
type FoundationHostResult = { ok: true; stdout: string } | { ok: false; code: FoundationFailureCode }

export const FOUNDATION_COMMANDS = {
  investigate: {
    description: "Explore a problem or bounded alternatives without committing.",
    template: TEMPLATE_INVESTIGATE,
  },
  change: {
    description: "Create or complete an OpenSpec change and evidence contract.",
    template: TEMPLATE_CHANGE,
  },
  build: {
    description: "Implement one OpenSpec change in isolation.",
    template: TEMPLATE_BUILD,
  },
  prove: {
    description: "Produce content-bound evidence for an OpenSpec change.",
    template: TEMPLATE_PROVE,
  },
  land: {
    description: "Land and archive a proven OpenSpec change.",
    template: TEMPLATE_LAND,
  },
  changes: {
    description: "List active OpenSpec changes, readiness, blockers, and stale proof.",
    template: TEMPLATE_CHANGES,
  },
  feature: {
    description: "Ground a PRD once, then run one group through change, build, and prove.",
    template: TEMPLATE_FEATURE,
  },
  dev: {
    description: "Compatibility composition for change → build → prove.",
    template: TEMPLATE_DEV,
  },
} satisfies Record<string, { description: string; template: string }>

export function applyFoundationCommands(
  config: Config & { foundation_workflow?: boolean },
  injected = new Set<FoundationCommand>(),
) {
  if (config.foundation_workflow === false) return injected
  config.command ??= {}
  for (const name of Object.keys(FOUNDATION_COMMANDS) as FoundationCommand[]) {
    if (config.command[name]) continue
    config.command[name] = FOUNDATION_COMMANDS[name]
    injected.add(name)
  }
  return injected
}

export function createFoundationWorkflowHooks(
  input: Pick<PluginInput, "directory">,
  options: FoundationProcessOptions = {},
) {
  const injected = new Set<FoundationCommand>()
  let agentContract: Promise<FoundationAgentContractResult> | undefined
  return {
    config: async (config) => {
      applyFoundationCommands(config as Config & { foundation_workflow?: boolean }, injected)
    },
    "command.execute.before": async (event, output) => {
      if (!isFoundationCommand(event.command) || !injected.has(event.command)) return
      const command = event.command
      const marker = output.parts.find(
        (part) => part.type === "text" && part.text.trim() === FOUNDATION_COMMANDS[command].template.trim(),
      )
      if (marker?.type !== "text") return
      const result = await resolveFoundationInstruction({
        command,
        arguments: event.arguments,
        directory: input.directory,
        ...options,
      })
      marker.text = result.ok ? result.instruction : failureInstruction(result.code)
    },
    "experimental.chat.system.transform": async (_event, output) => {
      if (injected.size === 0) return
      agentContract ??= resolveFoundationAgentContract({ directory: input.directory, ...options })
      const result = await agentContract
      output.system.push(result.ok ? result.contract : failureAgentContract(result.code))
    },
  } satisfies Hooks
}

export async function FoundationWorkflowPlugin(input: PluginInput): Promise<Hooks> {
  return createFoundationWorkflowHooks(input)
}

export async function resolveFoundationInstruction(
  input: {
    command: FoundationCommand
    arguments: string
    directory: string
  } & FoundationProcessOptions,
): Promise<FoundationInstructionResult> {
  return runFoundationInstruction(input).then(
    (value) => value,
    (error) => ({ ok: false, code: processFailureCode(error) }),
  )
}

export async function resolveFoundationAgentContract(
  input: { directory: string } & FoundationProcessOptions,
): Promise<FoundationAgentContractResult> {
  return runFoundationAgentContract(input).then(
    (value) => value,
    (error) => ({ ok: false, code: processFailureCode(error) }),
  )
}

async function runFoundationInstruction(
  input: {
    command: FoundationCommand
    arguments: string
    directory: string
  } & FoundationProcessOptions,
): Promise<FoundationInstructionResult> {
  const result = await runFoundationHost(input, [
    "host",
    "instruction",
    input.command,
    "--protocol",
    String(protocol),
    "--format",
    "json",
    "--arguments",
    input.arguments,
  ])
  if (!result.ok) return result
  const decoded = decodeJson(result.stdout)
  if (Option.isNone(decoded) || !isRecord(decoded.value)) {
    return { ok: false, code: "foundation_response_invalid" }
  }
  const value = decoded.value
  const argumentMode = input.command === "changes" ? "none" : "required"
  if (
    value.protocol !== protocol ||
    value.command !== input.command ||
    value.argumentMode !== argumentMode ||
    typeof value.description !== "string" ||
    value.description.trim() === "" ||
    typeof value.instruction !== "string" ||
    value.instruction.trim() === "" ||
    typeof value.foundationVersion !== "string" ||
    value.foundationVersion.trim() === ""
  ) {
    return { ok: false, code: "foundation_response_invalid" }
  }
  return { ok: true, instruction: value.instruction }
}

async function runFoundationAgentContract(
  input: { directory: string } & FoundationProcessOptions,
): Promise<FoundationAgentContractResult> {
  const result = await runFoundationHost(input, [
    "host",
    "agent-contract",
    "--protocol",
    String(protocol),
    "--format",
    "json",
  ])
  if (!result.ok) return result
  const decoded = decodeJson(result.stdout)
  if (
    Option.isNone(decoded) ||
    !isRecord(decoded.value) ||
    decoded.value.protocol !== protocol ||
    typeof decoded.value.contract !== "string" ||
    decoded.value.contract.trim() === "" ||
    typeof decoded.value.foundationVersion !== "string" ||
    decoded.value.foundationVersion.trim() === ""
  ) {
    return { ok: false, code: "foundation_response_invalid" }
  }
  return { ok: true, contract: decoded.value.contract }
}

async function runFoundationHost(
  input: { directory: string } & FoundationProcessOptions,
  argv: string[],
): Promise<FoundationHostResult> {
  const signal = AbortSignal.timeout(input.timeoutMs ?? timeoutMs)
  const process = Bun.spawn({
    cmd: [...(input.executable ?? ["claude-foundation"]), ...argv],
    cwd: input.directory,
    stdout: "pipe",
    stderr: "pipe",
    signal,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    readLimited(process.stdout, input.maxOutputBytes ?? maxOutputBytes),
    readLimited(process.stderr, input.maxOutputBytes ?? maxOutputBytes),
    process.exited,
  ])
  if (signal.aborted) return { ok: false, code: "foundation_cli_timeout" }
  if (exitCode !== 0) return { ok: false, code: endpointFailureCode(stderr) }
  return { ok: true, stdout }
}

async function readLimited(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const result = await reader.read()
    if (result.done) return new TextDecoder().decode(Buffer.concat(chunks, size))
    size += result.value.byteLength
    if (size > limit) throw new FoundationResponseLimitError()
    chunks.push(result.value)
  }
}

function endpointFailureCode(stderr: string): FoundationFailureCode {
  const decoded = decodeJson(stderr)
  if (Option.isNone(decoded) || !isRecord(decoded.value) || !isRecord(decoded.value.error)) {
    return "foundation_host_api_unsupported"
  }
  return typeof decoded.value.error.code === "string"
    ? "foundation_host_api_unsupported"
    : "foundation_response_invalid"
}

function processFailureCode(error: unknown): FoundationFailureCode {
  if (error instanceof FoundationResponseLimitError) return "foundation_response_invalid"
  if (error instanceof Error && /ENOENT|not found/i.test(error.message)) return "foundation_cli_missing"
  return "foundation_host_api_unsupported"
}

function failureInstruction(code: FoundationFailureCode) {
  return `Foundation command unavailable (${code}). ${failureAction(code, "host instruction")} Stop here. Do not read project command files, use a bundled workflow body, or improvise the workflow.`
}

function failureAgentContract(code: FoundationFailureCode) {
  return `Foundation agent contract unavailable (${code}). ${failureAction(code, "host agent-contract")} Stop here. Do not read a project file, use a bundled contract, or improvise the harness workflow.`
}

function failureAction(code: FoundationFailureCode, endpoint: string) {
  if (code === "foundation_cli_missing") return "Install claude-foundation and ensure it is available on PATH."
  if (code === "foundation_cli_timeout") return "Verify the local claude-foundation installation and retry."
  return `Upgrade or reinstall claude-foundation with ${endpoint} protocol 1 support.`
}

function isFoundationCommand(command: string): command is FoundationCommand {
  return Object.hasOwn(FOUNDATION_COMMANDS, command)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

class FoundationResponseLimitError extends Error {}
