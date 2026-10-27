---
name: tailwind-design-system
description: "Build or maintain shared Tailwind CSS v4 design-system mechanics: CSS-first @theme tokens, semantic variables, component variants, dark mode, responsive primitives, and v3-to-v4 migration. Use when Tailwind v4 configuration or reusable component APIs change. Skip one-off styling and non-Tailwind work; use frontend-design for visual implementation and ui-ux-pro-max for UX direction."
---

# Tailwind design system (v4)

Confirm the installed Tailwind major version before applying v4 syntax. For v3,
use the official migration path rather than partially mixing models.

## Rules

1. Define CSS-first tokens with `@theme`; organize raw brand values into
   semantic roles, then component-level decisions.
2. Keep component APIs small and composable: base, variants, sizes, states, then
   an intentional override seam. Use CVA-style machinery only when variants are
   genuinely shared.
3. Use one class-merging convention and avoid scattered arbitrary values or raw
   colors that bypass tokens.
4. Implement focus, disabled, loading, invalid, high-contrast, reduced-motion,
   and dark-mode states as part of the component contract.
5. Prefer responsive composition and container-aware primitives over copying
   breakpoint class lists into every component.
6. Migrate incrementally: inventory configuration/plugins, translate tokens and
   variants, update utilities/components, verify generated CSS, then remove v3
   paths only after consumers move.

## Harness handoff

Record shared token/API and migration compatibility decisions in the active
OpenSpec design. Prove representative components in browser/accessibility
providers and run the project build so invalid or missing generated utilities
cannot pass by source inspection alone.

References: read `setup-and-migration.md` for `@theme` and v3 migration;
`component-patterns.md` for CVA/compound/form components;
`layout-motion-theming.md` for responsive layout, animation, and dark mode; and
`utilities-and-advanced.md` for helpers and advanced v4 features.
