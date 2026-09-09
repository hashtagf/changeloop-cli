import { expect, test } from "@playwright/test"
import pkg from "../../package.json"

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const directory = process.env.FOUNDATION_TEST_DIRECTORY
const changeID = process.env.FOUNDATION_TEST_CHANGE ?? "webui-active"
const archivedID = process.env.FOUNDATION_TEST_ARCHIVED ?? "webui-archived"
if (process.env.FOUNDATION_TEST_PASSWORD) test.use({ httpCredentials: { username: "opencode", password: process.env.FOUNDATION_TEST_PASSWORD } })
function href(scope = "active") {
  if (!directory) throw new Error("FOUNDATION_TEST_DIRECTORY must name an initialized real Foundation fixture")
  return `/changes?${new URLSearchParams({ server, directory, scope })}`
}

for (const scheme of ["light", "dark"] as const) {
  test(`B01/B02 ${scheme} legacy empty session keeps its compact brand and composer`, async ({ page }) => {
    if (!directory) throw new Error("Required project fixture missing")
    await page.setViewportSize({ width: scheme === "light" ? 390 : 1440, height: 900 })
    await page.goto(`/${Buffer.from(directory).toString("base64url")}/session`)
    await expect(page.locator('[data-component="changeloop-mark"]')).toBeVisible()
    await expect(page.getByRole("textbox").first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`foundation-${scheme}-legacy.png`) })
  })
  test(`S01/B01 ${scheme} explicit handoff creates only an editable branded draft`, async ({ page }) => {
    await page.setViewportSize({ width: scheme === "light" ? 390 : 1440, height: 900 })
    const submissions: string[] = []
    page.on("request", (request) => { if (request.method() === "POST" && /\/session(?:\/|$)/.test(new URL(request.url()).pathname)) submissions.push(request.url()) })
    await page.goto(href())
    await page.getByRole("region", { name: "Changes", exact: true }).getByRole("button", { name: changeID, exact: false }).click()
    await page.getByRole("button", { name: "Continue in session", exact: true }).click()
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toContainText(`/build ${changeID}`)
    await expect(page.getByRole("img", { name: "Changeloop", exact: true })).toBeVisible()
    await page.getByRole("textbox", { name: "Prompt", exact: true }).press("End")
    await page.getByRole("textbox", { name: "Prompt", exact: true }).pressSequentially(" review first")
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toContainText("review first")
    expect(submissions).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`foundation-${scheme}-draft.png`) })
    await page.getByRole("link", { name: "Changes", exact: true }).click()
    await page.getByRole("button", { name: "New change", exact: true }).click()
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveText("/investigate")
    expect(submissions).toEqual([])
  })
}

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript((settings) => {
    localStorage.setItem("app-version.v1", JSON.stringify({ version: settings.version }))
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: !settings.legacy, shouldDisplayTabsToast: false } }))
    localStorage.setItem("opencode-color-scheme", settings.scheme)
  }, { legacy: info.title.includes("legacy empty"), scheme: info.title.includes("dark") ? "dark" : "light", version: pkg.version })
})

test("U01/U02 real Changes tab, literal search, details and browser history", async ({ page }) => {
  await page.goto(href())
  const changes = page.getByRole("region", { name: "Changes", exact: true })
  await expect(changes.getByRole("button", { name: changeID, exact: false })).toBeVisible()
  await changes.getByRole("searchbox").fill("no-match-[.*]")
  await expect(changes.getByText("No changes match your search.")).toBeVisible()
  await changes.getByRole("searchbox").fill("")
  await changes.getByRole("button", { name: changeID, exact: false }).click()
  await expect(changes.getByRole("heading", { name: changeID, exact: true })).toBeVisible()
  await changes.getByRole("button", { name: "Evidence", exact: true }).click()
  await expect(changes.getByText("Recorded status", { exact: true })).toBeVisible()
  await expect(changes.getByText("Current status", { exact: true })).toBeVisible()
  await expect(changes.getByText("Freshness", { exact: true })).toBeVisible()
  await page.goBack()
  await expect(changes.getByText("Lifecycle status", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(page.getByRole("region", { name: "Recent sessions" })).toBeVisible()
  await page.getByRole("link", { name: "Changes", exact: true }).click()
  await expect(changes.getByRole("heading", { name: changeID, exact: true })).toBeVisible()
})

test("U03/U04 archive reads and same-selection stale retry", async ({ page }) => {
  await page.goto(href("archive"))
  const changes = page.getByRole("region", { name: "Changes", exact: true })
  await expect(changes.getByRole("button", { name: archivedID, exact: false })).toBeVisible()
  await page.route("**/experimental/foundation/changes*", (route) =>
    route.fulfill({
      status: 504,
      contentType: "application/json",
      body: JSON.stringify({ name: "FoundationError", data: { code: "timeout", message: "Timed out" } }),
    }),
  )
  await changes.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(changes.getByRole("alert")).toContainText("Showing stale data")
  await expect(changes.getByRole("button", { name: archivedID, exact: false })).toBeVisible()
  await page.unroute("**/experimental/foundation/changes*")
  await changes.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(changes.getByRole("alert")).toHaveCount(0)
  await changes.getByRole("button", { name: archivedID, exact: false }).click()
  await changes.getByRole("button", { name: "Continue in session", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveText("/changes")
})

test("S04 command submission failure retains the user's editable draft", async ({ page }) => {
  await page.goto(href())
  await page.getByRole("region", { name: "Changes", exact: true }).getByRole("button", { name: changeID, exact: false }).click()
  await page.getByRole("button", { name: "Continue in session", exact: true }).click()
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toContainText(`/build ${changeID}`)
  // A regression to ordinary prompt dispatch must fail this test without calling a model.
  await page.route("**/session/*/prompt*", (route) => route.fulfill({ status: 503, body: "Unexpected ordinary prompt dispatch" }))
  await page.route("**/session/*/message", (route) => route.request().method() === "POST" ? route.fulfill({ status: 503, body: "Unexpected ordinary prompt dispatch" }) : route.continue())
  await page.route("**/session/*/command", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ name: "ServiceUnavailableError", data: { message: "Fixture command preparation failure", service: "session.command" } }) }))
  const failed = page.waitForResponse((response) => /\/session\/[^/]+\/command$/.test(new URL(response.url()).pathname) && response.status() === 503)
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await failed
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toContainText(`/build ${changeID}`)
})

for (const scheme of ["light", "dark"] as const) {
  test(`U05/U06 ${scheme} narrow viewport preserves readable details and keyboard navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(href())
    const changes = page.getByRole("region", { name: "Changes", exact: true })
    const item = changes.getByRole("button", { name: changeID, exact: false })
    await item.focus()
    await page.keyboard.press("Enter")
    await expect(changes.getByRole("heading", { name: changeID, exact: true })).toBeVisible()
    await changes.getByRole("button", { name: "Usage", exact: true }).click()
    await expect(changes.getByText("Lifetime tokens", { exact: true })).toBeVisible()
    await expect(changes.getByText("Lifetime tokens", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("0")
    await expect(changes.getByText("Lifetime requests", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("Unavailable")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme)
    await page.screenshot({ path: test.info().outputPath(`foundation-${scheme}-mobile.png`), fullPage: true })
  })
}
