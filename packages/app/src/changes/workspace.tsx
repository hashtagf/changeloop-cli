import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import type { Foundation } from "@opencode/schema/foundation"
import { useLanguage } from "@/runtime/i18n/language"
import { documentFailureKey, type DocumentReader } from "./document-reader"
import { documentExcerpt } from "./document-excerpt"
import { createDocumentRefresh, type DocumentState } from "./document-refresh"
import { DocumentMarkdown } from "./markdown-view"
import type { ChangeItem } from "./reader"
import { PAGE_SIZE } from "./reader"
import { sourceTime } from "./view"
import {
  checklistCounts,
  fileName,
  isArchivedReference,
  measurement,
  noteTitle,
  plannedTestSections,
  preferredFile,
  taskLabel,
  type ChangeSection,
} from "./view-model"

const SOURCES = ["notes", "title", "documents", "checklist", "claims", "runtime", "usage", "provenance", "links"] as const

export function DocumentWorkspace(props: {
  reader: Pick<DocumentReader, "index" | "read">
  server: string
  directory: string
  /** The change whose agreement documents are read. Without one the saved investigation notes are read. */
  changeID?: string
  /** The change as the snapshot knows it, for the facts of the overview. */
  item?: ChangeItem
  /** The selected document or note. */
  id?: string
  section?: ChangeSection
  anchor?: string
  search: string
  offset: number
  onSection?: (section: ChangeSection) => void
  onRefreshed?: () => void
  onSelect: (id?: string) => void
  onAnchor: (id?: string) => void
  onPage: (offset: number) => void
  onReference: (changeID: string, archived: boolean) => void
  onDraft: (command: "investigate" | "change", source: string) => void
  draftPending?: boolean
  draftError?: string
}) {
  const language = useLanguage()
  const [raw, setRaw] = createSignal(false)
  const refresh = createDocumentRefresh(
    {
      index: (selection, signal) => props.reader.index(selection, signal),
      read: (selection, signal) => props.reader.read(selection, signal),
    },
    {
      every(callback, ms) {
        const timer = setInterval(callback, ms)

        return () => clearInterval(timer)
      },
    },
  )

  createEffect(() => {
    refresh.select({
      server: props.server,
      directory: props.directory,
      changeID: props.changeID,
      id: props.id,
      search: props.changeID ? undefined : props.search,
      offset: props.offset,
      preferred: preferredFile(props.section ?? "overview"),
    })
    setRaw(false)
  })

  onMount(() => {
    const visible = () => refresh.visibility(document.visibilityState !== "hidden")
    const focus = () => void refresh.focus()
    visible()
    document.addEventListener("visibilitychange", visible)
    window.addEventListener("focus", focus)
    onCleanup(() => {
      document.removeEventListener("visibilitychange", visible)
      window.removeEventListener("focus", focus)
    })
  })
  onCleanup(refresh.dispose)

  const state = refresh.state
  const body = () => state().document
  const reason = (code: string) => language.t(documentFailureKey(code))

  createEffect(() => {
    const anchor = props.anchor

    if (!body() || !anchor) return
    queueMicrotask(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }))
  })

  const excerpt = () => documentExcerpt(body(), props.anchor)
  const reload = () => {
    void refresh.refresh()
    props.onRefreshed?.()
  }
  const showDocuments = () => props.changeID !== undefined && props.section === "documents"

  return (
    <section
      class="min-w-0"
      aria-label={language.t(props.changeID ? "changes.docs.label.change" : "changes.docs.label.notes")}
    >
      <Show when={!props.changeID && !props.id}>
        <p class="mb-3 text-[12px] leading-5 text-v2-text-text-muted">{language.t("changes.docs.notes.intro")}</p>
      </Show>
      <Show when={props.changeID && (props.section === "tasks" || props.section === "evidence")}>
        <h2 class="mb-3 [font-weight:530]">
          {language.t(props.section === "tasks" ? "changes.docs.heading.tasks" : "changes.docs.heading.claims")}
        </h2>
      </Show>
      <Show when={state().error || state().bodyError}>
        {(error) => (
          <div role="alert" class="my-3 break-words rounded-md border border-v2-border-border-base p-3">
            {language.t("changes.docs.unavailable", { reason: reason(error()) })}{" "}
            <Show when={state().stale}>{language.t("changes.docs.stale")} </Show>
            <Button variant="ghost" onClick={() => void refresh.refresh()}>
              {language.t("changes.docs.retry")}
            </Button>
          </div>
        )}
      </Show>
      <Show when={state().loading}>
        <p role="status">{language.t("changes.docs.loading")}</p>
      </Show>
      <For each={state().page?.diagnostics}>{(message) => <p role="status">{message}</p>}</For>
      <Show when={!props.changeID && !props.id}>
        <NoteList state={state()} search={props.search} offset={props.offset} onSelect={props.onSelect} onPage={props.onPage} />
      </Show>
      <Show when={props.changeID && props.section === "overview"}>
        <Overview
          state={state()}
          item={props.item}
          whyText={documentExcerpt(body(), undefined, "why")}
          onOpen={(id) => {
            props.onSection?.("documents")
            props.onSelect(id)
          }}
        />
      </Show>
      <div
        class="min-w-0"
        classList={{ "grid gap-6 sm:grid-cols-[145px_minmax(0,1fr)]": showDocuments() }}
      >
        <Show when={showDocuments()}>
          <nav
            aria-label={language.t("changes.docs.sources.label")}
            class="mb-5 flex min-w-0 flex-wrap content-start gap-1 sm:flex-col sm:items-stretch"
          >
            <For each={state().page?.items}>
              {(item) => (
                <Button variant={body()?.id === item.id ? "neutral" : "ghost"} onClick={() => props.onSelect(item.id)}>
                  {fileName(item.sourcePath)}
                </Button>
              )}
            </For>
          </nav>
          <Show when={props.offset || (state().page?.nextOffset !== null && state().page?.nextOffset !== undefined)}>
            <nav aria-label={language.t("changes.docs.pages.label")} class="my-3 flex gap-2">
              <Button
                variant="ghost"
                disabled={!props.offset}
                onClick={() => {
                  props.onSelect()
                  props.onPage(Math.max(0, props.offset - PAGE_SIZE))
                }}
              >
                {language.t("changes.docs.pages.previous")}
              </Button>
              <Button
                variant="ghost"
                disabled={state().page?.nextOffset === null}
                onClick={() => {
                  props.onSelect()
                  props.onPage(state().page?.nextOffset ?? 0)
                }}
              >
                {language.t("changes.docs.pages.next")}
              </Button>
            </nav>
          </Show>
        </Show>
        <Show when={body() && props.section !== "overview" ? body() : undefined}>
          {(value) => (
            <article class="min-w-0" aria-label={language.t("changes.docs.reader.label")}>
              <Show when={!props.changeID}>
                <NoteHeader
                  value={value()}
                  draftPending={props.draftPending}
                  draftError={props.draftError}
                  onBack={() => props.onSelect()}
                  onDraft={props.onDraft}
                  onReference={props.onReference}
                />
              </Show>
              <details class="my-4 break-words text-xs text-v2-text-text-muted">
                <summary>{language.t("changes.docs.provenance.source", { path: value().sourcePath })}</summary>
                <p>{language.t("changes.docs.provenance.modified", { time: value().modifiedAt })}</p>
                <p>{language.t("changes.docs.provenance.read", { time: value().readAt })}</p>
                <p>{language.t("changes.docs.provenance.hash", { hash: value().sha256 })}</p>
                <p>{language.t("changes.docs.provenance.note")}</p>
              </details>
              <For each={value().diagnostics}>
                {(message) => (
                  <p role="status" class="my-3">
                    {message}
                  </p>
                )}
              </For>
              <Show when={props.section === "tasks"}>
                <Checklist tasks={value().tasks} />
              </Show>
              <Show when={props.section === "evidence"}>
                <p>{language.t("changes.docs.claims.note")}</p>
                <For each={value().claims}>
                  {(claim) => (
                    <details class="my-3">
                      <summary>{claim.id}</summary>
                      <pre class="max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs">{claim.text}</pre>
                    </details>
                  )}
                </For>
              </Show>
              <div class="my-4 flex flex-wrap items-center gap-3">
                <Button variant="ghost" aria-pressed={raw()} onClick={() => setRaw(!raw())}>
                  {language.t(raw() ? "changes.docs.raw.hide" : "changes.docs.raw.show")}
                </Button>
                <For each={plannedTestSections(value().sections)}>
                  {(section) => (
                    <Button variant="ghost" onClick={() => props.onAnchor(section.id)}>
                      {language.t("changes.docs.plannedTests", { title: section.title })}
                    </Button>
                  )}
                </For>
              </div>
              <Show when={raw() || (props.section !== "tasks" && props.section !== "evidence")}>
                <div
                  class="min-w-0"
                  classList={{ "grid gap-6 sm:grid-cols-[145px_minmax(0,1fr)]": !props.changeID && !raw() }}
                >
                  <Show when={!props.changeID && !raw()}>
                    <nav
                      aria-label={language.t("changes.docs.sections.label")}
                      class="flex min-w-0 flex-wrap content-start gap-1 sm:flex-col sm:items-stretch"
                    >
                      <For each={value().sections.filter((section) => section.level <= 2)}>
                        {(section) => (
                          <button
                            type="button"
                            aria-current={excerpt().id === section.id ? "location" : undefined}
                            class="rounded-md px-2 py-2 text-left text-[12px] leading-[18px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 focus-visible:outline-2"
                            classList={{
                              "!bg-v2-background-bg-layer-03 !text-v2-text-text-base": excerpt().id === section.id,
                            }}
                            onClick={() => props.onAnchor(section.id)}
                          >
                            {section.level === 1 ? language.t("changes.docs.sections.intro") : section.title}
                          </button>
                        )}
                      </For>
                    </nav>
                  </Show>
                  <div class="min-w-0">
                    <Show
                      when={raw() || !value().sourcePath.endsWith(".md")}
                      fallback={
                        <DocumentMarkdown
                          text={props.changeID ? value().text : excerpt().text}
                          sourcePath={value().sourcePath}
                          sections={props.changeID ? value().sections : excerpt().sections}
                          documents={state().page?.items ?? []}
                          onNavigate={props.onSelect}
                        />
                      }
                    >
                      <pre class="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-v2-border-border-base p-3 text-xs">
                        {value().text}
                      </pre>
                    </Show>
                  </div>
                </div>
              </Show>
            </article>
          )}
        </Show>
      </div>
      <footer class="mt-5 flex flex-wrap items-center justify-between gap-2 text-[11px] leading-4 text-v2-text-text-muted">
        <span>{language.t("changes.docs.read", { time: sourceTime(state().page?.readAt) ?? language.t("changes.unavailable") })}</span>
        <Button variant="ghost" disabled={state().loading} onClick={reload}>
          {language.t("changes.docs.refresh")}
        </Button>
      </footer>
    </section>
  )
}

function NoteList(props: {
  state: DocumentState
  search: string
  offset: number
  onSelect: (id?: string) => void
  onPage: (offset: number) => void
}) {
  const language = useLanguage()

  return (
    <>
      <ul class="divide-y divide-v2-border-border-base" aria-label={language.t("changes.docs.notes.list")}>
        <For each={props.state.page?.items}>
          {(item) => (
            <li>
              <button
                type="button"
                class="flex min-h-[76px] w-full min-w-0 items-center justify-between gap-4 rounded-md px-3 py-3 text-left hover:bg-v2-background-bg-layer-01 focus-visible:outline-2"
                onClick={() => props.onSelect(item.id)}
              >
                <span class="min-w-0">
                  <span class="block break-words leading-5 [font-weight:530]">{noteTitle(item.title)}</span>
                  <span class="mt-1 block break-words text-[11px] leading-4 text-v2-text-text-muted">
                    {item.sourcePath}
                  </span>
                </span>
                <span class="shrink-0 text-right text-[11px] leading-4 text-v2-text-text-muted">
                  <span class="rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5">
                    {language.t("changes.docs.notes.saved")}
                  </span>
                  <time class="mt-1 block" title={item.modifiedAt}>
                    {sourceTime(item.modifiedAt)}
                  </time>
                </span>
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={props.state.page?.total === 0}>
        <p class="py-8">
          {language.t(props.search ? "changes.docs.notes.emptySearch" : "changes.docs.notes.empty")}
        </p>
      </Show>
      <Show when={props.state.page && (props.offset > 0 || props.state.page?.nextOffset !== null)}>
        <nav aria-label={language.t("changes.docs.notes.pages")} class="my-4 flex items-center gap-3">
          <Button
            variant="ghost"
            disabled={!props.offset}
            onClick={() => props.onPage(Math.max(0, props.offset - PAGE_SIZE))}
          >
            {language.t("changes.docs.notes.previous")}
          </Button>
          <span>{language.plural("changes.docs.notes.total", props.state.page?.total ?? 0)}</span>
          <Button
            variant="ghost"
            disabled={props.state.page?.nextOffset === null}
            onClick={() => props.onPage(props.state.page?.nextOffset ?? 0)}
          >
            {language.t("changes.docs.notes.next")}
          </Button>
        </nav>
      </Show>
    </>
  )
}

function Overview(props: {
  state: DocumentState
  item?: ChangeItem
  whyText: ReturnType<typeof documentExcerpt>
  onOpen: (id: string) => void
}) {
  const language = useLanguage()
  const body = () => props.state.document
  const unavailable = () => language.t("changes.unavailable")
  const facts = () =>
    [
      ["changes.docs.facts.phase", props.item?.phase],
      ["changes.docs.facts.status", props.item?.status],
      ["changes.docs.facts.revision", undefined],
      ["changes.docs.facts.evidence", props.item?.evidence?.status ?? props.item?.evidenceStatus],
      ["changes.docs.facts.blockers", undefined],
      ["changes.docs.facts.branch", props.item?.run?.branch],
    ] as const

  return (
    <section aria-label={language.t("changes.docs.overview.label")}>
      <h2 class="mb-2 [font-weight:530]">{language.t("changes.docs.overview.why")}</h2>
      <Show
        when={body()?.sourcePath.endsWith("/proposal.md") ? body() : undefined}
        fallback={<p class="text-v2-text-text-muted">{language.t("changes.docs.overview.proposalUnavailable")}</p>}
      >
        {(proposal) => (
          <Show
            when={props.whyText.found}
            fallback={<p class="text-v2-text-text-muted">{language.t("changes.docs.overview.whyUnavailable")}</p>}
          >
            <DocumentMarkdown
              text={props.whyText.text}
              sourcePath={proposal().sourcePath}
              sections={[]}
              documents={props.state.page?.items ?? []}
              onNavigate={props.onOpen}
            />
          </Show>
        )}
      </Show>
      <dl
        class="my-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3"
        aria-label={language.t("changes.docs.facts.label")}
      >
        <For each={facts()}>
          {(fact) => (
            <div class="border-t border-v2-border-border-base pt-3">
              <dt class="mb-1 text-[11px] leading-4 text-v2-text-text-muted">{language.t(fact[0])}</dt>
              <dd class="break-words text-[13px] leading-4">{measurement(fact[1]) ?? unavailable()}</dd>
            </div>
          )}
        </For>
      </dl>
      <p class="mb-6 text-[11px] leading-4 text-v2-text-text-muted">{language.t("changes.docs.facts.source")}</p>
      <h2 class="mb-3 [font-weight:530]">{language.t("changes.docs.agreement")}</h2>
      <nav aria-label={language.t("changes.docs.agreement")} class="flex flex-wrap gap-2">
        <For each={props.state.page?.items}>
          {(item) => (
            <Button variant="outline" onClick={() => props.onOpen(item.id)}>
              {fileName(item.sourcePath)} ↗
            </Button>
          )}
        </For>
      </nav>
    </section>
  )
}

function NoteHeader(props: {
  value: Foundation.Document
  draftPending?: boolean
  draftError?: string
  onBack: () => void
  onDraft: (command: "investigate" | "change", source: string) => void
  onReference: (changeID: string, archived: boolean) => void
}) {
  const language = useLanguage()

  return (
    <>
      <Button variant="ghost" onClick={props.onBack}>
        {language.t("changes.docs.reader.back")}
      </Button>
      <h1 class="mb-2 mt-5 break-words text-[20px] leading-7 [font-weight:530]">{noteTitle(props.value.title)}</h1>
      <p class="text-[12px] leading-4 text-v2-text-text-muted">{language.t("changes.docs.reader.meta")}</p>
      <div class="my-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={props.draftPending}
          onClick={() => props.onDraft("investigate", props.value.sourcePath)}
        >
          {language.t("changes.docs.reader.continue")}
        </Button>
        <Button
          variant="outline"
          disabled={props.draftPending}
          onClick={() => props.onDraft("change", props.value.sourcePath)}
        >
          {language.t("changes.docs.reader.draft")}
        </Button>
        <DataSourcesButton />
      </div>
      <Show when={props.draftError}>
        <p role="alert">{props.draftError}</p>
      </Show>
      <Show
        when={props.value.references.length}
        fallback={
          <p class="my-5 rounded-md bg-v2-background-bg-layer-01 p-3 text-[12px] leading-5 text-v2-text-text-muted">
            {language.t("changes.docs.refs.none")}
          </p>
        }
      >
        <nav
          aria-label={language.t("changes.docs.refs.label")}
          class="my-5 rounded-md bg-v2-background-bg-layer-01 p-3 text-[12px] leading-5"
        >
          <For each={props.value.references}>
            {(reference) => (
              <button
                type="button"
                class="block break-words text-left underline"
                onClick={() => props.onReference(reference.changeID, isArchivedReference(reference.sourcePath))}
              >
                {language.t("changes.docs.refs.open", { change: reference.changeID, source: reference.sourcePath })}
              </button>
            )}
          </For>
        </nav>
      </Show>
    </>
  )
}

function Checklist(props: { tasks: Foundation.Document["tasks"] }) {
  const language = useLanguage()
  const counts = () => checklistCounts(props.tasks)

  return (
    <>
      <Show when={props.tasks.length} fallback={<p>{language.t("changes.docs.tasks.none")}</p>}>
        <p class="my-3">{language.t("changes.docs.tasks.count", counts())}</p>
      </Show>
      <ul aria-label={language.t("changes.docs.heading.tasks")}>
        <For each={props.tasks}>
          {(task) => (
            <li class="my-3">
              <details>
                <summary class="break-words">
                  {task.checked ? "☑" : "☐"} {taskLabel(task.text)}
                </summary>
                <p class="whitespace-pre-wrap break-words text-sm">
                  {language.t("changes.docs.tasks.line", { line: task.line, text: task.text })}
                </p>
              </details>
            </li>
          )}
        </For>
      </ul>
    </>
  )
}

export function DataSourcesButton(props: { class?: string } = {}) {
  const language = useLanguage()
  const dialog = useDialog()
  let button: HTMLButtonElement | undefined

  const open = () =>
    dialog.show(() => (
      <Dialog
        size="large"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          button?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitleGroup title={language.t("changes.sources.title")} />
        </DialogHeader>
        <DialogBody>
          <dl class="grid gap-3 p-5 text-sm">
            <For each={SOURCES}>
              {(source) => (
                <>
                  <dt>{language.t(`changes.sources.${source}.term`)}</dt>
                  <dd>{language.t(`changes.sources.${source}.text`)}</dd>
                </>
              )}
            </For>
          </dl>
        </DialogBody>
      </Dialog>
    ))

  return (
    <Button ref={button} class={props.class} variant="ghost" onClick={() => void open()}>
      {language.t("changes.sources.open")}
    </Button>
  )
}
