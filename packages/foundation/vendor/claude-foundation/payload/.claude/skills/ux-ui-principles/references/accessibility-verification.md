# Accessibility and verification

Use the product's stated accessibility target. Where no web target exists,
propose WCAG 2.2 AA as the working baseline and make the assumption visible.
This focused reference is not a complete conformance audit. A passing automated
scan or screenshot does not establish that the whole product conforms.

## Semantics and operation

Prefer native elements for ordinary links, buttons, inputs, and tables. Give
controls accessible names; expose relevant state and associate field errors.
Use a custom widget only when the task needs it, then verify its keyboard and
assistive-technology behavior rather than assuming ARIA makes it accessible.

Walk the critical task using the keyboard: order, activation, escape, and focus
return after dialogs. Ensure focus remains visible. Sticky UI must not fully
cover a focused control; SC 2.4.11 concerns obscuration, not a focus-ring contrast
ratio. See [Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

Check screen-reader names, relationships, state, and important announcements
when the relevant environment is available. Source-level expectations remain
unverified until the actual assistive interaction is checked.

## Web thresholds and exceptions

| Concern | Working check | Source |
|---|---|---|
| Text contrast | At least 4.5:1 for ordinary text; 3:1 for large text, with the criterion's definitions and exceptions | [SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| Non-text contrast | Required visual information identifying controls/states and graphical objects needs 3:1 against adjacent colors, subject to exceptions | [SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| Pointer targets | At least 24 × 24 CSS pixels, or a valid spacing/equivalent/inline/user-agent/essential exception | [SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |
| Reflow | Ordinary vertically scrolling content remains usable at a width equivalent to 320 CSS pixels without two-dimensional scrolling, except content requiring a two-dimensional layout | [SC 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) |

For the target-spacing exception, assess a 24 CSS pixel diameter circle centered
on each undersized target; it must not intersect another target or another such
circle. An arbitrary gap between icons is not evidence that the exception holds.
Larger touch targets can improve comfort; distinguish a project preference from
the AA minimum. Measure the actual hit area, not only the visible glyph.

Large-text and inactive-control exceptions need their actual conditions checked.
Do not use those exceptions to make essential help unreadable. Reflow exceptions
for tables or maps do not exempt the surrounding page from adaptation.

## Build an evidence plan proportional to the change

| Available surface | Can establish | Cannot establish alone |
|---|---|---|
| Source inspection | Intended markup, event paths, styles, and declared semantics | Actual rendering, focus behavior, usability |
| Screenshot | Visible composition, clipping, labels, and some state cues | Keyboard, screen reader, persistence, timing |
| Browser interaction | Actions, transitions, focus, responsive behavior, persistence checks | Outcomes for every user population |
| Accessibility tooling | Specific detectable violations or inspected properties | Complete WCAG conformance |
| Task-based user observation | Observed comprehension and completion for the tested people/tasks | Universal usability or unmeasured improvement |

Exercise the changed critical action with realistic data. Include a relevant
failure or recovery state when the change affects it. Test representative wide
and narrow layouts, enlarged text/zoom, long labels, and applicable themes.
Verify reduced-motion behavior when animation is involved.

Describe what was tested, on which surface, and what remains unknown. Do not
invent participant feedback, measurements, pass counts, or a usability score.
When rendered verification is unavailable, deliver a scoped specification or
source review with that limitation; do not fabricate a completed live check.

## Reporting

Use one concrete example per material finding, then state the consequence,
repair, and verification. Separate observed failures from plausible risks.
Fix blockers and lost-work paths before polishing low-impact details.

The normative standard is [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
The linked Understanding pages explain individual criteria and exceptions;
consult the full criterion before making a conformance claim.
