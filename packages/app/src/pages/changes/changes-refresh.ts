import { createSignal } from "solid-js"
import { changesFailure, type ChangeRead, type ChangeSelection, type ChangesReader } from "./changes-reader"

export type ChangesState = {
  selection?: ChangeSelection
  data?: ChangeRead
  loading: boolean
  stale: boolean
  error?: string
}

export function createChangesRefresh(
  reader: ChangesReader,
  clock: { every: (callback: () => void, ms: number) => () => void },
  onPageReset?: () => void,
) {
  const [state, setState] = createSignal<ChangesState>({ loading: false, stale: false })
  let generation = 0
  let selection: ChangeSelection | undefined
  let pending: Promise<void> | undefined
  let abort: AbortController | undefined
  let stop: (() => void) | undefined
  let visible = false
  let disposed = false

  function refresh(resetPage = false) {
    if (disposed || !selection) return Promise.resolve()
    if (pending) return pending
    const current = selection
    const token = generation
    const request = new AbortController()
    abort = request
    setState((value) => ({ ...value, loading: true }))
    const work = reader(current, request.signal)
      .then(
        (data) => {
          if (disposed || token !== generation) return
          if (
            resetPage &&
            current.offset &&
            state().data &&
            data.data.generatedAt !== state().data?.data.generatedAt &&
            onPageReset
          ) {
            onPageReset()
            return
          }
          setState({ selection: current, data, loading: false, stale: false })
        },
        (error: unknown) => {
          if (disposed || token !== generation) return
          setState((value) => ({ ...value, loading: false, stale: !!value.data, error: changesFailure(error) }))
        },
      )
      .finally(() => {
        if (token !== generation) return
        pending = undefined
        abort = undefined
      })
    pending = work
    return work
  }
  function select(next: ChangeSelection) {
    if (JSON.stringify(selection) === JSON.stringify(next)) return
    generation++
    abort?.abort()
    pending = undefined
    selection = { ...next }
    setState({ selection, loading: false, stale: false })
    if (visible) void refresh()
  }
  function visibility(value: boolean) {
    if (disposed || visible === value) return
    visible = value
    stop?.()
    stop = undefined
    if (!value) return
    void refresh()
    stop = clock.every(() => void refresh(true), 10_000)
  }
  function dispose() {
    disposed = true
    generation++
    abort?.abort()
    stop?.()
    pending = undefined
  }
  return { state, select, refresh, visibility, focus: () => visible && refresh(true), dispose }
}
