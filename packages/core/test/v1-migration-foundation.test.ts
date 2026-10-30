import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { Database } from "@opencode/core/database/database"
import { DatabaseMigration } from "@opencode/core/database/migration"
import { V1Migration } from "@opencode/core/database/v1-migration"
import { Project } from "@opencode/core/project"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Logger } from "effect"
import { sql } from "drizzle-orm"
import path from "path"

// The fork changed no table, column, or stored format of the V1 database: the diff of its migrations, storage and
// *.sql.ts files against the upstream merge base is empty. What differs is only the content of some sessions, which
// carry Foundation commands and harness tool calls. A V1 database holding such a session must import like any other.

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const sessionID = "ses_foundation"
const userID = "msg_000000000001aaaaaaaaaaaaaa"
const assistantID = "msg_000000000002aaaaaaaaaaaaaa"
const instruction = "Run the Foundation change workflow for: add a login page.\n\nUse `claude-foundation change start`."

test("imports a V1 session that ran Foundation commands and harness tool calls without skipping rows", async () => {
  const warnings: unknown[] = []
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)
        yield* db.run(sql`
          CREATE TABLE session (
            id text PRIMARY KEY, project_id text NOT NULL, workspace_id text, parent_id text, slug text NOT NULL,
            directory text NOT NULL, path text, title text NOT NULL, version text NOT NULL, share_url text,
            summary_additions integer, summary_deletions integer, summary_files integer, summary_diffs text,
            metadata text, cost real DEFAULT 0 NOT NULL, tokens_input integer DEFAULT 0 NOT NULL,
            tokens_output integer DEFAULT 0 NOT NULL, tokens_reasoning integer DEFAULT 0 NOT NULL,
            tokens_cache_read integer DEFAULT 0 NOT NULL, tokens_cache_write integer DEFAULT 0 NOT NULL,
            revert text, permission text, agent text, model text, time_created integer NOT NULL,
            time_updated integer NOT NULL, time_compacting integer, time_archived integer
          )
        `)
        yield* db.run(
          sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(
          sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/tmp/test', 1, 2, '[]')`,
        )
        yield* db.run(sql`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
          VALUES (${sessionID}, 'global', 'foundation', '/tmp/test', '/change add a login page', '1', 1, 2)
        `)
        const userData = JSON.stringify({
          role: "user",
          time: { created: 10 },
          agent: "build",
          model: { providerID: "provider", modelID: "model" },
        })
        const assistantData = JSON.stringify({
          role: "assistant",
          time: { created: 20, completed: 25 },
          parentID: userID,
          modelID: "model",
          providerID: "provider",
          mode: "build",
          agent: "build",
          path: { cwd: "/tmp/test", root: "/tmp/test" },
          cost: 1,
          tokens: { total: 10, input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } },
        })
        const insertMessage = (id: string, time: number, data: string) =>
          db.run(
            sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (${id}, ${sessionID}, ${time}, ${time + 1}, ${data})`,
          )
        const insertPart = (id: string, messageID: string, data: unknown) =>
          db.run(
            sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (${id}, ${messageID}, ${sessionID}, 1, 2, ${JSON.stringify(data)})`,
          )
        yield* insertMessage(userID, 10, userData)
        yield* insertMessage(assistantID, 20, assistantData)
        yield* insertPart("prt_1", userID, { type: "text", text: instruction })
        yield* insertPart("prt_2", assistantID, {
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "claude-foundation change start .foundation/drafts/login --approve-spec" },
            output: "CREATED login-page",
            title: "claude-foundation change start",
            metadata: {},
            time: { start: 21, end: 22 },
          },
        })
        yield* insertPart("prt_3", assistantID, { type: "text", text: "The change login-page is agreed." })

        yield* Effect.gen(function* () {
          expect(yield* V1Migration.run()).toEqual({ status: "completed" })
          const rows = yield* db.all<{ id: string; type: string; data: string }>(
            sql`SELECT id, type, data FROM session_message WHERE session_id = ${sessionID} ORDER BY seq`,
          )
          // Upstream appends a system notice after an assistant that called a tool V2 renamed (`bash`).
          expect(rows.map((row) => row.type)).toEqual(["user", "assistant", "system"])
          expect(rows.slice(0, 2).map((row) => row.id)).toEqual([userID, assistantID])
          expect(rows[2].data).toContain("bash")
          expect(JSON.parse(rows[0].data).text).toBe(instruction)
          const assistant = JSON.parse(rows[1].data)
          expect(JSON.stringify(assistant.content)).toContain("claude-foundation change start")
          expect(JSON.stringify(assistant.content)).toContain("The change login-page is agreed.")
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, FSUtil.node]), [
              Database.node.replace(Layer.succeed(Database.Service, { db })),
            ]),
          ),
        )
      }).pipe(
        Effect.provideService(Global.Service, Global.make({ data: path.join(process.cwd(), ".test-data") })),
        Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
        Effect.provide(
          Logger.layer([
            Logger.map(Logger.formatStructured, (entry) => {
              if (String(entry.message).includes("Skipped V1 migration row")) warnings.push(entry)
            }),
          ]),
        ),
      ),
    ),
  )

  expect(warnings).toEqual([])
})
