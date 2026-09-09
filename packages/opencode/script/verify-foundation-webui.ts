import path from "path"
import assert from "node:assert/strict"
import { artifacts, browser, build, fixture, packageDir, root, run } from "./foundation-webui-verification"

await run("verification-tests", [process.execPath, "test", "--timeout", "30000", "test/plugin/foundation-verification.test.ts"], packageDir, process.env, 3)
await run("command-tests", [process.execPath, "test", "--timeout", "30000", "test/server/foundation-command.test.ts"], packageDir, process.env, 3)
await run("generated-client", [process.execPath, "script/build.ts", "--check"], path.join(root, "packages/client"))
for (const name of ["schema", "core", "protocol", "server", "client", "app", "opencode", "sdk/js"]) {
  const cwd = path.join(root, "packages", name)
  if ((await Bun.file(path.join(cwd, "package.json")).json()).scripts?.typecheck) await run(`typecheck-${name.replace("/", "-")}`, [process.execPath, "run", "typecheck"], cwd)
}
await run("typecheck-browser", [process.execPath, "run", "typecheck"], path.join(root, "packages/app/e2e"))
const binary = await build()
const target = await fixture(binary)
const request = (url: string | URL, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
try {
  const html = await request(target.url, { headers: target.headers }).then((response) => response.text())
  assert.equal(html, await Bun.file(path.join(root, "packages/app/dist/index.html")).text(), "Binary must serve the matching embedded app")
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1]
  assert(asset, "Embedded app entry is missing")
  const bytes = await request(new URL(asset, target.url), { headers: target.headers }).then((response) => response.arrayBuffer())
  assert.equal(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), new Bun.CryptoHasher("sha256").update(await Bun.file(path.join(root, "packages/app/dist", asset)).bytes()).digest("hex"))
  const endpoint = `${target.url}/experimental/foundation/changes?location[directory]=${encodeURIComponent(target.directory)}`
  assert.equal((await request(endpoint)).status, 401)
  const page = await request(endpoint, { headers: target.headers }).then((response) => response.json())
  assert(page.data.items.some((item: {id: string}) => item.id === "webui-active"))
  await browser(target, "foundation-webui", 9)
  await Bun.write(path.join(artifacts, "binary.json"), JSON.stringify({ binary, sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(binary).bytes()).digest("hex"), verifiedAt: new Date().toISOString(), standaloneFoundation: false, embeddedAssetsMatch: true }, null, 2))
} finally { await target.close() }
console.log("Foundation Web UI compiled delivery and browser checks passed")
