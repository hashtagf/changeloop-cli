import { afterAll, afterEach, expect, test } from "bun:test"
import { chmod, lstat, readdir, rm } from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { Foundation } from "@opencode-ai/core/foundation"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FoundationRuntime } from "../../src/plugin/foundation-runtime"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

const row = (id: string, status = "building", updatedAt: string | null = null) => ({
  id,
  status,
  phase: "build",
  updatedAt,
})
const snapshot = (changes: unknown[] = []) => ({
  schemaVersion: 3,
  generatedAt: "2026-09-09T00:00:00Z",
  changes,
  runs: [],
  budgets: {},
  evidence: {},
  diagnostics: { malformedStates: 0 },
})

test("A03 stable bounded pagination, literal search, scopes, and invalid query partitions", () => {
  const data = snapshot([row("beta"), row("alpha"), row("recent", "building", "2026-09-09"), row("old", "archived")])
  expect(Foundation.project(data, { limit: "2" })).toMatchObject({
    items: [{ id: "recent" }, { id: "alpha" }],
    total: 3,
    nextOffset: 2,
  })
  expect(Foundation.project(data, { offset: "2", limit: "2" })).toMatchObject({
    items: [{ id: "beta" }],
    nextOffset: null,
  })
  expect(Foundation.project(data, { scope: "archive" }).items.map((item) => item.id)).toEqual(["old"])
  expect(Foundation.project(data, { search: " ALPHA " }).total).toBe(1)
  expect(Foundation.project(data, { search: ".*" }).total).toBe(0)
  for (const query of [
    { offset: "-1" },
    { offset: "1.2" },
    { offset: "Infinity" },
    { offset: "9007199254740992" },
    { limit: "0" },
    { limit: "101" },
    { limit: "1e2" },
    { scope: "all" },
    { search: "x".repeat(257) },
  ]) {
    expect(() => Foundation.project(data, query)).toThrow(Foundation.ReadError)
  }
})

test("F4 runtime-compatible dotted identifiers remain readable within the 128 character limit", () => {
  const id = "release.v2"
  const longest = "a".repeat(128)
  expect(Foundation.project(snapshot([row(id), row(longest), row("a".repeat(129))])).total).toBe(2)
  expect(Foundation.project(snapshot([row(id)]), { changeID: id }).items[0]?.id).toBe(id)
  expect(() => Foundation.identifier(longest)).not.toThrow()
  for (const invalid of ["a".repeat(129), "../bad", ".hidden", "a/b"]) {
    expect(() => Foundation.identifier(invalid)).toThrow(Foundation.ReadError)
  }
})

test("A04 malformed items and independent evidence partitions do not erase valid changes or leak private fields", () => {
  const data = {
    ...snapshot([null, row("safe"), row("safe"), row("../bad"), row("other")]),
    project: { owner: "private@example.test" },
    evidence: {
      safe: {
        status: "unverified",
        recordedStatus: "passing",
        freshness: "unavailable",
        providers: [],
        secret: "private",
      },
      other: { status: 7 },
    },
    runs: [{ id: "safe", branch: "feature", ownerEmail: "private@example.test", operationMs: { build: 12 } }],
    budgets: {
      safe: {
        lifetime: { usedRequests: null, usedTokens: 0 },
        window: { id: null, usedRequests: null, usedTokens: null, targetRequests: null, targetTokens: null },
      },
    },
  }
  const result = Foundation.project(data)
  expect(result.total).toBe(2)
  expect(result.items.find((item) => item.id === "safe")).toMatchObject({
    evidence: { status: "unverified", recordedStatus: "passing", freshness: "unavailable" },
    budget: { lifetime: { usedTokens: 0, usedRequests: null } },
  })
  expect(result.items.find((item) => item.id === "other")?.evidence).toBeNull()
  expect(result.diagnostics.length).toBeGreaterThan(0)
  expect(JSON.stringify(result)).not.toContain("private")
  expect(JSON.stringify(result)).not.toContain('"secret"')
  expect(() => Foundation.project({ changes: [] })).toThrow(Foundation.ReadError)
  expect(() => Foundation.project({ ...snapshot(), schemaVersion: 4 })).toThrow(Foundation.ReadError)
})

const server = HttpRouter.toWebHandler(
  HttpApiApp.routes.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: "foundation-test" }))),
  ),
  { disableLogger: true },
)
function request(directory: string, route: string, authorized = true) {
  return server.handler(
    new Request(`http://localhost/experimental/foundation${route}`, {
      headers: {
        "x-opencode-directory": directory,
        ...(authorized ? { authorization: `Basic ${btoa("opencode:foundation-test")}` } : {}),
      },
    }),
    HttpApiApp.context,
  )
}
afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})
afterAll(async () => {
  await server.dispose()
  // The runtime cache is deliberately immutable. Make only this test's cache removable.
  const root = `${Global.Path.cache}/foundation`
  async function remove(file: string): Promise<void> {
    const stat = await lstat(file).catch(() => undefined)
    if (!stat) return
    if (!stat.isSymbolicLink()) {
      await chmod(file, stat.isDirectory() ? 0o700 : 0o600)
      if (stat.isDirectory()) await Promise.all((await readdir(file)).map((name) => remove(`${file}/${name}`)))
    }
    await rm(file, { force: true, recursive: true })
  }
  await remove(root)
})

test("A01/A02 authenticated HTTP reads isolate selected projects and archive survives missing sandbox", async () => {
  await using first = await tmpdir({ git: true })
  await using second = await tmpdir({ git: true })
  expect((await FoundationRuntime.install(first.path)).exitCode).toBe(0)
  expect((await FoundationRuntime.install(second.path)).exitCode).toBe(0)
  await Bun.write(
    `${first.path}/.foundation/runtime/alpha.json`,
    JSON.stringify({ id: "alpha", status: "building", revision: 1 }),
  )
  await Bun.write(
    `${first.path}/.foundation/runtime/history.json`,
    JSON.stringify({ id: "history", status: "archived", revision: 1, workspace: { path: "/missing" } }),
  )
  await Bun.write(
    `${second.path}/.foundation/runtime/beta.json`,
    JSON.stringify({ id: "beta", status: "building", revision: 1 }),
  )
  expect((await request(first.path, "/changes", false)).status).toBe(401)
  const a = await request(first.path, "/changes")
  expect(a.status).toBe(200)
  expect(await a.json()).toMatchObject({
    location: { directory: first.path },
    data: { items: [{ id: "alpha" }], total: 1 },
  })
  const b = await request(second.path, "/changes")
  expect(b.status).toBe(200)
  expect(await b.json()).toMatchObject({
    location: { directory: second.path },
    data: { items: [{ id: "beta" }], total: 1 },
  })
  expect((await request(second.path, "/changes/alpha")).status).toBe(404)
  expect(await (await request(first.path, "/changes/history")).json()).toMatchObject({
    data: { id: "history", status: "archived" },
  })
  expect((await request(first.path, "/changes?limit=101")).status).toBe(400)
  expect((await request(first.path, "/changes/a%2Fb")).status).toBe(400)
}, 60_000)

test("A05 uninitialized and disabled projects expose capability without initializing", async () => {
  await using empty = await tmpdir({ git: true })
  expect(await (await request(empty.path, "/capability")).json()).toMatchObject({
    data: { available: false, code: "not_initialized" },
  })
  expect((await request(empty.path, "/changes")).status).toBe(409)
  expect(await Bun.file(`${empty.path}/.claude/harness/protocol.json`).exists()).toBe(false)
  await using disabled = await tmpdir({ git: true, config: { foundation_workflow: false } })
  expect(await (await request(disabled.path, "/capability")).json()).toMatchObject({
    data: { available: false, code: "unsupported" },
  })
}, 30_000)
