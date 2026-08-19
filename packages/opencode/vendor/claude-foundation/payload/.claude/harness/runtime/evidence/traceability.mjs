export function normalizedTraceLabel(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function auditTraceability({
  id, state, contract, tasks, scenarios = [], configuredCapabilities = []
}) {
  const findings = [];
  const capabilitySet = new Set(configuredCapabilities);
  const claimById = new Map(contract.claims.map((claim) => [claim.id, claim]));
  const tasksByClaim = new Map(contract.claims.map((claim) => [claim.id, []]));

  for (const task of tasks)
    for (const claim of task.claims)
      if (tasksByClaim.has(claim)) tasksByClaim.get(claim).push(task.id);

  for (const task of tasks) {
    if (!task.claims.length)
      findings.push({
        level: "warning", code: "task-without-claim", taskId: task.id,
        message: `task '${task.id}' has no [claims:<ids>] traceability annotation`
      });
    for (const claim of task.claims)
      if (!claimById.has(claim))
        findings.push({
          level: "error", code: "unknown-task-claim", taskId: task.id,
          claimId: claim, message: `task '${task.id}' references unknown claim '${claim}'`
        });
  }

  for (const claim of contract.claims) {
    if (!(tasksByClaim.get(claim.id) || []).length)
      findings.push({
        level: "warning", code: "claim-without-task", claimId: claim.id,
        message: `claim '${claim.id}' is not linked from an implementation task`
      });
    for (const capability of claim.capabilities)
      if (!capabilitySet.has(capability) && !["review", "acceptance"].includes(capability))
        findings.push({
          level: "warning", code: "claim-without-provider", claimId: claim.id,
          capability, message: `claim '${claim.id}' has no configured '${capability}' provider`
        });
  }

  if (scenarios.length) {
    const claimLabels = contract.claims.map((claim) => ({
      id: claim.id,
      labels: new Set([normalizedTraceLabel(claim.id), normalizedTraceLabel(claim.scenario)])
    }));
    for (const scenario of scenarios)
      if (!claimLabels.some((claim) => claim.labels.has(scenario.key)))
        findings.push({
          level: "warning", code: "scenario-without-claim",
          scenario: scenario.name, path: scenario.path,
          normalized: scenario.key,
          rule: "a scenario matches when its name, lowercased with runs of " +
            "non-alphanumerics collapsed to single spaces, equals a claim id " +
            "or that claim's full scenario sentence",
          // Naming the normalized form and the rule is the difference between
          // a warning someone can act on and one they learn to scroll past.
          message: `scenario '${scenario.name}' has no exact claim mapping; ` +
            `it normalizes to '${scenario.key}', which equals no claim id or ` +
            "claim scenario"
        });
  }

  if ((state.securityTriggers || []).length > 0 && !contract.claims.some((claim) =>
    /(?:cannot|denied|reject|unauthor|forbid|invalid|another user|cross.user)/i
      .test(`${claim.id} ${claim.scenario}`)))
    findings.push({
      level: "warning", code: "security-negative-path-missing",
      message: "security-sensitive change has no explicit negative-path claim"
    });

  if (contract.claims.some((claim) => claim.capabilities.includes("data-migration")) &&
      !contract.claims.some((claim) => /rollback|integrity|backward|recover/i
        .test(`${claim.id} ${claim.scenario}`)))
    findings.push({
      level: "warning", code: "migration-recovery-claim-missing",
      message: "migration change has no explicit rollback, recovery, or integrity claim"
    });

  const errors = findings.filter((finding) => finding.level === "error").length;
  const warnings = findings.filter((finding) => finding.level === "warning").length;
  return {
    version: 1, changeId: id, schema: state.schema,
    status: errors ? "error" : warnings ? "warning" : "pass",
    summary: {
      scenarios: scenarios.length, claims: contract.claims.length, tasks: tasks.length,
      linkedTasks: tasks.filter((task) => task.claims.length).length,
      linkedClaims: [...tasksByClaim.values()].filter((rows) => rows.length).length,
      configuredProviders: Object.keys(contract.providers || {}).length,
      errors, warnings
    },
    scenarios,
    claims: contract.claims.map((claim) => ({
      id: claim.id, taskIds: tasksByClaim.get(claim.id) || [],
      capabilities: claim.capabilities
    })),
    findings
  };
}
