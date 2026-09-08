import { measuredNumber } from "../core/measured-number.mjs";
import { executionSurfaceBudgetScale } from "../core/authority-policy.mjs";

export function budgetDirective(ratio, operatorRequired) {
  if (operatorRequired || ratio >= 1)
    return {
      mode: "operator-required", action: "OPERATOR_REQUIRED",
      recommendation: "ASK_USER"
    };
  if (ratio >= 0.85)
    return {
      mode: "completion-only", action: "COMPLETION_ONLY",
      recommendation: "STOP_EXPLORATION"
    };
  if (ratio >= 0.7)
    return {
      mode: "conserve", action: "BATCH_AND_REUSE",
      recommendation: "BATCH_AND_REUSE"
    };
  return { mode: "normal", action: "CONTINUE", recommendation: "CONTINUE" };
}

export function createBudgetRuntime({ policy, now }) {
  // Spend is new work: what the model read fresh, wrote, and cached for later.
  // Cache reads are excluded on purpose. Every turn re-reads the whole
  // conversation, so counting them makes measured spend grow with session
  // length rather than with the work done, and the budget stops meaning
  // anything. Context re-read is reported separately by `metrics`.
  function eventTokenCount(event) {
    // `Number(null)` is 0 and 0 is finite, so an event that explicitly reports
    // "unknown" as null used to derive a cache write of 0 and then a total of
    // 0 — a measured zero where nothing was measured. Unknown is never zero.
    const cacheCreation = measuredNumber(event.cacheCreationTokens);
    const cacheTotal = measuredNumber(event.cacheTokens);
    const cacheRead = measuredNumber(event.cacheReadTokens);
    const derivedCacheWrite = cacheTotal !== null && cacheRead !== null
      ? cacheTotal - cacheRead : null;
    const cacheWrite = cacheCreation ?? measuredNumber(derivedCacheWrite);
    const values = [event.inputTokens, event.outputTokens, cacheWrite]
      .map(measuredNumber).filter((value) => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  // Size scales the execution lane for the same reason impact does: the
  // compiled surface predicts both orchestration turns and model context.
  // first. The loop already asks the author to declare a size and WORKFLOW.md
  // says it is "for budget and slicing only", but nothing here read it, so the
  // declaration meant nothing. Scales combine by max rather than product — a
  // large high-impact change earns one widening, not two multiplied together.
  const SIZE_REQUEST_SCALE = { xs: 0.5, s: 1, m: 1.5, l: 2 };

  function budgetCalibration(schema, impact, size, profile = {}) {
    const { requestBudgets, tokenBudgets } = policy().execution;
    // An unrecognized schema takes the standard lane deliberately: a spend
    // target is not an assurance gate, and refusing to compute one would strand
    // the change rather than protect anything.
    const lane = schema === "foundation-rapid" ? "rapid" : "standard";
    const sizeScale = SIZE_REQUEST_SCALE[String(size || "").toLowerCase()] ?? 1;
    const repositoryCount = Math.max(0, Number(profile.repositoryCount || 0));
    const providerCount = Math.max(0, Number(profile.providerCount || 0));
    const securityTriggerCount = Math.max(0, Number(profile.securityTriggerCount || 0));
    // These factors overlap heavily, so take the widest declared lane rather
    // than multiplying them. Multiplication makes a high-impact multi-repo
    // change effectively unbounded; ignoring them recreates the Stripe case
    // where the default request lane was exhausted before Prove could finish.
    const riskScale = securityTriggerCount > 0 ? 2 : 1;
    const reviewScale = profile.reviewTier === "high" ? 2
      : profile.reviewTier === "medium" ? 1.5 : 1;
    const couplingScale = profile.coupling === "coupled" ? 1.5 : 1;
    const repositoryScale = repositoryCount > 1
      ? Math.min(3, 1 + (repositoryCount - 1) * 0.5) : 1;
    const providerScale = providerCount > 4
      ? Math.min(2, 1 + (providerCount - 4) * 0.15) : 1;
    const surfaceScale = executionSurfaceBudgetScale(profile);
    const factors = {
      impact: impact === "high" ? 1.5 : impact === "medium" ? 1.25 : 1,
      size: sizeScale,
      security: riskScale,
      review: reviewScale,
      coupling: couplingScale,
      repositories: repositoryScale,
      providers: providerScale,
      executionSurface: surfaceScale
    };
    const scale = Math.max(...Object.values(factors));
    const limitingFactors = Object.entries(factors)
      .filter(([, value]) => value === scale).map(([name]) => name);
    const baseRequests = requestBudgets?.[lane] ?? (lane === "rapid" ? 100 : 200);
    const baseTokens = tokenBudgets[lane];
    const scaledTarget = (base) => Math.ceil(Number((base * scale).toFixed(8)));
    return {
      version: 1,
      lane,
      inputs: {
        impact: impact || null,
        size: size || null,
        coupling: profile.coupling || null,
        reviewTier: profile.reviewTier || null,
        securityTriggerCount,
        taskCount: Math.max(0, Number(profile.taskCount || 0)),
        claimCount: Math.max(0, Number(profile.claimCount || 0)),
        providerCount,
        repositoryCount,
        criticalCaseCount: Math.max(0, Number(profile.criticalCaseCount || 0)),
        externalAuthorityCount: Math.max(0, Number(profile.externalAuthorityCount || 0))
      },
      factors,
      selectedScale: scale,
      limitingFactors,
      targets: {
        requests: scaledTarget(baseRequests),
        tokens: scaledTarget(baseTokens)
      }
    };
  }

  function budgetTargets(schema, impact, size, profile = {}) {
    return budgetCalibration(schema, impact, size, profile).targets;
  }

  function budgetWindow(id, targets, baseline = {}, sequence = 1, reason = "initial-run") {
    const baselineMeasured = baseline.measured === true;
    return {
      id,
      extensionRootId: id,
      extensionNumber: 0,
      sequence,
      targetRequests: targets.requests,
      targetTokens: targets.tokens,
      baselineRequests: Number(baseline.requests || 0),
      baselineTokens: Number(baseline.tokens || 0),
      // A newly opened window has spent zero only when its baseline came from
      // observed host events. Before the first observation, zero would be a
      // claim about usage rather than an initialized counter.
      usedRequests: baselineMeasured ? 0 : null,
      usedTokens: baselineMeasured && knownNumber(baseline.tokens) ? 0 : null,
      mode: "normal",
      reason,
      startedAt: now(),
      exhaustedAt: null,
      closedAt: null
    };
  }

  function initialBudget(schema, id) {
    const targets = budgetTargets(schema);
    const runId = process.env.FOUNDATION_RUN_ID ||
      process.env.FOUNDATION_CLAUDE_SESSION_ID || id;
    return {
      version: 4,
      measures: "input+output+cache-write; cache reads excluded",
      targetRequests: targets.requests,
      targetTokens: targets.tokens,
      usedRequests: null,
      usedTokens: null,
      measurement: "unavailable-until-external-events",
      lifetime: { usedRequests: null, usedTokens: null },
      window: budgetWindow(runId, targets)
    };
  }

  function knownNumber(value) {
    return measuredNumber(value) !== null;
  }

  function budgetAllowance(window, requestsKnown, tokensKnown, measured) {
    const remaining = (used, target) => knownNumber(used)
      ? Math.max(0, Number(target) - Number(used)) : null;
    return {
      measurement: measured ? "measured-active-window" : "unavailable",
      window: {
        requests: {
          used: requestsKnown ? Number(window.usedRequests) : null,
          target: Number(window.targetRequests),
          remaining: remaining(window.usedRequests, window.targetRequests)
        },
        tokens: {
          used: tokensKnown ? Number(window.usedTokens) : null,
          target: Number(window.targetTokens),
          remaining: remaining(window.usedTokens, window.targetTokens)
        }
      },
      extension: {
        used: Number(window.extensionNumber || 0),
        maximum: Number(policy().execution.maxContinuationWindows || 3)
      }
    };
  }

  function budgetExhaustionDecision(state, window) {
    return {
      kind: "budget-exhausted",
      summary: "The active model budget is exhausted. Required scope remains locked until the user decides how to proceed.",
      options: [
        {
          id: "continue",
          outcome: "Open an audited continuation window for eligible unfinished model work."
        },
        {
          id: "rescope",
          outcome: "Propose an explicit contract revision; no acceptance criterion changes without user approval."
        },
        {
          id: "pause",
          outcome: "Spend no more model budget and preserve the resumable checkpoint."
        }
      ],
      recommended: "pause",
      decisionRefRequiredForContinuation: true,
      prompt: "The budget is exhausted while required scope may remain. Ask the user to choose continue, rescope, or pause.",
      continuationCommand: state.id
        ? `claude-foundation budget continue ${state.id} --reason <reason> --decision-ref <host-user-decision>`
        : null,
      exhaustedAt: window.exhaustedAt || null
    };
  }

  function calibrationForState(state) {
    const surface = state.executionSurface || {};
    return budgetCalibration(state.schema, state.impact, state.size, {
      coupling: state.coupling,
      reviewTier: surface.reviewTier || null,
      repositoryCount: surface.repositoryCount ??
        Object.keys(state.repositories || {}).length,
      providerCount: surface.providerCount ??
        (Array.isArray(state.evidenceCapabilities)
          ? state.evidenceCapabilities.length : 0),
      securityTriggerCount: surface.securityTriggerCount ??
        (Array.isArray(state.securityTriggers) ? state.securityTriggers.length : 0),
      taskCount: surface.taskCount,
      claimCount: surface.claimCount,
      criticalCaseCount: surface.criticalCaseCount,
      externalAuthorityCount: surface.externalAuthorityCount
    });
  }

  function targetsForState(state) {
    return calibrationForState(state).targets;
  }

  function upgradeVersion3Budget(state, existing) {
    // Runtime v4 changes an exhausted window from an implicit auto-rescope
    // boundary into an explicit user-decision boundary. Preserve all v3 usage
    // and window identity while upgrading so a process restart cannot erase
    // either the spend or the pending decision.
    if (existing.version !== 3 || !existing.lifetime || !existing.window)
      return existing;
    const upgraded = {
      ...existing,
      version: 4,
      lifetime: { ...existing.lifetime },
      window: { ...existing.window }
    };
    const requestExhausted = knownNumber(upgraded.window.usedRequests) &&
      Number(upgraded.window.usedRequests) >= Number(upgraded.window.targetRequests || 1);
    const tokenExhausted = knownNumber(upgraded.window.usedTokens) &&
      Number(upgraded.window.usedTokens) >= Number(upgraded.window.targetTokens || 1);
    if (upgraded.window.exhaustedAt || upgraded.window.mode === "operator-required" ||
        requestExhausted || tokenExhausted)
      upgraded.window.mode = "operator-required";
    state.budget = upgraded;
    return upgraded;
  }

  function upgradedLegacyBudget(state, existing, targets) {
    const legacyRequests = knownNumber(existing.usedRequests)
      ? Number(existing.usedRequests) : null;
    // Version 2 counted cache reads as spend. Those totals do not mean the
    // same thing here, so they are dropped rather than carried forward; the
    // next telemetry sync recomputes them from the retained events.
    const legacyTokens = existing.version === 2 ? null
      : knownNumber(existing.usedTokens) ? Number(existing.usedTokens) : null;
    return {
      version: 4,
      measures: "input+output+cache-write; cache reads excluded",
      targetRequests: targets.requests,
      targetTokens: targets.tokens,
      usedRequests: legacyRequests,
      usedTokens: legacyTokens,
      measurement: existing.measurement || "unavailable-until-external-events",
      lifetime: { usedRequests: legacyRequests, usedTokens: legacyTokens },
      window: budgetWindow(`${state.id}:post-upgrade`, targets, {}, 1, "runtime-upgrade")
    };
  }

  function normalizeCurrentBudget(budget, targets) {
    budget.targetRequests = targets.requests;
    budget.targetTokens = targets.tokens;
    budget.lifetime.usedRequests = knownNumber(budget.lifetime.usedRequests)
      ? Number(budget.lifetime.usedRequests) : null;
    budget.lifetime.usedTokens = knownNumber(budget.lifetime.usedTokens)
      ? Number(budget.lifetime.usedTokens) : null;
    budget.usedRequests = budget.lifetime.usedRequests;
    budget.usedTokens = budget.lifetime.usedTokens;
    // Runtime v3 originally persisted numeric zero in a fresh window while
    // explicitly saying its measurement was unavailable. Heal that
    // contradictory state on read so an upgraded change does not keep
    // reporting invented usage forever.
    if (budget.measurement === "unavailable-until-external-events" &&
        budget.lifetime.usedRequests === null && budget.lifetime.usedTokens === null &&
        Number(budget.window.usedRequests) === 0 && Number(budget.window.usedTokens) === 0) {
      budget.window.usedRequests = null;
      budget.window.usedTokens = null;
    }
    // An audited continuation keeps its granted targets; only unknown fields
    // are filled. Every other active window follows newly derived targets.
    if (budget.window.reason !== "operator-continue") {
      budget.window.targetRequests = targets.requests;
      budget.window.targetTokens = targets.tokens;
      return budget;
    }
    if (!knownNumber(budget.window.targetRequests))
      budget.window.targetRequests = targets.requests;
    if (!knownNumber(budget.window.targetTokens))
      budget.window.targetTokens = targets.tokens;
    return budget;
  }

  function ensureBudgetState(state) {
    // Targets are derived, never trusted from stored state: impact and policy
    // can change after the first window has already been persisted.
    const targets = targetsForState(state);
    const existing = upgradeVersion3Budget(state, state.budget || {});
    state.budget = existing.version !== 4 || !existing.lifetime || !existing.window
      ? upgradedLegacyBudget(state, existing, targets)
      : normalizeCurrentBudget(existing, targets);
    return state.budget;
  }

  function eventUsage(events) {
    const knownTokens = events.map(eventTokenCount).filter((value) => value !== null);
    return {
      requests: events.length,
      tokens: knownTokens.length
        ? knownTokens.reduce((sum, value) => sum + value, 0)
        : null,
      measured: events.length > 0
    };
  }

  function activateBudgetWindow(state, runId, reason = "new-run", priorEvents = []) {
    const budget = ensureBudgetState(state);
    if (!runId || budget.window.id === runId) return budget.window;
    const targets = {
      requests: Number(budget.targetRequests),
      tokens: Number(budget.targetTokens)
    };
    const previous = budget.window;
    const priorRunUsage = eventUsage(priorEvents.filter((event) => event.runId === runId));
    budget.window = budgetWindow(runId, targets, priorRunUsage,
      Number(previous.sequence || 0) + 1, reason);
    // A new run id resets this window's usage — that is what a genuine host
    // session rollover means. It must not also hand back the *allowance*: the
    // run id is caller-supplied, so clearing an operator stop or the
    // one-extension cap here would let `--run anything-new` re-arm the gate
    // indefinitely with no decision recorded. Only `budget continue` widens
    // the allowance, and it records why.
    budget.window.extensionRootId = previous.extensionRootId || previous.id || null;
    budget.window.extensionNumber = Number(previous.extensionNumber || 0);
    if (previous.mode === "operator-required") budget.window.mode = "operator-required";
    return budget.window;
  }

  function budgetDecision(state) {
    const budget = ensureBudgetState(state);
    const window = budget.window;
    const requestsKnown = knownNumber(window.usedRequests);
    const tokensKnown = knownNumber(window.usedTokens);
    const requestRatio = requestsKnown
      ? Number(window.usedRequests) / Number(window.targetRequests || 1) : 0;
    const tokenRatio = tokensKnown
      ? Number(window.usedTokens) / Number(window.targetTokens || 1) : 0;
    const ratio = Math.max(requestRatio, tokenRatio);
    // Unknown spend still fails open — an unwired host must not gate the loop —
    // but the zero it falls back to is not a measurement, and the report used
    // to print it as one: "BUDGET <id>: 0.0% CONTINUE" for a change nobody had
    // measured at all. `measured` is what lets the reader tell the two apart.
    // `ensureBudgetState` removes the legacy invented zeros before this point.
    // Any number that remains is therefore an explicit observation or an
    // operator/test injection and must retain its numeric meaning.
    const measured = requestsKnown || tokensKnown;
    const limiter = !measured ? null
      : tokenRatio > requestRatio ? "tokens" : "requests";
    const operatorRequired = window.mode === "operator-required";
    const { mode, action, recommendation } = budgetDirective(ratio, operatorRequired);
    const userActionRequired = mode === "operator-required";
    const allowance = budgetAllowance(window, requestsKnown, tokensKnown, measured);
    return {
      ratio, measured, limiter, mode, action, recommendation,
      allowance,
      status: userActionRequired ? "NEEDS_USER_DECISION" : "CONTINUE",
      userActionRequired,
      decision: userActionRequired ? budgetExhaustionDecision(state, window) : null,
      allowed: mode === "completion-only" ? [
        "focused-fix", "provider-run", "receipt-reuse", "proof-resume",
        "metrics", "budget-checkpoint", "land-recovery", "archive"
      ] : mode === "operator-required" ? [
        // An operator stop withholds *new* work, not the loop's own completion
        // path. `Required proof remains` is stated for this state too, and a
        // change that cannot run its providers or resume Land is stranded
        // rather than gated. What stays out is anything that would grow the
        // change while the operator is being asked whether to fund it.
        "packet", "readiness", "provider-run", "proof-resume", "receipt-reuse",
        "metrics", "budget-checkpoint", "land-recovery", "budget-continue", "archive"
      ] : ["scoped-execution"],
      forbidden: mode === "completion-only" ? [
        "scope-expansion", "speculative-investigation", "new-subagent", "optional-refactor"
      ] : mode === "operator-required" ? [
        "model-exploration", "new-subagent", "scope-expansion"
      ] : []
    };
  }

  function applyBudgetDecision(state) {
    const window = state.budget.window;
    const preliminary = budgetDecision(state);
    if (window.mode !== "operator-required") window.mode = preliminary.mode;
    if (preliminary.ratio >= 1 && !window.exhaustedAt) window.exhaustedAt = now();
    // Exhaustion is a user-decision boundary on the first window as well as on
    // continuations. It must never silently reduce scope or re-arm merely
    // because the host supplies a different run id. Deterministic completion
    // operations remain explicitly allowed by `budgetDecision`; only new model
    // work waits for an audited `budget continue` decision reference.
    if (preliminary.ratio >= 1) window.mode = "operator-required";
    // Recomputed, because the transition above changes the answer the caller is
    // about to act on.
    return budgetDecision(state);
  }

  function synchronizeBudgetUsage(state, events, runId, measurement, newEventCount = 0) {
    const budget = ensureBudgetState(state);
    const priorEvents = newEventCount > 0
      ? events.slice(0, Math.max(0, events.length - newEventCount)) : events;
    activateBudgetWindow(state, runId, "new-run", priorEvents);
    const lifetimeUsage = eventUsage(events);
    const activeRunUsage = eventUsage(events.filter((event) => event.runId === budget.window.id));
    const requestTotal = events.length ? lifetimeUsage.requests : null;
    const tokenTotal = events.length ? lifetimeUsage.tokens : null;
    budget.lifetime.usedRequests = requestTotal;
    budget.lifetime.usedTokens = tokenTotal;
    budget.usedRequests = requestTotal;
    budget.usedTokens = tokenTotal;
    budget.measurement = measurement;
    budget.window.usedRequests = Math.max(0,
      activeRunUsage.requests - Number(budget.window.baselineRequests || 0));
    budget.window.usedTokens = activeRunUsage.tokens === null ? null : Math.max(0,
      activeRunUsage.tokens - Number(budget.window.baselineTokens || 0));
    return applyBudgetDecision(state);
  }

  return {
    eventTokenCount, budgetTargets, budgetCalibration, calibrationForState,
    budgetWindow, initialBudget, knownNumber,
    ensureBudgetState, eventUsage, activateBudgetWindow, budgetDecision,
    applyBudgetDecision, synchronizeBudgetUsage
  };
}
