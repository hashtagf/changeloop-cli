import { expect, story } from "../../stories/playwright/story"

story("lists saved notes by title with their path, a saved badge and the modified time", async ({ mount }) => {
  const view = await mount("app-changes-workspace--notes")
  const rows = view.getByRole("list", { name: "Saved investigations" }).getByRole("listitem")

  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText("Search options")
  await expect(rows.nth(0)).not.toContainText("Investigation:")
  await expect(rows.nth(0)).toContainText("openspec/investigations/search.md")
  await expect(rows.nth(0)).toContainText("Note saved")
})

story("says why the notes list is empty and pages with the offset from the index", async ({ mount }) => {
  await expect((await mount("app-changes-workspace--notes-empty")).getByText("No saved investigations.")).toBeVisible()
  await expect(
    (await mount("app-changes-workspace--notes-search-empty")).getByText("No saved notes match your search."),
  ).toBeVisible()

  const paged = await mount("app-changes-workspace--notes-paged")
  await expect(paged.getByRole("button", { name: "Previous notes" })).toBeDisabled()
  await expect(paged.getByText("120 saved notes")).toBeVisible()
  await paged.getByRole("button", { name: "Next notes" }).click()
  await expect(paged.locator('[data-slot="story-offset"]')).toHaveText("50")
})

story("opens a note in its own reader with section navigation and a focused excerpt", async ({ mount }) => {
  const view = await mount("app-changes-workspace--notes")

  await view.getByRole("button", { name: /Search options/ }).click()
  const sections = view.getByRole("navigation", { name: "Document sections" })

  await expect(view.getByRole("button", { name: "Back to investigations" })).toBeVisible()
  await expect(view.getByRole("heading", { level: 1, name: "Search options" })).toBeVisible()
  // The excerpt opens on Findings and leaves the sibling section out.
  await expect(sections.getByRole("button", { name: "Findings" })).toHaveAttribute("aria-current", "location")
  await expect(view.locator('[data-component="document-markdown"]')).toContainText("Index on write")
  await expect(view.locator('[data-component="document-markdown"]')).not.toContainText("Scan on read")

  await sections.getByRole("button", { name: "Options" }).click()
  await expect(view.locator('[data-component="document-markdown"]')).toContainText("Scan on read")

  await view.getByRole("button", { name: "Full source text" }).click()
  await expect(view.locator("pre")).toContainText("# Search options")
})

story("follows a link to another part of the note by switching the excerpt", async ({ mount }) => {
  const view = await mount("app-changes-workspace--note-reader")
  const markdown = view.locator('[data-component="document-markdown"]')

  await expect(markdown).not.toContainText("Scan on read")
  await markdown.getByRole("link", { name: "options" }).click()
  await expect(markdown).toContainText("Scan on read")
  await expect(view.getByRole("navigation", { name: "Document sections" }).getByRole("button", { name: "Options" })).toHaveAttribute(
    "aria-current",
    "location",
  )
})

story("opens another document at the heading a link names", async ({ mount }) => {
  const view = await mount("app-changes-workspace--documents")

  await view.getByRole("navigation", { name: "Source documents" }).getByRole("button", { name: "design.md" }).click()
  await view.locator('[data-component="document-markdown"]').getByRole("link", { name: "reason" }).click()
  await expect(view.getByText("Source: openspec/changes/alpha/proposal.md")).toBeVisible()
  // The heading the fragment names is the one scrolled to; its id is the server's section id.
  await expect(view.locator('[data-component="document-markdown"] h2#line-3')).toHaveText("Why")
  await expect(view.locator('[data-component="document-markdown"] h2#line-3')).toBeInViewport()
})

story("follows an exact change reference and says when a note has none", async ({ mount }) => {
  const view = await mount("app-changes-workspace--note-reader")

  await view.getByRole("button", { name: /Open 2026-10-01-add-search/ }).click()
  await expect(view.locator('[data-slot="story-log"]')).toHaveText("reference 2026-10-01-add-search archive")

  const none = await mount("app-changes-workspace--note-without-references")
  await expect(none.getByText("No explicit change reference found.", { exact: false })).toBeVisible()
})

story("hands a note to a draft command without submitting anything", async ({ mount }) => {
  const view = await mount("app-changes-workspace--note-reader")

  await view.getByRole("button", { name: "Continue investigation" }).click()
  await expect(view.locator('[data-slot="story-log"]')).toHaveText("draft /investigate openspec/investigations/search.md")
  await view.getByRole("button", { name: "Draft change" }).click()
  await expect(view.locator('[data-slot="story-log"]')).toHaveText("draft /change openspec/investigations/search.md")
})

story("renders a note's Markdown safely and keeps provenance behind a disclosure", async ({ mount }) => {
  const view = await mount("app-changes-workspace--note-reader")
  const markdown = view.locator('[data-component="document-markdown"]')

  // The relative link to an indexed note stays a link; nothing else becomes active content.
  await expect(markdown.getByRole("link", { name: "auth" })).toBeVisible()
  await expect(markdown.locator("script, img, iframe")).toHaveCount(0)
  await view.getByText("Source: openspec/investigations/search.md").click()
  await expect(view.getByText("SHA-256: 0123abcd")).toBeVisible()
  await expect(view.getByText("Content identity, not a proof receipt.")).toBeVisible()
})

story("shows the Why of the proposal, snapshot facts and shortcuts to the agreement documents", async ({ mount }) => {
  const view = await mount("app-changes-workspace--overview")

  await expect(view.getByRole("heading", { name: "Why" })).toBeVisible()
  await expect(view.locator('[data-component="document-markdown"]')).toContainText("Users cannot find changes.")
  await expect(view.locator('[data-component="document-markdown"]')).not.toContainText("A search box.")

  const facts = view.getByLabel("Change facts")
  await expect(facts).toContainText("build")
  await expect(facts).toContainText("change/alpha")
  // Revision and blockers are not in the API and are never guessed.
  await expect(facts.locator("div", { hasText: "Contract revision" })).toContainText("Unavailable")
  await expect(facts.locator("div", { hasText: "Blockers" })).toContainText("Unavailable")

  const shortcuts = view.getByRole("navigation", { name: "Agreement documents" })
  await expect(shortcuts.getByRole("button")).toHaveText([
    "proposal.md ↗",
    "design.md ↗",
    "tasks.md ↗",
    "evidence.yaml ↗",
  ])
})

story("keeps the snapshot facts when the proposal cannot be read", async ({ mount }) => {
  const view = await mount("app-changes-workspace--overview-without-proposal")

  await expect(view.getByRole("alert")).toContainText("This document exceeds the supported size.")
  await expect(view.getByText("Proposal summary unavailable.")).toBeVisible()
  await expect(view.getByLabel("Change facts")).toContainText("build")
})

story("lists the agreement documents beside the reader and follows links between them", async ({ mount }) => {
  const view = await mount("app-changes-workspace--documents")
  const files = view.getByRole("navigation", { name: "Source documents" })

  await expect(files.getByRole("button")).toHaveText(["proposal.md", "design.md", "tasks.md", "evidence.yaml"])
  await files.getByRole("button", { name: "design.md" }).click()
  const markdown = view.locator('[data-component="document-markdown"]')

  await expect(markdown.getByRole("link", { name: "tasks" })).toBeVisible()
  // A link outside the indexed documents keeps its label and says it is unavailable.
  await expect(markdown).toContainText("outside")
  await expect(markdown).toContainText("link unavailable")
  await expect(markdown.getByRole("link", { name: "outside" })).toHaveCount(0)

  await markdown.getByRole("link", { name: "tasks" }).click()
  await expect(view.getByText("Source: openspec/changes/alpha/tasks.md")).toBeVisible()
})

story("shows the task checklist as the document's own declaration, not as proof", async ({ mount }) => {
  const view = await mount("app-changes-workspace--tasks")

  await expect(view.getByText("1/3 checked · Checklist only, not proof.")).toBeVisible()
  const items = view.getByRole("list", { name: "Task checklist" }).getByRole("listitem")
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText("☑ Build the box")
  await expect(items.nth(1)).toContainText("☐ Wire it")
  // The harness's metadata stays out of the summary and is kept in the expanded source line.
  await expect(items.nth(1).locator("summary")).not.toContainText("[key:wire]")
})

story("shows evidence claims as declared obligations", async ({ mount }) => {
  const view = await mount("app-changes-workspace--claims")

  await expect(view.getByText("Declared obligations from evidence.yaml; not recorded test results.")).toBeVisible()
  await expect(view.getByText("box", { exact: true })).toBeVisible()
})

story("reports an unreadable index with a reason and a retry while staying usable", async ({ mount }) => {
  const view = await mount("app-changes-workspace--index-unavailable")

  await expect(view.getByRole("alert")).toContainText("Document read unavailable (The project read timed out.).")
  await expect(view.getByRole("button", { name: "Retry document read" })).toBeVisible()
  await expect(view.getByRole("button", { name: "Refresh documents" })).toBeVisible()
})

story("explains the data sources in a dialog", async ({ mount, page }) => {
  const view = await mount("app-changes-workspace--note-reader")

  await view.getByRole("button", { name: "Data sources" }).click()
  const dialog = page.getByRole("dialog")

  await expect(dialog).toContainText("openspec/investigations/*.md")
  await expect(dialog).toContainText("A digest identifies content; it is not a proof receipt.")
})
