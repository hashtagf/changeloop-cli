# Visual design and localization

## Hierarchy and grouping

Give the critical task a readable sequence: purpose, decision information,
action, feedback. Use size, weight, contrast, spacing, and position to express
priority. Nearby elements are read as related; common containers strengthen
grouping. Keep visual grouping consistent with semantic grouping. A decorative
card around every element can obscure the real relationships. [S23]

Project checks:
- Can a new user identify the page purpose and next action without reading all copy?
- Does prominence match task importance rather than marketing preference?
- Do headings, labels, hints, and controls form understandable groups?
- Does visual reading order agree with DOM and keyboard order?
- Are destructive and primary actions distinguishable without color alone?

These questions are inspection prompts, not proof of user comprehension.

## Typography and color

Use a small set of text roles: title, section heading, body, label, hint, data.
Choose font size, weight, line-height and line length using realistic content,
language, viewport and font metrics. Body size around 16 CSS px and generous
line-height can be starting recommendations; WCAG has no universal 16px floor.
Avoid thin small text, low-contrast secondary information and truncated critical
labels. Check loaded fonts and fallback fonts.

Use semantic color roles for actions, surfaces, text, borders, success, warning
and error. Test each theme/state combination. Red/green, saturation and icons
without text are insufficient for critical state distinctions. Contrast and
text override checks are in [accessibility.md](accessibility.md).

## Layout and responsive behavior

Reuse existing tokens and grids. A 4px or 8px scale is a project convention,
not evidence that another scale is unusable. Let breakpoints respond to content
failure rather than device names alone.

Specify how navigation, actions, tables, filters and dialogs adapt; preserve
the user's task when rearranging. Test long titles, translated strings, empty
values, keyboard appearance, zoom and orientation. Avoid horizontal page
scrolling; give genuine two-dimensional tables a bounded, discoverable region.
Do not turn every table into cards if row comparison is the user's task.

## Thai and mixed-language interfaces

Thai text includes combining marks above/below base characters and requires
language-aware line breaking. Inspect actual Thai strings and fallback fonts
for clipping, broken clusters and unnatural breaks. [S24]

Project recommendations: use Thai-capable fonts; avoid forced letter spacing
without a demonstrated need; begin with roomy line-height then inspect tone
marks at small sizes and in controls. No single line-height guarantees correctness.
Test Thai/Latin names, long addresses, dates, currency, phone formats and search.
Choose Buddhist/Gregorian calendar display and storage rules explicitly from
product needs; label them clearly rather than assuming the locale decides all
business rules. Preserve original user input where normalization changes meaning.

## Aesthetic quality

Coherent rhythm, alignment, density and restrained decoration support reading.
Brand expression may vary widely. Explain an aesthetic choice as a proposal
and evaluate it with users when consequential; do not claim a favorite style,
font pairing or palette is a universal principle.
