import { expect, test } from "bun:test"
import path from "path"
import { mkdir, rm, symlink, utimes } from "fs/promises"
import { FoundationDocumentReader } from "../src/foundation-document-reader"
import { tmpdir } from "./fixture/tmpdir"

async function write(root: string, source: string, text: string | Uint8Array) {
  await mkdir(path.dirname(path.join(root, source)), { recursive: true })
  await Bun.write(path.join(root, source), text)
}
async function files(root: string) {
  return (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: false }))).sort()
}

test("investigations are indexed and read before any runtime exists without creating project files", async () => {
  await using tmp = await tmpdir()
  expect((await FoundationDocumentReader.index(tmp.path)).total).toBe(0)
  for (const [name, text] of Object.entries({
    first: "# Actual heading\n\n## Evidence\nOriginal text",
    fallback: "Unstructured note",
    fenced: "```md\n# Not a title\n```\n# Real title",
    empty: "",
  }))
    await write(tmp.path, `openspec/investigations/${name}.md`, text)
  const before = await files(tmp.path)
  const listed = await FoundationDocumentReader.index(tmp.path)
  expect(listed.total).toBe(4)
  const titles = listed.items.map((item) => item.title)
  expect(titles).toContain("Real title")
  expect(titles).toContain("fallback")
  const item = listed.items.find((item) => item.title === "Actual heading")!
  const read = await FoundationDocumentReader.read(tmp.path, { investigationID: item.id })
  expect(read.sections.map((section) => section.title)).toEqual(["Actual heading", "Evidence"])
  expect(read.sha256).toBe(new Bun.CryptoHasher("sha256").update(read.text).digest("hex"))
  expect(read.references).toEqual([])
  expect(await files(tmp.path)).toEqual(before)
  expect(await Bun.file(path.join(tmp.path, ".claude/harness/protocol.json")).exists()).toBe(false)
})

test("change documents follow the allowed order and exclude other files", async () => {
  await using tmp = await tmpdir()
  const base = "openspec/changes/alpha"
  await write(tmp.path, `${base}/proposal.md`, "# Alpha\n")
  await write(tmp.path, `${base}/tasks.md`, "- [x] Implement\n- [ ] Prove\n```md\n- [x] Not a task\n```")
  await write(tmp.path, `${base}/evidence.yaml`, "claims:\n  - id: explicit\n    description: Declared obligation\n")
  await write(tmp.path, `${base}/specs/read/spec.md`, "# Reader")
  await write(tmp.path, `${base}/secret.txt`, "not public")
  const documents = await FoundationDocumentReader.index(tmp.path, { changeID: "alpha" })
  expect(documents.items.map((item) => path.basename(item.sourcePath))).toEqual([
    "proposal.md",
    "tasks.md",
    "evidence.yaml",
    "spec.md",
  ])
  const tasks = await FoundationDocumentReader.read(tmp.path, { changeID: "alpha", documentID: documents.items[1].id })
  expect(tasks.tasks.map((item) => item.checked)).toEqual([true, false])
  const evidence = await FoundationDocumentReader.read(tmp.path, { changeID: "alpha", documentID: documents.items[2].id })
  expect(evidence.claims.map((claim) => claim.id)).toEqual(["explicit"])
})

test("archived change resolves uniquely and ambiguous archives fail", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, "openspec/changes/archive/2026-09-01-alpha/proposal.md", "# Archived")
  expect((await FoundationDocumentReader.index(tmp.path, { changeID: "alpha" })).items[0].sourcePath).toBe(
    "openspec/changes/archive/2026-09-01-alpha/proposal.md",
  )
  await write(tmp.path, "openspec/changes/archive/2026-09-02-alpha/proposal.md", "# Ambiguous")
  await expect(FoundationDocumentReader.index(tmp.path, { changeID: "alpha" })).rejects.toMatchObject({
    code: "ambiguous_archive",
  })
  await expect(FoundationDocumentReader.index(tmp.path, { changeID: "alph" })).rejects.toMatchObject({
    code: "not_found",
  })
})

test("malformed ids, symlinked documents and symlinked ancestors are rejected without reading the target", async () => {
  await using tmp = await tmpdir()
  await using outside = await tmpdir()
  await write(tmp.path, "openspec/investigations/note.md", "# Inside")
  await write(outside.path, "secret.md", "OUTSIDE_SECRET")
  for (const id of ["../secret", "absolute", "%00", "A".repeat(64)])
    await expect(FoundationDocumentReader.read(tmp.path, { investigationID: id })).rejects.toMatchObject({
      code: "invalid_input",
    })
  const item = (await FoundationDocumentReader.index(tmp.path)).items[0]
  await rm(path.join(tmp.path, item.sourcePath))
  await symlink(path.join(outside.path, "secret.md"), path.join(tmp.path, item.sourcePath))
  const failure = await FoundationDocumentReader.read(tmp.path, { investigationID: item.id }).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toMatchObject({ code: "invalid_input" })
  expect(String(failure)).not.toContain("OUTSIDE_SECRET")
  await rm(path.join(tmp.path, "openspec/investigations"), { recursive: true })
  await symlink(outside.path, path.join(tmp.path, "openspec/investigations"))
  await expect(FoundationDocumentReader.index(tmp.path)).rejects.toMatchObject({ code: "invalid_input" })
})

test("oversized documents fail on read, are flagged on index, and unknown ids are not found", async () => {
  await using tmp = await tmpdir()
  const source = "openspec/investigations/big.md"
  await write(tmp.path, source, "a".repeat(256 * 1024 + 1))
  await write(tmp.path, "openspec/investigations/small.md", "# Small")
  const listed = await FoundationDocumentReader.index(tmp.path)
  expect(listed.total).toBe(2)
  expect(listed.diagnostics).toEqual([`${source}: document_too_large`])
  const big = listed.items.find((item) => item.sourcePath === source)!
  await expect(FoundationDocumentReader.read(tmp.path, { investigationID: big.id })).rejects.toMatchObject({
    code: "document_too_large",
  })
  await expect(FoundationDocumentReader.read(tmp.path, { investigationID: "0".repeat(64) })).rejects.toMatchObject({
    code: "not_found",
  })
  await write(tmp.path, source, new Uint8Array([0xc3, 0x28]))
  await expect(FoundationDocumentReader.index(tmp.path)).rejects.toMatchObject({ code: "invalid_document" })
})

test("investigation references list only exact links outside code fences and inline code", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, "openspec/investigations/research.md", "# Same title")
  await write(tmp.path, "openspec/changes/alpha/proposal.md", "# Alpha\n[Research](../../investigations/research.md)\n")
  await write(
    tmp.path,
    "openspec/changes/beta/design.md",
    "# Beta\n[Broken](../../investigations/missing.md)\n```md\n[Example](../../investigations/research.md)\n```\n`[Example](../../investigations/research.md)`",
  )
  const note = (await FoundationDocumentReader.index(tmp.path)).items[0]
  const read = await FoundationDocumentReader.read(tmp.path, { investigationID: note.id })
  expect(read.references).toEqual([{ changeID: "alpha", sourcePath: "openspec/changes/alpha/proposal.md" }])
})

test("pagination is stable and invalid selections fail before scanning", async () => {
  await using tmp = await tmpdir()
  await Promise.all(
    Array.from({ length: 105 }, async (_, i) => {
      const source = `openspec/investigations/note-${i}.md`
      await write(tmp.path, source, `# Note ${i}`)
      await utimes(path.join(tmp.path, source), 1, 1)
    }),
  )
  const first = await FoundationDocumentReader.index(tmp.path)
  expect(first.items).toHaveLength(50)
  expect(first.nextOffset).toBe(50)
  expect((await FoundationDocumentReader.index(tmp.path, { limit: "100", offset: "100" })).items).toHaveLength(5)
  expect((await FoundationDocumentReader.index(tmp.path, { search: ".*" })).total).toBe(0)
  for (const query of [{ limit: "101" }, { limit: "0" }, { offset: "-1" }, { offset: "1.2" }])
    await expect(FoundationDocumentReader.index(tmp.path, query)).rejects.toMatchObject({ code: "invalid_input" })
})
