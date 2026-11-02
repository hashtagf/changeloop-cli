import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Global } from "@opencode/util/global"

describe("Core test environment", () => {
  test("disables public npm security audits", () => {
    expect(process.env.NPM_CONFIG_AUDIT).toBe("false")
  })

  test("isolates global home and XDG roots", () => {
    const home = process.env.OPENCODE_TEST_HOME
    expect(home).toBeDefined()
    if (!home) return

    expect(os.homedir()).toBe(home)
    expect(Global.Path.home).toBe(home)
    // The isolated home is a fresh install, so every root resolves to changeloop; the wrapper still pins the
    // config directory through OPENCODE_CONFIG_DIR.
    expect(Global.Path.config).toBe(path.join(home, ".config", "changeloop"))
    expect(Global.Path.data).toBe(path.join(home, ".local", "share", "changeloop"))
    expect(Global.Path.cache).toBe(path.join(home, ".cache", "changeloop"))
    expect(Global.Path.state).toBe(path.join(home, ".local", "state", "changeloop"))
    expect(os.tmpdir()).toBe(path.join(home, "tmp"))
    expect(process.env.OPENCODE_CONFIG_DIR).toBe(path.join(home, ".config", "opencode"))
    expect(process.env.OPENCODE_CONFIG).toBeUndefined()
    expect(process.env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(process.env.AWS_REGION).toBeUndefined()
    expect(process.env.GOOGLE_VERTEX_PROJECT).toBeUndefined()
    expect(process.env.NPM_CONFIG_REGISTRY).toBeUndefined()
    expect(process.env.UIDOTSH_AUTHORIZATION).toBeUndefined()
    if (process.env.RECORD !== "true") expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })
})
