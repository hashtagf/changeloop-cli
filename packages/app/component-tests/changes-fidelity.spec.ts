import { expect, story } from "../../stories/playwright/story"

// The approved prototype's composition (openspec/investigations/changeloop-webui-prototype-drift.md): a project eyebrow
// above a 20px Changes title, a workflow strip, a 36px search, underlined category tabs with counts, and a dedicated
// detail screen with no list controls. These assert that structure and geometry, not pixels.

story("composes the list as eyebrow, title, workflow strip, search and underlined counted tabs", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const view = await mount("app-changes-view--list")
  const heading = view.locator('[data-component="changes-heading"]')

  await expect(heading.getByRole("heading", { level: 1 })).toHaveCSS("font-size", "20px")
  await expect(heading.getByRole("heading", { level: 1 })).toHaveText("Changes")
  // The eyebrow is the project name, above the title.
  const eyebrow = (await heading.getByText("project", { exact: true }).boundingBox())!
  const title = (await heading.getByRole("heading", { level: 1 }).boundingBox())!
  expect(eyebrow.y).toBeLessThan(title.y)

  await expect(heading.getByRole("searchbox")).toHaveCSS("height", "36px")

  const tabs = heading.getByRole("navigation", { name: "Change scope" }).getByRole("button")
  await expect(tabs).toHaveText([/^Investigations · —$/, /^Active · 2$/, /^Archived · 14$/])
  for (const tab of await tabs.all()) await expect(tab).toHaveCSS("border-bottom-width", "2px")

  // The strip names the five phases in order and marks Investigate on the saved-notes category only.
  const strip = heading.getByRole("navigation", { name: "Foundation workflow" })
  await expect(strip).toContainText("Investigate")
  await expect(strip).toContainText("Land")
})

story("keeps the content column within 720px at desktop width", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const view = await mount("app-changes-view--list")
  const section = (await view.getByRole("region", { name: "Changes" }).boundingBox())!

  expect(section.width).toBeLessThanOrEqual(720)
})

story("shows a change on its own screen without the list's search or category controls", async ({ mount }) => {
  const view = await mount("app-changes-view--detail")

  await expect(view.getByRole("button", { name: "Back to changes" })).toBeVisible()
  await expect(view.getByRole("searchbox")).toHaveCount(0)
  await expect(view.getByRole("navigation", { name: "Change scope" })).toHaveCount(0)

  const tabs = view.getByRole("navigation", { name: "Change details" }).getByRole("button")
  for (const tab of await tabs.all()) await expect(tab).toHaveCSS("border-bottom-width", "2px")
  await expect(view.getByRole("heading", { level: 1 })).toHaveCSS("font-size", "20px")
})

story("does not let a narrow screen wrap the Investigate step or overflow", async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const view = await mount("app-changes-view--detail")
  const step = view.getByRole("button", { name: /^Investigate/ })

  // A step that wraps is taller than one line of 18px text plus its padding.
  expect((await step.boundingBox())!.height).toBeLessThan(60)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
