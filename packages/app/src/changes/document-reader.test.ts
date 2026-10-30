import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { createDocumentReader, documentFailureKey } from "./document-reader"

const metadata = {
  id: "d1",
  title: "Proposal",
  sourcePath: "openspec/changes/alpha/proposal.md",
  modifiedAt: "2026-10-29T00:00:00.000Z",
  readAt: "2026-10-29T00:00:01.000Z",
  size: 12,
}

const page = { items: [metadata], total: 1, nextOffset: null, readAt: metadata.readAt, diagnostics: [] }

const body = {
  ...metadata,
  sha256: "abc",
  text: "# Proposal\n",
  sections: [{ id: "line-1", title: "Proposal", line: 1, level: 1 }],
  references: [],
  tasks: [],
  claims: [],
  diagnostics: [],
}

function reader(respond: (request: Request) => Response) {
  const requests: Request[] = []
  const fetch = async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)

    return respond(request)
  }
  const client = OpenCode.make({ baseUrl: "http://localhost", fetch } as never)

  return { read: createDocumentReader(client.foundation), requests }
}

const ok = (data: unknown) => Response.json({ location: { directory: "/project" }, data })

const typed = (tag: string, code: string, status: number) =>
  Response.json({ _tag: tag, data: { code, message: code } }, { status })

const signal = () => new AbortController().signal

describe("Foundation document reader", () => {
  test("reads a change's document index with the paging query", async () => {
    const h = reader(() => ok(page))
    const result = await h.read.index({ directory: "/project", changeID: "alpha", search: "x", offset: 50 }, signal())

    expect(result.data.items.map((item) => item.id)).toEqual(["d1"])

    const url = new URL(h.requests[0].url)
    expect(url.pathname).toBe("/experimental/foundation/changes/alpha/documents")
    expect(url.searchParams.get("location[directory]")).toBe("/project")
    expect(url.searchParams.get("search")).toBe("x")
    expect(url.searchParams.get("offset")).toBe("50")
    expect(url.searchParams.get("limit")).toBe("50")
  })

  test("reads the saved notes index when no change is selected", async () => {
    const h = reader(() => ok(page))
    await h.read.index({ directory: "/project" }, signal())

    expect(new URL(h.requests[0].url).pathname).toBe("/experimental/foundation/investigations")
  })

  test("reads one document of a change and one note by their ids", async () => {
    const h = reader(() => ok(body))
    const document = await h.read.read({ directory: "/project", changeID: "alpha", documentID: "d1" }, signal())
    const note = await h.read.read({ directory: "/project", investigationID: "n1" }, signal())

    expect(document.data.sha256).toBe("abc")
    expect(note.data.text).toBe("# Proposal\n")
    expect(h.requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/experimental/foundation/changes/alpha/documents/d1",
      "/experimental/foundation/investigations/n1",
    ])
  })

  test("an oversized or invalid document reports its own code", async () => {
    const large = reader(() => typed("FoundationDocumentSizeError", "document_too_large", 413))
    await expect(large.read.read({ directory: "/p", changeID: "a", documentID: "d" }, signal())).rejects.toEqual({
      code: "document_too_large",
    })

    const invalid = reader(() => typed("FoundationDocumentInvalidError", "invalid_document", 422))
    await expect(invalid.read.read({ directory: "/p", changeID: "a", documentID: "d" }, signal())).rejects.toEqual({
      code: "invalid_document",
    })
  })

  test("a body that is not a document or an index is invalid_response", async () => {
    const h = reader(() => ok({ nope: true }))

    await expect(h.read.read({ directory: "/p", investigationID: "n" }, signal())).rejects.toEqual({
      code: "invalid_response",
    })
    await expect(h.read.index({ directory: "/p" }, signal())).rejects.toEqual({ code: "invalid_response" })
  })

  test("every document-only code has its own message and the rest use the changes messages", () => {
    const codes = [
      "document_too_large",
      "invalid_document",
      "document_changed",
      "ambiguous_archive",
      "index_limit_exceeded",
      "document_not_found",
    ]

    expect(new Set(codes.map(documentFailureKey)).size).toBe(codes.length)
    expect(documentFailureKey("timeout")).toBe("changes.error.timeout")
    expect(documentFailureKey("unsupported")).toBe("changes.error.unsupported")
  })
})
