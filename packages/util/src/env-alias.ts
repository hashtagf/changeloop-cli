const from = "CHANGELOOP_"
const to = "OPENCODE_"

/**
 * Makes every `CHANGELOOP_*` variable readable as its `OPENCODE_*` twin. The `CHANGELOOP_*` value wins when both are
 * set, so environments that only define `OPENCODE_*` keep working unchanged. Idempotent.
 */
export function apply(env: NodeJS.ProcessEnv = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !key.startsWith(from) || key.length === from.length) continue
    env[to + key.slice(from.length)] = value
  }
}

// Importing this module is the single entry point: it runs before any module that reads the environment.
apply()

export * as EnvAlias from "./env-alias.js"
