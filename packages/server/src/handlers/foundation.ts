import { Foundation } from "@opencode-ai/core/foundation"
import { FoundationDocuments } from "@opencode-ai/core/foundation-documents"
import { Location } from "@opencode-ai/core/location"
import {
  FoundationInputError,
  FoundationMissingError,
  FoundationUninitializedError,
  FoundationResponseError,
  FoundationUnavailableError,
  FoundationTimeoutError,
  FoundationDeniedError,
  FoundationDocumentSizeError,
  FoundationDocumentInvalidError,
} from "@opencode-ai/protocol/groups/foundation"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const FoundationHandler = HttpApiBuilder.group(Api, "server.foundation", (handlers) =>
  handlers
    .handle("foundation.investigations", (ctx) => documentResponse((service, directory) => service.index(directory, ctx.query)))
    .handle("foundation.investigation", (ctx) => documentResponse((service, directory) => service.read(directory, ctx.params)))
    .handle("foundation.documents", (ctx) => documentResponse((service, directory) => service.index(directory, { ...ctx.query, ...ctx.params })))
    .handle("foundation.document", (ctx) => documentResponse((service, directory) => service.read(directory, ctx.params)))
    .handle("foundation.capability", () =>
      response(
        read().pipe(
          Effect.map((value) => ({
            available: true,
            code: null,
            runtime: { mode: value.runtime.mode, version: value.runtime.version },
            snapshot: true, investigations: true, documents: true,
          })),
          Effect.catch((error) => Effect.succeed({ available: false, code: error.code, runtime: null, snapshot: false, investigations: true, documents: true })),
        ),
      ),
    )
    .handle("foundation.list", (ctx) =>
      response(
        Effect.gen(function* () {
          yield* checked(() => Foundation.selection(ctx.query))
          const value = yield* read()
          return yield* checked(() => Foundation.project(value.snapshot, ctx.query))
        }).pipe(Effect.mapError(httpError)),
      ),
    )
    .handle("foundation.get", (ctx) =>
      response(
        Effect.gen(function* () {
          const id = yield* checked(() => Foundation.identifier(ctx.params.changeID))
          const value = yield* read()
          const items = yield* checked(() =>
            ["active", "archive"].flatMap((scope) => Foundation.project(value.snapshot, { scope, changeID: id }).items),
          )
          const item = items.find((item) => item.id === id)
          if (!item)
            return yield* Effect.fail(new Foundation.ReadError("not_found", "Change was not found in this project"))
          return item
        }).pipe(Effect.mapError(httpError)),
      ),
    ),
)

function read() {
  return Effect.gen(function* () {
    const foundation = yield* Foundation.Service
    const location = yield* Location.Service
    return yield* foundation.read(location.directory)
  })
}
function documentResponse<A>(operation: (service: FoundationDocuments.Service["Service"], directory: string) => Effect.Effect<A, Foundation.ReadError>) {
  return response(Effect.gen(function* () {
    const documents = yield* FoundationDocuments.Service
    const location = yield* Location.Service
    return yield* operation(documents, location.directory)
  }).pipe(Effect.mapError(httpError)))
}
function checked<A>(f: () => A) {
  return Effect.try({
    try: f,
    catch: (error) =>
      error instanceof Foundation.ReadError
        ? error
        : new Foundation.ReadError("invalid_response", "Foundation response is invalid"),
  })
}
function httpError(error: Foundation.ReadError) {
  const input = { name: "FoundationError" as const, data: { code: error.code, message: error.message } }
  if (error.code === "invalid_input") return new FoundationInputError(input)
  if (error.code === "denied") return new FoundationDeniedError(input)
  if (error.code === "document_too_large") return new FoundationDocumentSizeError(input)
  if (error.code === "invalid_document") return new FoundationDocumentInvalidError(input)
  if (error.code === "document_changed" || error.code === "ambiguous_archive") return new FoundationUninitializedError(input)
  if (error.code === "not_found") return new FoundationMissingError(input)
  if (error.code === "not_initialized") return new FoundationUninitializedError(input)
  if (error.code === "timeout") return new FoundationTimeoutError(input)
  if (error.code === "output_too_large" || error.code === "invalid_response") return new FoundationResponseError(input)
  return new FoundationUnavailableError(input)
}
