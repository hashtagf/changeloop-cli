import { afterAll, afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Database } from "@opencode-ai/core/database/database"
import { SessionInputTable } from "@opencode-ai/core/session/sql"
import { AppRuntime } from "../../src/effect/app-runtime"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { bootstrapInstruction, resolveFoundationInstruction } from "../../src/plugin/foundation"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { cleanupFoundationCache } from "../fixture/foundation-cache"
import { resetDatabase } from "../fixture/db"

function request(directory: string, route: string, body?: unknown) {
  return HttpApiApp.webHandler().handler(new Request(`http://localhost${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-opencode-directory": directory },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), HttpApiApp.context)
}
afterEach(async () => { await disposeAllInstances(); await resetDatabase() })
afterAll(cleanupFoundationCache)

test("S02 real V2 command admission uses canonical host instructions and reconciles exact retries", async () => {
  await using tmp = await tmpdir({ git: true })
  const listed = await request(tmp.path, "/api/command")
  expect(listed.status).toBe(200)
  expect((await listed.json()).data.map((command: {name: string}) => command.name)).toContain("investigate")
  const created = await request(tmp.path, "/api/session", { location: { directory: tmp.path } })
  expect(created.status).toBe(200)
  const id = (await created.json()).data.id
  const body = { id: "msg_foundation_command", command: "investigate", arguments: "check web ui", resume: false }
  const canonical = await resolveFoundationInstruction({ directory: tmp.path, command: "investigate", arguments: body.arguments })
  expect(canonical.ok).toBe(true)
  if (!canonical.ok) throw new Error(canonical.code)
  const first = await request(tmp.path, `/api/session/${id}/command`, body)
  expect(first.status).toBe(200)
  const admitted = await first.json()
  expect(admitted.data.prompt.text).toBe(bootstrapInstruction(canonical.instruction))
  const retry = await request(tmp.path, `/api/session/${id}/command`, body)
  expect(retry.status).toBe(200)
  expect(await retry.json()).toEqual(admitted)
  const rows = await AppRuntime.runPromise(Database.Service.use((database) => database.db.select().from(SessionInputTable).where(eq(SessionInputTable.id, SessionMessage.ID.make(body.id))).all().pipe(Effect.orDie)))
  expect(rows).toHaveLength(1)
  expect(rows[0].promoted_seq).toBeNull()
  expect((await request(tmp.path, `/api/session/${id}/command`, { ...body, arguments: "different" })).status).toBe(409)
  expect(await Bun.file(`${tmp.path}/.claude/harness/protocol.json`).exists()).toBe(false)
}, 60_000)

test("S03 opt-out rejects builtins and explicit overrides remain owned by the project", async () => {
  await using disabled = await tmpdir({ git: true, config: { foundation_workflow: false } })
  const created = await request(disabled.path, "/api/session", { location: { directory: disabled.path } })
  const id = (await created.json()).data.id
  expect((await request(disabled.path, `/api/session/${id}/command`, { command: "investigate", arguments: "topic", resume: false })).status).toBe(400)
  await using override = await tmpdir({ git: true, config: { foundation_workflow: false, command: { investigate: { template: "Project-owned: $ARGUMENTS" } } } })
  expect((await (await request(override.path, "/api/command")).json()).data.some((command: {name: string}) => command.name === "investigate")).toBe(true)
  const other = (await (await request(override.path, "/api/session", { location: { directory: override.path } })).json()).data.id
  const response = await request(override.path, `/api/session/${other}/command`, { command: "investigate", arguments: "specific topic", resume: false })
  expect(response.status).toBe(200)
  expect((await response.json()).data.prompt.text).toBe("Project-owned: specific topic")
  // Session placement, rather than a caller-supplied directory header, owns preparation.
  const located = await request(disabled.path, `/api/session/${other}/command`, { command: "investigate", resume: false })
  expect(located.status).toBe(200)
  expect((await located.json()).data.prompt.text).toBe("Project-owned: ")
}, 60_000)

test("S04 selected-runtime preparation failure admits no input", async () => {
  await using tmp = await tmpdir({ git: true, config: { foundation_runtime: "path" } })
  const id = (await (await request(tmp.path, "/api/session", { location: { directory: tmp.path } })).json()).data.id
  await request(tmp.path, "/api/command")
  const previous = process.env.PATH
  try {
    process.env.PATH = tmp.path
    const failed = await request(tmp.path, `/api/session/${id}/command`, { id: "msg_unavailable", command: "investigate", arguments: "topic", resume: false })
    expect(failed.status).toBe(503)
    expect(await failed.text()).toContain("foundation_cli_missing")
  } finally {
    process.env.PATH = previous
  }
  const rows = await AppRuntime.runPromise(Database.Service.use((database) => database.db.select().from(SessionInputTable).where(eq(SessionInputTable.id, SessionMessage.ID.make("msg_unavailable"))).all().pipe(Effect.orDie)))
  expect(rows).toHaveLength(0)
  expect((await request(tmp.path, `/api/session/${id}/command`, { command: "not-a-registered-command", resume: false })).status).toBe(400)
  expect((await (await request(tmp.path, `/api/session/${id}/context`)).json()).data).toEqual([])
}, 30_000)
