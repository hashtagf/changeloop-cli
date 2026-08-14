#!/usr/bin/env bun
// Asserts every .github/workflows/*.yml parses as YAML, and that
// plugin.yml specifically builds and tests the template plugin scaffold.
import path from "path"
import { readdir } from "fs/promises"

const workflowsDir = path.join(import.meta.dir, "..", ".github", "workflows")
const files = (await readdir(workflowsDir)).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))

const parseErrors: string[] = []
let pluginWorkflow: unknown

for (const file of files) {
  const filePath = path.join(workflowsDir, file)
  const text = await Bun.file(filePath).text()
  try {
    const doc = Bun.YAML.parse(text)
    if (file === "plugin.yml") pluginWorkflow = doc
  } catch (error) {
    parseErrors.push(`${file}: ${(error as Error).message}`)
  }
}

if (parseErrors.length) {
  console.error("Workflow files failed to parse:")
  for (const error of parseErrors) console.error(`  - ${error}`)
  process.exit(1)
}

if (!pluginWorkflow) {
  console.error(".github/workflows/plugin.yml is missing")
  process.exit(1)
}

const jobs = (pluginWorkflow as { jobs?: Record<string, { steps?: Array<{ run?: string }> }> }).jobs ?? {}
const steps = Object.values(jobs).flatMap((job) => job.steps ?? [])
const runLines = steps.map((step) => step.run).filter((run): run is string => Boolean(run))

const hasBuildStep = runLines.some((run) => /\bbun run build\b/.test(run))
const hasTestStep = runLines.some((run) => /\bbun test\b/.test(run))

if (!hasBuildStep || !hasTestStep) {
  console.error("plugin.yml must have a build step (bun run build) and a test step (bun test):")
  if (!hasBuildStep) console.error("  - missing a build step")
  if (!hasTestStep) console.error("  - missing a test step")
  process.exit(1)
}

console.log(`${files.length} workflow file(s) parsed; plugin.yml has build and test steps`)
