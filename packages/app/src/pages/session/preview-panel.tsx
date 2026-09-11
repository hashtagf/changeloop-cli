import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { terminalOutputTail } from "@/context/terminal"
import {
  canonicalizePreviewTarget,
  createPreviewTargetStore,
  isBlockedInsecureTarget,
  previewTargetCandidates,
  type PreviewTargetRejection,
} from "@/pages/session/preview-target"

/** Every state the preview can be in. Each one is shown as text, never colour alone. */
export type PreviewPhase =
  | "no-target"
  | "invalid-target"
  | "loading"
  | "loaded"
  | "unreachable"
  | "framing-refused"
  | "blocked-insecure-content"

/** A frame that never loads is the only signal a site refuses embedding. */
export const FRAME_CONFIRM_MS = 6000

/**
 * Frame attributes that keep a previewed origin isolated from the app: it may run
 * its own scripts and use its own storage, but it cannot navigate or open the app.
 */
export const PREVIEW_FRAME_ATTRIBUTES = {
  sandbox: "allow-scripts allow-forms allow-same-origin",
  referrerPolicy: "no-referrer" as const,
  allow: "",
}

export type PreviewProbe = (target: string) => Promise<boolean>

const defaultProbe: PreviewProbe = async (target) => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 4000)
  try {
    await fetch(target, {
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      // Same posture as the frame: the previewed origin learns nothing about the app.
      referrerPolicy: "no-referrer",
      signal: abort.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export type PreviewController = ReturnType<typeof createPreviewController>

/**
 * Target and load state for one project. Kept separate from rendering so every
 * reachable state can be driven in a test without a real network or frame.
 */
export function createPreviewController(input: {
  directory: string
  appOrigin: string
  target?: () => string
  remember?: (target: string) => void
  probe?: PreviewProbe
  confirmMs?: number
}) {
  const probe = input.probe ?? defaultProbe
  const confirmMs = input.confirmMs ?? FRAME_CONFIRM_MS
  const [phase, setPhase] = createSignal<PreviewPhase>("no-target")
  const [rejection, setRejection] = createSignal<PreviewTargetRejection | undefined>()
  const [target, setTarget] = createSignal("")
  const [nonce, setNonce] = createSignal(0)
  let confirmTimer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0

  const stopConfirm = () => {
    if (confirmTimer === undefined) return
    clearTimeout(confirmTimer)
    confirmTimer = undefined
  }
  onCleanup(stopConfirm)

  const load = (next: string) => {
    attempt += 1
    const current = attempt
    stopConfirm()
    setTarget(next)
    setRejection(undefined)

    if (isBlockedInsecureTarget(next, input.appOrigin)) {
      setPhase("blocked-insecure-content")
      return
    }

    setPhase("loading")
    setNonce((value) => value + 1)
    void probe(next).then((reachable) => {
      if (current !== attempt) return
      if (!reachable) {
        setPhase("unreachable")
        return
      }
      confirmTimer = setTimeout(() => {
        if (current !== attempt) return
        if (phase() !== "loading") return
        setPhase("framing-refused")
      }, confirmMs)
    })
  }

  return {
    phase,
    rejection,
    target,
    /** Changes whenever the frame must be recreated, so a reload is a real reload. */
    frameToken: () => (target() ? `${target()}|${nonce()}` : ""),
    submit(value: string) {
      const verdict = canonicalizePreviewTarget(value, input.appOrigin)
      if (!verdict.accepted) {
        stopConfirm()
        attempt += 1
        setRejection(verdict.rejection)
        setPhase(verdict.rejection === "empty" && !target() ? "no-target" : "invalid-target")
        return undefined
      }
      input.remember?.(verdict.target)
      load(verdict.target)
      return verdict.target
    },
    reload() {
      const current = target()
      if (!current) return
      load(current)
    },
    restore(value: string) {
      if (!value || target()) return
      const verdict = canonicalizePreviewTarget(value, input.appOrigin)
      if (!verdict.accepted) return
      load(verdict.target)
    },
    frameLoaded() {
      stopConfirm()
      if (phase() !== "loading") return
      setPhase("loaded")
    },
    clear() {
      stopConfirm()
      attempt += 1
      setTarget("")
      setRejection(undefined)
      setPhase("no-target")
    },
  }
}

// Preview copy lives here rather than in the shared dictionary: a key in
// src/i18n/en.ts obliges a matching entry in all 61 locales, which the repository
// fills with script/translate-app.ts. Move these across when that script runs.
export const PREVIEW_TEXT = {
  tab: "Preview",
  open: "Open preview",
  targetLabel: "Preview address",
  targetPlaceholder: "localhost:3000",
  load: "Load",
  reload: "Reload preview",
  openExternal: "Open in browser",
  suggestions: "Seen in terminal:",
  frameTitle: "Website preview",
  emptyHint: "Enter the address your dev server prints, or pick one seen in the terminal",
}

const STATE_TEXT: Record<PreviewPhase, string> = {
  "no-target": "No address yet",
  "invalid-target": "That address cannot be previewed",
  loading: "Loading preview...",
  loaded: "Preview loaded",
  unreachable: "Nothing is answering at this address",
  "framing-refused": "This site did not render here; it may refuse embedding. Open it in the browser",
  "blocked-insecure-content":
    "Blocked: an insecure http address outside localhost cannot render here. Open it in the browser",
}

const REJECTION_TEXT: Record<PreviewTargetRejection, string> = {
  empty: "Enter an address to preview",
  "unsupported-scheme": "Only http and https addresses can be previewed",
  malformed: "That address could not be read",
  "app-origin": "This app's own address cannot be previewed inside itself",
}

/** The one sentence shown for a state, so no state is signalled by colour alone. */
export function previewStateText(phase: PreviewPhase, rejection?: PreviewTargetRejection) {
  if (phase === "invalid-target" && rejection) return REJECTION_TEXT[rejection]
  return STATE_TEXT[phase]
}

export function PreviewPanel(props: { active: boolean }) {
  const platform = usePlatform()
  const sdk = useSDK()
  const directory = createMemo(() => sdk().directory)
  const inputID = `session-preview-target-${createUniqueId()}`
  const statusID = `session-preview-status-${createUniqueId()}`

  const appOrigin = typeof location === "undefined" ? "" : location.origin
  const remembered = createPreviewTargetStore({ directory: directory() })
  const controller = createPreviewController({
    directory: directory(),
    appOrigin,
    remember: (target) => remembered.remember(target),
  })

  const [draft, setDraft] = createSignal("")
  const suggestions = createMemo(() => previewTargetCandidates(terminalOutputTail(directory()), appOrigin))
  let frame: HTMLIFrameElement | undefined

  createEffect(() => {
    const value = remembered.target()
    if (!value) return
    controller.restore(value)
    if (!draft()) setDraft(value)
  })

  // Focus leaving for the preview frame blurs this window too, so returning from a
  // click inside the preview must not reload it and throw away what the user did there.
  let focusLeftForFrame = false
  makeEventListener(window, "blur", () => {
    focusLeftForFrame = !!frame && document.activeElement === frame
  })
  // Editing elsewhere then coming back is the common case a dev server restart hides.
  makeEventListener(window, "focus", () => {
    const fromFrame = focusLeftForFrame
    focusLeftForFrame = false
    if (fromFrame) return
    if (!props.active) return
    if (document.visibilityState === "hidden") return
    controller.reload()
  })

  const submit = (value: string) => {
    const accepted = controller.submit(value)
    if (accepted) setDraft(accepted)
  }

  const openExternally = () => {
    const target = controller.target()
    if (!target) return
    platform.openExternal(target)
  }

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden" data-component="session-preview">
      <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-weak">
        <form
          class="flex-1 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit(draft())
          }}
        >
          <label class="sr-only" for={inputID}>
            {PREVIEW_TEXT.targetLabel}
          </label>
          <input
            id={inputID}
            class="flex-1 min-w-0 bg-background-base border border-border-weak rounded-md px-2 py-1 text-13-regular"
            value={draft()}
            spellcheck={false}
            autocomplete="off"
            placeholder={PREVIEW_TEXT.targetPlaceholder}
            aria-describedby={statusID}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <button type="submit" class="text-13-regular px-2 py-1 rounded-md border border-border-weak">
            {PREVIEW_TEXT.load}
          </button>
        </form>
        <IconButton
          icon="reset"
          variant="ghost"
          class="h-6 w-6"
          disabled={!controller.target()}
          onClick={() => controller.reload()}
          aria-label={PREVIEW_TEXT.reload}
        />
        <IconButton
          icon="link"
          variant="ghost"
          class="h-6 w-6"
          disabled={!controller.target()}
          onClick={openExternally}
          aria-label={PREVIEW_TEXT.openExternal}
        />
      </div>

      <Show when={suggestions().length > 0}>
        <div class="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border-weak">
          <span class="text-12-regular text-text-weak">{PREVIEW_TEXT.suggestions}</span>
          <For each={suggestions()}>
            {(candidate) => (
              <button
                type="button"
                class="text-12-regular px-2 py-0.5 rounded-md border border-border-weak"
                onClick={() => submit(candidate)}
              >
                {candidate}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div id={statusID} role="status" class="shrink-0 px-3 py-1.5 text-12-regular text-text-weak">
        {previewStateText(controller.phase(), controller.rejection())}
      </div>

      <div class="relative flex-1 min-h-0 overflow-hidden">
        <Show
          when={controller.frameToken()}
          keyed
          fallback={
            <div class="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
              <Icon name="eye" size="large" class="opacity-20" />
              <div class="text-14-regular text-text-weak max-w-64">{PREVIEW_TEXT.emptyHint}</div>
            </div>
          }
        >
          {(token) => (
            <iframe
              ref={(element) => (frame = element)}
              data-component="session-preview-frame"
              data-token={token}
              class="h-full w-full border-0 bg-white"
              src={controller.target()}
              title={PREVIEW_TEXT.frameTitle}
              {...PREVIEW_FRAME_ATTRIBUTES}
              onLoad={() => controller.frameLoaded()}
            />
          )}
        </Show>
      </div>
    </div>
  )
}
