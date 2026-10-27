import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function createBudgetReporter({ applyBudgetDecision }) {
  function reportBudget(id, state, quiet = false) {
    const decision = applyBudgetDecision(state);
    const spent = decision.measured
      ? `${(decision.ratio * 100).toFixed(1)}%` : "unmeasured";
    const message = `BUDGET ${id}: ${spent} ` +
      `${decision.action} ${decision.recommendation} (${decision.limiter || "unknown"})` +
      (decision.userActionRequired ? " [NEEDS_USER_DECISION]" : "");
    if (!quiet) console.log(message);
    else if (decision.ratio >= 0.7 || decision.mode === "operator-required")
      console.error(`WARNING: ${message}`);
    return decision;
  }
  return { reportBudget };
}

export function budgetContinuationInputs(flags, fail) {
  const reason = String(flags.reason || "").trim();
  if (!reason) fail("budget continue requires --reason <reason>");
  const decisionRef = String(flags["decision-ref"] || "").trim();
  if (!decisionRef)
    fail("budget continue requires --decision-ref <host-user-decision>; ask the user whether to continue, rescope, or pause before opening another window");
  return { reason, decisionRef };
}

export function assertBudgetContinuationAvailable(context, id, budget, decision) {
  if (decision.mode !== "operator-required")
    context.fail("budget continue is available only after exhaustion asks the user for a decision");
  const extensionNumber = Number(budget.window.extensionNumber || 0);
  const maxContinuations = Number(
    context.foundationPolicy?.().execution?.maxContinuationWindows || 3);
  if (extensionNumber >= maxContinuations)
    context.blockWithDecision(id, "budget-continuation-spent", {
      kind: "budget-continuation-spent",
      summary: `This change already used all ${maxContinuations} operator-approved budget continuation windows.`,
      options: [
        { id: "revise-contract", outcome: "Explicitly revise the acceptance contract; unfinished requirements remain required until the user approves the revision." },
        { id: "new-budget", outcome: "Set a new budget policy and resume under a separately audited user decision." },
        { id: "abandon", outcome: "Retire this change without landing it." },
        { id: "pause", outcome: "Spend nothing further and leave the change as it stands." }
      ],
      recommended: "pause",
      window: { used: budget.window.usedTokens, target: budget.window.targetTokens },
      extensions: { used: extensionNumber, maximum: maxContinuations }
    });
  return extensionNumber;
}

export function budgetContinuationReadiness(context, id, state) {
  const artifactGaps = context.changeArtifactGaps(state, context.activeChangePath(id, state));
  const pending = artifactGaps.length ? [] : context.pendingTasks(id);
  if (pending.length)
    return {
      status: "NEEDS_CODE_CHANGE",
      pendingTasks: pending.map((task) => task.id || task.text),
      externalProviders: [], unavailableProviders: [],
      budget: context.readinessBudgetPolicy("NEEDS_CODE_CHANGE")
    };
  if (artifactGaps.length)
    return {
      status: "CONFIGURATION_ERROR",
      pendingTasks: [], externalProviders: [], unavailableProviders: [],
      issues: artifactGaps.map((artifact) => `missing change artifact: ${artifact}`),
      budget: context.readinessBudgetPolicy("CONFIGURATION_ERROR")
    };
  return context.proofReadinessValue(id, "prove");
}

export function budgetContinuationUnblock(readiness) {
  const unblockByClass = {
    "external-authority": { id: "external-evidence", outcome: "Provide the external review, acceptance, or evidence the proof is waiting on; this needs no model budget." },
    infrastructure: { id: "restore-provider", outcome: "Restore or reconfigure the unavailable provider, then re-run proof; this needs no model budget." },
    "active-work": { id: "wait", outcome: "Let the active workers finish or release their expired leases, then re-check readiness." },
    deterministic: { id: "run-proof", outcome: "Run the ready deterministic proof operation; no further model work is required." }
  };
  return unblockByClass[readiness.budget?.class] || unblockByClass.deterministic;
}

function checkpointNextCommand(id, readiness) {
  if (readiness.status === "NEEDS_CODE_CHANGE")
    return `claude-foundation packet ${id} --phase build`;
  if (readiness.status === "CONFIGURATION_ERROR")
    return `claude-foundation change validate ${id}`;
  return `claude-foundation proof advance ${id}`;
}

function checkpointForecast(decision, readiness) {
  if (readiness.budget?.eligible === false) return {
    status: "NO_ADDITIONAL_MODEL_BUDGET_NEEDED",
    confidence: "readiness-classified",
    reason: readiness.budget.reason || "The next unblock is deterministic or external."
  };
  if (!decision.measured) return {
    status: "UNKNOWN",
    confidence: "none",
    reason: "No host usage events have measured this active window."
  };
  if (decision.userActionRequired) return {
    status: "USER_DECISION_REQUIRED",
    confidence: "measured-capacity",
    reason: "The active allowance is exhausted; the harness will not infer whether to spend more or change scope."
  };
  if (decision.mode === "completion-only") return {
    status: "AT_RISK",
    confidence: "measured-capacity",
    reason: "At least 85% of one active allowance lane is used; only completion work is allowed."
  };
  return {
    status: "CAPACITY_AVAILABLE",
    confidence: "measured-capacity",
    reason: "The active allowance has capacity; remaining work is reported separately instead of converted into invented request or token demand."
  };
}

function checkpointRoute(id, readiness, budget, needsUser) {
  const nextCommand = checkpointNextCommand(id, readiness);
  const route = {
    durable: true,
    windowId: budget.window.id,
    sequence: Number(budget.window.sequence || 0),
    extensionNumber: Number(budget.window.extensionNumber || 0),
    inspectCommand: `claude-foundation budget checkpoint ${id}`,
    resumeCommand: nextCommand,
    afterContinuationCommand: null
  };
  if (needsUser) {
    route.resumeCommand = null;
    route.afterContinuationCommand = nextCommand;
  }
  return route;
}

function checkpointUserPrompt(decision, needsUser) {
  if (!needsUser || !decision.decision) return null;
  return decision.decision.prompt;
}

export function budgetCheckpointValue(context, id) {
  const state = context.loadRuntime(id);
  const budget = context.ensureBudgetState(state);
  const decision = context.applyBudgetDecision(state);
  const readiness = budgetContinuationReadiness(context, id, state);
  const needsUser = decision.userActionRequired === true &&
    readiness.budget?.eligible !== false;
  return {
    version: 1,
    changeId: id,
    status: needsUser ? "NEEDS_USER_DECISION" : "READY_TO_RESUME",
    decision,
    forecast: checkpointForecast(decision, readiness),
    remainingWork: {
      readinessStatus: readiness.status,
      pendingTasks: readiness.pendingTasks,
      externalProviders: readiness.externalProviders,
      unavailableProviders: readiness.unavailableProviders,
      modelBudget: readiness.budget
    },
    checkpoint: checkpointRoute(id, readiness, budget, needsUser),
    userPrompt: checkpointUserPrompt(decision, needsUser)
  };
}

export function showBudgetCheckpoint(context, id) {
  console.log(JSON.stringify(budgetCheckpointValue(context, id), null, 2));
}

export function assertBudgetContinuationEligible(context, id, readiness) {
  if (readiness.budget?.eligible) return;
  const unblock = budgetContinuationUnblock(readiness);
  context.blockWithDecision(id, "budget-continuation-rejected", {
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

export function nextBudgetContinuationWindow(context, id, flags, budget,
    previous, extensionNumber) {
  const targets = {
    requests: Number(budget.targetRequests),
    tokens: Number(budget.targetTokens)
  };
  const runId = String(flags.run || process.env.FOUNDATION_RUN_ID ||
    process.env.FOUNDATION_CLAUDE_SESSION_ID || previous.id);
  const events = context.readJsonLines(join(context.logs, id, "events.jsonl"));
  const currentRunUsage = context.eventUsage(
    events.filter((event) => event.runId === runId));
  const window = context.budgetWindow(runId, targets, currentRunUsage,
    Number(previous.sequence || 0) + 1, "operator-continue");
  window.extensionRootId = previous.extensionRootId || previous.id;
  window.extensionNumber = extensionNumber + 1;
  return { runId, window };
}

export function persistBudgetContinuation(context, id, state, budget,
    previous, auditWindow, reason, decisionRef) {
  try {
    context.saveRuntime(state);
    context.appendBudgetAudit(id, "continue", reason, decisionRef, previous, auditWindow);
  } catch (error) {
    budget.window = previous;
    try { context.saveRuntime(state); } catch { /* preserve the original failure */ }
    throw error;
  }
}

export function continueBudgetWindow(context, id, flags) {
  const { reason, decisionRef } = budgetContinuationInputs(flags, context.fail);
  const state = context.loadRuntime(id);
  const budget = context.ensureBudgetState(state);
  const readiness = budgetContinuationReadiness(context, id, state);
  // An external or deterministic blocker cannot be solved by model allowance,
  // regardless of whether the current window is exhausted. Diagnose that real
  // boundary before the exhaustion precondition so calibration changes cannot
  // replace an actionable recovery route with a generic ordering error.
  assertBudgetContinuationEligible(context, id, readiness);
  const decision = context.applyBudgetDecision(state);
  const extensionNumber = assertBudgetContinuationAvailable(
    context, id, budget, decision);
  const previous = structuredClone(budget.window);
  const { runId, window } = nextBudgetContinuationWindow(
    context, id, flags, budget, previous, extensionNumber);
  budget.window = window;
  const auditWindow = {
    ...window,
    requiredStatus: readiness.status,
    pendingTasks: readiness.pendingTasks,
    missingExternalProviders: readiness.externalProviders,
    unavailableProviders: readiness.unavailableProviders
  };
  persistBudgetContinuation(
    context, id, state, budget, previous, auditWindow, reason, decisionRef);
  console.log(`BUDGET CONTINUED ${id}\n  run: ${runId}\n  reason: ${reason}\n  decision: ${decisionRef}`);
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

  const continueBudget = continueBudgetWindow.bind(null, {
    logs, loadRuntime, saveRuntime, ensureBudgetState, applyBudgetDecision,
    changeArtifactGaps, activeChangePath, pendingTasks, readinessBudgetPolicy,
    proofReadinessValue, eventUsage, budgetWindow, readJsonLines,
    appendBudgetAudit, blockWithDecision, fail
  });
  const checkpointBudget = showBudgetCheckpoint.bind(null, {
    loadRuntime, ensureBudgetState, applyBudgetDecision,
    changeArtifactGaps, activeChangePath, pendingTasks, readinessBudgetPolicy,
    proofReadinessValue
  });

  return { continueBudget, checkpointBudget };
}
