export * as Foundation from "./foundation"

import { Context, Effect, Option, Schema } from "effect"
import { Foundation } from "@opencode-ai/schema/foundation"

export class ReadError extends Error {
  constructor(
    readonly code: Foundation.ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "FoundationReadError"
  }
}
export class Service extends Context.Service<
  Service,
  {
    readonly read: (directory: string) => Effect.Effect<
      {
        snapshot: unknown
        runtime: { mode: "bundled" | "path"; version: string }
      },
      ReadError
    >
  }
>()("@opencode/Foundation") {}

export type Selection = { scope?: string; search?: string; offset?: string; limit?: string }
const Row = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  phase: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
  evidenceStatus: Schema.optional(Schema.String),
})
const Envelope = Schema.Struct({
  schemaVersion: Schema.Number,
  generatedAt: Schema.String,
  changes: Schema.Array(Schema.Unknown),
  runs: Schema.Array(Schema.Unknown),
  evidence: Schema.Record(Schema.String, Schema.Unknown),
  budgets: Schema.Record(Schema.String, Schema.Unknown),
  diagnostics: Schema.Struct({ malformedStates: Schema.Number }),
})
const RunRow = Schema.Struct({ id: Schema.String, ...Foundation.Run.fields })
export function selection(input: Selection) {
  const offset = input.offset ?? "0"
  const limit = input.limit ?? "50"
  if (
    !/^\d+$/.test(offset) ||
    !/^\d+$/.test(limit) ||
    !Number.isSafeInteger(Number(offset)) ||
    Number(limit) < 1 ||
    Number(limit) > 100
  )
    throw new ReadError("invalid_input", "Offset must be a nonnegative integer and limit must be between 1 and 100")
  if (input.scope && input.scope !== "active" && input.scope !== "archive")
    throw new ReadError("invalid_input", "Scope must be active or archive")
  if ((input.search?.length ?? 0) > 256) throw new ReadError("invalid_input", "Search exceeds 256 characters")
  return {
    scope: input.scope ?? "active",
    search: input.search?.trim().toLowerCase() ?? "",
    offset: Number(offset),
    limit: Number(limit),
  }
}
export function identifier(id: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new ReadError("invalid_input", "Invalid change identifier")
  return id
}
export function project(snapshot: unknown, input: Selection & { changeID?: string } = {}): Foundation.Page {
  const query = selection(input)
  const decoded = Schema.decodeUnknownOption(Envelope)(snapshot)
  if (Option.isNone(decoded)) throw new ReadError("invalid_response", "Foundation snapshot envelope is invalid")
  const data = decoded.value
  if (data.schemaVersion !== 3) throw new ReadError("unsupported", "Foundation snapshot schema is unsupported")
  const diagnostics: string[] = []
  if (data.diagnostics.malformedStates > 0)
    diagnostics.push(`${data.diagnostics.malformedStates} malformed runtime states omitted`)
  const decodeRow = Schema.decodeUnknownOption(Row)
  const seen = new Set<string>()
  const rows = data.changes
    .flatMap((value) => {
      const row = decodeRow(value)
      if (Option.isNone(row) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(row.value.id) || seen.has(row.value.id)) {
        diagnostics.push("Malformed or duplicate change omitted")
        return []
      }
      seen.add(row.value.id)
      const item = row.value
      if ((item.status === "archived") !== (query.scope === "archive")) return []
      if (input.changeID ? item.id !== input.changeID : !item.id.toLowerCase().includes(query.search)) return []
      return [item]
    })
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id))
  const runs = data.runs.flatMap((value) => {
    const run = Schema.decodeUnknownOption(RunRow)(value)
    if (Option.isNone(run)) {
      diagnostics.push("Malformed run omitted")
      return []
    }
    return [run.value]
  })
  const partition = <A>(schema: Schema.Decoder<A, never>, value: unknown, label: string) => {
    if (value === undefined) return null
    const decoded = Schema.decodeUnknownOption(schema)(value)
    if (Option.isSome(decoded)) return decoded.value
    diagnostics.push(`Malformed ${label} omitted`)
    return null
  }
  const items = rows.slice(query.offset, query.offset + query.limit).map((row) => ({
    ...row,
    evidence: partition(Foundation.Evidence, data.evidence[row.id], "evidence"),
    budget: partition(Foundation.Budget, data.budgets[row.id], "budget"),
    run: partition(
      Foundation.Run,
      runs.find((run) => run.id === row.id),
      "run",
    ),
  }))
  return {
    generatedAt: data.generatedAt,
    items,
    total: rows.length,
    nextOffset: query.offset + query.limit < rows.length ? query.offset + query.limit : null,
    diagnostics,
  }
}
