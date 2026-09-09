import { afterAll, afterEach, expect, test } from "bun:test"
import path from "path"
import { chmod, mkdir, rename, rm, symlink, utimes } from "fs/promises"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FoundationDocumentReader } from "../../src/plugin/foundation-documents"
import { tmpdir, disposeAllInstances } from "../fixture/fixture"
import { cleanupFoundationCache } from "../fixture/foundation-cache"

const server = HttpRouter.toWebHandler(
  HttpApiApp.routes.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: "document-test" }))),
  ),
  { disableLogger: true },
)
const context = HttpApiApp.context
function request(directory: string, route: string, authorized = true) {
  return server.handler(
    new Request(
      `http://localhost/experimental/foundation/${route}${route.includes("?") ? "&" : "?"}location[directory]=${encodeURIComponent(directory)}`,
      { headers: authorized ? { authorization: `Basic ${btoa("opencode:document-test")}` } : {} },
    ),
    context,
  )
}
async function write(root: string, source: string, text: string | Uint8Array) {
  await mkdir(path.dirname(path.join(root, source)), { recursive: true })
  await Bun.write(path.join(root, source), text)
}
afterEach(disposeAllInstances)
afterAll(async () => {
  await server.dispose()
  await cleanupFoundationCache()
}, 30_000)

test("I01/I02 notes and independent capabilities work before runtime init without creating project files", async () => {
  await using tmp = await tmpdir({ git: true, config: { foundation_workflow: false } })
  const empty = await request(tmp.path, "investigations")
  expect(empty.status).toBe(200)
  expect((await empty.json()).data.total).toBe(0)
  for (const [name, text] of Object.entries({
    first: "# Actual heading\n\n## Evidence\nOriginal text",
    fallback: "Unstructured note",
    historical: "# Earlier research\n## Renamed outcome\nNo lifecycle assertion",
    fenced: "```md\n# Not a title\n```\n# Real title",
    empty: "",
  }))
    await write(tmp.path, `openspec/investigations/${name}.md`, text)
  const listed = (await (await request(tmp.path, "investigations")).json()).data
  expect(listed.total).toBe(5)
  expect(listed.items.map((item: { title: string }) => item.title)).toContain("Real title")
  expect(listed.items.map((item: { title: string }) => item.title)).toContain("fallback")
  const item = listed.items.find((item: { title: string }) => item.title === "Actual heading")
  const read = (await (await request(tmp.path, `investigations/${item.id}`)).json()).data
  expect(read.sections.map((item: { title: string }) => item.title)).toEqual(["Actual heading", "Evidence"])
  expect(read.sha256).toBe(new Bun.CryptoHasher("sha256").update(read.text).digest("hex"))
  expect(read.references).toEqual([])
  const capability = (await (await request(tmp.path, "capability")).json()).data
  expect(capability).toMatchObject({ available: false, snapshot: false, investigations: true, documents: true })
  expect(await Bun.file(path.join(tmp.path, ".claude/harness/protocol.json")).exists()).toBe(false)
}, 30_000)

test("I03/F04 exact references, allowed document ordering, active preference and unique archive resolution", async () => {
  await using tmp = await tmpdir({ git: true })
  await write(tmp.path, "openspec/investigations/research.md", "# Same title")
  await write(tmp.path, "openspec/changes/alpha/proposal.md", "# Alpha\n[Research](../../investigations/research.md)\n")
  await write(
    tmp.path,
    "openspec/changes/beta/design.md",
    "# Same title\n[Broken](../../investigations/missing.md)\n```md\n[Example](../../investigations/research.md)\n```\n`[Example](../../investigations/research.md)`",
  )
  await write(tmp.path, "openspec/changes/alpha/tasks.md", "- [x] Implement\n- [ ] Prove\n```md\n- [x] Not a task\n```")
  await write(
    tmp.path,
    "openspec/changes/alpha/evidence.yaml",
    "claims:\n  - id: explicit\n    description: Declared obligation\n",
  )
  await write(tmp.path, "openspec/changes/alpha/secret.txt", "not public")
  await write(tmp.path, "openspec/changes/alpha/specs/read/spec.md", "# Reader")
  await write(tmp.path, "openspec/changes/archive/2026-09-01-alpha/proposal.md", "# Archived")
  const notes = await FoundationDocumentReader.index(tmp.path)
  const note = await FoundationDocumentReader.read(tmp.path, { investigationID: notes.items[0].id })
  expect(note.references).toEqual([{ changeID: "alpha", sourcePath: "openspec/changes/alpha/proposal.md" }])
  const documents = await FoundationDocumentReader.index(tmp.path, { changeID: "alpha" })
  expect(documents.items.map((item) => path.basename(item.sourcePath))).toEqual([
    "proposal.md",
    "tasks.md",
    "evidence.yaml",
    "spec.md",
  ])
  const tasks = await FoundationDocumentReader.read(tmp.path, { changeID: "alpha", documentID: documents.items[1].id })
  expect(tasks.tasks.map((item) => item.checked)).toEqual([true, false])
  const evidence = await FoundationDocumentReader.read(tmp.path, {
    changeID: "alpha",
    documentID: documents.items[2].id,
  })
  expect(evidence.claims.map((claim) => claim.id)).toEqual(["explicit"])
  await rm(path.join(tmp.path, "openspec/changes/alpha"), { recursive: true })
  expect((await FoundationDocumentReader.index(tmp.path, { changeID: "alpha" })).items[0].sourcePath).toContain(
    "archive/2026-09-01-alpha",
  )
  await write(tmp.path, "openspec/changes/archive/2026-09-02-alpha/proposal.md", "# Ambiguous")
  await expect(FoundationDocumentReader.index(tmp.path, { changeID: "alpha" })).rejects.toMatchObject({
    code: "ambiguous_archive",
  })
  await expect(FoundationDocumentReader.index(tmp.path, { changeID: "alph" })).rejects.toMatchObject({
    code: "not_found",
  })
}, 30_000)

test("I04 stable literal pagination and explicit scan bounds", async () => {
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
  expect(first.items.map((item) => item.id)).toEqual([...first.items.map((item) => item.id)].sort())
  for (const query of [{ limit: "101" }, { limit: "0" }, { offset: "-1" }, { offset: "1.2" }])
    await expect(FoundationDocumentReader.index(tmp.path, query)).rejects.toMatchObject({ code: "invalid_input" })
  await Promise.all(
    Array.from({ length: 4097 }, (_, i) => write(tmp.path, `openspec/investigations/candidate-${i}.txt`, "")),
  )
  await expect(FoundationDocumentReader.index(tmp.path)).rejects.toMatchObject({ code: "index_limit_exceeded" })
  await write(tmp.path, `openspec/changes/deep/specs/${"nested/".repeat(33)}spec.md`, "# Deep")
  await expect(FoundationDocumentReader.index(tmp.path, { changeID: "deep" })).rejects.toMatchObject({
    code: "index_limit_exceeded",
  })
}, 30_000)

test("F01/F02 opaque IDs remain location-scoped and reject traversal, symlinks and special files", async () => {
  await using a = await tmpdir({ git: true })
  await using b = await tmpdir({ git: true })
  await write(a.path, "openspec/investigations/note.md", "# Project A")
  expect((await request(a.path, "investigations", false)).status).toBe(401)
  await write(b.path, "openspec/investigations/note.md", "# Project B")
  const item = (await FoundationDocumentReader.index(a.path)).items[0]
  expect((await (await request(b.path, `investigations/${item.id}`)).json()).data.title).toBe("Project B")
  for (const id of ["..%2fsecret", "%252e%252e", "absolute", "%00"])
    expect((await request(a.path, `investigations/${id}`)).status).toBe(400)
  await rm(path.join(a.path, item.sourcePath))
  await symlink(path.join(b.path, item.sourcePath), path.join(a.path, item.sourcePath))
  await expect(FoundationDocumentReader.read(a.path, { investigationID: item.id })).rejects.toMatchObject({
    code: "invalid_input",
  })
  await rm(path.join(a.path, item.sourcePath))
  const child = Bun.spawn(["/usr/bin/mkfifo", path.join(a.path, item.sourcePath)])
  expect(await child.exited).toBe(0)
  await expect(FoundationDocumentReader.read(a.path, { investigationID: item.id })).rejects.toMatchObject({
    code: "invalid_input",
  })
}, 30_000)

test("F03 body size, encoded-response size and invalid UTF-8 fail explicitly", async () => {
  await using tmp = await tmpdir({ git: true })
  const source = "openspec/changes/bounds/design.md"
  await write(tmp.path, source, "a".repeat(256 * 1024))
  const id = (await FoundationDocumentReader.index(tmp.path, { changeID: "bounds" })).items[0].id
  const route = `changes/bounds/documents/${id}`
  expect((await request(tmp.path, route)).status).toBe(200)
  await write(tmp.path, source, "a".repeat(256 * 1024 + 1))
  expect((await request(tmp.path, route)).status).toBe(413)
  await write(tmp.path, source, "\0".repeat(256 * 1024))
  expect((await request(tmp.path, route)).status).toBe(413)
  await write(tmp.path, source, new Uint8Array([0xc3, 0x28]))
  expect((await request(tmp.path, route)).status).toBe(422)
}, 30_000)

test("F02 replacement races cannot disclose an outside file and denied sources stay explicit", async () => {
  await using tmp = await tmpdir()
  await using outside = await tmpdir()
  const source = "openspec/changes/race/design.md"
  await write(tmp.path, source, "inside")
  await write(outside.path, "secret", "OUTSIDE_SECRET")
  const id = (await FoundationDocumentReader.index(tmp.path, { changeID: "race" })).items[0].id
  const target = path.join(tmp.path, source)
  const attacker = (async () => {
    for (let i = 0; i < 50; i++) {
      await symlink(path.join(outside.path, "secret"), `${target}.swap`)
      await rename(`${target}.swap`, target)
      await Bun.write(`${target}.swap`, "inside")
      await rename(`${target}.swap`, target)
    }
  })()
  const results = await Promise.all(
    Array.from({ length: 30 }, () =>
      FoundationDocumentReader.read(tmp.path, { changeID: "race", documentID: id }).then(
        (value) => value.text,
        (error: unknown) => {
          expect(error).toMatchObject({ code: expect.stringMatching(/^(invalid_input|document_changed|not_found)$/) })
          return undefined
        },
      ),
    ),
  )
  await attacker
  expect(results.filter((value) => value !== undefined).every((value) => value === "inside")).toBe(true)
  await chmod(target, 0)
  try {
    await expect(FoundationDocumentReader.read(tmp.path, { changeID: "race", documentID: id })).rejects.toMatchObject({
      code: "denied",
    })
  } finally {
    await chmod(target, 0o600)
  }
}, 30_000)

test("F06 YAML and JSON claims parse; invalid contracts and noncanonical checklists retain their source", () => {
  expect(FoundationDocumentReader.parse('{"claims":[{"id":"json"}]}', "evidence.yaml").claims[0].id).toBe("json")
  expect(FoundationDocumentReader.parse("claims: [invalid", "evidence.yaml").diagnostics).toHaveLength(1)
  expect(FoundationDocumentReader.parse("Done: everything", "tasks.md").diagnostics).toHaveLength(1)
  expect(FoundationDocumentReader.parse("- [ ] Never proof", "tasks.md").tasks[0].checked).toBe(false)
  expect(
    FoundationDocumentReader.parse("# Title\r\nParagraph\r## Tests\n- [x] Mixed endings\r## Last", "tasks.md"),
  ).toMatchObject({
    sections: [
      { id: "line-1", line: 1 },
      { id: "line-3", line: 3 },
      { id: "line-5", line: 5 },
    ],
    tasks: [{ line: 4, checked: true }],
  })
})

test("F1 unrelated broken changes and reference scan limits preserve the requested note", async () => {
  await using tmp = await tmpdir({ git: true })
  const source = "openspec/investigations/research.md"
  await write(tmp.path, source, "# Saved note\n\nOriginal research")
  await write(tmp.path, "openspec/changes/a.valid/proposal.md", "[Research](../../investigations/research.md)")
  await write(tmp.path, "openspec/changes/broken", "not a directory")
  await write(tmp.path, "openspec/changes/oversized/design.md", "x".repeat(256 * 1024 + 1))
  await write(tmp.path, "openspec/changes/invalid/design.md", new Uint8Array([0xc3, 0x28]))
  await write(tmp.path, "openspec/changes/archive/2026-09-01-duplicate/proposal.md", "first")
  await write(tmp.path, "openspec/changes/archive/2026-09-02-duplicate/proposal.md", "second")
  const id = (await FoundationDocumentReader.index(tmp.path)).items[0].id
  const response = await request(tmp.path, `investigations/${id}`)
  expect(response.status).toBe(200)
  const note = (await response.json()).data
  expect(note.text).toBe("# Saved note\n\nOriginal research")
  expect(note.references).toEqual([{ changeID: "a.valid", sourcePath: "openspec/changes/a.valid/proposal.md" }])
  for (const code of ["invalid_input", "document_too_large", "invalid_document", "ambiguous_archive"])
    expect(note.diagnostics.join("\n")).toContain(code)
  expect((await FoundationDocumentReader.index(tmp.path, { changeID: "a.valid" })).items).toHaveLength(1)
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      write(tmp.path, `openspec/changes/volume-${i}/design.md`, "x".repeat(256 * 1024)),
    ),
  )
  const bounded = await FoundationDocumentReader.read(tmp.path, { investigationID: id })
  expect(bounded.text).toBe(note.text)
  expect(bounded.diagnostics.join("\n")).toContain("index_limit_exceeded")
  await Promise.all(Array.from({ length: 1030 }, (_, i) => write(tmp.path, `openspec/changes/candidate-${i}`, "")))
  const crowded = await FoundationDocumentReader.read(tmp.path, { investigationID: id })
  expect(crowded.text).toBe(note.text)
  expect(crowded.diagnostics.join("\n")).toContain("index_limit_exceeded")
}, 30_000)
