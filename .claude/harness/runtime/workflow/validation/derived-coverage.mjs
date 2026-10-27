import { isSemanticV4Plus } from "./draft-version.mjs";

// Discovery coverage the draft already states. A risk-required dimension the
// agent did not author is settled as `covered` when real draft content backs
// it, so the agent writes a coverage row only for a user decision, an
// investigation, or a rationale the draft cannot imply. No content, no row:
// the dimension stays missing (fail closed). An authored row always wins.

const DERIVED = new WeakSet();

// Only rows this module created are derived; a `derived` flag in a draft is
// ignored, so an agent cannot mark its own row as harness-derived.
export function isDerivedCoverage(row) {
  return Boolean(row && typeof row === "object" && DERIVED.has(row));
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function rows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
}

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" && value.trim() !== "";
}

function meaningful(value) {
  return text(value) !== "" && !/^`?none`?[.]?$/i.test(text(value));
}

function liveRequirements(source) {
  return rows(source.requirements).filter((row) =>
    text(row.key) && text(row.operation || "added").toLowerCase() !== "removed");
}

function scenarios(requirement) {
  const list = Array.isArray(requirement.scenarios) ? requirement.scenarios
    : requirement.scenario !== undefined ? [requirement.scenario] : [];
  return list.filter((row) => row && typeof row === "object");
}

function keysWithScenario(source, kind) {
  return liveRequirements(source).filter((requirement) => scenarios(requirement).some((row) =>
    text(row.kind).toLowerCase() === kind && text(row.when || row.scenario) &&
    text(row.then || row.outcome))).map((requirement) => text(requirement.key));
}

function every(list, fields) {
  return list.length > 0 && list.every((row) => fields.every((field) => present(row[field])));
}

function result(covers, from) {
  return from.length ? { covers: [...new Set(covers)], from } : null;
}

function storyText(story) {
  return typeof story === "string" ? text(story)
    : text(story?.story) || (text(story?.asA) && text(story?.iWant) ? text(story.asA) : "");
}

// Dimension → the draft content that already answers it.
const RULES = {
  "current-behavior": (source) => meaningful(source.currentState) ? result([], ["currentState"]) : null,
  "affected-actor": (source) => {
    const stories = (Array.isArray(source.userStories) ? source.userStories : []).filter(storyText);
    return stories.length
      ? result(stories.flatMap((story) => strings(story?.covers)), ["userStories"]) : null;
  },
  "desired-behavior": (source) => {
    const keys = liveRequirements(source).filter((requirement) =>
      (text(requirement.description) || text(requirement.outcome)) && scenarios(requirement).length)
      .map((requirement) => text(requirement.key));
    return keys.length ? result(keys, ["requirements"]) : null;
  },
  "success-path": (source) => {
    const keys = keysWithScenario(source, "success");
    return keys.length ? result(keys, ["requirements[].scenarios kind:success"]) : null;
  },
  "failure-path": (source) => {
    const keys = keysWithScenario(source, "failure");
    const matrix = rows(source.failureMatrix).filter((row) => text(row.failure) && text(row.userSees));
    return result([...keys, ...matrix.flatMap((row) => strings(row.covers))], [
      ...(keys.length ? ["requirements[].scenarios kind:failure"] : []),
      ...(matrix.length ? ["failureMatrix"] : [])
    ]);
  },
  "input-boundary": (source) => {
    const keys = keysWithScenario(source, "boundary");
    const contracts = rows(source.apiContracts);
    return result(keys, [
      ...(keys.length ? ["requirements[].scenarios kind:boundary"] : []),
      ...(every(contracts, ["request", "errors"]) ? ["apiContracts"] : [])
    ]);
  },
  compatibility: (source) => meaningful(source.compatibility) ? result([], ["compatibility"]) : null,
  "non-goals": (source) => strings(source.nonGoals).length ? result([], ["nonGoals"]) : null,
  // Every live requirement needs a covering task that runs a check and a
  // declared evidence capability; a partly verified change is not covered.
  verification: (source) => {
    const live = liveRequirements(source);
    const evidence = source.evidence && typeof source.evidence === "object" ? source.evidence : {};
    const verified = (key) => rows(source.tasks).some((task) =>
      text(task.verify) && strings(task.covers).includes(key));
    const proven = (requirement) => strings(evidence[text(requirement.key)]?.capabilities).length ||
      strings(requirement.capabilities).length;
    return live.length && live.every((requirement) =>
      verified(text(requirement.key)) && proven(requirement))
      ? result(live.map((requirement) => text(requirement.key)), ["tasks[].verify", "evidence"])
      : null;
  },
  // A scenario tagged `access: deny` states the refusal itself.
  "permission-rejection": (source) => {
    const keys = liveRequirements(source).filter((requirement) => scenarios(requirement).some((row) =>
      text(row.access).toLowerCase() === "deny")).map((requirement) => text(requirement.key));
    return keys.length ? result(keys, ["requirements[].scenarios access:deny"]) : null;
  },
  "data-migration": (source) =>
    every(rows(source.dataModel), ["migration"]) ? result([], ["dataModel[].migration"]) : null,
  "rollout-rollback": (source) =>
    every(rows(source.dataModel), ["rollback"]) ? result([], ["dataModel[].rollback"]) : null,
  "integration-contract": (source) => {
    const integrations = rows(source.integrations);
    return integrations.length && integrations.every((row) => text(row.documentation?.source) &&
      text(row.documentation?.version) && strings(row.relatesTo).length)
      ? result(integrations.flatMap((row) => strings(row.relatesTo)), ["integrations"]) : null;
  },
  "timeout-retry-idempotency": (source) => {
    const integrations = rows(source.integrations);
    const named = integrations.length && integrations.every((row) =>
      strings(row.concerns).some((concern) => /retry|timeout|idempot/i.test(concern)));
    const jobs = every(rows(source.jobContract), ["retry", "timeout", "idempotency"]);
    return result(named ? integrations.flatMap((row) => strings(row.relatesTo)) : [], [
      ...(named ? ["integrations[].concerns"] : []), ...(jobs ? ["jobContract"] : [])
    ]);
  },
  accessibility: (source) =>
    every(rows(source.uiStates), ["accessibility"]) ? result([], ["uiStates[].accessibility"]) : null
};

export function deriveDiscoveryCoverage(source, requiredDimensions = []) {
  if (!isSemanticV4Plus(source?.version)) return source;
  const discovery = source.discovery === undefined ? {} : source.discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery)) return source;
  const coverage = discovery.coverage === undefined ? [] : discovery.coverage;
  if (!Array.isArray(coverage)) return source;
  const authored = new Set(coverage.map((row) => text(row?.dimension).toLowerCase()));
  const known = new Set(rows(source.requirements).map((row) => text(row.key)).filter(Boolean));
  const derived = [];
  for (const dimension of requiredDimensions) {
    if (authored.has(dimension) || !RULES[dimension]) continue;
    const found = RULES[dimension](source);
    if (!found) continue;
    const row = {
      dimension, status: "covered",
      covers: found.covers.filter((key) => known.has(key)), derivedFrom: found.from
    };
    DERIVED.add(row);
    derived.push(row);
    authored.add(dimension);
  }
  return derived.length
    ? { ...source, discovery: { ...discovery, coverage: [...coverage, ...derived] } }
    : source;
}
