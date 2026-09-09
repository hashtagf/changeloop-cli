import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DocumentMarkdown } from "@opencode-ai/ui/document-markdown"
import { DialogV2, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { ServerConnection } from "@/context/server"
import { createDocumentReader } from "./document-client"
import { createDocumentRefresh } from "./document-refresh"

export function DocumentWorkspace(props: {
  server: string
  http: ServerConnection.HttpBase
  directory: string
  fetch?: typeof globalThis.fetch
  changeID?: string
  id?: string
  section?: string
  anchor?: string
  search: string
  offset: number
  onSelect: (id?: string) => void
  onAnchor: (id?: string) => void
  onSearch: (value: string) => void
  onPage: (offset: number) => void
  onReference: (id: string, archived: boolean) => void
  onDraft: (command: "investigate" | "change", source?: string) => void
  draftPending?: boolean
  draftError?: string
}) {
  const dialog = useDialog()
  const [raw, setRaw] = createSignal(false)
  let sourcesButton: HTMLButtonElement | undefined
  const refresh = createDocumentRefresh(
    {
      index: (selection, signal) => createDocumentReader(props.http, props.fetch).index(selection, signal),
      read: (selection, signal) => createDocumentReader(props.http, props.fetch).read(selection, signal),
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
      preferred:
        props.section === "documents"
          ? ""
          : props.section === "tasks"
            ? "tasks.md"
            : props.section === "evidence"
              ? "evidence.yaml"
              : "proposal.md",
    })
    setRaw(false)
  })
  onMount(() => {
    const visible = () => refresh.visibility(document.visibilityState !== "hidden")
    const focus = () => {
      void refresh.focus()
    }
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
  createEffect(() => {
    const anchor = props.anchor
    if (!body() || !anchor) return
    queueMicrotask(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }))
  })
  const sources = () =>
    dialog.show(() => (
      <DialogV2
        size="large"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          sourcesButton?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Data sources</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <dl class="grid gap-3 p-5 text-sm">
            <dt>Saved investigations</dt>
            <dd>openspec/investigations/*.md — saved notes, without inferred runtime status.</dd>
            <dt>Title and purpose</dt>
            <dd>proposal.md — original heading and Why section; unavailable when absent.</dd>
            <dt>Documents and planned tests</dt>
            <dd>
              proposal.md, design.md, tasks.md, evidence.yaml, grounding and specs in the resolved active or archived
              change.
            </dd>
            <dt>Checklist</dt>
            <dd>tasks.md checkboxes — checked items are not proof or gate results.</dd>
            <dt>Declared claims</dt>
            <dd>evidence.yaml — obligations, separate from provider results.</dd>
            <dt>Runtime and evidence</dt>
            <dd>
              Foundation snapshot changes, blockers, evidence and generatedAt — recorded results, current status and
              freshness remain distinct.
            </dd>
            <dt>Usage</dt>
            <dd>Foundation snapshot budgets and runs — missing measurements are unavailable; zero is a measurement.</dd>
            <dt>Document provenance</dt>
            <dd>
              Relative source path, filesystem modification time, read time and SHA-256. A digest identifies content; it
              is not a proof receipt.
            </dd>
            <dt>Links to changes</dt>
            <dd>Exact contained references in indexed agreement documents. No inferred conversion or completion.</dd>
          </dl>
        </DialogBody>
      </DialogV2>
    ))
  return (
    <section class="min-w-0" aria-label={props.changeID ? "Change documents" : "Investigations"}>
      <header class="my-4 flex flex-wrap items-center gap-2">
        <h2 class="mr-auto font-medium">
          {props.changeID
            ? props.section === "tasks"
              ? "Task checklist"
              : props.section === "evidence"
                ? "Declared claims"
                : "Source documents"
            : "Investigations"}
        </h2>
        <Show when={!props.changeID}>
          <ButtonV2 variant="outline" disabled={props.draftPending} onClick={() => props.onDraft("investigate")}>
            New investigate
          </ButtonV2>
        </Show>
        <ButtonV2 ref={sourcesButton} variant="ghost" onClick={sources}>
          Data sources
        </ButtonV2>
        <ButtonV2 variant="ghost" disabled={state().loading} onClick={() => void refresh.refresh()}>
          Refresh documents
        </ButtonV2>
      </header>
      <Show when={!props.changeID && !props.id}>
        <p class="mb-4 text-v2-text-text-muted">Saved notes. Unsaved investigations remain in Sessions.</p>
        <input
          type="search"
          aria-label="Search investigations"
          placeholder="Search saved investigations"
          value={props.search}
          onInput={(event) => props.onSearch(event.currentTarget.value)}
          class="mb-4 h-9 w-full rounded-md border border-v2-border-border-base bg-transparent px-3"
        />
      </Show>
      <Show when={state().error || state().bodyError}>
        {(error) => (
          <div role="alert" class="my-3 break-words rounded-md border border-v2-border-border-base p-3">
            Document read unavailable ({error()}).{" "}
            <Show when={state().stale}>Showing stale content from the last successful read. </Show>
            <ButtonV2 variant="ghost" onClick={() => void refresh.refresh()}>
              Retry document read
            </ButtonV2>
          </div>
        )}
      </Show>
      <Show when={state().loading}>
        <p role="status">Loading documents…</p>
      </Show>
      <For each={state().page?.diagnostics}>{(message) => <p role="status">{message}</p>}</For>
      <Show when={!props.changeID && !props.id}>
        <ul class="divide-y divide-v2-border-border-base" aria-label="Saved investigations">
          <For each={state().page?.items}>
            {(item) => (
              <li>
                <button
                  type="button"
                  class="w-full rounded-md py-3 text-left hover:bg-v2-background-bg-layer-01"
                  onClick={() => props.onSelect(item.id)}
                >
                  <span class="block break-words font-medium">{item.title}</span>
                  <span class="block break-words text-xs text-v2-text-text-muted">
                    {item.sourcePath} · Modified {item.modifiedAt}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show when={state().page?.total === 0}>
          <p class="py-8">{props.search ? "No saved notes match your search." : "No saved investigations."}</p>
        </Show>
        <Show when={state().page}>
          {(page) => (
            <nav aria-label="Investigation pages" class="my-4 flex items-center gap-3">
              <ButtonV2
                variant="ghost"
                disabled={!props.offset}
                onClick={() => props.onPage(Math.max(0, props.offset - 50))}
              >
                Previous notes
              </ButtonV2>
              <span>{page().total} saved notes</span>
              <ButtonV2
                variant="ghost"
                disabled={page().nextOffset === null}
                onClick={() => props.onPage(page().nextOffset ?? 0)}
              >
                Next notes
              </ButtonV2>
            </nav>
          )}
        </Show>
      </Show>
      <Show when={props.changeID && props.section === "documents"}>
        <nav aria-label="Source documents" class="mb-5 flex flex-wrap gap-2">
          <For each={state().page?.items}>
            {(item) => (
              <ButtonV2 variant={body()?.id === item.id ? "neutral" : "ghost"} onClick={() => props.onSelect(item.id)}>
                {item.sourcePath.split("/").slice(-1)[0]}
              </ButtonV2>
            )}
          </For>
        </nav>
        <Show when={props.offset || (state().page?.nextOffset !== null && state().page?.nextOffset !== undefined)}>
          <nav aria-label="Document pages" class="my-3 flex gap-2">
            <ButtonV2
              variant="ghost"
              disabled={!props.offset}
              onClick={() => {
                props.onSelect()
                props.onPage(Math.max(0, props.offset - 50))
              }}
            >
              Previous documents
            </ButtonV2>
            <ButtonV2
              variant="ghost"
              disabled={state().page?.nextOffset === null}
              onClick={() => {
                props.onSelect()
                props.onPage(state().page?.nextOffset ?? 0)
              }}
            >
              Next documents
            </ButtonV2>
          </nav>
        </Show>
      </Show>
      <Show when={body()}>
        {(value) => (
          <article class="min-w-0" aria-label="Document reader">
            <Show when={!props.changeID}>
              <ButtonV2 variant="ghost" onClick={() => props.onSelect()}>
                Back to investigations
              </ButtonV2>
              <p class="mt-4 text-xs text-v2-text-text-muted">Saved note</p>
              <h2 class="my-2 break-words text-lg font-medium">{value().title}</h2>
              <div class="my-4 flex flex-wrap gap-2">
                <ButtonV2
                  variant="outline"
                  disabled={props.draftPending}
                  onClick={() => props.onDraft("investigate", value().sourcePath)}
                >
                  Continue investigation
                </ButtonV2>
                <ButtonV2
                  variant="outline"
                  disabled={props.draftPending}
                  onClick={() => props.onDraft("change", value().sourcePath)}
                >
                  Draft change
                </ButtonV2>
              </div>
              <Show when={props.draftError}>
                <p role="alert">{props.draftError}</p>
              </Show>
              <Show
                when={value().references.length}
                fallback={
                  <p class="my-3 text-sm text-v2-text-text-muted">
                    No explicit change reference found. Related work may exist without a document link.
                  </p>
                }
              >
                <nav aria-label="Referenced changes" class="my-4">
                  <For each={value().references}>
                    {(reference) => (
                      <button
                        type="button"
                        class="block break-words text-left underline"
                        onClick={() =>
                          props.onReference(
                            reference.changeID,
                            reference.sourcePath.startsWith("openspec/changes/archive/"),
                          )
                        }
                      >
                        Open {reference.changeID} — referenced by {reference.sourcePath}
                      </button>
                    )}
                  </For>
                </nav>
              </Show>
            </Show>
            <details class="my-4 break-words text-xs text-v2-text-text-muted">
              <summary>Source: {value().sourcePath}</summary>
              <p>Modified: {value().modifiedAt}</p>
              <p>Read: {value().readAt}</p>
              <p>SHA-256: {value().sha256}</p>
              <p>Content identity, not a proof receipt.</p>
            </details>
            <For each={value().diagnostics}>
              {(message) => (
                <p role="status" class="my-3">
                  {message}
                </p>
              )}
            </For>
            <Show when={props.section === "tasks"}>
              <Show
                when={value().tasks.length}
                fallback={<p>No recognizable task checkboxes. Inspect the original source.</p>}
              >
                <p class="my-3">
                  {value().tasks.filter((task) => task.checked).length}/{value().tasks.length} checked · Checklist only,
                  not proof.
                </p>
              </Show>
              <ul aria-label="Task checklist">
                <For each={value().tasks}>
                  {(task) => (
                    <li class="my-3">
                      <details>
                        <summary class="break-words">
                          {task.checked ? "☑" : "☐"} {task.text.split(" [")[0]}
                        </summary>
                        <p class="whitespace-pre-wrap break-words text-sm">
                          Line {task.line}: {task.text}
                        </p>
                      </details>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={props.section === "evidence"}>
              <p>Declared obligations from evidence.yaml; not recorded test results.</p>
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
              <ButtonV2 variant="ghost" aria-pressed={raw()} onClick={() => setRaw(!raw())}>
                {raw() ? "Rendered document" : "Full source text"}
              </ButtonV2>
              <Show when={value().sections.length}>
                <label>
                  Section{" "}
                  <select
                    aria-label="Document section"
                    class="max-w-full bg-v2-background-bg-base"
                    value={props.anchor ?? ""}
                    onChange={(event) => props.onAnchor(event.currentTarget.value || undefined)}
                  >
                    <option value="">Choose section</option>
                    <For each={value().sections}>
                      {(section) => <option value={section.id}>{section.title}</option>}
                    </For>
                  </select>
                </label>
              </Show>
              <For each={value().sections.filter((section) => /test|verification|scenario/i.test(section.title))}>
                {(section) => (
                  <ButtonV2 variant="ghost" onClick={() => props.onAnchor(section.id)}>
                    Planned tests: {section.title}
                  </ButtonV2>
                )}
              </For>
            </div>
            <Show
              when={raw() || !value().sourcePath.endsWith(".md")}
              fallback={
                <DocumentMarkdown
                  text={value().text}
                  sourcePath={value().sourcePath}
                  sections={value().sections}
                  documents={state().page?.items ?? []}
                  onNavigate={props.onSelect}
                />
              }
            >
              <pre class="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-v2-border-border-base p-3 text-xs">
                {value().text}
              </pre>
            </Show>
          </article>
        )}
      </Show>
    </section>
  )
}
