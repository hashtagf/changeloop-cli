import type { ChangeItem, ChangeSelection } from "./reader"

export const CHANGE_SECTIONS = ["overview", "evidence", "usage"] as const

export type ChangeSection = (typeof CHANGE_SECTIONS)[number]

export const WORKFLOW = ["investigate", "change", "build", "prove", "land"] as const

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
