import { ClientError, type OpenCodeClient } from "@opencode/client/promise"
import { Foundation } from "@opencode/schema/foundation"
import { Option, Schema } from "effect"

export type ChangeScope = "active" | "archive"

export type ChangeItem = Foundation.Change

export type ChangePage = Foundation.Page

export type ChangeSelection = {
  server: string
  directory: string
  scope: ChangeScope
  search: string
  offset: number
  changeID?: string
}

export type ChangeRead = {
  location: { directory: string }
  data: ChangePage
  detail?: ChangeItem
}

// The generated-client adapter is injected by the route. No browser transport or
// workflow commands belong in this reader/controller boundary.
export type ChangesReader = (selection: ChangeSelection, signal: AbortSignal) => Promise<ChangeRead>

export const PAGE_SIZE = 50

export function createChangesReader(api: OpenCodeClient["foundation"]): ChangesReader {
  return async (selection, signal) => {
    const location = { directory: selection.directory }
    const result = await Promise.all([
      api.list(
        {
          location,
          scope: selection.scope,
          search: selection.search || undefined,
          offset: String(selection.offset),
          limit: String(PAGE_SIZE),
        },
        { signal },
      ),
      selection.changeID ? api.get({ location, changeID: selection.changeID }, { signal }) : undefined,
    ]).catch((error: unknown) => {
      throw { code: foundationFailureCode(error) }
    })
    if (result[1] && result[0].location.directory !== result[1].location.directory) throw { code: "invalid_response" }
    const page = Schema.decodeUnknownOption(Foundation.Page)(result[0].data)
    const detail = result[1] ? Schema.decodeUnknownOption(Foundation.Change)(result[1].data) : undefined
    if (Option.isNone(page) || (detail && Option.isNone(detail))) throw { code: "invalid_response" }

    return {
      location: result[0].location,
      data: page.value,
      detail: detail && Option.isSome(detail) ? detail.value : undefined,
    }
  }
}

/** Stable failure code for a client error: the server's own code when it sent one, otherwise a transport-level code. */
export function foundationFailureCode(error: unknown) {
  if (error && typeof error === "object" && "_tag" in error && error._tag === "UnauthorizedError") return "denied"

  if (error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object") {
    if ("code" in error.data && typeof error.data.code === "string") return error.data.code
  }

  if (error instanceof ClientError) {
    if (error.cause && typeof error.cause === "object" && "status" in error.cause) {
      if (error.cause.status === 401 || error.cause.status === 403) return "denied"

      // A server that predates Foundation has no such route.
      if (error.cause.status === 404) return "unsupported"
    }

    if (error.reason === "MalformedResponse" || error.reason === "UnsupportedContentType") return "invalid_response"

    return "disconnected"
  }

  // The client throws a declared error body as a plain Error. A server with Foundation always sends a typed code, so a
  // declared body without one comes from a server that does not have the route.
  if (error instanceof Error) return "unsupported"

  return "disconnected"
}

export function changesFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined

  return typeof code === "string" ? code : "disconnected"
}

/** The i18n key of the message for a failure code, falling back to the generic refresh failure. */
export function changesFailureKey(code: string) {
  const keys = {
    unsupported: "changes.error.unsupported",
    not_initialized: "changes.error.notInitialized",
    runtime_unavailable: "changes.error.runtimeUnavailable",
    denied: "changes.error.denied",
    not_found: "changes.error.notFound",
    timeout: "changes.error.timeout",
    output_too_large: "changes.error.outputTooLarge",
    invalid_response: "changes.error.invalidResponse",
    invalid_input: "changes.error.invalidInput",
    disconnected: "changes.error.disconnected",
  } as const

  return (Object.hasOwn(keys, code) ? keys[code as keyof typeof keys] : undefined) ?? "changes.error.generic"
}
