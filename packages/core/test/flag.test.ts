import { afterEach, describe, expect, test } from "bun:test"
import { Flag, truthy } from "@opencode-ai/core/flag/flag"

const managedKeys = [
  "CHANGELOOP_TEST_FLAG",
  "OPENCODE_TEST_FLAG",
  "CHANGELOOP_CLIENT",
  "OPENCODE_CLIENT",
  "CHANGELOOP_CONFIG_DIR",
  "OPENCODE_CONFIG_DIR",
  "CHANGELOOP_PERMISSION",
  "OPENCODE_PERMISSION",
]

afterEach(() => {
  for (const key of managedKeys) delete process.env[key]
})

describe("truthy env var aliasing", () => {
  test("CHANGELOOP_* wins when both variants are set", () => {
    process.env["CHANGELOOP_TEST_FLAG"] = "true"
    process.env["OPENCODE_TEST_FLAG"] = "false"
    expect(truthy("OPENCODE_TEST_FLAG")).toBe(true)
  })

  test("falls back to OPENCODE_* when only it is set", () => {
    process.env["OPENCODE_TEST_FLAG"] = "true"
    expect(truthy("OPENCODE_TEST_FLAG")).toBe(true)
  })

  test("is false when neither variant is set", () => {
    expect(truthy("OPENCODE_TEST_FLAG")).toBe(false)
  })
})

describe("Flag getters honor the same aliasing", () => {
  test("OPENCODE_CLIENT prefers CHANGELOOP_CLIENT", () => {
    process.env["CHANGELOOP_CLIENT"] = "changeloop-tui"
    process.env["OPENCODE_CLIENT"] = "opencode-tui"
    expect(Flag.OPENCODE_CLIENT).toBe("changeloop-tui")
  })

  test("OPENCODE_CLIENT falls back to OPENCODE_CLIENT when CHANGELOOP_CLIENT is unset", () => {
    process.env["OPENCODE_CLIENT"] = "opencode-tui"
    expect(Flag.OPENCODE_CLIENT).toBe("opencode-tui")
  })

  test("OPENCODE_CONFIG_DIR prefers CHANGELOOP_CONFIG_DIR", () => {
    process.env["CHANGELOOP_CONFIG_DIR"] = "/changeloop-config"
    process.env["OPENCODE_CONFIG_DIR"] = "/opencode-config"
    expect(Flag.OPENCODE_CONFIG_DIR).toBe("/changeloop-config")
  })

  test("OPENCODE_PERMISSION falls back to OPENCODE_PERMISSION when unaliased", () => {
    process.env["OPENCODE_PERMISSION"] = "ask"
    expect(Flag.OPENCODE_PERMISSION).toBe("ask")
  })
})
