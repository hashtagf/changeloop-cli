import { expect, test } from "bun:test"
import { OpenCode } from "../src/promise/index"

test("exposes the foundation group with its list, get and capability methods", () => {
  const client = OpenCode.make({ baseUrl: "http://localhost:3000" })
  expect(Object.keys(client)).toContain("foundation")
  expect(typeof client.foundation.list).toBe("function")
  expect(typeof client.foundation.get).toBe("function")
  expect(typeof client.foundation.capability).toBe("function")
})

test("foundation.get requests the encoded change path", async () => {
  const urls: string[] = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input: Request | string | URL) => {
      urls.push(input instanceof Request ? input.url : String(input))
      return new Response(JSON.stringify({ _tag: "FoundationMissingError", data: { code: "not_found", message: "x" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    },
  } as never)
  await client.foundation.get({ changeID: "a/b" }).catch(() => undefined)
  expect(urls[0]).toContain("/experimental/foundation/changes/a%2Fb")
})
