// Preserve the app's pinned session client; add the locally generated Foundation contract.
import path from "path"
import { cp, mkdtemp, rm } from "fs/promises"
import { $ } from "bun"

const root = path.resolve(import.meta.dir, "../../..")
const temporary = await mkdtemp(path.join(root, "packages/client/.foundation-client-"))
try {
  await $`tar -xzf ${path.join(root, "packages/app/vendor/opencode-ai-client-1.17.13-v2.tgz")} -C ${temporary}`
  const destination = path.join(temporary, "package/dist/foundation")
  await cp(path.join(root, "packages/client/src/generated"), destination, { recursive: true })
  const build = await Bun.build({
    entrypoints: [path.join(destination, "index.ts")],
    outdir: destination,
    target: "browser",
    format: "esm",
  })
  if (!build.success) throw new Error(build.logs.join("\n"))
  const file = Bun.file(path.join(temporary, "package/package.json"))
  const manifest = await file.json()
  manifest.exports["./foundation"] = { types: "./dist/foundation/index.ts", import: "./dist/foundation/index.js" }
  await Bun.write(file, JSON.stringify(manifest, null, 2) + "\n")
  await $`tar -czf ${path.join(root, "packages/app/vendor/opencode-ai-client-1.17.13-foundation.tgz")} -C ${temporary} package`
} finally {
  await rm(temporary, { recursive: true, force: true })
}
