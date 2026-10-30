import { afterAll, describe, expect } from "bun:test"
import { Duration, Effect, Layer, LayerMap, Schedule } from "effect"
import fs from "fs/promises"
import { mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Command } from "@opencode/core/command"
import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Database } from "../../src/database/database"
import { Bus } from "../../src/bus"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const id = Plugin.ID.make("opencode.foundation")
const names = ["investigate", "change", "build", "prove", "land", "changes", "feature", "dev"]

// One global directory for the file, so each boot can state the global config explicitly.
const root = mkdtempSync(path.join(os.tmpdir(), "foundation-config-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const globalConfig = path.join(root, "config")
const globalLayer = Global.layerWith({
  home: path.join(root, "home"),
  data: path.join(root, "data"),
  cache: path.join(root, "cache"),
  config: globalConfig,
  state: path.join(root, "state"),
  tmp: path.join(root, "tmp"),
  bin: path.join(root, "cache", "bin"),
  log: path.join(root, "data", "log"),
  repos: path.join(root, "data", "repos"),
})

// Real Config and ConfigPluginSource: the v1 keys are read from opencode.json files on disk.
const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make((ref: Location.Ref) => Instance.layer(ref, { replacements: bindings }), {
      idleTimeToLive: Duration.infinity,
    })
    const bindings: LayerNode.Replacements = [
      Global.node.replace(globalLayer),
      offlineModels,
      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      Instance.node.replace(
        Layer.succeed(Instance.Service, {
          provide: (session) => Effect.provide(map.get(session.location)),
        }),
      ),
    ]
    return map
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    Global.node.replace(globalLayer),
    offlineModels,
    LocationServiceMap.node.replace(instances),
  ]),
)

const boot = Effect.fn("foundationConfig.boot")(function* (input: { project?: unknown; global?: unknown }) {
  const directory = yield* tmpdirScoped()
  const write = (file: string, value: unknown) =>
    Effect.promise(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      if (value === undefined) return fs.rm(file, { force: true })
      await fs.writeFile(file, JSON.stringify(value))
    })
  // The global directory is shared by every test, so each boot states it explicitly.
  yield* write(path.join(globalConfig, "opencode.json"), input.global)
  yield* write(path.join(directory.path, "opencode.json"), input.project)
  const locations = yield* LocationServiceMap.Service
  return yield* Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.awaitActivation
    const commands = yield* Command.Service
    const hooks = yield* PluginHooks.Service
    const env = { PATH: "/usr/bin" }
    yield* hooks.trigger("shell", "create.before", { command: "true", cwd: ".", timeout: 1_000, shell: "sh", env })
    return {
      inventory: yield* plugins.list(),
      registered: (yield* Effect.forEach(names, (name) => commands.get(name))).filter((command) => command !== undefined),
      path: env.PATH,
      custom: yield* commands.get("mine"),
    }
  }).pipe(
    Effect.scoped,
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
  )
})

// Sets foundation_runtime in the project file, then changes it while the instance runs.
const changeRuntime = Effect.fn("foundationConfig.changeRuntime")(function* () {
  const directory = yield* tmpdirScoped()
  const file = path.join(directory.path, "opencode.json")
  yield* Effect.promise(() => fs.rm(path.join(globalConfig, "opencode.json"), { force: true }))
  yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ foundation_runtime: "path" })))
  const locations = yield* LocationServiceMap.Service
  return yield* Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const hooks = yield* PluginHooks.Service
    yield* plugins.awaitActivation
    const shellPath = Effect.gen(function* () {
      const env = { PATH: "/usr/bin" }
      yield* hooks.trigger("shell", "create.before", { command: "true", cwd: ".", timeout: 1_000, shell: "sh", env })
      return env.PATH
    })
    const before = yield* shellPath
    yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ foundation_runtime: "bundled" })))
    const after = yield* shellPath.pipe(
      Effect.repeat({ until: (value) => value !== "/usr/bin", schedule: Schedule.spaced("100 millis") }),
      Effect.timeout("10 seconds"),
    )
    return { before, after }
  }).pipe(
    Effect.scoped,
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
  )
})

describe("Foundation v1 config keys on a real instance", () => {
  it.live("changing foundation_runtime while the instance runs reactivates the plugin with the new runtime", () =>
    Effect.gen(function* () {
      const state = yield* changeRuntime()

      expect(state.before).toBe("/usr/bin")
      expect(state.after).not.toBe("/usr/bin")
    }),
  )

  it.live("a config without the keys registers the eight commands and adds the bundle to PATH", () =>
    Effect.gen(function* () {
      const state = yield* boot({ project: { username: "someone" } })

      expect(state.inventory.find((plugin) => plugin.id === id)?.state).toEqual({ status: "active" })
      expect(state.registered).toHaveLength(names.length)
      expect(state.path).not.toBe("/usr/bin")
      expect(state.path.endsWith(`${path.delimiter}/usr/bin`)).toBe(true)
    }),
  )

  it.live("foundation_workflow false in the project registers no command and leaves PATH alone", () =>
    Effect.gen(function* () {
      const state = yield* boot({ project: { foundation_workflow: false } })

      expect(state.inventory.some((plugin) => plugin.id === id)).toBe(false)
      expect(state.registered).toEqual([])
      expect(state.path).toBe("/usr/bin")
    }),
  )

  it.live("foundation_workflow false in the global config registers no command", () =>
    Effect.gen(function* () {
      const state = yield* boot({ global: { foundation_workflow: false } })

      expect(state.inventory.some((plugin) => plugin.id === id)).toBe(false)
      expect(state.registered).toEqual([])
    }),
  )

  it.live("a project that sets foundation_workflow true overrides a global false", () =>
    Effect.gen(function* () {
      const state = yield* boot({ global: { foundation_workflow: false }, project: { foundation_workflow: true } })

      expect(state.registered).toHaveLength(names.length)
    }),
  )

  it.live("foundation_runtime path registers the commands without adding the bundle to PATH", () =>
    Effect.gen(function* () {
      const state = yield* boot({ project: { foundation_runtime: "path" } })

      expect(state.inventory.find((plugin) => plugin.id === id)?.state).toEqual({ status: "active" })
      expect(state.registered).toHaveLength(names.length)
      expect(state.path).toBe("/usr/bin")
    }),
  )

  it.live("foundation_runtime bundled adds the bundle to PATH", () =>
    Effect.gen(function* () {
      const state = yield* boot({ global: { foundation_runtime: "bundled" } })

      expect(state.path).not.toBe("/usr/bin")
    }),
  )

  it.live("invalid values load the rest of the config and keep the defaults", () =>
    Effect.gen(function* () {
      const state = yield* boot({
        project: { foundation_workflow: "no", foundation_runtime: "system", commands: { mine: { template: "x" } } },
      })

      expect(state.custom?.name).toBe("mine")
      expect(state.registered).toHaveLength(names.length)
      expect(state.path).not.toBe("/usr/bin")
    }),
  )
})
