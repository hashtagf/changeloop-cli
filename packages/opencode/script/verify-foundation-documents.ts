import path from "path"
import assert from "node:assert/strict"
import { artifacts, browser, build, fixture, packageDir, root, run } from "./foundation-webui-verification"

await run(
  "document-reader-tests",
  [process.execPath, "test", "--timeout", "30000", "test/server/foundation-documents.test.ts"],
  packageDir,
  process.env,
  8,
)
await run(
  "document-consumer-tests",
  [
    process.execPath,
    "test",
    "--conditions=solid",
    "--preload",
    "./happydom.ts",
    "src/pages/changes/document-refresh.test.ts",
    "src/pages/changes/document-client.test.ts",
  ],
  path.join(root, "packages/app"),
  process.env,
  4,
)
await run("document-typecheck", [process.execPath, "run", "typecheck"], path.join(root, "packages/app/e2e"))
const binary = await build()
const target = await fixture(binary)
try {
  const html = await fetch(target.url, { headers: target.headers, signal: AbortSignal.timeout(30000) }).then(
    (response) => response.text(),
  )
  assert.equal(
    html,
    await Bun.file(path.join(root, "packages/app/dist/index.html")).text(),
    "Document flow must use the matching embedded app",
  )
  await browser(target, "foundation-documents", 6)
  await Bun.write(
    path.join(artifacts, "documents.json"),
    JSON.stringify(
      {
        binary,
        sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(binary).bytes()).digest("hex"),
        browserReportSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file(path.join(artifacts, "foundation-documents.json")).bytes())
          .digest("hex"),
        verifiedAt: new Date().toISOString(),
        standaloneFoundation: false,
        embeddedAssetsMatch: true,
      },
      null,
      2,
    ),
  )
} finally {
  await target.close()
}
console.log("Foundation document readers and compiled browser flow passed")
