# Visual composition

Use this reference when composition affects comprehension or task execution.
Preserve an established visual system unless the requested change includes it.

## Hierarchy and grouping

Start with content order and relationships. Identify the current task, the
information needed to decide, its action, and supporting detail. Use emphasis
deliberately rather than making everything larger or putting everything in cards.

Use a consistent alignment system and spacing relationships: related controls
belong closer together than unrelated sections. Reuse the project's scale; do
not force a new base-4 system onto a working design merely to follow a rule.

Judge empty space by whether it clarifies relationships and scanning. A dense
operations table and a focused onboarding screen have different needs. Neither
"more whitespace" nor "less scrolling" is a universal goal.

## Typography and content

Give titles, section headings, body, labels, supporting text, and numerical data
clear roles. Prefer a few coherent roles over arbitrary sizes in each component.
Use tabular numerals where repeated numerical comparison benefits from alignment.

Test realistic content: long names, wrapped labels, unbroken identifiers, missing
values, translated text, and user-entered strings. Truncation needs a usable path
to the complete value; a hover tooltip alone excludes touch and keyboard users.

For Thai and mixed Thai/Latin interfaces, inspect actual glyph rendering, stacked
marks, wrapping, and line-height in the chosen font. Avoid decorative tracking
that separates Thai characters or clips marks. Do not impose a universal
line-height value without checking the actual text, font, and density.

Write action labels that predict an effect. Distinguish "Save draft", "Submit",
and "Publish" when these are separate operations. Avoid internal error codes as
the sole explanation of a recoverable problem.

## Color and surface roles

Use semantic roles for action, selection, status, emphasis, surface, and borders.
Do not reuse a warning color as decoration where it confuses the status meaning.
Keep text or shape cues alongside status color. Verify the actual foreground and
background combinations in each relevant theme and state.

Borders, elevation, and containers should communicate grouping or layering.
Avoid stacking shadows and backgrounds merely to make a page look finished.
Do not flatten meaningful controls until their affordance disappears.

## Responsive transformation

Choose transformations from the task: stack related content, reprioritize
secondary metadata, move actions into reachable positions, or contain an
essential two-dimensional view. Shrinking every element is not a mobile design.

Keep reading order and keyboard order coherent after reflow. Test sticky headers,
footers, dialogs, and mobile keyboards for overlap with controls and messages.
Do not remove required information or recovery actions to make the layout fit.

## Charts and evidence

Choose a chart from the question: trend, category comparison, distribution, or
relationship. Show meaningful units and time range. Label missing, estimated,
or stale values instead of treating them as zero. Make axis changes and truncated
scales clear when they alter interpretation.

Provide an accessible way to obtain the same information, such as an appropriately
structured table or textual interpretation. A decorative chart must not invent
business data. Color should support comparison, not be its only carrier.

## Motion and layout stability

Use motion to connect cause and effect or preserve location during a change.
Avoid motion that delays repeated work, competes with reading, or prevents
completion under reduced-motion settings. Reserve space for asynchronously
loaded media and avoid moving a target just as the user activates it.

## Review questions

- Can the intended actor find the task, its prerequisites, and the next action?
- Do typography and spacing express consistent roles and relationships?
- Does realistic content survive narrow widths, zoom, and localization?
- Do charts and statuses communicate actual data without hiding uncertainty?
- Does distinctive styling support the product rather than obscure its controls?

Record a concrete location and consequence for a finding. "Looks bland" or
"needs more whitespace" is insufficient without describing the task it harms.
