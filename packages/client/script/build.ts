import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitPromise, write } from "@opencode-ai/httpapi-codegen"
import { ClientApi, endpointNames, groupNames, omitEndpoints } from "../src/contract"
import { Effect } from "effect"
import { fileURLToPath } from "url"
import { mkdtemp, rm } from "fs/promises"
import path from "path"
import os from "os"

const check = process.argv.includes("--check")
const temporary = check ? await mkdtemp(path.join(os.tmpdir(), "changeloop-client-check-")) : undefined
const generated = temporary ?? fileURLToPath(new URL("../src", import.meta.url))

const contract = compile(ClientApi, { groupNames, endpointNames, omitEndpoints })

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(contract, {
          outputTypes: {
            "events.subscribe": {
              name: "OpenCodeEventEncoded",
              import: 'import type { OpenCodeEventEncoded } from "@opencode-ai/protocol/groups/event"',
            },
          },
        }),
        path.join(generated, "generated"),
      ),
      write(
        emitEffectImported(contract, { module: "../contract", api: "ClientApi" }),
        path.join(generated, "generated-effect"),
      ),
    ],
    { concurrency: 2, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)
if (temporary) {
  try {
    for (const directory of ["generated", "generated-effect"]) {
      const expected = path.join(temporary, directory)
      const actual = fileURLToPath(new URL(`../src/${directory}`, import.meta.url))
      const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: expected }))).sort()
      const existing = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: actual }))).sort()
      if (JSON.stringify(files) !== JSON.stringify(existing)) throw new Error(`Generated file inventory differs: ${directory}`)
      for (const file of files) if (!Buffer.from(await Bun.file(path.join(expected, file)).bytes()).equals(Buffer.from(await Bun.file(path.join(actual, file)).bytes()))) throw new Error(`Generated client drift: ${directory}/${file}`)
    }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
