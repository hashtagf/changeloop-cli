import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "changeloop"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })
})

describe("resolveAppPath legacy fallback", () => {
  const base = "/xdg-base"

  test("prefers the changeloop path when it exists", () => {
    const exists = (candidate: string) => candidate === path.join(base, "changeloop")
    expect(Global.resolveAppPath(base, exists)).toBe(path.join(base, "changeloop"))
  })

  test("falls back to the legacy opencode path when only it exists", () => {
    const exists = (candidate: string) => candidate === path.join(base, "opencode")
    expect(Global.resolveAppPath(base, exists)).toBe(path.join(base, "opencode"))
  })

  test("prefers the changeloop path when both exist", () => {
    expect(Global.resolveAppPath(base, () => true)).toBe(path.join(base, "changeloop"))
  })

  test("defaults to the changeloop path when neither exists", () => {
    expect(Global.resolveAppPath(base, () => false)).toBe(path.join(base, "changeloop"))
  })
})
