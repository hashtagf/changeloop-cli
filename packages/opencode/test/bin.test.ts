import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

const packageJson = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "package.json"), "utf8"))
const launcherSource = fs.readFileSync(path.join(import.meta.dir, "..", "bin", "opencode"), "utf8")

describe("bin entries", () => {
  test("changeloop is published alongside the kept opencode bin, pointing at the same launcher", () => {
    expect(packageJson.bin.opencode).toBe("./bin/opencode")
    expect(packageJson.bin.changeloop).toBe(packageJson.bin.opencode)
  })

  test("the package name stays opencode", () => {
    expect(packageJson.name).toBe("opencode")
  })
})

describe("changeloop entrypoint", () => {
  let dir: string
  let stub: string
  let launcher: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "changeloop-bin-"))
    stub = path.join(dir, "stub-binary.js")
    fs.writeFileSync(
      stub,
      `#!/usr/bin/env node\nif (process.argv.includes("--version")) { console.log("stub-ok"); process.exit(0); }\nprocess.exit(1);\n`,
      { mode: 0o755 },
    )
    // Copying the launcher under the changeloop name exercises the same
    // resolution logic real users hit through the package.json bin alias;
    // the launcher never reads its own invoked name, so this proves the
    // alias behaves identically to the opencode entry.
    launcher = path.join(dir, "changeloop")
    fs.writeFileSync(launcher, launcherSource, { mode: 0o755 })
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("runs --version exit 0 under the changeloop bin name", () => {
    const result = spawnSync(process.execPath, [launcher, "--version"], {
      env: { ...process.env, OPENCODE_BIN_PATH: stub },
      encoding: "utf8",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("stub-ok")
  })
})
