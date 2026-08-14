import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

// Every other exit from the change loop requires the change to succeed. A
// change that cannot be proven — an evidence contract nobody can satisfy, a
// provider that will never exist, a corrupt review chain — had no terminal
// state at all, so the only way out was deleting runtime files by hand with
// nothing in the workflow telling the user that was even allowed.
//
// Abandon is that terminal state. It quarantines rather than deletes, because
// the reason a change was abandoned is exactly the evidence someone will want
// when the same wall appears again. It never touches Git: reverting a commit is
// a separate authority the user grants separately.
export function createAbandonRuntime({
  root,
  paths,
  loadRuntime,
  cleanupChangeLeases,
  cleanupAppliedSandbox,
  cleanupRepositorySandboxes,
  transactionJournals,
  rollbackApplyTransaction,
  readJson,
  writeJson,
  now,
  blockWithDecision,
  fail
}) {
  const APPLIED_MODES = ["keep", "revert"];

  function recoveryRoot(id) {
    return join(paths.recovery, "abandoned", id);
  }

  function appliedDecision(id, divergent, applied) {
    return {
      kind: "abandon-applied-workspace",
      summary: applied
        ? "This change already wrote its proven files into the working tree, so abandoning it has to say what happens to those files."
        : "An earlier apply stopped midway and left the working tree in a state Foundation did not finish resolving.",
      options: [
        {
          id: "keep",
          outcome: "Leave the current files exactly as they are and retire the change record."
        },
        {
          id: "revert",
          outcome: "Restore the recorded backups of the touched paths, then retire the change record."
        },
        {
          id: "inspect",
          outcome: "Inspect the recorded transaction against the working tree before deciding."
        },
        { id: "pause", outcome: "Change nothing and keep the change as it stands." }
      ],
      recommended: "inspect",
      appliedPaths: applied?.touchedPaths || [],
      unresolvedTransactions: divergent.map((journal) => ({
        transactionId: journal.transactionId,
        status: journal.status,
        failure: journal.failure || null
      }))
    };
  }

  function revertJournal(id, journal, reason) {
    try {
      rollbackApplyTransaction(journal, reason);
      return { transactionId: journal.transactionId, status: "reverted" };
    } catch (error) {
      // Refusing here keeps abandon from becoming the very thing it fixes: a
      // step that reports success while leaving mutated files behind.
      blockWithDecision(id, "abandon-revert-failed", {
        kind: "abandon-revert-failed",
        summary: `The recorded backup could not be restored (${error.message}), so the working tree was left untouched and the change was not retired.`,
        options: [
          {
            id: "keep",
            outcome: "Abandon again choosing to keep the current files instead of reverting them."
          },
          {
            id: "inspect",
            outcome: "Inspect the transaction backup against the working tree and resolve the divergence by hand."
          },
          { id: "pause", outcome: "Change nothing and leave the change in place." }
        ],
        recommended: "inspect",
        transactionRoot: join(paths.transactions, id, journal.transactionId)
      });
      return null;
    }
  }

  function quarantine(id, entries) {
    const target = recoveryRoot(id);
    mkdirSync(target, { recursive: true });
    const moved = [];
    for (const [name, source] of entries) {
      if (!source || !existsSync(source)) continue;
      const destination = join(target, name);
      mkdirSync(dirname(destination), { recursive: true });
      if (existsSync(destination)) rmSync(destination, { recursive: true });
      renameSync(source, destination);
      moved.push(name);
    }
    return moved;
  }

  function abandonChange(id, flags = {}) {
    const reason = String(flags.reason || "").trim();
    if (!reason) fail("change abandon requires --reason <reason>");
    const decisionRef = String(flags["decision-ref"] || "").trim();
    if (!decisionRef)
      fail("change abandon requires --decision-ref <host-user-decision>; ask the user whether to retire, keep, or resume this change before discarding it");
    // Recoverable: abandon is the designed exit from a change that cannot
    // proceed, so it has to survive the state file being deleted or corrupt —
    // the very conditions that leave every other command refusing.
    const state = loadRuntime(id, { recoverable: true });
    if (state.recoveredState)
      console.error(`WARNING: runtime state for '${id}' is ${
        state.recoveredState}; quarantining what remains on disk`);
    if (state.status === "archived")
      fail(`change '${id}' is archived; an archived change is already terminal`);

    const journals = transactionJournals(id);
    const divergent = journals.filter((journal) =>
      ["rolling-back", "manual-recovery"].includes(journal.status));
    const interrupted = journals.filter((journal) =>
      ["prepared", "applying"].includes(journal.status));
    const applied = state.workspace?.applied ? state.workspace.apply : null;
    const appliedMode = flags.applied === undefined ? null : String(flags.applied);
    if (appliedMode !== null && !APPLIED_MODES.includes(appliedMode))
      fail("change abandon --applied must be keep|revert");
    if ((applied || divergent.length) && appliedMode === null)
      blockWithDecision(id, "abandon-applied-workspace",
        appliedDecision(id, divergent, applied));

    // Before anything moves. The record below carries outcomes — what was
    // reverted, what was cleaned — so it can only be written afterwards, and
    // an abandon interrupted partway through the reverts would otherwise leave
    // no trace of what was attempted or who authorized it.
    const auditPath = join(paths.logs, "abandoned.jsonl");
    mkdirSync(dirname(auditPath), { recursive: true });
    appendFileSync(auditPath, `${JSON.stringify({
      version: 1, changeId: id, event: "abandon-started", reason, decisionRef,
      applied: appliedMode,
      appliedPaths: applied?.touchedPaths || [],
      unresolvedTransactions: divergent.map((journal) => journal.transactionId),
      schema: state.schema || null, status: state.status || null,
      actor: process.env.USER || process.env.LOGNAME || "operator",
      startedAt: now()
    })}\n`);

    const reverted = [];
    // An interrupted apply never represents a state the user chose, so it is
    // undone regardless of the applied decision; only the completed projection
    // is theirs to keep.
    for (const journal of interrupted) {
      const result = revertJournal(id, journal, `abandoned: ${reason}`);
      if (result) reverted.push(result);
    }
    if (applied && appliedMode === "revert") {
      const journal = journals.find((candidate) =>
        candidate.transactionId === applied.transactionId);
      if (!journal)
        fail(`cannot revert '${id}': its apply transaction journal is missing; abandon with --applied keep and resolve the working tree by hand`);
      const result = revertJournal(id, journal, `abandoned: ${reason}`);
      if (result) reverted.push(result);
    }

    cleanupChangeLeases(id);
    const workspaceCleanup = state.workspace
      ? cleanupAppliedSandbox(id, state) : { status: "not-needed" };
    const repositoryCleanup = state.repositories
      ? cleanupRepositorySandboxes(id, state) : null;

    const record = {
      version: 1,
      changeId: id,
      reason,
      decisionRef,
      applied: appliedMode,
      appliedPaths: applied?.touchedPaths || [],
      reverted,
      unresolvedTransactions: divergent.map((journal) => journal.transactionId),
      workspaceCleanup,
      repositoryCleanup,
      schema: state.schema || null,
      status: state.status || null,
      actor: process.env.USER || process.env.LOGNAME || "operator",
      abandonedAt: now()
    };
    // The outcome line, paired with the intent line written above.
    appendFileSync(auditPath, `${JSON.stringify({ ...record, event: "abandoned" })}\n`);

    const moved = quarantine(id, [
      ["change", join(paths.changes, id)],
      ["runtime.json", join(paths.runtime, `${id}.json`)],
      ["receipts", join(paths.receipts, id)],
      ["evidence", join(paths.evidenceVault, id)],
      ["transactions", join(paths.transactions, id)],
      ["plans", join(paths.plans, id)],
      ["logs", join(paths.logs, id)],
      ["snapshot.json", join(paths.snapshots, `${id}.json`)]
    ]);
    record.quarantined = moved;
    writeJson(join(recoveryRoot(id), "abandon.json"), record);

    const relative = join(recoveryRoot(id)).slice(root.length + 1);
    console.log(`ABANDONED ${id}\n  reason: ${reason}\n  applied: ${
      appliedMode || "none"}\n  quarantined: ${relative}`);
    if (["failed", "refused"].includes(workspaceCleanup.status))
      console.error(`WARNING: sandbox cleanup ${workspaceCleanup.status}: ${workspaceCleanup.reason}`);
  }

  return { abandonChange, recoveryRoot };
}
