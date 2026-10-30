import { NodeServices } from "@effect/platform-node"
import { EffectFlock } from "@opencode/util/effect-flock"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { expect, spyOn } from "bun:test"
import { Effect, FileSystem, Layer, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import path from "node:path"
import { Updater } from "../src/services/updater"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)

// Both doors out of the process are watched: the network (fetch) and every spawned command
// (package managers, installers, bash, curl). Tests assert that neither was used.
function fixture(updateUrl: string | undefined) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "changeloop-updater-" })
    const requests: string[] = []
    const commands: string[][] = []
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(
            async (input: string | URL | Request) => {
              requests.push(input instanceof Request ? input.url : input.toString())
              return Response.json({ version: "9.9.9", metadata: { package: "@changeloop/cli" } })
            },
            { preconnect: fetch.preconnect },
          ),
        ),
      ),
      (request) => Effect.sync(() => request.mockRestore()),
    )
    const global = Global.make({
      home: path.join(root, "home"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      bin: path.join(root, "bin"),
      log: path.join(root, "log"),
      repos: path.join(root, "repos"),
    })
    const updater = yield* Updater.Service.pipe(
      Effect.provide(Updater.layerWith(updateUrl)),
      Effect.provide(
        LayerNode.compile(EffectFlock.node, {
          replacements: [Global.node.replace(Layer.succeed(Global.Service, global))],
        }),
      ),
      Effect.provideService(Global.Service, global),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(
        AppProcess.Service,
        AppProcess.Service.of({
          ...spawner,
          run: (command) =>
            Effect.suspend(() => {
              if (command._tag !== "StandardCommand") return Effect.die("Unexpected piped command")
              commands.push([command.command, ...command.args])
              return Effect.succeed({
                command: command.command,
                exitCode: 0,
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
                stdoutTruncated: false,
                stderrTruncated: false,
              })
            }),
          runStream: () => Stream.die("Unexpected streaming command"),
        }),
      ),
    )
    return { updater, requests, commands, global, fs }
  })
}

const refuses = Effect.fnUntraced(function* (effect: Effect.Effect<unknown, Error>) {
  const error = yield* effect.pipe(Effect.flip)
  expect(error).toBeInstanceOf(Updater.UpgradeError)
  const upgrade = error as Updater.UpgradeError
  expect(upgrade.title).toBe("Changeloop has no release channel yet")
  expect(upgrade.retry).toContain("bun run --cwd packages/cli build --single")
})

it.live("without a release channel the automatic check, TUI check and notices never reach out", () =>
  Effect.gen(function* () {
    const test = yield* fixture(undefined)
    expect(test.updater.released).toBe(false)
    const installs: string[] = []
    expect(yield* test.updater.run((version) => installs.push(version))).toBeUndefined()
    const checked = yield* test.updater.check()
    expect(checked?.type).toBe("unavailable")
    if (checked?.type === "unavailable") expect(checked.message).toContain("no release channel")
    expect(installs).toEqual([])
    expect(test.requests).toEqual([])
    expect(test.commands).toEqual([])
  }),
)

it.live("without a release channel apply, latest, and upgrade fail before any fetch or spawn", () =>
  Effect.gen(function* () {
    const test = yield* fixture(undefined)
    yield* refuses(test.updater.apply("9.9.9"))
    yield* refuses(test.updater.latest())
    yield* Effect.forEach(Updater.methods, (method) =>
      Effect.gen(function* () {
        yield* refuses(test.updater.latest(method))
        yield* refuses(test.updater.upgrade(method, "9.9.9"))
      }),
    )
    expect(test.requests).toEqual([])
    expect(test.commands).toEqual([])
    expect(yield* test.fs.exists(test.global.cache)).toBe(false)
  }),
)

it.live("without a release channel no installation is detected and uninstall owns no package", () =>
  Effect.gen(function* () {
    const test = yield* fixture(undefined)
    expect(yield* test.updater.method()).toBeUndefined()
    Updater.methods.forEach((method) => expect(test.updater.removal(method)).toBeUndefined())
    expect(test.commands).toEqual([])
    expect(test.requests).toEqual([])
  }),
)

it.live("a configured release channel is the only update source", () =>
  Effect.gen(function* () {
    const test = yield* fixture("https://releases.example.test/update/")
    expect(test.updater.released).toBe(true)
    expect(yield* test.updater.latest("npm")).toBe("9.9.9")
    expect(test.requests).toEqual(["https://releases.example.test/update/local/cli/npm?current=local"])
    expect(test.requests.some((url) => url.includes("opencode.ai"))).toBe(false)
  }),
)
