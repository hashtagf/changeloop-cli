---
name: frontend-design
description: "Implement or restyle web pages and components after product/UX direction is settled. Use for visual hierarchy, typography, motion, responsive states, and rendered polish. Work within Change Loop scope; use ux-ui-principles for unresolved interaction decisions."
license: Complete terms in LICENSE.txt
---

# Frontend design

Check action, resulting state, and persisted effects. A final screenshot
alone cannot prove the interaction worked.

Build working, distinctive UI that fits the product instead of applying a
default SaaS aesthetic.

## Workflow

1. Inspect the existing product, rendered UI, framework, components, tokens,
   content, responsive behavior, and accessibility conventions.
2. State one visual thesis grounded in purpose and audience. Preserve an
   established brand unless the user requests a redesign.
3. Establish hierarchy before decoration: content order, grid, typography,
   spacing, color roles, and responsive transformations.
4. Implement real behavior with semantic HTML, keyboard/focus support, loading,
   empty/error/disabled states, and reduced-motion handling.
5. Add a small number of intentional visual signatures—composition, type,
   imagery, texture, or motion—that reinforce the thesis.
6. Render and inspect representative desktop/mobile widths. Fix clarity,
   overflow, interaction, accessibility, and visual rhythm before delivery.

## Quality rules

- Reuse repository primitives and tokens before adding dependencies or one-off
  values.
- Use typography and color with clear roles; avoid arbitrary palettes, mixed
  visual languages, and decoration unrelated to content.
- Prefer authentic product data, screenshots, diagrams, or imagery over generic
  claims and ornamental card grids.
- Match complexity to the direction: restraint requires precision; expressive
  design must still protect performance and comprehension.
- Preserve behavior during visual-only work and keep unrelated refactors out of
  the diff.

Record consequential visual/system decisions in the active OpenSpec design and
let browser/accessibility providers supply evidence. Do not claim quality from
source inspection alone when rendered verification is available.

Use `ux-ui-principles` for unresolved interaction/IA/a11y decisions,
`ui-ux-pro-max` for searchable product/style/palette intelligence, and
`tailwind-design-system` when shared Tailwind v4 tokens or component APIs change.
