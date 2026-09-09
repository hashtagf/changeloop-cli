import { For, Match, Show, Switch, type JSX } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { changesFailureText, type ChangeItem, type ChangeSelection } from "./changes-reader"
import { WorkflowTrack, sourceTime } from "./changes-layout"
import { DataSourcesButton } from "./document-workspace"
import type { ChangesState } from "./changes-refresh"

export function ChangesView(props: {
  heading?: JSX.Element
  title?: string
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
    <section class="min-w-0 py-6 lg:pb-12 lg:pt-14" aria-label="Changes">
      <Show when={!props.selection.changeID}>{props.heading}</Show>
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
            <For each={data().diagnostics}>
              {(diagnostic) => (
                <p role="status" class="mb-2 text-v2-text-text-muted">
                  {diagnostic}
                </p>
              )}
            </For>
            <Show when={props.selection.scope === "archive" && !props.selection.changeID}>
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
                      title={props.title}
                      onInvestigations={props.onInvestigations}
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
                          class="w-full min-w-0 rounded-md px-2 py-4 text-left hover:bg-v2-background-bg-layer-01 focus-visible:outline-2"
                          onClick={() => props.onSelect(item.id)}
                        >
                          <span class="block break-words font-medium text-v2-text-text-base">
                            {item.title || item.id}
                          </span>
                          <span class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-v2-text-text-muted">
                            <span>Phase: {item.phase || "Unavailable"}</span>
                            <span>Status: {item.status}</span>
                            <span>Evidence: {item.evidenceStatus ?? item.evidence?.status ?? "Unavailable"}</span>
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={props.selection.offset > 0 || data().nextOffset !== null}>
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
            </Show>
            <footer class="mt-5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-v2-text-text-muted">
              <span title={data().generatedAt}>
                Snapshot {sourceTime(data().generatedAt)}
                {props.state.stale ? " · Stale" : ""}
              </span>
              <ButtonV2 variant="ghost" disabled={props.state.loading} onClick={props.onRefresh}>
                Refresh
              </ButtonV2>
            </footer>
          </>
        )}
      </Show>
      <Show when={props.selection.changeID && !detail()}>{props.documents}</Show>
    </section>
  )
}

function ChangeDetails(props: {
  item: ChangeItem
  title?: string
  onInvestigations: () => void
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
      <p class="mb-2 mt-5 break-words text-[12px] text-v2-text-text-muted">{props.item.id}</p>
      <h1 class="mb-3 break-words text-[20px] leading-7 [font-weight:530]">
        {(props.title || props.item.title || props.item.id).replace(/^Change:\s*/i, "")}
      </h1>
      <div class="mb-5 flex flex-wrap items-center gap-3 text-[12px] text-v2-text-text-muted">
        <span>{props.item.status}</span>
        <span>Updated {sourceTime(props.item.updatedAt)}</span>
        <DataSourcesButton class="ml-auto" />
      </div>
      <WorkflowTrack phase={props.item.phase} onInvestigations={props.onInvestigations} />
      <nav
        class="mb-6 flex gap-5 overflow-x-auto whitespace-nowrap border-b border-v2-border-border-base"
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
              variant="ghost"
              class="rounded-none border-b-2 border-transparent px-0 pb-3"
              style={{
                padding: "10px 0",
                "border-radius": "0",
                height: "auto",
                background: "transparent",
                "flex-shrink": "0",
              }}
              classList={{ "border-v2-text-text-base": section === props.section }}
              aria-current={section === props.section ? "page" : undefined}
              onClick={() => props.onSection(section)}
            >
              {section[0].toUpperCase() + section.slice(1)}
            </ButtonV2>
          )}
        </For>
      </nav>
      <Switch>
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
      <footer class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-v2-border-border-base pt-5">
        <div>
          <h2 class="mb-2 font-medium">Continue in a session</h2>
          <p class="text-[12px] text-v2-text-text-muted">Review the command draft before sending.</p>
        </div>{" "}
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
      </footer>
    </article>
  )
}
