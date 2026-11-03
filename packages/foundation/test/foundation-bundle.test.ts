import { tmpdir } from "os"
import path from "path"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises"
import { afterEach, describe, expect, test } from "bun:test"
import { createEmbeddedFoundationBundle } from "../src/foundation-bundle.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Foundation build bundle", () => {
  test("verified manifest and every payload file are emitted into the compiled-file source", async () => {
    const vendor = await fixture()

    const result = await createEmbeddedFoundationBundle(vendor)

    expect(result.source).toContain('"manifest.json": foundation_0')
    expect(result.source).toContain('"payload/cli.sh": foundation_1')
  })

  test("shipped vendor bundle verifies and includes the OpenCode host installer", async () => {
    const vendor = path.resolve(import.meta.dir, "../vendor/claude-foundation")

    const result = await createEmbeddedFoundationBundle(vendor)

    expect(result.manifest.files).toContainEqual({
      path: "install-opencode.sh",
      sha256: "b93bac292da789f48b3167e86375be7cfb5a83a73d6f80eb6075bf3bd9b99c78",
      mode: 0o755,
    })
    expect(result.source).toContain('"payload/install-opencode.sh"')
  })

  test("shipped vendor bundle is the tagged Foundation 3.6.8 release", async () => {
    const vendor = path.resolve(import.meta.dir, "../vendor/claude-foundation")

    const result = await createEmbeddedFoundationBundle(vendor)
    const protocol = await Bun.file(path.join(vendor, "payload/.claude/harness/protocol.json")).json()

    expect(result.manifest).toMatchObject({
      release: "v3.6.8",
      version: "3.6.8",
      tagged: true,
      commit: "402a2eb7c5784816657cfd00bd4c1f5833e07926",
    })
    expect(await Bun.file(path.join(vendor, "payload/VERSION")).text()).toBe("3.6.8\n")
    expect(protocol).toMatchObject({ runtime: "3.6.8", runtimeApi: "42" })
  })

  test("shipped vendor omits harness tests and fixtures and stays within the scan depth limit", async () => {
    const vendor = path.resolve(import.meta.dir, "../vendor/claude-foundation")
    const root = path.resolve(import.meta.dir, "../../..")
    const manifest = await Bun.file(path.join(vendor, "manifest.json")).json()

    for (const file of manifest.files) {
      expect(file.path.startsWith(".claude/harness/tests/")).toBe(false)
      expect(file.path.startsWith(".claude/harness/fixtures/")).toBe(false)
    }
    const harness = await readdir(path.join(vendor, "payload/.claude/harness"))
    expect(harness).not.toContain("tests")
    expect(harness).not.toContain("fixtures")
    const files = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: vendor, dot: true, onlyFiles: true }))
    const depth = Math.max(
      ...files.map((file) => path.relative(root, path.join(vendor, file)).split(path.sep).length - 1),
    )
    expect(depth).toBeLessThanOrEqual(12)
  })

  test("every shipped payload file matches its manifest checksum on disk", async () => {
    const vendor = path.resolve(import.meta.dir, "../vendor/claude-foundation")
    const manifest = await Bun.file(path.join(vendor, "manifest.json")).json()

    for (const file of manifest.files) {
      const bytes = await Bun.file(path.join(vendor, "payload", file.path)).bytes()
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(file.sha256)
    }
  })

  test("payload drift blocks bundle generation", async () => {
    const vendor = await fixture()
    await writeFile(path.join(vendor, "payload/cli.sh"), "changed\n")

    await expect(createEmbeddedFoundationBundle(vendor)).rejects.toThrow("checksum mismatch")
  })

  test("untagged source blocks release bundle generation", async () => {
    const vendor = await fixture(false)

    await expect(createEmbeddedFoundationBundle(vendor)).rejects.toThrow("tagged release")
  })
})

async function fixture(tagged = true) {
  const vendor = await mkdtemp(path.join(tmpdir(), "foundation-bundle-"))
  roots.push(vendor)
  await mkdir(path.join(vendor, "payload"))
  const body = "#!/bin/sh\n"
  await writeFile(path.join(vendor, "payload/cli.sh"), body)
  await writeFile(
    path.join(vendor, "manifest.json"),
    JSON.stringify({
      schema: 1,
      release: "v1.0.0",
      commit: "a".repeat(40),
      version: "1.0.0",
      tagged,
      hostProtocols: { instruction: 1, agentContract: 1 },
      files: [
        {
          path: "cli.sh",
          sha256: new Bun.CryptoHasher("sha256").update(body).digest("hex"),
          mode: 0o755,
        },
      ],
    }),
  )
  return vendor
}
