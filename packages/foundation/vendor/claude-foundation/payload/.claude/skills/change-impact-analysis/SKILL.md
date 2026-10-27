---
name: change-impact-analysis
description: "Trace consumers, compatibility, persisted data, and failure paths before changing behavior, APIs, schemas, or configuration. Use for blast-radius questions or unproven assumptions in a change brief. Feed OpenSpec claims and planning; skip isolated implementation with established contracts."
---

# Change impact analysis

1. Read the proposed change and current agreement. State expected behavior,
   affected boundary, and assumptions that would make the change safe.
2. Trace real consumers beyond symbol searches: serialized bytes, configuration,
   storage, other processes, feature flags, and downstream dependencies.
   Verify pinned dependency behavior from its source.
3. For each material safety fact, cite the source and choose the cheapest
   executable check that could falsify it. Run only within permitted scope.
   Record observed, inferred, unproven, and cleared findings separately.
   Rank each fact by [references/proof-ladder.md](references/proof-ladder.md).
4. Map confirmed risks to consumer, failure, compatibility, migration/rollback,
   and evidence owner. Preserve public contracts unless explicitly changed.
5. Submit agreement findings through Change intake, revision, or amendment.
   Keep in-contract findings with the returned repair; never hand-edit
   an approved agreement to match implementation.

For read-only research use `investigate`; for sequencing use `plan-writing`.
Reuse settled decisions; report newly discovered contradictions.
Follow harness workspace and resume routes. Findings are analysis, not receipts.
Do not create a parallel plan, schedule workers, or grant Land/Git authority.
