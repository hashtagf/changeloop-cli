import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { changesFailure, changesFailureKey, createChangesReader, type ChangeSelection } from "./reader"

const selection: ChangeSelection = { server: "local", directory: "/project", scope: "archive", search: "x & y", offset: 50 }

const change = {
  id: "alpha",
  title: "Alpha",
  status: "building",
  phase: "build",
  updatedAt: "2026-10-29T00:00:00.000Z",
  evidenceStatus: "unverified",
  evidence: {
    status: "unverified",
    recordedStatus: "pass",
    freshness: "unavailable",
    providers: [{ provider: "test", status: "pass" }],
  },
  budget: null,
  run: null,
}

const page = { generatedAt: "2026-10-29T00:00:00.000Z", items: [change], total: 1, nextOffset: null, diagnostics: [] }

function reader(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = []
  const fetch = async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)

    return respond(request)
  }
  const client = OpenCode.make({ baseUrl: "http://localhost", fetch } as never)

  return { read: createChangesReader(client.foundation), requests }
}

const typed = (tag: string, code: string, status: number) =>
  Response.json({ _tag: tag, data: { code, message: code } }, { status })

const failure = (selection: ChangeSelection, h: ReturnType<typeof reader>) =>
  h.read(selection, new AbortController().signal).then(
    () => undefined,
    (error: unknown) => error,
  )

describe("Foundation changes reader", () => {
  test("reads the list and the selected change for the project location with the paging query", async () => {
    const h = reader((request) =>
      Response.json({
        location: { directory: "/canonical/project" },
        data: new URL(request.url).pathname.endsWith("/alpha") ? change : page,
      }),
    )
    const result = await h.read({ ...selection, changeID: "alpha" }, new AbortController().signal)

    expect(result.location.directory).toBe("/canonical/project")
    expect(result.data.items.map((item) => item.id)).toEqual(["alpha"])
    expect(result.detail?.evidence?.recordedStatus).toBe("pass")
    expect(h.requests).toHaveLength(2)

    const query = new URL(h.requests[0].url).searchParams
    expect(new URL(h.requests[0].url).pathname).toBe("/experimental/foundation/changes")
    expect(query.get("location[directory]")).toBe("/project")
    expect(query.get("scope")).toBe("archive")
    expect(query.get("search")).toBe("x & y")
    expect(query.get("offset")).toBe("50")
    expect(query.get("limit")).toBe("50")
  })

  test("a server that has Foundation but no runtime reports unsupported, never an empty list", async () => {
    const h = reader(() => typed("FoundationUnavailableError", "unsupported", 503))

    expect(await failure(selection, h)).toEqual({ code: "unsupported" })
  })

  test("an uninitialized project reports not_initialized", async () => {
    const h = reader(() => typed("FoundationUninitializedError", "not_initialized", 409))

    expect(await failure(selection, h)).toEqual({ code: "not_initialized" })
  })

  test("a server without the route reports unsupported for a bare 404", async () => {
    const h = reader(() => Response.json({ message: "Not Found" }, { status: 404 }))

    expect(await failure(selection, h)).toEqual({ code: "unsupported" })
  })

  test("rejected credentials report denied and a failed connection reports disconnected", async () => {
    expect(await failure(selection, reader(() => typed("FoundationDeniedError", "denied", 403)))).toEqual({
      code: "denied",
    })
    expect(
      await failure(selection, reader(() => Response.json({ _tag: "UnauthorizedError" }, { status: 401 }))),
    ).toEqual({ code: "denied" })
    expect(
      await failure(
        selection,
        reader(() => {
          throw new TypeError("fetch failed")
        }),
      ),
    ).toEqual({ code: "disconnected" })
  })

  test("a body that is not a Foundation page is invalid_response and yields no partial data", async () => {
    const h = reader(() => Response.json({ location: { directory: "/project" }, data: { items: "nope" } }))

    expect(await failure(selection, h)).toEqual({ code: "invalid_response" })
  })

  test("a list and a change from different locations are not combined", async () => {
    let calls = 0
    const h = reader(() =>
      Response.json({ location: { directory: calls++ ? "/other" : "/project" }, data: calls > 1 ? change : page }),
    )

    expect(await failure({ ...selection, changeID: "alpha" }, h)).toEqual({ code: "invalid_response" })
  })
})

describe("Foundation failure messages", () => {
  test("every server code maps to its own message key and unknown codes fall back to the generic one", () => {
    const codes = [
      "unsupported",
      "not_initialized",
      "runtime_unavailable",
      "denied",
      "not_found",
      "timeout",
      "output_too_large",
      "invalid_response",
      "invalid_input",
      "disconnected",
    ]
    const keys = codes.map(changesFailureKey)

    expect(new Set(keys).size).toBe(codes.length)
    expect(changesFailureKey("document_changed")).toBe("changes.error.generic")
  })

  test("a thrown value without a string code is disconnected", () => {
    expect(changesFailure({ code: "timeout" })).toBe("timeout")
    expect(changesFailure(new Error("x"))).toBe("disconnected")
    expect(changesFailure(undefined)).toBe("disconnected")
  })
})
