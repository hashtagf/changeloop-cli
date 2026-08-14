#!/usr/bin/env bun
// Asserts docs/sync/UPSTREAM.md declares the sections the sync policy
// requires: upstream remote URL, upstream/main -> dev branch layout, a merge
// cadence, and the branding-file allowlist.
import path from "path"

const docPath = path.join(import.meta.dir, "..", "docs", "sync", "UPSTREAM.md")
const text = await Bun.file(docPath).text()

const checks: Array<{ name: string; pattern: RegExp }> = [
  { name: "upstream remote URL", pattern: /https:\/\/github\.com\/[\w-]+\/opencode(\.git)?/ },
  { name: "upstream/main -> dev branch layout", pattern: /upstream\/main[\s\S]{0,80}dev/ },
  { name: "merge cadence heading", pattern: /^## Merge cadence$/m },
  { name: "branding-file allowlist heading", pattern: /^## Branding-file allowlist$/m },
]

const missing = checks.filter((check) => !check.pattern.test(text))

if (missing.length) {
  console.error(`docs/sync/UPSTREAM.md is missing required sections:`)
  for (const check of missing) console.error(`  - ${check.name}`)
  process.exit(1)
}

console.log("docs/sync/UPSTREAM.md: all required sections present")
