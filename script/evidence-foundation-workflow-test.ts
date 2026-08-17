#!/usr/bin/env bun
// Runs the scoped bun test suites for foundation-workflow-commands-builtin
// (config schema compat and foundation plugin tests) across packages/core and
// packages/opencode, then writes a combined JSON summary for the harness
// test-discovery adapter, including per-critical-case observations bound to
// named test cases in the JUnit reports. Bun's only built-in structured
// reporter is JUnit XML, not JSON or TAP, so this reads the JUnit reports and
// re-emits counts.
import path from "path"
import { mkdir } from "fs/promises"

const root = path.join(import.meta.dir, "..")

const suites = [
  {
    cwd: path.join(root, "packages", "core"),
    files: ["config/foundation-workflow.test.ts"],
  },
  {
    cwd: path.join(root, "packages", "opencode"),
    files: ["plugin/foundation.test.ts"],
  },
]

// Each critical case passes only when at least one JUnit test case whose name
// contains the pattern exists and none of the matching cases failed.
const criticalCases = [
  { id: "opaque-arguments", pattern: "preserves opaque arguments in one argv value" },
  { id: "old-cli", pattern: "fails closed with upgrade guidance" },
  { id: "user-override", pattern: "never intercepts a user-defined command" },
]

const resultsDir = path.join(root, "test-results")
await mkdir(resultsDir, { recursive: true })

function attr(xml: string, name: string): number {
  const match = xml.match(new RegExp(`<testsuites[^>]*\\b${name}="(\\d+)"`))
  if (!match) throw new Error(`could not find "${name}" on the <testsuites> root element`)
  return Number(match[1])
}

function caseStatus(xml: string, pattern: string): "pass" | "fail" | undefined {
  const matcher = new RegExp(`<testcase[^>]*name="[^"]*${pattern}[^"]*"[^>]*(?:/>|>([\\s\\S]*?)</testcase>)`, "g")
  let found = false
  for (const match of xml.matchAll(matcher)) {
    found = true
    if (match[1] && /<(failure|error)\b/.test(match[1])) return "fail"
  }
  return found ? "pass" : undefined
}

let totalTests = 0
let totalFailures = 0
let exitCode = 0
const reports: string[] = []

for (const [index, suite] of suites.entries()) {
  const reportPath = path.join(resultsDir, `evidence-foundation-workflow-test-${index}.xml`)
  const proc = Bun.spawnSync({
    cmd: ["bun", "test", "--reporter=junit", `--reporter-outfile=${reportPath}`, ...suite.files],
    cwd: suite.cwd,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (proc.exitCode !== 0) exitCode = proc.exitCode ?? 1

  const xml = await Bun.file(reportPath).text()
  totalTests += attr(xml, "tests")
  totalFailures += attr(xml, "failures")
  reports.push(xml)
}

const observations = criticalCases.map(({ id, pattern }) => {
  const statuses = reports.map((xml) => caseStatus(xml, pattern)).filter(Boolean)
  const status = statuses.length === 0 ? "missing" : statuses.includes("fail") ? "fail" : "pass"
  if (status !== "pass") exitCode ||= 1
  return { id, status }
})

await Bun.write(
  path.join(resultsDir, "evidence-foundation-workflow-test.json"),
  JSON.stringify({ tests: totalTests, failures: totalFailures, criticalCases: observations }),
)

console.log(
  `evidence-foundation-workflow-test: ${totalTests} tests, ${totalFailures} failures, ` +
    observations.map((row) => `${row.id}=${row.status}`).join(", "),
)
process.exit(exitCode)
