#!/usr/bin/env bun
// Runs the opencode CLI help-text snapshot suite and emits a JSON summary for
// the harness test-discovery adapter. Bun's only built-in structured reporter
// is JUnit XML, not JSON or TAP, so this reads the JUnit report and re-emits
// counts (same pattern as script/evidence-test.ts).
import path from "path"
import { mkdir } from "fs/promises"

const root = path.join(import.meta.dir, "..")
const cwd = path.join(root, "packages", "opencode")
const resultsDir = path.join(root, "test-results")
await mkdir(resultsDir, { recursive: true })
const reportPath = path.join(resultsDir, "cli-help-snapshots.xml")

const proc = Bun.spawnSync({
  cmd: ["bun", "test", "--timeout", "30000", "--reporter=junit", `--reporter-outfile=${reportPath}`, "test/cli/help/help-snapshots.test.ts"],
  cwd,
  stdout: "inherit",
  stderr: "inherit",
})

const xml = await Bun.file(reportPath).text()

function attr(name: string): number {
  const match = xml.match(new RegExp(`<testsuites[^>]*\\b${name}="(\\d+)"`))
  if (!match) throw new Error(`could not find "${name}" on the <testsuites> root element`)
  return Number(match[1])
}

const tests = attr("tests")
const failures = attr("failures")

await Bun.write(path.join(resultsDir, "cli-help-snapshots.json"), JSON.stringify({ tests, failures }))

console.log(`cli-help-snapshots: ${tests} tests, ${failures} failures`)
process.exit(proc.exitCode ?? (failures > 0 ? 1 : 0))
