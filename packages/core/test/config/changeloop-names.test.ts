import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Config } from "@opencode/core/config"
import { Bus } from "@opencode/core/bus"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Credential } from "@opencode/core/credential"
import { WellKnown } from "@opencode/core/wellknown"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { tempGlobalLayer } from "../fixture/global"
import { location } from "../fixture/location"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

// Real Config on real files: only the filesystem watcher is a test double.
function configLayer(directory: string, globalDirectory: string, root = directory) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(root) }),
    ),
  )
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ system: false })),
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: globalDirectory, home: path.join(globalDirectory, "home") })),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
  return Layer.mergeAll(built, Watcher.testLayer)
}

const write = (file: string, value: unknown) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value))
  })

/** Resolves the effective `shell` the way every consumer does: the last loaded layer wins. */
const shell = Effect.gen(function* () {
  const config = yield* Config.Service
  return Config.latest(yield* config.entries(), "shell")
})

const plain = testEffect(Layer.empty)

describe("Changeloop config file names", () => {
  plain.live("global changeloop.json wins over opencode.json", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* write(path.join(global, "opencode.json"), { shell: "opencode" })
      yield* write(path.join(global, "changeloop.json"), { shell: "changeloop" })
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
      expect(yield* shell.pipe(Effect.provide(configLayer(project, global)))).toBe("changeloop")
    }),
  )

  plain.live("within one directory the order is opencode.json, opencode.jsonc, changeloop.json, changeloop.jsonc", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
      const names = ["opencode.json", "opencode.jsonc", "changeloop.json", "changeloop.jsonc"]
      for (const name of names) {
        yield* write(path.join(global, name), { shell: name })
        expect(yield* shell.pipe(Effect.provide(configLayer(project, global)))).toBe(name)
      }
      // Removing the winner falls back to the next one down.
      yield* Effect.promise(() => fs.rm(path.join(global, "changeloop.jsonc")))
      expect(yield* shell.pipe(Effect.provide(configLayer(project, global)))).toBe("changeloop.json")
      yield* Effect.promise(() => fs.rm(path.join(global, "changeloop.json")))
      expect(yield* shell.pipe(Effect.provide(configLayer(project, global)))).toBe("opencode.jsonc")
    }),
  )

  plain.live("project changeloop.json wins over the project opencode.json and over global changeloop.json", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* write(path.join(global, "changeloop.json"), { shell: "global-changeloop" })
      yield* write(path.join(project, "opencode.json"), { shell: "project-opencode" })
      expect(yield* shell.pipe(Effect.provide(configLayer(project, global)))).toBe("project-opencode")
      yield* write(path.join(project, "changeloop.json"), { shell: "project-changeloop" })
      expect(yield* shell.pipe(Effect.provide(configLayer(project, global)))).toBe("project-changeloop")
    }),
  )

  plain.live("a user with only opencode.json sees the same result as before", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* write(path.join(global, "opencode.json"), { shell: "global" })
      yield* write(path.join(project, "opencode.json"), { shell: "project" })
      expect(yield* shell.pipe(Effect.provide(configLayer(project, global)))).toBe("project")
    }),
  )

  plain.live("an invalid changeloop.json is skipped while opencode.json still loads", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* write(path.join(global, "opencode.json"), { shell: "opencode" })
      yield* write(path.join(global, "changeloop.json"), "{ invalid")
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
      expect(yield* shell.pipe(Effect.provide(configLayer(project, global)))).toBe("opencode")
    }),
  )

  plain.live("update writes the winning existing file and leaves the lower one untouched", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* write(path.join(global, "opencode.json"), { shell: "opencode" })
      yield* write(path.join(global, "changeloop.json"), { shell: "changeloop" })
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        yield* config.update!({ shell: "updated" })
      }).pipe(Effect.provide(configLayer(project, global)))
      expect(
        JSON.parse(yield* Effect.promise(() => fs.readFile(path.join(global, "changeloop.json"), "utf8"))),
      ).toEqual({ shell: "updated" })
      expect(JSON.parse(yield* Effect.promise(() => fs.readFile(path.join(global, "opencode.json"), "utf8")))).toEqual({
        shell: "opencode",
      })
    }),
  )

  plain.live("update seeds changeloop.jsonc when no config file exists", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
      yield* Effect.promise(() => fs.mkdir(global, { recursive: true }))
      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        yield* config.update!({ shell: "seeded" })
      }).pipe(Effect.provide(configLayer(project, global)))
      const files = yield* Effect.promise(() => fs.readdir(global))
      expect(files.filter((name) => name.endsWith(".json") || name.endsWith(".jsonc"))).toEqual(["changeloop.jsonc"])
      expect(yield* Effect.promise(() => fs.readFile(path.join(global, "changeloop.jsonc"), "utf8"))).toContain(
        "seeded",
      )
    }),
  )
})

describe("Changeloop project directory", () => {
  plain.live("loads .opencode before .changeloop at the same level, so .changeloop wins", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* write(path.join(project, ".opencode", "opencode.json"), { shell: "dot-opencode" })
      yield* write(path.join(project, ".changeloop", "opencode.json"), { shell: "dot-changeloop" })
      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        const entries = yield* config.entries()
        expect(
          entries
            .filter((entry) => entry.type === "directory" && entry.path.startsWith(project))
            .map((entry) => entry.path),
        ).toEqual([
          AbsolutePath.make(path.join(project, ".opencode")),
          AbsolutePath.make(path.join(project, ".changeloop")),
        ])
        expect(Config.latest(entries, "shell")).toBe("dot-changeloop")
      }).pipe(Effect.provide(configLayer(project, global)))
    }),
  )

  plain.live("a lone .changeloop directory with changeloop.json inside is loaded", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* write(path.join(project, ".changeloop", "changeloop.json"), { shell: "inside" })
      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        const entries = yield* config.entries()
        expect(
          entries.some((entry) => entry.type === "directory" && entry.path === path.join(project, ".changeloop")),
        ).toBe(true)
        expect(Config.latest(entries, "shell")).toBe("inside")
      }).pipe(Effect.provide(configLayer(project, global)))
    }),
  )

  plain.live("keeps outermost-first ordering across levels", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const root = path.join(tmp.path, "repo")
      const directory = path.join(root, "packages", "app")
      yield* write(path.join(root, ".changeloop", "opencode.json"), { shell: "root" })
      yield* write(path.join(directory, ".opencode", "opencode.json"), { shell: "inner" })
      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        const entries = yield* config.entries()
        expect(
          entries
            .filter((entry) => entry.type === "directory" && entry.path.startsWith(root))
            .map((entry) => entry.path),
        ).toEqual([
          AbsolutePath.make(path.join(root, ".changeloop")),
          AbsolutePath.make(path.join(directory, ".opencode")),
        ])
        expect(Config.latest(entries, "shell")).toBe("inner")
      }).pipe(Effect.provide(configLayer(directory, global, root)))
    }),
  )
})

// A markdown command is discovered through the config Directory entry, so this proves .changeloop works
// for commands (and, through the same entries, for plugins and skills) on a real session.
const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("ok", "hello") })
const live = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: (session) =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: session.model?.id ?? "parent", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
    ]),
  ),
)

describe("Changeloop commands directory", () => {
  for (const folder of [".changeloop", ".opencode"]) {
    live.live(`a command in ${folder}/commands runs on a real session`, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tmp.path, folder, "commands", "hello.md"),
            ["---", "description: Say hello", "agent: build", "---", "Hello $ARGUMENTS from " + folder].join("\n"),
          ),
        )
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "opencode.json"), JSON.stringify({})))
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(tmp.path) },
          title: "Parent",
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
        })
        yield* sessions.command({ sessionID: session.id, command: "hello", text: "world" })
        yield* sessions.wait(session.id)
        const users = (yield* sessions.context(session.id)).filter((message) => message.type === "user")
        expect(users).toMatchObject([{ text: `Hello world from ${folder}` }])
      }),
    )
  }
})
