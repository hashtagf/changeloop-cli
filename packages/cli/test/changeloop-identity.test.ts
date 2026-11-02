import { describe, expect, test } from "bun:test"
import path from "node:path"

const script = await Bun.file(path.join(import.meta.dir, "../script/build.ts")).text()

describe("changeloop build identity", () => {
  test("names the compiled executable changeloop", () => {
    expect(script).toMatch(/^const binary = "changeloop"$/m)
    expect(script).not.toMatch(/^const binary = "opencode"$/m)
  })

  test("embeds changeloop as the CLI name shown in help and usage", () => {
    expect(script).toContain(`OPENCODE_CLI_NAME: "'changeloop'"`)
    expect(script).not.toContain(`OPENCODE_CLI_NAME: "'opencode'"`)
  })
})
