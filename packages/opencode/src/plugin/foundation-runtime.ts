import path from "path"
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm } from "fs/promises"
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
  ".foundation/adapter-manifests",
  "WORKFLOW.md",
  "CLAUDE.md",
  "AGENTS.md",
]

export type Mode = "bundled" | "path"
export type ProcessResult = { exitCode: number; stdout: string; stderr: string }
export type MaterializeOptions = {
  allowUntagged?: boolean
  cache?: string
  files?: Record<string, string>
  platform?: NodeJS.Platform
}

export async function command(mode: Mode = "bundled", options: MaterializeOptions = {}) {
  if (mode === "path") return ["claude-foundation"]
  return [path.join(await materialize(options), "bin", "claude-foundation")]
}

export async function environment(currentPath = process.env.PATH ?? "", options: MaterializeOptions = {}) {
  return { PATH: [path.join(await materialize(options), "bin"), currentPath].filter(Boolean).join(path.delimiter) }
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
  const executable = await command("bundled", options)
  await ensureOpenCodeManifest(root)
  return run([...executable, "init", "--host", "opencode", root, "--yes"], root, 120_000)
}

export async function hasManagedOpenCodeAdapter(directory: string, options: MaterializeOptions = {}) {
  const root = await canonicalDirectory(directory)
  const manifest = Bun.file(path.join(root, ".foundation/adapter-manifests/opencode.txt"))
  if (!(await manifest.exists())) return false
  const bundle = await loadBundle(options.files)
  const expected = bundle.manifest.files.reduce((result, entry) => {
    if (entry.path.startsWith(".claude/commands/") && entry.path.endsWith(".md")) {
      result.set(`.opencode/commands/${path.basename(entry.path)}`, entry.sha256)
      return result
    }
    if (entry.path === ".claude/harness/adapters/opencode-plugin.js") {
      result.set(".opencode/plugins/foundation.js", entry.sha256)
    }
    return result
  }, new Map<string, string>())
  const entries = (await manifest.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
  if (entries.length === 0 || entries.some((entry) => entry.length !== 2 || entry[0] !== "project")) return false
  const validated = await Promise.all(
    entries.map(async ([, relative]) => {
      const checksum = expected.get(relative)
      if (!checksum) return false
      const file = Bun.file(path.join(root, safeRelativePath(relative)))
      return (await file.exists()) && hash(await file.bytes()) === checksum
    }),
  )
  return validated.every(Boolean) && entries.some(([, relative]) => relative.startsWith(".opencode/commands/"))
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
  await mkdir(cache, { recursive: true })
  const cacheInfo = await lstat(cache)
  if (cacheInfo.isSymbolicLink() || !cacheInfo.isDirectory()) throw new Error(`Bundled Foundation cache is unsafe: ${cache}`)
  const cacheRoot = await realpath(cache)
  const digest = hash(await bundle.read("manifest.json"))
  const target = path.join(cacheRoot, `${bundle.manifest.release}-${bundle.manifest.commit.slice(0, 12)}-${digest.slice(0, 12)}`)
  const marker = `${digest}\n`
  if (await validMaterialization(cacheRoot, target, marker, bundle)) return target
  if (await lstat(target).then(
    () => true,
    () => false,
  ))
    throw new Error(`Bundled Foundation cache is invalid: ${target}`)

  await chmod(cacheRoot, 0o700)
  try {
    const staging = await mkdtemp(path.join(cacheRoot, ".staging-"))
    await Promise.all(
      bundle.manifest.files.map(async (entry) => {
        const relative = safeRelativePath(entry.path)
        const body = await bundle.read(`payload/${relative}`)
        if (hash(body) !== entry.sha256) throw new Error(`Bundled Foundation checksum mismatch: ${relative}`)
        const destination = path.join(staging, relative)
        await mkdir(path.dirname(destination), { recursive: true })
        await Bun.write(destination, body)
        await chmod(destination, entry.mode & 0o555)
      }),
    ).catch(async (error) => {
      await rm(staging, { recursive: true, force: true })
      throw error
    })
    await Bun.write(path.join(staging, ".changeloop-bundle"), marker)
    await chmod(path.join(staging, ".changeloop-bundle"), 0o400)
    await mkdir(path.join(staging, "bin"))
    await Bun.write(path.join(staging, "bin", "claude-foundation"), shim(target))
    await chmod(path.join(staging, "bin", "claude-foundation"), 0o500)
    await lockDirectories(staging)
    const moveError = await rename(staging, target).then(
      () => undefined,
      (error) => error,
    )
    if (!moveError) return target
    await rm(staging, { recursive: true, force: true })
    await chmod(cacheRoot, 0o500)
    if (await validMaterialization(cacheRoot, target, marker, bundle)) return target
    throw moveError
  } finally {
    await chmod(cacheRoot, 0o500)
  }
}

async function validMaterialization(
  cache: string,
  target: string,
  marker: string,
  bundle: Awaited<ReturnType<typeof loadBundle>>,
) {
  if (((await lstat(cache)).mode & 0o222) !== 0) return false
  const root = await lstat(target).catch(() => undefined)
  if (root?.isDirectory() !== true || !(await regularTree(target))) return false
  if (
    (await Bun.file(path.join(target, ".changeloop-bundle"))
      .text()
      .catch(() => "")) !== marker
  )
    return false
  const executable = path.join(target, "bin", "claude-foundation")
  const executableInfo = await lstat(executable).catch(() => undefined)
  if (
    executableInfo?.isFile() !== true ||
    (executableInfo.mode & 0o777) !== 0o500 ||
    (await Bun.file(executable).text().catch(() => "")) !== shim(target)
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

async function regularTree(directory: string): Promise<boolean> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        if (entry.isSymbolicLink()) return false
        const child = path.join(directory, entry.name)
        if (((await lstat(child)).mode & 0o222) !== 0) return false
        if (!entry.isDirectory()) return true
        return regularTree(child)
      }),
    )
  ).every(Boolean)
}

async function lockDirectories(directory: string): Promise<void> {
  await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => lockDirectories(path.join(directory, entry.name))),
  )
  await chmod(directory, 0o500)
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

async function ensureOpenCodeManifest(root: string) {
  const directory = path.join(root, ".foundation/adapter-manifests")
  await mkdir(directory, { recursive: true })
  const manifest = path.join(directory, "opencode.txt")
  await open(manifest, "wx").then(
    (file) => file.close(),
    (error) => {
      if (isNodeError(error) && error.code === "EEXIST") return
      throw error
    },
  )
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

function shim(target: string) {
  return `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = init ]; then
  umask 077
  runtime="$(mktemp -d "\${TMPDIR:-/tmp}/changeloop-foundation.XXXXXX")"
  cleanup() { rm -rf "$runtime"; }
  trap cleanup EXIT
  cp -R ${shellQuote(target)}/. "$runtime/"
  chmod -R u+w "$runtime"
  set +e
  bash "$runtime/cli.sh" "$@"
  status=$?
  set -e
  exit "$status"
fi
exec bash ${shellQuote(path.join(target, "cli.sh"))} "$@"
`
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function decodeManifest(json: string) {
  const decoded = decodeJson(json).pipe(Option.flatMap((value) => Schema.decodeUnknownOption(Manifest)(value)))
  if (Option.isNone(decoded)) throw new Error("Bundled Foundation manifest is invalid")
  return decoded.value
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

export * as FoundationRuntime from "./foundation-runtime"
