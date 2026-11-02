import { describe, expect, test } from "bun:test"
import { Foundation } from "@opencode/core/foundation"

const fail = (f: () => unknown) => {
  try {
    f()
  } catch (error) {
    return error
  }
  throw new Error("expected failure")
}
const code = (f: () => unknown) => {
  const error = fail(f)
  expect(error).toBeInstanceOf(Foundation.ReadError)
  return (error as Foundation.ReadError).code
}

const row = (id: string, status: string, updatedAt: string | null) => ({ id, status, phase: "build", updatedAt })
const envelope = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  generatedAt: "2026-01-01T00:00:00Z",
  changes: [],
  runs: [],
  evidence: {},
  budgets: {},
  diagnostics: { malformedStates: 0 },
  ...overrides,
})

describe("Foundation.selection", () => {
  test("applies defaults", () => {
    expect(Foundation.selection({})).toEqual({ scope: "active", search: "", offset: 0, limit: 50 })
  })

  test("normalizes search", () => {
    expect(Foundation.selection({ search: "  AbC " }).search).toBe("abc")
  })

  test.each([
    { offset: "-1" },
    { offset: "1.5" },
    { offset: "abc" },
    { offset: "99999999999999999999" },
    { limit: "0" },
    { limit: "101" },
    { limit: "x" },
    { scope: "all" },
    { search: "a".repeat(257) },
  ])("rejects %o as invalid_input", (input) => {
    expect(code(() => Foundation.selection(input))).toBe("invalid_input")
  })

  test("accepts boundary values", () => {
    expect(Foundation.selection({ limit: "100", offset: "0", search: "a".repeat(256), scope: "archive" })).toMatchObject(
      { limit: 100, scope: "archive" },
    )
  })
})

describe("Foundation.identifier", () => {
  test("accepts safe ids", () => {
    expect(Foundation.identifier("add-login_2.v1")).toBe("add-login_2.v1")
    expect(Foundation.identifier("a".repeat(128))).toHaveLength(128)
  })

  test.each(["", "../etc", "a/b", "a\\b", ".hidden", "-x", "a b", "a".repeat(129)])("rejects %p", (id) => {
    expect(code(() => Foundation.identifier(id))).toBe("invalid_input")
  })
})

describe("Foundation.project", () => {
  test("rejects an invalid envelope as invalid_response", () => {
    expect(code(() => Foundation.project({ nope: true }))).toBe("invalid_response")
    expect(code(() => Foundation.project(null))).toBe("invalid_response")
  })

  test("rejects an unsupported schema version", () => {
    expect(code(() => Foundation.project(envelope({ schemaVersion: 2 })))).toBe("unsupported")
  })

  test("omits malformed and duplicate rows with diagnostics, newest first", () => {
    const page = Foundation.project(
      envelope({
        changes: [
          row("old", "build", "2026-01-01T00:00:00Z"),
          row("new", "build", "2026-02-01T00:00:00Z"),
          row("new", "build", "2026-03-01T00:00:00Z"),
          { id: "../bad", status: "build", phase: "x", updatedAt: null },
          { nonsense: true },
          row("done", "archived", "2026-04-01T00:00:00Z"),
        ],
        diagnostics: { malformedStates: 2 },
      }),
    )
    expect(page.items.map((item) => item.id)).toEqual(["new", "old"])
    expect(page.total).toBe(2)
    expect(page.nextOffset).toBeNull()
    expect(page.diagnostics).toContain("2 malformed runtime states omitted")
    expect(page.diagnostics.filter((item) => item === "Malformed or duplicate change omitted")).toHaveLength(3)
  })

  test("scope archive returns only archived rows", () => {
    const snapshot = envelope({ changes: [row("a", "build", null), row("b", "archived", null)] })
    expect(Foundation.project(snapshot, { scope: "archive" }).items.map((item) => item.id)).toEqual(["b"])
  })

  test("paginates and reports nextOffset", () => {
    const snapshot = envelope({
      changes: ["a", "b", "c"].map((id, index) => row(id, "build", `2026-01-0${index + 1}T00:00:00Z`)),
    })
    const first = Foundation.project(snapshot, { limit: "2" })
    expect(first.items.map((item) => item.id)).toEqual(["c", "b"])
    expect(first.nextOffset).toBe(2)
    expect(Foundation.project(snapshot, { limit: "2", offset: "2" }).nextOffset).toBeNull()
  })

  test("drops malformed evidence but keeps the row", () => {
    const page = Foundation.project(
      envelope({ changes: [row("a", "build", null)], evidence: { a: { status: 1 } } }),
    )
    expect(page.items[0]?.evidence).toBeNull()
    expect(page.diagnostics).toContain("Malformed evidence omitted")
  })
})
