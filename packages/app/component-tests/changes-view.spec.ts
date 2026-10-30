import { expect, story } from "../../stories/playwright/story"

story("lists changes by title or ID with phase, status, evidence and the snapshot time", async ({ mount }) => {
  const view = await mount("app-changes-view--list")
  const rows = view.getByRole("list", { name: "Project changes" }).getByRole("listitem")

  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText("Port the Changes web UI")
  await expect(rows.nth(0)).toContainText("Phase: build")
  await expect(rows.nth(0)).toContainText("Status: building")
  await expect(rows.nth(0)).toContainText("Evidence: unverified")
  // A change without a title is named by its ID, and without evidence it says so instead of showing a pass.
  await expect(rows.nth(1)).toContainText("no-measurements")
  await expect(rows.nth(1)).toContainText("Evidence: Unavailable")
  await expect(view.getByText(/^Snapshot /)).toBeVisible()
})

story("explains delivered history for archived changes and why an empty list is empty", async ({ mount }) => {
  const archived = await mount("app-changes-view--archived")
  await expect(archived.getByText("Delivered history.", { exact: false })).toBeVisible()
  await expect(archived.getByRole("button", { name: /^Archived/ })).toHaveAttribute("aria-pressed", "true")

  const empty = await mount("app-changes-view--empty")
  await expect(empty.getByText("No active changes.")).toBeVisible()
  await expect(empty.getByText("Delivered history.", { exact: false })).toHaveCount(0)
})

story("pages with the offset the page provides and keeps Previous off on the first page", async ({ mount }) => {
  const view = await mount("app-changes-view--paged")

  await expect(view.getByRole("button", { name: "Previous" })).toBeDisabled()
  await expect(view.getByText("120 changes")).toBeVisible()
  await view.getByRole("button", { name: "Next" }).click()
  await expect(view.locator('[data-slot="story-offset"]')).toHaveText("50")
})

story("shows unsupported and uninitialized projects as failures with Retry, never as an empty list", async ({ mount }) => {
  const unsupported = await mount("app-changes-view--unsupported")
  await expect(unsupported.getByRole("alert")).toContainText("Changes are not supported by this server or runtime.")
  await expect(unsupported.getByRole("button", { name: "Retry" })).toBeVisible()
  await expect(unsupported.getByText("No active changes.")).toHaveCount(0)

  const uninitialized = await mount("app-changes-view--not-initialized")
  await expect(uninitialized.getByRole("alert")).toContainText("Foundation is not initialized for this project.")
  await expect(uninitialized.getByText("No active changes.")).toHaveCount(0)
})

story("keeps the last list visible and marks it stale when a refresh fails", async ({ mount }) => {
  const view = await mount("app-changes-view--stale")

  await expect(view.getByRole("alert")).toContainText("Showing stale data from the last successful read.")
  await expect(view.getByText("Port the Changes web UI")).toBeVisible()
  await expect(view.getByText("· Stale", { exact: false })).toBeVisible()
})

story("announces the first read as Loading", async ({ mount }) => {
  const view = await mount("app-changes-view--loading")

  await expect(view.getByRole("status")).toHaveText("Loading changes…")
})

story("shows recorded status, current status and freshness separately and marks the current phase", async ({ mount }) => {
  const view = await mount("app-changes-view--detail")
  const workflow = view.getByRole("navigation", { name: "Foundation workflow" })

  await expect(workflow.locator("[aria-current=step]")).toHaveText("Build")
  await expect(workflow.locator("[aria-current=step]")).toHaveCount(1)

  await view.getByRole("button", { name: "Evidence" }).click()
  await expect(view.locator("dt")).toHaveText(["Recorded status", "Current status", "Freshness"])
  await expect(view.locator("dd")).toHaveText(["pass", "unverified", "unavailable"])
  await expect(view.getByText("test: pass")).toBeVisible()
})

story("shows unknown usage as Unavailable, not zero", async ({ mount }) => {
  const view = await mount("app-changes-view--detail")

  await view.getByRole("button", { name: "Usage" }).click()
  await expect(view.locator("dd")).toHaveText(["Unavailable", "1200", "3", "400", "Unavailable", "5000"])
  await expect(view.getByText("Run branch: change/port-changes-web-ui")).toBeVisible()
  await expect(view.getByText("build: 1500 ms")).toBeVisible()

  const bare = await mount("app-changes-view--detail-without-measurements")
  await expect(bare.getByText("Usage is unavailable.")).toBeVisible()
})

story("moves between the detail tabs with the arrow keys and wraps around", async ({ mount }) => {
  const view = await mount("app-changes-view--detail")
  const tabs = view.getByRole("navigation", { name: "Change details" }).getByRole("button")

  await expect(tabs).toHaveText(["Overview", "Documents", "Tasks", "Evidence", "Usage"])
  await tabs.nth(0).focus()
  await tabs.nth(0).press("ArrowRight")
  await expect(tabs.nth(1)).toBeFocused()
  await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page")
  await tabs.nth(1).press("ArrowLeft")
  await tabs.nth(0).press("ArrowLeft")
  await expect(tabs.nth(4)).toHaveAttribute("aria-current", "page")
})

story("continues in a session by handing the phase command to the caller", async ({ mount }) => {
  const view = await mount("app-changes-view--detail")

  await view.getByRole("button", { name: "Continue in session" }).click()
  await expect(view.locator('[data-slot="story-draft"]')).toHaveText("/build port-changes-web-ui")
})
