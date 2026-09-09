import path from "path"
import { lstat, realpath } from "fs/promises"
import { Option, Schema } from "effect"
import { FoundationRuntime } from "./foundation-runtime"

export * as FoundationWebui from "./foundation-webui"

export type FailureCode =
  | "not_initialized"
  | "unsupported"
  | "timeout"
  | "output_too_large"
  | "invalid_response"
  | "runtime_unavailable"
export class ReadError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message)
    this.name = "FoundationReadError"
  }
}

export type Options = FoundationRuntime.MaterializeOptions & { env?: NodeJS.ProcessEnv }
const inflight = new Map<string, Promise<Awaited<ReturnType<typeof snapshot>>>>()
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const Header = Schema.Struct({ schemaVersion: Schema.Number, foundationVersion: Schema.String })

export async function read(directory: string, mode: FoundationRuntime.Mode = "bundled", options: Options = {}) {
  const root = await realpath(directory)
  const env = options.env ?? process.env
  const executable = await FoundationRuntime.command(mode, options).then(
    async (cmd) => {
      const resolved = mode === "path" ? Bun.which(cmd[0], { PATH: env.PATH ?? "" }) : cmd[0]
      if (!resolved) throw new ReadError("runtime_unavailable", "Selected Foundation runtime is unavailable")
      return realpath(resolved)
    },
    () => {
      throw new ReadError("runtime_unavailable", "Selected Foundation bundle is unavailable")
    },
  )
  const info = await lstat(executable)
  const identity = `${mode}:${executable}:${info.size}:${info.mtimeMs}`
  // Environment influences interpreter resolution; never join requests using different host environments.
  const key = JSON.stringify([root, identity, Object.entries(env).sort(([a], [b]) => a.localeCompare(b))])
  const existing = inflight.get(key)
  if (existing) return existing
  const pending = snapshot(root, executable, env, { mode, identity }).finally(() => inflight.delete(key))
  inflight.set(key, pending)
  return pending
}

async function snapshot(
  root: string,
  executable: string,
  env: NodeJS.ProcessEnv,
  runtime: { mode: FoundationRuntime.Mode; identity: string },
) {
  if (!(await Bun.file(path.join(root, ".claude/harness/protocol.json")).exists())) {
    throw new ReadError("not_initialized", "Foundation is not initialized for this project")
  }
  const child = (() => {
    try {
      return Bun.spawn({
        cmd: [executable, "dashboard", "snapshot", "--json"],
        cwd: root,
        env: { ...env, CLAUDE_FOUNDATION_PROJECT: root },
        detached: process.platform !== "win32",
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch {
      throw new ReadError("runtime_unavailable", "Selected Foundation runtime could not start")
    }
  })()
  const state = { bytes: 0, failure: undefined as ReadError | undefined }
  const readers = [child.stdout.getReader(), child.stderr.getReader()]
  const aborted = Promise.withResolvers<never>()
  const stop = (error: ReadError) => {
    if (state.failure) return
    state.failure = error
    aborted.reject(error)
    readers.forEach((reader) => { void reader.cancel().catch(() => undefined) })
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL")
      else child.kill("SIGKILL")
    } catch {
      // A process may exit while descendants still hold its pipes, or the host may
      // deny group signalling. Preserve the typed failure and bound the reader.
      try { child.kill("SIGKILL") } catch { /* Already gone or denied by the host. */ }
    }
  }
  const timer = setTimeout(() => stop(new ReadError("timeout", "Foundation snapshot exceeded 5 seconds")), 5000)
  const capture = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const chunks: Uint8Array[] = []
    while (true) {
      const item = await reader.read()
      if (item.done) break
      const chunk = item.value
      state.bytes += chunk.byteLength
      if (state.bytes > 1024 * 1024) {
        stop(new ReadError("output_too_large", "Foundation snapshot exceeded 1 MiB"))
        continue
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString("utf8")
  }
  try {
    const [stdout, , exitCode] = await Promise.race([Promise.all([capture(readers[0]), capture(readers[1]), child.exited]), aborted.promise])
    if (state.failure) throw state.failure
    if (exitCode !== 0)
      throw new ReadError("runtime_unavailable", "Selected Foundation runtime failed to read its snapshot")
    const value = decodeJson(stdout)
    if (Option.isNone(value)) throw new ReadError("invalid_response", "Foundation snapshot is not valid JSON")
    const header = Schema.decodeUnknownOption(Header)(value.value)
    if (Option.isNone(header)) throw new ReadError("invalid_response", "Foundation snapshot header is invalid")
    if (header.value.schemaVersion !== 3)
      throw new ReadError("unsupported", "Foundation snapshot schema is unsupported")
    return { runtime: { ...runtime, version: header.value.foundationVersion }, snapshot: value.value }
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && !state.failure) child.kill("SIGKILL")
    if (!state.failure) await child.exited
  }
}
