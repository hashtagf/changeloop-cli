# Interaction principles

Source IDs resolve in [sources.md](sources.md). Heuristics suggest where to
investigate; they do not replace evidence about the product's users.

## Nielsen's usability heuristics, operationalized

| Principle | Observable question | Example remedy |
|---|---|---|
| System status | Can users tell whether an operation started or finished? | Explicit pending/result feedback |
| Match to real world | Do labels follow users' vocabulary and expected order? | Replace internal codes with task language |
| Control and freedom | Can users leave or recover from a mistaken action? | Cancel, Back, appropriate undo |
| Consistency and standards | Does familiar behavior remain predictable? | Align control meaning across screens |
| Error prevention | Can likely mistakes be avoided before damage? | Constraints and consequence review |
| Recognition over recall | Must users memorize information across screens? | Keep relevant choices/context visible |
| Flexibility and efficiency | Can repeat users work faster without blocking novices? | Discoverable shortcuts and saved preferences |
| Minimalist design | Does irrelevant content compete with the task? | Remove distractions, preserve decision information |
| Error recovery | Is failure understandable and recoverable? | Specific correction with preserved work |
| Help and documentation | Can users find task-specific guidance when needed? | Contextual help and clear next steps |

Adapt these broad heuristics to context; they are not specific component rules.
[S01]

## Mental models, signifiers and mapping

An affordance describes an available action relative to an actor. A signifier
communicates what can happen; capability and visible cue are different. Inspect
each important action's label/cue, predicted result and feedback. A gesture that
exists but cannot be discovered is a communication problem. Label unfamiliar
icons and explain consequential operations before activation. [S25]

## Cognitive and motor principles

| Principle | Apply when | Check | Caveat/source |
|---|---|---|---|
| Fitts's law | Frequent pointing or closely packed controls | Inspect hit area, separation, distance from prior action | Mouse edge advantages do not transfer to touch; invisible padding alone may not change perceived target size. S26 |
| Predictive pointing models | Measuring input-device performance | Define task, device, errors and calibrated parameters | Do not invent exact movement-time savings from target size alone. S27 |
| Hick–Hyman law | Ambiguous decisions or many mappings | Improve categories, labels, defaults and correspondence | Choice-reaction research is not a universal menu cap; practice and compatibility matter. S28, S29 |
| Gestalt proximity | Labels, fields, grouped controls | Keep related items perceptually closer; inspect wrapping/errors | No universal pixel gap follows from the principle. S30 |
| Recognition over recall | Multi-step tasks and unfamiliar choices | Expose relevant context at the point of action | Extra information can become clutter; prioritize by task. S01 |

Project recommendation: use progressive disclosure for secondary complexity,
while keeping essential consequences and decision information visible. Do not
hide options merely to satisfy a slogan about reducing choices.

## Information architecture and navigation

Inventory content and actions before naming navigation. Separate content objects,
user tasks and internal organization. Use user language and expose the current
location. Search, browse and contextual links may serve different entry intents.

Card sorting explores how users group topics and the categories they expect;
it informs a proposed structure. Tree testing asks users to find destinations
in a simplified hierarchy and evaluates labels/categories. Neither evaluates
the entire rendered navigation experience. [S31, S32]

Project checks: run realistic tasks without giving away the destination label;
define acceptable destinations; inspect wrong turns and backtracking. Test the
real UI afterward, including search, Back, deep links and retained context.
Do not treat click count as the only measure of efficiency.

## Resolve competing principles

Record the tradeoff and choose according to the task:
- Recognition vs density: retain critical context; move optional detail to a
  discoverable expansion, then test comprehension.
- Consistency vs domain fit: preserve established control behavior while using
  vocabulary and sequence appropriate to the task.
- Speed vs error prevention: accelerate reversible repeated work; add review
  or stronger safeguards where consequences justify it.
- Simplicity vs expert efficiency: provide a clear initial path and optional
  accelerators rather than forcing identical interaction for every user.

These are synthesized decision strategies, not new scientific laws.
