import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, LayerMap, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Command } from "@opencode/core/command"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Database } from "../../src/database/database"
import { Bus } from "../../src/bus"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const id = Plugin.ID.make("opencode.foundation")
const names = ["investigate", "change", "build", "prove", "land", "changes", "feature", "dev"]

const source: { operations: ConfigPluginSource.Operation[] } = { operations: [] }
const sourceLayer = Layer.succeed(
  ConfigPluginSource.Service,
  ConfigPluginSource.Service.of({
    operations: () => Effect.sync(() => source.operations),
    changes: () => Stream.never,
  }),
)

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make(
      (ref: Location.Ref) => Instance.layer(ref, { discovery: false, replacements: bindings }),
      { idleTimeToLive: Duration.infinity },
    )
    const bindings: LayerNode.Replacements = [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      ConfigPluginSource.node.replace(sourceLayer),
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
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    LocationServiceMap.node.replace(instances),
  ]),
)

const boot = Effect.fn("foundationBuiltin.boot")(function* (operations: ConfigPluginSource.Operation[]) {
  source.operations = operations
  const directory = yield* tmpdirScoped()
  const locations = yield* LocationServiceMap.Service
  return yield* Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.awaitActivation
    const commands = yield* Command.Service
    return {
      inventory: yield* plugins.list(),
      commands: yield* Effect.forEach(names, (name) => commands.get(name)),
    }
  }).pipe(
    Effect.scoped,
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
  )
})

describe("Foundation builtin plugin", () => {
  it.live("registers the eight workflow commands as an active builtin", () =>
    Effect.gen(function* () {
      const state = yield* boot([])

      expect(state.inventory.find((plugin) => plugin.id === id)).toEqual({
        id,
        source: { type: "builtin" },
        state: { status: "active" },
        features: { server: true },
      })
      expect(state.commands.every((command) => command !== undefined)).toBe(true)
      for (const command of state.commands) expect(command?.description?.trim()).toBeTruthy()
    }),
  )

  it.live("activates before the config command plugin so user commands can replace it", () =>
    Effect.gen(function* () {
      const order = (yield* boot([])).inventory.map((plugin) => plugin.id as string)

      expect(order.indexOf(id)).toBeGreaterThanOrEqual(0)
      expect(order.indexOf(id)).toBeLessThan(order.indexOf("opencode.config.command"))
    }),
  )

  it.live("a remove operation for the plugin ID turns the workflow off", () =>
    Effect.gen(function* () {
      const state = yield* boot([{ type: "remove", target: id }])

      expect(state.inventory.some((plugin) => plugin.id === id)).toBe(false)
      expect(state.commands.every((command) => command === undefined)).toBe(true)
    }),
  )
})
