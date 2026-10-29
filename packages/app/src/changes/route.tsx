import { useSearchParams } from "@solidjs/router"
import { ScrollView } from "@opencode/ui/scroll-view"
import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { createHomeController } from "@/home/model"
import { createHomeProjectsController } from "@/home/projects/controller"
import { HomeProjects } from "@/home/projects/region"
import { HomeUtilityNav } from "@/home/projects/view"
import { createHomeScrollController } from "@/home/scroll"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { changeDraft, investigateDraft } from "./draft"
import { createChangesReader, type ChangeItem, type ChangeSelection } from "./reader"
import { createChangesRefresh, type ChangesState } from "./refresh"
import { ChangesHeading, ChangesView } from "./view"
import { changeSection } from "./view-model"

const number = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

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

  const connection = () => home.server.focused()
  const directory = () => home.selection.value().directory
  const scope = () => (query.scope === "archive" ? "archive" : "active")
  const selection = createMemo<ChangeSelection | undefined>(() => {
    const conn = connection()
    const dir = directory()

    if (!conn || !dir) return

    return {
      server: ServerConnection.key(conn),
      directory: dir,
      scope: scope(),
      search: text(query.search) ?? "",
      offset: number(query.offset),
      changeID: text(query.change),
    }
  })

  const reader = createMemo(() => {
    const conn = connection()

    return conn ? createChangesReader(global.ensureServerCtx(conn).sdk.api.foundation) : undefined
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

  const visible = () => document.visibilityState !== "hidden"

  createEffect(() => {
    const value = selection()

    refresh.visibility(!!value && visible())

    if (value) refresh.select(value)
  })

  onMount(() => {
    const onVisible = () => refresh.visibility(!!selection() && visible())
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

  const projectName = () => {
    const dir = directory() ?? ""

    return home.project.selected()?.name || dir.split("/").filter(Boolean).at(-1) || ""
  }

  const reload = () => {
    if (selection()?.offset) return setQuery({ offset: undefined })

    void refresh.refresh()
  }

  const openDraft = async (item?: ChangeItem) => {
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
      const prompt = item ? changeDraft(item, commands) : investigateDraft(commands)

      if (!prompt) return setDraftError(language.t("changes.draft.unavailable"))
      global.ensureServerCtx(conn).projects.touch(target.directory)
      await tabs.newDraft({ server: target.server as ServerConnection.Key, directory: target.directory }, prompt)
    } catch {
      setDraftError(language.t("changes.draft.failed"))
    } finally {
      setDraftPending(false)
    }
  }

  const setScope = (next: "active" | "archive") =>
    setQuery({ scope: next, change: undefined, section: undefined, search: undefined, offset: undefined })

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
          <Show when={selection()} fallback={<p class="py-10 text-v2-text-text-muted">{language.t("changes.noProject")}</p>}>
            {(value) => (
              <ChangesView
                heading={
                  <ChangesHeading
                    project={projectName()}
                    scope={value().scope}
                    search={value().search}
                    onScope={setScope}
                    onSearch={(search) =>
                      setQuery({ search: search || undefined, offset: undefined, change: undefined }, { replace: true })
                    }
                    onNew={() => void openDraft()}
                    pending={draftPending()}
                  />
                }
                state={state()}
                selection={value()}
                section={changeSection(query.section)}
                onSelect={(change) => setQuery({ change, section: undefined })}
                onSection={(section) => setQuery({ section })}
                onPage={(offset) => setQuery({ offset: offset || undefined })}
                onRefresh={reload}
                onContinue={(item) => void openDraft(item)}
                draftPending={draftPending()}
                draftError={draftError()}
              />
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
