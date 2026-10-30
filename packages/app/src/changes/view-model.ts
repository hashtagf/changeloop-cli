import type { ChangeItem, ChangeSelection } from "./reader"

export const CHANGE_SECTIONS = ["overview", "documents", "tasks", "evidence", "usage"] as const

export type DocumentSection = { id: string; title: string; line: number; level: number }

/** The file a section of a change opens first. An empty name means the proposal, or the first file when it has none. */
export function preferredFile(section: ChangeSection) {
  if (section === "documents") return ""

  if (section === "tasks") return "tasks.md"

  if (section === "evidence") return "evidence.yaml"

  return "proposal.md"
}

/** The readable title of a proposal: its level-1 heading without a leading "Change:". */
export function proposalTitle(sections: readonly DocumentSection[]) {
  return sections
    .find((section) => section.level === 1)
    ?.title.replace(/^Change:\s*/i, "")
    .trim()
}

/** A note's title without the leading "Investigation:" the file name convention adds. */
export function noteTitle(title: string) {
  return title.replace(/^Investigation:\s*/i, "")
}

/** The last path segment of a document's source path. */
export function fileName(sourcePath: string) {
  return sourcePath.split("/").at(-1) ?? sourcePath
}

export function isArchivedReference(sourcePath: string) {
  return sourcePath.startsWith("openspec/changes/archive/")
}

/** Sections of a document that describe planned tests, offered as shortcuts. */
export function plannedTestSections(sections: readonly DocumentSection[]) {
  return sections.filter((section) => /test|verification|scenario/i.test(section.title))
}

/** How many checklist items are checked, as the document declares them. */
export function checklistCounts(tasks: readonly { checked: boolean }[]) {
  return { checked: tasks.filter((task) => task.checked).length, total: tasks.length }
}

/** A task line without the `[key:…]` metadata the harness appends. */
export function taskLabel(text: string) {
  return text.split(" [")[0]
}

export type ChangeSection = (typeof CHANGE_SECTIONS)[number]

export const WORKFLOW = ["investigate", "change", "build", "prove", "land"] as const

export type ChangeCategory = "investigations" | "active" | "archive"

/**
 * The category of the Changes screen. An explicit scope wins. Without one, a change in the address is read in the
 * category it belongs to (archive once it is archived, else active; active until its status is known), and with no
 * change the saved investigations are shown.
 */
export function categoryOf(input: { scope?: unknown; change?: string; status?: string }): ChangeCategory {
  if (input.scope === "active" || input.scope === "archive") return input.scope

  if (!input.change) return "investigations"

  return input.status === "archived" ? "archive" : "active"
}

export function changeSection(value: unknown): ChangeSection {
  return CHANGE_SECTIONS.find((section) => section === value) ?? "overview"
}

/** Why a list has no rows. A search names itself, otherwise the scope does. */
export function emptyKey(selection: Pick<ChangeSelection, "scope" | "search">) {
  if (selection.search) return "changes.empty.search"

  return selection.scope === "archive" ? "changes.empty.archive" : "changes.empty.active"
}

/** The current evidence status of a change, undefined when the snapshot did not carry one. */
export function evidenceStatus(item: Pick<ChangeItem, "evidenceStatus" | "evidence">) {
  return item.evidenceStatus ?? item.evidence?.status
}

/** A measurement as text. Unknown stays unknown; only a reported zero is shown as 0. */
export function measurement(value: string | number | null | undefined) {
  return value === null || value === undefined ? undefined : String(value)
}

/** The tab an arrow key moves to from `index`, wrapping at both ends. Other keys stay put. */
export function nextTab(index: number, count: number, key: string) {
  if (key === "ArrowRight") return (index + 1) % count

  if (key === "ArrowLeft") return (index + count - 1) % count

  return index
}

export function currentStep(phase: string | undefined, step: string) {
  return phase?.toLowerCase() === step
}
