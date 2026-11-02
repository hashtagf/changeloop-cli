import path from "node:path"
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import { foundationFilesPlugin } from "./foundation-files"

const vendor = path.resolve(import.meta.dir, "../../foundation/vendor/claude-foundation")
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporary() {
  const root = await mkdtemp(path.join(tmpdir(), "foundation-files-"))
  roots.push(root)
  return root
}

describe("foundation embedded files plugin", () => {
  test("bundled module exposes the manifest and every payload file as readable paths", async () => {
    const dir = await temporary()
    const entry = path.join(dir, "entry.ts")
    await writeFile(entry, 'export default (await import("virtual:opencode-foundation-files")).default\n')
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: path.join(dir, "out"),
      target: "bun",
      plugins: [await foundationFilesPlugin(vendor)],
    })
    expect(result.success).toBe(true)
    const entryOutput = result.outputs.find((output) => output.kind === "entry-point")!
    const files = (await import(entryOutput.path)).default as Record<string, string>
    const manifest = await Bun.file(path.join(vendor, "manifest.json")).json()

    expect(Object.keys(files).sort()).toEqual(
      ["manifest.json", ...manifest.files.map((file: { path: string }) => `payload/${file.path}`)].sort(),
    )
    for (const file of Object.values(files)) expect(await Bun.file(path.resolve(path.dirname(entryOutput.path), file)).exists()).toBe(true)
    expect(await Bun.file(path.resolve(path.dirname(entryOutput.path), files["manifest.json"])).json()).toEqual(manifest)
  }, 60_000)

  test("payload drift stops the build with a checksum mismatch", async () => {
    const dir = await temporary()
    const copy = path.join(dir, "packages/foundation/vendor/claude-foundation")
    await cp(vendor, copy, { recursive: true })
    const manifest = await Bun.file(path.join(copy, "manifest.json")).json()
    await writeFile(path.join(copy, "payload", manifest.files[0].path), "changed\n")

    await expect(foundationFilesPlugin(copy)).rejects.toThrow("checksum mismatch")
  }, 60_000)
})
