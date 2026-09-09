import { expect, test } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import pkg from "../../package.json"

const directory = process.env.FOUNDATION_TEST_DIRECTORY
const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT}`
const notePath = "openspec/investigations/interface.md"
if (process.env.FOUNDATION_TEST_PASSWORD)
  test.use({ httpCredentials: { username: "opencode", password: process.env.FOUNDATION_TEST_PASSWORD } })
function href(extra: Record<string, string> = {}) {
  if (!directory) throw new Error("Compiled document fixture is required")
  return `/changes?${new URLSearchParams({ server, directory, ...extra })}`
}
test.beforeAll(async () => {
  if (!directory) throw new Error("Required fixture missing")
  const files = {
    [notePath]:
      '# Interface research\n\n## Findings\nSaved source wording.\n\n## Options\nKeep the production grid.\n\n<script>window.readerAttack = true</script>\n<svg onload="window.readerAttack=true"></svg>\n![remote image](https://reader-image.invalid/spy.png)\n[unsafe](javascript:alert(1))\n[encoded](javascript&#58;alert(1))\n[malformed](#%E0%A4%A)\n[external reference](https://example.com/reference)\n\n| ' +
      "Wide table column ".repeat(35) +
      " | Value |\n| --- | --- |\n| Cell | Data |",
    "openspec/changes/webui-active/proposal.md":
      "# Interface agreement\n\n## Why\nKeep research and proof traceable.\n\n[Research](../../investigations/interface.md)\n[Design](design.md)\n",
    "openspec/changes/webui-active/design.md":
      "# Implementation design\n\nSetext\n===\n\n  ## Indented\n\n> ## Test cases\n\n- ## List heading\n\n#\r\n\r## Test cases\nF05: Markdown is inert.\n\n## Sources\nUse real document metadata.\n",
    "openspec/changes/webui-active/tasks.md":
      "# Tasks\n\n- [x] T001 Read documents [claims:safe-reader]\n- [ ] T002 Verify browser [paths:packages/app/**]\n",
    "openspec/changes/webui-active/evidence.yaml":
      "claims:\n  - id: safe-reader\n    description: Document HTML remains inert\n",
    "openspec/changes/archive/2026-09-09-webui-archived/proposal.md":
      "# Archived agreement\n\n## Why\nHistorical text remains readable.\n",
    "reader-only/opencode.json": JSON.stringify({ foundation_runtime: "path" }),
    "reader-only/openspec/investigations/offline.md":
      "# Offline research\n\nReaders work without a runtime installation.\n",
  }
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
    await writeFile(path.join(directory, file), text)
  }
})
test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ version, dark }) => {
      localStorage.setItem("app-version.v1", JSON.stringify({ version }))
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
      )
      localStorage.setItem("opencode-color-scheme", dark ? "dark" : "light")
    },
    { version: pkg.version, dark: info.title.includes("dark") },
  )
})

for (const scheme of ["light", "dark"]) {
  test(`F05/F07 ${scheme} saved notes render inert content with contained mobile scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: scheme === "light" ? 390 : 1440, height: 900 })
    const remote: string[] = []
    page.on("request", (request) => {
      if (request.url().includes("reader-image.invalid")) remote.push(request.url())
    })
    await page.goto(href())
    await page.getByRole("button", { name: "Interface research", exact: false }).click()
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily)).toContain("sans-serif")
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--v2-text-text-base").trim(),
      ),
    ).not.toBe("")
    const reader = page.getByRole("article", { name: "Document reader" })
    await expect(reader.getByText("Saved source wording.", { exact: true })).toBeVisible()
    await expect(reader.locator("script, svg, img, iframe, form")).toHaveCount(0)
    expect(await page.evaluate(() => Reflect.get(window, "readerAttack"))).toBeUndefined()
    expect(remote).toEqual([])
    await expect(reader.locator('a[href^="javascript:"]')).toHaveCount(0)
    await expect(reader.getByRole("link", { name: "external reference" })).toHaveAttribute("rel", "noopener noreferrer")
    await page.getByRole("combobox", { name: "Document section" }).selectOption({ label: "Options" })
    await expect(page).toHaveURL(/anchor=line-/)
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await page.getByRole("link", { name: "Changes", exact: true }).click()
    await expect(page.getByRole("combobox", { name: "Document section" })).toHaveValue("line-6")
    const sources = page.getByRole("button", { name: "Data sources", exact: true })
    await sources.click()
    await expect(page.getByRole("dialog")).toContainText("digest identifies content")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(sources).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`documents-${scheme}.png`), fullPage: true })
  })
}

test("V01/V02 exact references open real documents, task checkboxes and separate evidence", async ({ page }) => {
  await page.goto(href())
  await page.getByRole("button", { name: "Interface research", exact: false }).click()
  await page.getByRole("button", { name: /Open webui-active — referenced by/ }).click()
  await expect(page.getByRole("article", { name: "Document reader" })).toContainText(
    "Keep research and proof traceable.",
  )
  await page
    .getByRole("article", { name: "Document reader" })
    .getByRole("link", { name: "Design", exact: true })
    .click()
  await page.getByRole("button", { name: "Planned tests: Test cases", exact: true }).click()
  await expect(page.getByRole("article", { name: "Document reader" })).toContainText("F05: Markdown is inert.")
  const markdown = page.locator('[data-component="document-markdown"]')
  await expect(markdown.locator("#line-14")).toHaveText("Test cases")
  await expect(markdown.locator("#line-17")).toHaveText("Sources")
  await expect(markdown.locator("blockquote h2")).not.toHaveAttribute("id")
  await expect(markdown.locator("[id]")).toHaveCount(3)
  await page.getByRole("button", { name: "Tasks", exact: true }).click()
  await expect(page.getByText("1/2 checked · Checklist only, not proof.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Tasks", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByText("Recorded status", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Declared obligations from evidence.yaml; not recorded test results.", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText("safe-reader", { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByText("1/2 checked · Checklist only, not proof.", { exact: true })).toBeVisible()
})

test("V03 all investigation actions create editable drafts without submitting", async ({ page }) => {
  const submitted: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/session(?:\/|$)/.test(new URL(request.url()).pathname))
      submitted.push(request.url())
  })
  for (const [button, prompt] of [
    ["Continue investigation", `/investigate ${notePath}`],
    ["Draft change", `/change ${notePath}`],
    ["New investigate", "/investigate"],
  ]) {
    await page.goto(href())
    if (button !== "New investigate")
      await page.getByRole("button", { name: "Interface research", exact: false }).click()
    await page.getByRole("button", { name: button, exact: true }).click()
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveText(prompt)
  }
  expect(submitted).toEqual([])
})

test("V04 archive and reader-only projects remain readable without runtime proof", async ({ page }) => {
  await page.goto(href({ scope: "archive", change: "webui-archived", section: "documents" }))
  await expect(page.getByRole("article", { name: "Document reader" })).toContainText(
    "Historical text remains readable.",
  )
  await page.goto(href({ directory: path.join(directory!, "reader-only") }))
  await page.getByRole("button", { name: "Offline research", exact: false }).click()
  await expect(page.getByRole("article", { name: "Document reader" })).toContainText(
    "Readers work without a runtime installation.",
  )
})

test("F06/V04 same-document stale errors preserve content and missing readers stay explicit", async ({ page }) => {
  await page.goto(href())
  await page.getByRole("button", { name: "Interface research", exact: false }).click()
  await expect(page.getByRole("article", { name: "Document reader" })).toBeVisible()
  await page.route("**/experimental/foundation/investigations*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "reader unavailable" }),
    }),
  )
  await page.getByRole("button", { name: "Refresh documents", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("Showing stale content")
  await expect(page.getByRole("article", { name: "Document reader" })).toBeVisible()
  await page.goto(href({ directory: path.join(directory!, "reader-only") }))
  await expect(page.getByRole("alert")).toContainText("Document read unavailable")
  await expect(page.getByRole("article", { name: "Document reader" })).toHaveCount(0)
})
