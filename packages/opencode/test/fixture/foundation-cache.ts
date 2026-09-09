import { chmod, lstat, readdir, rm } from "fs/promises"
import { Global } from "@opencode-ai/core/global"

export async function cleanupFoundationCache() {
  async function remove(file: string): Promise<void> {
    const stat = await lstat(file).catch(() => undefined)
    if (!stat) return
    if (!stat.isSymbolicLink()) {
      await chmod(file, stat.isDirectory() ? 0o700 : 0o600)
      if (stat.isDirectory()) await Promise.all((await readdir(file)).map((name) => remove(`${file}/${name}`)))
    }
    await rm(file, { force: true, recursive: true })
  }
  await remove(`${Global.Path.cache}/foundation`)
}
