import path from "path"
import { embeddedFiles, type Loader } from "./embedded-files.js"
import { FoundationRuntime } from "./foundation-runtime.js"

export type Args = { path?: string; yes?: boolean; json?: boolean }
export type Status = Awaited<ReturnType<typeof FoundationRuntime.status>>
export type Dependencies = {
  /** Asks the user to approve repository file changes; resolves false when nobody can approve. */
  confirm: () => Promise<boolean>
  install: (directory: string) => Promise<FoundationRuntime.ProcessResult>
  status: (directory: string) => Promise<Status>
  doctor: (directory: string) => Promise<FoundationRuntime.ProcessResult>
  write: (text: string) => void
  error: (text: string) => void
}
export type Result = { exitCode: number; cancelled: boolean }

export type Options = {
  confirm: () => Promise<boolean>
  write?: (text: string) => void
  error?: (text: string) => void
  /** Replaces the dynamic import of the build-time embedded file map; exists for tests. */
  load?: Loader
  runtime?: FoundationRuntime.MaterializeOptions
}

/**
 * Dependencies backed by the runtime embedded in this build (or the vendored bundle when run from source). The embedded
 * map is resolved once; a build that embeds a runtime it cannot load is broken and never falls back to PATH.
 */
export function dependencies(options: Options): Dependencies {
  let resolved: Promise<FoundationRuntime.MaterializeOptions> | undefined
  const runtime = () =>
    (resolved ??= embeddedFiles(options.load).then((found) => {
      if (found.broken) throw new Error("Bundled Foundation runtime is unavailable. Reinstall this Changeloop release and retry.")
      return { ...options.runtime, ...(found.files && !options.runtime?.files ? { files: found.files } : {}) }
    }))
  return {
    confirm: options.confirm,
    install: async (directory) => FoundationRuntime.install(directory, await runtime()),
    status: async (directory) => FoundationRuntime.status(directory, await runtime()),
    doctor: async (directory) => FoundationRuntime.doctor(directory, "bundled", await runtime()),
    write: options.write ?? ((text) => console.log(text)),
    error: options.error ?? ((text) => console.error(text)),
  }
}

/** init and upgrade: the canonical installer converges managed files, so one routine serves both. */
export async function runMutation(args: Args, dep: Dependencies): Promise<Result> {
  const failed = (exitCode: number): Result => ({ exitCode, cancelled: false })
  return guard(dep, async () => {
    const directory = path.resolve(args.path ?? process.cwd())
    // Resolve the target first so a missing or non-directory path fails before anyone is asked to approve.
    await dep.status(directory)
    if (!args.yes && !(await dep.confirm())) {
      dep.error("Foundation changes were not approved and no files were changed. Re-run with --yes to approve them.")
      return { exitCode: 1, cancelled: true }
    }
    const result = await dep.install(directory)
    if (result.stdout.trim()) dep.write(result.stdout.trim())
    if (result.exitCode !== 0) {
      if (result.stderr.trim()) dep.error(result.stderr.trim())
      return failed(result.exitCode)
    }
    const state = await dep.status(directory)
    dep.write(`Foundation ${state.bundle.version} (${state.bundle.release}) is installed`)
    const health = await dep.doctor(directory)
    if (health.stdout.trim()) dep.write(health.stdout.trim())
    if (health.exitCode !== 0) {
      if (health.stderr.trim()) dep.error(health.stderr.trim())
      return failed(health.exitCode)
    }
    return { exitCode: 0, cancelled: false }
  })
}

export async function runStatus(args: Args, dep: Dependencies): Promise<number> {
  return (
    await guard(dep, async () => {
      const state = await dep.status(path.resolve(args.path ?? process.cwd()))
      dep.write(
        args.json
          ? JSON.stringify(state)
          : `Foundation bundled=${state.bundle.version} release=${state.bundle.release} installed=${state.installed.state}`,
      )
      return { exitCode: state.installed.state === "invalid" ? 1 : 0, cancelled: false }
    })
  ).exitCode
}

export async function runDoctor(args: Args, dep: Dependencies): Promise<number> {
  return (
    await guard(dep, async () => {
      const result = await dep.doctor(path.resolve(args.path ?? process.cwd()))
      if (result.stdout.trim()) dep.write(result.stdout.trim())
      if (result.stderr.trim()) dep.error(result.stderr.trim())
      return { exitCode: result.exitCode, cancelled: false }
    })
  ).exitCode
}

// Unsafe targets surface as thrown errors from the runtime; report them as a failed command instead of a crash.
async function guard(dep: Dependencies, run: () => Promise<Result>): Promise<Result> {
  return run().catch((error) => {
    dep.error(error instanceof Error ? error.message : String(error))
    return { exitCode: 1, cancelled: false }
  })
}

export * as FoundationCommand from "./foundation-command.js"
