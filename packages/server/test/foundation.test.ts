import { expect } from "bun:test"
import { chmod, mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { CommandPreparation } from "@opencode/core/command-preparation"
import { Command } from "@opencode/schema/command"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import type { ServerOptions } from "../src/options"
import { commandPreparationLayer, createEmbeddedRoutes } from "../src/routes"

// These spawn the POSIX shell runtime, which Foundation does not support on win32.
const itRuntime = process.platform === "win32" ? it.live.skip : it.live

type Project = { path: string; bin: string }

const snapshot = JSON.stringify({
  schemaVersion: 3,
  foundationVersion: "9.9.9",
  generatedAt: "2026-01-03T00:00:00Z",
  changes: [
    { id: "alpha", status: "building", phase: "build", updatedAt: "2026-01-02T00:00:00Z" },
    { id: "beta", status: "proven", phase: "prove", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "old", status: "archived", phase: "archive", updatedAt: "2025-12-01T00:00:00Z" },
  ],
  runs: [],
  evidence: {},
  budgets: {},
  diagnostics: { malformedStates: 0 },
})

// A stand-in claude-foundation on PATH: `script` is the shell body that answers `dashboard snapshot --json`.
const request = (
  route: string,
  query: Record<string, string> = {},
  config: {
    foundation?: ServerOptions["foundation"]
    script?: string
    initialized?: boolean
    prepare?: (project: Project) => Promise<void>
    /** Server-level config document (JSON text). */
    content?: string
    /** Reads opencode.json from the project directory; default off. */
    project?: boolean
    /** A second project on the same server, with its own opencode.json; its answer comes back as `other`. */
    other?: { config: string }
  } = {},
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const project = yield* tmpdirScoped()
    const bin = yield* tmpdirScoped()
    const sibling = config.other ? yield* tmpdirScoped() : undefined
    for (const dir of [project, sibling]) {
      if (!dir || !config.initialized) continue
      yield* Effect.promise(() => mkdir(path.join(dir.path, ".claude/harness"), { recursive: true }))
      yield* Effect.promise(() => Bun.write(path.join(dir.path, ".claude/harness/protocol.json"), "{}"))
    }
    if (sibling && config.other)
      yield* Effect.promise(() => Bun.write(path.join(sibling.path, "opencode.json"), config.other!.config))
    yield* Effect.promise(async () => {
      const executable = path.join(bin.path, "claude-foundation")
      await Bun.write(executable, `#!/bin/sh\n${config.script ?? `cat <<'JSON'\n${snapshot}\nJSON`}\n`)
      await chmod(executable, 0o755)
      await config.prepare?.({ path: project.path, bin: bin.path })
    })
    const original = process.env.PATH
    yield* Effect.acquireRelease(
      Effect.sync(() => void (process.env.PATH = `${bin.path}${path.delimiter}${original ?? ""}`)),
      () => Effect.sync(() => void (process.env.PATH = original)),
    )
    const context = yield* Layer.build(
      createEmbeddedRoutes({
        database: { path: ":memory:" },
        models: { fetch: false },
        config: { directory: directory.path, project: config.project ?? false, content: config.content ?? "{}" },
        fs: { filewatcher: false },
        foundation: config.foundation ?? { runtime: "path" },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const ask = (directory: string) =>
      Effect.gen(function* () {
        const url = new URL(route, "http://opencode.local")
        url.searchParams.set("location[directory]", directory)
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
        const response = yield* Effect.promise(() => handler(new Request(url)))
        return { status: response.status, body: (yield* Effect.promise(() => response.json())) as any }
      })
    return { ...(yield* ask(project.path)), other: sibling ? yield* ask(sibling.path) : undefined }
  })

const initialized = { initialized: true }
const base = "/experimental/foundation"

itRuntime("capability reports the runtime and list returns real active changes", () =>
  Effect.gen(function* () {
    const capability = yield* request(`${base}/capability`, {}, initialized)
    expect(capability.status).toBe(200)
    expect(capability.body.data).toMatchObject({
      available: true,
      code: null,
      runtime: { mode: "path", version: "9.9.9" },
      snapshot: true,
    })

    const list = yield* request(`${base}/changes`, {}, initialized)
    expect(list.status).toBe(200)
    expect(list.body.data.total).toBe(2)
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toEqual(["alpha", "beta"])
    expect(list.body.data.nextOffset).toBeNull()
  }),
)

itRuntime("list scope=archive returns archived changes and get resolves an archived id", () =>
  Effect.gen(function* () {
    const archive = yield* request(`${base}/changes`, { scope: "archive" }, initialized)
    expect(archive.status).toBe(200)
    expect(archive.body.data.items.map((item: { id: string }) => item.id)).toEqual(["old"])

    const archived = yield* request(`${base}/changes/old`, {}, initialized)
    expect(archived.status).toBe(200)
    expect(archived.body.data).toMatchObject({ id: "old", status: "archived" })

    const active = yield* request(`${base}/changes/alpha`, {}, initialized)
    expect(active.body.data).toMatchObject({ id: "alpha", status: "building", phase: "build" })
  }),
)

itRuntime("get answers 404 not_found for an id that is not in the snapshot", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request(`${base}/changes/missing`, {}, initialized)
    expect(status).toBe(404)
    expect(body.data.code).toBe("not_found")
  }),
)

itRuntime("an uninitialized project answers 409 not_initialized while investigations stay readable", () =>
  Effect.gen(function* () {
    const list = yield* request(`${base}/changes`)
    expect(list.status).toBe(409)
    expect(list.body.data.code).toBe("not_initialized")

    const capability = yield* request(`${base}/capability`)
    expect(capability.status).toBe(200)
    expect(capability.body.data).toMatchObject({ available: false, code: "not_initialized", runtime: null })

    const investigations = yield* request(`${base}/investigations`)
    expect(investigations.status).toBe(200)
    expect(investigations.body.data.total).toBe(0)
  }),
)

itRuntime("list rejects limit=0 with 400 invalid_input before spawning the runtime", () =>
  Effect.gen(function* () {
    const marker = path.join(tmpdir(), `foundation-spawned-${crypto.randomUUID()}`)
    const { status, body } = yield* request(`${base}/changes`, { limit: "0" }, { ...initialized, script: `touch '${marker}'` })
    expect(status).toBe(400)
    expect(body.data.code).toBe("invalid_input")
    expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    // The same runtime does run for a valid request, so the marker above proves the spawn was skipped.
    yield* request(`${base}/changes`, {}, { ...initialized, script: `touch '${marker}'\ncat <<'JSON'\n${snapshot}\nJSON` })
    expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
    yield* Effect.promise(() => rm(marker, { force: true }))
  }),
)

it.live("get rejects a malformed change id with 400 invalid_input", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request(`${base}/changes/..bad%20id`, {}, initialized)
    expect(status).toBe(400)
    expect(body.data.code).toBe("invalid_input")
  }),
)

itRuntime("a runtime that never answers is reported as 504 timeout", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request(`${base}/changes`, {}, { ...initialized, script: "/bin/sleep 30 &\nwait" })
    expect(status).toBe(504)
    expect(body.data.code).toBe("timeout")
  }),
  20_000,
)

itRuntime("a runtime that prints more than 1 MiB is reported as 502 output_too_large", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request(
      `${base}/changes`,
      {},
      { ...initialized, script: "/bin/dd if=/dev/zero bs=1200000 count=1 2>/dev/null\nexec /bin/sleep 30" },
    )
    expect(status).toBe(502)
    expect(body.data.code).toBe("output_too_large")
  }),
  20_000,
)

it.live("documents and investigations are served from the project files by opaque id", () =>
  Effect.gen(function* () {
    const prepare = async (project: Project) => {
      await mkdir(path.join(project.path, "openspec/investigations"), { recursive: true })
      await mkdir(path.join(project.path, "openspec/changes/alpha"), { recursive: true })
      await Bun.write(path.join(project.path, "openspec/investigations/note.md"), "# Research\n\nbody")
      await Bun.write(path.join(project.path, "openspec/changes/alpha/tasks.md"), "- [x] one\n- [ ] two\n")
    }
    const investigations = yield* request(`${base}/investigations`, {}, { prepare })
    expect(investigations.status).toBe(200)
    expect(investigations.body.data.items.map((item: { title: string }) => item.title)).toEqual(["Research"])
    const note = yield* request(`${base}/investigations/${investigations.body.data.items[0].id}`, {}, { prepare })
    expect(note.status).toBe(200)
    expect(note.body.data.text).toBe("# Research\n\nbody")

    const documents = yield* request(`${base}/changes/alpha/documents`, {}, { prepare })
    expect(documents.status).toBe(200)
    expect(documents.body.data.items.map((item: { sourcePath: string }) => item.sourcePath)).toEqual([
      "openspec/changes/alpha/tasks.md",
    ])
    const tasks = yield* request(
      `${base}/changes/alpha/documents/${documents.body.data.items[0].id}`,
      {},
      { prepare },
    )
    expect(tasks.status).toBe(200)
    expect(tasks.body.data.tasks.map((task: { checked: boolean }) => task.checked)).toEqual([true, false])
  }),
)

it.live("document ids that are malformed answer 400 and unknown ids answer 404", () =>
  Effect.gen(function* () {
    const malformed = yield* request(`${base}/investigations/not-a-hash`)
    expect(malformed.status).toBe(400)
    expect(malformed.body.data.code).toBe("invalid_input")

    const unknown = yield* request(`${base}/investigations/${"0".repeat(64)}`)
    expect(unknown.status).toBe(404)
    expect(unknown.body.data.code).toBe("not_found")

    const missingChange = yield* request(`${base}/changes/nope/documents`)
    expect(missingChange.status).toBe(404)
  }),
)

it.live("foundation.enabled=false answers unsupported even for an initialized project", () =>
  Effect.gen(function* () {
    const options = { ...initialized, foundation: { enabled: false } }
    const capability = yield* request(`${base}/capability`, {}, options)
    expect(capability.status).toBe(200)
    expect(capability.body.data).toMatchObject({ available: false, code: "unsupported", runtime: null })

    const list = yield* request(`${base}/changes`, {}, options)
    expect(list.status).toBe(503)
    expect(list.body.data.code).toBe("unsupported")

    const documents = yield* request(`${base}/changes/x/documents`, {}, options)
    expect(documents.status).toBe(503)
    expect(documents.body.data.code).toBe("unsupported")
  }),
)

const workflowOff = JSON.stringify({ foundation_workflow: false })

it.live("foundation_workflow false answers unsupported on every Foundation endpoint without spawning the runtime", () =>
  Effect.gen(function* () {
    const marker = path.join(tmpdir(), `foundation-spawned-${crypto.randomUUID()}`)
    const options = { ...initialized, content: workflowOff, script: `touch '${marker}'` }
    const capability = yield* request(`${base}/capability`, {}, options)
    expect(capability.status).toBe(200)
    expect(capability.body.data).toMatchObject({ available: false, code: "unsupported", runtime: null })

    for (const route of [`${base}/changes`, `${base}/changes/alpha`, `${base}/changes/alpha/documents`, `${base}/investigations`]) {
      const { status, body } = yield* request(route, {}, options)
      expect(status).toBe(503)
      expect(body.data).toMatchObject({ code: "unsupported" })
    }
    expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
  }),
)

itRuntime("a config without foundation_workflow keeps answering real data", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request(`${base}/changes`, {}, { ...initialized, content: JSON.stringify({ username: "x" }) })
    expect(status).toBe(200)
    expect(body.data.total).toBe(2)
  }),
)

itRuntime("a project that switches the workflow off is unsupported while another project on the server is served", () =>
  Effect.gen(function* () {
    const { status, body, other } = yield* request(
      `${base}/changes`,
      {},
      { ...initialized, project: true, other: { config: "{}" }, prepare: (project) => Bun.write(path.join(project.path, "opencode.json"), workflowOff).then(() => undefined) },
    )
    expect(status).toBe(503)
    expect(body.data.code).toBe("unsupported")
    expect(other?.status).toBe(200)
    expect(other?.body.data.total).toBe(2)
  }),
)

it.live("list still rejects limit=0 with 400 invalid_input when Foundation is disabled", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request(`${base}/changes`, { limit: "0" }, { foundation: { enabled: false } })
    expect(status).toBe(400)
    expect(body.data.code).toBe("invalid_input")
  }),
)

it.live("command list stays reachable through CommandPreparation passthrough", () =>
  Effect.gen(function* () {
    const { status, body } = yield* request("/api/command")
    expect(status).toBe(200)
    // The list waits for plugin activation, so the first call already carries the builtin commands.
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
    for (const command of body.data) expect(typeof command.name).toBe("string")
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
