import { describe, expect, test } from "bun:test"
import { ModelRouterPlugin } from "@opencode/core/plugin/router"

const table: ModelRouterPlugin.RouterTable = {
  tiers: {
    fast: ["anthropic/claude-haiku-4-5", "google/gemini-2.5-flash"],
    deep: ["anthropic/claude-opus-4-1"],
  },
  agents: {
    plan: "deep",
    test: "fast",
    debug: "openai/gpt-5",
  },
  small_model: "fast",
}

const none = { agentModels: {}, smallModel: undefined }
const { resolveRouting } = ModelRouterPlugin

describe("resolveRouting", () => {
  test("pins the first available candidate per agent and the small-model slot", () => {
    const resolution = resolveRouting(table, none, (provider) => provider === "anthropic")
    expect(resolution.agents).toEqual({
      plan: "anthropic/claude-opus-4-1",
      test: "anthropic/claude-haiku-4-5",
    })
    expect(resolution.smallModel).toBe("anthropic/claude-haiku-4-5")
    expect(resolution.warnings).toHaveLength(1) // debug -> openai unavailable
  })

  test("skips to a later candidate when the first provider is unavailable", () => {
    const resolution = resolveRouting(table, none, (provider) => provider === "google")
    expect(resolution.agents["test"]).toBe("google/gemini-2.5-flash")
    expect(resolution.agents["plan"]).toBeUndefined()
  })

  test("warns and pins nothing when no candidate is available", () => {
    const resolution = resolveRouting(table, none, () => false)
    expect(resolution.agents).toEqual({})
    expect(resolution.smallModel).toBeUndefined()
    expect(resolution.warnings).toHaveLength(4) // plan, test, debug, small_model
  })

  test("never overwrites an existing explicit pin", () => {
    const resolution = resolveRouting(
      table,
      { agentModels: { plan: "openai/gpt-5" }, smallModel: "openai/gpt-5-nano" },
      () => true,
    )
    expect(resolution.agents["plan"]).toBeUndefined()
    expect(resolution.smallModel).toBeUndefined()
  })

  test("treats a tier name without candidates or a bare model id as unresolvable", () => {
    const resolution = resolveRouting({ agents: { plan: "missing-tier" } }, none, () => true)
    expect(resolution.agents).toEqual({})
    expect(resolution.warnings).toHaveLength(1)
  })

  test("asks the availability check for the provider and the model of each candidate", () => {
    const seen: string[] = []
    resolveRouting({ agents: { plan: "p/m/with/slashes" } }, none, (provider, model) => {
      seen.push(`${provider}|${model}`)
      return false
    })
    expect(seen).toEqual(["p|m/with/slashes"])
  })

  test("skips a candidate whose model the provider does not offer", () => {
    const resolution = resolveRouting(
      { tiers: { fast: ["anthropic/unknown", "anthropic/known"] }, agents: { test: "fast" } },
      none,
      (provider, model) => provider === "anthropic" && model === "known",
    )
    expect(resolution.agents["test"]).toBe("anthropic/known")
  })
})

describe("parseTable", () => {
  test("keeps well-formed entries and drops the rest", () => {
    expect(
      ModelRouterPlugin.parseTable({ tiers: { a: ["x/y"], b: 1 }, agents: { plan: "a", test: 2 }, small_model: "a" }),
    ).toEqual({ tiers: { a: ["x/y"] }, agents: { plan: "a" }, small_model: "a" })
  })

  test("returns an empty table for anything that is not an object", () => {
    expect(ModelRouterPlugin.parseTable(undefined)).toEqual({})
    expect(ModelRouterPlugin.parseTable("fast")).toEqual({})
  })
})
