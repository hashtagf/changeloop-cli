import { describe, expect, test } from "bun:test"
import type { Config, Hooks } from "@opencode-ai/plugin"
import {
  applyFoundationCommands,
  createFoundationWorkflowHooks,
  FOUNDATION_COMMANDS,
  FoundationWorkflowPlugin,
  resolveFoundationInstruction,
} from "../../src/plugin/foundation"

const LOOP = ["investigate", "change", "build", "prove", "land", "changes", "feature", "dev"] as const
const fixtureExecutable = [
  "bun",
  "-e",
  `const args = process.argv.slice(1)
const command = args[2]
const argument = args[args.indexOf("--arguments") + 1]
console.log(JSON.stringify({
  protocol: 1,
  command,
  description: "fixture " + command,
  instruction: "resolved " + command + ": " + argument,
  argumentMode: command === "changes" ? "none" : "required",
  foundationVersion: "fixture",
  additiveField: true,
}))`,
]

describe("foundation templates", () => {
  test("template set covers exactly the eight loop commands", () => {
    expect(Object.keys(FOUNDATION_COMMANDS).toSorted()).toEqual(LOOP.toSorted())
  })

  test("uses one private dispatcher marker per command without project file instructions", () => {
    for (const name of LOOP) {
      expect(FOUNDATION_COMMANDS[name].template.trim()).toBe(`<!-- changeloop:foundation-dispatch:v1:${name} -->`)
      expect(FOUNDATION_COMMANDS[name].template).not.toContain(".claude/commands")
      expect(FOUNDATION_COMMANDS[name].template).not.toContain("workflow body")
    }
  })
})

describe("resolveFoundationInstruction", () => {
  test("accepts additive protocol fields and preserves opaque arguments in one argv value", async () => {
    const result = await resolveFoundationInstruction({
      command: "change",
      arguments: "spaces '$HOME' $(touch nope) `echo nope`",
      directory: import.meta.dir,
      executable: fixtureExecutable,
    })
    expect(result).toEqual({
      ok: true,
      instruction: "resolved change: spaces '$HOME' $(touch nope) `echo nope`",
    })
  })

  test("rejects malformed, mismatched, and oversized responses", async () => {
    const cases = [
      { executable: ["bun", "-e", "console.log('{')"] },
      {
        executable: [
          "bun",
          "-e",
          `console.log(JSON.stringify({protocol:1,command:"build",description:"x",instruction:"x",argumentMode:"required",foundationVersion:"x"}))`,
        ],
      },
      { executable: ["bun", "-e", "console.log('x'.repeat(1024))"], maxOutputBytes: 100 },
    ]
    for (const item of cases) {
      const result = await resolveFoundationInstruction({
        command: "change",
        arguments: "intent",
        directory: import.meta.dir,
        ...item,
      })
      expect(result).toEqual({ ok: false, code: "foundation_response_invalid" })
    }
  })

  test("classifies missing, timed-out, and unsupported CLI boundaries", async () => {
    expect(
      await resolveFoundationInstruction({
        command: "changes",
        arguments: "",
        directory: import.meta.dir,
        executable: ["definitely-not-a-foundation-executable"],
      }),
    ).toEqual({ ok: false, code: "foundation_cli_missing" })
    expect(
      await resolveFoundationInstruction({
        command: "changes",
        arguments: "",
        directory: import.meta.dir,
        executable: ["bun", "-e", "await Bun.sleep(200)"],
        timeoutMs: 10,
      }),
    ).toEqual({ ok: false, code: "foundation_cli_timeout" })
    expect(
      await resolveFoundationInstruction({
        command: "changes",
        arguments: "",
        directory: import.meta.dir,
        executable: ["bun", "-e", "console.error('unknown command'); process.exit(1)"],
      }),
    ).toEqual({ ok: false, code: "foundation_host_api_unsupported" })
  })
})

describe("Foundation workflow hooks", () => {
  test("replaces all eight owned markers with instructions from the CLI boundary", async () => {
    const hooks = createFoundationWorkflowHooks({ directory: import.meta.dir }, { executable: fixtureExecutable })
    const config = {} as Config
    await hooks.config!(config)
    for (const name of LOOP) {
      const output = commandOutput(FOUNDATION_COMMANDS[name].template)
      await hooks["command.execute.before"]!({ command: name, sessionID: "session", arguments: "intent" }, output)
      expect(text(output)).toBe(`resolved ${name}: intent`)
    }
  })

  test("fails closed with upgrade guidance and no project-file fallback", async () => {
    const hooks = createFoundationWorkflowHooks(
      { directory: import.meta.dir },
      { executable: ["bun", "-e", "console.error('old cli'); process.exit(1)"] },
    )
    await hooks.config!({} as Config)
    const output = commandOutput(FOUNDATION_COMMANDS.changes.template)
    await hooks["command.execute.before"]!({ command: "changes", sessionID: "session", arguments: "" }, output)
    expect(text(output)).toContain("foundation_host_api_unsupported")
    expect(text(output)).toContain("Stop here")
    expect(text(output)).toContain("Do not read project command files")
  })

  test("never intercepts a user-defined command with the same name", async () => {
    const hooks = createFoundationWorkflowHooks({ directory: import.meta.dir }, { executable: fixtureExecutable })
    const config = {
      command: { change: { template: "my own change command" } },
    } as unknown as Config
    await hooks.config!(config)
    const output = commandOutput("my own change command")
    await hooks["command.execute.before"]!({ command: "change", sessionID: "session", arguments: "intent" }, output)
    expect(text(output)).toBe("my own change command")
  })

  test("foundation_workflow false disables injection and interception", async () => {
    const hooks = createFoundationWorkflowHooks({ directory: import.meta.dir }, { executable: fixtureExecutable })
    const config = {
      foundation_workflow: false,
      command: { mine: { template: "user command" } },
    } as unknown as Config
    await hooks.config!(config)
    const output = commandOutput(FOUNDATION_COMMANDS.change.template)
    await hooks["command.execute.before"]!({ command: "change", sessionID: "session", arguments: "intent" }, output)
    expect(Object.keys((config as Config & { command: Record<string, unknown> }).command)).toEqual(["mine"])
    expect(text(output)).toBe(FOUNDATION_COMMANDS.change.template)
  })
})

describe("applyFoundationCommands", () => {
  test("injects all eight loop commands into an empty config", () => {
    const config = {} as Config
    applyFoundationCommands(config)
    const commands = (config as Config & { command: Record<string, { template: string; description?: string }> })
      .command
    expect(Object.keys(commands).toSorted()).toEqual(LOOP.toSorted())
    expect(commands.change).toEqual(FOUNDATION_COMMANDS.change)
  })
})

describe("FoundationWorkflowPlugin config hook", () => {
  test("injects the loop commands at boot by default", async () => {
    const config = {} as Config
    const hooks = await FoundationWorkflowPlugin({ directory: import.meta.dir } as never)
    await hooks.config!(config)
    expect(Object.keys((config as Config & { command?: Record<string, unknown> }).command ?? {}).toSorted()).toEqual(
      LOOP.toSorted(),
    )
  })
})

function commandOutput(value: string) {
  return { parts: [{ type: "text", text: value }] } as Parameters<NonNullable<Hooks["command.execute.before"]>>[1]
}

function text(output: ReturnType<typeof commandOutput>) {
  const part = output.parts.find((item) => item.type === "text")
  return part?.type === "text" ? part.text : undefined
}
