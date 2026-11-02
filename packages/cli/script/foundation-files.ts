import path from "node:path"
import { createEmbeddedFoundationBundle } from "@opencode/foundation/bundle"
import type { BunPlugin } from "bun"

/**
 * Resolves `virtual:opencode-foundation-files` to a map of the vendored Foundation runtime files, each embedded in the
 * executable as a compiled file. The bundle is checked against its manifest first, so drift fails the build.
 */
export async function foundationFilesPlugin(vendor: string): Promise<BunPlugin> {
  const { source } = await createEmbeddedFoundationBundle(vendor)
  // The generated imports are relative to the package that owns the vendor directory.
  const base = path.dirname(path.dirname(vendor))
  const contents = source.replace(
    /from ("\.\/[^"]+")/g,
    (_, spec: string) => `from ${JSON.stringify(path.resolve(base, JSON.parse(spec)).replaceAll("\\", "/"))}`,
  )
  return {
    name: "opencode-foundation-files",
    setup(build) {
      build.onResolve({ filter: /^virtual:opencode-foundation-files$/ }, () => ({
        path: "opencode-foundation-files",
        namespace: "opencode",
      }))
      build.onLoad({ filter: /^opencode-foundation-files$/, namespace: "opencode" }, () => ({
        loader: "js",
        contents,
      }))
    },
  }
}
