import { createServer, type Server } from "node:http"
import { expect, test } from "@playwright/test"

const directory = process.env.FOUNDATION_TEST_DIRECTORY
if (process.env.FOUNDATION_TEST_PASSWORD)
  test.use({ httpCredentials: { username: "opencode", password: process.env.FOUNDATION_TEST_PASSWORD } })

function sessionHref() {
  if (!directory) throw new Error("FOUNDATION_TEST_DIRECTORY must name a real project fixture")
  return `/${Buffer.from(directory).toString("base64url")}/session`
}

async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("preview fixture server did not bind a port")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => server.close(),
  }
}

const page_ = (body: string) => `<!doctype html><html><body>${body}</body></html>`

async function openPreview(page: import("@playwright/test").Page) {
  await page.goto(sessionHref())
  await page.getByRole("button", { name: "Open preview", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Preview", exact: true })).toBeVisible()
  return {
    address: page.getByRole("textbox", { name: "Preview address", exact: true }),
    status: page.getByRole("status"),
    frame: page.locator('[data-component="session-preview-frame"]'),
  }
}

for (const scheme of ["light", "dark"] as const) {
  const width = scheme === "light" ? 1440 : 390

  test(`P01 ${scheme} frames a reachable dev server and reloads it`, async ({ page }) => {
    const fixture = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" })
      response.end(page_("<h1>dev server</h1>"))
    })
    try {
      await page.setViewportSize({ width, height: 900 })
      const preview = await openPreview(page)

      await expect(preview.status).toHaveText("No address yet")
      await preview.address.fill(fixture.url)
      await preview.address.press("Enter")

      await expect(preview.frame).toHaveAttribute("src", fixture.url)
      await expect(preview.status).toHaveText("Preview loaded")
      await expect(preview.frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-same-origin")
      await expect(preview.frame).toHaveAttribute("referrerpolicy", "no-referrer")

      const before = await preview.frame.getAttribute("data-token")
      await page.getByRole("button", { name: "Reload preview", exact: true }).click()
      await expect(preview.frame).not.toHaveAttribute("data-token", before ?? "")
      await expect(preview.status).toHaveText("Preview loaded")

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`preview-${scheme}-loaded.png`) })
    } finally {
      fixture.close()
    }
  })

  test(`P02 ${scheme} states a refusing site and an unreachable address without blanking`, async ({ page }) => {
    const refusing = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY" })
      response.end(page_("<h1>no embedding</h1>"))
    })
    try {
      await page.setViewportSize({ width, height: 900 })
      const preview = await openPreview(page)

      await preview.address.fill(refusing.url)
      await preview.address.press("Enter")
      await expect(preview.status).toContainText("refuse embedding", { timeout: 15000 })
      await expect(page.getByRole("button", { name: "Open in browser", exact: true })).toBeEnabled()
      await expect(preview.frame).toBeVisible()

      const closed = await listen(() => {})
      closed.close()
      await preview.address.fill(closed.url)
      await preview.address.press("Enter")
      await expect(preview.status).toHaveText("Nothing is answering at this address", { timeout: 15000 })
      await expect(preview.address).toHaveValue(closed.url)

      await page.screenshot({ path: test.info().outputPath(`preview-${scheme}-failure.png`) })
    } finally {
      refusing.close()
    }
  })

  test(`P03 ${scheme} rejects an unsupported scheme and stays keyboard operable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const preview = await openPreview(page)

    await preview.address.fill("file:///etc/passwd")
    await preview.address.press("Enter")
    await expect(preview.status).toHaveText("Only http and https addresses can be previewed")
    await expect(preview.frame).toHaveCount(0)

    await preview.address.focus()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: "Load", exact: true })).toBeFocused()

    await page.getByRole("tab", { name: "Preview", exact: true }).focus()
    await expect(page.getByRole("tab", { name: "Preview", exact: true })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
