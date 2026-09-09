export * as FoundationDocuments from "./foundation-documents"

import { Context, Effect } from "effect"
import { Foundation } from "@opencode-ai/schema/foundation"
import { ReadError, type Selection } from "./foundation"

export type Query = Selection & { changeID?: string; documentID?: string; investigationID?: string }
export class Service extends Context.Service<Service, {
  readonly index: (directory: string, query: Query) => Effect.Effect<Foundation.DocumentPage, ReadError>
  readonly read: (directory: string, query: Query) => Effect.Effect<Foundation.Document, ReadError>
}>()("@opencode/FoundationDocuments") {}
