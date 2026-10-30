import { describe, expect, test } from "bun:test"
import type { Foundation } from "@opencode/schema/foundation"
import { createDocumentRefresh, type DocumentTarget } from "./document-refresh"

const item = (id: string, file: string, modifiedAt = "t1", size = 1): Foundation.DocumentMetadata => ({
  id,
  title: file,
  sourcePath: `openspec/changes/alpha/${file}`,
  modifiedAt,
  readAt: "r",
  size,
})

const page = (items: Foundation.DocumentMetadata[]): Foundation.DocumentPage => ({
  items,
  total: items.length,
  nextOffset: null,
  readAt: "r",
  diagnostics: [],
})

const body = (metadata: Foundation.DocumentMetadata): Foundation.Document => ({
  ...metadata,
  sha256: "s",
  text: metadata.id,
  sections: [],
  references: [],
  tasks: [],
  claims: [],
  diagnostics: [],
})

const target: DocumentTarget = { server: "one", directory: "/one", changeID: "alpha", preferred: "proposal.md" }

function harness(items = [item("p", "proposal.md"), item("d", "design.md")]) {
  const reads: DocumentTarget[] = []
  const indexes: { target: DocumentTarget; signal: AbortSignal; resolve: (value: Foundation.DocumentPage) => void }[] =
    []
  let readFailure: unknown
  const callbacks = new Set<() => void>()
  const refresh = createDocumentRefresh(
    {
      index: (selection, signal) =>
        new Promise((resolve) =>
          indexes.push({
            target: selection as DocumentTarget,
            signal,
            resolve: (value) => resolve({ location: { directory: selection.directory } as never, data: value }),
          }),
        ),
      read: async (selection) => {
        reads.push(selection as DocumentTarget)

        if (readFailure) throw readFailure
        const found = items.find((entry) => entry.id === (selection.documentID ?? selection.investigationID))!

        return { location: { directory: selection.directory } as never, data: body(found) }
      },
    },
    {
      every(callback) {
        callbacks.add(callback)

        return () => callbacks.delete(callback)
      },
    },
  )

  return {
    refresh,
    reads,
    indexes,
    callbacks,
    items,
    failRead: (error: unknown) => (readFailure = error),
    answer: async (index = 0, entries = items) => {
      indexes[index].resolve(page(entries))
      await refresh.refresh()
    },
  }
}

describe("Document refresh", () => {
  test("opens the proposal of a change by default and the first file when the preferred file is empty", async () => {
    const h = harness([item("d", "design.md"), item("p", "proposal.md")])
    h.refresh.select({ ...target, preferred: "" })
    h.refresh.visibility(true)
    await h.answer()
    expect(h.refresh.state().document?.id).toBe("p")

    const first = harness([item("d", "design.md"), item("t", "tasks.md")])
    first.refresh.select({ ...target, preferred: "" })
    first.refresh.visibility(true)
    await first.answer()
    expect(first.refresh.state().document?.id).toBe("d")
  })

  test("opens the file asked for and does not read a body again while the index is unchanged", async () => {
    const h = harness()
    h.refresh.select({ ...target, preferred: "design.md" })
    h.refresh.visibility(true)
    await h.answer()
    expect(h.refresh.state().document?.id).toBe("d")
    expect(h.reads).toHaveLength(1)

    h.callbacks.forEach((tick) => tick())
    await h.answer(1)
    expect(h.reads).toHaveLength(1)

    h.callbacks.forEach((tick) => tick())
    await h.answer(2, [item("p", "proposal.md"), item("d", "design.md", "t2", 9)])
    expect(h.reads).toHaveLength(2)
  })

  test("a document that is not in the index is document_not_found while the index stays", async () => {
    const h = harness()
    h.refresh.select({ ...target, id: "missing" })
    h.refresh.visibility(true)
    await h.answer()

    expect(h.refresh.state().bodyError).toBe("document_not_found")
    expect(h.refresh.state().document).toBeUndefined()
    expect(h.refresh.state().page?.items).toHaveLength(2)
  })

  test("a body that cannot be read keeps the index and reports only the body failure", async () => {
    const h = harness()
    h.failRead({ code: "invalid_document" })
    h.refresh.select(target)
    h.refresh.visibility(true)
    await h.answer()

    expect(h.refresh.state().bodyError).toBe("invalid_document")
    expect(h.refresh.state().error).toBeUndefined()
    expect(h.refresh.state().page?.items).toHaveLength(2)
  })

  test("an index that cannot be read is an error, and a later failure keeps the last page as stale", async () => {
    let failing = false
    const refresh = createDocumentRefresh(
      {
        index: async (selection) => {
          if (failing) throw { code: "timeout" }

          return { location: { directory: selection.directory } as never, data: page([item("p", "proposal.md")]) }
        },
        read: async () => ({ location: { directory: "/one" } as never, data: body(item("p", "proposal.md")) }),
      },
      { every: () => () => {} },
    )
    refresh.select(target)
    refresh.visibility(true)
    await refresh.refresh()
    expect(refresh.state().page?.items).toHaveLength(1)
    expect(refresh.state().error).toBeUndefined()

    failing = true
    await refresh.refresh()
    expect(refresh.state().error).toBe("timeout")
    expect(refresh.state().stale).toBe(true)
    expect(refresh.state().page?.items).toHaveLength(1)
    expect(refresh.state().document?.id).toBe("p")
    refresh.dispose()
  })

  test("the answer to a replaced selection is never shown", async () => {
    const h = harness()
    h.refresh.select(target)
    h.refresh.visibility(true)
    const stale = h.refresh.refresh()
    h.refresh.select({ ...target, directory: "/two" })
    expect(h.indexes[0].signal.aborted).toBe(true)
    h.indexes[0].resolve(page(h.items))
    await stale
    expect(h.refresh.state().page).toBeUndefined()
    expect(h.refresh.state().document).toBeUndefined()
  })

  test("polls only while visible and stops on dispose", async () => {
    const h = harness()
    h.refresh.select(target)
    h.refresh.visibility(true)
    expect(h.callbacks.size).toBe(1)
    h.refresh.visibility(false)
    expect(h.callbacks.size).toBe(0)
    h.refresh.visibility(true)
    h.refresh.dispose()
    expect(h.callbacks.size).toBe(0)
  })

  test("a notes target (no change) opens the note by id with the investigation read", async () => {
    const h = harness([item("n1", "note.md")])
    h.refresh.select({ server: "one", directory: "/one", id: "n1" })
    h.refresh.visibility(true)
    await h.answer()

    expect(h.reads[0].investigationID).toBe("n1")
    expect(h.reads[0].documentID).toBeUndefined()
    expect(h.refresh.state().document?.id).toBe("n1")
  })
})
