export * as FoundationDocumentReader from "./foundation-documents"

import path from "path"
import { constants } from "fs"
import { lstat, open, opendir, realpath } from "fs/promises"
import { Effect, Layer } from "effect"
import { Foundation } from "@opencode-ai/schema/foundation"
import { FoundationDocuments } from "@opencode-ai/core/foundation-documents"
import { ReadError, identifier, selection } from "@opencode-ai/core/foundation"

const maximum = 256 * 1024
const names = ["proposal.md", "design.md", "tasks.md", "evidence.yaml", "grounding.yaml"]
type Scan = { root: string; readAt: string; remaining: number; expired: boolean }
type Entry = { sourcePath: string; size: number; modifiedAt: string }

export const layer = Layer.succeed(
  FoundationDocuments.Service,
  FoundationDocuments.Service.of({
    index: (directory, query) => Effect.tryPromise({ try: () => index(directory, query), catch: failure }),
    read: (directory, query) => Effect.tryPromise({ try: () => read(directory, query), catch: failure }),
  }),
)

export function index(directory: string, query: FoundationDocuments.Query = {}) {
  return request(directory, async (scan) => {
    const page = selection(query)
    const entries = query.changeID ? await documents(scan, identifier(query.changeID)) : await notes(scan)
    const diagnostics: string[] = []
    const items: Foundation.DocumentMetadata[] = []
    for (const entry of entries) {
      check(scan)
      const title =
        query.changeID || entry.size > maximum
          ? path.basename(entry.sourcePath)
          : titleOf((await body(scan, entry.sourcePath)).text, entry.sourcePath)
      if (entry.size > maximum) diagnostics.push(`${entry.sourcePath}: document_too_large`)
      items.push({ ...entry, id: identity(entry.sourcePath), title, readAt: scan.readAt })
    }
    const filtered = items.filter(
      (item) =>
        !page.search ||
        `${item.id}\n${item.title}\n${path.basename(item.sourcePath, ".md")}`.toLowerCase().includes(page.search),
    )
    if (!query.changeID) filtered.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.id.localeCompare(b.id))
    return bounded({
      items: filtered.slice(page.offset, page.offset + page.limit),
      total: filtered.length,
      nextOffset: page.offset + page.limit < filtered.length ? page.offset + page.limit : null,
      readAt: scan.readAt,
      diagnostics,
    })
  })
}

export function read(directory: string, query: FoundationDocuments.Query) {
  return request(directory, async (scan) => {
    const id = query.changeID ? query.documentID : query.investigationID
    if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new ReadError("invalid_input", "Invalid document identity")
    const entries = query.changeID ? await documents(scan, identifier(query.changeID)) : await notes(scan)
    const entry = entries.find((item) => identity(item.sourcePath) === id)
    if (!entry) throw new ReadError("not_found", "Document was not found in this project")
    const content = await body(scan, entry.sourcePath)
    const parsed = parse(content.text, entry.sourcePath)
    const linked = query.changeID ? { references: [], diagnostics: [] } : await referencesTo(scan, entry.sourcePath)
    return bounded({
      ...entry,
      ...content,
      id,
      title: titleOf(content.text, entry.sourcePath),
      readAt: scan.readAt,
      sha256: identity(content.text),
      ...parsed,
      references: linked.references,
      diagnostics: [...parsed.diagnostics, ...linked.diagnostics],
    })
  })
}

async function request<A>(directory: string, operation: (scan: Scan) => Promise<A>): Promise<A> {
  const scan: Scan = { root: "", readAt: new Date().toISOString(), remaining: 4096, expired: false }
  const timeout = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    scan.expired = true
    timeout.reject(new ReadError("index_limit_exceeded", "Document read exceeded five seconds"))
  }, 5000)
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        scan.root = await realpath(directory)
        check(scan)
        return operation(scan)
      }),
      timeout.promise,
    ])
  } catch (error) {
    throw failure(error)
  } finally {
    clearTimeout(timer)
    scan.expired = true
  }
}

function check(scan: Scan) {
  if (scan.expired || scan.remaining < 0)
    throw new ReadError("index_limit_exceeded", "Document index exceeds its scan limit")
}
function identity(value: string) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex")
}
function bounded<A>(value: A): A {
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024 - 4096)
    throw new ReadError("document_too_large", "Encoded document response exceeds 1 MiB")
  return value
}
function failure(error: unknown): ReadError {
  if (error instanceof ReadError) return error
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined
  if (code === "ENOENT" || code === "ENOTDIR") return new ReadError("not_found", "Document source was not found")
  if (code === "EACCES" || code === "EPERM") return new ReadError("denied", "Document source is not readable")
  if (code === "ELOOP") return new ReadError("invalid_input", "Symbolic document sources are not supported")
  return new ReadError("invalid_document", "Document source could not be read")
}

// Validate every ancestor, then bind the opened descriptor to this same inode.
// Rejecting symbolic ancestors also makes opaque IDs safe across archive moves.
async function inspect(scan: Scan, sourcePath: string) {
  check(scan)
  if ((await realpath(scan.root)) !== scan.root)
    throw new ReadError("invalid_input", "Project root changed containment")
  if (path.isAbsolute(sourcePath) || sourcePath.split("/").some((part) => !part || part === "." || part === ".."))
    throw new ReadError("invalid_input", "Invalid document source")
  const parts = sourcePath.split("/")
  for (let i = 1; i <= parts.length; i++) {
    const info = await lstat(path.join(scan.root, ...parts.slice(0, i)))
    check(scan)
    if (info.isSymbolicLink()) throw new ReadError("invalid_input", "Symbolic document sources are not supported")
    if (i !== parts.length && !info.isDirectory())
      throw new ReadError("invalid_input", "Document ancestor is not a directory")
    if (i === parts.length) return info
  }
  throw new ReadError("invalid_input", "Invalid document source")
}

async function children(scan: Scan, sourcePath: string, depth = 0): Promise<string[]> {
  if (depth > 32) throw new ReadError("index_limit_exceeded", "Document index nesting exceeds 32 levels")
  const info = await inspect(scan, sourcePath).catch((error) => {
    if (failure(error).code === "not_found") return undefined
    throw error
  })
  if (!info) return []
  if (!info.isDirectory()) throw new ReadError("invalid_input", "Document source is not a directory")
  const entries: string[] = []
  const directory = await opendir(path.join(scan.root, sourcePath))
  // for-await closes the directory even on a thrown bound or cancellation.
  for await (const entry of directory) {
    scan.remaining--
    check(scan)
    entries.push(entry.name)
  }
  return entries.sort()
}

async function metadata(scan: Scan, sourcePath: string): Promise<Entry> {
  const info = await inspect(scan, sourcePath)
  if (!info.isFile()) throw new ReadError("invalid_input", "Only regular document files are supported")
  return { sourcePath, size: info.size, modifiedAt: info.mtime.toISOString() }
}
async function notes(scan: Scan) {
  const root = "openspec/investigations"
  const entries: Entry[] = []
  for (const name of await children(scan, root)) {
    if (name.endsWith(".md")) entries.push(await metadata(scan, `${root}/${name}`))
  }
  return entries
}
async function changeRoot(scan: Scan, id: string) {
  const active = `openspec/changes/${id}`
  const info = await inspect(scan, active).catch((error) => {
    if (failure(error).code === "not_found") return undefined
    throw error
  })
  if (info) {
    if (!info.isDirectory()) throw new ReadError("invalid_input", "Change source is not a directory")
    return active
  }
  const matches = (await children(scan, "openspec/changes/archive")).filter(
    (name) => /^\d{4}-\d{2}-\d{2}-/.test(name) && name.slice(11) === id,
  )
  if (matches.length > 1) throw new ReadError("ambiguous_archive", "More than one archive matches this change")
  if (!matches.length) throw new ReadError("not_found", "Change documents were not found")
  return `openspec/changes/archive/${matches[0]}`
}
async function documents(scan: Scan, id: string) {
  const root = await changeRoot(scan, id)
  const entries: Entry[] = []
  for (const name of names) {
    const entry = await metadata(scan, `${root}/${name}`).catch((error) => {
      if (failure(error).code === "not_found") return undefined
      throw error
    })
    if (entry) entries.push(entry)
  }
  const specs = async (sourcePath: string, depth: number): Promise<void> => {
    for (const name of await children(scan, sourcePath, depth)) {
      const target = `${sourcePath}/${name}`
      const info = await inspect(scan, target)
      if (info.isDirectory()) await specs(target, depth + 1)
      else if (name.endsWith(".md")) entries.push(await metadata(scan, target))
    }
  }
  await specs(`${root}/specs`, 1)
  return entries
}

async function body(scan: Scan, sourcePath: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await inspect(scan, sourcePath)
    if (!before.isFile()) throw new ReadError("invalid_input", "Only regular document files are supported")
    if (before.size > maximum) throw new ReadError("document_too_large", "Document exceeds 256 KiB")
    const file = await open(
      path.join(scan.root, sourcePath),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const opened = await file.stat()
      check(scan)
      if (!opened.isFile()) throw new ReadError("invalid_input", "Only regular document files are supported")
      if (opened.ino !== before.ino || opened.dev !== before.dev) continue
      const buffer = Buffer.alloc(maximum + 1)
      let length = 0
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, length)
        check(scan)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      if (length > maximum) throw new ReadError("document_too_large", "Document exceeds 256 KiB")
      const after = await file.stat()
      const current = await inspect(scan, sourcePath)
      if (
        before.ino !== current.ino ||
        before.dev !== current.dev ||
        opened.size !== after.size ||
        opened.mtimeMs !== after.mtimeMs ||
        opened.ctimeMs !== after.ctimeMs ||
        after.size !== length ||
        after.mtimeMs !== current.mtimeMs ||
        after.ctimeMs !== current.ctimeMs
      )
        continue
      const resolved = await realpath(path.join(scan.root, sourcePath))
      check(scan)
      if (resolved !== path.join(scan.root, sourcePath))
        throw new ReadError("invalid_input", "Document source changed containment")
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))
      return { text, size: length, modifiedAt: after.mtime.toISOString() }
    } finally {
      await file.close()
    }
  }
  throw new ReadError("document_changed", "Document changed while reading; retry")
}

function titleOf(text: string, sourcePath: string) {
  return parse(text, sourcePath).sections[0]?.title ?? path.basename(sourcePath, path.extname(sourcePath))
}
export function parse(text: string, sourcePath: string) {
  const sections: Foundation.Document["sections"][number][] = []
  const tasks: Foundation.Document["tasks"][number][] = []
  const claims: Foundation.Document["claims"][number][] = []
  const diagnostics: string[] = []
  let fence = ""
  text.split(/\r\n|\r|\n/).forEach((line, index) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ""
      return
    }
    if (fence) return
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading)
      sections.push({ id: `line-${index + 1}`, title: heading[2], line: index + 1, level: heading[1].length })
    const task = /^\s*[-*+] \[([ xX])\]\s+(.+)$/.exec(line)
    if (task) tasks.push({ checked: task[1] !== " ", text: task[2], line: index + 1 })
  })
  if (sourcePath.endsWith("evidence.yaml")) {
    try {
      const value: unknown = Bun.YAML.parse(text)
      if (!value || typeof value !== "object" || !("claims" in value) || !Array.isArray(value.claims))
        throw new Error("Invalid claims")
      for (const claim of value.claims) {
        if (!claim || typeof claim !== "object" || !("id" in claim) || typeof claim.id !== "string")
          throw new Error("Invalid claim")
        claims.push({ id: claim.id, text: JSON.stringify(claim) })
      }
    } catch {
      claims.length = 0
      diagnostics.push("Evidence contract could not be parsed; read the original document")
    }
  }
  if (sourcePath.endsWith("tasks.md") && !tasks.length)
    diagnostics.push("No recognized task checkboxes; read the original document")
  return { sections, tasks, claims, diagnostics }
}

async function referencesTo(parent: Scan, target: string) {
  // Cross-references are optional enrichment, separate from the requested note.
  const scan = { ...parent, remaining: Math.min(parent.remaining, 1024) }
  const references: Foundation.Document["references"][number][] = []
  const diagnostics: string[] = []
  let bytes = 0
  const diagnose = (source: string, error: unknown) => {
    if (diagnostics.length < 64)
      diagnostics.push(`${source.slice(0, 240)}: references not scanned (${failure(error).code})`)
  }
  const partial = Promise.withResolvers<void>()
  const timer = setTimeout(
    () => {
      diagnose("Reference scan", new ReadError("index_limit_exceeded", "Reference scan time limit"))
      scan.expired = true
      partial.resolve()
    },
    Math.max(0, Math.min(1000, 4500 - (Date.now() - Date.parse(parent.readAt)))),
  )
  const work = async () => {
    const active = (await children(scan, "openspec/changes")).filter(
      (name) => name !== "archive" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name),
    )
    const archived = (await children(scan, "openspec/changes/archive"))
      .filter((name) => /^\d{4}-\d{2}-\d{2}-[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name))
      .map((name) => name.slice(11))
    for (const changeID of new Set([...active, ...archived])) {
      check(scan)
      const entries = await documents(scan, changeID).catch((error) => {
        if (failure(error).code === "index_limit_exceeded") throw error
        diagnose(changeID, error)
        return []
      })
      for (const entry of entries) {
        if (!entry.sourcePath.endsWith(".md")) continue
        scan.remaining--
        check(scan)
        if (entry.size > maximum) {
          diagnose(entry.sourcePath, new ReadError("document_too_large", "Document exceeds 256 KiB"))
          continue
        }
        bytes += entry.size
        if (bytes > 2 * 1024 * 1024) throw new ReadError("index_limit_exceeded", "Reference scan exceeds 2 MiB")
        const content = await body(scan, entry.sourcePath).catch((error) => {
          if (failure(error).code === "index_limit_exceeded") throw error
          diagnose(entry.sourcePath, error)
          return undefined
        })
        if (!content) continue
        let fence = ""
        const prose = content.text
          .split(/\r?\n/)
          .map((line) => {
            const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
            if (marker) {
              if (!fence) fence = marker
              else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ""
              return ""
            }
            return fence ? "" : line.replace(/`+[^`]*`+/g, "")
          })
          .join("\n")
        const links = [...prose.matchAll(/(?<!!)\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)]
        if (
          !links.some((link) => {
            const href = link[1].split("#")[0]
            if (!href || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href)) return false
            const decoded = (() => {
              try {
                return decodeURIComponent(href)
              } catch {
                return ""
              }
            })()
            if (!decoded || decoded.includes("\\")) return false
            const resolved = path.posix.normalize(
              decoded.startsWith("openspec/")
                ? decoded
                : path.posix.join(path.posix.dirname(entry.sourcePath), decoded),
            )
            return resolved === target
          })
        )
          continue
        const reference = { changeID, sourcePath: entry.sourcePath }
        if (Buffer.byteLength(JSON.stringify([...references, reference])) > 128 * 1024)
          throw new ReadError("index_limit_exceeded", "Reference result exceeds 128 KiB")
        references.push(reference)
      }
    }
  }
  try {
    await Promise.race([
      work().catch((error) => {
        if (!scan.expired) diagnose("Reference scan", error)
      }),
      partial.promise,
    ])
    return { references: [...references], diagnostics: [...diagnostics] }
  } finally {
    scan.expired = true
    clearTimeout(timer)
  }
}
