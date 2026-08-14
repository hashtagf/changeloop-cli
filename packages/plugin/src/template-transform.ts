import { define } from "@opencode-ai/plugin/v2/promise"

// Starting point for a changeloop plugin on the v2 draft-transform API.
// Copy this file, change `id`, and replace the transform body with the
// domain hook the plugin actually needs — see
// packages/plugin/src/v2/promise/README.md for the full hook list.
export default define({
  id: "changeloop-template",
  setup: async (ctx) => {
    await ctx.agent.transform((draft) => {
      draft.update("changeloop-template", (item) => {
        item.description = ctx.options.description ?? "Template plugin agent"
        item.mode = "subagent"
      })
    })
  },
})
