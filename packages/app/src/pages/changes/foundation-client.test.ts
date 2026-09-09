import { expect, test } from "bun:test"
import { createChangesReader, foundationFailure } from "./foundation-client"
import { ClientError } from "@opencode-ai/client/foundation"
import { OpenCode } from "@opencode-ai/client/promise"

test("generated additive client preserves session export and scopes requests with auth and cancellation", async () => {
  expect(typeof OpenCode.make({ baseUrl: "http://localhost" }).session.create).toBe("function")
  const requests: Request[] = []
  const transport = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      const detail = new URL(request.url).pathname.endsWith("/alpha")
      return Response.json({
        location: { directory: "/canonical/project" },
        data: detail
          ? {
              id: "alpha",
              status: "building",
              phase: "build",
              updatedAt: null,
              evidence: null,
              budget: null,
              run: null,
            }
          : { generatedAt: "now", items: [], total: 0, nextOffset: null, diagnostics: [] },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const reader = createChangesReader({ url: "http://localhost", password: "test" }, transport)
  const abort = new AbortController()
  const result = await reader(
    { server: "local", directory: "/project", scope: "archive", search: "x & y", offset: 50, changeID: "alpha" },
    abort.signal,
  )
  expect(result.location.directory).toBe("/canonical/project")
  expect(result.detail?.id).toBe("alpha")
  expect(requests).toHaveLength(2)
  expect(requests[0].headers.get("authorization")).toBe(`Basic ${btoa("opencode:test")}`)
  expect(new URL(requests[0].url).searchParams.get("location[directory]")).toBe("/project")
  expect(new URL(requests[0].url).searchParams.get("search")).toBe("x & y")
  expect(new URL(requests[0].url).searchParams.get("offset")).toBe("50")
  abort.abort()
  expect(requests.every((request) => request.signal.aborted)).toBe(true)
})

test("typed read failures distinguish denied, unsupported, malformed, timeout and offline", () => {
  expect(foundationFailure({ _tag: "UnauthorizedError", message: "Unauthorized" })).toEqual({ code: "denied" })
  expect(foundationFailure({ name: "FoundationError", data: { code: "timeout" } })).toEqual({ code: "timeout" })
  expect(foundationFailure(new ClientError("UnexpectedStatus", { cause: { status: 401 } }))).toEqual({ code: "denied" })
  expect(foundationFailure(new ClientError("UnexpectedStatus", { cause: { status: 404 } }))).toEqual({
    code: "unsupported",
  })
  expect(foundationFailure(new ClientError("MalformedResponse"))).toEqual({ code: "invalid_response" })
  expect(foundationFailure(new ClientError("Transport"))).toEqual({ code: "disconnected" })
})

test("declared generated-client 401 responses are reported as denied", async () => {
  const transport = Object.assign(
    async () => Response.json({ _tag: "UnauthorizedError", message: "Unauthorized" }, { status: 401 }),
    { preconnect: fetch.preconnect },
  )
  const reader = createChangesReader({ url: "http://localhost", password: "expired" }, transport)
  await expect(
    reader(
      { server: "local", directory: "/project", scope: "active", search: "", offset: 0 },
      new AbortController().signal,
    ),
  ).rejects.toEqual({ code: "denied" })
})
