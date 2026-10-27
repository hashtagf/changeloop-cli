# Change: A session Preview tab renders a running dev server inside the app with an explicit target, reload control and truthful failure states.

## Why

Reviewing a web change today forces the user out of the app: the session panel only shows diffs, context and files, and a terminal URL opens in the system browser, so there is no in-app way to look at the site the session is changing.

## What changes

- Offer Preview as a reserved session side-panel tab beside Files Changed, Context and open file tabs, built from existing V2 components and tokens with the existing tab activate, close, keyboard, visible focus and accessible-name behavior and non-color state text. Key Preview tab state per server and session like the other side-panel tabs and restore it after reload. With no target set, show an explicit empty state naming the next action rather than a blank frame. Add no top-level tab type and change no existing review, context, file, terminal or chat behavior.
- Accept an explicit user-entered target, canonicalize it, and load only http or https origins on any host; reject every other scheme including file, data, javascript and about, and reject malformed input with a stated reason and no navigation. Remember the last accepted target per server and project and restore it on return. Offer targets observed in terminal output as advisory suggestions only: they never navigate on their own, absent or unavailable detection is an ordinary empty state rather than an error, and an explicit user target always wins. Read suggestions from terminal output the app already receives; add no new server API, no shell execution and no filesystem scan.
- Render the target in a cross-origin frame that cannot reach app state: no same-origin access to app storage or tokens, no top-frame navigation, no popup or download escalation, and no app credentials, auth token, server URL secrets or session identifiers forwarded to the previewed origin. Allow framing http and https targets from the served UI by adding a frame-src allowance only; leave default-src, script-src, style-src, img-src, font-src, media-src and connect-src unchanged and keep the same policy on the upstream-proxied HTML path. Preserve the desktop navigation policy so top-level navigation and window opens still leave through the operating system.
- Provide an explicit reload control and reload the frame when the app window or the Preview tab regains focus, with no polling or reloading while hidden or unmounted. Distinguish no-target, invalid-target, loading, loaded, unreachable-target, framing-refused and blocked-insecure-content in text rather than color alone, and offer a browser fallback that opens the current target through the existing external-open path. A preview that cannot render never blanks the panel, never breaks the session, and preserves the target for retry.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** 

## Non-goals

- none
