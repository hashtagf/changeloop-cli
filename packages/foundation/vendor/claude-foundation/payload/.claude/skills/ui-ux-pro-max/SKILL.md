---
name: ui-ux-pro-max
description: "Decide or review web/mobile UX: information hierarchy, navigation, interaction, forms, accessibility, responsive behavior, charts, visual consistency, and design-system direction. Use before implementation when direction is unsettled or when auditing an existing interface. Do not trigger merely because frontend code is touched; use frontend-design for settled visual implementation and tailwind-design-system for Tailwind v4 mechanics."
---

# UI/UX decision and review

Use this to resolve experience decisions before visual implementation or to
produce an evidence-based review.

## Workflow

1. Identify product type, audience, primary jobs, platforms, content density,
   brand constraints, and critical states.
2. Inspect the existing rendered experience and code/tokens when present. Label
   facts, assumptions, and unknowns.
3. Establish direction: hierarchy, navigation, interaction model, responsive
   behavior, typography/color roles, and accessibility requirements.
4. For reviews, prioritize findings by user impact and support each with an
   observable example. Recommend one coherent replacement direction rather than
   isolated cosmetic tweaks.
5. Validate critical flows at small/large viewports, keyboard/touch, reduced
   motion, zoom/dynamic type, loading/empty/error states, and light/dark themes
   where applicable.

## Priority rules

1. Preserve access: semantic structure, visible focus, keyboard operation,
   labels/names, adequate contrast, zoom, and non-color cues.
2. Make actions usable: sufficient touch targets, clear feedback, safe loading
   and destructive states, and no hover-only essential behavior.
3. Prevent layout/performance harm: responsive reflow, reserved media space,
   bounded motion, and no hidden or horizontally clipped content.
4. Keep navigation and forms predictable; place errors next to causes and
   preserve user input across recoverable failure.
5. Use consistent tokens and visual roles; charts require readable labels,
   legends, accessible color, and a nonvisual interpretation.

Use `references/quick-reference.md` for the full rule catalog. Use
`references/search-tool.md` and bundled `search.py` scripts only when generating
or comparing design-system directions. Use `references/app-ui-rules.md` for
native/mobile sign-off.

Record consequential UX decisions and acceptance scenarios in OpenSpec. Hand
settled visual implementation to `frontend-design`; let browser/accessibility
providers prove the rendered behavior.
