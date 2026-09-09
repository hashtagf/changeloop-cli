import { createSignal } from "solid-js"
import type { Foundation } from "@opencode-ai/schema/foundation"
import type { createDocumentReader, DocumentSelection } from "./document-client"
import { changesFailure } from "./changes-reader"

export type DocumentTarget = DocumentSelection & { server: string; id?: string; preferred?: string }
export type DocumentState = {
  page?: Foundation.DocumentPage
  document?: Foundation.Document
  loading: boolean
  stale: boolean
  error?: string
  bodyError?: string
}

export function createDocumentRefresh(
  reader: ReturnType<typeof createDocumentReader>,
  clock: { every: (callback: () => void, ms: number) => () => void },
) {
  const [state, setState] = createSignal<DocumentState>({ loading: false, stale: false })
  const cache = new Map<string, Foundation.Document>()
  let target: DocumentTarget | undefined
  let generation = 0
  let request: AbortController | undefined
  let pending: Promise<void> | undefined
  let stop: (() => void) | undefined
  let visible = false
  let disposed = false
  const indexKey = (value: DocumentTarget) =>
    JSON.stringify([value.server, value.directory, value.changeID, value.search, value.offset])
  function refresh() {
    if (disposed || !target) return Promise.resolve()
    if (pending) return pending
    const current = target
    const token = generation
    const abort = new AbortController()
    request = abort
    setState((value) => ({ ...value, loading: true }))
    pending = reader
      .index(current, abort.signal)
      .then(
        async (result) => {
          if (token !== generation || disposed) return
          const selected = current.id
            ? result.data.items.find((item) => item.id === current.id)
            : current.changeID
              ? current.preferred === ""
                ? (result.data.items.find((item) => item.sourcePath.endsWith("/proposal.md")) ?? result.data.items[0])
                : result.data.items.find((item) => item.sourcePath.endsWith(`/${current.preferred ?? "proposal.md"}`))
              : undefined
          setState((value) => ({ ...value, page: result.data, error: undefined, bodyError: undefined, stale: false }))
          if (!selected) {
            setState((value) => ({
              ...value,
              document: undefined,
              bodyError: current.id || current.changeID ? "document_not_found" : undefined,
            }))
            return
          }
          const cached = cache.get(selected.id)
          if (cached && cached.modifiedAt === selected.modifiedAt && cached.size === selected.size) {
            setState((value) => ({ ...value, document: cached }))
            return
          }
          await reader
            .read(
              { ...current, ...(current.changeID ? { documentID: selected.id } : { investigationID: selected.id }) },
              abort.signal,
            )
            .then(
              (body) => {
                if (token !== generation || disposed) return
                cache.set(selected.id, body.data)
                setState((value) => ({ ...value, document: body.data }))
              },
              (error: unknown) => {
                if (token !== generation || disposed) return
                setState((value) => ({ ...value, bodyError: changesFailure(error), stale: !!value.document }))
              },
            )
        },
        (error: unknown) => {
          if (token !== generation || disposed) return
          setState((value) => ({ ...value, error: changesFailure(error), stale: !!value.page || !!value.document }))
        },
      )
      .finally(() => {
        if (token !== generation || disposed) return
        setState((value) => ({ ...value, loading: false }))
        request = undefined
        pending = undefined
      })
    return pending
  }
  function select(next: DocumentTarget) {
    if (JSON.stringify(target) === JSON.stringify(next)) return
    const sameIndex = target && indexKey(target) === indexKey(next)
    if (!sameIndex) cache.clear()
    generation++
    request?.abort()
    pending = undefined
    target = { ...next }
    setState((value) => ({ page: sameIndex ? value.page : undefined, loading: false, stale: false }))
    if (visible) void refresh()
  }
  function visibility(value: boolean) {
    if (disposed || visible === value) return
    visible = value
    stop?.()
    stop = undefined
    if (!value) return
    void refresh()
    stop = clock.every(() => void refresh(), 10_000)
  }
  return {
    state,
    select,
    refresh,
    visibility,
    focus: () => visible && refresh(),
    dispose() {
      disposed = true
      generation++
      request?.abort()
      stop?.()
      cache.clear()
    },
  }
}
