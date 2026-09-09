import { Foundation } from "@opencode-ai/schema/foundation"
import { Option, Schema } from "effect"
import type { ServerConnection } from "@/context/server"
import { foundationClient, foundationFailure } from "./foundation-client"

export type DocumentSelection = { directory: string; changeID?: string; documentID?: string; investigationID?: string; search?: string; offset?: number }
export function createDocumentReader(server: ServerConnection.HttpBase, fetch?: typeof globalThis.fetch) {
  const api = foundationClient(server, fetch)
  return {
    async index(selection: DocumentSelection, signal: AbortSignal) {
      const query = { location: { directory: selection.directory }, search: selection.search, offset: String(selection.offset ?? 0), limit: "50" }
      const result = await (selection.changeID ? api.documents({ ...query, changeID: selection.changeID }, { signal }) : api.investigations(query, { signal })).catch((error: unknown) => { throw foundationFailure(error) })
      const value = Schema.decodeUnknownOption(Foundation.DocumentPage)(result.data)
      if (Option.isNone(value)) throw { code: "invalid_response" }
      return { location: result.location, data: value.value }
    },
    async read(selection: DocumentSelection, signal: AbortSignal) {
      const location = { directory: selection.directory }
      const result = await (selection.changeID
        ? api.document({ location, changeID: selection.changeID, documentID: selection.documentID ?? "" }, { signal })
        : api.investigation({ location, investigationID: selection.investigationID ?? "" }, { signal })).catch((error: unknown) => { throw foundationFailure(error) })
      const value = Schema.decodeUnknownOption(Foundation.Document)(result.data)
      if (Option.isNone(value)) throw { code: "invalid_response" }
      return { location: result.location, data: value.value }
    },
  }
}
