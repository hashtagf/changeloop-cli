import path from "path"
import type { Argv } from "yargs"
import { confirm, isCancel, log } from "@clack/prompts"
import { FoundationRuntime } from "../../plugin/foundation-runtime"

type FoundationArgs = { path?: string; yes?: boolean; json?: boolean }
export type FoundationDependencies = {
  confirm: () => Promise<boolean>
  install: typeof FoundationRuntime.install
  status: typeof FoundationRuntime.status
  doctor: typeof FoundationRuntime.doctor
  write: (text: string) => void
}

const dependencies: FoundationDependencies = {
  confirm: async () => {
    const answer = await confirm({ message: "Initialize Foundation-managed workflow files in this project?" })
    return !isCancel(answer) && answer
  },
  install: FoundationRuntime.install,
  status: FoundationRuntime.status,
  doctor: FoundationRuntime.doctor,
  write: (text) => console.log(text),
}

export async function runFoundationMutation(args: FoundationArgs, dep: FoundationDependencies = dependencies) {
  if (!args.yes && !(await dep.confirm())) return { exitCode: 1, cancelled: true }
  const result = await dep.install(path.resolve(args.path ?? process.cwd()))
  if (result.stdout.trim()) dep.write(result.stdout.trim())
  if (result.exitCode !== 0) {
    if (result.stderr.trim()) dep.write(result.stderr.trim())
    return { exitCode: result.exitCode, cancelled: false }
  }
  const state = await dep.status(path.resolve(args.path ?? process.cwd()))
  dep.write(`Foundation ${state.bundle.version} (${state.bundle.release}) is installed`)
  const health = await dep.doctor(path.resolve(args.path ?? process.cwd()))
  if (health.stdout.trim()) dep.write(health.stdout.trim())
  if (health.exitCode !== 0) {
    if (health.stderr.trim()) dep.write(health.stderr.trim())
    return { exitCode: health.exitCode, cancelled: false }
  }
  return { exitCode: 0, cancelled: false }
}

export async function runFoundationStatus(args: FoundationArgs, dep: FoundationDependencies = dependencies) {
  const state = await dep.status(path.resolve(args.path ?? process.cwd()))
  dep.write(
    args.json
      ? JSON.stringify(state)
      : `Foundation bundled=${state.bundle.version} release=${state.bundle.release} installed=${state.installed.state}`,
  )
  return state.installed.state === "invalid" ? 1 : 0
}

export async function runFoundationDoctor(args: FoundationArgs, dep: FoundationDependencies = dependencies) {
  const result = await dep.doctor(path.resolve(args.path ?? process.cwd()))
  if (result.stdout.trim()) dep.write(result.stdout.trim())
  if (result.stderr.trim()) dep.write(result.stderr.trim())
  return result.exitCode
}

const target = (yargs: Argv) =>
  yargs.positional("path", { type: "string", describe: "project directory", default: "." })

const mutation = (command: "init" | "upgrade") => ({
  command: `${command} [path]`,
  describe: `${command} the bundled Foundation harness`,
  builder: (yargs: Argv) =>
    target(yargs).option("yes", { type: "boolean", default: false, describe: "approve repository file changes" }),
  handler: async (args: FoundationArgs) => {
    const result = await runFoundationMutation(args)
    if (result.cancelled) log.warn("Foundation initialization cancelled; no files were changed")
    if (result.exitCode !== 0) process.exitCode = 1
  },
})

export const FoundationCommand = {
  command: "foundation",
  describe: "manage the bundled Foundation harness",
  builder: (yargs: Argv) =>
    yargs
      .command(mutation("init"))
      .command(mutation("upgrade"))
      .command({
        command: "status [path]",
        describe: "show bundled and installed Foundation versions",
        builder: (child: Argv) => target(child).option("json", { type: "boolean", default: false }),
        handler: async (args: FoundationArgs) => {
          if ((await runFoundationStatus(args)) !== 0) process.exitCode = 1
        },
      })
      .command({
        command: "doctor [path]",
        describe: "run Foundation diagnostics",
        builder: target,
        handler: async (args: FoundationArgs) => {
          if ((await runFoundationDoctor(args)) !== 0) process.exitCode = 1
        },
      })
      .demandCommand(),
  handler: () => {},
}
