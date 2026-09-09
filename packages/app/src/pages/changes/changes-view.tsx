import { For, Match, Show, Switch, type JSX } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { changesFailureText, type ChangeItem, type ChangeSelection } from "./changes-reader"
import type { ChangesState } from "./changes-refresh"

export function ChangesView(props: {
  state: ChangesState
  selection: ChangeSelection
  section: string
  onSelect: (changeID?: string) => void
  onSection: (section: string) => void
  onScope: (scope: "active" | "archive") => void
  onSearch: (search: string) => void
  onPage: (offset: number) => void
  onRefresh: () => void
  onContinue: (item: ChangeItem) => void
  onNew: () => void
  draftPending?: boolean
  draftError?: string
  documents?: JSX.Element
  onInvestigations: () => void
}) {
  const page = () => props.state.data?.data
  const detail = () => props.state.data?.detail ?? page()?.items.find((item) => item.id === props.selection.changeID)
  return (
    <section class="min-w-0 py-6 lg:py-10" aria-label="Changes">
      <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-[20px] font-medium text-v2-text-text-base">Changes</h1>
        <ButtonV2 variant="ghost" disabled={props.draftPending} onClick={props.onNew}>
          New change
        </ButtonV2>
        <ButtonV2 variant="outline" disabled={props.state.loading} onClick={props.onRefresh}>
          Refresh
        </ButtonV2>
      </header>
      <div class="mb-4 flex gap-2" role="group" aria-label="Change scope">
        <ButtonV2 variant="ghost" onClick={props.onInvestigations}>
          Investigations
        </ButtonV2>
        <ButtonV2
          variant={props.selection.scope === "active" ? "neutral" : "ghost"}
          aria-pressed={props.selection.scope === "active"}
          onClick={() => props.onScope("active")}
        >
          Active
        </ButtonV2>
        <ButtonV2
          variant={props.selection.scope === "archive" ? "neutral" : "ghost"}
          aria-pressed={props.selection.scope === "archive"}
          onClick={() => props.onScope("archive")}
        >
          Archived
        </ButtonV2>
      </div>
      <input
        class="mb-4 h-9 w-full min-w-0 rounded-md border border-v2-border-border-base bg-transparent px-3 text-v2-text-text-base focus-visible:outline-2"
        type="search"
        aria-label="Search changes"
        placeholder="Search changes"
        value={props.selection.search}
        onInput={(event) => props.onSearch(event.currentTarget.value)}
      />
      <Show when={props.state.error}>
        {(error) => (
          <div role="alert" class="mb-4 rounded-md border border-v2-border-border-base p-3">
            <p>{changesFailureText(error())}</p>
            <Show when={props.state.stale}>
              <p>Showing stale data from the last successful read.</p>
            </Show>
            <ButtonV2 variant="ghost" onClick={props.onRefresh}>
              Retry
            </ButtonV2>
          </div>
        )}
      </Show>
      <Show when={props.state.loading}>
        <p role="status" class="mb-3 text-v2-text-text-muted">
          {page() ? "Refreshing…" : "Loading changes…"}
        </p>
      </Show>
      <Show when={page()}>
        {(data) => (
          <>
            <p class="mb-3 break-words text-[12px] text-v2-text-text-muted">
              Snapshot: <time>{data().generatedAt}</time>
              {props.state.stale ? " · Stale" : ""}
            </p>
            <For each={data().diagnostics}>
              {(diagnostic) => (
                <p role="status" class="mb-2 text-v2-text-text-muted">
                  {diagnostic}
                </p>
              )}
            </For>
            <Show when={props.selection.scope === "archive"}>
              <p class="mb-4 text-v2-text-text-muted">
                Delivered history. Unavailable current verification does not undo delivery.
              </p>
            </Show>
            <Show
              when={!props.selection.changeID}
              fallback={
                <Show when={detail()}>
                  {(item) => (
                    <ChangeDetails
                      item={item()}
                      section={props.section}
                      onSection={props.onSection}
                      onBack={() => props.onSelect()}
                      onContinue={() => props.onContinue(item())}
                      draftPending={props.draftPending}
                      draftError={props.draftError}
                      documents={props.documents}
                    />
                  )}
                </Show>
              }
            >
              <Show
                when={data().items.length}
                fallback={
                  <p class="py-8 text-v2-text-text-muted">
                    {props.selection.search
                      ? "No changes match your search."
                      : props.selection.scope === "archive"
                        ? "No archived changes."
                        : "No active changes."}
                  </p>
                }
              >
                <ul aria-label="Project changes" class="divide-y divide-v2-border-border-base">
                  <For each={data().items}>
                    {(item) => (
                      <li>
                        <button
                          type="button"
                          class="w-full min-w-0 rounded-md px-2 py-3 text-left hover:bg-v2-background-bg-layer-01 focus-visible:outline-2"
                          onClick={() => props.onSelect(item.id)}
                        >
                          <span class="block break-words font-medium text-v2-text-text-base">
                            {item.title || item.id}
                          </span>
                          <span class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-v2-text-text-muted">
                            <span>Phase: {item.phase || "Unavailable"}</span>
                            <span>Status: {item.status}</span>
                            <span>Evidence: {item.evidenceStatus ?? item.evidence?.status ?? "Unavailable"}</span>
                            <span>Updated: {item.updatedAt ?? "Unavailable"}</span>
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <nav aria-label="Changes pages" class="mt-4 flex flex-wrap items-center gap-3">
                <ButtonV2
                  variant="ghost"
                  disabled={props.selection.offset === 0}
                  onClick={() => props.onPage(Math.max(0, props.selection.offset - 50))}
                >
                  Previous
                </ButtonV2>
                <span>{data().total} changes</span>
                <ButtonV2
                  variant="ghost"
                  disabled={data().nextOffset === null}
                  onClick={() => props.onPage(data().nextOffset ?? 0)}
                >
                  Next
                </ButtonV2>
              </nav>
            </Show>
          </>
        )}
      </Show>
      <Show when={props.selection.changeID && !detail()}>{props.documents}</Show>
    </section>
  )
}

function ChangeDetails(props: {
  item: ChangeItem
  section: string
  onSection: (section: string) => void
  onBack: () => void
  onContinue: () => void
  draftPending?: boolean
  draftError?: string
  documents?: JSX.Element
}) {
  return (
    <article class="min-w-0">
      <ButtonV2 variant="ghost" onClick={props.onBack}>
        Back to changes
      </ButtonV2>
      <h2 class="my-4 break-words text-[18px] font-medium">{props.item.title || props.item.id}</h2>
      <ButtonV2 class="mb-4" variant="outline" disabled={props.draftPending} onClick={props.onContinue}>
        {props.draftPending ? "Preparing draft…" : "Continue in session"}
      </ButtonV2>
      <Show when={props.draftError}>
        {(message) => (
          <p role="alert" class="mb-4">
            {message()}
          </p>
        )}
      </Show>
      <nav
        class="mb-5 flex flex-wrap gap-2"
        aria-label="Change details"
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
          const buttons = Array.from(event.currentTarget.querySelectorAll("button"))
          const index = buttons.indexOf(event.target as HTMLButtonElement)
          if (index < 0) return
          event.preventDefault()
          const next = buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]
          next?.focus()
          next?.click()
        }}
      >
        <For each={["overview", "documents", "tasks", "evidence", "usage"]}>
          {(section) => (
            <ButtonV2
              variant={section === props.section ? "neutral" : "ghost"}
              aria-current={section === props.section ? "page" : undefined}
              onClick={() => props.onSection(section)}
            >
              {section[0].toUpperCase() + section.slice(1)}
            </ButtonV2>
          )}
        </For>
      </nav>
      <Switch>
        <Match when={props.section === "overview"}>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3">
            <dt>Phase</dt>
            <dd>{props.item.phase || "Unavailable"}</dd>
            <dt>Lifecycle status</dt>
            <dd>{props.item.status}</dd>
            <dt>Updated</dt>
            <dd class="break-words">{props.item.updatedAt ?? "Unavailable"}</dd>
          </dl>
          <p class="mt-5 text-[12px] text-v2-text-text-muted">Source: Foundation snapshot</p>
        </Match>
        <Match when={props.section === "evidence"}>
          <Show when={props.item.evidence} fallback={<p>Evidence is unavailable.</p>}>
            {(evidence) => (
              <>
                <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3">
                  <dt>Recorded status</dt>
                  <dd>{evidence().recordedStatus ?? "Unavailable"}</dd>
                  <dt>Current status</dt>
                  <dd>{evidence().status}</dd>
                  <dt>Freshness</dt>
                  <dd>{evidence().freshness}</dd>
                </dl>
                <ul class="mt-5">
                  <For each={evidence().providers}>
                    {(provider) => (
                      <li class="break-words">
                        {provider.provider}: {provider.status}
                      </li>
                    )}
                  </For>
                </ul>
                <p class="mt-5 text-[12px] text-v2-text-text-muted">
                  Source: Foundation snapshot. Recorded results and current freshness are independent.
                </p>
              </>
            )}
          </Show>
        </Match>
        <Match when={props.section === "usage"}>
          <Show when={props.item.budget} fallback={<p>Usage is unavailable.</p>}>
            {(budget) => (
              <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3">
                <dt>Lifetime requests</dt>
                <dd>{budget().lifetime.usedRequests ?? "Unavailable"}</dd>
                <dt>Lifetime tokens</dt>
                <dd>{budget().lifetime.usedTokens ?? "Unavailable"}</dd>
                <dt>Window requests</dt>
                <dd>{budget().window.usedRequests ?? "Unavailable"}</dd>
                <dt>Window tokens</dt>
                <dd>{budget().window.usedTokens ?? "Unavailable"}</dd>
                <dt>Request target</dt>
                <dd>{budget().window.targetRequests ?? "Unavailable"}</dd>
                <dt>Token target</dt>
                <dd>{budget().window.targetTokens ?? "Unavailable"}</dd>
              </dl>
            )}
          </Show>
          <Show when={props.item.run}>
            <p class="mt-4 break-words">Run branch: {props.item.run?.branch ?? "Unavailable"}</p>
            <For each={Object.entries(props.item.run?.operationMs ?? {})}>
              {([phase, ms]) => (
                <p>
                  {phase}: {ms} ms
                </p>
              )}
            </For>
          </Show>
          <p class="mt-5 text-[12px] text-v2-text-text-muted">
            Source: Foundation snapshot. Missing measurements are unavailable.
          </p>
        </Match>
      </Switch>
      <Show when={props.section !== "usage"}>{props.documents}</Show>
    </article>
  )
}
