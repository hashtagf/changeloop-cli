import type { OpenCodeClient } from "@opencode/client/promise"
import { Foundation } from "@opencode/schema/foundation"
import { Option, Schema } from "effect"
import { changesFailureKey, foundationFailureCode, PAGE_SIZE } from "./reader"

export type DocumentSelection = {
  directory: string
  changeID?: string
  documentID?: string
  investigationID?: string
  search?: string
  offset?: number
}

export type DocumentReader = ReturnType<typeof createDocumentReader>

/**
 * Reads the index and the body of saved investigation notes (no `changeID`) or of one change's agreement documents.
 * Every failure is a thrown `{ code }`, and a response that does not decode is `invalid_response`.
 */
export function createDocumentReader(api: OpenCodeClient["foundation"]) {
  const fail = (error: unknown): never => {
    throw { code: foundationFailureCode(error) }
  }

  return {
    async index(selection: DocumentSelection, signal: AbortSignal) {
      const query = {
        location: { directory: selection.directory },
        search: selection.search || undefined,
        offset: String(selection.offset ?? 0),
        limit: String(PAGE_SIZE),
      }
      const result = await (selection.changeID
        ? api.documents({ ...query, changeID: selection.changeID }, { signal })
        : api.investigations(query, { signal })
      ).catch(fail)
      const value = Schema.decodeUnknownOption(Foundation.DocumentPage)(result.data)

      if (Option.isNone(value)) throw { code: "invalid_response" }

      return { location: result.location, data: value.value }
    },
    async read(selection: DocumentSelection, signal: AbortSignal) {
      const location = { directory: selection.directory }
      const result = await (selection.changeID
        ? api.document({ location, changeID: selection.changeID, documentID: selection.documentID ?? "" }, { signal })
        : api.investigation({ location, investigationID: selection.investigationID ?? "" }, { signal })
      ).catch(fail)
      const value = Schema.decodeUnknownOption(Foundation.Document)(result.data)

      if (Option.isNone(value)) throw { code: "invalid_response" }

      return { location: result.location, data: value.value }
    },
  }
}

/** The i18n key of the message for a document failure, with the document-only codes handled here. */
export function documentFailureKey(code: string) {
  switch (code) {
    case "document_too_large":
      return "changes.error.documentTooLarge"
    case "invalid_document":
      return "changes.error.invalidDocument"
    case "document_changed":
      return "changes.error.documentChanged"
    case "ambiguous_archive":
      return "changes.error.ambiguousArchive"
    case "index_limit_exceeded":
      return "changes.error.indexLimit"
    case "document_not_found":
      return "changes.error.documentNotFound"
    default:
      return changesFailureKey(code)
  }
}
