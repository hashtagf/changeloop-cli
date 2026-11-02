import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

describe("debug paths command", () => {
  test("is included in troubleshooting help", async () => {
    const [debug, paths] = await Promise.all([cli(["debug", "--help"]), cli(["debug", "paths", "--help"])])

    expect(debug.exitCode).toBe(0)
    expect(debug.stdout).toContain("paths")
    expect(debug.stdout).toContain("Show global paths (data, config, cache, state)")
    expect(paths.exitCode).toBe(0)
    expect(paths.stdout).toContain("opencode debug paths [flags]")
  })

  test("prints resolved global paths without starting a server", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-debug-paths-"))

    try {
      const result = await cli(["debug", "paths"], {
        XDG_DATA_HOME: path.join(root, "data"),
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_CACHE_HOME: path.join(root, "cache"),
        XDG_STATE_HOME: path.join(root, "state"),
      })
      const paths = Object.fromEntries(
        result.stdout
          .trim()
          .split("\n")
          .map((line) => line.trim().split(/\s+/, 2)),
      )

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
      expect(paths).toMatchObject({
        home: os.homedir(),
        data: path.join(root, "data", "changeloop"),
        config: path.join(root, "config", "changeloop"),
        cache: path.join(root, "cache", "changeloop"),
        state: path.join(root, "state", "changeloop"),
        bin: path.join(root, "cache", "changeloop", "bin"),
        log: path.join(root, "data", "changeloop", "log"),
        repos: path.join(root, "data", "changeloop", "repos"),
      })
      expect(paths.tmp).toBeTruthy()
      expect(await Bun.file(path.join(root, "state", "changeloop", "service-local.json")).exists()).toBe(false)
      // A fresh install must not create legacy directories.
      expect(await fs.stat(path.join(root, "data", "opencode")).catch(() => undefined)).toBeUndefined()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("keeps using existing opencode directories without touching them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "changeloop-debug-paths-legacy-"))

    try {
      const xdg = xdgFor(root)
      const session = path.join(root, "data", "opencode", "sessions.marker")
      await fs.mkdir(path.dirname(session), { recursive: true })
      await Bun.write(session, "keep")
      await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
      const paths = parse((await cli(["debug", "paths"], xdg)).stdout)

      expect(paths).toMatchObject({
        data: path.join(root, "data", "opencode"),
        config: path.join(root, "config", "opencode"),
        // No legacy directory in these bases, so they resolve to changeloop.
        cache: path.join(root, "cache", "changeloop"),
        state: path.join(root, "state", "changeloop"),
      })
      expect(await Bun.file(session).text()).toBe("keep")
      expect(await fs.stat(path.join(root, "data", "changeloop")).catch(() => undefined)).toBeUndefined()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("prefers changeloop directories when both exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "changeloop-debug-paths-both-"))

    try {
      await fs.mkdir(path.join(root, "data", "opencode"), { recursive: true })
      await fs.mkdir(path.join(root, "data", "changeloop"), { recursive: true })
      const paths = parse((await cli(["debug", "paths"], xdgFor(root))).stdout)
      expect(paths.data).toBe(path.join(root, "data", "changeloop"))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("CHANGELOOP_ variables alias OPENCODE_ ones and win when both are set", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "changeloop-debug-paths-env-"))

    try {
      const both = await cli(["debug", "paths", "config"], {
        ...xdgFor(root),
        CHANGELOOP_CONFIG_DIR: path.join(root, "from-changeloop"),
        OPENCODE_CONFIG_DIR: path.join(root, "from-opencode"),
      })
      expect(both.stdout.trim()).toBe(path.join(root, "from-changeloop"))
      const legacy = await cli(["debug", "paths", "config"], {
        ...xdgFor(root),
        OPENCODE_CONFIG_DIR: path.join(root, "from-opencode"),
      })
      expect(legacy.stdout.trim()).toBe(path.join(root, "from-opencode"))
      const home = await cli(["debug", "paths", "home"], {
        ...xdgFor(root),
        CHANGELOOP_TEST_HOME: path.join(root, "home"),
        OPENCODE_TEST_HOME: path.join(root, "other"),
      })
      expect(home.stdout.trim()).toBe(path.join(root, "home"))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

function xdgFor(root: string) {
  return {
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
}

function parse(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/, 2)),
  )
}

async function cli(args: string[], env?: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
