import { describe, expect, test } from "bun:test"
import { createDocumentRefresh } from "./document-refresh"
import type { createDocumentReader } from "./document-client"

const note = {
  id: "note",
  title: "Research",
  sourcePath: "openspec/investigations/research.md",
  modifiedAt: "2026-09-09T00:00:00Z",
  readAt: "2026-09-09T00:01:00Z",
  size: 10,
}
const document = {
  ...note,
  text: "# Research",
  sha256: "hash",
  sections: [],
  tasks: [],
  claims: [],
  references: [],
  diagnostics: [],
}
const location = { directory: "/a", project: { id: "a", directory: "/a" } }
const page = { location, data: { items: [note], total: 1, nextOffset: null, readAt: note.readAt, diagnostics: [] } }
const target = { server: "server", directory: "/a", id: "note" }
const clock = { every: () => () => {} }

describe("document refresh provenance", () => {
  test("metadata refresh reuses unchanged open content and reloads changed content", async () => {
    let reads = 0
    let changed = false
    const refresh = createDocumentRefresh(
      {
        index: async () => ({
          ...page,
          data: { ...page.data, items: [{ ...note, modifiedAt: changed ? "later" : note.modifiedAt }] },
        }),
        read: async () => {
          reads++
          return { location, data: { ...document, modifiedAt: changed ? "later" : note.modifiedAt } }
        },
      },
      clock,
    )
    refresh.select(target)
    await refresh.refresh()
    await refresh.refresh()
    expect(reads).toBe(1)
    changed = true
    await refresh.refresh()
    expect(reads).toBe(2)
    expect(refresh.state().document?.modifiedAt).toBe("later")
    refresh.dispose()
  })
  test("late old-project bodies are aborted and cannot replace the selected project", async () => {
    const slow = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof createDocumentReader>["read"]>>>()
    const started = Promise.withResolvers<void>()
    let signal: AbortSignal | undefined
    const refresh = createDocumentRefresh(
      {
        index: async () => page,
        read: async (selection, abort) => {
          if (selection.directory === "/a") {
            signal = abort
            started.resolve()
            return slow.promise
          }
          return {
            location: { directory: "/b", project: { id: "b", directory: "/b" } },
            data: { ...document, title: "Project B" },
          }
        },
      },
      clock,
    )
    refresh.select(target)
    const old = refresh.refresh()
    await started.promise
    refresh.select({ ...target, directory: "/b" })
    expect(refresh.state().document).toBeUndefined()
    expect(signal?.aborted).toBe(true)
    await refresh.refresh()
    slow.resolve({ location, data: document })
    await old
    expect(refresh.state().document?.title).toBe("Project B")
    refresh.dispose()
  })
  test("failure preserves only same-selection stale content; hidden views do not poll", async () => {
    let fail = false
    let calls = 0
    let stopped = 0
    const refresh = createDocumentRefresh(
      {
        index: async () => {
          calls++
          if (fail) throw { code: "denied" }
          return page
        },
        read: async () => ({ location, data: document }),
      },
      {
        every: () => () => {
          stopped++
        },
      },
    )
    refresh.select(target)
    expect(calls).toBe(0)
    refresh.visibility(true)
    await refresh.refresh()
    fail = true
    await refresh.refresh()
    expect(refresh.state().stale).toBe(true)
    expect(refresh.state().document?.text).toBe(document.text)
    refresh.visibility(false)
    expect(stopped).toBe(1)
    const before = calls
    refresh.focus()
    expect(calls).toBe(before)
    refresh.select({ ...target, directory: "/b" })
    expect(refresh.state().document).toBeUndefined()
    refresh.dispose()
  })
})
