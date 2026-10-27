---
name: brainstorming
description: Resolve genuine ambiguity before creating or materially revising an OpenSpec change. Use for unclear observable outcomes, competing approaches with consequential tradeoffs, unknown scope boundaries, or an explicit request to explore options. Skip when repository evidence and user intent already determine the change.
---

# Change investigation

Use the lightest path that resolves the decision.

1. Read existing OpenSpec specs and only the code needed to understand the seam.
2. Separate verified facts, hypotheses, constraints, and unknowns. Model the
   material user decisions as a private dependency tree: each decision names
   its prerequisites, alternatives, and dependent effects. Do not persist this
   tree as an artifact or lifecycle state. Challenge fuzzy or conflicting
   project terms against specifications and code; ask only when more than one
   material domain meaning remains.
3. Identify at most three viable approaches and recommend one with concrete
   tradeoffs.
4. Never ask what you can find. Any fact the specs, code, LSP, or sandbox can
   settle is yours to resolve; only questions downstream of that fact wait.
5. Ask in rounds, not one at a time. A round is every open decision whose
   prerequisites are already settled; a question depending on another still
   open belongs to the next round. Carry your recommended answer with each
   question and mark it `(Recommended)`. Present the round through the host's
   structured question tool (AskUserQuestion) when the session provides one,
   one question per decision; otherwise ask in plain text.
   Ask only what materially changes behavior, compatibility, security,
   persistence, scope, or a measurable/observable non-functional target;
   recompute the round from the answers and stop only
   when every material decision has been asked and answered.
6. End with a compact agreement: outcome, in/out, observable scenarios, chosen
   approach, remaining risk, and each asked question with its chosen answer.
   Include canonical project terms with meanings and avoided aliases plus any
   qualifying durable tradeoffs. For runtime-shipping work, also state which of
   performance, capacity, availability, security/privacy, accessibility,
   operability, compatibility, and recoverability are applicable; source `N/A`
   decisions and never invent a target.
   Carry the agreement into feature or change intake. Reuse its settled answers
   without asking them again, and record them in the existing change packet so
   no answer lives only in chat.

Use `/investigate` when the exploration should remain no-stakes. Once the
agreement is clear, hand it to `/change`; do not create a separate spec, plan,
interview ledger, glossary, `CONTEXT.md`, ADR store, or lifecycle state.

No product code lands during investigation. Repository facts must be grounded
in files actually read; label inference explicitly. Prototypes stay inside the
harness-provided investigation scope and are evidence for a decision, not
implementation to Land.
