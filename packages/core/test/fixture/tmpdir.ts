import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"

type TempDir = { readonly path: string }

export const tmpdir = async (prefix = "opencode-core-test-") => {
  const dir = await make(prefix)
  return {
    path: dir,
    [Symbol.asyncDispose]() {
      return remove(dir)
    },
  }
}

export const tmpdirScoped = (prefix = "opencode-core-test-") =>
  Effect.acquireRelease(
    Effect.tryPromise(() => make(prefix)),
    (dir) => Effect.tryPromise(() => remove(dir)).pipe(Effect.orDie),
  ).pipe(Effect.map((path) => ({ path })))

export const withTempDir = <A, E, R>(body: (tmp: TempDir) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => make("opencode-core-test-")),
    (path) => body({ path }),
    (dir) => Effect.tryPromise(() => remove(dir)).pipe(Effect.orDie),
  )

const make = async (prefix: string) => fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))

// Bun's callback APIs expose short paths and can hang during recursive removal on Windows.
async function remove(dir: string, retries = 30): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EACCES" && retries > 0) {
      // The bundled Foundation runtime is materialised read-only, which blocks recursive removal.
      await makeWritable(dir)
      return remove(dir, 0)
    }
    if (retries === 0 || !error || typeof error !== "object" || !("code" in error) || error.code !== "EBUSY")
      throw error
    Bun.gc(true)
    await Bun.sleep(100)
    return remove(dir, retries - 1)
  }
}

async function makeWritable(file: string): Promise<void> {
  const info = await fs.lstat(file).catch(() => undefined)
  if (!info || info.isSymbolicLink()) return
  await fs.chmod(file, info.isDirectory() ? 0o700 : 0o600).catch(() => undefined)
  if (!info.isDirectory()) return
  await Promise.all((await fs.readdir(file)).map((entry) => makeWritable(path.join(file, entry))))
}
