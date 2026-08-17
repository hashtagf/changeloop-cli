import { describe, expect, test } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import { applyFoundationCommands, FOUNDATION_COMMANDS, FoundationWorkflowPlugin } from "../../src/plugin/foundation"

const LOOP = ["investigate", "change", "build", "prove", "land", "changes", "feature", "dev"]

describe("foundation templates", () => {
  test("template set covers exactly the eight loop commands", () => {
    expect(Object.keys(FOUNDATION_COMMANDS).toSorted()).toEqual(LOOP.toSorted())
  })

  test("every template carries the harness-missing guard and its Foundation source version", () => {
    for (const name of LOOP) {
      const template = FOUNDATION_COMMANDS[name]!.template
      expect(template).toContain("claude-foundation 3.2.27")
      expect(template).toContain(".claude/harness/foundation.mjs")
      expect(template).toContain("DEVELOPER-SETUP.md")
    }
  })

  test("argument-taking templates keep their $ARGUMENTS hint", () => {
    for (const name of LOOP.filter((command) => command !== "changes")) {
      expect(FOUNDATION_COMMANDS[name]!.template).toContain("$ARGUMENTS")
    }
  })
})

describe("applyFoundationCommands", () => {
  test("injects all eight loop commands into an empty config", () => {
    const config = {} as Config
    applyFoundationCommands(config)
    const commands = (config as Config & { command: Record<string, { template: string; description?: string }> })
      .command
    expect(Object.keys(commands).toSorted()).toEqual(LOOP.toSorted())
    expect(commands["change"]!.template).toBe(FOUNDATION_COMMANDS["change"]!.template)
    expect(commands["change"]!.description).toBe(FOUNDATION_COMMANDS["change"]!.description)
  })

  test("never overwrites a user-defined command with the same name", () => {
    const config = {
      command: { change: { template: "my own change command" } },
    } as unknown as Config & { command: Record<string, { template: string }> }
    applyFoundationCommands(config)
    expect(config.command["change"]!.template).toBe("my own change command")
    expect(Object.keys(config.command).toSorted()).toEqual(LOOP.toSorted())
  })

  test("foundation_workflow: false disables injection entirely and leaves other commands alone", () => {
    const config = {
      foundation_workflow: false,
      command: { mine: { template: "user command" } },
    } as unknown as Config & { foundation_workflow: boolean; command: Record<string, { template: string }> }
    applyFoundationCommands(config)
    expect(Object.keys(config.command)).toEqual(["mine"])
  })
})

describe("FoundationWorkflowPlugin config hook", () => {
  const hook = async (config: Config) => {
    const hooks = await FoundationWorkflowPlugin({} as never)
    await hooks.config!(config)
    return config
  }

  test("injects the loop commands at boot by default", async () => {
    const config = {} as Config
    await hook(config)
    const cfg = config as Config & { command?: Record<string, { template: string }> }
    expect(Object.keys(cfg.command ?? {}).toSorted()).toEqual(LOOP.toSorted())
  })

  test("respects the opt-out field", async () => {
    const config = { foundation_workflow: false } as unknown as Config
    await hook(config)
    const cfg = config as Config & { command?: Record<string, unknown> }
    expect(cfg.command).toBeUndefined()
  })
})
