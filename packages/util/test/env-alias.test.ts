import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { EnvAlias } from "../src/env-alias.js"

const module = pathToFileURL(path.join(import.meta.dir, "../src/env-alias.ts")).href

describe("env alias", () => {
  test("CHANGELOOP_ wins over OPENCODE_ when both are set", () => {
    const env: NodeJS.ProcessEnv = { CHANGELOOP_CONFIG_DIR: "/cl", OPENCODE_CONFIG_DIR: "/oc" }
    EnvAlias.apply(env)
    expect(env.OPENCODE_CONFIG_DIR).toBe("/cl")
    expect(env.CHANGELOOP_CONFIG_DIR).toBe("/cl")
  })

  test("OPENCODE_ stays when no CHANGELOOP_ twin exists", () => {
    const env: NodeJS.ProcessEnv = { OPENCODE_CONFIG_DIR: "/oc" }
    EnvAlias.apply(env)
    expect(env.OPENCODE_CONFIG_DIR).toBe("/oc")
  })

  test("creates the OPENCODE_ twin and leaves unrelated variables alone", () => {
    const env: NodeJS.ProcessEnv = { CHANGELOOP_SERVER_USERNAME: "me", HOME: "/h", CHANGELOOP_: "bare", NOT_CHANGELOOP_X: "1" }
    EnvAlias.apply(env)
    expect(env).toEqual({
      CHANGELOOP_SERVER_USERNAME: "me",
      OPENCODE_SERVER_USERNAME: "me",
      HOME: "/h",
      CHANGELOOP_: "bare",
      NOT_CHANGELOOP_X: "1",
    })
  })

  test("importing the module aliases the real process environment", () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `await import(${JSON.stringify(module)}); process.stdout.write(String(process.env.OPENCODE_CONFIG_DIR))`,
      ],
      env: { ...process.env, CHANGELOOP_CONFIG_DIR: "/from-changeloop", OPENCODE_CONFIG_DIR: "/from-opencode" },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stdout.toString()).toBe("/from-changeloop")
  })
})
