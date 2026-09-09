import { For, Show, type JSX } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"

export function WorkflowTrack(props: { phase?: string; onInvestigations?: () => void }) {
  return (
    <nav
      aria-label="Foundation workflow"
      class="mb-5 flex flex-wrap items-center gap-2 text-[12px] leading-[18px] text-v2-text-text-muted"
      classList={{ "!mb-6 border-b border-v2-border-border-base !gap-0": !!props.onInvestigations }}
    >
      <For each={["Investigate", "Change", "Build", "Prove", "Land"]}>
        {(phase, index) => (
          <>
            <Show when={index() > 0 && !props.onInvestigations}>
              <span aria-hidden="true">→</span>
            </Show>
            <Show
              when={phase === "Investigate" && props.onInvestigations}
              fallback={
                <span
                  class="px-1 py-1"
                  classList={{
                    "flex-1 border-b-2 border-transparent px-1.5 !py-3": !!props.onInvestigations,
                    "!border-v2-text-text-base text-v2-text-text-base":
                      props.phase?.toLowerCase() === phase.toLowerCase(),
                  }}
                  aria-current={props.phase?.toLowerCase() === phase.toLowerCase() ? "step" : undefined}
                >
                  {phase}
                </span>
              }
            >
              <button
                type="button"
                class="flex-1 px-1.5 py-3 text-left hover:text-v2-text-text-base focus-visible:outline-2"
                onClick={props.onInvestigations}
              >
                Investigate ↗
              </button>
            </Show>
          </>
        )}
      </For>
    </nav>
  )
}

export function ChangesHeading(props: {
  project: string
  scope: string
  search: string
  counts: Partial<Record<"investigations" | "active" | "archive", number>>
  onScope: (scope: "investigations" | "active" | "archive") => void
  onSearch: (search: string) => void
  onNew: () => void
  pending?: boolean
  tools?: JSX.Element
}) {
  return (
    <header data-component="changes-heading">
      <div class="mb-5 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="mb-1 truncate text-[12px] text-v2-text-text-muted">{props.project}</p>
          <h1 class="text-[20px] [font-weight:530]">Changes</h1>
        </div>
        <ButtonV2 variant="ghost" onClick={props.onNew} disabled={props.pending} aria-label="New investigate">
          + Investigate
        </ButtonV2>
      </div>
      <WorkflowTrack />
      <input
        type="search"
        aria-label={props.scope === "investigations" ? "Search investigations" : "Search changes"}
        placeholder={props.scope === "investigations" ? "Search investigations" : "Search changes"}
        value={props.search}
        onInput={(event) => props.onSearch(event.currentTarget.value)}
        class="mb-4 h-9 w-full min-w-0 rounded-[6px] bg-v2-background-bg-layer-01 px-3 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus"
      />
      <div class="mb-1.5 flex flex-wrap items-center justify-between gap-x-3">
        <nav aria-label="Change scope" class="flex gap-4">
          <For each={["investigations", "active", "archive"] as const}>
            {(scope) => (
              <button
                type="button"
                aria-pressed={scope === props.scope}
                onClick={() => props.onScope(scope)}
                class="border-b-2 border-transparent py-2 text-[12px] leading-[18px] text-v2-text-text-muted focus-visible:outline-2"
                classList={{ "border-v2-text-text-base text-v2-text-text-base": scope === props.scope }}
              >
                {scope === "archive" ? "Archived" : scope[0].toUpperCase() + scope.slice(1)} ·{" "}
                {props.counts[scope] ?? "—"}
              </button>
            )}
          </For>
        </nav>
        {props.tools}
      </div>
    </header>
  )
}

export function sourceTime(value?: string | null) {
  if (!value) return "Unavailable"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}
