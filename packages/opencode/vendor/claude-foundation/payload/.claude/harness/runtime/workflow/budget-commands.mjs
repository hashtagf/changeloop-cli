import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function createBudgetReporter({ applyBudgetDecision }) {
  function reportBudget(id, state, quiet = false) {
    const decision = applyBudgetDecision(state);
    const spent = decision.measured
      ? `${(decision.ratio * 100).toFixed(1)}%` : "unmeasured";
    const message = `BUDGET ${id}: ${spent} ` +
      `${decision.action} ${decision.recommendation} (${decision.limiter || "unknown"})`;
    if (!quiet) console.log(message);
    else if (decision.ratio >= 0.7 || decision.mode === "operator-required")
      console.error(`WARNING: ${message}`);
    return decision;
  }
  return { reportBudget };
}

export function createBudgetContinuation({
  logs, loadRuntime, saveRuntime, ensureBudgetState, applyBudgetDecision,
  changeArtifactGaps, activeChangePath, pendingTasks, readinessBudgetPolicy,
  proofReadinessValue, eventUsage, budgetWindow, readJsonLines, now,
  blockWithDecision, fail
}) {
  function appendBudgetAudit(id, action, reason, decisionRef, previous, current) {
    const path = join(logs, id, "budget-events.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      version: 1,
      changeId: id,
      action,
      reason,
      decisionRef,
      previous,
      current,
      actor: process.env.USER || process.env.LOGNAME || "operator",
      timestamp: now()
    })}\n`);
  }

  function continueBudget(id, flags) {
    const reason = String(flags.reason || "").trim();
    if (!reason) fail("budget continue requires --reason <reason>");
    const decisionRef = String(flags["decision-ref"] || "").trim();
    if (!decisionRef)
      fail("budget continue requires --decision-ref <host-user-decision>; ask the user whether to continue, rescope, or pause before opening another window");
    const state = loadRuntime(id);
    const budget = ensureBudgetState(state);
    const decision = applyBudgetDecision(state);
    if (!["completion-only", "operator-required"].includes(decision.mode))
      fail("budget continue is available only after the active run reaches a completion boundary");
    const extensionNumber = Number(budget.window.extensionNumber || 0);
    if (extensionNumber >= 1)
      blockWithDecision(id, "budget-continuation-spent", {
        kind: "budget-continuation-spent",
        summary: "This run already used its one extra budget window, so continuing again would hide how much the change actually costs.",
        options: [
          { id: "rescope", outcome: "Narrow this change to what is already provable and carry the remainder into a new change." },
          { id: "split", outcome: "Create a follow-up change for the unfinished tasks and finish this one at its current scope." },
          { id: "abandon", outcome: "Retire this change without landing it." },
          { id: "pause", outcome: "Spend nothing further and leave the change as it stands." }
        ],
        recommended: "rescope",
        window: { used: budget.window.usedTokens, target: budget.window.targetTokens }
      });
    const artifactGaps = changeArtifactGaps(state, activeChangePath(id, state));
    const pending = artifactGaps.length ? [] : pendingTasks(id);
    const readiness = pending.length ? {
      status: "NEEDS_CODE_CHANGE",
      pendingTasks: pending.map((task) => task.id || task.text),
      externalProviders: [], unavailableProviders: [],
      budget: readinessBudgetPolicy("NEEDS_CODE_CHANGE")
    } : artifactGaps.length ? {
      status: "CONFIGURATION_ERROR",
      pendingTasks: [], externalProviders: [], unavailableProviders: [],
      issues: artifactGaps.map((artifact) => `missing change artifact: ${artifact}`),
      budget: readinessBudgetPolicy("CONFIGURATION_ERROR")
    } : proofReadinessValue(id, "prove");
    if (!readiness.budget?.eligible) {
      const unblockByClass = {
        "external-authority": { id: "external-evidence", outcome: "Provide the external review, acceptance, or evidence the proof is waiting on; this needs no model budget." },
        infrastructure: { id: "restore-provider", outcome: "Restore or reconfigure the unavailable provider, then re-run proof; this needs no model budget." },
        "active-work": { id: "wait", outcome: "Let the active workers finish or release their expired leases, then re-check readiness." },
        deterministic: { id: "run-proof", outcome: "Run the ready deterministic proof operation; no further model work is required." }
      };
      const unblock = unblockByClass[readiness.budget?.class] || unblockByClass.deterministic;
      blockWithDecision(id, "budget-continuation-rejected", {
        kind: "budget-continuation-rejected",
        summary: `A larger model budget would not move this change: ${readiness.budget?.reason || "no model-completable work remains"}.`,
        options: [
          unblock,
          { id: "rescope", outcome: "Narrow the change to what is provable here and carry the remainder into a new change." },
          { id: "abandon", outcome: "Retire this change without landing it." },
          { id: "pause", outcome: "Spend nothing further and leave the change as it stands." }
        ],
        recommended: unblock.id,
        readinessStatus: readiness.status,
        budgetClass: readiness.budget?.class || readiness.status
      });
    }
    const previous = structuredClone(budget.window);
    const targets = {
      requests: Number(budget.targetRequests),
      tokens: Number(budget.targetTokens)
    };
    const runId = String(flags.run || process.env.FOUNDATION_RUN_ID ||
      process.env.FOUNDATION_CLAUDE_SESSION_ID || previous.id);
    const events = readJsonLines(join(logs, id, "events.jsonl"));
    const currentRunUsage = eventUsage(events.filter((event) => event.runId === runId));
    budget.window = budgetWindow(runId, targets, currentRunUsage,
      Number(previous.sequence || 0) + 1, "operator-continue");
    budget.window.extensionRootId = previous.extensionRootId || previous.id;
    budget.window.extensionNumber = extensionNumber + 1;
    const auditWindow = {
      ...budget.window,
      requiredStatus: readiness.status,
      pendingTasks: readiness.pendingTasks,
      missingExternalProviders: readiness.externalProviders,
      unavailableProviders: readiness.unavailableProviders
    };
    try {
      saveRuntime(state);
      appendBudgetAudit(id, "continue", reason, decisionRef, previous, auditWindow);
    } catch (error) {
      budget.window = previous;
      try { saveRuntime(state); } catch { /* preserve the original failure */ }
      throw error;
    }
    console.log(`BUDGET CONTINUED ${id}\n  run: ${runId}\n  reason: ${reason}\n  decision: ${decisionRef}`);
  }

  return { continueBudget };
}
