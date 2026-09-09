export type ChangeScope = "active" | "archive"
export type ChangeEvidence = {
  status: string
  recordedStatus: string | null
  freshness: string
  providers: readonly { provider: string; status: string }[]
}
export type ChangeItem = {
  id: string
  title?: string
  status: string
  phase: string
  updatedAt: string | null
  evidenceStatus?: string
  evidence?: ChangeEvidence | null
  budget?: {
    lifetime: { usedRequests: number | null; usedTokens: number | null }
    window: {
      id: string | null
      usedRequests: number | null
      usedTokens: number | null
      targetRequests: number | null
      targetTokens: number | null
    }
  } | null
  run?: { branch?: string | null; operationMs?: Partial<Record<"change" | "build" | "prove" | "land", number>> } | null
}
export type ChangePage = {
  generatedAt: string
  items: readonly ChangeItem[]
  total: number
  nextOffset: number | null
  diagnostics: readonly string[]
}
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

export function changesFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined
  return typeof code === "string" ? code : "disconnected"
}
export function changesFailureText(code: string) {
  const messages: Record<string, string> = {
    unsupported: "Changes are not supported by this server or runtime.",
    not_initialized: "Foundation is not initialized for this project.",
    runtime_unavailable: "The selected Foundation runtime is unavailable.",
    denied: "Access to this project was denied.",
    not_found: "This change is no longer available.",
    timeout: "The project read timed out.",
    output_too_large: "The project snapshot exceeds the supported size.",
    invalid_response: "The runtime returned an invalid snapshot.",
    invalid_input: "This selection is invalid.",
    disconnected: "Unable to connect to this server.",
  }
  return messages[code] ?? "Changes could not be refreshed."
}
