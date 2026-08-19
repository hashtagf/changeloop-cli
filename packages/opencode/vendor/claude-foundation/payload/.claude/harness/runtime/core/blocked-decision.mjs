// A terminal stop is only honest if it also says how to leave it. Readiness
// already answers "what now?" for every non-ready proof state; the guards that
// end a run outright used to answer it with a bare refusal, which reads to a
// user as a dead end even when three real exits exist. Every such guard emits
// this envelope instead, in the shape readiness recovery already uses, so the
// agent translates options into the user's language rather than pasting a
// refusal string.
//
// The invariants below are enforced here rather than reviewed per call site:
// a stop that offers one option is not a decision, and a stop without `pause`
// pressures the user into acting before they understand the state.
export function createBlockedDecision({ fail }) {
  function assertDecision(code, decision) {
    const options = decision?.options || [];
    if (!decision?.kind || !decision?.summary)
      throw new Error(`blocked decision '${code}' requires a kind and a summary`);
    if (options.length < 2)
      throw new Error(`blocked decision '${code}' requires at least two options`);
    if (!options.every((option) => option?.id && option?.outcome))
      throw new Error(`blocked decision '${code}' requires an id and an outcome per option`);
    const ids = options.map((option) => option.id);
    if (new Set(ids).size !== ids.length)
      throw new Error(`blocked decision '${code}' repeats an option id`);
    if (!ids.includes("pause"))
      throw new Error(`blocked decision '${code}' must preserve a 'pause' outcome`);
    if (!ids.includes(decision.recommended))
      throw new Error(`blocked decision '${code}' recommends an option it does not offer`);
    if (decision.automaticRecovery && !ids.includes(decision.automaticRecovery))
      throw new Error(`blocked decision '${code}' names an automatic recovery it does not offer`);
    if (decision.automaticRecovery && decision.automaticRecovery !== decision.recommended)
      throw new Error(`blocked decision '${code}' must recommend its automatic recovery`);
    return decision;
  }

  function blockedDecisionValue(changeId, code, decision) {
    const validatedDecision = assertDecision(code, decision);
    return {
      version: 1,
      changeId: changeId || null,
      status: "BLOCKED",
      // Hosts must not turn deterministic recovery into a user interview.
      // Additive metadata keeps the decision envelope machine-readable while
      // letting every adapter apply the same human-interaction boundary.
      userActionRequired: !validatedDecision.automaticRecovery,
      code,
      decision: validatedDecision
    };
  }

  // The JSON goes to stdout so it joins the readiness/plan protocol stream; the
  // one-line refusal still goes through `fail` so existing BLOCKED handling and
  // exit codes are unchanged.
  function blockWithDecision(changeId, code, decision) {
    const value = blockedDecisionValue(changeId, code, decision);
    console.log(JSON.stringify(value, null, 2));
    fail(`${decision.summary} [${code}]`);
  }

  return { blockedDecisionValue, blockWithDecision };
}
