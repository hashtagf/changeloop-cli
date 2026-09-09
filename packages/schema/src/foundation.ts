export * as Foundation from "./foundation"

import { Schema } from "effect"

export const Evidence = Schema.Struct({
  status: Schema.String,
  recordedStatus: Schema.NullOr(Schema.String),
  freshness: Schema.String,
  providers: Schema.Array(Schema.Struct({ provider: Schema.String, status: Schema.String })),
})
const Count = Schema.NullOr(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)))
export const Budget = Schema.Struct({
  lifetime: Schema.Struct({ usedRequests: Count, usedTokens: Count }),
  window: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    usedRequests: Count,
    usedTokens: Count,
    targetRequests: Count,
    targetTokens: Count,
  }),
})
export const Run = Schema.Struct({
  branch: Schema.optional(Schema.NullOr(Schema.String)),
  operationMs: Schema.optional(
    Schema.Struct({
      change: Schema.optional(Schema.Number),
      build: Schema.optional(Schema.Number),
      prove: Schema.optional(Schema.Number),
      land: Schema.optional(Schema.Number),
    }),
  ),
})
export const Change = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.String,
  phase: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
  evidenceStatus: Schema.optional(Schema.String),
  evidence: Schema.NullOr(Evidence),
  budget: Schema.NullOr(Budget),
  run: Schema.NullOr(Run),
})
export type Change = typeof Change.Type
export const Page = Schema.Struct({
  generatedAt: Schema.String,
  items: Schema.Array(Change),
  total: Schema.Number,
  nextOffset: Schema.NullOr(Schema.Number),
  diagnostics: Schema.Array(Schema.String),
})
export type Page = typeof Page.Type
export const Capability = Schema.Struct({
  available: Schema.Boolean,
  code: Schema.NullOr(Schema.String),
  runtime: Schema.NullOr(Schema.Struct({ mode: Schema.Literals(["bundled", "path"]), version: Schema.String })),
  snapshot: Schema.optional(Schema.Boolean),
  investigations: Schema.optional(Schema.Boolean),
  documents: Schema.optional(Schema.Boolean),
})
export type Capability = typeof Capability.Type
export const ErrorCode = Schema.Literals([
  "invalid_input",
  "not_found",
  "not_initialized",
  "unsupported",
  "timeout",
  "output_too_large",
  "invalid_response",
  "runtime_unavailable",
  "denied",
  "index_limit_exceeded",
  "document_too_large",
  "invalid_document",
  "document_changed",
  "ambiguous_archive",
])
export type ErrorCode = typeof ErrorCode.Type

export const DocumentMetadata = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  sourcePath: Schema.String,
  modifiedAt: Schema.String,
  readAt: Schema.String,
  size: Schema.Number,
})
export type DocumentMetadata = typeof DocumentMetadata.Type
export const DocumentPage = Schema.Struct({
  items: Schema.Array(DocumentMetadata),
  total: Schema.Number,
  nextOffset: Schema.NullOr(Schema.Number),
  readAt: Schema.String,
  diagnostics: Schema.Array(Schema.String),
})
export type DocumentPage = typeof DocumentPage.Type
export const Document = Schema.Struct({
  ...DocumentMetadata.fields,
  sha256: Schema.String,
  text: Schema.String,
  sections: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, line: Schema.Number, level: Schema.Number })),
  references: Schema.Array(Schema.Struct({ changeID: Schema.String, sourcePath: Schema.String })),
  tasks: Schema.Array(Schema.Struct({ text: Schema.String, checked: Schema.Boolean, line: Schema.Number })),
  claims: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
  diagnostics: Schema.Array(Schema.String),
})
export type Document = typeof Document.Type
