---
name: frontend-design
description: Implement or restyle production web UI after product and UX direction is known. Use for pages, components, dashboards, posters, and HTML/CSS/React/Vue/Svelte work where visual composition, typography, motion, responsiveness, and polish are the main risk. Use ui-ux-pro-max first for UX direction or accessibility review; use tailwind-design-system for shared Tailwind v4 mechanics.
license: Complete terms in LICENSE.txt
---

# Frontend design

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

Use `ui-ux-pro-max` for unresolved interaction/IA/a11y decisions, `gridgeist`
when that explicit visual language is requested, and `tailwind-design-system`
only when shared Tailwind v4 tokens or component APIs change.
