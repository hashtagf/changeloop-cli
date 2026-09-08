import { parseSpecDocument } from "../contracts/change-artifacts.mjs";

const OPERATIONS = new Set(["added", "modified", "removed"]);
const AUTHORITY_CAPABILITIES = new Set(["review", "acceptance", "semantic-acceptance"]);
const PLACEHOLDER = /(?:replace-with|needs clarification|\btodo\b|\btbd\b|<[^>]+>)/i;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function unique(values) {
  return [...new Set(values)];
}

function placeholderIssue(value, label, issues) {
  if (PLACEHOLDER.test(text(value))) issues.push(`${label} contains unresolved placeholder text`);
}

function semanticScenarios(requirement) {
  const source = Array.isArray(requirement.scenarios)
    ? requirement.scenarios
    : requirement.scenario !== undefined ? [requirement.scenario] : [];
  return source.map((entry, index) => {
    const object = typeof entry === "string" ? { scenario: entry } : entry || {};
    const fallbackName = text(object.scenario) || text(object.when) ||
      `${text(requirement.key) || "scenario"}-${index + 1}`;
    return {
      key: text(object.key) || fallbackName,
      name: text(object.name) || fallbackName,
      when: text(object.when) || text(object.scenario),
      then: text(object.then) || text(object.outcome) || text(requirement.outcome),
      ...(text(object.kind) ? { kind: text(object.kind).toLowerCase() } : {})
    };
  });
}

function canonicalScenarioDetails(body) {
  const scenarios = [];
  let current = null;
  for (const line of String(body || "").split("\n")) {
    const heading = line.match(/^####\s+Scenario:\s*(.+?)\s*$/i);
    if (heading) {
      current = { key: heading[1], name: heading[1], when: "", then: "" };
      scenarios.push(current);
      continue;
    }
    if (!current) continue;
    const when = line.match(/^\s*-\s*\*\*WHEN\*\*\s+(.+?)\s*$/i);
    const then = line.match(/^\s*-\s*\*\*THEN\*\*\s+(.+?)\s*$/i);
    if (when) current.when = when[1];
    if (then) current.then = then[1];
  }
  return scenarios;
}

function mergeCanonicalScenarios(requirement, canonicalText, label, issues) {
  if (!canonicalText) {
    issues.push(`${label} is modified but canonical specification is unavailable`);
    return semanticScenarios(requirement);
  }
  const name = text(requirement?.requirement || requirement?.title) || text(requirement?.key);
  const current = parseSpecDocument(canonicalText).find((row) =>
    row.name.toLowerCase() === name.toLowerCase());
  if (!current) {
    issues.push(`${label} cannot find canonical requirement '${name}' to modify`);
    return semanticScenarios(requirement);
  }
  const canonical = canonicalScenarioDetails(current.body);
  const supplied = semanticScenarios(requirement);
  const suppliedByName = new Map(supplied.map((scenario) =>
    [scenario.name.toLowerCase(), scenario]));
  const merged = canonical.map((scenario) =>
    suppliedByName.get(scenario.name.toLowerCase()) || scenario);
  for (const scenario of supplied) {
    if (!canonical.some((row) => row.name.toLowerCase() === scenario.name.toLowerCase()))
      merged.push(scenario);
  }
  return merged;
}

function evidenceEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value));
}

function requiredIntegrationCapabilities(integration) {
  const concerns = new Set(stringList(integration.concerns).map((value) => value.toLowerCase()));
  const capabilities = ["integration"];
  if ([...concerns].some((value) =>
    /auth|credential|signature|webhook|secret|permission/.test(value)))
    capabilities.push("security-static");
  if ([...concerns].some((value) =>
    /retry|timeout|rate.limit|partial|degrad|recover/.test(value)))
    capabilities.push("resilience");
  if ([...concerns].some((value) =>
    /compat|version|schema|public.contract/.test(value)))
    capabilities.push("compatibility");
  return capabilities;
}

function semanticDraftIssues(source) {
  const issues = [];
  if (source?.version !== 3) issues.push("semantic draft requires version 3");
  if (!text(source?.intent)) issues.push("semantic draft requires non-empty 'intent'");
  if (!Array.isArray(source?.requirements) || source.requirements.length === 0)
    issues.push("semantic draft requires a non-empty 'requirements' array");
  if (!Array.isArray(source?.tasks) || source.tasks.length === 0)
    issues.push("semantic draft requires a non-empty 'tasks' array");
  if (!source?.evidence || typeof source.evidence !== "object" || Array.isArray(source.evidence))
    issues.push("semantic draft requires an 'evidence' object keyed by requirement key");
  if (source?.integrations !== undefined && !Array.isArray(source.integrations))
    issues.push("semantic draft integrations must be an array");
  if (source?.diagrams !== undefined && !Array.isArray(source.diagrams))
    issues.push("semantic draft diagrams must be an array");
  if (source?.decisions !== undefined && !Array.isArray(source.decisions))
    issues.push("semantic draft decisions must be an array");
  if (source?.risks !== undefined && !Array.isArray(source.risks))
    issues.push("semantic draft risks must be an array");
  if (source?.repositories !== undefined && !Array.isArray(source.repositories))
    issues.push("semantic draft repositories must be an array");
  if (source?.externalOperations !== undefined && !Array.isArray(source.externalOperations))
    issues.push("semantic draft externalOperations must be an array");
  if (source?.prototypeSelection !== undefined) {
    if (!text(source.prototypeSelection?.reference))
      issues.push("semantic draft prototypeSelection.reference is required");
    if (!text(source.prototypeSelection?.selected))
      issues.push("semantic draft prototypeSelection.selected is required");
  }
  placeholderIssue(source?.intent, "semantic draft intent", issues);
  for (const [index, decision] of (source?.decisions || []).entries()) {
    if (!text(decision?.key)) issues.push(`semantic draft decisions[${index}].key is required`);
    if (!text(decision?.choice)) issues.push(`semantic draft decisions[${index}].choice is required`);
    if (!text(decision?.reason || decision?.why))
      issues.push(`semantic draft decisions[${index}].reason is required`);
  }
  const choices = new Map();
  for (const decision of source?.decisions || []) {
    const key = text(decision?.key);
    const choice = text(decision?.choice);
    if (!key) continue;
    if (choices.has(key) && choices.get(key) !== choice)
      issues.push(`semantic draft has contradictory decisions for '${key}'`);
    else if (choices.has(key)) issues.push(`semantic draft decision key '${key}' is duplicated`);
    choices.set(key, choice);
  }
  return issues;
}

function normalizeRequirements(source, slugify, issues, { loadCanonicalSpec = null } = {}) {
  const evidence = evidenceEntries(source.evidence);
  const requirements = [];
  const requirementKeys = new Set();
  const claimIds = new Set();
  const knownRequirementKeys = new Set((source.requirements || []).map((row) => text(row?.key)));
  for (const evidenceKey of evidence.keys())
    if (!knownRequirementKeys.has(evidenceKey))
      issues.push(`semantic draft evidence references unknown requirement '${evidenceKey}'`);

  for (const [index, requirement] of (source.requirements || []).entries()) {
    const label = `semantic draft requirements[${index}]`;
    const key = text(requirement?.key);
    if (!key) issues.push(`${label}.key is required`);
    else if (requirementKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    requirementKeys.add(key);
    const capability = text(requirement?.capability);
    if (!capability) issues.push(`${label}.capability is required`);
    const operation = text(requirement?.operation || "added").toLowerCase();
    if (!OPERATIONS.has(operation))
      issues.push(`${label}.operation must be added|modified|removed`);
    const outcome = text(requirement?.outcome);
    if (!outcome && operation !== "removed") issues.push(`${label}.outcome is required`);
    const scenarios = operation === "modified"
      ? mergeCanonicalScenarios(requirement,
        loadCanonicalSpec ? loadCanonicalSpec(capability) : null, label, issues)
      : semanticScenarios(requirement);
    if (!scenarios.length && operation !== "removed")
      issues.push(`${label}.scenario or .scenarios is required`);
    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      for (const field of ["name", "when", "then"])
        if (!scenario[field]) issues.push(`${label}.scenarios[${scenarioIndex}].${field} is required`);
    }
    if (operation === "removed" && !text(requirement?.migration))
      issues.push(`${label}.migration is required for removed requirements`);
    placeholderIssue(key, `${label}.key`, issues);
    placeholderIssue(capability, `${label}.capability`, issues);
    placeholderIssue(outcome, `${label}.outcome`, issues);

    const evidenceValue = evidence.get(key);
    const capabilities = unique([
      ...stringList(evidenceValue?.capabilities),
      ...stringList(requirement?.capabilities)
    ]);
    if (!evidenceValue && !requirement?.capabilities)
      issues.push(`${label} requires evidence['${key}'].capabilities`);
    if (!capabilities.length)
      issues.push(`${label} requires at least one evidence capability`);

    const repositories = unique(stringList(requirement?.repositories));
    if (repositories.length > 1 && !capabilities.includes("cross-repo-contract"))
      capabilities.push("cross-repo-contract");
    const scenarioClaims = scenarios.map((scenario, scenarioIndex) => {
      const id = slugify(scenarios.length === 1
        ? key : `${key}-${scenario.key || scenarioIndex + 1}`);
      if (!id) issues.push(`${label} cannot derive a stable claim ID`);
      else if (claimIds.has(id)) issues.push(`${label} derives duplicate claim ID '${id}'`);
      claimIds.add(id);
      return {
        id,
        requirementKey: key,
        scenario: scenario.name,
        impact: text(evidenceValue?.impact || requirement?.impact || source.impact || "low"),
        capabilities,
        ...(repositories.length ? { repositories } : {})
      };
    });
    requirements.push({
      key,
      claimIds: scenarioClaims.map((claim) => claim.id),
      claims: scenarioClaims,
      spec: {
        name: capability,
        operation,
        requirement: text(requirement?.requirement || requirement?.title) || key,
        description: text(requirement?.description) ||
          (outcome ? `The system SHALL ${outcome.replace(/[.]$/, "")}.` : ""),
        scenarios,
        ...(operation === "removed" ? { migration: text(requirement.migration) } : {})
      }
    });
  }
  return { requirements, requirementKeys };
}

function applyIntegrationRequirements(source, requirements, requirementKeys, issues) {
  const byKey = new Map(requirements.map((row) => [row.key, row]));
  for (const [index, integration] of (source.integrations || []).entries()) {
    const label = `semantic draft integrations[${index}]`;
    if (!text(integration?.key)) issues.push(`${label}.key is required`);
    if (!text(integration?.kind)) issues.push(`${label}.kind is required`);
    if (!text(integration?.documentation?.source))
      issues.push(`${label}.documentation.source is required`);
    if (!text(integration?.documentation?.version))
      issues.push(`${label}.documentation.version is required`);
    if (!Array.isArray(integration?.concerns) || !stringList(integration.concerns).length)
      issues.push(`${label}.concerns must name the integration risks to cover`);
    const relatesTo = stringList(integration?.relatesTo);
    if (!relatesTo.length) issues.push(`${label}.relatesTo must name at least one requirement`);
    const unknown = relatesTo.filter((key) => !requirementKeys.has(key));
    if (unknown.length) issues.push(`${label}.relatesTo references unknown requirement(s): ${unknown.join(", ")}`);
    const relatedScenarios = relatesTo.flatMap((key) => byKey.get(key)?.spec?.scenarios || []);
    for (const scenarioKind of ["success", "failure"])
      if (!relatedScenarios.some((scenario) => scenario.kind === scenarioKind))
        issues.push(`${label} requires a related scenario with kind '${scenarioKind}'`);
    const capabilities = requiredIntegrationCapabilities(integration);
    for (const key of relatesTo) {
      const requirement = byKey.get(key);
      if (!requirement) continue;
      for (const claim of requirement.claims)
        claim.capabilities = unique([...claim.capabilities, ...capabilities]);
    }
  }
}

function normalizeTasks(source, requirements, requirementKeys, issues) {
  const claimsByRequirement = new Map(requirements.map((row) => [row.key, row.claimIds]));
  const taskIds = new Map();
  for (const [index, task] of (source.tasks || []).entries()) {
    const key = text(task?.key) || `task-${index + 1}`;
    const id = text(task?.id) || `T${String(index + 1).padStart(3, "0")}`;
    if (taskIds.has(key)) issues.push(`semantic draft tasks[${index}].key '${key}' is duplicated`);
    if ([...taskIds.values()].includes(id)) issues.push(`semantic draft tasks[${index}].id '${id}' is duplicated`);
    taskIds.set(key, id);
    placeholderIssue(key, `semantic draft tasks[${index}].key`, issues);
  }

  const covered = new Set();
  const tasks = (source.tasks || []).map((task, index) => {
    const label = `semantic draft tasks[${index}]`;
    const key = text(task?.key) || `task-${index + 1}`;
    const covers = stringList(task?.covers);
    if (!text(task?.outcome)) issues.push(`${label}.outcome is required`);
    if (!text(task?.verify)) issues.push(`${label}.verify is required`);
    if (!covers.length) issues.push(`${label}.covers must name at least one requirement`);
    const unknown = covers.filter((value) => !requirementKeys.has(value));
    if (unknown.length) issues.push(`${label}.covers references unknown requirement(s): ${unknown.join(", ")}`);
    covers.forEach((value) => covered.add(value));
    const dependencyKeys = stringList(task?.dependsOn);
    const unknownDependencies = dependencyKeys.filter((value) => !taskIds.has(value));
    if (unknownDependencies.length)
      issues.push(`${label}.dependsOn references unknown task(s): ${unknownDependencies.join(", ")}`);
    const dependsOn = dependencyKeys.map((value) => taskIds.get(value)).filter(Boolean);
    placeholderIssue(task?.outcome, `${label}.outcome`, issues);
    placeholderIssue(task?.verify, `${label}.verify`, issues);
    return {
      id: taskIds.get(key),
      semanticKey: key,
      outcome: text(task?.outcome),
      verify: text(task?.verify),
      repository: text(task?.repository) || undefined,
      kind: text(task?.kind) || "implementation",
      paths: stringList(task?.paths),
      dependsOn,
      resources: stringList(task?.resources),
      claims: unique(covers.flatMap((value) => claimsByRequirement.get(value) || [])),
      requestedModel: text(task?.requestedModel || task?.model) || undefined,
      inputSchema: text(task?.inputSchema) || undefined,
      outputSchema: text(task?.outputSchema) || undefined
    };
  });
  const uncovered = [...requirementKeys].filter((key) => !covered.has(key));
  if (uncovered.length)
    issues.push(`semantic draft requirements have no implementation task: ${uncovered.join(", ")}`);
  const graph = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((graph.get(id) || []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (tasks.some((task) => visit(task.id)))
    issues.push("semantic draft task dependencies contain a cycle");
  return tasks;
}

function derivedExecution(source, claims, tasks) {
  if (source.execution) return source.execution;
  const commands = unique(tasks.map((task) => task.verify).filter(Boolean));
  const command = commands.length === 1
    ? ["sh", "-lc", commands[0]]
    : ["sh", "-lc", commands.map((value) => `(${value})`).join(" && ")];
  const capabilities = unique(claims.flatMap((claim) => claim.capabilities));
  const providers = {};
  for (const capability of capabilities) {
    if (capability === "discovery") continue;
    if (AUTHORITY_CAPABILITIES.has(capability)) {
      providers[capability] = { adapter: "external", capability, claims: "declared" };
      continue;
    }
    providers[capability] = capability === "test"
      ? {
          adapter: "test-discovery", command, minimum: 1,
          reportFormat: "auto", claims: "declared"
        }
      : { adapter: "command", capability, command, claims: "declared" };
  }
  return { version: 1, providers, services: {} };
}

export function normalizeSemanticDraft(source, slugify, options = {}) {
  const issues = semanticDraftIssues(source);
  const { requirements, requirementKeys } = normalizeRequirements(
    source, slugify, issues, options);
  applyIntegrationRequirements(source, requirements, requirementKeys, issues);
  const tasks = normalizeTasks(source, requirements, requirementKeys, issues);
  const claims = requirements.flatMap((row) => row.claims);
  const acceptance = source.acceptance || { required: false, reason: null, claimIds: [] };
  const acceptanceRequirements = stringList(acceptance.requirements);
  const acceptanceClaimIds = acceptanceRequirements.flatMap((key) => {
    const row = requirements.find((requirement) => requirement.key === key);
    if (!row) issues.push(`semantic draft acceptance references unknown requirement '${key}'`);
    return row?.claimIds || [];
  });
  const securityTriggers = unique([
    ...stringList(source.securityTriggers),
    ...(source.integrations || []).flatMap((integration) =>
      requiredIntegrationCapabilities(integration).includes("security-static")
        ? ["external-integration-authentication"] : [])
  ]);
  const draft = {
    ...source,
    _semanticVersion: 3,
    _derivedExecution: !source.execution,
    why: text(source.why) || text(source.intent),
    currentState: text(source.currentState) || "none",
    compatibility: text(source.compatibility) || "none",
    changes: stringList(source.changes).length
      ? stringList(source.changes)
      : unique(requirements.map((row) => row.spec.scenarios[0]?.then).filter(Boolean)),
    nonGoals: stringList(source.nonGoals),
    decisions: Array.isArray(source.decisions) ? source.decisions : [],
    risks: Array.isArray(source.risks) ? source.risks : [],
    domainLanguage: Array.isArray(source.domainLanguage) ? source.domainLanguage : [],
    impact: text(source.impact) || "low",
    coupling: text(source.coupling) || "isolated",
    securityTriggers,
    acceptance: {
      required: Boolean(acceptance.required),
      reason: acceptance.required ? text(acceptance.reason) : null,
      claimIds: unique([
        ...stringList(acceptance.claimIds),
        ...acceptanceClaimIds
      ])
    },
    tasks,
    claims,
    specs: requirements.map((row) => row.spec),
    execution: derivedExecution(source, claims, tasks),
    externalOperations: Array.isArray(source.externalOperations)
      ? source.externalOperations : undefined,
    repositories: Array.isArray(source.repositories) ? source.repositories : undefined
  };
  return { draft, issues };
}

export function semanticDraftTemplate() {
  return {
    version: 3,
    intent: "Describe one observable outcome",
    why: "Explain the concrete user or system value",
    impact: "low",
    coupling: "isolated",
    requirements: [{
      key: "observable-outcome",
      capability: "change",
      operation: "added",
      scenario: "Describe the bounded input or event",
      outcome: "Describe the observable result"
    }],
    tasks: [{
      key: "implement-outcome",
      outcome: "Implement and verify the bounded outcome",
      covers: ["observable-outcome"],
      paths: ["src/**"],
      verify: "npm test"
    }],
    evidence: {
      "observable-outcome": { capabilities: ["test"] }
    }
  };
}
