import { createSignal } from "solid-js"
import type { ChangeItem, ChangePage, ChangeSelection } from "./reader"
import type { ChangesState } from "./refresh"
import type { ChangeSection } from "./view-model"
import { ChangesHeading, ChangesView } from "./view"

export default {
  title: "App/Changes/View",
  id: "app-changes-view",
  component: ChangesView,
}

const evidenced: ChangeItem = {
  id: "port-changes-web-ui",
  title: "Port the Changes web UI",
  status: "building",
  phase: "build",
  updatedAt: "2026-10-29T08:30:00.000Z",
  evidenceStatus: "unverified",
  evidence: {
    status: "unverified",
    recordedStatus: "pass",
    freshness: "unavailable",
    providers: [{ provider: "test", status: "pass" }],
  },
  budget: {
    lifetime: { usedRequests: null, usedTokens: 1200 },
    window: { id: "w1", usedRequests: 3, usedTokens: 400, targetRequests: null, targetTokens: 5000 },
  },
  run: { branch: "change/port-changes-web-ui", operationMs: { build: 1500 } },
}

const bare: ChangeItem = {
  id: "no-measurements",
  status: "proven",
  phase: "prove",
  updatedAt: null,
  evidence: null,
  budget: null,
  run: null,
}

const page = (items: ChangeItem[], extra: Partial<ChangePage> = {}): ChangePage => ({
  generatedAt: "2026-10-29T09:00:00.000Z",
  items,
  total: items.length,
  nextOffset: null,
  diagnostics: [],
  ...extra,
})

const state = (data: ChangePage | undefined, extra: Partial<ChangesState> = {}, detail?: ChangeItem): ChangesState => ({
  loading: false,
  stale: false,
  data: data ? { location: { directory: "/project" }, data, detail } : undefined,
  ...extra,
})

function Harness(props: {
  state: ChangesState
  scope?: ChangeSelection["scope"]
  search?: string
  offset?: number
  changeID?: string
  section?: ChangeSection
}) {
  const [section, setSection] = createSignal<ChangeSection>(props.section ?? "overview")
  const [scope, setScope] = createSignal(props.scope ?? "active")
  const [draft, setDraft] = createSignal<string>()
  const [paged, setPaged] = createSignal<number>()
  const selection = (): ChangeSelection => ({
    server: "local",
    directory: "/project",
    scope: scope(),
    search: props.search ?? "",
    offset: props.offset ?? 0,
    changeID: props.changeID,
  })

  return (
    <div class="mx-auto w-full max-w-[720px] bg-v2-background-bg-base px-3 text-v2-text-text-base">
      <ChangesView
        heading={
          <ChangesHeading
            project="project"
            scope={scope()}
            search={props.search ?? ""}
            onScope={setScope}
            onSearch={() => {}}
            onNew={() => {}}
          />
        }
        state={props.state}
        selection={selection()}
        section={section()}
        onSelect={() => {}}
        onSection={setSection}
        onPage={setPaged}
        onRefresh={() => {}}
        onContinue={(item) => setDraft(`/${item.phase} ${item.id}`)}
      />
      <span data-slot="story-draft">{draft()}</span>
      <span data-slot="story-offset">{paged()}</span>
    </div>
  )
}

export const List = { render: () => <Harness state={state(page([evidenced, bare]))} /> }

export const Archived = { render: () => <Harness state={state(page([bare]))} scope="archive" /> }

export const Empty = { render: () => <Harness state={state(page([]))} /> }

export const Paged = {
  render: () => <Harness state={state(page([evidenced], { total: 120, nextOffset: 50 }))} />,
}

export const Unsupported = { render: () => <Harness state={state(undefined, { error: "unsupported" })} /> }

export const NotInitialized = { render: () => <Harness state={state(undefined, { error: "not_initialized" })} /> }

export const Stale = {
  render: () => <Harness state={state(page([evidenced]), { error: "timeout", stale: true })} />,
}

export const Loading = { render: () => <Harness state={state(undefined, { loading: true })} /> }

export const Detail = {
  render: () => (
    <Harness state={state(page([evidenced]), {}, evidenced)} changeID={evidenced.id} />
  ),
}

export const DetailWithoutMeasurements = {
  render: () => <Harness state={state(page([bare]), {}, bare)} changeID={bare.id} section="usage" />,
}
