import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { expect } from "bun:test"
import { Effect, FileSystem } from "effect"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"
import { selfCommand } from "../src/util/process"
import { it } from "../../core/test/lib/effect"

// `Service.ensure` falls back to `opencode serve --service` when it gets no command. The CLI always passes one,
// so a Changeloop install, where no `opencode` executable exists, starts the service from its own executable.
it.live("service options start the running executable, never an opencode command", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "changeloop-service-command-" })
    const config = path.join(root, "config")
    const state = path.join(root, "state")
    yield* fs.makeDirectory(config)
    yield* fs.makeDirectory(state)

    const options = yield* ServiceConfig.options().pipe(Effect.provideService(Global.Service, Global.make({ config, state })))

    expect(options.command).toEqual([...selfCommand(), "serve", "--service"])
    expect(options.command[0]).toBe(process.execPath)
    expect(options.command.map((part) => path.basename(part))).not.toContain("opencode")
  }).pipe(Effect.provide(NodeServices.layer)),
)
