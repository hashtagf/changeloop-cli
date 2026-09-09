#!/usr/bin/env bun

import path from "path"
import { chmod, copyFile, mkdir, rm, stat } from "fs/promises"

const args = process.argv.slice(2)
const sourceFlag = args.indexOf("--source")
const releaseFlag = args.indexOf("--release")
const allowUntagged = args.includes("--allow-untagged")
if (sourceFlag === -1 || !args[sourceFlag + 1]) {
  throw new Error("usage: sync-foundation.ts --source <checkout> [--release <tag>] [--allow-untagged]")
}

const source = path.resolve(args[sourceFlag + 1])
const vendor = path.resolve(import.meta.dir, "../vendor/claude-foundation")
const commit = git(source, ["rev-parse", "HEAD"])
const requestedRelease = releaseFlag === -1 ? undefined : args[releaseFlag + 1]
const releases = git(source, ["tag", "--points-at", commit])
  .split("\n")
  .filter((item) => /^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(item))
const release = requestedRelease ?? releases[0] ?? `source-${commit.slice(0, 12)}`
const tagged = releases.includes(release)
if (!tagged && !allowUntagged) {
  throw new Error(`Foundation release '${release}' does not tag commit ${commit}`)
}
if (!Bun.file(path.join(source, ".claude/harness/runtime/core/host-agent-contract.mjs")).size) {
  throw new Error("Foundation source lacks host agent-contract protocol 1")
}
if (!(await Bun.file(path.join(source, ".claude/harness/commands.json")).text()).includes('"host agent-contract"')) {
  throw new Error("Foundation command registry lacks host agent-contract protocol 1")
}

const roots = [
  "install.sh",
  "install-opencode.sh",
  "cli.sh",
  "dashboard/client.sh",
  "dashboard/snapshot.mjs",
  "VERSION",
  "foundation.json",
  "WORKFLOW.md",
  ".claude/orchestrator.md",
  ".claude/commands",
  ".claude/harness",
  ".claude/skills",
  ".claude/rules",
  ".claude/hooks",
  ".claude/settings.json",
  "openspec/config.yaml",
  "openspec/repositories.yaml",
  "openspec/schemas",
  ".foundation/.gitignore",
  ".foundation/README.md",
]
const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: source, dot: true, onlyFiles: true })))
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => roots.some((root) => file === root || file.startsWith(`${root}/`)))
  .sort()
if (files.length === 0) throw new Error("Foundation release payload is empty")

await rm(vendor, { recursive: true, force: true })
await Promise.all(
  files.map(async (file) => {
    const destination = path.join(vendor, "payload", file)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(source, file), destination)
    await chmod(destination, (await stat(path.join(source, file))).mode & 0o777)
  }),
)

const entries = await Promise.all(
  files.map(async (file) => ({
    path: file,
    sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(path.join(source, file)).bytes()).digest("hex"),
    mode: (await stat(path.join(source, file))).mode & 0o777,
  })),
)
await Bun.write(
  path.join(vendor, "manifest.json"),
  `${JSON.stringify(
    {
      schema: 1,
      release,
      commit,
      version: (await Bun.file(path.join(source, "VERSION")).text()).trim(),
      tagged,
      hostProtocols: { instruction: 1, agentContract: 1 },
      files: entries,
    },
    null,
    2,
  )}\n`,
)
console.log(`synced Foundation ${release} (${files.length} files) from ${commit}`)

function git(cwd: string, argv: string[]) {
  const process = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...argv], stdout: "pipe", stderr: "pipe" })
  if (process.exitCode !== 0) throw new Error(new TextDecoder().decode(process.stderr).trim())
  return new TextDecoder().decode(process.stdout).trim()
}
