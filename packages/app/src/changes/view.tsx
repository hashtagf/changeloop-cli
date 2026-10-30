import { For, Match, Show, Switch, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { changesFailureKey, PAGE_SIZE, type ChangeItem, type ChangeSelection } from "./reader"
import type { ChangesState } from "./refresh"
import {
  CHANGE_SECTIONS,
  currentStep,
  emptyKey,
  evidenceStatus,
  measurement,
  nextTab,
  WORKFLOW,
  type ChangeSection,
} from "./view-model"

export function sourceTime(value?: string | null) {
  if (!value) return undefined
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

/**
 * The Foundation workflow strip. On a change (`onInvestigations` given) it is the underlined tab-style strip whose
 * first step returns to the saved investigations; on the list it is the plain arrow strip.
 */
export function WorkflowTrack(props: { phase?: string; onInvestigations?: () => void }) {
  const language = useLanguage()

  return (
    <nav
      aria-label={language.t("changes.workflow.label")}
      class="mb-5 flex flex-wrap items-center gap-2 text-[12px] leading-[18px] text-v2-text-text-muted"
      classList={{ "!mb-6 !gap-0 border-b border-v2-border-border-base": !!props.onInvestigations }}
    >
      <For each={WORKFLOW}>
        {(phase, index) => (
          <>
            <Show when={index() > 0 && !props.onInvestigations}>
              <span aria-hidden="true">→</span>
            </Show>
            <Show
              when={phase === "investigate" && props.onInvestigations}
              fallback={
                <span
                  class="px-1 py-1"
                  classList={{
                    "flex-1 border-b-2 border-transparent px-1.5 !py-3": !!props.onInvestigations,
                    "!border-v2-text-text-base text-v2-text-text-base [font-weight:530]": currentStep(
                      props.phase,
                      phase,
                    ),
                  }}
                  aria-current={currentStep(props.phase, phase) ? "step" : undefined}
                >
                  {language.t(`changes.workflow.${phase}`)}
                </span>
              }
            >
              <button
                type="button"
                class="flex-1 px-1.5 py-3 text-left hover:text-v2-text-text-base focus-visible:outline-2"
                onClick={props.onInvestigations}
              >
                {language.t("changes.workflow.investigate.open")}
              </button>
            </Show>
          </>
        )}
      </For>
    </nav>
  )
}

export type ChangeCategory = "investigations" | ChangeSelection["scope"]

export function ChangesHeading(props: {
  project: string
  scope: ChangeCategory
  search: string
  /** The number of entries of each category, or undefined while unknown. */
  counts: Partial<Record<ChangeCategory, number>>
  onScope: (scope: ChangeCategory) => void
  onSearch: (search: string) => void
  onNew: () => void
  pending?: boolean
  tools?: JSX.Element
}) {
  const language = useLanguage()
  const searchLabel = () =>
    language.t(props.scope === "investigations" ? "changes.search.investigations" : "changes.search")

  return (
    <header data-component="changes-heading">
      <div class="mb-5 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="mb-1 truncate text-[12px] leading-[16px] text-v2-text-text-muted">{props.project}</p>
          <h1 class="text-[20px] leading-[28px] [font-weight:530]">{language.t("changes.title")}</h1>
        </div>
        <Button
          variant="ghost"
          onClick={props.onNew}
          disabled={props.pending}
          aria-label={language.t("changes.new.label")}
        >
          {language.t("changes.new")}
        </Button>
      </div>
      <WorkflowTrack />
      <input
        type="search"
        aria-label={searchLabel()}
        placeholder={searchLabel()}
        value={props.search}
        onInput={(event) => props.onSearch(event.currentTarget.value)}
        class="mb-4 h-9 w-full min-w-0 rounded-[6px] bg-v2-background-bg-layer-01 px-3 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus"
      />
      <div class="mb-1.5 flex flex-wrap items-center justify-between gap-x-3">
        <nav aria-label={language.t("changes.scope.label")} class="flex gap-4">
          <For each={["investigations", "active", "archive"] as const}>
            {(scope) => (
              <button
                type="button"
                aria-pressed={scope === props.scope}
                onClick={() => props.onScope(scope)}
                class="border-b-2 border-transparent py-2 text-[12px] leading-[18px] text-v2-text-text-muted focus-visible:outline-2"
                classList={{ "!border-v2-text-text-base !text-v2-text-text-base": scope === props.scope }}
              >
                {props.counts[scope] === undefined
                  ? language.t("changes.scope.countUnavailable", { label: language.t(`changes.scope.${scope}`) })
                  : language.t("changes.scope.count", {
                      label: language.t(`changes.scope.${scope}`),
                      count: props.counts[scope],
                    })}
              </button>
            )}
          </For>
        </nav>
        {props.tools}
      </div>
    </header>
  )
}

export function ChangesView(props: {
  heading?: JSX.Element
  state: ChangesState
  selection: ChangeSelection
  section: ChangeSection
  onSelect: (changeID?: string) => void
  onSection: (section: ChangeSection) => void
  onPage: (offset: number) => void
  onRefresh: () => void
  onContinue: (item: ChangeItem) => void
  onInvestigations?: () => void
  draftPending?: boolean
  draftError?: string
  /** The readable title from the proposal, when it could be read. */
  title?: string
  /** The change's document workspace, shown inside the detail and alone when the snapshot has no such change. */
  documents?: JSX.Element
  /** Page-level tools, such as the data sources dialog, shown beside the change status. */
  tools?: JSX.Element
}) {
  const language = useLanguage()
  const page = () => props.state.data?.data
  const detail = () => props.state.data?.detail ?? page()?.items.find((item) => item.id === props.selection.changeID)

  return (
    <section class="min-w-0 py-6 lg:pb-12 lg:pt-14" aria-label={language.t("changes.title")}>
      <Show when={!props.selection.changeID}>{props.heading}</Show>
      <Show when={props.state.error}>
        {(error) => (
          <div role="alert" class="mb-4 rounded-md border border-v2-border-border-base p-3">
            <p>{language.t(changesFailureKey(error()))}</p>
            <Show when={props.state.stale}>
              <p>{language.t("changes.stale")}</p>
            </Show>
            <Button variant="ghost" onClick={props.onRefresh}>
              {language.t("changes.retry")}
            </Button>
          </div>
        )}
      </Show>
      <Show when={props.state.loading}>
        <p role="status" class="mb-3 text-v2-text-text-muted">
          {language.t(page() ? "changes.refreshing" : "changes.loading")}
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
              <p class="mb-4 text-v2-text-text-muted">{language.t("changes.history")}</p>
            </Show>
            <Show
              when={!props.selection.changeID}
              fallback={
                <Show when={detail()}>
                  {(item) => (
                    <ChangeDetails
                      item={item()}
                      title={props.title}
                      section={props.section}
                      onSection={props.onSection}
                      onInvestigations={props.onInvestigations}
                      onBack={() => props.onSelect()}
                      onContinue={() => props.onContinue(item())}
                      draftPending={props.draftPending}
                      draftError={props.draftError}
                      documents={props.documents}
                      tools={props.tools}
                    />
                  )}
                </Show>
              }
            >
              <Show
                when={data().items.length}
                fallback={
                  <p class="py-8 text-v2-text-text-muted">{language.t(emptyKey(props.selection))}</p>
                }
              >
                <ul aria-label={language.t("changes.list.label")} class="divide-y divide-v2-border-border-base">
                  <For each={data().items}>
                    {(item) => (
                      <li>
                        <button
                          type="button"
                          class="w-full min-w-0 rounded-md px-2 py-4 text-left hover:bg-v2-background-bg-layer-01 focus-visible:outline-2"
                          onClick={() => props.onSelect(item.id)}
                        >
                          <span class="block break-words text-v2-text-text-base [font-weight:530]">
                            {item.title || item.id}
                          </span>
                          <span class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-[16px] text-v2-text-text-muted">
                            <span>
                              {language.t("changes.row.phase", {
                                value: item.phase || language.t("changes.unavailable"),
                              })}
                            </span>
                            <span>{language.t("changes.row.status", { value: item.status })}</span>
                            <span>
                              {language.t("changes.row.evidence", {
                                value: evidenceStatus(item) ?? language.t("changes.unavailable"),
                              })}
                            </span>
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={props.selection.offset > 0 || data().nextOffset !== null}>
                <nav aria-label={language.t("changes.pages.label")} class="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    variant="ghost"
                    disabled={props.selection.offset === 0}
                    onClick={() => props.onPage(Math.max(0, props.selection.offset - PAGE_SIZE))}
                  >
                    {language.t("changes.page.previous")}
                  </Button>
                  <span>{language.plural("changes.total", data().total)}</span>
                  <Button
                    variant="ghost"
                    disabled={data().nextOffset === null}
                    onClick={() => props.onPage(data().nextOffset ?? 0)}
                  >
                    {language.t("changes.page.next")}
                  </Button>
                </nav>
              </Show>
            </Show>
            <footer class="mt-5 flex flex-wrap items-center justify-between gap-2 text-[11px] leading-[16px] text-v2-text-text-muted">
              <span title={data().generatedAt}>
                {language.t(props.state.stale ? "changes.snapshot.stale" : "changes.snapshot", {
                  time: sourceTime(data().generatedAt) ?? language.t("changes.unavailable"),
                })}
              </span>
              <Button variant="ghost" disabled={props.state.loading} onClick={props.onRefresh}>
                {language.t("changes.refresh")}
              </Button>
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
  section: ChangeSection
  onSection: (section: ChangeSection) => void
  onInvestigations?: () => void
  onBack: () => void
  onContinue: () => void
  draftPending?: boolean
  draftError?: string
  documents?: JSX.Element
  tools?: JSX.Element
}) {
  const language = useLanguage()
  const unavailable = () => language.t("changes.unavailable")
  const value = (input: string | number | null | undefined) => measurement(input) ?? unavailable()

  return (
    <article class="min-w-0">
      <Button variant="ghost" onClick={props.onBack}>
        {language.t("changes.detail.back")}
      </Button>
      <p class="mb-2 mt-5 break-words text-[12px] leading-[16px] text-v2-text-text-muted">{props.item.id}</p>
      <h1 class="mb-3 break-words text-[20px] leading-[28px] [font-weight:530]">
        {(props.title || props.item.title || props.item.id).replace(/^Change:\s*/i, "")}
      </h1>
      <div class="mb-5 flex flex-wrap items-center gap-3 text-[12px] leading-[16px] text-v2-text-text-muted">
        <span>{props.item.status}</span>
        <span>{language.t("changes.detail.updated", { time: sourceTime(props.item.updatedAt) ?? unavailable() })}</span>
        <span class="ml-auto">{props.tools}</span>
      </div>
      <WorkflowTrack phase={props.item.phase} onInvestigations={props.onInvestigations} />
      <nav
        class="mb-6 flex gap-5 overflow-x-auto whitespace-nowrap border-b border-v2-border-border-base"
        aria-label={language.t("changes.detail.label")}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
          const buttons = Array.from(event.currentTarget.querySelectorAll("button"))
          const index = buttons.indexOf(event.target as HTMLButtonElement)

          if (index < 0) return
          event.preventDefault()
          const next = buttons[nextTab(index, buttons.length, event.key)]
          next?.focus()
          next?.click()
        }}
      >
        <For each={CHANGE_SECTIONS}>
          {(section) => (
            <button
              type="button"
              class="shrink-0 border-b-2 border-transparent py-2.5 text-[13px] leading-[16px] text-v2-text-text-muted focus-visible:outline-2"
              classList={{ "!border-v2-text-text-base !text-v2-text-text-base": section === props.section }}
              aria-current={section === props.section ? "page" : undefined}
              onClick={() => props.onSection(section)}
            >
              {language.t(`changes.section.${section}`)}
            </button>
          )}
        </For>
      </nav>
      <Switch>
        <Match when={props.section === "overview" && !props.documents}>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3">
            <dt>{language.t("changes.fact.phase")}</dt>
            <dd>{value(props.item.phase)}</dd>
            <dt>{language.t("changes.fact.status")}</dt>
            <dd>{props.item.status}</dd>
            <dt>{language.t("changes.fact.updated")}</dt>
            <dd>{sourceTime(props.item.updatedAt) ?? unavailable()}</dd>
            <dt>{language.t("changes.fact.evidence")}</dt>
            <dd>{value(props.item.evidenceStatus ?? props.item.evidence?.status)}</dd>
          </dl>
          <p class="mt-5 text-[12px] leading-[16px] text-v2-text-text-muted">{language.t("changes.fact.source")}</p>
        </Match>
        <Match when={props.section === "evidence"}>
          <Show when={props.item.evidence} fallback={<p>{language.t("changes.evidence.unavailable")}</p>}>
            {(evidence) => (
              <>
                <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3">
                  <dt>{language.t("changes.evidence.recorded")}</dt>
                  <dd>{value(evidence().recordedStatus)}</dd>
                  <dt>{language.t("changes.evidence.current")}</dt>
                  <dd>{evidence().status}</dd>
                  <dt>{language.t("changes.evidence.freshness")}</dt>
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
                <p class="mt-5 text-[12px] leading-[16px] text-v2-text-text-muted">
                  {language.t("changes.evidence.source")}
                </p>
              </>
            )}
          </Show>
        </Match>
        <Match when={props.section === "usage"}>
          <Show when={props.item.budget} fallback={<p>{language.t("changes.usage.unavailable")}</p>}>
            {(budget) => (
              <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3">
                <dt>{language.t("changes.usage.lifetimeRequests")}</dt>
                <dd>{value(budget().lifetime.usedRequests)}</dd>
                <dt>{language.t("changes.usage.lifetimeTokens")}</dt>
                <dd>{value(budget().lifetime.usedTokens)}</dd>
                <dt>{language.t("changes.usage.windowRequests")}</dt>
                <dd>{value(budget().window.usedRequests)}</dd>
                <dt>{language.t("changes.usage.windowTokens")}</dt>
                <dd>{value(budget().window.usedTokens)}</dd>
                <dt>{language.t("changes.usage.targetRequests")}</dt>
                <dd>{value(budget().window.targetRequests)}</dd>
                <dt>{language.t("changes.usage.targetTokens")}</dt>
                <dd>{value(budget().window.targetTokens)}</dd>
              </dl>
            )}
          </Show>
          <Show when={props.item.run}>
            {(run) => (
              <>
                <p class="mt-4 break-words">
                  {language.t("changes.usage.branch", { branch: value(run().branch) })}
                </p>
                <For each={Object.entries(run().operationMs ?? {})}>
                  {([phase, ms]) => <p>{language.t("changes.usage.operation", { phase, ms })}</p>}
                </For>
              </>
            )}
          </Show>
          <p class="mt-5 text-[12px] leading-[16px] text-v2-text-text-muted">{language.t("changes.usage.source")}</p>
        </Match>
      </Switch>
      <Show when={props.section !== "usage"}>{props.documents}</Show>
      <footer class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-v2-border-border-base pt-5">
        <div>
          <h2 class="mb-2 [font-weight:530]">{language.t("changes.continue.title")}</h2>
          <p class="text-[12px] leading-[16px] text-v2-text-text-muted">{language.t("changes.continue.hint")}</p>
        </div>
        <Button class="mb-4" variant="outline" disabled={props.draftPending} onClick={props.onContinue}>
          {language.t(props.draftPending ? "changes.continue.pending" : "changes.continue.action")}
        </Button>
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
