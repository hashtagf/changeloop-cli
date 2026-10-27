# Experience patterns

Use these patterns for an active flow decision. Apply relevant states, not a
fixed matrix to every decorative element.

## Navigation and task continuity

Keep location and scope visible: current section, selected account/project,
filters, and detail context. Preserve useful URLs, back behavior, and list state
when returning from a detail view. A visual tab is not always a navigation tab:
choose semantics from whether it changes a document or a panel.

Keep common actions close to the object they affect. Use progressive disclosure
for secondary options, while keeping frequently needed controls visible. A menu
with fewer items can still be worse if it hides the operator's main work.

## Forms and validation

- Group fields by the user's decision, not backend payload shape.
- Ask only for information the task needs; reuse already-provided data when safe.
- Use persistent labels and explicit formats. A placeholder is an example, not
  the only field name. Avoid prematurely validating an untouched field.
- Identify each invalid field and a correction. Use a summary for long forms
  when it helps navigation; connect summary links to the affected fields.
- Preserve valid input after server rejection or connection failure. Explain
  conflicts without overwriting user edits or pretending a retry is harmless.
- For a blocked action, expose the unmet prerequisite or permission reason.
  Do not disclose protected information merely to explain a denied state.

Example: a profile save fails because the network disappears. Keep the edits,
show that saving failed, and offer retry. Do not reset the form or display
"Saved" because the client accepted the button click.

## Async and interrupted operations

| State | Information/action the user needs |
|---|---|
| Initial loading | What is being fetched; stable layout; retry after failure |
| Empty collection | Why it is empty and a relevant first action |
| Filtered no results | Active constraints and a way to adjust/reset them |
| Pending mutation | The action in progress and safe duplicate handling |
| Success | The actual result and next useful step |
| Partial success | Which items succeeded, which did not, and failed-only recovery |
| Failure | Cause when known, retained work, and a viable correction/retry |
| Unknown result | Outcome is unconfirmed; reconcile before resubmitting |
| Stale/conflicting data | Freshness or competing changes and a safe resolution |
| Denied/unavailable | Scope of the restriction and an authorized alternative |

Use optimistic feedback only when rollback is reliable and understandable.
For consequential actions, distinguish queued, accepted, processed, and applied
states according to the actual product contract. A timeout can leave the outcome
unknown; blindly retrying can duplicate an operation.

Announce important state changes accessibly without turning every minor update
into an interruption. Use actual progress only when the application measures it.

## Destructive and consequential actions

Name the affected object and scope. In bulk work, distinguish selected visible
rows from every item matching a filter. Explain what can be recovered.

Prefer undo for cheaply reversible actions. For irreversible deletion or a
consequential submission, show the meaningful effect before confirmation.
Typed confirmations are appropriate only when the consequence warrants their
cost; they are not a default for ordinary edits.

Keep cancellation and escape behavior clear. Closing a dialog does not mean a
server operation was cancelled. Explain this distinction where it affects safety.

## Tables and expert work

Preserve sorting, filtering, pagination, selection, and context after a repair
or detail edit. Indicate whether counts and totals refer to the page, selection,
or complete dataset. Put units in headers or nearby labels.

Use density appropriate to repeated comparison tasks. Do not convert a table
to cards solely because the viewport is narrow: retain meaningful comparison
with a scoped scroll region, column priority, or an explicit alternative view.
Keep frequent row actions discoverable and keyboard reachable.

## Checks for a proposed flow

- Can the actor identify the current scope and predict the next action's result?
- Does the critical path remain usable with a failed request or an interruption?
- Are input and context retained through recovery?
- Are denied, empty, no-results, and unknown outcomes distinguishable?
- Is the most consequential action understandable before it takes effect?

The general usability basis includes [Nielsen's heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
The examples and tradeoffs here are this skill's working guidance, not measured
user-research findings or guarantees that a particular flow will succeed.
