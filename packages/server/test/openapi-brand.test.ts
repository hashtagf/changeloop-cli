import fs from "node:fs/promises"
import path from "node:path"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

// Names of opencode.ai services, which the user must still be able to match to their account.
const services = /OpenCode (Console|Go|Zen)\b/g

/** Every summary and description in the document, with where it was found. */
const prose = (node: unknown, where = "$"): Array<[string, string]> => {
  if (Array.isArray(node)) return node.flatMap((item, index) => prose(item, `${where}[${index}]`))
  if (typeof node !== "object" || node === null) return []
  return Object.entries(node).flatMap(([key, value]) =>
    (key === "summary" || key === "description" || key === "title") && typeof value === "string"
      ? [[`${where}.${key}`, value] as [string, string]]
      : prose(value, `${where}.${key}`),
  )
}

const openapi = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("changeloop-openapi-")))
  const global = path.join(tmp.path, "global")
  yield* Effect.promise(() => fs.mkdir(global))
  const handler = yield* ServerFetch.make({
    database: { path: ":memory:" },
    config: { directory: global },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  const response = yield* Effect.promise(() => handler(new Request("http://changeloop.local/openapi.json")))
  return { status: response.status, document: yield* Effect.promise(() => response.json() as Promise<any>) }
})

it.live("the served /openapi.json names Changeloop in info and has no OpenCode prose", () =>
  Effect.gen(function* () {
    const { status, document } = yield* openapi

    expect(status).toBe(200)
    expect(document.info.title).toBe("Changeloop HttpApi")
    const entries = prose(document)
    expect(entries.length).toBeGreaterThan(100)
    const offenders = entries.filter(([, text]) => /opencode/i.test(text.replace(services, "")))
    expect(offenders).toEqual([])
  }),
)

test("the checked-in protocol openapi.json snapshot has no OpenCode prose either", async () => {
  const snapshot = JSON.parse(await fs.readFile(path.resolve(import.meta.dir, "../../protocol/openapi.json"), "utf8"))
  expect(snapshot.info.title).toBe("Changeloop HttpApi")
  const offenders = prose(snapshot).filter(([, text]) => /opencode/i.test(text.replace(services, "")))
  expect(offenders).toEqual([])
})

it.live("the served /openapi.json keeps its contract identifiers", () =>
  Effect.gen(function* () {
    const { document } = yield* openapi
    const text = JSON.stringify(document)

    expect(text).toContain("x-opencode-ticket")
    expect(document.paths["/api/info"].get.operationId).toBe("server.info")
    expect(Object.keys(document.paths).some((route) => route.startsWith("/api/"))).toBe(true)
    // The Console services keep their names where the description refers to the account.
    expect(text).toMatch(/OpenCode (Console|Go)/)
  }),
)
