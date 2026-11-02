import { NEW_SESSION_CONTENT_WIDTH } from "./layout"
import { ChangeloopWordmark } from "./brand-view"

export default {
  title: "App/New Session/Brand",
  id: "app-new-session-brand",
  component: ChangeloopWordmark,
}

// The geometry of the new session panel: content bound, wordmark, a 32px gap, then the composer.
function Panel() {
  return (
    <div
      data-component="new-session"
      class="relative isolate h-[640px] w-full overflow-hidden rounded-[10px] bg-v2-background-bg-base"
    >
      <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
        <div class={NEW_SESSION_CONTENT_WIDTH}>
          <ChangeloopWordmark class="mx-auto block h-auto w-full max-w-[720px] text-v2-icon-icon-base" />
          <div class="mt-8 flex flex-col gap-3">
            <form
              data-component="composer"
              class="h-24 w-full rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const Session = { render: () => <Panel /> }
