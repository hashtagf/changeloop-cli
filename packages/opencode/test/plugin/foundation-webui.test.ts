import path from "path"
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink } from "fs/promises"
import { afterAll, expect, test } from "bun:test"
import { FoundationWebui } from "../../src/plugin/foundation-webui"
import { FoundationRuntime } from "../../src/plugin/foundation-runtime"
import { createEmbeddedFoundationBundle } from "../../script/foundation-bundle"

const roots: string[] = []
afterAll(async () => {
  await Promise.all(roots.map(remove))
}, 30_000)

async function temporary() {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "foundation-webui-"))
  roots.push(root)
  return root
}
async function remove(file: string): Promise<void> {
  const info = await lstat(file)
  if (!info.isSymbolicLink()) {
    await chmod(file, info.isDirectory() ? 0o700 : 0o600)
    if (info.isDirectory()) await Promise.all((await readdir(file)).map((entry) => remove(path.join(file, entry))))
  }
  await rm(file, { recursive: true, force: true })
}
async function tree(root: string) {
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: false }))).sort()
  return Promise.all(
    files.map(async (file) => {
      const info = await lstat(path.join(root, file))
      return [
        file,
        info.mode,
        info.isDirectory()
          ? "directory"
          : new Bun.CryptoHasher("sha256").update(await Bun.file(path.join(root, file)).bytes()).digest("hex"),
      ]
    }),
  )
}
async function fixture(body: string) {
  const root = await temporary()
  await mkdir(path.join(root, ".claude/harness"), { recursive: true })
  await Bun.write(path.join(root, ".claude/harness/protocol.json"), "{}")
  const bin = await temporary()
  await Bun.write(path.join(bin, "claude-foundation"), "#!/bin/sh\n" + body)
  await chmod(path.join(bin, "claude-foundation"), 0o700)
  return { root, options: { env: { PATH: bin } }, bin }
}

test("P01/P02/P04 pinned bundle traverses dashboard without PATH Foundation and preserves active/archive project", async () => {
  const root = await temporary()
  const cache = await temporary()
  expect((await FoundationRuntime.install(root, { cache })).exitCode).toBe(0)
  await mkdir(path.join(root, ".foundation/runtime"), { recursive: true })
  await Bun.write(
    path.join(root, ".foundation/runtime/active.json"),
    JSON.stringify({ id: "active", status: "building", revision: 2 }),
  )
  await Bun.write(
    path.join(root, ".foundation/runtime/archived.json"),
    JSON.stringify({ id: "archived", status: "archived", revision: 1, workspace: { path: "/missing/sandbox" } }),
  )
  const bin = await temporary()
  await symlink(Bun.which("node")!, path.join(bin, "node"))
  const env = { PATH: bin + ":/usr/bin:/bin", CLAUDE_FOUNDATION_PROJECT: "/must-not-read" }
  expect(Bun.which("claude-foundation", { PATH: env.PATH })).toBeNull()
  const before = await tree(root)
  const result = await FoundationWebui.read(root, "bundled", { cache, env })
  expect(result.runtime.version).toBe("3.5.14")
  expect(result.snapshot).toMatchObject({
    schemaVersion: 3,
    changes: [
      { id: "active", status: "building" },
      { id: "archived", status: "archived" },
    ],
  })
  expect(await tree(root)).toEqual(before)
  const bundle = await createEmbeddedFoundationBundle(path.resolve(import.meta.dir, "../../vendor/claude-foundation"))
  expect(bundle.manifest.commit).toBe("334e3b94a0624553f8807287e91971fcf8eae203")
  expect(bundle.manifest.files).toHaveLength(501)
  expect(bundle.manifest.files.map((file) => file.path)).toContain("dashboard/client.sh")
  expect(bundle.manifest.files.map((file) => file.path)).toContain("dashboard/snapshot.mjs")
}, 30_000)

test("P03/P04 missing path runtime and uninitialized project never fall back or initialize", async () => {
  const root = await temporary()
  const before = await tree(root)
  await expect(FoundationWebui.read(root, "path", { env: { PATH: root } })).rejects.toMatchObject({
    code: "runtime_unavailable",
  })
  await expect(FoundationWebui.read(root, "bundled", { cache: await temporary() })).rejects.toMatchObject({
    code: "not_initialized",
  })
  expect(await tree(root)).toEqual(before)
})

test("P03 incompatible path runtime fails explicitly and subsequent reads retry", async () => {
  const f = await fixture('printf \'{"schemaVersion":4,"foundationVersion":"4"}\\n\'')
  await expect(FoundationWebui.read(f.root, "path", f.options)).rejects.toMatchObject({ code: "unsupported" })
  await Bun.write(
    path.join(f.bin, "claude-foundation"),
    '#!/bin/sh\nprintf \'{"schemaVersion":3,"foundationVersion":"3"}\\n\'',
  )
  expect((await FoundationWebui.read(f.root, "path", f.options)).runtime.version).toBe("3")
})

test("P03 damaged bundle fails without path fallback", async () => {
  const f = await fixture('printf \'{"schemaVersion":3,"foundationVersion":"path"}\\n\'')
  await expect(
    FoundationWebui.read(f.root, "bundled", {
      ...f.options,
      cache: await temporary(),
      files: { "manifest.json": path.join(f.root, "missing") },
    }),
  ).rejects.toMatchObject({ code: "runtime_unavailable" })
})

test("same canonical project coalesces overlapping reads and clears completed entry", async () => {
  const f = await fixture(
    'printf x >> "$CLAUDE_FOUNDATION_PROJECT/calls"\n/bin/sleep 0.1\nprintf \'{"schemaVersion":3,"foundationVersion":"3"}\\n\'',
  )
  const alias = path.join(await temporary(), "alias")
  await symlink(f.root, alias)
  await Promise.all([FoundationWebui.read(f.root, "path", f.options), FoundationWebui.read(alias, "path", f.options)])
  expect(await Bun.file(path.join(f.root, "calls")).text()).toBe("x")
  await FoundationWebui.read(f.root, "path", f.options)
  expect(await Bun.file(path.join(f.root, "calls")).text()).toBe("xx")
})

test("malformed output and nonzero exit remain explicit failures", async () => {
  const malformed = await fixture("printf nope")
  await expect(FoundationWebui.read(malformed.root, "path", malformed.options)).rejects.toMatchObject({
    code: "invalid_response",
  })
  const failed = await fixture("exit 1")
  await expect(FoundationWebui.read(failed.root, "path", failed.options)).rejects.toMatchObject({
    code: "runtime_unavailable",
  })
})

test("combined stdout/stderr is limited and child terminates", async () => {
  const f = await fixture(
    '/bin/dd if=/dev/zero bs=700000 count=1 2>/dev/null\n/bin/dd if=/dev/zero bs=700000 count=1 >&2\nexec /bin/sleep 30',
  )
  await expect(FoundationWebui.read(f.root, "path", f.options)).rejects.toMatchObject({ code: "output_too_large" })
}, 10_000)

test("hung child is killed at five seconds", async () => {
  const f = await fixture("/bin/sleep 30 &\nwait")
  const start = Date.now()
  await expect(FoundationWebui.read(f.root, "path", f.options)).rejects.toMatchObject({ code: "timeout" })
  expect(Date.now() - start).toBeLessThan(7000)
}, 10_000)

test("failed read is not retained for an unchanged runtime identity", async () => {
  const f = await fixture(
    'if [ ! -f "$CLAUDE_FOUNDATION_PROJECT/retry" ]; then printf x > "$CLAUDE_FOUNDATION_PROJECT/retry"; exit 1; fi\nprintf \'{"schemaVersion":3,"foundationVersion":"3"}\\n\'',
  )
  await expect(FoundationWebui.read(f.root, "path", f.options)).rejects.toMatchObject({ code: "runtime_unavailable" })
  expect((await FoundationWebui.read(f.root, "path", f.options)).runtime.version).toBe("3")
})
