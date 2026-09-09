import { expect, test } from "bun:test"
import { createDocumentReader } from "./document-client"

test("actual vendored document consumer sends scoped opaque IDs, auth, pagination and abort signals", async () => {
  const requests: Request[] = []
  const transport = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)
    return Response.json({ location: { directory: "/canonical" }, data: { items: [], total: 0, nextOffset: null, readAt: "now", diagnostics: [] } })
  }, { preconnect: fetch.preconnect })
  const reader = createDocumentReader({ url: "http://localhost", password: "test" }, transport)
  const abort = new AbortController()
  expect((await reader.index({ directory: "/project", changeID: "alpha", offset: 50 }, abort.signal)).location.directory).toBe("/canonical")
  await reader.index({ directory: "/other", search: ".*" }, abort.signal)
  expect(new URL(requests[0].url).pathname).toBe("/experimental/foundation/changes/alpha/documents")
  expect(new URL(requests[1].url).pathname).toBe("/experimental/foundation/investigations")
  expect(new URL(requests[0].url).searchParams.get("location[directory]")).toBe("/project")
  expect(new URL(requests[0].url).searchParams.get("offset")).toBe("50")
  expect(requests[0].headers.get("authorization")).toBe(`Basic ${btoa("opencode:test")}`)
  abort.abort()
  expect(requests.every((request) => request.signal.aborted)).toBe(true)
})
