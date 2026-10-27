# Patterns: turn intent into behavior

These are synthesized project recommendations unless a source or criterion is
named. Adapt official-system examples to the product context.

## Forms

Ask only for needed information, explain unfamiliar requirements, identify
optional fields, and allow uncertainty when it is a meaningful answer. Reuse
answers within the journey. GOV.UK's question-page pattern is a service-context
starting point, not a universal instruction to split every form. Group related
fields when users need to compare or edit them together. [S17]

Use persistent labels and contextual hints; placeholders are examples, not
label substitutes. Choose controls by answer type and data constraints. Permit
valid international names/addresses rather than imposing arbitrary ASCII rules.
Keep input on validation failure. Avoid validating untouched fields while typing;
choose timing that supports recovery without interrupting legitimate partial input.
[S18; timing outside GOV.UK is a project decision]

Explain the specific problem and the correction using the field's terminology.
Separate user-correctable validation from service outages or ineligibility. [S19]
For long forms, pair inline errors with a linked error summary; focus the summary
after failed submission when using this pattern. [S20]

Before irreversible submission, expose relevant consequences and offer a review
step or equivalent protection proportional to risk. Success should identify what
was completed and what happens next.

## State specification

For each critical screen/control, assess the following and mark irrelevant rows
N/A with a reason. Avoid inventing visible states that the control does not need.

| State | User question | Specification |
|---|---|---|
| Initial/default | What can I do? | Purpose, controls, required information |
| Hover/focus/pressed | Is this actionable? | Mouse, keyboard and touch feedback |
| Selected/expanded | What is active? | Visible and programmatic state |
| Disabled | Why unavailable? | Reason or prerequisite; distinguish from loading |
| Loading/submitting | Did it start? | Feedback, repeat-action handling, timeout/retry |
| Empty | Why no content? | First use vs no matches vs cleared data; next action |
| Partial/stale/offline | Can I trust this? | Timestamp/context, retained work, recovery |
| Validation/service error | How do I recover? | Specific explanation and safe retry |
| Success | Is it finished? | Result, persistence, next step |
| Permission denied | What access do I need? | Explanation and authorized path forward |

Never display success before the operation is confirmed. For optimistic updates,
define rollback and reconcile conflicts. Reserve space for late content to avoid
moving controls while a user acts. Status announcement guidance: [S13].

## Navigation and dialogs

Use recognizable destination labels, location cues and predictable Back behavior.
Maintain filters, scroll and inputs when returning if practical. A tab typically
switches related panels within a context; distinguish it from page navigation.
GOV.UK notes tabs can suit repeat users but can hide information from infrequent
users. [S21]

Use a dialog for a focused interruption with a reason. Keep complex workflows on
pages when users need history, deep links or long reading. Implement the APG
keyboard/focus contract when using a modal. [S15]

## Dashboards and data-heavy work

Start from decisions: monitor, compare, triage, investigate, or act. Specify data
units, time window, timezone, freshness and uncertainty. Distinguish zero,
missing, unavailable and stale values. Provide comparison baselines when useful.
Use tables for exact lookup/comparison and charts for patterns over dimensions;
provide an accessible alternative for essential chart information.

Make filter scope and active filters visible. State whether selection applies to
the current page or all matching records. Preview bulk-action consequences and
design partial-failure recovery. Do not make irreversible bulk actions easy to
trigger accidentally merely to reduce clicks.

## Speed and stability

Google's dated guidance defines good field thresholds as LCP ≤2.5s, INP ≤200ms
and CLS ≤0.1 at the 75th percentile, evaluating mobile and desktop segments.
Recheck the original before current claims. A Lighthouse load run does not
measure real-user INP; TBT is a lab proxy. Lab checks and field data complement
each other. [S22]

Project actions: acknowledge input promptly, avoid duplicate submissions, reserve
media space, prioritize task-critical content, and test slow networks/failures.
Good vitals do not prove that users understand the flow.

## Trust and ethical choices

State price, recurrence, data use and consequences where users decide. Keep
decline/cancel choices understandable and usable. Do not fabricate reviews,
urgency or scarcity. Optimize successful informed tasks, not accidental clicks.
Pair conversion metrics with errors, refunds, cancellations, support burden or
other relevant guardrails. These are this skill's product recommendations.
