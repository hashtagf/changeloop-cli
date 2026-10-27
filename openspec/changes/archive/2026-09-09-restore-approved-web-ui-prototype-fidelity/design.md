# Restore the selected prototype composition

## Design reference and correction

The selected reference is the revised `.foundation/prototypes/changeloop-webui/index.html` with `data.js` and `prototype.js`, documented in `.foundation/prototypes/changeloop-webui/selection.md` and the prior archived change's `references/prototype-selection.md`. The rejected standalone dashboard and `before-investigations.html` are not targets. See `openspec/investigations/changeloop-webui-prototype-drift.md` for the measured defect report.

Preserve the established V2 typography, colors and controls. Restore the reference's 1080px desktop grid, 280px project column, 32px gap and 720px content bound. Use one list heading/search/category composition; details and note readers replace the list screen rather than nesting below its controls. Count values are sourced from bounded read APIs, not the captured prototype. Missing counts display an em dash.

The Changes project navigation uses production ProjectAvatar and Home utility navigation. Project selection clears obsolete document/change route fields; existing server selection remains available through the server's project groups. Settings and Help retain their real production actions.

## Data and rendering

| Display | Existing source | Failure behavior |
| --- | --- | --- |
| Project and server | Global registered server/project context plus explicit selected directory | Preserve the explicit selection even if not in the recent project list |
| Category counts | Investigation index and active/archive projection totals | Unavailable count rather than zero; counts are unfiltered |
| Note title/path/time | Document index and bounded document read | Existing read errors, stale content and retry remain visible |
| Change title and Why | Proposal metadata and parsed section of proposal.md | ID title fallback; explicit unavailable summary |
| Phase/status/evidence/branch | Existing Foundation projection | Explicit unavailable values; no inferred completion |
| Agreement shortcuts | Returned document manifest | Only server-issued contained document IDs |
| Note sections | Server-issued top-level heading positions | Default Findings/Summary, then first section; invalid route anchor falls back |

Safe DocumentMarkdown remains responsible for HTML/link sanitization. The note excerpt slices normalized source lines and rebases renderer line positions while retaining stable server anchor IDs. Nested headings remain within their selected section. Documents retain complete rendered content with a document list alongside; full source remains available. Checkboxes and obligations remain declarations, independent of evidence results.

The wordmark uses the CLI pixels in the selected compact 310:25 aspect ratio, with no padded SVG viewBox. Keep the production composer, explicit submission, command discovery and project/server draft context.

## Planned test cases

| Case | Observable acceptance | Verification |
| --- | --- | --- |
| VF01 | Desktop list retains project navigation, workflow/search/counted underlined tabs in reference order | Browser structural and bounding-box assertions plus paired reference inspection |
| VF02 | Opening a note removes list controls, shows one title and section navigation, switches focused content and restores route selection | foundation-documents browser suite |
| VF03 | Overview derives readable proposal title/Why, shows runtime facts and opens available agreement files | foundation-documents browser suite |
| VF04 | Default/explicit/invalid note anchors, nested headings, CRLF and absent Why preserve correct source boundaries | document-excerpt.test.ts |
| VF05 | Session wordmark keeps 310:25 ratio and 32px following gap at desktop/mobile without draft submission | foundation-webui browser suite and paired rendered inspection |
| VF06 | Unsafe Markdown stays inert; existing stale read, archive, keyboard, failure and draft tests remain green | Existing document and Web UI suites against the compiled embedded app |

Inspect list, note, overview, Documents, Tasks, Evidence, Usage and draft at 1440×1000 and 390×844 in both themes. Record actual executed states and discrepancies; screenshot capture by itself does not imply acceptance. Build the embedded binary with existing verification scripts and confirm served assets match the current frontend. No public release or Git landing is included in this correction's Build authorization.
