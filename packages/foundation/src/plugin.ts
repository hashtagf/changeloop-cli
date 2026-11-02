import { define, type Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema } from "effect"
import { embeddedFiles, type Embedded, type Loader } from "./embedded-files.js"
import { FoundationRuntime } from "./foundation-runtime.js"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const protocol = 1
const defaultMaxOutputBytes = 256 * 1024
const defaultTimeoutMs = 5_000

export const COMMANDS = {
  investigate: "Explore a problem or bounded alternatives without committing.",
  change: "Create or complete an OpenSpec change and evidence contract.",
  build: "Implement one OpenSpec change in isolation.",
  prove: "Produce content-bound evidence for an OpenSpec change.",
  land: "Land and archive a proven OpenSpec change.",
  changes: "List active OpenSpec changes, readiness, blockers, and stale proof.",
  feature: "Ground a PRD once, then run one group through change, build, and prove.",
  dev: "Compatibility composition for change → build → prove.",
} as const satisfies Record<string, string>

export type CommandName = keyof typeof COMMANDS
export type FailureCode =
  | "foundation_cli_missing"
  | "foundation_cli_timeout"
  | "foundation_host_api_unsupported"
  | "foundation_bundle_invalid"
  | "foundation_response_invalid"

/**
 * Plugin entry options. `workflow` and `runtime` replace the v1 `foundation_workflow` and
 * `foundation_runtime` config keys; the rest tune the host process and exist mainly for tests.
 */
export type Options = {
  workflow?: boolean
  runtime?: FoundationRuntime.Mode
  executable?: string[]
  runtimeOptions?: FoundationRuntime.MaterializeOptions
  maxOutputBytes?: number
  timeoutMs?: number
  /** Replaces the dynamic import of the build-time embedded file map; exists for tests. */
  loadEmbedded?: Loader
}

type Host = { directory: string; bundleBroken?: true } & Required<Pick<Options, "runtime">> &
  Pick<Options, "executable" | "runtimeOptions" | "maxOutputBytes" | "timeoutMs">
type Result<T> = ({ ok: true } & T) | { ok: false; code: FailureCode }
type HostResult = Result<{ stdout: string }>

export function parseOptions(value: Readonly<Record<string, unknown>>): Options {
  const options: Options = {}
  if (typeof value.workflow === "boolean") options.workflow = value.workflow
  if (value.runtime === "bundled" || value.runtime === "path") options.runtime = value.runtime
  if (Array.isArray(value.executable) && value.executable.length > 0 && value.executable.every((x) => typeof x === "string"))
    options.executable = value.executable
  if (typeof value.timeoutMs === "number" && value.timeoutMs > 0) options.timeoutMs = value.timeoutMs
  if (typeof value.maxOutputBytes === "number" && value.maxOutputBytes > 0) options.maxOutputBytes = value.maxOutputBytes
  return options
}

/** Builds the plugin. `base` supplies defaults that plugin entry options override. */
export function make(base: Options = {}) {
  return define({
    id: "opencode.foundation",
    effect: Effect.fn("FoundationPlugin")(function* (ctx: Context) {
      const options = { ...base, ...parseOptions(ctx.options) }
      if (options.workflow === false) return
      const runtime = options.runtime ?? "bundled"
      // A compiled build embeds the runtime files; without them the vendored bundle on disk is used.
      const embedded: Embedded =
        runtime === "bundled" && !options.runtimeOptions?.files ? yield* Effect.promise(() => embeddedFiles(options.loadEmbedded)) : {}
      const host: Host = {
        directory: ctx.location.directory,
        runtime,
        ...(embedded.broken ? { bundleBroken: true as const } : {}),
        executable: options.executable,
        runtimeOptions: embedded.files ? { ...options.runtimeOptions, files: embedded.files } : options.runtimeOptions,
        maxOutputBytes: options.maxOutputBytes,
        timeoutMs: options.timeoutMs,
      }
      let contract: Promise<Result<{ contract: string }>> | undefined

      // Registered before the config command plugin, so a user command of the same name replaces it.
      yield* ctx.command.transform((editor) => {
        for (const name of Object.keys(COMMANDS) as CommandName[]) {
          editor.add({
            name,
            description: COMMANDS[name],
            execute: (input) =>
              Effect.promise(() => prompt(host, name, input.prompt.text)).pipe(
                Effect.flatMap((text) =>
                  ctx.session.prompt({
                    ...input.prompt,
                    sessionID: input.sessionID,
                    text,
                    delivery: input.delivery,
                  }),
                ),
                Effect.asVoid,
              ),
          })
        }
      })

      if (host.runtime === "bundled") {
        yield* ctx.shell.hook("create.before", (event) =>
          Effect.promise(() =>
            FoundationRuntime.environment(event.env.PATH ?? process.env.PATH, host.runtimeOptions).then(
              (env) => void Object.assign(event.env, env),
              () => undefined,
            ),
          ),
        )
      }

      yield* ctx.session.hook("context", (event) =>
        Effect.promise(async () => {
          contract ??= resolveAgentContract(host)
          const result = await contract
          event.system.push({ type: "text", text: result.ok ? result.contract : failureAgentContract(result.code) })
        }),
      )
    }),
  })
}

async function prompt(host: Host, command: CommandName, args: string) {
  const result = await resolveInstruction(host, command, args)
  if (!result.ok) return failureInstruction(result.code)
  if (host.runtime !== "bundled") return result.instruction
  const project = await FoundationRuntime.status(host.directory, host.runtimeOptions).catch(() => undefined)
  return project?.installed.state === "installed" ? result.instruction : bootstrapInstruction(result.instruction)
}

export function resolveInstruction(host: Host, command: CommandName, args: string) {
  return attempt(async (): Promise<Result<{ instruction: string }>> => {
    const result = await runHost(host, [
      "host",
      "instruction",
      command,
      "--protocol",
      String(protocol),
      "--format",
      "json",
      "--arguments",
      args,
    ])
    if (!result.ok) return result
    const value = record(result.stdout)
    if (
      !value ||
      value.protocol !== protocol ||
      value.command !== command ||
      value.argumentMode !== (command === "changes" ? "none" : "required") ||
      !text(value.description) ||
      !text(value.instruction) ||
      !text(value.foundationVersion)
    )
      return { ok: false, code: "foundation_response_invalid" }
    return { ok: true, instruction: value.instruction as string }
  })
}

export function resolveAgentContract(host: Host) {
  return attempt(async (): Promise<Result<{ contract: string }>> => {
    const result = await runHost(host, ["host", "agent-contract", "--protocol", String(protocol), "--format", "json"])
    if (!result.ok) return result
    const value = record(result.stdout)
    if (!value || value.protocol !== protocol || !text(value.contract) || !text(value.foundationVersion))
      return { ok: false, code: "foundation_response_invalid" }
    return { ok: true, contract: value.contract as string }
  })
}

async function attempt<T extends { ok: boolean }>(run: () => Promise<T>): Promise<T | { ok: false; code: FailureCode }> {
  return run().catch((error) => ({ ok: false as const, code: processFailureCode(error) }))
}

async function runHost(host: Host, argv: string[]): Promise<HostResult> {
  if (host.bundleBroken) return { ok: false, code: "foundation_bundle_invalid" }
  const command = host.executable ?? (await FoundationRuntime.command(host.runtime, host.runtimeOptions))
  const executable =
    host.runtime === "path" && !host.executable ? Bun.which(command[0], { PATH: process.env.PATH ?? "" }) : command[0]
  if (!executable) return { ok: false, code: "foundation_cli_missing" }
  const signal = AbortSignal.timeout(host.timeoutMs ?? defaultTimeoutMs)
  const limit = host.maxOutputBytes ?? defaultMaxOutputBytes
  const child = Bun.spawn({
    cmd: [executable, ...command.slice(1), ...argv],
    cwd: host.directory,
    stdout: "pipe",
    stderr: "pipe",
    signal,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    readLimited(child.stdout, limit),
    readLimited(child.stderr, limit),
    child.exited,
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
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      throw new ResponseLimitError()
    }
    chunks.push(result.value)
  }
}

function endpointFailureCode(stderr: string): FailureCode {
  const error = record(stderr)?.error
  if (typeof error !== "object" || error === null || Array.isArray(error)) return "foundation_host_api_unsupported"
  return typeof (error as Record<string, unknown>).code === "string"
    ? "foundation_host_api_unsupported"
    : "foundation_response_invalid"
}

function processFailureCode(error: unknown): FailureCode {
  if (error instanceof ResponseLimitError) return "foundation_response_invalid"
  if (error instanceof Error && /ENOENT|not found/i.test(error.message)) return "foundation_cli_missing"
  if (error instanceof Error && /Bundled Foundation|Unsafe Foundation bundle/i.test(error.message))
    return "foundation_bundle_invalid"
  return "foundation_host_api_unsupported"
}

export function failureInstruction(code: FailureCode) {
  return `Foundation command unavailable (${code}). ${failureAction(code, "host instruction")} Stop here. Do not read project command files, use a bundled workflow body, or improvise the workflow.`
}

export function failureAgentContract(code: FailureCode) {
  return `Foundation agent contract unavailable (${code}). ${failureAction(code, "host agent-contract")} Stop here. Do not read a project file, use a bundled contract, or improvise the harness workflow.`
}

function failureAction(code: FailureCode, endpoint: string) {
  if (code === "foundation_cli_missing") return "Install claude-foundation and ensure it is available on PATH."
  if (code === "foundation_cli_timeout") return "Verify the local claude-foundation installation and retry."
  if (code === "foundation_bundle_invalid") return "Reinstall this Changeloop release and retry."
  return `Upgrade or reinstall claude-foundation with ${endpoint} protocol 1 support.`
}

export function bootstrapInstruction(instruction: string) {
  return [
    "Foundation is not initialized in this project.",
    "Ask the user for explicit approval before changing repository files.",
    "After approval, run `changeloop foundation init --yes` from this project and verify that it succeeds.",
    "If approval is declined or initialization fails, stop without improvising the workflow.",
    "After successful initialization, continue with this canonical instruction:",
    instruction,
  ].join("\n\n")
}

function record(json: string) {
  const decoded = decodeJson(json)
  if (Option.isNone(decoded)) return undefined
  const value = decoded.value
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() !== ""
}

class ResponseLimitError extends Error {}

export default make()
