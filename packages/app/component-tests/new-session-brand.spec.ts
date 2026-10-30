import { expect, story } from "../../stories/playwright/story"

story("shows the Changeloop wordmark at 720px with its own proportions and a 32px gap to the composer", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount("app-new-session-brand--session")
  const mark = page.getByRole("img", { name: "Changeloop" })
  const box = (await mark.boundingBox())!
  const composer = (await page.locator('[data-component="composer"]').boundingBox())!

  expect(box.width).toBeCloseTo(720, 0)
  // 310:25 with no padding, so a 720px wordmark is 58px tall, unlike the padded 129px of the old wordmark.
  expect(box.height).toBeCloseTo((720 * 25) / 310, 0)
  expect(composer.y - (box.y + box.height)).toBeCloseTo(32, 0)
  // The composer may extend past the wordmark, up to the 880px content bound.
  expect(composer.width).toBeLessThanOrEqual(880)
  expect(composer.width).toBeGreaterThanOrEqual(box.width)
})

story("scales the wordmark down on a narrow screen without overflowing or changing proportions", async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mount("app-new-session-brand--session")
  const box = (await page.getByRole("img", { name: "Changeloop" }).boundingBox())!

  expect(box.width).toBeLessThanOrEqual(390 - 48)
  expect(box.width / box.height).toBeCloseTo(310 / 25, 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

story("draws only the glyph squares, in two weights", async ({ mount, page }) => {
  await mount("app-new-session-brand--session")
  const squares = page.locator('[data-component="changeloop-wordmark"] rect')

  await expect(squares.first()).toHaveAttribute("opacity", "0.6")
  await expect(squares.last()).toHaveAttribute("opacity", "1")
})
