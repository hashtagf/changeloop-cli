import path from "path"
import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { Option, Schema } from "effect"

const Manifest = Schema.Struct({
  schema: Schema.Literal(1),
  release: Schema.String,
  commit: Schema.String,
  version: Schema.String,
  tagged: Schema.Boolean,
  hostProtocols: Schema.Struct({ instruction: Schema.Literal(1), agentContract: Schema.Literal(1) }),
  files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String, mode: Schema.Number })),
})
const InstalledProtocol = Schema.Struct({ runtime: Schema.String, runtimeApi: Schema.String })
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const maxOutputBytes = 1024 * 1024
const protectedRoots = [
  ".claude/orchestrator.md",
  ".claude/commands",
  ".claude/harness",
  ".claude/skills",
  ".claude/rules",
  ".claude/hooks",
  ".claude/settings.json",
  ".claude/settings.foundation.json",
  "openspec/config.yaml",
  "openspec/repositories.yaml",
  "openspec/schemas",
  "foundation.json",
  ".foundation/.gitignore",
  ".foundation/README.md",
  "WORKFLOW.md",
  "CLAUDE.md",
  "AGENTS.md",
]

export type Mode = "bundled" | "path"
export type ProcessResult = { exitCode: number; stdout: string; stderr: string }
type MaterializeOptions = {
  allowUntagged?: boolean
  cache?: string
  files?: Record<string, string>
  platform?: NodeJS.Platform
}

export async function command(mode: Mode = "bundled", options: MaterializeOptions = {}) {
  if (mode === "path") return ["claude-foundation"]
  return ["bash", path.join(await materialize(options), "cli.sh")]
}

export async function status(directory: string, options: MaterializeOptions = {}) {
  const root = await canonicalDirectory(directory)
  const bundle = await loadBundle(options.files)
  const identity = {
    schema: bundle.manifest.schema,
    release: bundle.manifest.release,
    commit: bundle.manifest.commit,
    version: bundle.manifest.version,
    tagged: bundle.manifest.tagged,
    hostProtocols: bundle.manifest.hostProtocols,
  }
  const installedFile = Bun.file(path.join(root, ".claude/harness/protocol.json"))
  if (!(await installedFile.exists())) {
    return { root, bundle: identity, installed: { state: "missing" as const } }
  }
  const decoded = decodeJson(await installedFile.text()).pipe(
    Option.flatMap((value) => Schema.decodeUnknownOption(InstalledProtocol)(value)),
  )
  if (Option.isNone(decoded)) {
    return { root, bundle: identity, installed: { state: "invalid" as const } }
  }
  return { root, bundle: identity, installed: { state: "installed" as const, ...decoded.value } }
}

export async function install(directory: string, options: MaterializeOptions = {}) {
  if ((options.platform ?? process.platform) === "win32") {
    return { exitCode: 1, stdout: "", stderr: "Foundation bootstrap is not supported on win32" }
  }
  const root = await canonicalDirectory(directory)
  await rejectSymlinkedDestinations(root)
  const runtime = await materialize(options)
  return run(["bash", path.join(runtime, "install.sh"), root, "--yes"], root, 120_000)
}

export async function doctor(directory: string, mode: Mode = "bundled", options: MaterializeOptions = {}) {
  return run(
    [...(await command(mode, options)), "doctor", "--stage", "change"],
    await canonicalDirectory(directory),
    30_000,
  )
}

export async function materialize(options: MaterializeOptions = {}) {
  const bundle = await loadBundle(options.files)
  const allowUntagged = options.allowUntagged ?? ["local", "dev"].includes(InstallationChannel)
  if (!bundle.manifest.tagged && !allowUntagged) {
    throw new Error(`Bundled Foundation release '${bundle.manifest.release}' is not a tagged release`)
  }
  if (!/^[0-9a-f]{40}$/.test(bundle.manifest.commit)) throw new Error("Bundled Foundation commit is invalid")
  if (!/^[A-Za-z0-9._+-]+$/.test(bundle.manifest.release)) throw new Error("Bundled Foundation release is invalid")
  const cache = path.resolve(options.cache ?? path.join(Global.Path.cache, "foundation"))
  const target = path.join(cache, `${bundle.manifest.release}-${bundle.manifest.commit.slice(0, 12)}`)
  const marker = `${hash(await bundle.read("manifest.json"))}\n`
  if (await validMaterialization(target, marker, bundle)) return target
  if (await Bun.file(target).exists()) throw new Error(`Bundled Foundation cache is invalid: ${target}`)

  await mkdir(cache, { recursive: true })
  const staging = await mkdtemp(path.join(cache, ".staging-"))
  await Promise.all(
    bundle.manifest.files.map(async (entry) => {
      const relative = safeRelativePath(entry.path)
      const body = await bundle.read(`payload/${relative}`)
      if (hash(body) !== entry.sha256) throw new Error(`Bundled Foundation checksum mismatch: ${relative}`)
      const destination = path.join(staging, relative)
      await mkdir(path.dirname(destination), { recursive: true })
      await Bun.write(destination, body)
      await chmod(destination, entry.mode & 0o777)
    }),
  ).catch(async (error) => {
    await rm(staging, { recursive: true, force: true })
    throw error
  })
  await Bun.write(path.join(staging, ".changeloop-bundle"), marker)
  const moveError = await rename(staging, target).then(
    () => undefined,
    (error) => error,
  )
  if (!moveError) return target
  await rm(staging, { recursive: true, force: true })
  if (await validMaterialization(target, marker, bundle)) return target
  throw moveError
}

async function validMaterialization(target: string, marker: string, bundle: Awaited<ReturnType<typeof loadBundle>>) {
  if (
    (await Bun.file(path.join(target, ".changeloop-bundle"))
      .text()
      .catch(() => "")) !== marker
  )
    return false
  return (
    await Promise.all(
      bundle.manifest.files.map(async (entry) => {
        const file = path.join(target, safeRelativePath(entry.path))
        const info = await lstat(file).catch(() => undefined)
        return info?.isFile() === true && hash(await Bun.file(file).bytes()) === entry.sha256
      }),
    )
  ).every(Boolean)
}

async function loadBundle(files?: Record<string, string>) {
  const embedded =
    files ??
    // @ts-expect-error - generated file exists in compiled builds
    (await import("foundation-runtime.gen.ts")
      .then((module) => module.default as Record<string, string>)
      .catch(() => undefined))
  const vendor = path.resolve(import.meta.dir, "../../vendor/claude-foundation")
  const read = (file: string) => {
    const relative = safeRelativePath(file)
    return Bun.file(embedded?.[relative] ?? path.join(vendor, relative)).bytes()
  }
  return { manifest: decodeManifest(new TextDecoder().decode(await read("manifest.json"))), read }
}

async function canonicalDirectory(directory: string) {
  const resolved = await realpath(path.resolve(directory))
  if (!(await lstat(resolved)).isDirectory()) throw new Error(`Foundation target is not a directory: ${resolved}`)
  return resolved
}

async function rejectSymlinkedDestinations(root: string) {
  await Promise.all(protectedRoots.map((relative) => rejectSymlinks(root, relative.split("/"))))
}

async function rejectSymlinks(root: string, parts: string[]) {
  const current = path.join(root, ...parts)
  const info = await lstat(current).catch(() => undefined)
  if (!info) {
    if (parts.length > 1) await rejectSymlinks(root, parts.slice(0, -1))
    return
  }
  if (info.isSymbolicLink()) throw new Error(`Foundation target contains a symlinked managed path: ${current}`)
  if (!info.isDirectory()) return
  await Promise.all(
    (await readdir(current, { withFileTypes: true })).map(async (entry) => {
      const child = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Foundation target contains a symlinked managed path: ${child}`)
      if (entry.isDirectory()) await rejectSymlinks(root, [...parts, entry.name])
    }),
  )
}

async function run(cmd: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
  const signal = AbortSignal.timeout(timeoutMs)
  const process = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe", signal })
  const [stdout, stderr, exitCode] = await Promise.all([
    readLimited(process.stdout),
    readLimited(process.stderr),
    process.exited,
  ])
  if (signal.aborted) return { exitCode: 1, stdout, stderr: "Foundation process timed out" }
  return { exitCode, stdout, stderr }
}

async function readLimited(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const result = await reader.read()
    if (result.done) return new TextDecoder().decode(Buffer.concat(chunks, size))
    size += result.value.byteLength
    if (size > maxOutputBytes) throw new Error("Foundation process output exceeded 1 MiB")
    chunks.push(result.value)
  }
}

function safeRelativePath(file: string) {
  if (!file || path.isAbsolute(file) || file.includes("\\") || file.split("/").includes("..")) {
    throw new Error(`Unsafe Foundation bundle path: ${file}`)
  }
  return file
}

function hash(body: Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(body).digest("hex")
}

function decodeManifest(json: string) {
  const decoded = decodeJson(json).pipe(Option.flatMap((value) => Schema.decodeUnknownOption(Manifest)(value)))
  if (Option.isNone(decoded)) throw new Error("Bundled Foundation manifest is invalid")
  return decoded.value
}

export * as FoundationRuntime from "./foundation-runtime"
