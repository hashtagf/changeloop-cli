import { createSignal } from "solid-js"
import type { Foundation } from "@opencode/schema/foundation"
import type { DocumentReader } from "./document-reader"
import type { ChangeItem } from "./reader"
import type { ChangeSection } from "./view-model"
import { DocumentWorkspace } from "./workspace"

export default {
  title: "App/Changes/Workspace",
  id: "app-changes-workspace",
  component: DocumentWorkspace,
}

const metadata = (id: string, path: string, title: string): Foundation.DocumentMetadata => ({
  id,
  title,
  sourcePath: path,
  modifiedAt: "2026-10-29T08:00:00.000Z",
  readAt: "2026-10-29T09:00:00.000Z",
  size: 100,
})

const body = (
  base: Foundation.DocumentMetadata,
  text: string,
  extra: Partial<Foundation.Document> = {},
): Foundation.Document => ({
  ...base,
  sha256: "0123abcd",
  text,
  sections: [],
  references: [],
  tasks: [],
  claims: [],
  diagnostics: [],
  ...extra,
})

const noteOne = metadata("note-1", "openspec/investigations/search.md", "Investigation: Search options")
const noteTwo = metadata("note-2", "openspec/investigations/auth.md", "Investigation: Auth review")

const notes: Record<string, Foundation.Document> = {
  "note-1": body(
    noteOne,
    "# Search options\n\n## Findings\nIndex on write. See [auth](auth.md).\n\n## Options\nScan on read.\n",
    {
      sections: [
        { id: "line-1", title: "Search options", line: 1, level: 1 },
        { id: "line-3", title: "Findings", line: 3, level: 2 },
        { id: "line-6", title: "Options", line: 6, level: 2 },
      ],
      references: [
        { changeID: "2026-10-01-add-search", sourcePath: "openspec/changes/archive/2026-10-01-add-search/proposal.md" },
      ],
    },
  ),
  "note-2": body(noteTwo, "Unstructured review of the auth flow.\n"),
}

const proposal = metadata("p", "openspec/changes/alpha/proposal.md", "Change: Add search")
const design = metadata("d", "openspec/changes/alpha/design.md", "Design")
const tasks = metadata("t", "openspec/changes/alpha/tasks.md", "Tasks")
const evidence = metadata("e", "openspec/changes/alpha/evidence.yaml", "Evidence")

const changeDocuments: Record<string, Foundation.Document> = {
  p: body(proposal, "# Change: Add search\n\n## Why\nUsers cannot find changes.\n\n## Scope\nA search box.\n", {
    sections: [
      { id: "line-1", title: "Change: Add search", line: 1, level: 1 },
      { id: "line-3", title: "Why", line: 3, level: 2 },
      { id: "line-6", title: "Scope", line: 6, level: 2 },
    ],
  }),
  d: body(design, "# Design\n\nSee the [tasks](tasks.md) and [outside](../../../etc/passwd).\n\n## Test plan\nCover search.\n", {
    sections: [
      { id: "line-1", title: "Design", line: 1, level: 1 },
      { id: "line-5", title: "Test plan", line: 5, level: 2 },
    ],
  }),
  t: body(tasks, "- [x] Build the box\n- [ ] Wire it [key:wire]\n- [ ] Prove it\n", {
    tasks: [
      { text: "Build the box", checked: true, line: 1 },
      { text: "Wire it [key:wire]", checked: false, line: 2 },
      { text: "Prove it", checked: false, line: 3 },
    ],
  }),
  e: body(evidence, "claims:\n  box:\n    capabilities: [test]\n", {
    claims: [{ id: "box", text: "capabilities: [test]" }],
  }),
}

const bare: ChangeItem = {
  id: "alpha",
  status: "building",
  phase: "build",
  updatedAt: "2026-10-29T08:00:00.000Z",
  evidenceStatus: "unverified",
  evidence: { status: "unverified", recordedStatus: "pass", freshness: "unavailable", providers: [] },
  budget: null,
  run: { branch: "change/alpha" },
}

function reader(input: {
  items: Foundation.DocumentMetadata[]
  documents: Record<string, Foundation.Document>
  failBody?: string
  failIndex?: string
  total?: number
  nextOffset?: number
}): Pick<DocumentReader, "index" | "read"> {
  const location = { directory: "/project" } as never

  return {
    async index() {
      if (input.failIndex) throw { code: input.failIndex }

      return {
        location,
        data: {
          items: input.items,
          total: input.total ?? input.items.length,
          nextOffset: input.nextOffset ?? null,
          readAt: "2026-10-29T09:00:00.000Z",
          diagnostics: [],
        },
      }
    },
    async read(selection) {
      if (input.failBody) throw { code: input.failBody }

      return { location, data: input.documents[selection.documentID ?? selection.investigationID ?? ""] }
    },
  }
}

function Harness(props: {
  reader: Pick<DocumentReader, "index" | "read">
  changeID?: string
  section?: ChangeSection
  id?: string
  search?: string
}) {
  const [id, setId] = createSignal(props.id)
  const [section, setSection] = createSignal<ChangeSection>(props.section ?? "overview")
  const [anchor, setAnchor] = createSignal<string>()
  const [offset, setOffset] = createSignal(0)
  const [log, setLog] = createSignal("")

  return (
    <div class="mx-auto w-full max-w-[720px] bg-v2-background-bg-base px-3 text-v2-text-text-base">
      <DocumentWorkspace
        reader={props.reader}
        server="local"
        directory="/project"
        changeID={props.changeID}
        item={props.changeID ? bare : undefined}
        id={id()}
        section={props.changeID ? section() : undefined}
        anchor={anchor()}
        search={props.search ?? ""}
        offset={offset()}
        onSection={setSection}
        onSelect={setId}
        onAnchor={setAnchor}
        onPage={setOffset}
        onReference={(change, archived) => setLog(`reference ${change} ${archived ? "archive" : "active"}`)}
        onDraft={(command, source) => setLog(`draft /${command} ${source}`)}
      />
      <span data-slot="story-log">{log()}</span>
      <span data-slot="story-offset">{offset()}</span>
    </div>
  )
}

const noteReader = () => reader({ items: [noteOne, noteTwo], documents: notes })

const changeReader = (extra: Partial<Parameters<typeof reader>[0]> = {}) =>
  reader({ items: [proposal, design, tasks, evidence], documents: changeDocuments, ...extra })

export const Notes = { render: () => <Harness reader={noteReader()} /> }

export const NotesPaged = {
  render: () => (
    <Harness reader={reader({ items: [noteOne], documents: notes, total: 120, nextOffset: 50 })} />
  ),
}

export const NotesEmpty = { render: () => <Harness reader={reader({ items: [], documents: {} })} /> }

export const NotesSearchEmpty = {
  render: () => <Harness reader={reader({ items: [], documents: {} })} search="zzz" />,
}

export const NoteReader = { render: () => <Harness reader={noteReader()} id="note-1" /> }

export const NoteWithoutReferences = { render: () => <Harness reader={noteReader()} id="note-2" /> }

export const Overview = { render: () => <Harness reader={changeReader()} changeID="alpha" /> }

export const OverviewWithoutProposal = {
  render: () => <Harness reader={changeReader({ failBody: "document_too_large" })} changeID="alpha" />,
}

export const Documents = { render: () => <Harness reader={changeReader()} changeID="alpha" section="documents" /> }

export const Tasks = { render: () => <Harness reader={changeReader()} changeID="alpha" section="tasks" /> }

export const Claims = { render: () => <Harness reader={changeReader()} changeID="alpha" section="evidence" /> }

export const IndexUnavailable = {
  render: () => <Harness reader={changeReader({ failIndex: "timeout" })} changeID="alpha" section="documents" />,
}
