import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Info } from "@opencode/schema/config"

function normalize(input: unknown) {
  const result = ConfigNormalize.normalize(input)
  if (result.type !== "normalized") throw new Error("expected normalized config")
  return result
}

describe("Foundation v1 config keys", () => {
  test("foundation_workflow false becomes a remove operation ahead of user plugins", () => {
    const result = normalize({ foundation_workflow: false, plugins: ["-x"] })

    expect(result.encoded.plugins).toEqual(["-opencode.foundation", "-x"])
    expect(result.diagnostics).toEqual([])
  })

  test("foundation_workflow true becomes an add operation", () => {
    expect(normalize({ foundation_workflow: true }).encoded.plugins).toEqual(["opencode.foundation"])
  })

  test("foundation_runtime becomes add options for the builtin", () => {
    const result = normalize({ foundation_runtime: "path" })

    expect(result.encoded.plugins).toEqual([{ package: "opencode.foundation", options: { runtime: "path" } }])
    expect(result.diagnostics).toEqual([])
  })

  test("both keys and the v1 plugin list keep their order", () => {
    const result = normalize({ foundation_workflow: false, foundation_runtime: "bundled", plugin: ["a"] })

    expect(result.encoded.plugins).toEqual([
      { package: "opencode.foundation", options: { runtime: "bundled" } },
      "-opencode.foundation",
      "a",
    ])
  })

  test("the normalized document decodes as config", () => {
    const info = Schema.decodeUnknownSync(Info, { errors: "all", onExcessProperty: "ignore" })(
      normalize({ foundation_workflow: false, foundation_runtime: "path" }).encoded,
    )

    expect(info.plugins).toEqual([{ package: "opencode.foundation", options: { runtime: "path" } }, "-opencode.foundation"])
  })

  test("invalid values are skipped with a diagnostic and the rest of the config loads", () => {
    const result = normalize({ foundation_workflow: "no", foundation_runtime: "system", username: "kept" })

    expect(result.encoded.plugins).toBeUndefined()
    expect(result.encoded.username).toBe("kept")
    expect(result.diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.path])).toEqual([
      ["invalid", ["foundation_workflow"]],
      ["invalid", ["foundation_runtime"]],
    ])
  })

  test("a config without the keys is unchanged", () => {
    const result = normalize({ username: "kept" })

    expect(result.encoded).toEqual({ username: "kept" })
    expect(result.diagnostics).toEqual([])
    expect(Object.hasOwn(result.encoded, "plugins")).toBe(false)
  })
})
