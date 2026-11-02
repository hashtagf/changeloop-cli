import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Info } from "@opencode/schema/config"

function normalize(input: unknown) {
  const result = ConfigNormalize.normalize(input)
  if (result.type !== "normalized") throw new Error("expected normalized config")
  return result
}

const table = {
  tiers: { fast: ["anthropic/claude-haiku-4-5", "google/gemini-2.5-flash"], deep: ["anthropic/claude-opus-4-1"] },
  agents: { plan: "deep", test: "fast", debug: "openai/gpt-5" },
  small_model: "fast",
}

describe("router v1 config key", () => {
  test("a complete table becomes configure-only options for the builtin", () => {
    const result = normalize({ router: table })

    expect(result.encoded.plugins).toEqual([
      { package: "opencode.router", options: { router: table, $configureOnly: true } },
    ])
    expect(result.diagnostics).toEqual([])
  })

  test("malformed entries are skipped with a diagnostic and the rest still applies", () => {
    const result = normalize({
      username: "kept",
      router: {
        tiers: { fast: ["a/b"], broken: "a/b", mixed: ["a/b", 1] },
        agents: { plan: "fast", test: 3 },
        small_model: "fast",
      },
    })

    expect(result.encoded.username).toBe("kept")
    expect(result.encoded.plugins).toEqual([
      {
        package: "opencode.router",
        options: {
          router: { tiers: { fast: ["a/b"] }, agents: { plan: "fast" }, small_model: "fast" },
          $configureOnly: true,
        },
      },
    ])
    expect(result.diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.path])).toEqual([
      ["invalid", ["router", "tiers", "broken"]],
      ["invalid", ["router", "tiers", "mixed"]],
      ["invalid", ["router", "agents", "test"]],
    ])
  })

  test("a router that is not an object is skipped with a diagnostic", () => {
    const result = normalize({ router: "fast", username: "kept" })

    expect(result.encoded.plugins).toBeUndefined()
    expect(result.encoded.username).toBe("kept")
    expect(result.diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.path])).toEqual([["invalid", ["router"]]])
  })

  test("a small_model that is not a string is skipped", () => {
    const result = normalize({ router: { agents: { plan: "a/b" }, small_model: 1 } })

    expect(result.encoded.plugins).toEqual([
      { package: "opencode.router", options: { router: { agents: { plan: "a/b" } }, $configureOnly: true } },
    ])
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([["router", "small_model"]])
  })

  test("user plugin entries follow the router entry and the normalized document decodes as config", () => {
    const result = normalize({ router: table, plugins: ["-opencode.router"] })
    const info = Schema.decodeUnknownSync(Info, { errors: "all", onExcessProperty: "ignore" })(result.encoded)

    expect(info.plugins?.map((plugin) => (typeof plugin === "string" ? plugin : plugin.package))).toEqual([
      "opencode.router",
      "-opencode.router",
    ])
  })

  test("a config without router is unchanged", () => {
    const result = normalize({ username: "kept" })

    expect(result.encoded).toEqual({ username: "kept" })
    expect(result.diagnostics).toEqual([])
    expect(Object.hasOwn(result.encoded, "plugins")).toBe(false)
  })
})
