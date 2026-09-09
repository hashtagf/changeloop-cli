import { OpenCode, ClientError } from "@opencode-ai/client/foundation"
import { Foundation } from "@opencode-ai/schema/foundation"
import { Option, Schema } from "effect"
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import type { ChangesReader } from "./changes-reader"

export function foundationClient(server: ServerConnection.HttpBase, fetch?: typeof globalThis.fetch) {
  return OpenCode.make({
    baseUrl: server.url,
    fetch,
    headers: server.password
      ? { Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}` }
      : undefined,
  }).foundation
}
export function createChangesReader(server: ServerConnection.HttpBase, fetch?: typeof globalThis.fetch): ChangesReader {
  const api = foundationClient(server, fetch)
  return async (selection, signal) => {
    const result = await Promise.all([
      api.list(
        {
          location: { directory: selection.directory },
          scope: selection.scope,
          search: selection.search,
          offset: String(selection.offset),
          limit: "50",
        },
        { signal },
      ),
      selection.changeID
        ? api.get({ location: { directory: selection.directory }, changeID: selection.changeID }, { signal })
        : undefined,
    ]).catch((error: unknown) => {
      throw foundationFailure(error)
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
export function foundationFailure(error: unknown) {
  if (error && typeof error === "object" && "_tag" in error && error._tag === "UnauthorizedError")
    return { code: "denied" }
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "code" in error.data &&
    typeof error.data.code === "string"
  )
    return { code: error.data.code }
  if (error instanceof ClientError) {
    if (error.cause && typeof error.cause === "object" && "status" in error.cause) {
      if (error.cause.status === 401 || error.cause.status === 403) return { code: "denied" }
      if (error.cause.status === 404) return { code: "unsupported" }
    }
    if (error.reason === "MalformedResponse" || error.reason === "UnsupportedContentType")
      return { code: "invalid_response" }
  }
  return { code: "disconnected" }
}
