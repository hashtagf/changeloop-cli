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
    const known = (value) =>
      value !== null && value !== undefined && Number.isFinite(Number(value));
    const cacheWrite = event.cacheCreationTokens ?? (
      known(event.cacheTokens) && known(event.cacheReadTokens)
        ? Number(event.cacheTokens) - Number(event.cacheReadTokens) : null);
    const values = [event.inputTokens, event.outputTokens, cacheWrite].filter(known);
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
  }

  // Size scales the request lane for the same reason impact does: requests bind
  // first. The loop already asks the author to declare a size and WORKFLOW.md
  // says it is "for budget and slicing only", but nothing here read it, so the
  // declaration meant nothing. Scales combine by max rather than product — a
  // large high-impact change earns one widening, not two multiplied together.
  const SIZE_REQUEST_SCALE = { xs: 0.5, s: 1, m: 1.5, l: 2 };

  function budgetTargets(schema, impact, size) {
    const { requestBudgets, tokenBudgets } = policy().execution;
    // An unrecognized schema takes the standard lane deliberately: a spend
    // target is not an assurance gate, and refusing to compute one would strand
    // the change rather than protect anything.
    const lane = schema === "foundation-rapid" ? "rapid" : "standard";
    // Requests bind long before tokens on high-impact work (measured: 91% of
    // requests spent at 33% of tokens), so the request lane widens with the
    // declared impact. Tokens do not scale: they were never the limiter.
    const sizeScale = SIZE_REQUEST_SCALE[String(size || "").toLowerCase()] ?? 1;
    const scale = Math.max(impact === "high" ? 1.5 : 1, sizeScale);
    return {
      requests: Math.ceil((requestBudgets?.[lane] ?? (lane === "rapid" ? 100 : 200)) * scale),
      tokens: tokenBudgets[lane]
    };
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
      version: 3,
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
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function ensureBudgetState(state) {
    const existing = state.budget || {};
    // Targets are derived, never trusted from stored state: `change resolve
    // --impact high` arrives after the first window already exists, and policy
    // budgets can change between runs. Recomputing here is what lets a later
    // impact declaration actually widen the allowance.
    const targets = budgetTargets(state.schema, state.impact, state.size);
    if (existing.version !== 3 || !existing.lifetime || !existing.window) {
      const legacyRequests = knownNumber(existing.usedRequests)
        ? Number(existing.usedRequests) : null;
      // Version 2 counted cache reads as spend. Those totals do not mean the
      // same thing here, so they are dropped rather than carried forward; the
      // next telemetry sync recomputes them from the retained events.
      const legacyTokens = existing.version === 2 ? null
        : knownNumber(existing.usedTokens) ? Number(existing.usedTokens) : null;
      state.budget = {
        version: 3,
        measures: "input+output+cache-write; cache reads excluded",
        targetRequests: targets.requests,
        targetTokens: targets.tokens,
        usedRequests: legacyRequests,
        usedTokens: legacyTokens,
        measurement: existing.measurement || "unavailable-until-external-events",
        lifetime: { usedRequests: legacyRequests, usedTokens: legacyTokens },
        window: budgetWindow(`${state.id}:post-upgrade`, targets, {}, 1, "runtime-upgrade")
      };
    } else {
      state.budget.targetRequests = targets.requests;
      state.budget.targetTokens = targets.tokens;
      state.budget.lifetime.usedRequests = knownNumber(state.budget.lifetime.usedRequests)
        ? Number(state.budget.lifetime.usedRequests) : null;
      state.budget.lifetime.usedTokens = knownNumber(state.budget.lifetime.usedTokens)
        ? Number(state.budget.lifetime.usedTokens) : null;
      state.budget.usedRequests = state.budget.lifetime.usedRequests;
      state.budget.usedTokens = state.budget.lifetime.usedTokens;
      // Runtime v3 originally persisted numeric zero in a fresh window while
      // explicitly saying its measurement was unavailable. Heal that
      // contradictory state on read so an upgraded change does not keep
      // reporting invented usage forever.
      if (state.budget.measurement === "unavailable-until-external-events" &&
          state.budget.lifetime.usedRequests === null &&
          state.budget.lifetime.usedTokens === null &&
          Number(state.budget.window.usedRequests) === 0 &&
          Number(state.budget.window.usedTokens) === 0) {
        state.budget.window.usedRequests = null;
        state.budget.window.usedTokens = null;
      }
      // The active window follows the derived targets too — an impact declared
      // mid-change must widen the window the change is actually spending from,
      // not only the next one. An operator-continue window keeps the numbers
      // that were granted and audited; only unknown fields are filled there.
      if (state.budget.window.reason !== "operator-continue") {
        state.budget.window.targetRequests = targets.requests;
        state.budget.window.targetTokens = targets.tokens;
      } else {
        if (!knownNumber(state.budget.window.targetRequests))
          state.budget.window.targetRequests = targets.requests;
        if (!knownNumber(state.budget.window.targetTokens))
          state.budget.window.targetTokens = targets.tokens;
      }
    }
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
    const mode = operatorRequired ? "operator-required" :
      ratio >= 0.85 ? "completion-only" : ratio >= 0.7 ? "conserve" : "normal";
    const action = operatorRequired ? "OPERATOR_REQUIRED" :
      ratio >= 1 ? "COMPLETION_ONLY" : ratio >= 0.85 ? "COMPLETION_ONLY" :
        ratio >= 0.7 ? "BATCH_AND_REUSE" : "CONTINUE";
    const recommendation = operatorRequired ? "CONTINUE_OR_RESCOPE" :
      ratio >= 1 ? "STOP_AND_RESCOPE" : ratio >= 0.85 ? "STOP_EXPLORATION" :
        ratio >= 0.7 ? "BATCH_AND_REUSE" : "CONTINUE";
    return {
      ratio, measured, limiter, mode, action, recommendation,
      allowed: mode === "completion-only" ? [
        "focused-fix", "provider-run", "receipt-reuse", "proof-resume",
        "metrics", "land-recovery", "archive"
      ] : mode === "operator-required" ? [
        // An operator stop withholds *new* work, not the loop's own completion
        // path. `Required proof remains` is stated for this state too, and a
        // change that cannot run its providers or resume Land is stranded
        // rather than gated. What stays out is anything that would grow the
        // change while the operator is being asked whether to fund it.
        "packet", "readiness", "provider-run", "proof-resume", "receipt-reuse",
        "metrics", "land-recovery", "budget-continue", "archive"
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
    // Blowing through the one extra window an operator already funded is the
    // stop `activateBudgetWindow` carries across a run id — and nothing ever
    // raised it, so that carry-forward was unreachable and the protection its
    // comment describes never engaged. An exhausted run read `completion-only`,
    // which a caller-supplied `--run` reset to `normal` with a full fresh
    // allowance: the gate re-armed indefinitely, with no decision recorded.
    //
    // Only after the extension is spent. A first window that runs out is a
    // normal completion boundary, and a genuine host rollover still earns a
    // fresh one — that is what a new run id legitimately means.
    if (preliminary.ratio >= 1 && Number(window.extensionNumber || 0) >= 1)
      window.mode = "operator-required";
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
    eventTokenCount, budgetWindow, initialBudget, knownNumber, ensureBudgetState, eventUsage,
    activateBudgetWindow, budgetDecision, applyBudgetDecision, synchronizeBudgetUsage
  };
}
