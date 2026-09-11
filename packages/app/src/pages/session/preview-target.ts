import { createStore } from "solid-js/store"
import type { Platform } from "@/context/platform"
import { Persist, persisted } from "@/utils/persist"
import { ServerScope, type ServerScope as ServerScopeValue } from "@/utils/server-scope"

const PREVIEW_TARGET_KEY = "preview-target"
const MAX_CANDIDATES = 5
const SCHEME = /^([a-z][a-z0-9+.-]*):/i
const PORT_ONLY = /^\d+(?:\/|$)/
const CANDIDATE = /\bhttps?:\/\/[^\s"'`<>()[\]]+/gi
const ANSI_CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g
const TRAILING_PUNCTUATION = /[.,;:]+$/
const BRACKETS = /^\[|\]$/g
const IPV4_LOOPBACK = /^127\./

export type PreviewTargetRejection = "empty" | "unsupported-scheme" | "malformed" | "app-origin"

export type PreviewTargetVerdict =
  | { accepted: true; target: string }
  | { accepted: false; rejection: PreviewTargetRejection }

/**
 * Canonicalize typed input into a loadable http(s) target, or say why it cannot be one.
 * `appOrigin` is rejected: a frame sharing the app's origin keeps `allow-same-origin`
 * against the app itself, which would hand it the app's storage and `parent`.
 */
export function canonicalizePreviewTarget(input: string, appOrigin?: string): PreviewTargetVerdict {
  const value = (input ?? "").trim()
  if (!value) return { accepted: false, rejection: "empty" }

  const scheme = value.match(SCHEME)?.[1]?.toLowerCase()
  const rest = scheme ? value.slice(scheme.length + 1) : ""
  // "localhost:3000" reads as a scheme too, so a real scheme is one followed by "//"
  // or by something that is not just a port.
  const declaresScheme = Boolean(scheme) && (rest.startsWith("//") || !PORT_ONLY.test(rest))
  if (declaresScheme && scheme !== "http" && scheme !== "https")
    return { accepted: false, rejection: "unsupported-scheme" }

  const candidate = declaresScheme ? value : `http://${value}`
  if (!URL.canParse(candidate)) return { accepted: false, rejection: "malformed" }

  const url = new URL(candidate)
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { accepted: false, rejection: "unsupported-scheme" }
  if (!url.hostname) return { accepted: false, rejection: "malformed" }
  if (appOrigin && url.origin === appOrigin) return { accepted: false, rejection: "app-origin" }
  return { accepted: true, target: url.href }
}

function isLoopbackHost(hostname: string) {
  const host = hostname.replace(BRACKETS, "")
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || IPV4_LOOPBACK.test(host)
}

/** True when the host blocks this target as insecure content inside a secure app origin. */
export function isBlockedInsecureTarget(target: string, appOrigin: string): boolean {
  if (!URL.canParse(target)) return false
  const url = new URL(target)
  if (url.protocol !== "http:") return false
  if (isLoopbackHost(url.hostname)) return false
  return appOrigin.startsWith("https:") || appOrigin.startsWith("oc:")
}

/** Advisory http(s) targets observed in terminal output, oldest first, deduplicated. */
export function previewTargetCandidates(text: string, appOrigin?: string): string[] {
  const plain = (text ?? "").replace(ANSI_CSI, "").replace(ANSI_OSC, "")
  const seen = new Set<string>()
  for (const match of plain.matchAll(CANDIDATE)) {
    const verdict = canonicalizePreviewTarget(match[0].replace(TRAILING_PUNCTUATION, ""), appOrigin)
    if (!verdict.accepted) continue
    seen.delete(verdict.target)
    seen.add(verdict.target)
  }
  return [...seen].slice(-MAX_CANDIDATES)
}

/** Storage target for the remembered preview URL of one server and project. */
export function previewTargetStorage(directory: string, scope: ServerScopeValue = ServerScope.local) {
  return Persist.serverWorkspace(scope, directory, PREVIEW_TARGET_KEY)
}

export type PreviewTargetState = { target: string }

/**
 * Remembered target for one server and project. Callers run inside a component,
 * so the persisted store resolves platform storage itself.
 */
export function createPreviewTargetStore(input: {
  directory: string
  scope?: ServerScopeValue
  platform?: Platform
}) {
  // The setter returned by persisted() is the one that writes to storage; the raw
  // createStore setter only mutates memory, and the panel unmounts on every tab switch.
  const [state, setState, , ready] = persisted(
    previewTargetStorage(input.directory, input.scope),
    createStore<PreviewTargetState>({ target: "" }),
    input.platform,
  )
  return {
    ready,
    target: () => state.target,
    remember(target: string) {
      setState("target", target)
    },
    forget() {
      setState("target", "")
    },
  }
}
