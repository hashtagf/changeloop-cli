---
name: tailwind-design-system
description: "Maintain shared Tailwind CSS v4 tokens, component variants, theming, responsive primitives, or compatible v3 migration. Verify installed version and generated CSS through project tools. Skip one-off styling; use frontend-design for settled visual implementation."
---

# Tailwind design system (v4)

Verify component focus and reduced motion after token changes; generated CSS
alone cannot prove accessible behavior.

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
