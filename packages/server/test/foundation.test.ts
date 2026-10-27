import { expect } from "bun:test"
import { CommandPreparation } from "@opencode/core/command-preparation"
import { Command } from "@opencode/schema/command"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { commandPreparationLayer, createEmbeddedRoutes } from "../src/routes"

const request = (path: string, query: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const context = yield* Layer.build(
      createEmbeddedRoutes({
        database: { path: ":memory:" },
        models: { fetch: false },
        config: { directory: directory.path, project: false, content: "{}" },
        fs: { filewatcher: false },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const url = new URL(path, "http://opencode.local")
    url.searchParams.set("location[directory]", directory.path)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = yield* Effect.promise(() => handler(new Request(url)))
    return { status: response.status, body: (yield* Effect.promise(() => response.json())) as any }
  })

it.live("capability reports unavailable with code unsupported on a standalone server", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request("/experimental/foundation/capability")
    expect(status).toBe(200)
    expect(body.data).toMatchObject({ available: false, code: "unsupported", runtime: null })
  }),
)

it.live("list answers 503 unsupported on a standalone server", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request("/experimental/foundation/changes")
    expect(status).toBe(503)
    expect(body.data.code).toBe("unsupported")
  }),
)

it.live("list rejects limit=0 with 400 invalid_input before reading the runtime", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request("/experimental/foundation/changes", { limit: "0" })
    expect(status).toBe(400)
    expect(body.data.code).toBe("invalid_input")
  }),
)

it.live("get rejects a malformed change id with 400 invalid_input", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request("/experimental/foundation/changes/..bad%20id")
    expect(status).toBe(400)
    expect(body.data.code).toBe("invalid_input")
  }),
)

it.live("documents answer 503 unsupported on a standalone server", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request("/experimental/foundation/changes/x/documents")
    expect(status).toBe(503)
    expect(body.data.code).toBe("unsupported")
  }),
)

it.live("command list stays reachable through CommandPreparation passthrough", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request("/api/command")
    expect(status).toBe(200)
    expect(body.data).toEqual([])
  }),
)

it.effect("standalone CommandPreparation passes commands through and rejects a missing one", () =>
  Effect.gen(function* () {
    const preparation = yield* CommandPreparation.Service
    const commands = [Command.Info.make({ name: "a" }), Command.Info.make({ name: "b", description: "B" })]
    expect(yield* preparation.list("/tmp", commands)).toEqual(commands)

    const found = yield* preparation.prepare({ directory: "/tmp", name: "a", arguments: "", command: commands[0] })
    expect(found).toBe(commands[0])

    const error = yield* preparation
      .prepare({ directory: "/tmp", name: "missing", arguments: "" })
      .pipe(Effect.flip)
    expect(error).toBeInstanceOf(CommandPreparation.Error)
    expect(error.code).toBe("command_not_found")
  }).pipe(Effect.provide(commandPreparationLayer)),
)
