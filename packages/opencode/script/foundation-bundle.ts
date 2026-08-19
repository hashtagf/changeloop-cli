import path from "path"
import { Schema } from "effect"

const Manifest = Schema.Struct({
  schema: Schema.Literal(1),
  release: Schema.String,
  commit: Schema.String,
  version: Schema.String,
  tagged: Schema.Boolean,
  hostProtocols: Schema.Struct({ instruction: Schema.Literal(1), agentContract: Schema.Literal(1) }),
  files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String, mode: Schema.Number })),
})

export async function createEmbeddedFoundationBundle(vendor: string, requireTagged = true) {
  const manifest = Schema.decodeUnknownSync(Manifest)(await Bun.file(path.join(vendor, "manifest.json")).json())
  if (requireTagged && !manifest.tagged) throw new Error("Bundled Foundation source must be a tagged release")
  const declared = new Map(manifest.files.map((file) => [file.path, file.sha256]))
  const payload = (
    await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: path.join(vendor, "payload"), dot: true, onlyFiles: true }))
  )
    .map((file) => file.replaceAll("\\", "/"))
    .sort()
  if (payload.length !== declared.size || payload.some((file) => !declared.has(file))) {
    throw new Error("Bundled Foundation payload does not match its manifest")
  }
  await Promise.all(
    payload.map(async (file) => {
      const body = await Bun.file(path.join(vendor, "payload", file)).bytes()
      const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex")
      if (digest !== declared.get(file)) throw new Error(`Bundled Foundation checksum mismatch: ${file}`)
    }),
  )
  const files = ["manifest.json", ...payload.map((file) => `payload/${file}`)]
  const imports = files.map((file, index) => {
    const spec = path.relative(path.dirname(path.dirname(vendor)), path.join(vendor, file)).replaceAll("\\", "/")
    return `import foundation_${index} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  return {
    manifest,
    source: [
      ...imports,
      "export default {",
      ...files.map((file, index) => `  ${JSON.stringify(file)}: foundation_${index},`),
      "}",
    ].join("\n"),
  }
}
