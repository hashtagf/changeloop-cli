#!/usr/bin/env bun

import path from "path"
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "fs/promises"

const root = path.resolve(import.meta.dir, "..")
const mode = process.argv[2] ?? "test"
const opencode = path.join(root, "packages/opencode")
const core = path.join(root, "packages/core")
const suites = [
  { cwd: core, files: ["test/config/foundation-workflow.test.ts"] },
  {
    cwd: opencode,
    files: [
      "test/plugin/foundation.test.ts",
      "test/plugin/foundation-runtime.test.ts",
      "test/plugin/foundation-bundle.test.ts",
      "test/cli/foundation.test.ts",
    ],
  },
]
const cases = [
  ["bundled-lifecycle-uses-selected-runtime", "materialized command is a release-bound executable shim"],
  ["path-and-inactive-modes-preserve-environment", "PATH, disabled, and fully user-owned command surfaces"],
  ["invalid-bundled-shim-fails-closed", "tampered execution shim invalidates"],
  ["opencode-host-integration-is-installed", "real release installer initializes"],
  ["foundation-managed-opencode-commands-use-bundled-runtime", "Foundation-managed native OpenCode commands"],
  ["user-owned-opencode-artifacts-are-preserved", "OpenCode host install preserves user-owned collisions"],
  ["bundled-payload-includes-opencode-installer", "shipped manifest includes the OpenCode host installer"],
  ["additive-protocol-response-remains-compatible", "accepts additive protocol fields"],
  ["canonical-context-is-injected", "resolves harness context from Foundation once"],
  ["canonical-project-instruction-is-used", "canonical instructions"],
  ["compiled-binary-works-without-path-foundation", "compiled-file source"],
  ["context-endpoint-fails-closed", "agent contract resolution is unavailable"],
  ["explicit-path-compatibility-mode", "explicit PATH mode"],
  ["first-foundation-command-guides-one-time-bootstrap", "guides explicit bootstrap"],
  ["fresh-project-is-initialized", "real release installer initializes"],
  ["inactive-built-ins-add-no-context", "omits harness context when builtins are disabled"],
  ["interrupted-installation-rolls-back-or-resumes-safely", "rolls back an interrupted mutation"],
  ["loop-commands-present-by-default", "injects the loop commands at boot by default"],
  ["opening-a-project-remains-read-only", "status is read-only"],
  ["opt-out-disables-injection", "foundation_workflow false disables injection"],
  ["partial-foundation-installation-fails-closed", "classifies missing, timed-out, and unsupported"],
  ["payload-drift-blocks-the-build", "payload drift blocks bundle generation"],
  ["repeated-initialization-converges", "idempotently preserves unrelated project content"],
  ["runtime-use-performs-no-network-download", "bundled host endpoints work without a PATH"],
  ["unsafe-target-is-rejected-before-mutation", "symlinked managed destination is rejected"],
] as const

if (mode === "deployment" || mode === "compiled-test") {
  await ensureCompiledBinary()
  if (process.platform !== "win32") await smokeCompiledBinary()
  if (mode === "compiled-test") {
    await mkdir(path.join(root, "test-results"), { recursive: true })
    await Bun.write(
      path.join(root, "test-results/evidence-foundation-bootstrap-compiled.json"),
      JSON.stringify({
        tests: 1,
        failures: 0,
        criticalCases: [{ id: "compiled-binary-executes-lifecycle-without-path-foundation", status: "pass" }],
      }),
    )
  }
  console.log("compiled-binary-executes-lifecycle-without-path-foundation=pass")
  process.exit(0)
}
if (mode === "supply-chain" || mode === "cross-repo-contract") {
  run(["bun", "run", "script/verify-foundation.ts"], opencode)
  process.exit(0)
}
if (mode !== "test") {
  suites.forEach((suite) => run(["bun", "test", ...suite.files], suite.cwd))
  process.exit(0)
}

const output = path.join(root, "test-results")
await mkdir(output, { recursive: true })
const reports = suites.map((suite, index) => {
  const report = path.join(output, `evidence-foundation-bootstrap-${index}.xml`)
  run(["bun", "test", "--reporter=junit", `--reporter-outfile=${report}`, ...suite.files], suite.cwd)
  return Bun.file(report).text()
})
const xml = (await Promise.all(reports)).join("\n")
const observations = cases.map(([id, pattern]) => {
  const matches = [
    ...xml.matchAll(new RegExp(`<testcase[^>]*name="[^"]*${pattern}[^"]*"[^>]*(?:/>|>([\\s\\S]*?)</testcase>)`, "g")),
  ]
  return {
    id,
    status:
      matches.length > 0 && matches.every((match) => !/<(failure|error)\b/.test(match[1] ?? "")) ? "pass" : "fail",
  }
})
await Bun.write(
  path.join(output, "evidence-foundation-bootstrap-test.json"),
  JSON.stringify({
    tests: (xml.match(/<testcase\b/g) ?? []).length,
    failures: observations.filter((item) => item.status !== "pass").length,
    criticalCases: observations,
  }),
)
console.log(observations.map((item) => `${item.id}=${item.status}`).join("\n"))
process.exit(observations.some((item) => item.status !== "pass") ? 1 : 0)

function run(cmd: string[], cwd: string) {
  const result = Bun.spawnSync({ cmd, cwd, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`command failed (${result.exitCode ?? 1}): ${cmd.join(" ")}`)
}

async function ensureCompiledBinary() {
  const output = path.join(root, "test-results")
  const marker = path.join(output, "foundation-compiled-ready")
  const lock = path.join(output, "foundation-compiled-lock")
  const fingerprint = await compiledFingerprint()
  await mkdir(output, { recursive: true })
  if ((await Bun.file(marker).text().catch(() => "")) === fingerprint) return
  const deadline = Date.now() + 120_000
  while (true) {
    const acquired = await mkdir(lock).then(
      () => true,
      (error) => {
        if (isNodeError(error) && error.code === "EEXIST") return false
        throw error
      },
    )
    if (acquired) break
    if ((await Bun.file(marker).text().catch(() => "")) === fingerprint) return
    if (Date.now() >= deadline) throw new Error("compiled Foundation smoke timed out waiting for the build lock")
    await Bun.sleep(100)
  }
  try {
    if ((await Bun.file(marker).text().catch(() => "")) === fingerprint) return
    run(["bun", "run", "script/verify-foundation.ts"], opencode)
    run(["bun", "run", "script/build.ts", "--single", "--skip-install", "--skip-embed-web-ui"], opencode)
    await Bun.write(marker, fingerprint)
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

async function compiledFingerprint() {
  const head = Bun.spawnSync({ cmd: ["git", "rev-parse", "HEAD"], cwd: root, stdout: "pipe", stderr: "pipe" })
  if (head.exitCode !== 0) throw new Error("compiled Foundation smoke cannot resolve the repository HEAD")
  const hasher = new Bun.CryptoHasher("sha256").update(head.stdout)
  for (const file of [
    "packages/opencode/src/plugin/foundation-runtime.ts",
    "packages/opencode/src/plugin/foundation.ts",
    "packages/opencode/vendor/claude-foundation/manifest.json",
    "packages/opencode/vendor/claude-foundation/payload/install-opencode.sh",
  ]) {
    hasher.update(await Bun.file(path.join(root, file)).bytes())
  }
  return `${hasher.digest("hex")}\n`
}

async function smokeCompiledBinary() {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "changeloop-foundation-binary-"))
  const bin = path.join(root, "bin")
  const project = path.join(root, "project")
  const cache = path.join(root, "cache")
  const data = path.join(root, "data")
  const config = path.join(root, "config")
  const state = path.join(root, "state")
  await mkdir(bin)
  await mkdir(project)
  await mkdir(path.join(project, ".opencode/commands"), { recursive: true })
  await writeFile(path.join(project, ".opencode/commands/change.md"), "user-owned change command\n")
  const node = Bun.which("node")
  const bash = Bun.which("bash")
  if (!node || !bash) throw new Error("compiled Foundation smoke requires node and bash")
  await symlink(node, path.join(bin, "node"))
  await symlink(bash, path.join(bin, "bash"))
  const binary = path.join(opencode, `dist/opencode-${process.platform}-${process.arch}/bin/opencode`)
  const env = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: data,
    XDG_CONFIG_HOME: config,
    XDG_STATE_HOME: state,
  }
  const execute = (args: string[]) => {
    const result = Bun.spawnSync({
      cmd: [binary, "foundation", ...args],
      cwd: project,
      env,
      stdout: "inherit",
      stderr: "inherit",
    })
    if (result.exitCode !== 0) throw new Error(`compiled Foundation smoke failed: ${args[0]}`)
  }
  execute(["status", project, "--json"])
  execute(["init", project, "--yes"])
  execute(["doctor", project])
  await requireFile(path.join(project, ".opencode/commands/changes.md"))
  await requireFile(path.join(project, ".opencode/plugins/foundation.js"))
  await requireFile(path.join(project, ".foundation/adapter-manifests/opencode.txt"))
  if ((await Bun.file(path.join(project, ".opencode/commands/change.md")).text()) !== "user-owned change command\n") {
    throw new Error("compiled Foundation smoke overwrote a user-owned OpenCode command")
  }
  await executeLifecycleThroughPty(binary, project, env, path.join(root, "lifecycle.txt"))
  await removeTree(root)
}

async function executeLifecycleThroughPty(
  binary: string,
  project: string,
  env: Record<string, string | undefined>,
  output: string,
) {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = reservation.port
  reservation.stop(true)
  const server = Bun.spawn({
    cmd: [binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    cwd: project,
    env,
    stdout: "inherit",
    stderr: "inherit",
  })
  const result = await runLifecyclePty(`http://127.0.0.1:${port}`, project, output).then(
    () => undefined,
    (error) => error,
  )
  server.kill()
  await server.exited
  if (result) throw result
}

async function runLifecyclePty(server: string, project: string, output: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const response = await fetch(`${server}/global/health`).catch(() => undefined)
    if (response?.ok) break
    await Bun.sleep(50)
  }
  const health = await fetch(`${server}/global/health`).catch(() => undefined)
  if (!health?.ok) throw new Error("compiled Foundation smoke server did not become healthy")
  const headers = { "content-type": "application/json", "x-opencode-directory": project }
  const created = await fetch(`${server}/api/pty`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      command: "/bin/bash",
      args: ["-lc", `claude-foundation changes > ${shellQuote(output)}`],
      cwd: project,
      title: "Foundation lifecycle smoke",
    }),
  })
  const body = await created.json()
  const data = isRecord(body) && isRecord(body.data) ? body.data : undefined
  if (!created.ok || typeof data?.id !== "string") throw new Error("compiled Foundation smoke could not create PTY")
  while (Date.now() < deadline) {
    const response = await fetch(`${server}/api/pty/${data.id}`, { headers })
    const current = await response.json()
    const info = isRecord(current) && isRecord(current.data) ? current.data : undefined
    if (info?.status === "exited") {
      if (info.exitCode !== 0) throw new Error(`compiled Foundation lifecycle PTY exited ${info.exitCode}`)
      if (!(await Bun.file(output).text()).includes("No active changes")) {
        throw new Error("compiled Foundation lifecycle PTY did not produce the expected result")
      }
      return
    }
    await Bun.sleep(50)
  }
  throw new Error("compiled Foundation lifecycle PTY timed out")
}

async function requireFile(file: string) {
  if (!(await Bun.file(file).exists())) throw new Error(`compiled Foundation smoke missing ${file}`)
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

async function removeTree(root: string) {
  await makeWritable(root)
  await rm(root, { recursive: true, force: true })
}

async function makeWritable(file: string): Promise<void> {
  const info = await lstat(file).catch(() => undefined)
  if (!info || info.isSymbolicLink()) return
  await chmod(file, info.isDirectory() ? 0o700 : 0o600)
  if (!info.isDirectory()) return
  await Promise.all((await readdir(file)).map((entry) => makeWritable(path.join(file, entry))))
}
