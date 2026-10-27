# Tasks

> This is the sole implementation ledger.

- [x] **T001** Restore approved page composition, source-backed overview and section reader, session wordmark geometry; add structural and geometry regression assertions and inspect compiled UI against the prototype. [key:restore-prototype] [kind:implementation] [paths:packages/app/src/pages/changes.tsx,packages/app/src/pages/changes/**,packages/app/src/components/changeloop-brand.tsx,packages/app/src/pages/new-session/new-session-view.tsx,packages/app/src/pages/session/new-session-layout.ts,packages/app/e2e/regression/foundation-documents.spec.ts,packages/app/e2e/regression/foundation-webui.spec.ts,openspec/changes/**] [claims:prototype-page-composition,prototype-overview-reader,prototype-session-geometry,prototype-visual-regression] — verify: `cd packages/app && bun typecheck && bun run test:unit`
