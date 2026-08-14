// Global config discovery shim: the CLI prefers changeloop.json(c) in the
// global config directory and keeps loading opencode.json(c) as a fallback,
// with changeloop values winning on merge (see src/config/config.ts and the
// cli-identity spec's global-config-shim scenario).
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { cliIt } from "../lib/cli-process"

// resolveAppPath prefers the `changeloop` app dir under XDG_CONFIG_HOME when
// no legacy `opencode` dir exists (packages/core/src/global.ts).
function globalConfigDir(home: string): string {
  return path.join(home, ".config", "changeloop")
}

async function writeConfig(dir: string, name: string, config: unknown): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, name), JSON.stringify(config, null, 2))
}

describe("global config discovery", () => {
  cliIt.live("changeloop.json wins over opencode.json for the same key", ({ opencode, home }) =>
    Effect.gen(function* () {
      const dir = globalConfigDir(home)
      yield* Effect.promise(() => writeConfig(dir, "opencode.json", { username: "legacy-user", autoupdate: false }))
      yield* Effect.promise(() => writeConfig(dir, "changeloop.json", { username: "changeloop-user" }))

      const result = yield* opencode.spawn(["debug", "config"])
      expect(result.exitCode).toBe(0)
      const config = JSON.parse(result.stdout)
      expect(config.username).toBe("changeloop-user")
      // Keys only present in the legacy file still load.
      expect(config.autoupdate).toBe(false)
    }),
    // Subprocess spawns share the machine with other suites — bun's default
    // 5s per-test timeout flakes under load.
    30_000,
  )

  cliIt.live("project changeloop.json and .changeloop directory win over legacy names", ({ opencode, home }) =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await fs.writeFile(path.join(home, "opencode.json"), JSON.stringify({ username: "legacy-project" }))
        await fs.writeFile(path.join(home, "changeloop.json"), JSON.stringify({ username: "changeloop-project" }))
        await fs.mkdir(path.join(home, ".changeloop"), { recursive: true })
        await fs.writeFile(
          path.join(home, ".changeloop", "changeloop.json"),
          JSON.stringify({ autoupdate: false }),
        )
      })

      // The fixture disables project config for isolation; this test is about
      // project config, so turn it back on for this spawn only.
      const result = yield* opencode.spawn(["debug", "config"], {
        env: { OPENCODE_DISABLE_PROJECT_CONFIG: "0" },
      })
      expect(result.exitCode).toBe(0)
      const config = JSON.parse(result.stdout)
      expect(config.username).toBe("changeloop-project")
      // Proves the .changeloop directory itself was discovered and loaded.
      expect(config.autoupdate).toBe(false)
    }),
    // Subprocess spawns share the machine with other suites — bun's default
    // 5s per-test timeout flakes under load.
    30_000,
  )

  cliIt.live("a lone opencode.json still loads unchanged", ({ opencode, home }) =>
    Effect.gen(function* () {
      const dir = globalConfigDir(home)
      yield* Effect.promise(() => writeConfig(dir, "opencode.json", { username: "legacy-user" }))

      const result = yield* opencode.spawn(["debug", "config"])
      expect(result.exitCode).toBe(0)
      const config = JSON.parse(result.stdout)
      expect(config.username).toBe("legacy-user")
    }),
    // Subprocess spawns share the machine with other suites — bun's default
    // 5s per-test timeout flakes under load.
    30_000,
  )
})
