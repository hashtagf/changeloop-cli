import path from "path"
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "fs/promises"
import { afterEach, describe, expect, test } from "bun:test"
import { FoundationRuntime } from "../../src/plugin/foundation-runtime"
import { resolveFoundationAgentContract, resolveFoundationInstruction } from "../../src/plugin/foundation"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTree))
})

describe("bundled Foundation runtime", () => {
  test("bundled host endpoints work without a PATH Foundation executable", async () => {
    const executable = await FoundationRuntime.command("bundled", {
      allowUntagged: true,
      cache: await temporary("foundation-host-cache-"),
    })

    const instruction = await resolveFoundationInstruction({
      command: "change",
      arguments: "bundle intent",
      directory: import.meta.dir,
      executable,
    })
    const contract = await resolveFoundationAgentContract({ directory: import.meta.dir, executable })

    expect(instruction.ok).toBe(true)
    expect(contract.ok).toBe(true)
  }, 30_000)

  test("materialized command is a release-bound executable shim and prepends only its bin directory", async () => {
    const cache = await temporary("foundation-shim-cache-")
    const command = await FoundationRuntime.command("bundled", { allowUntagged: true, cache })
    const environment = await FoundationRuntime.environment(process.env.PATH, { allowUntagged: true, cache })
    const result = Bun.spawnSync({ cmd: [...command, "help"], cwd: import.meta.dir, env: environment })

    expect(path.basename(command[0])).toBe("claude-foundation")
    expect(path.basename(path.dirname(command[0]))).toBe("bin")
    expect(environment.PATH).toBe(`${path.dirname(command[0])}${path.delimiter}${process.env.PATH}`)
    expect(result.exitCode).toBe(0)
    expect(new TextDecoder().decode(result.stdout)).toContain("OpenSpec-native software-change harness")
  }, 30_000)

  test("tampered execution shim invalidates the content-addressed cache without PATH fallback", async () => {
    const cache = await temporary("foundation-tampered-shim-")
    const runtime = await FoundationRuntime.materialize({ allowUntagged: true, cache })
    await chmod(cache, 0o700)
    await chmod(path.join(runtime, "bin"), 0o700)
    await chmod(path.join(runtime, "bin/claude-foundation"), 0o700)
    await writeFile(path.join(runtime, "bin/claude-foundation"), "#!/bin/sh\nexec claude-foundation \"$@\"\n")
    await chmod(path.join(runtime, "bin/claude-foundation"), 0o500)
    await chmod(path.join(runtime, "bin"), 0o500)
    await chmod(cache, 0o500)

    await expect(FoundationRuntime.command("bundled", { allowUntagged: true, cache })).rejects.toThrow(
      "cache is invalid",
    )
  })

  test("published materialization cannot be replaced between validation and spawn", async () => {
    const cache = await temporary("foundation-locked-cache-")
    const runtime = await FoundationRuntime.materialize({ allowUntagged: true, cache })
    const command = await FoundationRuntime.command("bundled", { allowUntagged: true, cache })
    const moved = `${runtime}-moved`

    await expect(rename(runtime, moved)).rejects.toMatchObject({ code: "EACCES" })
    expect(Bun.spawnSync({ cmd: [...command, "help"], cwd: import.meta.dir }).exitCode).toBe(0)
  })

  test("symlinked cache root is rejected instead of canonicalized", async () => {
    const parent = await temporary("foundation-cache-parent-")
    const target = await temporary("foundation-cache-target-")
    const cache = path.join(parent, "cache")
    await symlink(target, cache, "dir")

    await expect(FoundationRuntime.materialize({ allowUntagged: true, cache })).rejects.toThrow("cache is unsafe")
  })

  test("real release installer initializes and idempotently preserves unrelated project content", async () => {
    const root = await temporary("foundation-install-")
    const cache = await temporary("foundation-cache-")
    await writeFile(path.join(root, "owned.txt"), "unchanged\n")

    const first = await FoundationRuntime.install(root, { allowUntagged: true, cache })
    const second = await FoundationRuntime.install(root, { allowUntagged: true, cache })
    const state = await FoundationRuntime.status(root)
    const health = await FoundationRuntime.doctor(root, "bundled", { allowUntagged: true, cache })

    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(state.installed.state).toBe("installed")
    expect(health.exitCode).toBe(0)
    expect(await readFile(path.join(root, "owned.txt"), "utf8")).toBe("unchanged\n")
    expect(await readFile(path.join(root, ".opencode/commands/change.md"), "utf8")).toBe(
      await readFile(path.join(root, ".claude/commands/change.md"), "utf8"),
    )
    expect(await readFile(path.join(root, ".opencode/plugins/foundation.js"), "utf8")).toBe(
      await readFile(path.join(root, ".claude/harness/adapters/opencode-plugin.js"), "utf8"),
    )
    expect(await readFile(path.join(root, ".foundation/adapter-manifests/opencode.txt"), "utf8")).toContain(
      "project\t.opencode/commands/change.md",
    )
    expect(await FoundationRuntime.hasManagedOpenCodeAdapter(root)).toBe(true)
  }, 30_000)

  test("OpenCode host install preserves user-owned collisions and validates only recorded bundle content", async () => {
    const root = await temporary("foundation-opencode-collision-")
    const cache = await temporary("foundation-opencode-cache-")
    await mkdir(path.join(root, ".opencode/commands"), { recursive: true })
    await writeFile(path.join(root, ".opencode/commands/change.md"), "user command\n")

    const result = await FoundationRuntime.install(root, { allowUntagged: true, cache })
    const manifest = await readFile(path.join(root, ".foundation/adapter-manifests/opencode.txt"), "utf8")

    expect(result.exitCode).toBe(0)
    expect(await readFile(path.join(root, ".opencode/commands/change.md"), "utf8")).toBe("user command\n")
    expect(manifest).not.toContain(".opencode/commands/change.md")
    expect(manifest).toContain(".opencode/commands/build.md")
    expect(await FoundationRuntime.hasManagedOpenCodeAdapter(root)).toBe(true)

    await writeFile(path.join(root, ".opencode/commands/build.md"), "tampered\n")
    expect(await FoundationRuntime.hasManagedOpenCodeAdapter(root)).toBe(false)
  }, 30_000)

  test("checksum mismatch fails before materialized runtime content is accepted", async () => {
    const cache = await temporary("foundation-cache-")
    const files = await bundleFixture("wrong checksum")

    await expect(FoundationRuntime.materialize({ allowUntagged: true, cache, files })).rejects.toThrow(
      "checksum mismatch",
    )
    expect((await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: cache, onlyFiles: true }))).length).toBe(0)
  })

  test("invalid bundle fails before host ownership metadata mutates the project", async () => {
    const root = await temporary("foundation-invalid-install-")
    const cache = await temporary("foundation-invalid-cache-")
    const files = await bundleFixture("wrong checksum")

    await expect(FoundationRuntime.install(root, { allowUntagged: true, cache, files })).rejects.toThrow(
      "checksum mismatch",
    )
    expect(await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, dot: true }))).toEqual([])
  })

  test("symlinked managed destination is rejected without touching its target", async () => {
    const root = await temporary("foundation-target-")
    const outside = await temporary("foundation-outside-")
    await mkdir(path.join(root, ".claude"))
    await symlink(outside, path.join(root, ".claude", "harness"))

    await expect(FoundationRuntime.install(root, { allowUntagged: true })).rejects.toThrow("symlinked managed path")
    expect(await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: outside }))).toEqual([])
  })

  test("status is read-only for a project without Foundation", async () => {
    const root = await temporary("foundation-empty-")

    const state = await FoundationRuntime.status(root)

    expect(state.installed.state).toBe("missing")
    expect(await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, dot: true }))).toEqual([])
  })

  test("unsupported platform is refused before project mutation", async () => {
    const root = await temporary("foundation-win32-")

    const result = await FoundationRuntime.install(root, { allowUntagged: true, platform: "win32" })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("not supported on win32")
    expect(await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, dot: true }))).toEqual([])
  })

  test("release installer rolls back an interrupted mutation and an authorized retry converges", async () => {
    const root = await temporary("foundation-rollback-")
    const source = await temporary("foundation-source-")
    const vendor = path.resolve(import.meta.dir, "../../vendor/claude-foundation/payload")
    await cp(vendor, source, { recursive: true })
    await mkdir(path.join(root, ".claude/harness"), { recursive: true })
    await writeFile(path.join(root, ".claude/harness/README.md"), "prior\n")
    const installer = path.join(source, "install.sh")
    await writeFile(
      installer,
      (await readFile(installer, "utf8")).replace("INSTALL_COMMITTED=yes", "echo injected failure >&2; false"),
    )

    const interrupted = Bun.spawnSync({ cmd: ["bash", installer, root, "--yes"], stdout: "pipe", stderr: "pipe" })
    const prior = await readFile(path.join(root, ".claude/harness/README.md"), "utf8")
    const retry = await FoundationRuntime.install(root, {
      allowUntagged: true,
      cache: await temporary("foundation-retry-cache-"),
    })

    expect(interrupted.exitCode).not.toBe(0)
    expect(prior).toBe("prior\n")
    expect(retry.exitCode).toBe(0)
  }, 30_000)
})

async function temporary(prefix: string) {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", prefix))
  roots.push(root)
  return root
}

async function bundleFixture(sha256: string) {
  const root = await temporary("foundation-fixture-")
  const manifest = {
    schema: 1,
    release: "v1.0.0",
    commit: "a".repeat(40),
    version: "1.0.0",
    tagged: true,
    hostProtocols: { instruction: 1, agentContract: 1 },
    files: [{ path: "cli.sh", sha256, mode: 0o755 }],
  }
  await mkdir(path.join(root, "payload"))
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest))
  await writeFile(path.join(root, "payload/cli.sh"), "#!/bin/sh\n")
  return {
    "manifest.json": path.join(root, "manifest.json"),
    "payload/cli.sh": path.join(root, "payload/cli.sh"),
  }
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
