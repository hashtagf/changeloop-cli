import { Foundation } from "@opencode-ai/schema/foundation"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const fields = {
  name: Schema.Literal("FoundationError"),
  data: Schema.Struct({ code: Foundation.ErrorCode, message: Schema.String }),
}
export class FoundationInputError extends Schema.ErrorClass<FoundationInputError>("FoundationInputError")(fields, {
  httpApiStatus: 400,
}) {}
export class FoundationMissingError extends Schema.ErrorClass<FoundationMissingError>("FoundationMissingError")(
  fields,
  { httpApiStatus: 404 },
) {}
export class FoundationUninitializedError extends Schema.ErrorClass<FoundationUninitializedError>(
  "FoundationUninitializedError",
)(fields, { httpApiStatus: 409 }) {}
export class FoundationResponseError extends Schema.ErrorClass<FoundationResponseError>("FoundationResponseError")(
  fields,
  { httpApiStatus: 502 },
) {}
export class FoundationUnavailableError extends Schema.ErrorClass<FoundationUnavailableError>(
  "FoundationUnavailableError",
)(fields, { httpApiStatus: 503 }) {}
export class FoundationTimeoutError extends Schema.ErrorClass<FoundationTimeoutError>("FoundationTimeoutError")(
  fields,
  { httpApiStatus: 504 },
) {}
export class FoundationDeniedError extends Schema.ErrorClass<FoundationDeniedError>("FoundationDeniedError")(fields, { httpApiStatus: 403 }) {}
export class FoundationDocumentSizeError extends Schema.ErrorClass<FoundationDocumentSizeError>("FoundationDocumentSizeError")(fields, { httpApiStatus: 413 }) {}
export class FoundationDocumentInvalidError extends Schema.ErrorClass<FoundationDocumentInvalidError>("FoundationDocumentInvalidError")(fields, { httpApiStatus: 422 }) {}
const errors = [
  FoundationInputError,
  FoundationMissingError,
  FoundationUninitializedError,
  FoundationResponseError,
  FoundationUnavailableError,
  FoundationTimeoutError,
  FoundationDeniedError,
  FoundationDocumentSizeError,
  FoundationDocumentInvalidError,
]
const root = "/experimental/foundation"
const pageQuery = Schema.Struct({ ...LocationQuery.fields, search: Schema.optional(Schema.String), offset: Schema.optional(Schema.String), limit: Schema.optional(Schema.String) })
export const FoundationGroup = HttpApiGroup.make("server.foundation")
  .add(HttpApiEndpoint.get("foundation.investigations", `${root}/investigations`, { query: pageQuery, success: Location.response(Foundation.DocumentPage), error: errors }).annotateMerge(locationQueryOpenApi))
  .add(HttpApiEndpoint.get("foundation.investigation", `${root}/investigations/:investigationID`, { params: { investigationID: Schema.String }, query: LocationQuery, success: Location.response(Foundation.Document), error: errors }).annotateMerge(locationQueryOpenApi))
  .add(HttpApiEndpoint.get("foundation.documents", `${root}/changes/:changeID/documents`, { params: { changeID: Schema.String }, query: pageQuery, success: Location.response(Foundation.DocumentPage), error: errors }).annotateMerge(locationQueryOpenApi))
  .add(HttpApiEndpoint.get("foundation.document", `${root}/changes/:changeID/documents/:documentID`, { params: { changeID: Schema.String, documentID: Schema.String }, query: LocationQuery, success: Location.response(Foundation.Document), error: errors }).annotateMerge(locationQueryOpenApi))
  .add(
    HttpApiEndpoint.get("foundation.capability", `${root}/capability`, {
      query: LocationQuery,
      success: Location.response(Foundation.Capability),
      error: errors,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("foundation.list", `${root}/changes`, {
      query: Schema.Struct({
        ...LocationQuery.fields,
        scope: Schema.optional(Schema.String),
        search: Schema.optional(Schema.String),
        offset: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.String),
      }),
      success: Location.response(Foundation.Page),
      error: errors,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("foundation.get", `${root}/changes/:changeID`, {
      params: { changeID: Schema.String },
      query: LocationQuery,
      success: Location.response(Foundation.Change),
      error: errors,
    }).annotateMerge(locationQueryOpenApi),
  )
