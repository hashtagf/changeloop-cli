import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// What a transaction would do to the target, in the three shapes an operator
// has to weigh differently. Shared so the pre-apply report and the pending
// report cannot drift apart.
export function projectionCounts(entries) {
  return (entries || []).reduce((counts, entry) => {
    if (entry.after === null) counts.delete += 1;
    else if (entry.before === null) counts.create += 1;
    else counts.update += 1;
    return counts;
  }, { update: 0, create: 0, delete: 0 });
}

// Deletion is the one entry a transaction cannot take back, and the only one a
// manifest can invent: a path the sandbox never carried is indistinguishable
// from a path the change removed, because both are simply absent. Absence is
// not an instruction — the change has to have named the path.
export function undeclaredDeletions(entries, declared) {
  return (entries || []).filter((entry) =>
    entry.after === null && entry.role !== "change-artifacts" &&
    !declared(entry.path));
}

// A worktree sandbox is pinned to the commit it branched from, so a target
// that moved — a teammate's pull, another change landing — leaves the proven
// projection describing a base the target no longer has.
//
// Built here because three call sites state the same condition and used to
// disagree about whether it had a way out: `land check`, both apply guards, and
// the multi-repository pointer stage. A bare refusal reads as permanent even
// though re-basing the sandbox is the ordinary fix, so the exits are named.
export function targetHeadMovedDecision({
  changeId, recordedBase, currentHead, multiRepository = false, action = "Applying"
}) {
  return {
    kind: "control-head-moved",
    summary: `The target repository moved to a different commit after this change's sandbox was created. ${
      action} now would project work proven against a base the target no longer has.`,
    options: [
      // A multi-repository sandbox holds a worktree per repository, and a sync
      // reconciles only the root; offering it here would advertise a partial
      // fix as a whole one.
      ...(multiRepository ? [] : [{
        id: "sync",
        outcome: `Replay the sandbox onto the current commit and re-prove it: 'claude-foundation sandbox sync ${
          changeId}', then 'claude-foundation proof run ${changeId}'.`
      }]),
      {
        id: "inspect",
        outcome: "Compare the recorded base with the current target history before choosing."
      },
      {
        id: "abandon",
        outcome: "Retire this change and reopen it against the current commit."
      },
      { id: "pause", outcome: "Change nothing and leave both workspaces as they are." }
    ],
    recommended: multiRepository ? "inspect" : "sync",
    recordedBase: recordedBase || null,
    currentHead: currentHead || null
  };
}

const UNRESOLVED_APPLY_STATUS = [
  "prepared", "applying", "rolling-back", "manual-recovery", "recovering-backup",
  "settling-current"
];

export function createApplyRecovery({
  transactions, transactionJournalPath, readJson, verifyAppliedProjection,
  saveApplyJournal, rollbackApplyTransaction, settleApplyTransaction,
  saveRuntime, clearSnapshotCache, now, blockWithDecision, fail
}) {
  // Read-only by construction. `land check` needs to say what is pending
  // without touching it: resuming or rolling back an interrupted transaction
  // replays filesystem mutations, and a command named "check" performing them
  // is how thousands of paths moved with nobody having authorized anything.
  function pendingApplyTransactions(id) {
    const transactionRoot = join(transactions, id);
    if (!existsSync(transactionRoot)) return [];
    const pending = [];
    for (const entry of readdirSync(transactionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = transactionJournalPath(id, entry.name);
      if (!existsSync(path)) continue;
      const journal = readJson(path);
      if (!UNRESOLVED_APPLY_STATUS.includes(journal.status)) continue;
      pending.push({
        transactionId: journal.transactionId || entry.name,
        status: journal.status,
        counts: projectionCounts(journal.entries),
        appliedPaths: (journal.appliedPaths || []).length
      });
    }
    return pending;
  }

  function recoverPendingApply(id, state, options = {}) {
    const transactionRoot = join(transactions, id);
    if (!existsSync(transactionRoot)) return;
    for (const entry of readdirSync(transactionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = transactionJournalPath(id, entry.name);
      if (!existsSync(path)) continue;
      const journal = readJson(path);
      if (["rolling-back", "manual-recovery", "recovering-backup", "settling-current"]
        .includes(journal.status)) {
        if (options.resolution) {
          settleApplyTransaction(journal, options.resolution, options.decisionRef);
          if (options.resolution === "keep-current") {
            state.workspace = {
              ...state.workspace,
              applied: false,
              recovery: {
                status: "settled-current",
                transactionId: journal.transactionId,
                decisionRef: options.decisionRef,
                requiresSync: true,
                resolvedAt: now()
              }
            };
            delete state.workspace.apply;
            state.status = "building";
            clearSnapshotCache(id);
            saveRuntime(state);
            journal.status = "settled-current";
            journal.recovery.settledAt = now();
            saveApplyJournal(journal);
          }
          continue;
        }
        blockWithDecision(id, "apply-manual-recovery", journal.decision || {
          kind: "manual-recovery",
          summary: "An earlier apply stopped partway through rolling back and left the working tree in a state Foundation did not finish resolving.",
          options: [
            {
              id: "inspect",
              outcome: "Inspect the working tree against the recorded transaction backup before choosing a recovery."
            },
            {
              id: "keep-current",
              outcome: "Preserve the current files and abandon automatic rollback."
            },
            {
              id: "restore-backup",
              outcome: "Restore the recorded backup after explicitly resolving the divergence."
            },
            { id: "pause", outcome: "Leave the journal pending and make no further changes." }
          ],
          recommended: "inspect",
          transactionRoot: join(transactionRoot, entry.name)
        });
      }
      if (!["prepared", "applying"].includes(journal.status)) continue;
      if (state.workspace?.applied &&
          state.workspace.apply?.transactionId === journal.transactionId) {
        const verification = verifyAppliedProjection(state);
        if (!verification.valid)
          fail(`interrupted apply cannot resume: ${verification.reason}`);
        journal.status = "verified";
        journal.verifiedAt = now();
        saveApplyJournal(journal);
      } else {
        try {
          rollbackApplyTransaction(journal, "interrupted apply recovered before retry");
        } catch (error) {
          fail(error.message);
        }
      }
    }
  }

  return { recoverPendingApply, pendingApplyTransactions };
}
