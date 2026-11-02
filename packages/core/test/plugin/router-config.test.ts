import { afterAll, describe, expect } from "bun:test"
import { Duration, Effect, Layer, LayerMap } from "effect"
import fs from "fs/promises"
import { mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Agent } from "@opencode/core/agent"
import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Database } from "../../src/database/database"
import { Bus } from "../../src/bus"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const id = Plugin.ID.make("opencode.router")

const root = mkdtempSync(path.join(os.tmpdir(), "router-config-"))
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

// A provider defined in the project config is available without a credential.
const provider = (models: string[]) => ({
  package: "@opencode/ai/providers/openai/chat",
  models: Object.fromEntries(models.map((name) => [name, {}])),
})

const boot = Effect.fn("routerConfig.boot")(function* (project: unknown) {
  const directory = yield* tmpdirScoped()
  yield* Effect.promise(async () => {
    await fs.mkdir(globalConfig, { recursive: true })
    await fs.rm(path.join(globalConfig, "opencode.json"), { force: true })
    await fs.writeFile(path.join(directory.path, "opencode.json"), JSON.stringify(project))
  })
  const locations = yield* LocationServiceMap.Service
  return yield* Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.awaitActivation
    const agents = yield* Agent.Service
    const model = (name: string) => agents.get(Agent.ID.make(name)).pipe(Effect.map((agent) => agent?.model))
    return {
      inventory: yield* plugins.list(),
      build: yield* model("build"),
      plan: yield* model("plan"),
      explore: yield* model("explore"),
      title: yield* model("title"),
      agents: (yield* agents.list()).map((agent) => agent.id as string),
    }
  }).pipe(
    Effect.scoped,
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
  )
})

const ref = (providerID: string, modelID: string) => ({ providerID, id: modelID })

describe("model router on a real instance", () => {
  it.live("pins a mapped agent and the title agent to the first candidate with an available provider", () =>
    Effect.gen(function* () {
      const state = yield* boot({
        providers: { mock: provider(["strong", "small"]) },
        router: {
          tiers: { deep: ["absent/model", "mock/strong"], fast: ["mock/small"] },
          agents: { build: "deep", explore: "fast" },
          small_model: "fast",
        },
      })

      expect(state.inventory.find((plugin) => plugin.id === id)?.state).toEqual({ status: "active" })
      expect(state.build).toMatchObject(ref("mock", "strong"))
      expect(state.explore).toMatchObject(ref("mock", "small"))
      expect(state.title).toMatchObject(ref("mock", "small"))
      expect(state.plan).toBeUndefined()
    }),
  )

  it.live("leaves an agent without a model when no candidate has an available provider", () =>
    Effect.gen(function* () {
      const state = yield* boot({
        providers: { mock: provider(["strong"]) },
        router: { tiers: { deep: ["absent/model", "mock/missing-model"] }, agents: { build: "deep" }, small_model: "deep" },
      })

      expect(state.inventory.find((plugin) => plugin.id === id)?.state).toEqual({ status: "active" })
      expect(state.build).toBeUndefined()
      expect(state.title).toBeUndefined()
    }),
  )

  it.live("keeps the model the user pinned on an agent", () =>
    Effect.gen(function* () {
      const state = yield* boot({
        providers: { mock: provider(["strong", "mine"]) },
        agents: { build: { model: { providerID: "mock", model: "mine" } } },
        router: { tiers: { deep: ["mock/strong"] }, agents: { build: "deep", explore: "deep" } },
      })

      expect(state.build).toMatchObject(ref("mock", "mine"))
      expect(state.explore).toMatchObject(ref("mock", "strong"))
    }),
  )

  it.live("keeps a small_model the user set in the v1 form", () =>
    Effect.gen(function* () {
      const state = yield* boot({
        providers: { mock: provider(["strong", "mine"]) },
        small_model: "mock/mine",
        router: { tiers: { deep: ["mock/strong"] }, small_model: "deep" },
      })

      expect(state.title).toMatchObject(ref("mock", "mine"))
    }),
  )

  it.live("does not create an agent the table names but the instance lacks", () =>
    Effect.gen(function* () {
      const state = yield* boot({
        providers: { mock: provider(["strong"]) },
        router: { tiers: { deep: ["mock/strong"] }, agents: { ghost: "deep", build: "deep" } },
      })

      expect(state.agents).not.toContain("ghost")
      expect(state.build).toMatchObject(ref("mock", "strong"))
    }),
  )

  it.live("changes nothing without a router", () =>
    Effect.gen(function* () {
      const state = yield* boot({ providers: { mock: provider(["strong"]) } })

      expect(state.inventory.find((plugin) => plugin.id === id)?.state).toEqual({ status: "active" })
      expect(state.build).toBeUndefined()
      expect(state.explore).toBeUndefined()
      expect(state.title).toBeUndefined()
    }),
  )

  it.live("boots and applies the valid entries when the table has malformed ones", () =>
    Effect.gen(function* () {
      const state = yield* boot({
        username: "someone",
        providers: { mock: provider(["strong"]) },
        router: { tiers: { deep: ["mock/strong"], broken: "mock/strong" }, agents: { build: "deep", explore: 3 } },
      })

      expect(state.build).toMatchObject(ref("mock", "strong"))
      expect(state.explore).toBeUndefined()
    }),
  )

  it.live("a plugins entry that removes the builtin turns routing off", () =>
    Effect.gen(function* () {
      const state = yield* boot({
        providers: { mock: provider(["strong"]) },
        plugins: ["-opencode.router"],
        router: { tiers: { deep: ["mock/strong"] }, agents: { build: "deep" } },
      })

      expect(state.inventory.some((plugin) => plugin.id === id)).toBe(false)
      expect(state.build).toBeUndefined()
    }),
  )
})
