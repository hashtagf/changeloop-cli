# Accessibility: requirements and checks

This is a scoped aid, not the complete WCAG checklist. Source IDs resolve in
[sources.md](sources.md). WCAG success criteria are normative; Understanding
documents and APG explain application. AA conformance includes all applicable
A and AA criteria, entire pages, and complete processes. [S02]

## Visual and input checks

| Criterion | Level | Check and important qualification | Source |
|---|---|---|---|
| 1.4.3 Contrast (Minimum) | AA | Text ≥4.5:1; large text ≥3:1. Large means ≥18pt regular or ≥14pt bold (24 or about 18.67 CSS px). Check computed colors; do not round a failing ratio upward. Exceptions include inactive controls, decoration, and logotypes. | S03 |
| 1.4.11 Non-text Contrast | AA | Necessary visual information for controls/states and graphical objects ≥3:1 against adjacent colors, subject to exceptions. This does not require every decorative border to contrast. | S04 |
| 1.4.10 Reflow | AA | For horizontal writing, content works at width equivalent to 320 CSS px without two-dimensional scrolling or loss. Two-dimensional content such as data tables can be excepted; the surrounding page still reflows. | S05 |
| 1.4.12 Text Spacing | AA | No loss when users set line-height 1.5×, paragraph spacing 2× font size, letter spacing .12em, word spacing .16em. These are override tests, not mandatory default design values. Properties unused by a language/script need not apply. | S06 |
| 2.5.8 Target Size (Minimum) | AA | Pointer targets ≥24×24 CSS px, or qualify for exceptions: sufficient spacing, equivalent control, inline, user-agent control, essential. For spacing, test the 24px-diameter circles centered on undersized targets against nearby targets/circles. | S07 |
| 2.4.11 Focus Not Obscured (Minimum) | AA | Author-created content must not entirely hide the component receiving keyboard focus. Test sticky headers, cookie banners, and overlays. Partial obstruction is distinct from complete hiding. | S08 |
| 2.4.13 Focus Appearance | AAA | Focus indicator area and contrast-change requirements apply with specified exceptions. The common 2 CSS px perimeter-equivalent area and 3:1 focused/unfocused change are AAA, not 2.4.11 AA. | S09 |
| 2.5.7 Dragging Movements | AA | Supply a single-pointer action without dragging unless essential or user-agent determined; keyboard-only support is not the same alternative. | S10 |
| 3.3.7 Redundant Entry | A | Reuse or make selectable information already entered during the process, with essential/security/stale-information exceptions. | S11 |
| 3.3.8 Accessible Authentication (Minimum) | AA | Avoid cognitive-function tests unless an allowed alternative, assistance mechanism, or exception applies. Support password managers and paste; inspect the whole login and recovery flow. | S12 |
| 4.1.3 Status Messages | AA | Expose qualifying status messages programmatically without requiring focus to move. Choose appropriate roles/live regions; do not make every update an interrupting alert. | S13 |

Larger practical touch targets may improve motor accessibility, but a 44×44
design preference is not the AA 24×24 rule. Verify platform-specific guidance
for native controls rather than translating units mechanically.

## Semantics and keyboard checks

Prefer native buttons, links, form controls, headings, lists, and tables.
Inspect accessible name, role, state, and relationship rather than relying on
appearance. ARIA does not add missing keyboard behavior. APG is informative
implementation guidance, not a separate conformance standard. [S14]

For modal dialogs, move focus inside appropriately, keep Tab/Shift+Tab within
the dialog while open, provide a visible close mechanism, support Escape in
the modal pattern, and return focus to the invoker or a logical next location.
Only mark a dialog modal when background interaction is actually blocked.
For long or structured content, initial focus may belong on a static heading
rather than the first input. [S15]

Inspect keyboard reachability, focus order, visible focus, labels/instructions,
color-independent meaning, and non-text alternatives against the full standard
when relevant. Do not report these as passed from a still image. [S02]

## Motion

Honor reduced-motion preferences for nonessential movement. SC 2.3.3 allows
disabling nonessential interaction-triggered animation and is AAA. Do not
label all reduced-motion support an AA mandate. Separately assess autoplay,
moving content and flashing under applicable criteria. [S16, S02]

## Report accurately

Record criterion, scope, environment, procedure, actual result, and remaining
unknowns. Automated checks, manual keyboard checks, and screen-reader tests
cover different failure modes. A measured contrast pass is one criterion
result; it is not a declaration that the product conforms to WCAG.
