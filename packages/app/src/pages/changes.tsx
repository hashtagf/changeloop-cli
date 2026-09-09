import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { ChangesView } from "./changes/changes-view"
import { createChangesRefresh } from "./changes/changes-refresh"
import type { ChangeItem, ChangeSelection, ChangesReader } from "./changes/changes-reader"
import { createChangesReader } from "./changes/foundation-client"
import { usePlatform } from "@/context/platform"
import { loadCommands } from "@/context/global-sync/bootstrap"
import { changeDraft } from "./changes/changes-draft"
import { DocumentWorkspace } from "./changes/document-workspace"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"

export function Changes(props: { reader?: ChangesReader }) {
  const [query, setQuery] = useSearchParams()
  const global = useGlobal()
  const platform = usePlatform()
  const tabs = useTabs()
  const [draftError, setDraftError] = createSignal<string>()
  const [draftPending, setDraftPending] = createSignal(false)
  const category = () => (query.scope === "active" || query.scope === "archive" ? query.scope : "investigations")
  const section = () => (typeof query.section === "string" ? query.section : "overview")
  const documentPage = () =>
    typeof query.documentOffset === "string" && /^\d+$/.test(query.documentOffset) ? Number(query.documentOffset) : 0
  const connection = createMemo(() =>
    global.servers.list().find((server) => ServerConnection.key(server) === query.server),
  )
  const selection = createMemo<ChangeSelection>(() => ({
    server: typeof query.server === "string" ? query.server : "",
    directory: typeof query.directory === "string" ? query.directory : "",
    scope: query.scope === "archive" ? "archive" : "active",
    search: typeof query.search === "string" ? query.search : "",
    offset: typeof query.offset === "string" && /^\d+$/.test(query.offset) ? Number(query.offset) : 0,
    changeID: typeof query.change === "string" ? query.change : undefined,
  }))
  const reader = createMemo(() => (connection() ? createChangesReader(connection()!.http, platform.fetch) : undefined))
  const refresh = createChangesRefresh(
    (value, signal) => {
      const read = props.reader ?? reader()
      if (!read) return Promise.reject({ code: "disconnected" })
      return read(value, signal)
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
    const state = refresh.state()
    if (state.selection?.directory !== selection().directory || state.selection?.server !== selection().server) return
    const canonical = state.data?.location.directory
    if (canonical && canonical !== selection().directory) setQuery({ directory: canonical }, { replace: true })
  })
  createEffect(() => {
    const value = selection()
    if (!connection() || !value.directory) return
    refresh.visibility(category() !== "investigations" && document.visibilityState !== "hidden")
    if (category() !== "investigations") refresh.select(value)
    if (!tabs.ready()) return
    const section = typeof query.section === "string" ? query.section : "overview"
    const investigationID = typeof query.investigation === "string" ? query.investigation : undefined
    const documentID = typeof query.document === "string" ? query.document : undefined
    const anchor = typeof query.anchor === "string" ? query.anchor : undefined
    const documentOffset = documentPage()
    untrack(() =>
      tabs.changes({
        server: ServerConnection.Key.make(value.server),
        directory: value.directory,
        scope: category(),
        search: value.search,
        changeID: value.changeID,
        section,
        offset: value.offset,
        documentOffset,
        investigationID,
        documentID,
        anchor,
      }),
    )
  })
  onMount(() => {
    const visible = () => refresh.visibility(category() !== "investigations" && document.visibilityState !== "hidden")
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
  const reload = () => {
    if (selection().offset) {
      setQuery({ offset: undefined })
      return
    }
    void refresh.refresh()
  }
  const openDraft = async (item?: ChangeItem, note?: { command: "investigate" | "change"; source?: string }) => {
    const server = connection()
    if (!server || draftPending()) return
    const target = selection()
    setDraftPending(true)
    setDraftError(undefined)
    try {
      const sdk = global.ensureServerCtx(server).sdk
      const commands = await loadCommands(
        target.directory,
        sdk.currentApi.command,
        sdk.createClient({ directory: target.directory }),
        sdk.protocol,
      )
      if (selection().server !== target.server || selection().directory !== target.directory) return
      const prompt = note
        ? commands.some((command) => command.name === note.command)
          ? `/${note.command}${note.source ? ` ${note.source}` : ""}`
          : undefined
        : item
          ? changeDraft(item, commands)
          : commands.some((command) => command.name === "investigate")
            ? "/investigate"
            : undefined
      if (!prompt) {
        setDraftError("Foundation commands are unavailable for this project. Existing sessions remain available.")
        return
      }
      await tabs.newDraft({ server: ServerConnection.key(server), directory: target.directory }, prompt)
    } catch {
      setDraftError("Unable to load project commands. Retry when this server is available.")
    } finally {
      setDraftPending(false)
    }
  }
  const scope = (value: "investigations" | "active" | "archive") =>
    setQuery({
      scope: value,
      documentOffset: undefined,
      change: undefined,
      investigation: undefined,
      document: undefined,
      anchor: undefined,
      section: undefined,
      search: undefined,
      offset: undefined,
    })
  const documents = (investigation: boolean) => (
    <DocumentWorkspace
      server={selection().server}
      http={connection()!.http}
      directory={selection().directory}
      fetch={platform.fetch}
      changeID={investigation ? undefined : selection().changeID}
      id={
        typeof (investigation ? query.investigation : query.document) === "string"
          ? String(investigation ? query.investigation : query.document)
          : undefined
      }
      section={investigation ? undefined : section()}
      anchor={typeof query.anchor === "string" ? query.anchor : undefined}
      search={selection().search}
      offset={investigation ? selection().offset : documentPage()}
      onSelect={(id) => setQuery({ [investigation ? "investigation" : "document"]: id, anchor: undefined })}
      onAnchor={(anchor) => setQuery({ anchor })}
      onSearch={(search) => setQuery({ search: search || undefined, offset: undefined }, { replace: true })}
      onPage={(offset) => setQuery({ [investigation ? "offset" : "documentOffset"]: offset || undefined })}
      onReference={(change, archived) =>
        setQuery({
          scope: archived ? "archive" : "active",
          documentOffset: undefined,
          change,
          investigation: undefined,
          document: undefined,
          anchor: undefined,
          section: "documents",
          search: undefined,
          offset: undefined,
        })
      }
      onDraft={(command, source) => void openDraft(undefined, { command, source })}
      draftPending={draftPending()}
      draftError={draftError()}
    />
  )
  return (
    <div class="m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
      <ScrollView class="h-full">
        <div class="mx-auto grid w-full max-w-[1080px] gap-4 px-3 lg:grid-cols-[280px_minmax(0,720px)] lg:gap-8 lg:px-6">
          <aside class="min-w-0 pt-6 lg:pt-10">
            <label class="mb-2 block text-v2-text-text-muted" for="changes-server">
              Server
            </label>
            <select
              id="changes-server"
              class="mb-4 h-9 w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2"
              value={selection().server}
              onChange={(event) => {
                const selected = global.servers
                  .list()
                  .find((server) => ServerConnection.key(server) === event.currentTarget.value)
                setQuery({
                  server: event.currentTarget.value,
                  directory: selected ? global.ensureServerCtx(selected).projects.list()[0]?.worktree : undefined,
                  change: undefined,
                  search: undefined,
                  offset: undefined,
                  investigation: undefined,
                  document: undefined,
                  anchor: undefined,
                })
              }}
            >
              {global.servers.list().map((server) => (
                <option value={ServerConnection.key(server)}>{server.displayName ?? server.http.url}</option>
              ))}
            </select>
            <label class="mb-2 block text-v2-text-text-muted" for="changes-project">
              Project
            </label>
            <select
              id="changes-project"
              class="h-9 w-full min-w-0 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2"
              value={selection().directory}
              onChange={(event) =>
                setQuery({
                  directory: event.currentTarget.value,
                  change: undefined,
                  offset: undefined,
                  search: undefined,
                  investigation: undefined,
                  document: undefined,
                  anchor: undefined,
                })
              }
            >
              <Show when={selection().directory}>
                <option value={selection().directory}>{selection().directory}</option>
              </Show>
              <ForProjects connection={connection()} selected={selection().directory} />
            </select>
            <p class="mt-3 break-words text-[12px] text-v2-text-text-muted">
              {connection()?.displayName ?? connection()?.http.url}
            </p>
          </aside>
          <Show
            when={connection() && selection().directory}
            fallback={<p class="py-10">Choose a project from Home to view its changes.</p>}
          >
            <Show
              when={category() !== "investigations"}
              fallback={
                <div class="min-w-0 py-6 lg:py-10">
                  <h1 class="mb-6 text-[20px] font-medium">Changes</h1>
                  <nav aria-label="Change scope" class="flex flex-wrap gap-2">
                    <ButtonV2 variant="neutral" aria-pressed="true">
                      Investigations
                    </ButtonV2>
                    <ButtonV2 variant="ghost" onClick={() => scope("active")}>
                      Active
                    </ButtonV2>
                    <ButtonV2 variant="ghost" onClick={() => scope("archive")}>
                      Archived
                    </ButtonV2>
                  </nav>
                  {documents(true)}
                </div>
              }
            >
              <ChangesView
                state={refresh.state()}
                selection={selection()}
                section={typeof query.section === "string" ? query.section : "overview"}
                onSelect={(changeID) =>
                  setQuery({
                    change: changeID,
                    section: undefined,
                    document: undefined,
                    anchor: undefined,
                    documentOffset: undefined,
                  })
                }
                onSection={(section) =>
                  setQuery({ section, document: undefined, anchor: undefined, documentOffset: undefined })
                }
                onScope={scope}
                onSearch={(search) =>
                  setQuery({ search: search || undefined, offset: undefined, change: undefined }, { replace: true })
                }
                onPage={(offset) => setQuery({ offset: offset || undefined })}
                onRefresh={reload}
                onContinue={openDraft}
                onNew={() => openDraft()}
                draftPending={draftPending()}
                draftError={draftError()}
                onInvestigations={() => scope("investigations")}
                documents={<Show when={selection().changeID}>{documents(false)}</Show>}
              />
            </Show>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}

function ForProjects(props: { connection?: ServerConnection.Any; selected: string }) {
  const global = useGlobal()
  return (
    <>
      {props.connection &&
        global
          .ensureServerCtx(props.connection)
          .projects.list()
          .filter((project) => project.worktree !== props.selected)
          .map((project) => <option value={project.worktree}>{project.name ?? project.worktree}</option>)}
    </>
  )
}
