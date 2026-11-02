import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer } from "effect"
import { Global } from "../src/global.js"

describe("global", () => {
  test("importing the module does not create directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-import-"))
    const directories = ["data", "cache", "config", "state", "tmp"].map((directory) => path.join(root, directory))
    const module = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", `const { Global } = await import(${JSON.stringify(module)}); void Global.Path.tmp`],
      env: {
        ...process.env,
        XDG_DATA_HOME: directories[0],
        XDG_CACHE_HOME: directories[1],
        XDG_CONFIG_HOME: directories[2],
        XDG_STATE_HOME: directories[3],
        // os.tmpdir() reads TMPDIR on POSIX and TEMP on Windows.
        TMPDIR: directories[4],
        TEMP: directories[4],
      },
      stderr: "pipe",
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    directories.forEach((directory) => expect(fs.existsSync(path.join(directory, "opencode"))).toBe(false))
    directories.forEach((directory) => expect(fs.existsSync(path.join(directory, "changeloop"))).toBe(false))
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("building layerWith creates service directories and preserves an explicit tmp", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-layer-"))
    const directories = {
      data: path.join(root, "data"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      log: path.join(root, "log"),
      bin: path.join(root, "bin"),
      repos: path.join(root, "repos"),
      tmp: path.join(root, "nested", "..", "tmp"),
    }

    const context = await Effect.runPromise(Effect.scoped(Layer.build(Global.layerWith(directories))))

    Object.values(directories).forEach((directory) => expect(fs.statSync(directory).isDirectory()).toBe(true))
    expect(Context.get(context, Global.Service).tmp).toBe(directories.tmp)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("building a layer with default tmp creates and canonicalizes it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-layer-"))
    const directories = ["data", "cache", "config", "state", "tmp"].map((directory) => path.join(root, directory))
    const module = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `
          import { Context, Effect, Layer } from "effect"
          const { Global } = await import(${JSON.stringify(module)})
          const context = await Effect.runPromise(Effect.scoped(Layer.build(Global.layerWith({}))))
          process.stdout.write(Context.get(context, Global.Service).tmp)
        `,
      ],
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...process.env,
        XDG_DATA_HOME: directories[0],
        XDG_CACHE_HOME: directories[1],
        XDG_CONFIG_HOME: directories[2],
        XDG_STATE_HOME: directories[3],
        // os.tmpdir() reads TMPDIR on POSIX and TEMP on Windows.
        TMPDIR: directories[4],
        TEMP: directories[4],
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    // The layer canonicalizes through the native realpath, which on Windows also expands 8.3 short
    // names such as RUNNER~1 that the JavaScript realpathSync leaves in place.
    expect(result.stdout.toString()).toBe(fs.realpathSync.native(path.join(directories[4], "changeloop")))
    const created = [
      path.join(directories[0], "changeloop"),
      path.join(directories[1], "changeloop", "bin"),
      path.join(directories[2], "changeloop"),
      path.join(directories[3], "changeloop"),
      path.join(directories[0], "changeloop", "log"),
      path.join(directories[0], "changeloop", "repos"),
      path.join(directories[4], "changeloop"),
    ]
    created.forEach((directory) => expect(fs.statSync(directory).isDirectory()).toBe(true))
    // A fresh install must not create the legacy directories.
    ;[directories[0], directories[1], directories[2], directories[3]].forEach((directory) =>
      expect(fs.existsSync(path.join(directory, "opencode"))).toBe(false),
    )
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe("global app path fallback", () => {
  const module = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href

  // Resolves Global.Path in a fresh process so module-load path selection runs for real.
  function resolve(xdg: Record<"data" | "cache" | "config" | "state", string>, env: Record<string, string> = {}) {
    const inherited = { ...process.env }
    delete inherited.CHANGELOOP_TEST_HOME
    delete inherited.OPENCODE_TEST_HOME
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `const { Global } = await import(${JSON.stringify(module)}); process.stdout.write(JSON.stringify(Global.Path))`,
      ],
      env: {
        ...inherited,
        XDG_DATA_HOME: xdg.data,
        XDG_CACHE_HOME: xdg.cache,
        XDG_CONFIG_HOME: xdg.config,
        XDG_STATE_HOME: xdg.state,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    return JSON.parse(result.stdout.toString()) as Record<string, string>
  }

  function bases() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "changeloop-global-fallback-"))
    const xdg = {
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
    }
    Object.values(xdg).forEach((directory) => fs.mkdirSync(directory, { recursive: true }))
    return { root, xdg }
  }

  test("a fresh install resolves every base to changeloop", () => {
    const { root, xdg } = bases()
    const paths = resolve(xdg)
    expect(paths.data).toBe(path.join(xdg.data, "changeloop"))
    expect(paths.config).toBe(path.join(xdg.config, "changeloop"))
    expect(paths.cache).toBe(path.join(xdg.cache, "changeloop"))
    expect(paths.state).toBe(path.join(xdg.state, "changeloop"))
    expect(paths.bin).toBe(path.join(xdg.cache, "changeloop", "bin"))
    expect(paths.log).toBe(path.join(xdg.data, "changeloop", "log"))
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("an existing opencode install keeps its directories untouched", () => {
    const { root, xdg } = bases()
    const session = path.join(xdg.data, "opencode", "opencode.db")
    fs.mkdirSync(path.dirname(session), { recursive: true })
    fs.writeFileSync(session, "sessions")
    ;(["config", "cache", "state"] as const).forEach((key) => fs.mkdirSync(path.join(xdg[key], "opencode")))

    const paths = resolve(xdg)

    expect(paths.data).toBe(path.join(xdg.data, "opencode"))
    expect(paths.config).toBe(path.join(xdg.config, "opencode"))
    expect(paths.cache).toBe(path.join(xdg.cache, "opencode"))
    expect(paths.state).toBe(path.join(xdg.state, "opencode"))
    expect(fs.readFileSync(session, "utf8")).toBe("sessions")
    expect(fs.existsSync(path.join(xdg.data, "changeloop"))).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("changeloop wins when both exist", () => {
    const { root, xdg } = bases()
    fs.mkdirSync(path.join(xdg.config, "opencode"))
    fs.mkdirSync(path.join(xdg.config, "changeloop"))
    expect(resolve(xdg).config).toBe(path.join(xdg.config, "changeloop"))
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("each base is decided independently", () => {
    const { root, xdg } = bases()
    fs.mkdirSync(path.join(xdg.config, "opencode"))
    fs.mkdirSync(path.join(xdg.data, "changeloop"))
    const paths = resolve(xdg)
    expect(paths.config).toBe(path.join(xdg.config, "opencode"))
    expect(paths.data).toBe(path.join(xdg.data, "changeloop"))
    expect(paths.cache).toBe(path.join(xdg.cache, "changeloop"))
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("CHANGELOOP_TEST_HOME wins over OPENCODE_TEST_HOME", () => {
    const { root, xdg } = bases()
    expect(resolve(xdg, { CHANGELOOP_TEST_HOME: "/tmp/cl-home", OPENCODE_TEST_HOME: "/tmp/oc-home" }).home).toBe(
      "/tmp/cl-home",
    )
    expect(resolve(xdg, { OPENCODE_TEST_HOME: "/tmp/oc-home" }).home).toBe("/tmp/oc-home")
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("resolveAppPath prefers changeloop, then opencode, then changeloop", async () => {
    const { resolveAppPath } = await import("../src/global.js")
    expect(resolveAppPath("/c", "/o", () => true)).toBe("/c")
    expect(resolveAppPath("/c", "/o", (candidate) => candidate === "/o")).toBe("/o")
    expect(resolveAppPath("/c", "/o", () => false)).toBe("/c")
  })
})
