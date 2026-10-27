# Pull requests

Use this for an explicitly authorized PR operation or a local description
draft. Land and /dev do not commit, push, open a PR, post comments, or merge.
The optional /deliver route owns its scoped post-Land transaction; installed
WORKFLOW.md is canonical for its authority and recovery.

## Prepare the description

Read the compiled OpenSpec agreement, actual delivered diff, and current
evidence. Explain the concrete problem and resulting behavior, why the change
is needed, and what was actually checked. Scale detail to the change and use
the repository template. UI/API examples help when they show the decisive
behavior. Screenshots do not substitute for executable proof. Prose style:
[writing](../../init-project-docs/references/writing.md).

A test plan may list reproducible checks, but distinguish executed, failed,
unavailable, and proposed checks. Do not copy stale results or mark checkboxes
from a reviewer summary. Reference actual artifacts and commands.

## Scope and readiness

Prefer one coherent purpose. Separate a rename, structural preparation,
intentional behavior change, or schema expansion when it improves review and
keeps delivery independently safe. Diff size guides attention and slicing,
not correctness, risk tier, or a mandatory line-count gate.

An authorized draft PR can support early feedback. Creating it requires PR
and push authority; do not open one merely because a diff exists. Mark ready
only when applicable checks pass, the diff has been reviewed, and its
description accurately states remaining limits.

## Dependencies

For authorized stacked PRs, choose a base that shows only the intended diff
and verify dependency order. Do not assume a hosting platform will retarget
every stack. Read the actual platform/repository policy before changing bases.
Change Loop task dependencies remain in the compiled agreement; PR stacking
does not replace harness scheduling or isolation.

## Review feedback

Read comments, check each claim against source and evidence, and aggregate
independent actionable findings. Repair one dependency-ordered batch through
the active change and selectively rerun invalidated checks.

Posting replies, resolving threads, pushing fixes, or rewriting history are
separate external/Git operations. Existing read-only review access grants none
of them. Follow repository etiquette once authorized. Describe disagreements
with source evidence; reviewer consensus alone is not a defect or proof.

Use configured Change Loop review for harness proof. A PR review or AI comment
does not automatically satisfy its required independence or provider policy.
Required hosting approvals are a separate repository policy, not a universal
claim about human versus model capability.

## Integration

Choose squash, merge, or rebase under the project's history policy and explicit
merge authority. Verify the real candidate after integration; text-clean
conflict resolution does not prove behavior. Authorized history cleanup should
preserve intended tree identity and retain a recovery route.

Do not merge with unresolved required checks, silently disable protection, or
treat repeated CI reruns as a fix. Git, PR, deployment, and archived lifecycle
status are distinct; report the state actually reached.
