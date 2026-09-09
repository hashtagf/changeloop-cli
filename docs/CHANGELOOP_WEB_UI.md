# Local Changeloop Web UI

Build a binary with matching local UI assets from `packages/opencode`:

```sh
rtk proxy env OPENCODE_CHANNEL=webui OPENCODE_VERSION=0.0.0-webui OPENCODE_RELEASE= bun run script/build.ts --single --skip-install
```

Install workspace dependencies first. The build includes the production app and the pinned Foundation runtime. `--skip-install` avoids changing native dependency selections during this local build. Keep `OPENCODE_RELEASE` empty for a local build.

The host also needs Bash and Node.js on PATH to run the bundled Foundation scripts, including snapshot reads. A standalone `claude-foundation` installation is not required. If the selected runtime is unavailable, check these interpreters as well as the configured runtime mode. Document readers remain available independently of snapshot runtime support.

On macOS arm64, run `dist/opencode-darwin-arm64/bin/opencode serve --hostname 127.0.0.1 --port 4096` from the desired project (use the binary's absolute path when changing directories). The platform-specific directory is `opencode-<platform>-<architecture>`; Windows uses `windows`. Open the printed URL manually: `serve` does not open a browser. The `web` command uses the same embedded assets and opens the browser.

A source `serve` process has no embedded local app. Its existing upstream UI fallback cannot deliver these local changes. Use the matching compiled binary, or run the app development server against a matching source backend. Building with `--skip-embed-web-ui` also opts out of the local UI.

Changes reads the selected server/project. Active and Archived rows, phase, lifecycle state, evidence and usage come from the Foundation snapshot. Recorded status, current status and freshness are independent. Missing usage is unavailable; a measured zero remains zero. Archived history does not require an old sandbox.

Saved investigations and agreement documents come from allowlisted project files, independently of snapshot availability. Their modification time, read time and SHA-256 identify the source, not proof. Checked tasks are checklist entries, not verification receipts. Only explicit contained links associate research with a change.

Home → Changes starts with Investigations and restores an existing tab's category, search, note/document and section. Active and Archived remain separate runtime views. Within a change, use Overview, Documents, Tasks, Evidence or Usage. Arrow keys move between detail sections; the document section selector jumps to original headings. Data sources opens a dialog that closes with Escape and returns focus to its button.

| Display                     | Source                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Saved notes                 | `openspec/investigations/*.md`; heading or filename fallback                              |
| Agreement title and purpose | Original `proposal.md` heading and Why text                                               |
| Documents and planned tests | `proposal.md`, `design.md`, `tasks.md`, `evidence.yaml`, grounding and `specs/**/*.md`    |
| Task checklist              | Actual Markdown checkboxes in `tasks.md`, with original line/details                      |
| Declared obligations        | YAML or JSON claims in `evidence.yaml`; parsing failures remain visible                   |
| Runtime/evidence/usage      | Foundation snapshot, with its own generation timestamp                                    |
| Research references         | Exact contained Markdown links in indexed change documents; the referring source is shown |

Document selection resolves an active change first, then a unique matching dated archive. Duplicate archive matches produce an explicit error. Symlinks, nonregular files, traversal and files outside the allowlist are rejected. Reads are bounded to 256 KiB per document, a 1 MiB response, 4,096 scanned candidates, depth 32 and five seconds; lists use pages of 50, with an API maximum of 100. Missing, denied, invalid, oversized and changed-during-read states remain explicit.

Reference discovery is optional enrichment: unrelated broken or oversized agreement files leave the requested note readable with diagnostics. It scans at most 1,024 candidates and 2 MiB of Markdown, with a one-second budget within the request deadline and 128 KiB of reference results. A partial scan never claims that no related change exists.

The reader displays Markdown with raw HTML escaped, no automatic images and no executable URL schemes. Indexed document links navigate within the reader; HTTPS links require activation and open with `noopener noreferrer`. Full source text remains available. Indexes refresh on entry, focus, manual refresh and every ten seconds while visible. Unchanged selected content is cached; errors preserve same-selection content with a stale label. Switching projects clears old content.

Session actions open editable drafts. They do not submit or execute a phase. Submission uses project command discovery and host preparation, including opt-out and overrides. Uninitialized projects retain the existing explicit initialization prompt. No navigation action grants Land authority.

Continue investigation prepares `/investigate <note-path>`, Draft change prepares `/change <note-path>`, and New investigate prepares `/investigate`. Existing changes select their next discovered phase command; archived history uses `/changes`. Explicit template/model/agent overrides are retained. Overrides requiring legacy shell expansion or subtask preparation return a clear unavailable error before admitting a V2 prompt.

Run local delivery verification from `packages/opencode`:

```sh
rtk proxy bun run script/verify-foundation-webui.ts
rtk proxy bun run script/verify-foundation-documents.ts
```

The runners create temporary projects, start their own matching binary, use a PATH without a standalone Foundation executable and check real browser/API behavior. Required missing, skipped, failed or flaky suites cannot pass. Logs and reports are saved in `.foundation/webui-evidence` at the repository root. These checks verify local delivery; they do not publish a release.
