import { tmpdir } from "os"
import path from "path"
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "fs/promises"
import { afterAll, describe, expect, test } from "bun:test"
import { FoundationCommand } from "../src/foundation-command.js"

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(removeTree))
})

describe("foundation command: status", () => {
  test("a project without a harness reports missing, writes nothing and exits 0", async () => {
    const root = await project()
    const before = await snapshot(root)
    const h = await harness()

    const exitCode = await FoundationCommand.runStatus({ path: root, json: true }, h.dep)

    const state = JSON.parse(h.out[0])
    expect(exitCode).toBe(0)
    expect(state.installed).toEqual({ state: "missing" })
    expect(state.root).toBe(await realpath(root))
    expect(Object.keys(state.bundle).sort()).toEqual(["commit", "hostProtocols", "release", "schema", "tagged", "version"])
    expect(state.bundle.release).toMatch(/^v?\d/)
    expect(await snapshot(root)).toEqual(before)
  })

  test("text output names the bundled version, release and installed state on one line", async () => {
    const root = await project()
    const h = await harness()

    expect(await FoundationCommand.runStatus({ path: root }, h.dep)).toBe(0)

    expect(h.out).toHaveLength(1)
    expect(h.out[0]).toMatch(/^Foundation bundled=\S+ release=\S+ installed=missing$/)
  })

  test("an unreadable protocol.json is invalid and exits 1", async () => {
    const root = await project()
    await mkdir(path.join(root, ".claude/harness"), { recursive: true })
    await writeFile(path.join(root, ".claude/harness/protocol.json"), "{not json")
    const h = await harness()

    const exitCode = await FoundationCommand.runStatus({ path: root, json: true }, h.dep)

    expect(exitCode).toBe(1)
    expect(JSON.parse(h.out[0]).installed).toEqual({ state: "invalid" })
  })

  test("a path that is not a directory fails with the target in the message", async () => {
    const root = await project()
    await writeFile(path.join(root, "plain.txt"), "x")
    const h = await harness()

    expect(await FoundationCommand.runStatus({ path: path.join(root, "plain.txt") }, h.dep)).toBe(1)
    expect(h.err.join("\n")).toContain("not a directory")
    expect(h.out).toEqual([])
  })

  test("a path that does not exist fails and is not created", async () => {
    const root = await project()
    const missing = path.join(root, "missing")
    const h = await harness()

    expect(await FoundationCommand.runStatus({ path: missing }, h.dep)).toBe(1)
    expect(h.err).not.toEqual([])
    expect(await lstat(missing).catch(() => undefined)).toBeUndefined()
  })
})

describe("foundation command: approval", () => {
  test("without --yes and without approval the installer is not called and nothing is written", async () => {
    const root = await project()
    const before = await snapshot(root)
    let installed = false
    const h = await harness({
      confirm: async () => false,
      install: async () => {
        installed = true
        return { exitCode: 0, stdout: "", stderr: "" }
      },
    })

    const result = await FoundationCommand.runMutation({ path: root }, h.dep)

    expect(result).toEqual({ exitCode: 1, cancelled: true })
    expect(installed).toBe(false)
    expect(h.err.join("\n")).toContain("--yes")
    expect(await snapshot(root)).toEqual(before)
  })

  test("an interactive confirmation approves the install", async () => {
    let installed = false
    const h = await harness({
      confirm: async () => true,
      install: async () => {
        installed = true
        return { exitCode: 0, stdout: "", stderr: "" }
      },
      doctor: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    })

    expect(await FoundationCommand.runMutation({ path: await project() }, h.dep)).toEqual({ exitCode: 0, cancelled: false })
    expect(installed).toBe(true)
  })

  test("--yes never asks for confirmation", async () => {
    let asked = false
    const h = await harness({
      confirm: async () => {
        asked = true
        return false
      },
      install: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      doctor: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    })

    await FoundationCommand.runMutation({ path: await project(), yes: true }, h.dep)

    expect(asked).toBe(false)
  })

  test("upgrade without approval leaves an installed project untouched", async () => {
    const root = await project()
    const first = await harness()
    expect((await FoundationCommand.runMutation({ path: root, yes: true }, first.dep)).exitCode).toBe(0)
    const before = await snapshot(root)
    const h = await harness({ confirm: async () => false })

    expect(await FoundationCommand.runMutation({ path: root }, h.dep)).toEqual({ exitCode: 1, cancelled: true })
    expect(await snapshot(root)).toEqual(before)
  }, 120_000)
})

describe("foundation command: init with the bundled installer", () => {
  test("installs into a new project, keeps user files, and reports status and doctor", async () => {
    const root = await project()
    await writeFile(path.join(root, "owned.txt"), "unchanged\n")
    const h = await harness()

    const result = await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)
    const state = await FoundationCommand.runStatus({ path: root, json: true }, h.dep)

    expect(result).toEqual({ exitCode: 0, cancelled: false })
    expect(state).toBe(0)
    expect(JSON.parse(h.out.at(-1)!).installed.state).toBe("installed")
    expect(h.out.some((line) => /^Foundation \S+ \(\S+\) is installed$/.test(line))).toBe(true)
    expect(await readFile(path.join(root, "owned.txt"), "utf8")).toBe("unchanged\n")
    for (const file of [
      ".claude/harness/protocol.json",
      ".opencode/commands/change.md",
      ".opencode/plugins/foundation.js",
      ".foundation/adapter-manifests/opencode.txt",
    ])
      expect((await lstat(path.join(root, file))).isFile()).toBe(true)
    const doctor = await harness()
    expect(await FoundationCommand.runDoctor({ path: root }, doctor.dep)).toBe(0)
    expect(doctor.out.join("\n").length).toBeGreaterThan(0)
  }, 120_000)

  test("does not need claude-foundation on PATH", async () => {
    const root = await project()
    const h = await harness()
    const original = process.env.PATH
    // The installer needs node, so expose only that executable, never the directory that holds claude-foundation.
    process.env.PATH = `${await nodeOnlyBin()}:/usr/bin:/bin`
    try {
      expect(Bun.which("claude-foundation", { PATH: process.env.PATH })).toBeNull()
      expect((await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)).exitCode).toBe(0)
    } finally {
      process.env.PATH = original
    }
    expect((await lstat(path.join(root, ".claude/harness/protocol.json"))).isFile()).toBe(true)
  }, 120_000)

  test("running twice succeeds both times and leaves the adapter files identical", async () => {
    const root = await project()
    await writeFile(path.join(root, "owned.txt"), "unchanged\n")
    const h = await harness()
    // The installer keeps its own bookkeeping (settings backups, install stamps) that may differ per run.
    const adapter = async () =>
      Object.fromEntries(
        Object.entries(await snapshot(root)).filter(
          ([file]) =>
            file === "owned.txt" ||
            [".opencode/", ".claude/commands/", ".claude/harness/", ".foundation/adapter-manifests/"].some((prefix) =>
              file.startsWith(prefix),
            ),
        ),
      )

    expect((await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)).exitCode).toBe(0)
    const first = await adapter()
    expect((await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)).exitCode).toBe(0)

    expect(Object.keys(first).length).toBeGreaterThan(20)
    expect(await adapter()).toEqual(first)
  }, 120_000)

  test("an explicit path wins over the current directory", async () => {
    const root = await project()
    const h = await harness()

    expect((await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)).exitCode).toBe(0)

    expect((await lstat(path.join(root, ".claude/harness/protocol.json"))).isFile()).toBe(true)
    expect(await lstat(path.join(process.cwd(), ".foundation/adapter-manifests/opencode.txt")).catch(() => undefined)).toBeUndefined()
  }, 120_000)

  test("a failing installer returns its exit code, prints stderr and never claims success", async () => {
    const h = await harness({ install: async () => ({ exitCode: 3, stdout: "partial", stderr: "installer broke" }) })

    const result = await FoundationCommand.runMutation({ path: await project(), yes: true }, h.dep)

    expect(result).toEqual({ exitCode: 3, cancelled: false })
    expect(h.out).toEqual(["partial"])
    expect(h.err).toEqual(["installer broke"])
  })

  test("a failing doctor after install returns the doctor exit code", async () => {
    const h = await harness({
      install: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      doctor: async () => ({ exitCode: 5, stdout: "", stderr: "unhealthy" }),
    })

    expect(await FoundationCommand.runMutation({ path: await project(), yes: true }, h.dep)).toEqual({
      exitCode: 5,
      cancelled: false,
    })
    expect(h.err).toEqual(["unhealthy"])
  })
})

describe("foundation command: upgrade converges managed files", () => {
  test("restores a tampered managed command and keeps files outside the manifest", async () => {
    const root = await project()
    const h = await harness()
    expect((await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)).exitCode).toBe(0)
    const canonical = await readFile(path.join(root, ".opencode/commands/build.md"), "utf8")
    await writeFile(path.join(root, ".opencode/commands/build.md"), "tampered\n")
    await writeFile(path.join(root, ".opencode/commands/mine.md"), "my own command\n")
    await writeFile(path.join(root, "notes.txt"), "keep me\n")

    const result = await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)

    expect(result.exitCode).toBe(0)
    expect(await readFile(path.join(root, ".opencode/commands/build.md"), "utf8")).toBe(canonical)
    expect(await readFile(path.join(root, ".opencode/commands/mine.md"), "utf8")).toBe("my own command\n")
    expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("keep me\n")
  }, 120_000)

  test("a user command whose name collides with a Foundation command is kept", async () => {
    const root = await project()
    await mkdir(path.join(root, ".opencode/commands"), { recursive: true })
    await writeFile(path.join(root, ".opencode/commands/change.md"), "user command\n")
    const h = await harness()

    expect((await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)).exitCode).toBe(0)
    expect((await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)).exitCode).toBe(0)

    expect(await readFile(path.join(root, ".opencode/commands/change.md"), "utf8")).toBe("user command\n")
    expect(await readFile(path.join(root, ".foundation/adapter-manifests/opencode.txt"), "utf8")).not.toContain(
      ".opencode/commands/change.md",
    )
  }, 120_000)
})

describe("foundation command: doctor", () => {
  test("forwards a failing exit code and prints stderr", async () => {
    const h = await harness({ doctor: async () => ({ exitCode: 7, stdout: "", stderr: "broken" }) })

    expect(await FoundationCommand.runDoctor({ path: await project() }, h.dep)).toBe(7)
    expect(h.err).toEqual(["broken"])
  })

  test("before init it reports without adding files to the project", async () => {
    const root = await project()
    const before = await snapshot(root)
    const h = await harness()

    const exitCode = await FoundationCommand.runDoctor({ path: root }, h.dep)

    expect(typeof exitCode).toBe("number")
    expect(h.out.length + h.err.length).toBeGreaterThan(0)
    expect(await snapshot(root)).toEqual(before)
  }, 60_000)
})

describe("foundation command: unsafe targets", () => {
  test("a symlinked managed folder is refused, nothing is written through it and the installer is not run", async () => {
    const root = await project()
    const outside = await mkdtemp(path.join(tmpdir(), "foundation-command-outside-"))
    roots.push(outside)
    await mkdir(path.join(root, ".claude"))
    await symlink(outside, path.join(root, ".claude/commands"), "dir")
    const h = await harness()

    const result = await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)

    expect(result).toEqual({ exitCode: 1, cancelled: false })
    expect(h.err.join("\n")).toContain("symlinked managed path")
    expect(await readdir(outside)).toEqual([])
    expect(await lstat(path.join(root, ".claude/harness")).catch(() => undefined)).toBeUndefined()
    expect(await lstat(path.join(root, ".foundation")).catch(() => undefined)).toBeUndefined()
  })

  test("a symlink nested inside a managed folder is refused", async () => {
    const root = await project()
    await mkdir(path.join(root, ".opencode/plugins"), { recursive: true })
    await symlink("/etc", path.join(root, ".opencode/plugins/escape"), "dir")
    const h = await harness()

    expect((await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)).exitCode).toBe(1)
    expect(h.err.join("\n")).toContain("symlinked managed path")
  })

  test("win32 is refused with an explanation and no files", async () => {
    const root = await project()
    const before = await snapshot(root)
    const h = await harness({}, { platform: "win32" })

    const result = await FoundationCommand.runMutation({ path: root, yes: true }, h.dep)

    expect(result).toEqual({ exitCode: 1, cancelled: false })
    expect(h.err.join("\n")).toContain("win32")
    expect(await snapshot(root)).toEqual(before)
  })

  test("a missing path fails before anyone is asked to approve", async () => {
    let asked = false
    const h = await harness({
      confirm: async () => {
        asked = true
        return true
      },
    })

    const result = await FoundationCommand.runMutation({ path: path.join(await project(), "nope") }, h.dep)

    expect(result.exitCode).toBe(1)
    expect(asked).toBe(false)
  })

  test("an embedded runtime that cannot load fails closed with a reinstall message", async () => {
    const h = await harness({}, { load: () => Promise.reject(new Error("boom")) })

    expect(await FoundationCommand.runStatus({ path: await project() }, h.dep)).toBe(1)
    expect(h.err.join("\n")).toContain("Reinstall this Changeloop release")
  })
})

function harness(
  overrides: Partial<FoundationCommand.Dependencies> = {},
  runtime: Partial<FoundationCommand.Options> & { platform?: NodeJS.Platform } = {},
) {
  return cacheDirectory().then((cache) => {
    const out: string[] = []
    const err: string[] = []
    const { platform, ...rest } = runtime
    const dep = {
      ...FoundationCommand.dependencies({
        confirm: async () => false,
        write: (text) => out.push(text),
        error: (text) => err.push(text),
        runtime: { allowUntagged: true, cache, ...(platform ? { platform } : {}) },
        // mock.module in another test file is process-global, so never rely on the real virtual-module import.
        load: () =>
          Promise.reject(Object.assign(new Error("Cannot find module 'virtual:opencode-foundation-files'"), { code: "ERR_MODULE_NOT_FOUND" })),
        ...rest,
      }),
      write: (text: string) => void out.push(text),
      error: (text: string) => void err.push(text),
    }
    return { dep: { ...dep, ...overrides }, out, err }
  })
}

let sharedCache: Promise<string> | undefined
function cacheDirectory() {
  return (sharedCache ??= temporary("foundation-command-cache-"))
}

async function nodeOnlyBin() {
  const node = Bun.which("node")
  if (!node) throw new Error("node is required by the Foundation installer")
  const bin = await temporary("foundation-command-node-")
  await symlink(await realpath(node), path.join(bin, "node"))
  return bin
}

async function project() {
  const root = await temporary("foundation-command-project-")
  const git = Bun.spawnSync({ cmd: ["git", "init", "-q"], cwd: root })
  if (git.exitCode !== 0) throw new Error("git init failed")
  return root
}

async function temporary(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(root)
  return root
}

// Relative path -> content hash (or link target) of everything except the git metadata.
async function snapshot(root: string, skip: string[] = []) {
  const result: Record<string, string> = {}
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      const relative = path.relative(root, file)
      if (relative === ".git" || skip.includes(relative)) continue
      if (entry.isSymbolicLink()) result[relative] = `link:${await readlink(file)}`
      else if (entry.isDirectory()) {
        result[relative] = "dir"
        await walk(file)
      } else result[relative] = new Bun.CryptoHasher("sha256").update(await Bun.file(file).bytes()).digest("hex")
    }
  }
  await walk(root)
  return result
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
