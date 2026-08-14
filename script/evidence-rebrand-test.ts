#!/usr/bin/env bun
// Runs the scoped bun test suites for the rebrand-user-visible-cli-strings
// change (brand surface, help snapshots, config discovery shims, bin maps,
// and test-home aliasing) across packages/core and packages/opencode, then
// writes a combined JSON summary for the harness test-discovery adapter.
// Bun's only built-in structured reporter is JUnit XML, not JSON or TAP, so
// this reads the JUnit reports and re-emits counts (same pattern as
// script/evidence-test.ts).
import path from "path"
import { mkdir } from "fs/promises"

const root = path.join(import.meta.dir, "..")

const suites = [
  {
    cwd: path.join(root, "packages", "core"),
    files: ["global.test.ts", "flag.test.ts", "bin.test.ts", "config/config.test.ts"],
  },
  {
    cwd: path.join(root, "packages", "opencode"),
    files: [
      "test/brand.test.ts",
      "test/bin.test.ts",
      "test/cli/help/help-snapshots.test.ts",
      "test/config/global-config.test.ts",
      "test/config/config.test.ts",
    ],
  },
]

const resultsDir = path.join(root, "test-results")
await mkdir(resultsDir, { recursive: true })

function attr(xml: string, name: string): number {
  const match = xml.match(new RegExp(`<testsuites[^>]*\\b${name}="(\\d+)"`))
  if (!match) throw new Error(`could not find "${name}" on the <testsuites> root element`)
  return Number(match[1])
}

let totalTests = 0
let totalFailures = 0
let exitCode = 0

for (const [index, suite] of suites.entries()) {
  const reportPath = path.join(resultsDir, `evidence-rebrand-test-${index}.xml`)
  const proc = Bun.spawnSync({
    cmd: ["bun", "test", "--timeout", "60000", "--reporter=junit", `--reporter-outfile=${reportPath}`, ...suite.files],
    cwd: suite.cwd,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (proc.exitCode !== 0) exitCode = proc.exitCode ?? 1

  const xml = await Bun.file(reportPath).text()
  totalTests += attr(xml, "tests")
  totalFailures += attr(xml, "failures")
}

await Bun.write(
  path.join(resultsDir, "evidence-rebrand-test.json"),
  JSON.stringify({ tests: totalTests, failures: totalFailures }),
)

console.log(`evidence-rebrand-test: ${totalTests} tests, ${totalFailures} failures`)
process.exit(exitCode)
