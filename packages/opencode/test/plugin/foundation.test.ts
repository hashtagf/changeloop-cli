import path from "path"
import { chmod, lstat, mkdtemp, readFile, readdir, rm } from "fs/promises"
import { afterEach, describe, expect, test } from "bun:test"
import type { Config, Hooks } from "@opencode-ai/plugin"
import {
  applyFoundationCommands,
  createFoundationWorkflowHooks,
  FOUNDATION_COMMANDS,
  FoundationWorkflowPlugin,
  resolveFoundationAgentContract,
  resolveFoundationInstruction,
} from "../../src/plugin/foundation"
import { FoundationRuntime } from "../../src/plugin/foundation-runtime"

const LOOP = ["investigate", "change", "build", "prove", "land", "changes", "feature", "dev"] as const
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTree))
})
const fixtureExecutable = [
  "bun",
  "-e",
  `const args = process.argv.slice(1)
if (args[1] === "agent-contract") {
  console.log(JSON.stringify({
    protocol: 1,
    contract: "fixture agent contract " + process.pid,
    foundationVersion: "fixture",
    additiveField: true,
  }))
  process.exit(0)
}
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

describe("resolveFoundationAgentContract", () => {
  test("accepts the package-owned protocol response and rejects malformed output", async () => {
    const result = await resolveFoundationAgentContract({
      directory: import.meta.dir,
      executable: fixtureExecutable,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.contract).toStartWith("fixture agent contract ")
    expect(
      await resolveFoundationAgentContract({
        directory: import.meta.dir,
        executable: ["bun", "-e", "console.log(JSON.stringify({protocol:1,contract:'',foundationVersion:'x'}))"],
      }),
    ).toEqual({ ok: false, code: "foundation_response_invalid" })
  })
})

describe("Foundation workflow hooks", () => {
  test("explicit PATH mode replaces all eight owned markers with canonical instructions", async () => {
    const hooks = createFoundationWorkflowHooks({ directory: import.meta.dir }, { executable: fixtureExecutable })
    const config = { foundation_runtime: "path" } as unknown as Config
    await hooks.config!(config)
    for (const name of LOOP) {
      const output = commandOutput(FOUNDATION_COMMANDS[name].template)
      await hooks["command.execute.before"]!({ command: name, sessionID: "session", arguments: "intent" }, output)
      expect(text(output)).toBe(`resolved ${name}: intent`)
    }
  })

  test("guides explicit bootstrap before the first bundled workflow command", async () => {
    const hooks = createFoundationWorkflowHooks({ directory: import.meta.dir }, { executable: fixtureExecutable })
    await hooks.config!({} as Config)
    const output = commandOutput(FOUNDATION_COMMANDS.change.template)
    await hooks["command.execute.before"]!({ command: "change", sessionID: "session", arguments: "intent" }, output)
    expect(text(output)).toContain("Ask the user for explicit approval")
    expect(text(output)).toContain("changeloop foundation init --yes")
    expect(text(output)).toContain("resolved change: intent")
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

  test("resolves harness context from Foundation once when Changeloop owns a builtin", async () => {
    const hooks = createFoundationWorkflowHooks({ directory: import.meta.dir }, { executable: fixtureExecutable })
    await hooks.config!({} as Config)
    const first = { system: [] as string[] }
    const second = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({} as never, first)
    await hooks["experimental.chat.system.transform"]!({} as never, second)
    expect(first.system[0]).toStartWith("fixture agent contract ")
    expect(second.system).toEqual(first.system)
  })

  test("fails closed when agent contract resolution is unavailable", async () => {
    const hooks = createFoundationWorkflowHooks(
      { directory: import.meta.dir },
      { executable: ["bun", "-e", "console.error('old cli'); process.exit(1)"] },
    )
    await hooks.config!({} as Config)
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({} as never, output)
    expect(output.system[0]).toContain("foundation_host_api_unsupported")
    expect(output.system[0]).toContain("host agent-contract protocol 1")
    expect(output.system[0]).toContain("Do not read a project file")
    expect(output.system[0]).not.toContain("OpenSpec-native change loop")
  })

  test("omits harness context when builtins are disabled or fully user-owned", async () => {
    const cases = [
      { foundation_workflow: false },
      {
        command: Object.fromEntries(LOOP.map((name) => [name, { template: `user ${name}` }])),
      },
    ]
    for (const config of cases) {
      const hooks = createFoundationWorkflowHooks({ directory: import.meta.dir })
      await hooks.config!(config as unknown as Config)
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]!({} as never, output)
      expect(output.system).toEqual([])
    }
  })

  test("Foundation-managed native OpenCode commands activate the bundled environment", async () => {
    const root = await temporary("foundation-managed-opencode-")
    const cache = await temporary("foundation-managed-cache-")
    expect((await FoundationRuntime.install(root, { allowUntagged: true, cache })).exitCode).toBe(0)
    const hooks = createFoundationWorkflowHooks(
      { directory: root },
      { runtimeOptions: { allowUntagged: true, cache } },
    )
    const config = {
      command: Object.fromEntries(
        await Promise.all(
          LOOP.map(async (name) => [
            name,
            { template: await readFile(path.join(root, `.opencode/commands/${name}.md`), "utf8") },
          ]),
        ),
      ),
    } as unknown as Config

    await hooks.config!(config)
    const environment = { env: {} as Record<string, string> }
    await hooks["shell.env"]!({ cwd: root }, environment)
    const system = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({} as never, system)

    expect(environment.env.PATH?.split(path.delimiter)[0]).toEndWith("/bin")
    expect(system.system[0]).toContain("# Foundation agent contract")
  }, 30_000)

  test("PATH, disabled, and fully user-owned command surfaces receive no bundled environment", async () => {
    const root = await temporary("foundation-inactive-environment-")
    const cases = [
      { options: { runtimeMode: "path" as const }, config: {} },
      { options: {}, config: { foundation_workflow: false } },
      { options: {}, config: { command: Object.fromEntries(LOOP.map((name) => [name, { template: `user ${name}` }])) } },
    ]
    for (const item of cases) {
      const hooks = createFoundationWorkflowHooks({ directory: root }, item.options)
      await hooks.config!(item.config as unknown as Config)
      const environment = { env: {} as Record<string, string> }

      await hooks["shell.env"]!({ cwd: root }, environment)

      expect(environment.env).toEqual({})
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

async function temporary(prefix: string) {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", prefix))
  roots.push(root)
  return root
}

async function removeTree(root: string) {
  await makeWritable(root)
  await rm(root, { recursive: true, force: true })
}

async function makeWritable(file: string): Promise<void> {
  const info = await lstat(file).catch(() => undefined)
  if (!info || info.isSymbolicLink()) return
  await chmod(file, info.isDirectory() ? 0o700 : 0o600)
  if (!info.isDirectory()) return
  await Promise.all((await readdir(file)).map((entry) => makeWritable(path.join(file, entry))))
}
