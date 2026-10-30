import { describe, expect, test } from "bun:test"
import { OauthCallbackPage } from "../src/oauth/page"

describe("OauthCallbackPage", () => {
  test("escapes bootstrap options embedded in the inline script", () => {
    const html = OauthCallbackPage.bootstrap({
      provider: `xAI</script><script>alert("provider")</script>`,
      tokenPath: `/token</script><script>alert("path")</script>`,
    })

    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain(`xAI\\u003c/script>\\u003cscript>alert(\\\"provider\\\")\\u003c/script>`)
    expect(html).toContain(`/token\\u003c/script>\\u003cscript>alert(\\\"path\\\")\\u003c/script>`)
  })

  // The wordmark SVG is the only place the old name remains (it needs a new logo, not new prose).
  const prose = (html: string) => html.replace(/<svg class="wordmark"[\s\S]*?<\/svg>/, "")

  test("success, error and bootstrap pages name Changeloop", () => {
    const pages = [
      OauthCallbackPage.success({ provider: "xAI" }),
      OauthCallbackPage.success(),
      OauthCallbackPage.error("denied", { provider: "xAI" }),
      OauthCallbackPage.error("denied"),
      OauthCallbackPage.bootstrap({ provider: "xAI", tokenPath: "/token" }),
    ]
    for (const html of pages) {
      expect(prose(html)).not.toMatch(/opencode/i)
      expect(html).toContain("· Changeloop</title>")
    }
    expect(OauthCallbackPage.success({ provider: "xAI" })).toContain("Changeloop is now connected to xAI.")
    expect(OauthCallbackPage.success()).toContain("Changeloop is now authorized.")
    expect(OauthCallbackPage.error("denied", { provider: "xAI" })).toContain("Changeloop couldn't finish connecting to xAI.")
    expect(OauthCallbackPage.error("denied")).toContain("try again from Changeloop.")
  })
})
