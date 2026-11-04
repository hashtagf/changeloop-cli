import { afterAll, describe, expect, test } from "bun:test"
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const cli = path.join(import.meta.dir, "..")
const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(removeTree))
})

// Runs the real CLI entrypoint with a private HOME/XDG so nothing of the developer's machine is read or written, and a
// PATH that has no claude-foundation so the embedded runtime is the only one that can answer.
async function run(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const home = await temporary("changeloop-foundation-home-")
  // The tsconfig override keeps the JSX settings of this package when the working directory is a user project.
  const tsconfig = `--tsconfig-override=${path.join(cli, "tsconfig.json")}`
  const child = Bun.spawn([process.execPath, "run", tsconfig, path.join(cli, "src/index.ts"), ...args], {
    cwd: options.cwd ?? cli,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: `${await nodeOnlyBin()}:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_DATA_HOME: path.join(home, "data"),
      XDG_CACHE_HOME: path.join(home, "cache"),
      XDG_STATE_HOME: path.join(home, "state"),
      ...options.env,
    },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

const withoutUsage = (text: string) => {
  let inUsage = false
  return text
    .split(/\r?\n/)
    .filter((line) => {
      if (/^[A-Z][A-Z ]+$/.test(line)) inUsage = line === "USAGE"
      return !inUsage
    })
    .join("\n")
}

describe("foundation command registration", () => {
  test("foundation help lists the four subcommands and never says OpenCode", async () => {
    const result = await run(["foundation", "--help"])

    expect(result.exitCode).toBe(0)
    const prose = withoutUsage(result.stdout)
    for (const name of ["status", "init", "doctor", "upgrade"]) expect(prose).toMatch(new RegExp(`^ {2}${name} {2,}\\S`, "m"))
    expect(prose).not.toMatch(/opencode/i)
  })

  test("root help advertises the foundation command", async () => {
    const result = await run(["--help"])

    expect(result.exitCode).toBe(0)
    expect(withoutUsage(result.stdout)).toMatch(/^ {2}foundation {2,}\S/m)
  })

  test.each([["status"], ["init"], ["doctor"], ["upgrade"]])("%s help documents the optional path", async (name) => {
    const result = await run(["foundation", name, "--help"])

    expect(result.exitCode).toBe(0)
    expect(withoutUsage(result.stdout)).toContain("path")
    expect(withoutUsage(result.stdout)).not.toMatch(/opencode/i)
  })
})

// Foundation bootstrap is unsupported on win32 (docs/FOUNDATION_UPDATE.md).
describe.skipIf(process.platform === "win32")("foundation command through the CLI", () => {
  test("status defaults to the current directory, reports missing and writes nothing", async () => {
    const root = await project()
    const before = await listing(root)

    const result = await run(["foundation", "status", "--json"], { cwd: root })

    expect(result.exitCode).toBe(0)
    const state = JSON.parse(result.stdout)
    expect(state.root).toBe(await realpath(root))
    expect(state.installed).toEqual({ state: "missing" })
    expect(state.bundle.release).toMatch(/^v?\d/)
    expect(await listing(root)).toEqual(before)
  }, 60_000)

  test("init without --yes and without a terminal refuses and changes nothing", async () => {
    const root = await project()
    const before = await listing(root)

    const result = await run(["foundation", "init", root])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("--yes")
    expect(await listing(root)).toEqual(before)
  }, 60_000)

  test("init --yes installs with the embedded runtime, then status, doctor and upgrade agree", async () => {
    const root = await project()
    await writeFile(path.join(root, "owned.txt"), "unchanged\n")

    const init = await run(["foundation", "init", "--yes", root])
    const status = await run(["foundation", "status", "--json", root])
    const doctor = await run(["foundation", "doctor", root])
    const installed = await listing(root)
    const refused = await run(["foundation", "upgrade", root])
    const afterRefusal = await listing(root)
    const upgrade = await run(["foundation", "upgrade", "--yes", root])

    expect(init.exitCode).toBe(0)
    expect(init.stdout).toMatch(/Foundation \S+ \(\S+\) is installed/)
    expect(status.exitCode).toBe(0)
    expect(JSON.parse(status.stdout).installed.state).toBe("installed")
    expect(doctor.exitCode).toBe(0)
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr).toContain("--yes")
    expect(afterRefusal).toEqual(installed)
    expect(upgrade.exitCode).toBe(0)
    expect(await readFile(path.join(root, "owned.txt"), "utf8")).toBe("unchanged\n")
    expect((await lstat(path.join(root, ".opencode/commands/change.md"))).isFile()).toBe(true)
    expect((await lstat(path.join(root, ".opencode/plugins/foundation.js"))).isFile()).toBe(true)
    expect((await lstat(path.join(root, ".foundation/adapter-manifests/opencode.txt"))).isFile()).toBe(true)
  }, 180_000)

  test("a symlinked managed folder is refused with exit 1 and nothing is written through it", async () => {
    const root = await project()
    const outside = await temporary("changeloop-foundation-outside-")
    await mkdir(path.join(root, ".opencode"))
    await symlink(outside, path.join(root, ".opencode/commands"), "dir")

    const result = await run(["foundation", "init", "--yes", root])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("symlinked managed path")
    expect(await readdir(outside)).toEqual([])
    expect(await lstat(path.join(root, ".claude")).catch(() => undefined)).toBeUndefined()
  }, 60_000)

  test("a path that is a file or missing fails with exit 1", async () => {
    const root = await project()
    await writeFile(path.join(root, "plain.txt"), "x")

    const file = await run(["foundation", "status", path.join(root, "plain.txt")])
    const missing = await run(["foundation", "init", "--yes", path.join(root, "nope")])

    expect(file.exitCode).toBe(1)
    expect(file.stderr).toContain("not a directory")
    expect(missing.exitCode).toBe(1)
    expect(await lstat(path.join(root, "nope")).catch(() => undefined)).toBeUndefined()
  }, 60_000)
})

// The installer needs node; expose only that executable, never the directory that may hold claude-foundation.
let nodeBin: Promise<string> | undefined
function nodeOnlyBin() {
  return (nodeBin ??= (async () => {
    const node = Bun.which("node")
    if (!node) throw new Error("node is required by the Foundation installer")
    const bin = await temporary("changeloop-foundation-node-")
    await symlink(await realpath(node), path.join(bin, "node"))
    return bin
  })())
}

async function project() {
  const root = await temporary("changeloop-foundation-project-")
  const git = Bun.spawnSync({ cmd: ["git", "init", "-q"], cwd: root })
  if (git.exitCode !== 0) throw new Error("git init failed")
  return root
}

async function temporary(prefix: string) {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), prefix))
  roots.push(root)
  return root
}

// Every path under the project except git metadata, with content hashes for files.
async function listing(root: string) {
  const result: Record<string, string> = {}
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      const relative = path.relative(root, file)
      if (relative === ".git") continue
      if (entry.isDirectory()) {
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
