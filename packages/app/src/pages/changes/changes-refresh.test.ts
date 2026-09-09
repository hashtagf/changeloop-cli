import { describe, expect, test } from "bun:test"
import { createChangesRefresh } from "./changes-refresh"
import type { ChangeRead, ChangeSelection } from "./changes-reader"

const selection: ChangeSelection = { server: "one", directory: "/one", scope: "active", search: "", offset: 0 }
const result = (directory: string): ChangeRead => ({
  location: { directory },
  data: { generatedAt: "2026-09-09", items: [], total: 0, nextOffset: null, diagnostics: [] },
})
function harness() {
  const requests: {
    selection: ChangeSelection
    signal: AbortSignal
    resolve: (value: ChangeRead) => void
    reject: (error: unknown) => void
  }[] = []
  const callbacks = new Set<() => void>()
  const refresh = createChangesRefresh(
    (selection, signal) => new Promise((resolve, reject) => requests.push({ selection, signal, resolve, reject })),
    {
      every(callback, ms) {
        expect(ms).toBe(10_000)
        callbacks.add(callback)
        return () => {
          callbacks.delete(callback)
        }
      },
    },
  )
  refresh.select(selection)
  refresh.visibility(true)
  return { refresh, requests, callbacks }
}

describe("Changes refresh ownership", () => {
  test("a refreshed snapshot resets later pages while an initial page request stays selected", async () => {
    const pages: number[] = []
    let stamp = "first"
    const refresh = createChangesRefresh(
      async (input) => {
        pages.push(input.offset)
        return { ...result(input.directory), data: { ...result(input.directory).data, generatedAt: stamp } }
      },
      { every: () => () => {} },
      () => refresh.select(selection),
    )
    refresh.select({ ...selection, offset: 50 })
    await refresh.refresh()
    expect(refresh.state().selection?.offset).toBe(50)
    stamp = "second"
    await refresh.refresh(true)
    expect(refresh.state().selection?.offset).toBe(0)
    await refresh.refresh()
    expect(pages).toEqual([50, 50, 0])
    refresh.dispose()
  })
  test("late project and server responses cannot replace the current selection", async () => {
    const h = harness()
    const first = h.refresh.refresh()
    h.refresh.select({ ...selection, server: "two", directory: "/two" })
    expect(h.requests[0].signal.aborted).toBe(true)
    const second = h.refresh.refresh()
    h.requests[1].resolve(result("/two"))
    await second
    h.requests[0].resolve(result("/one"))
    await first
    expect(h.refresh.state().data?.location.directory).toBe("/two")
    h.refresh.dispose()
  })
  test("retains stale data only for the same selection and clears it on project switch", async () => {
    const h = harness()
    const first = h.refresh.refresh()
    h.requests[0].resolve(result("/one"))
    await first
    const failed = h.refresh.refresh()
    h.requests[1].reject({ code: "timeout" })
    await failed
    expect(h.refresh.state().stale).toBe(true)
    expect(h.refresh.state().data?.data.generatedAt).toBe("2026-09-09")
    h.refresh.select({ ...selection, directory: "/two" })
    expect(h.refresh.state().data).toBeUndefined()
    const next = h.refresh.refresh()
    h.requests[2].reject({ code: "not_initialized" })
    await next
    expect(h.refresh.state().error).toBe("not_initialized")
    expect(h.refresh.state().stale).toBe(false)
    h.refresh.dispose()
  })
  test("coalesces focus/manual/timer reads and stops hidden polling and cleanup commits", async () => {
    const h = harness()
    const work = h.refresh.refresh()
    expect(h.refresh.refresh()).toBe(work)
    h.refresh.focus()
    h.callbacks.forEach((tick) => tick())
    expect(h.requests).toHaveLength(1)
    h.refresh.visibility(false)
    expect(h.callbacks.size).toBe(0)
    h.refresh.focus()
    expect(h.requests).toHaveLength(1)
    h.refresh.dispose()
    expect(h.requests[0].signal.aborted).toBe(true)
    h.requests[0].resolve(result("/one"))
    await work
    expect(h.refresh.state().data).toBeUndefined()
  })
})
