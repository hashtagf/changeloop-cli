import path from "path"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises"
import { afterEach, describe, expect, test } from "bun:test"
import { FoundationRuntime } from "../../src/plugin/foundation-runtime"
import { resolveFoundationAgentContract, resolveFoundationInstruction } from "../../src/plugin/foundation"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
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
  }, 30_000)

  test("checksum mismatch fails before materialized runtime content is accepted", async () => {
    const cache = await temporary("foundation-cache-")
    const files = await bundleFixture("wrong checksum")

    await expect(FoundationRuntime.materialize({ allowUntagged: true, cache, files })).rejects.toThrow(
      "checksum mismatch",
    )
    expect((await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: cache, onlyFiles: true }))).length).toBe(0)
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
