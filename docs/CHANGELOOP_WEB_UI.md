# Local Changeloop Web UI

The web UI ships inside the `changeloop` binary. Build a binary with the app
embedded from `packages/cli` (needs Bun 1.4.4 or newer; see "Delivery" in
`CLAUDE.md`):

```sh
cd packages/cli && bun run build --single --skip-install
```

The result is `packages/cli/dist/cli-darwin-arm64/bin/changeloop` (the directory
name is `cli-<platform>-<architecture>`; Windows uses `windows`). The build
includes the production app and the pinned Foundation runtime. `--skip-install`
avoids changing native dependency selections during a local build, and
`--skip-web-ui` builds a binary without the UI (only for quick checks).

Run it from the project you want to look at (use the binary's absolute path when
you change directories):

```sh
changeloop serve --hostname 127.0.0.1 --port 4096
```

`serve` prints the URL and the generated password; it does not open a browser.
The basic-auth username is `opencode`. A source `serve` (`bun run src/index.ts
serve`) has no embedded app. Use the compiled binary, or run the app development
server (`packages/app`) against a matching source backend.

The host also needs Bash and Node.js (20.19 or newer) on `PATH` to run the bundled
Foundation scripts, including snapshot reads. A standalone `claude-foundation`
installation is not required. If the selected runtime is unavailable, check these
interpreters as well as the configured runtime mode. Document readers remain
available independently of snapshot runtime support.

If `foundation_workflow` is `false` for the project (see `CONFIGURATION.md`), the
Foundation endpoints answer `unsupported` and the Changes view shows that state
instead of an empty list.

## What the Changes view shows

Changes reads the selected server and project. Active and Archived rows, phase,
lifecycle state, evidence and usage come from the Foundation snapshot. Recorded
status, current status and freshness are independent. Missing usage is
unavailable; a measured zero remains zero. Archived history does not require an
old sandbox.

Saved investigations and agreement documents come from allowlisted project files,
independently of snapshot availability. Their modification time, read time and
SHA-256 identify the source, not proof. Checked tasks are checklist entries, not
verification receipts. Only explicit contained links associate research with a
change.

Home → Changes starts with Investigations and restores an existing tab's category,
search, note/document and section. A link with `?change=<id>` and no scope opens
the Active or Archived view that holds that change. Active and Archived remain
separate runtime views. Within a change, use Overview, Documents, Tasks, Evidence
or Usage. Arrow keys move between detail sections; the document section selector
jumps to original headings. Data sources opens a dialog that closes with Escape
and returns focus to its button. On screens narrower than 768 px Home shows a
single Changes button below the project selector.

| Display                     | Source                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Saved notes                 | `openspec/investigations/*.md`; heading or filename fallback                              |
| Agreement title and purpose | Original `proposal.md` heading and Why text                                               |
| Documents and planned tests | `proposal.md`, `design.md`, `tasks.md`, `evidence.yaml`, grounding and `specs/**/*.md`    |
| Task checklist              | Actual Markdown checkboxes in `tasks.md`, with original line/details                      |
| Declared obligations        | YAML or JSON claims in `evidence.yaml`; parsing failures remain visible                   |
| Runtime/evidence/usage      | Foundation snapshot, with its own generation timestamp                                    |
| Research references         | Exact contained Markdown links in indexed change documents; the referring source is shown |

Document selection resolves an active change first, then a unique matching dated
archive. Duplicate archive matches produce an explicit error. Symlinks, nonregular
files, traversal and files outside the allowlist are rejected. Reads are bounded to
256 KiB per document, a 1 MiB response, depth 32 and five seconds; lists use pages
of 50, with an API maximum of 100. Missing, denied, invalid, oversized and
changed-during-read states remain explicit.

Reference discovery is optional enrichment: unrelated broken or oversized agreement
files leave the requested note readable with diagnostics, and a partial scan never
claims that no related change exists.

The reader displays Markdown with raw HTML escaped, no automatic images and no
executable URL schemes. Indexed document links navigate within the reader; HTTPS
links require activation and open with `noopener noreferrer`. Full source text
remains available. Indexes refresh on entry, focus, manual refresh and every ten
seconds while visible. Unchanged selected content is cached; errors preserve
same-selection content with a stale label. Switching projects clears old content.

Session actions open editable drafts. They do not submit or execute a phase.
Submission uses project command discovery and host preparation. Uninitialized
projects keep the explicit initialization prompt (`changeloop foundation init
--yes`). No navigation action grants Land authority.

Continue investigation prepares `/investigate <note-path>`, Draft change prepares
`/change <note-path>`, and New investigate prepares `/investigate`. Existing
changes select their next discovered phase command; archived history uses
`/changes`.

## Verifying a local build

There is no separate evidence runner. Verify the UI with the package scripts and a
real binary:

```sh
bun run --cwd packages/app test:unit
bun run --cwd packages/app test:browser
bun run --cwd packages/app test:components    # Playwright; needs the browser from `bunx playwright install chromium-headless-shell`
```

Then build the binary as above, run `changeloop serve` from a project that has
Foundation installed, and check `/`, `/experimental/foundation/capability` and
`/api/command` (see "Delivery" in `CLAUDE.md`). These checks verify local
delivery; they do not publish a release.
