import { useSearchParams } from "@solidjs/router"
import { ScrollView } from "@opencode/ui/scroll-view"
import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import { createHomeController } from "@/home/model"
import { createHomeProjectsController } from "@/home/projects/controller"
import { HomeProjects } from "@/home/projects/region"
import { HomeUtilityNav } from "@/home/projects/view"
import { createHomeScrollController } from "@/home/scroll"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { changeDraft, investigateDraft, noteDraft } from "./draft"
import { createDocumentReader } from "./document-reader"
import { createChangesReader, type ChangeItem, type ChangeSelection } from "./reader"
import { createChangesRefresh, type ChangesState } from "./refresh"
import { ChangesHeading, ChangesView, type ChangeCategory } from "./view"
import { categoryOf, changeSection, proposalTitle, type ChangeSection } from "./view-model"
import { DataSourcesButton, DocumentWorkspace } from "./workspace"

const number = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

type Counts = Partial<Record<ChangeCategory, number>>

/**
 * The Changes screen. The server and project come from the Home selection, so a project chosen in the Projects
 * navigation is the project whose changes are read; the rest of the selection lives in the address.
 */
export function Changes() {
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const [query, setQuery] = useSearchParams()
  const mobile = createMediaQuery("(max-width: 767px)")
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const scroll = createHomeScrollController(() => [])
  const [draftPending, setDraftPending] = createSignal(false)
  const [draftError, setDraftError] = createSignal<string>()
  const [counts, setCounts] = createSignal<{ key: string; values: Counts }>()
  const [title, setTitle] = createSignal<{ key: string; value?: string }>()
  // The lifecycle status of the selected change as last read, which places a link that names no scope.
  const [status, setStatus] = createSignal<{ id: string; value: string }>()

  const connection = () => home.server.focused()
  const directory = () => home.selection.value().directory
  // A link to a change without a scope opens it in the category it belongs to, once the read says which.
  const category = (): ChangeCategory =>
    categoryOf({
      scope: query.scope,
      change: text(query.change),
      status: status()?.id === text(query.change) ? status()?.value : undefined,
    })
  const section = (): ChangeSection => changeSection(query.section)
  const selection = createMemo<ChangeSelection | undefined>(() => {
    const conn = connection()
    const dir = directory()

    if (!conn || !dir) return

    return {
      server: ServerConnection.key(conn),
      directory: dir,
      scope: category() === "archive" ? "archive" : "active",
      search: text(query.search) ?? "",
      offset: number(query.offset),
      changeID: text(query.change),
    }
  })
  const projectKey = () => `${selection()?.server}\0${selection()?.directory}`

  const api = createMemo(() => {
    const conn = connection()

    return conn ? global.ensureServerCtx(conn).sdk.api.foundation : undefined
  })
  const reader = createMemo(() => {
    const foundation = api()

    return foundation ? createChangesReader(foundation) : undefined
  })
  const documents = createMemo(() => {
    const foundation = api()

    return foundation ? createDocumentReader(foundation) : undefined
  })

  const refresh = createChangesRefresh(
    (value, signal) => {
      const read = reader()

      return read ? read(value, signal) : Promise.reject({ code: "disconnected" })
    },
    {
      every(callback, ms) {
        const timer = setInterval(callback, ms)

        return () => clearInterval(timer)
      },
    },
    () => setQuery({ offset: undefined }, { replace: true }),
  )

  createEffect(() => {
    const detail = refresh.state().data?.detail

    if (!detail || detail.id !== text(untrack(() => query.change))) return
    setStatus({ id: detail.id, value: detail.status })

    // Write the category the link did not name into the address, so back and forward keep it.
    if (!untrack(() => query.scope))
      setQuery({ scope: detail.status === "archived" ? "archive" : "active" }, { replace: true })
  })

  const visible = () => document.visibilityState !== "hidden"
  const active = () => !!selection() && category() !== "investigations" && visible()

  createEffect(() => {
    const value = selection()

    refresh.visibility(active())

    if (value && category() !== "investigations") refresh.select(value)
  })

  onMount(() => {
    const onVisible = () => refresh.visibility(active())
    const onFocus = () => void refresh.focus()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onFocus)
    onCleanup(() => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onFocus)
    })
  })
  onCleanup(refresh.dispose)

  // Late data from another project or server is never shown for the current selection.
  const state = createMemo<ChangesState>(() => {
    const current = refresh.state()
    const value = selection()

    return current.selection?.server === value?.server && current.selection?.directory === value?.directory
      ? current
      : { loading: !!value, stale: false }
  })

  // The number of entries of each category. A category that cannot be counted stays unknown rather than zero.
  let countRun = 0
  const loadCounts = () => {
    // Counting follows the project, not each search or page of the list.
    const value = untrack(selection)
    const read = untrack(reader)
    const notes = untrack(documents)
    const key = untrack(projectKey)

    if (!value || !read || !notes) return
    const run = ++countRun
    const abort = new AbortController()
    onCleanup(() => abort.abort())
    void Promise.allSettled([
      notes.index({ directory: value.directory }, abort.signal).then((result) => result.data.total),
      ...(["active", "archive"] as const).map((scope) =>
        read({ server: value.server, directory: value.directory, scope, search: "", offset: 0 }, abort.signal).then(
          (result) => result.data.total,
        ),
      ),
    ]).then((results) => {
      if (run !== countRun) return
      const categories = ["investigations", "active", "archive"] as const
      setCounts({
        key,
        values: Object.fromEntries(
          results.flatMap((result, index) => (result.status === "fulfilled" ? [[categories[index], result.value]] : [])),
        ),
      })
    })
  }
  createEffect(() => {
    projectKey()
    loadCounts()
  })

  // The readable title of the selected change, from the heading of its proposal.
  let titleRun = 0
  const loadTitle = () => {
    const value = untrack(selection)
    const notes = untrack(documents)
    const key = `${untrack(projectKey)}\0${value?.changeID}`

    if (!value?.changeID || !notes) return
    const changeID = value.changeID
    const run = ++titleRun
    const abort = new AbortController()
    onCleanup(() => abort.abort())
    void notes
      .index({ directory: value.directory, changeID }, abort.signal)
      .then((page) => {
        const proposal = page.data.items.find((item) => item.sourcePath.endsWith("/proposal.md"))

        return proposal
          ? notes.read({ directory: value.directory, changeID, documentID: proposal.id }, abort.signal)
          : undefined
      })
      .then((result) => result && proposalTitle(result.data.sections))
      .catch(() => undefined)
      .then((resolved) => {
        if (run === titleRun) setTitle({ key, value: resolved || undefined })
      })
  }
  createEffect(() => {
    projectKey()
    selection()?.changeID
    loadTitle()
  })

  const projectName = () => {
    const dir = directory() ?? ""

    return home.project.selected()?.name || dir.split("/").filter(Boolean).at(-1) || ""
  }

  const reload = () => {
    if (selection()?.offset) return setQuery({ offset: undefined })

    void refresh.refresh()
  }

  const openDraft = async (item?: ChangeItem, note?: { command: "investigate" | "change"; source: string }) => {
    const conn = connection()
    const target = selection()

    if (!conn || !target || draftPending()) return
    setDraftPending(true)
    setDraftError(undefined)

    try {
      const commands = (
        await global.ensureServerCtx(conn).sdk.api.command.list({ location: { directory: target.directory } })
      ).data

      // The project or server changed while the commands loaded.
      if (selection()?.server !== target.server || selection()?.directory !== target.directory) return
      const prompt = note
        ? noteDraft(note.command, note.source, commands)
        : item
          ? changeDraft(item, commands)
          : investigateDraft(commands)

      if (!prompt) return setDraftError(language.t("changes.draft.unavailable"))
      global.ensureServerCtx(conn).projects.touch(target.directory)
      await tabs.newDraft({ server: target.server as ServerConnection.Key, directory: target.directory }, prompt)
    } catch {
      setDraftError(language.t("changes.draft.failed"))
    } finally {
      setDraftPending(false)
    }
  }

  const setCategory = (next: ChangeCategory) =>
    setQuery({
      scope: next,
      change: undefined,
      investigation: undefined,
      document: undefined,
      anchor: undefined,
      section: undefined,
      search: undefined,
      offset: undefined,
      documentOffset: undefined,
    })

  const search = (value: string) =>
    setQuery({ search: value || undefined, offset: undefined, change: undefined, investigation: undefined }, { replace: true })

  const heading = (value: ChangeSelection) => (
    <ChangesHeading
      project={projectName()}
      scope={category()}
      search={value.search}
      counts={counts()?.key === projectKey() ? (counts()?.values ?? {}) : {}}
      onScope={setCategory}
      onSearch={search}
      onNew={() => void openDraft()}
      pending={draftPending()}
      tools={<DataSourcesButton />}
    />
  )

  const workspace = (value: ChangeSelection, notes: boolean) => (
    <Show when={documents()}>
      {(reader) => (
        <DocumentWorkspace
          reader={reader()}
          server={value.server}
          directory={value.directory}
          changeID={notes ? undefined : value.changeID}
          item={notes ? undefined : (state().data?.detail ?? state().data?.data.items.find((item) => item.id === value.changeID))}
          id={text(notes ? query.investigation : query.document)}
          section={notes ? undefined : section()}
          anchor={text(query.anchor)}
          search={value.search}
          offset={notes ? value.offset : number(query.documentOffset)}
          onSection={(next) => setQuery({ section: next, document: undefined, anchor: undefined })}
          onRefreshed={() => {
            loadCounts()
            loadTitle()
          }}
          onSelect={(id) => setQuery({ [notes ? "investigation" : "document"]: id, anchor: undefined })}
          onAnchor={(anchor) => setQuery({ anchor })}
          onPage={(offset) => setQuery({ [notes ? "offset" : "documentOffset"]: offset || undefined })}
          onReference={(change, archived) =>
            setQuery({
              scope: archived ? "archive" : "active",
              change,
              section: "documents",
              investigation: undefined,
              document: undefined,
              anchor: undefined,
              search: undefined,
              offset: undefined,
              documentOffset: undefined,
            })
          }
          onDraft={(command, source) => void openDraft(undefined, { command, source })}
          draftPending={draftPending()}
          draftError={draftError()}
        />
      )}
    </Show>
  )

  return (
    <div
      data-slot="changes-panel"
      class={`
        mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <Show when={mobile()}>
        <div class="relative z-40 -mb-3 shrink-0 px-3 pt-3">
          <HomeProjects projects={projects} scroll={scroll} dropdown />
        </div>
      </Show>
      <ScrollView
        class="min-h-0 flex-1 [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack()}
        thumbHoverTarget={scroll.viewport.hoverTarget()}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
      >
        <div
          class={`
            mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-3
            max-md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6
          `}
        >
          <Show when={!mobile()}>
            <HomeProjects projects={projects} scroll={scroll} />
          </Show>
          <Show
            when={selection()}
            fallback={<p class="py-10 text-v2-text-text-muted">{language.t("changes.noProject")}</p>}
          >
            {(value) => (
              <Show
                when={category() !== "investigations"}
                fallback={
                  <div class="min-w-0 py-6 lg:pb-12 lg:pt-14">
                    <Show when={!query.investigation}>{heading(value())}</Show>
                    {workspace(value(), true)}
                  </div>
                }
              >
                <ChangesView
                  heading={heading(value())}
                  title={title()?.key === `${projectKey()}\0${value().changeID}` ? title()?.value : undefined}
                  state={state()}
                  selection={value()}
                  section={section()}
                  onSelect={(change) =>
                    setQuery({
                      change,
                      section: undefined,
                      document: undefined,
                      anchor: undefined,
                      documentOffset: undefined,
                    })
                  }
                  onSection={(next) =>
                    setQuery({ section: next, document: undefined, anchor: undefined, documentOffset: undefined })
                  }
                  onPage={(offset) => setQuery({ offset: offset || undefined })}
                  onRefresh={() => {
                    reload()
                    loadCounts()
                    loadTitle()
                  }}
                  onContinue={(item) => void openDraft(item)}
                  onInvestigations={() => setCategory("investigations")}
                  draftPending={draftPending()}
                  draftError={draftError()}
                  documents={<Show when={value().changeID}>{workspace(value(), false)}</Show>}
                  tools={<DataSourcesButton />}
                />
              </Show>
            )}
          </Show>
        </div>
      </ScrollView>
      <div class="hidden shrink-0 px-3 py-2 md:block lg:hidden">
        <HomeUtilityNav
          class="flex"
          onOpenChanges={projects.utility.changes}
          onOpenSettings={projects.utility.settings}
          onOpenHelp={projects.utility.help}
          language={projects.copy.language}
        />
      </div>
    </div>
  )
}
