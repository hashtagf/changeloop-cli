# Prototype — existing V2 app + Changes

User requested one prototype, then explicitly required it to follow existing code.
This revision replaces the rejected standalone warm/green dashboard direction.
The user instructed “change ได้เลย” after this revision on 2026-09-09.
Use the code-aligned revision as the selected design reference for Change.

Entry: index.html. Keep assets/ alongside it when sharing. No server is required.

## Source mapping

- Top Home / session tabs / plus: packages/app/src/components/titlebar.tsx.
- Raised surface, 8px outer margin, 10px radius, 1080px grid, 280px Projects column
  and 32px gap: packages/app/src/pages/home.tsx.
- Projects and utility navigation: pages/home/home-projects-view.tsx.
- 36px search, compact rows and muted section labels: pages/home/home-sessions-view.tsx.
- Full session surface with no persistent project sidebar: pages/layout-new.tsx.
- Session top 25.375%, max width 720px and 32px spacing:
  pages/new-session/new-session-view.tsx and pages/session/new-session-layout.ts.
- Composer radius 12px, editor minimum 60px, controls 44px, raised shadow:
  packages/session-ui/src/v2/components/prompt-input/index.tsx.
- Changeloop SVG pixels: packages/tui/src/logo.ts.

Copied byte-for-byte into assets: packages/ui/src/v2/styles/colors.css, theme.css,
packages/ui/src/v2/components/button-v2.css, packages/ui/src/assets/fonts/Inter.ttf.
Buttons marked data-component=button-v2 use the actual repository CSS.

This is static HTML with reconstructed markup, not the running Solid app or imports
of context-dependent components. Native selects and simplified icons stand in for
production popovers/icons. It is code-grounded, not a claim of pixel identity.
Changes and its details are proposed additions; Home/session use the existing baseline.

## Behavior and boundaries

Home sample sessions, active/archive filters, search, change detail tabs, command
handoff, theme toggle and simulated send work locally. Settings/attachments show
an explanatory message. Samples are not live evidence. Archive shows one representative
entry of an illustrated 12. No lifecycle command or agent starts.
The selected reference uses session draft handoff. Direct lifecycle controls are
outside this change; no Land or publication authority is implied.

## Focused verification

Inspected desktop Changes and session, and session in dark mode at 390px.
Exercised change detail to session with /build session-recovery and simulated send;
the prompt remained and no agent started. Adjusted mobile tabs to avoid wrapping.
This is prototype QA, not product or accessibility acceptance proof.

After selection, reference this file in /change. Prototype output is a design reference.

## Selected revision: investigations and agreement reader

On 2026-09-09 the user requested updating the existing Change after reviewing the revised prototype. The selected entry is index.html with data.js and assets/. It adds Investigations alongside Active/Archived, note sections and explicit Change references, Documents/Tasks detail tabs, source mapping and note-to-session drafts. The prior selected view remains in before-investigations.html.

The revision used a captured schema-3 projection plus actual saved notes and agreement files (5 notes, 13 changes and 66 documents at capture time). These counts are example data, not acceptance requirements. Investigation/document Web UI readers are proposed additions; the demo is not proof those APIs exist. References are document references, not inferred completion/conversion. Production must implement safe Markdown/link handling rather than copy the prototype's renderer. Prototype scope and limitations are recorded in revision-review.md; that review is now selected for documentation, not product proof.
