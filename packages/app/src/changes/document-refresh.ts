import { createSignal } from "solid-js"
import type { Foundation } from "@opencode/schema/foundation"
import type { DocumentReader, DocumentSelection } from "./document-reader"
import { changesFailure } from "./reader"
import { REFRESH_INTERVAL_MS } from "./refresh"

/** What to read: a note index (no `changeID`) or a change's documents, and which document to open. */
export type DocumentTarget = DocumentSelection & {
  server: string
  /** The document or note to open. */
  id?: string
  /** Without `id`, the file of the change to open: "" for the proposal or the first file, else a file name. */
  preferred?: string
}

export type DocumentState = {
  page?: Foundation.DocumentPage
  document?: Foundation.Document
  loading: boolean
  stale: boolean
  /** The index could not be read. */
  error?: string
  /** The selected document could not be found or read; the index and the snapshot stay usable. */
  bodyError?: string
}

const indexKey = (value: DocumentTarget) =>
  JSON.stringify([value.server, value.directory, value.changeID, value.search, value.offset])

export function createDocumentRefresh(
  reader: Pick<DocumentReader, "index" | "read">,
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

  function choose(current: DocumentTarget, items: Foundation.DocumentPage["items"]) {
    if (current.id) return items.find((item) => item.id === current.id)

    if (!current.changeID) return undefined

    if (current.preferred === "") return items.find((item) => item.sourcePath.endsWith("/proposal.md")) ?? items[0]

    return items.find((item) => item.sourcePath.endsWith(`/${current.preferred ?? "proposal.md"}`))
  }

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
          const selected = choose(current, result.data.items)
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
    stop = clock.every(() => void refresh(), REFRESH_INTERVAL_MS)
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
