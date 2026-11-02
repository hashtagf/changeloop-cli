import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin } from "@opencode/plugin/effect"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdir, tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"
import { startServer } from "./fixture/server"

const foundation = ["investigate", "change", "build", "prove", "land", "changes", "feature", "dev"]

it.live("waits for plugin activation before listing commands", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-command-endpoint-")))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(tmp.path, "opencode.json"),
        JSON.stringify({ commands: { "from-config": { template: "hello", description: "Config command" } } }),
      ),
    )
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/command", server.base)
    url.searchParams.set("location[directory]", tmp.path)

    // The first request of a fresh location races plugin activation; it must not answer with a partial list.
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))

    expect(response.status).toBe(200)
    const names = commandNames(yield* Effect.promise(() => response.json()))
    expect(names).toContain("from-config")
    for (const name of foundation) expect(names).toContain(name)
  }),
)

it.live(
  "holds the list while activation is pending and answers 503 once the deadline passes",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-command-pending-")
      const started = yield* Deferred.make<void>()
      const context = yield* Layer.build(
        createRoutes({
          password: "secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false },
          config: { directory: tmp.path, project: false, content: "{}" },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      )
      // A plugin whose setup never settles keeps activation open past the 5 second deadline.
      yield* Context.get(context, SdkPlugins.Service).register(
        Plugin.define({
          id: "stuck-plugin",
          effect: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        }),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const url = new URL("/api/command", "http://opencode.local")
      url.searchParams.set("location[directory]", tmp.path)
      const list = yield* Effect.promise((signal) =>
        handler(new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` }, signal })),
      ).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      yield* Effect.sleep("500 millis")
      expect(list.pollUnsafe()).toBeUndefined()

      const response = yield* Fiber.join(list)
      expect(response.status).toBe(503)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        _tag: "ServiceUnavailableError",
        service: "plugin",
      })
    }),
  15_000,
)

it.live("declares 503 for command.list in the published OpenAPI document", () =>
  Effect.gen(function* () {
    const openapi: unknown = JSON.parse(
      yield* Effect.promise(() => fs.readFile(path.join(import.meta.dir, "../../protocol/openapi.json"), "utf8")),
    )
    expect(pick(openapi, "paths", "/api/command", "get", "responses", "503", "description")).toBe(
      "ServiceUnavailableError",
    )
  }),
)

function commandNames(body: unknown) {
  const data = pick(body, "data")
  if (!Array.isArray(data)) throw new Error("Expected a command list response")
  return data.flatMap((command) => {
    const name = pick(command, "name")
    return typeof name === "string" ? [name] : []
  })
}

function pick(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
