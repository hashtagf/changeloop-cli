import { describe, expect, test } from "bun:test"
import path from "path"

// The help snapshots pin the CLI's documented surface. This test pins its
// branding: the product presents as changeloop, and the word "opencode" may
// appear only as a functional literal that the rebrand deliberately keeps
// (docs/sync/UPSTREAM.md "Deferred renames").
const ALLOWED = [
  "opencode.local", // mDNS default domain — a network contract, not a display name
  "'opencode'", // default basic-auth username — a credential default, not a display name
]

describe("changeloop CLI brand surface", () => {
  test("help snapshots contain opencode only in allowlisted functional literals", async () => {
    const file = path.join(import.meta.dir, "cli", "help", "__snapshots__", "help-snapshots.test.ts.snap")
    let text = await Bun.file(file).text()
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain("changeloop")
    for (const literal of ALLOWED) {
      text = text.replaceAll(literal, "")
    }
    const stray = text.match(/.*opencode.*/gi) ?? []
    expect(stray).toEqual([])
  })
})
