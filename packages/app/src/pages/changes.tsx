import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js"
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
import { ChangesHeading } from "./changes/changes-layout"
import { createDocumentReader } from "./changes/document-client"
import { DataSourcesButton } from "./changes/document-workspace"
import { HomeUtilityNav } from "./home/home-projects-view"
import { useSettingsCommand } from "@/components/settings-dialog"
import { useLanguage } from "@/context/language"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"

export function Changes(props: { reader?: ChangesReader }) {
  const [query, setQuery] = useSearchParams()
  const global = useGlobal()
  const platform = usePlatform()
  const tabs = useTabs()
  const settings = useSettingsCommand()
  const language = useLanguage()
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
  const projectName = () =>
    (connection() &&
      global
        .ensureServerCtx(connection()!)
        .projects.list()
        .find((project) => project.worktree === selection().directory)?.name) ||
    selection().directory.split("/").filter(Boolean).at(-1) ||
    "Project"
  const [counts, { refetch: reloadCounts }] = createResource(
    () =>
      connection() && selection().directory
        ? { http: connection()!.http, server: selection().server, directory: selection().directory, scope: category() }
        : undefined,
    async (target) => {
      const abort = new AbortController()
      const values = await Promise.allSettled([
        createDocumentReader(target.http, platform.fetch)
          .index({ directory: target.directory }, abort.signal)
          .then((result) => result.data.total),
        ...(["active", "archive"] as const).map((scope) =>
          (props.reader ?? createChangesReader(target.http, platform.fetch))(
            { server: target.server, directory: target.directory, scope, search: "", offset: 0 },
            abort.signal,
          ).then((result) => result.data.total),
        ),
      ])
      return Object.fromEntries(
        values.map((value, index) => [
          ["investigations", "active", "archive"][index],
          value.status === "fulfilled" ? value.value : undefined,
        ]),
      )
    },
  )
  const [proposalTitle, { refetch: reloadTitle }] = createResource(
    () =>
      connection() && selection().changeID
        ? { http: connection()!.http, directory: selection().directory, changeID: selection().changeID }
        : undefined,
    async (target) => {
      const client = createDocumentReader(target.http, platform.fetch)
      const abort = new AbortController()
      const page = await client.index(target, abort.signal).catch(() => undefined)
      const proposal = page?.data.items.find((item) => item.sourcePath.endsWith("/proposal.md"))
      if (!proposal) return undefined
      const body = await client.read({ ...target, documentID: proposal.id }, abort.signal).catch(() => undefined)
      return body?.data.sections.find((section) => section.level === 1)?.title
    },
  )
  const heading = () => (
    <ChangesHeading
      project={projectName()}
      scope={category()}
      search={selection().search}
      counts={counts.loading ? {} : (counts() ?? {})}
      onScope={scope}
      onSearch={(search) => setQuery({ search: search || undefined, offset: undefined }, { replace: true })}
      onNew={() => void openDraft()}
      pending={draftPending()}
      tools={<DataSourcesButton />}
    />
  )
  const documents = (investigation: boolean) => (
    <DocumentWorkspace
      server={selection().server}
      http={connection()!.http}
      directory={selection().directory}
      fetch={platform.fetch}
      changeID={investigation ? undefined : selection().changeID}
      item={
        investigation
          ? undefined
          : (refresh.state().data?.detail ??
            refresh.state().data?.data.items.find((item) => item.id === selection().changeID))
      }
      onSection={(section) => setQuery({ section, document: undefined, anchor: undefined })}
      onRefreshed={() => {
        void reloadCounts()
        void reloadTitle()
      }}
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
          <aside aria-label="Projects" class="min-w-0 pt-6 lg:pt-[120px] lg:pr-3">
            <p class="mb-4 hidden h-7 items-center px-1.5 text-v2-text-text-muted [font-weight:530] lg:flex">
              Projects
            </p>
            <For each={global.servers.list()}>
              {(server) => (
                <div class="mb-2">
                  <Show when={global.servers.list().length > 1}>
                    <p class="mb-2 truncate px-1.5 text-xs text-v2-text-text-muted">
                      {server.displayName ?? server.http.url}
                    </p>
                  </Show>
                  <For
                    each={[
                      ...global
                        .ensureServerCtx(server)
                        .projects.list()
                        .map((project) => ({
                          directory: project.worktree,
                          name: project.name ?? project.worktree.split("/").filter(Boolean).at(-1) ?? project.worktree,
                        })),
                      ...(ServerConnection.key(server) === selection().server &&
                      selection().directory &&
                      !global
                        .ensureServerCtx(server)
                        .projects.list()
                        .some((project) => project.worktree === selection().directory)
                        ? [{ directory: selection().directory, name: projectName() }]
                        : []),
                    ]}
                  >
                    {(project) => (
                      <button
                        type="button"
                        title={project.directory}
                        aria-current={
                          ServerConnection.key(server) === selection().server &&
                          project.directory === selection().directory
                            ? "page"
                            : undefined
                        }
                        class="mb-1 flex h-7 w-full min-w-0 items-center gap-2 rounded-[6px] px-1.5 text-left text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 focus-visible:outline-2"
                        classList={{
                          "bg-v2-background-bg-layer-03 text-v2-text-text-base":
                            ServerConnection.key(server) === selection().server &&
                            project.directory === selection().directory,
                        }}
                        onClick={() =>
                          setQuery({
                            server: ServerConnection.key(server),
                            directory: project.directory,
                            change: undefined,
                            investigation: undefined,
                            document: undefined,
                            anchor: undefined,
                            section: undefined,
                            search: undefined,
                            offset: undefined,
                            documentOffset: undefined,
                          })
                        }
                      >
                        <ProjectAvatar fallback={project.name} />
                        <span class="truncate">{project.name}</span>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
            <div class="mt-7 hidden lg:block">
              <ButtonV2
                variant="ghost"
                class="w-full"
                style={{ "justify-content": "flex-start" }}
                onClick={() => scope("investigations")}
              >
                Changes
              </ButtonV2>
              <HomeUtilityNav
                class="mt-1 flex"
                language={language}
                onOpenSettings={settings}
                onOpenHelp={() => platform.openExternal("https://opencode.ai/desktop-feedback")}
              />
            </div>
          </aside>
          <Show
            when={connection() && selection().directory}
            fallback={<p class="py-10">Choose a project from Home to view its changes.</p>}
          >
            <Show
              when={category() !== "investigations"}
              fallback={
                <div class="min-w-0 py-6 lg:pb-12 lg:pt-14">
                  <Show when={!query.investigation}>{heading()}</Show>
                  {documents(true)}
                </div>
              }
            >
              <ChangesView
                heading={heading()}
                title={proposalTitle.loading ? undefined : proposalTitle()}
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
                onRefresh={() => {
                  reload()
                  void reloadCounts()
                  void reloadTitle()
                }}
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
