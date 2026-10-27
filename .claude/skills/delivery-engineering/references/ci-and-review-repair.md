# Diagnose CI and review feedback

Identify the current change, revision, relevant checks, and baseline before
repair. Read the actual failing step and its first causal error, not only the
job label or final stack trace. Separate product failures from unavailable
credentials, exhausted resources, flaky infrastructure, and stale runs. An
unavailable check remains unavailable; rerunning it does not establish success.

Gather independent failures and accessible review findings into one repair
batch. Deduplicate symptoms with a common cause, order fixes by dependency,
and resolve contradictions against the agreement and source evidence. Include
review comments' concrete path and concern; do not assume every suggestion is
correct or claim a comment was resolved without checking its underlying issue.

Implement the smallest complete repair in the declared writable scope. Check
the local reproducer before waiting for remote CI. Rerun the checks invalidated
by the repair and inspect results for the repaired revision. Do not weaken
assertions, suppress failures, or edit proof records to obtain green status.

When monitoring, use a bounded observation window and current run identities.
Continue product repair while evidence shows progress; stop with the exact
resume route at actual authority, resource, budget, or repeated no-progress
boundaries. Preserve useful diagnostics rather than endlessly polling a stale
run. Green CI is evidence for its measured claims, not automatic approval or
delivery completion.

Read-only PR inspection can inform the batch. Commenting, resolving threads,
pushing fixes, rebasing, merging, or publishing requires the corresponding user
authority; Land does not grant it. Use [Git workflow](../../git-workflow/SKILL.md)
for authorized Git actions. When Change Loop is active, its coordinator owns
proof routing and recovery, and delivery still ends at `archived`.
