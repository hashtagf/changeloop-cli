# Shared layout specification

Apply this contract to the selected blueprint, not all 40 examples at once.
All layouts are original proposals. Reference-based checks live in the linked
guides; the library itself does not establish usability or WCAG conformance.

## Brief and structure

Record the selected ID, user task, entry condition, assumptions, device/input,
content priority, and meaningful consequence of failure. Explain why the layout
fits and what it trades off. The wireframe describes groups, not pixel values.

Keep an existing shell, vocabulary and token system unless there is a demonstrated
gap. Specify regions, headings, controls and action hierarchy using real example
content. A sidebar can become a drawer, but navigation still needs a discoverable
entry and a known current location. Mobile-first examples describe compact behavior
first; their wide arrangement may change without changing the task.

## Responsive contract

| Concern | Specify and inspect |
|---|---|
| Priority | What stays visible first, what moves below, what becomes expandable |
| Navigation | Drawer/section/list behavior, current destination, close and Back |
| Actions | Placement without hiding focused content or covering errors |
| Tables/charts | Preserved comparison, key identifiers, bounded 2D regions where justified |
| Forms | Field groups, visible labels, keyboard opening, hints and errors |
| Long content | Thai/Latin strings, long names, translated labels and wrapping |
| Zoom/reflow | Content and functions remain usable; test applicable WCAG conditions |

Use content-driven breakpoints and project tokens; do not copy arbitrary values
from another example. See [visual guidance](../../references/visual.md) and
[accessibility criteria](../../references/accessibility.md).

## Interaction and state contract

For each critical action specify trigger, visible feedback, confirmed result,
focus behavior and recovery. Distinguish local optimistic state from confirmed
saved state. Cover relevant default/focus/selection/loading/empty/error/success,
plus stale/offline/permission/conflict states when the data and workflow require
them. Mark irrelevant states N/A with a reason.

For list/detail navigation, record whether query, filters, selection and scroll
are retained. For forms, preserve permissible values after failure. For payments
and other consequential operations, define uncertain outcomes and repeat-request
handling explicitly. Use [pattern guidance](../../references/patterns.md).

## Accessibility contract

Specify landmarks, heading order, native semantics, accessible names, keyboard
path and focus return where relevant. Provide alternatives to drag or map-only
interaction. Distinguish color-independent meaning from decorative color.
Measure contrast and pointer target geometry in implementation, applying exact
criteria and exceptions from [accessibility.md](../../references/accessibility.md).
A markdown blueprint cannot verify computed colors, DOM order or announcements.

## Acceptance contract

Write an observable outcome, initial condition, actions and expected result.
Include one important failure/recovery scenario. Record what was actually tested
and what remains proposed. Use [validation guidance](../../references/validation.md).

Example: with a validation error in delivery details, submission retains other
permitted values, shows an actionable linked error, lets the user correct the
field, and successfully resubmit once. This is more useful than "form is clean."

## Handoff format

1. Selected template ID and rationale.
2. User/context assumptions and actual content examples.
3. Wide and compact region order, with a small wireframe.
4. Components and existing token references; document any necessary additions.
5. Critical action and applicable state specification.
6. Accessibility and recovery behavior.
7. Acceptance scenarios, actual verification and open questions.

When implementation is requested, use an appropriate implementation skill/tool
and verify the rendered result. Do not report a textual specification as built UI.
