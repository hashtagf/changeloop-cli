import path from "path"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { afterEach, describe, expect, test } from "bun:test"
import { createEmbeddedFoundationBundle } from "../../script/foundation-bundle"

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
  const vendor = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "foundation-bundle-"))
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
