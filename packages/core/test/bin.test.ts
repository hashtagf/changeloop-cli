import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

const packageJson = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "package.json"), "utf8"))

describe("bin entries", () => {
  test("changeloop is published alongside the kept opencode bin, pointing at the same launcher", () => {
    expect(packageJson.bin.opencode).toBe("./bin/opencode")
    expect(packageJson.bin.changeloop).toBe(packageJson.bin.opencode)
  })

  // bin/opencode is generated at publish time, so only the map is asserted here.
})
