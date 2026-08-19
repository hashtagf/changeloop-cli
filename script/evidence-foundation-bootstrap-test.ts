#!/usr/bin/env bun

import path from "path"
import { mkdir, mkdtemp, rm, symlink } from "fs/promises"

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

if (mode === "deployment") {
  run(["bun", "run", "script/verify-foundation.ts"], opencode)
  run(["bun", "run", "script/build.ts", "--single", "--skip-install", "--skip-embed-web-ui"], opencode)
  if (process.platform !== "win32") await smokeCompiledBinary()
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
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1)
}

async function smokeCompiledBinary() {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "changeloop-foundation-binary-"))
  const bin = path.join(root, "bin")
  const project = path.join(root, "project")
  await mkdir(bin)
  await mkdir(project)
  const node = Bun.which("node")
  const bash = Bun.which("bash")
  if (!node || !bash) throw new Error("compiled Foundation smoke requires node and bash")
  await symlink(node, path.join(bin, "node"))
  await symlink(bash, path.join(bin, "bash"))
  const binary = path.join(opencode, `dist/opencode-${process.platform}-${process.arch}/bin/opencode`)
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` }
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
  await rm(root, { recursive: true, force: true })
}
