import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigExternalPlugin } from "@opencode-ai/core/config/plugin/external"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Npm } from "@opencode-ai/core/npm"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Config.Info)

// This is the "example workspace" the plugin scaffold exit criterion
// requires: a project config that loads packages/plugin/src/template-transform.ts
// the same way any external plugin package would be loaded.
describe("template-transform plugin", () => {
  it.live("loads in an example workspace and applies its draft-transform hook", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)
      const document = path.join(import.meta.dir, "opencode.json")

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: document,
                  info: decode({
                    plugins: [
                      {
                        package: "../../../plugin/src/template-transform.ts",
                        options: { description: "Loaded from the example workspace" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "changeloop-template")).toMatchObject({
        description: "Loaded from the example workspace",
        mode: "subagent",
      })
    }),
  )
})

const waitForAgent = Effect.fnUntraced(function* (agents: AgentV2.Interface, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const agent = yield* agents.get(AgentV2.ID.make(id))
    if (agent) return agent
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die(`Timed out waiting for agent ${id}`)
})
