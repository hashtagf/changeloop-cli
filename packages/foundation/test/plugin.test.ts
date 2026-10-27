import path from "path"
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { FoundationRuntime } from "../src/foundation-runtime.js"
import { COMMANDS, make, type Options } from "../src/plugin.js"

const roots: string[] = []
const names = Object.keys(COMMANDS)

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }),
  )
})

// The materialized runtime cache is locked read-only.
async function makeWritable(file: string): Promise<void> {
  const info = await lstat(file).catch(() => undefined)
  if (!info || info.isSymbolicLink()) return
  await chmod(file, info.isDirectory() ? 0o700 : 0o600)
  if (!info.isDirectory()) return
  await Promise.all((await readdir(file)).map((entry) => makeWritable(path.join(file, entry))))
}

async function temporary(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(root)
  return root
}

type Fake = { stdout?: string; stderr?: string; exit?: number; sleepMs?: number; responses?: Record<string, unknown> }

// Stand-in for claude-foundation: logs argv as one JSON line per call, then answers from a config file.
const script = `
import { appendFileSync, readFileSync } from "fs"
const [config, log, ...argv] = process.argv.slice(2)
appendFileSync(log, JSON.stringify(argv) + "\\n")
const fake = JSON.parse(readFileSync(config, "utf8"))
if (fake.sleepMs) await new Promise((resolve) => setTimeout(resolve, fake.sleepMs))
const key = argv[1] === "instruction" ? argv[2] : argv[1]
const body = fake.responses && key in fake.responses ? JSON.stringify(fake.responses[key]) : fake.stdout ?? ""
process.stdout.write(body)
process.stderr.write(fake.stderr ?? "")
process.exit(fake.exit ?? 0)
`

async function fixture(fake: Fake) {
  const dir = await temporary("foundation-plugin-")
  const project = path.join(dir, "project")
  await mkdir(project)
  await writeFile(path.join(dir, "fake.ts"), script)
  await writeFile(path.join(dir, "config.json"), JSON.stringify(fake))
  const log = path.join(dir, "calls.log")
  await writeFile(log, "")
  const executable = [process.execPath, path.join(dir, "fake.ts"), path.join(dir, "config.json"), log]
  const calls = async () =>
    (await readFile(log, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
  return { dir, project, executable, calls }
}

function response(command: string, extra: Record<string, unknown> = {}) {
  return {
    protocol: 1,
    command,
    argumentMode: command === "changes" ? "none" : "required",
    description: "desc",
    instruction: `INSTRUCTION ${command}`,
    foundationVersion: "3.6.8",
    ...extra,
  }
}

function responses() {
  return Object.fromEntries([
    ...names.map((name) => [name, response(name)]),
    ["agent-contract", { protocol: 1, contract: "CONTRACT", foundationVersion: "3.6.8" }],
  ])
}

type Definition = { name: string; description?: string; execute: (input: any) => Effect.Effect<void, unknown> }

async function start(directory: string, options: Options, pluginOptions: Record<string, unknown> = {}) {
  const commands = new Map<string, Definition>()
  const shell: Array<(event: any) => Effect.Effect<void>> = []
  const session: Array<(event: any) => Effect.Effect<void>> = []
  const prompts: any[] = []
  const registration = Effect.succeed({ dispose: Effect.void })
  const context = {
    options: pluginOptions,
    location: { directory },
    command: {
      transform: (callback: (editor: { add: (definition: Definition) => void }) => void) => {
        callback({ add: (definition) => commands.set(definition.name, definition) })
        return registration
      },
    },
    shell: { hook: (_name: string, callback: (event: any) => Effect.Effect<void>) => (shell.push(callback), registration) },
    session: {
      hook: (_name: string, callback: (event: any) => Effect.Effect<void>) => (session.push(callback), registration),
      prompt: (input: unknown) => Effect.sync(() => void prompts.push(input)),
    },
  } as unknown as Context
  await Effect.runPromise(Effect.scoped(make(options).effect(context)))
  const run = (name: string, text = "", delivery = "immediate") =>
    Effect.runPromise(
      commands.get(name)!.execute({ sessionID: "ses_1", prompt: { text }, delivery }) as Effect.Effect<void>,
    )
  const trigger = async (hooks: typeof shell, event: unknown) => {
    for (const hook of hooks) await Effect.runPromise(hook(event))
    return event
  }
  return { commands, shell, session, prompts, run, trigger }
}

async function installed(project: string) {
  await mkdir(path.join(project, ".claude/harness"), { recursive: true })
  await writeFile(path.join(project, ".claude/harness/protocol.json"), JSON.stringify({ runtime: "3.6.8", runtimeApi: "42" }))
}

async function bundled(dir: string): Promise<Options> {
  return { runtime: "bundled", runtimeOptions: { allowUntagged: true, cache: path.join(dir, "cache") } }
}

describe("workflow commands", () => {
  test("registers all eight commands with descriptions, hooks included", async () => {
    const { project, executable } = await fixture({ responses: responses() })
    const plugin = await start(project, { executable, runtime: "path" })

    expect([...plugin.commands.keys()].sort()).toEqual([...names].sort())
    expect(names).toHaveLength(8)
    for (const definition of plugin.commands.values()) expect(definition.description?.trim()).toBeTruthy()
    expect(plugin.session).toHaveLength(1)
  })

  test("workflow false registers no commands and no hooks", async () => {
    const { project, executable } = await fixture({ responses: responses() })
    const plugin = await start(project, { executable }, { workflow: false })

    expect(plugin.commands.size).toBe(0)
    expect(plugin.shell).toHaveLength(0)
    expect(plugin.session).toHaveLength(0)
  })

  test("plugin entry options override the base options", async () => {
    const { project, executable } = await fixture({ responses: responses() })
    const plugin = await start(project, { executable }, { runtime: "path" })

    expect(plugin.shell).toHaveLength(0)
    expect(plugin.commands.size).toBe(8)
  })

  test("a user command registered after the plugin wins without resolving Foundation", async () => {
    const { project, executable, calls } = await fixture({ responses: responses() })
    const plugin = await start(project, { executable, runtime: "path" })
    const user = { name: "build", description: "mine", execute: () => Effect.sync(() => void plugin.prompts.push("user")) }
    plugin.commands.set("build", user)

    await plugin.run("build", "x")

    expect(plugin.prompts).toEqual(["user"])
    expect(await calls()).toEqual([])
  })
})

describe("instruction resolution", () => {
  test("passes protocol and arguments verbatim and prompts with the instruction", async () => {
    const { project, executable, calls } = await fixture({ responses: responses() })
    const plugin = await start(project, { executable, runtime: "path" })
    const args = `fix "the bug" --now 'x y'  $HOME`

    await plugin.run("build", args, "queued")

    expect(await calls()).toEqual([["host", "instruction", "build", "--protocol", "1", "--format", "json", "--arguments", args]])
    expect(plugin.prompts).toEqual([{ text: "INSTRUCTION build", sessionID: "ses_1", delivery: "queued" }])
  })

  test("changes requires argumentMode none and other commands reject it", async () => {
    const ok = await fixture({ responses: responses() })
    const accepted = await start(ok.project, { executable: ok.executable, runtime: "path" })
    await accepted.run("changes")
    expect(accepted.prompts[0].text).toBe("INSTRUCTION changes")

    const wrongChanges = await fixture({ responses: { changes: response("changes", { argumentMode: "required" }) } })
    const rejectedChanges = await start(wrongChanges.project, { executable: wrongChanges.executable, runtime: "path" })
    await rejectedChanges.run("changes")
    expect(rejectedChanges.prompts[0].text).toContain("foundation_response_invalid")

    const wrongBuild = await fixture({ responses: { build: response("build", { argumentMode: "none" }) } })
    const rejectedBuild = await start(wrongBuild.project, { executable: wrongBuild.executable, runtime: "path" })
    await rejectedBuild.run("build", "x")
    expect(rejectedBuild.prompts[0].text).toContain("foundation_response_invalid")
  })

  test.each([
    ["wrong protocol", { protocol: 2 }],
    ["wrong command", { command: "land" }],
    ["empty description", { description: " " }],
    ["empty instruction", { instruction: "" }],
    ["missing version", { foundationVersion: undefined }],
  ])("invalid response (%s) becomes foundation_response_invalid", async (_name, extra) => {
    const fake = await fixture({ responses: { build: response("build", extra) } })
    const plugin = await start(fake.project, { executable: fake.executable, runtime: "path" })

    await plugin.run("build", "x")

    expect(plugin.prompts[0].text).toContain("foundation_response_invalid")
  })

  test("non JSON and oversized output become foundation_response_invalid", async () => {
    const garbage = await fixture({ stdout: "not json" })
    const first = await start(garbage.project, { executable: garbage.executable, runtime: "path" })
    await first.run("build", "x")
    expect(first.prompts[0].text).toContain("foundation_response_invalid")

    const large = await fixture({ stdout: "x".repeat(4096) })
    const second = await start(large.project, { executable: large.executable, runtime: "path", maxOutputBytes: 1024 })
    await second.run("build", "x")
    expect(second.prompts[0].text).toContain("foundation_response_invalid")
  })
})

describe("failure instructions", () => {
  test("missing executable reports foundation_cli_missing with an install action", async () => {
    const { project, dir } = await fixture({})
    const explicit = await start(project, { executable: [path.join(dir, "absent")], runtime: "path" })
    await explicit.run("build", "x")
    expect(explicit.prompts[0].text).toContain("foundation_cli_missing")
    expect(explicit.prompts[0].text).toContain("Install claude-foundation")

    const original = process.env.PATH
    process.env.PATH = dir
    try {
      const lookup = await start(project, { runtime: "path" })
      await lookup.run("build", "x")
      expect(lookup.prompts[0].text).toContain("foundation_cli_missing")
    } finally {
      process.env.PATH = original
    }
  })

  test("slow executable reports foundation_cli_timeout", async () => {
    const { project, executable } = await fixture({ responses: responses(), sleepMs: 5_000 })
    const plugin = await start(project, { executable, runtime: "path", timeoutMs: 300 })

    await plugin.run("build", "x")

    expect(plugin.prompts[0].text).toContain("foundation_cli_timeout")
  })

  test("non zero exit reports foundation_host_api_unsupported", async () => {
    const { project, executable } = await fixture({ exit: 2, stderr: "unknown command" })
    const plugin = await start(project, { executable, runtime: "path" })

    await plugin.run("build", "x")

    expect(plugin.prompts[0].text).toContain("foundation_host_api_unsupported")
    expect(plugin.prompts[0].text).toContain("Stop here")
  })

  test("invalid bundle reports foundation_bundle_invalid", async () => {
    const dir = await temporary("foundation-plugin-bundle-")
    const manifest = path.join(dir, "manifest.json")
    await writeFile(manifest, "{}")
    const plugin = await start(dir, {
      runtime: "bundled",
      runtimeOptions: { allowUntagged: true, cache: path.join(dir, "cache"), files: { "manifest.json": manifest } },
    })

    await plugin.run("build", "x")

    expect(plugin.prompts[0].text).toContain("foundation_bundle_invalid")
    expect(plugin.prompts[0].text).toContain("Reinstall this Changeloop release")
  })
})

describe("bootstrap guard", () => {
  test("bundled mode wraps the instruction until Foundation is initialized", async () => {
    const fake = await fixture({ responses: responses() })
    const plugin = await start(fake.project, { ...(await bundled(fake.dir)), executable: fake.executable })

    await plugin.run("build", "x")

    const prompt = plugin.prompts[0].text as string
    expect(prompt.startsWith("Foundation is not initialized in this project.")).toBe(true)
    expect(prompt.endsWith("INSTRUCTION build")).toBe(true)
  })

  test("an installed project gets the bare instruction", async () => {
    const fake = await fixture({ responses: responses() })
    await installed(fake.project)
    const plugin = await start(fake.project, { ...(await bundled(fake.dir)), executable: fake.executable })

    await plugin.run("build", "x")

    expect(plugin.prompts[0].text).toBe("INSTRUCTION build")
  })

  test("path mode never wraps the instruction", async () => {
    const fake = await fixture({ responses: responses() })
    const plugin = await start(fake.project, { executable: fake.executable, runtime: "path" })

    await plugin.run("build", "x")

    expect(plugin.prompts[0].text).toBe("INSTRUCTION build")
  })
})

describe("shell environment", () => {
  test("bundled mode prepends the runtime bin to the existing PATH and keeps other variables", async () => {
    const fake = await fixture({ responses: responses() })
    const options = { ...(await bundled(fake.dir)), executable: fake.executable }
    const plugin = await start(fake.project, options)
    const expected = await FoundationRuntime.environment("/usr/bin:/bin", options.runtimeOptions)

    const event = (await plugin.trigger(plugin.shell, { env: { PATH: "/usr/bin:/bin", KEEP: "1" } })) as {
      env: Record<string, string>
    }

    expect(event.env).toEqual({ PATH: expected.PATH, KEEP: "1" })
    expect(event.env.PATH.endsWith(`${path.delimiter}/usr/bin:/bin`)).toBe(true)
    expect(path.basename(event.env.PATH.split(path.delimiter)[0])).toBe("bin")
  }, 30_000)

  test("path mode leaves the environment alone", async () => {
    const fake = await fixture({ responses: responses() })
    const plugin = await start(fake.project, { executable: fake.executable, runtime: "path" })

    expect(plugin.shell).toHaveLength(0)
  })

  test("materialization failure does not break shell creation", async () => {
    const dir = await temporary("foundation-plugin-env-")
    const manifest = path.join(dir, "manifest.json")
    await writeFile(manifest, "{}")
    const plugin = await start(dir, {
      runtime: "bundled",
      runtimeOptions: { allowUntagged: true, cache: path.join(dir, "cache"), files: { "manifest.json": manifest } },
    })

    const event = (await plugin.trigger(plugin.shell, { env: { PATH: "/usr/bin" } })) as { env: Record<string, string> }

    expect(event.env).toEqual({ PATH: "/usr/bin" })
  })
})

describe("agent contract", () => {
  test("appends the contract last and resolves it once across context hooks", async () => {
    const fake = await fixture({ responses: responses() })
    const plugin = await start(fake.project, { executable: fake.executable, runtime: "path" })
    const first = (await plugin.trigger(plugin.session, { system: [{ type: "text", text: "base" }] })) as {
      system: Array<{ type: string; text: string }>
    }
    const second = (await plugin.trigger(plugin.session, { system: [{ type: "text", text: "base" }] })) as typeof first

    expect(first.system).toEqual([
      { type: "text", text: "base" },
      { type: "text", text: "CONTRACT" },
    ])
    expect(second.system.at(-1)).toEqual({ type: "text", text: "CONTRACT" })
    expect(await fake.calls()).toEqual([["host", "agent-contract", "--protocol", "1", "--format", "json"]])
  })

  test.each([
    ["failing executable", { exit: 1, stderr: "nope" }, "foundation_host_api_unsupported"],
    ["invalid response", { responses: { "agent-contract": { protocol: 1, contract: "", foundationVersion: "3" } } }, "foundation_response_invalid"],
  ] as const)("%s appends an unavailable contract with the code", async (_name, fake, code) => {
    const setup = await fixture(fake as Fake)
    const plugin = await start(setup.project, { executable: setup.executable, runtime: "path" })

    const event = (await plugin.trigger(plugin.session, { system: [] })) as { system: Array<{ text: string }> }

    expect(event.system[0].text).toContain("Foundation agent contract unavailable")
    expect(event.system[0].text).toContain(code)
  })
})
