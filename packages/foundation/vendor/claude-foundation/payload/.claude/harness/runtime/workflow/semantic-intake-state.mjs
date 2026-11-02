import { createHash } from "node:crypto";
import { sortedJson } from "../core/trust.mjs";

export const SEMANTIC_INTAKE_STATE_VERSION = 2;
const SUPPORTED_STATE_VERSIONS = new Set([1, SEMANTIC_INTAKE_STATE_VERSION]);

const ACTIONS = new Set(["EDIT", "ASK_USER", "DONE"]);
const OWNERS = new Set(["agent", "user", "harness"]);
const SHA256 = /^[a-f0-9]{64}$/;
const INVENTORY_DIGEST = /^sha256:[a-f0-9]{64}$/;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function jsonValue(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not JSON-serializable");
    return JSON.parse(serialized);
  } catch (error) {
    throw new Error(`${label} must be JSON-serializable: ${error.message}`);
  }
}

function digest(value, domain) {
  return createHash("sha256").update(`${domain}\0`)
    .update(sortedJson(jsonValue(value, domain))).digest("hex");
}

export function semanticDraftDigest(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft))
    throw new Error("semantic intake draft must be an object");
  return digest(draft, "foundation-semantic-draft:1");
}

function actionSnapshot(action, resumeRoute) {
  if (!action || typeof action !== "object" || Array.isArray(action))
    throw new Error("semantic intake action must be an object");
  if (!ACTIONS.has(action.action))
    throw new Error(`semantic intake cannot persist action '${action.action || "(missing)"}'`);
  if (!OWNERS.has(action.owner))
    throw new Error("semantic intake action requires an agent, user, or harness owner");
  if (action.action === "EDIT" && action.owner !== "agent")
    throw new Error("semantic intake EDIT actions belong to the agent");
  if (action.action === "ASK_USER" && action.owner !== "user")
    throw new Error("semantic intake ASK_USER actions belong to the user");
  if (action.action === "DONE" && action.owner !== "harness")
    throw new Error("semantic intake DONE actions belong to the harness");

  const actionRoute = text(action.resume);
  if (actionRoute && actionRoute !== resumeRoute)
    throw new Error("semantic intake action resume route does not match the persisted route");
  // Persist the protocol fields needed to resume this one action. Deliberately
  // do not spread the caller object: transcripts, prompts, and other ambient
  // session data are not semantic intake state.
  const snapshot = jsonValue({
    ...(action.outcomeVersion === undefined ? {} : { outcomeVersion: action.outcomeVersion }),
    action: action.action,
    owner: action.owner,
    boundary: action.boundary || null,
    reason: action.reason || null,
    ...(action.reached === undefined ? {} : { reached: action.reached }),
    ...(action.intake === undefined ? {} : { intake: action.intake }),
    ...(action.decision === undefined ? {} : { decision: action.decision }),
    resume: resumeRoute
  }, "semantic intake action");
  const items = action.action === "ASK_USER" && Array.isArray(snapshot.decision?.items)
    ? snapshot.decision.items : [];
  if (items.length > 3)
    throw new Error("semantic intake decision frontier cannot exceed three items");
  const frontier = items.map((item, index) => {
    const key = text(item?.key);
    if (!key) throw new Error(`semantic intake decision frontier item ${index} requires a key`);
    return key;
  });
  if (new Set(frontier).size !== frontier.length)
    throw new Error("semantic intake decision frontier keys must be unique");
  return { snapshot, frontier };
}

export function semanticIntakeStateIssues(state) {
  const issues = [];
  if (!state || typeof state !== "object" || Array.isArray(state))
    return ["semantic intake state must be an object"];
  if (!SUPPORTED_STATE_VERSIONS.has(state.version))
    issues.push(`semantic intake state version must be 1 or ${SEMANTIC_INTAKE_STATE_VERSION}`);
  if (state.kind !== "semantic-intake")
    issues.push("semantic intake state kind must be 'semantic-intake'");
  if (!Number.isInteger(state.revision) || state.revision < 1)
    issues.push("semantic intake state revision must be a positive integer");
  if (!SHA256.test(state.draftDigest || ""))
    issues.push("semantic intake state draftDigest must be a SHA-256 digest");
  if (!["current", "stale"].includes(state.status))
    issues.push("semantic intake state status must be current|stale");
  if (!text(state.resumeRoute))
    issues.push("semantic intake state requires an exact resume route");
  if (state.sourceInventory !== undefined && state.sourceInventory !== null &&
      (state.sourceInventory?.version !== 1 ||
       !INVENTORY_DIGEST.test(state.sourceInventory?.digest || "") ||
       !Array.isArray(state.sourceInventory?.sources)))
    issues.push("semantic intake state sourceInventory must be a version-1 SHA-256 inventory");
  if (state.version === SEMANTIC_INTAKE_STATE_VERSION &&
      (!state.effectiveness || state.effectiveness.version !== 1 ||
       !state.effectiveness.history || state.effectiveness.history.observed !== true))
    issues.push("semantic intake state v2 requires measured effectiveness history");
  if (!Array.isArray(state.frontier) || state.frontier.length > 3 ||
      state.frontier.some((key) => !text(key)) ||
      new Set(state.frontier).size !== state.frontier.length)
    issues.push("semantic intake state frontier must contain at most three unique keys");
  if (state.status === "current") {
    if (!state.lastAction || typeof state.lastAction !== "object")
      issues.push("current semantic intake state requires lastAction");
    else {
      try {
        const projected = actionSnapshot(state.lastAction, text(state.resumeRoute));
        if (JSON.stringify(projected.frontier) !== JSON.stringify(state.frontier))
          issues.push("current semantic intake state frontier does not match lastAction");
      } catch (error) {
        issues.push(error.message);
      }
    }
  }
  if (state.status === "stale" && (state.lastAction !== null || state.frontier?.length))
    issues.push("stale semantic intake state must clear lastAction and frontier");
  return issues;
}

function validState(state) {
  return semanticIntakeStateIssues(state).length === 0;
}

function invalidatedIdentity(previous) {
  if (!validState(previous)) return null;
  const action = previous.lastAction;
  return {
    reason: "draft-changed",
    draftDigest: previous.draftDigest,
    action: action?.action || null,
    actionDigest: action ? digest(action, "foundation-semantic-intake-action:1") : null
  };
}

// This reducer owns one recoverable snapshot, not an append-only interaction
// ledger. Calling it without an action records draft movement and makes a stale
// ASK_USER/EDIT result impossible to replay. Calling it with an action records
// the newly inspected frontier against the exact draft bytes and resume route.
export function reduceSemanticIntakeState(previous, {
  draft, action = null, resumeRoute, sourceInventory = null, effectiveness = null
} = {}) {
  const route = text(resumeRoute || action?.resume);
  if (!route) throw new Error("semantic intake state requires an exact resume route");
  const draftDigest = semanticDraftDigest(draft);
  const prior = validState(previous) ? previous : null;
  const revision = (prior?.revision || 0) + 1;
  const changed = Boolean(prior && prior.draftDigest !== draftDigest);

  if (!action) {
    if (prior && !changed && prior.resumeRoute === route)
      return jsonValue(prior, "semantic intake state");
    const state = {
      version: SEMANTIC_INTAKE_STATE_VERSION,
      kind: "semantic-intake",
      revision,
      draftDigest,
      status: "stale",
      resumeRoute: route,
      lastAction: null,
      frontier: [],
      sourceInventory: sourceInventory === null
        ? prior?.sourceInventory || null
        : jsonValue(sourceInventory, "semantic source inventory"),
      effectiveness: prior?.effectiveness || {
        version: 1,
        history: {
          observed: true, inspections: 0, questionRounds: 0,
          sourceRefreshes: 0, draftRepairs: 0
        }
      },
      invalidated: changed ? invalidatedIdentity(prior) : null
    };
    return state;
  }

  const { snapshot, frontier } = actionSnapshot(action, route);
  const sameAction = Boolean(prior && !changed && prior.status === "current" &&
    digest(snapshot, "foundation-semantic-intake-action:1") ===
      digest(prior.lastAction, "foundation-semantic-intake-action:1") &&
    JSON.stringify(frontier) === JSON.stringify(prior.frontier) &&
    prior.resumeRoute === route &&
    (sourceInventory === null || sourceInventory?.digest === prior.sourceInventory?.digest));
  if (sameAction && prior.version === SEMANTIC_INTAKE_STATE_VERSION)
    return jsonValue(prior, "semantic intake state");
  const priorHistory = prior?.effectiveness?.history || {};
  const history = {
    observed: true,
    inspections: Number(priorHistory.inspections || 0) + 1,
    questionRounds: Number(priorHistory.questionRounds || 0) +
      (action.action === "ASK_USER" ? 1 : 0),
    sourceRefreshes: Number(priorHistory.sourceRefreshes || 0) +
      (action.intake?.kind === "refresh-source-coverage" ? 1 : 0),
    draftRepairs: Number(priorHistory.draftRepairs || 0) +
      (action.intake?.kind === "repair-draft" ? 1 : 0)
  };
  const state = {
    version: SEMANTIC_INTAKE_STATE_VERSION,
    kind: "semantic-intake",
    revision,
    draftDigest,
    status: "current",
    resumeRoute: route,
    lastAction: snapshot,
    frontier,
    sourceInventory: sourceInventory === null
      ? prior?.sourceInventory || null
      : jsonValue(sourceInventory, "semantic source inventory"),
    effectiveness: {
      ...(effectiveness ? jsonValue(effectiveness, "semantic intake effectiveness") :
        prior?.effectiveness || { version: 1 }),
      version: 1,
      history
    },
    invalidated: changed ? invalidatedIdentity(prior) :
      (prior?.status === "stale" ? prior.invalidated || null : null)
  };
  return state;
}

export function semanticIntakeResumeProjection(state, draft, {
  resumeRoute = null, sourceInventory = null
} = {}) {
  const fallbackRoute = text(resumeRoute);
  if (!validState(state)) return {
    version: SEMANTIC_INTAKE_STATE_VERSION,
    status: "invalid",
    reason: "invalid-state",
    action: null,
    frontier: [],
    resumeRoute: fallbackRoute || null
  };
  const currentDigest = semanticDraftDigest(draft);
  const route = state.resumeRoute;
  const sourceChanged = sourceInventory !== null &&
    state.sourceInventory?.digest !== sourceInventory?.digest;
  if (state.status !== "current" || currentDigest !== state.draftDigest || sourceChanged) return {
    version: SEMANTIC_INTAKE_STATE_VERSION,
    status: "stale",
    reason: currentDigest !== state.draftDigest ? "draft-changed" :
      sourceChanged ? "sources-changed" : "inspection-required",
    draftDigest: currentDigest,
    recordedDraftDigest: state.draftDigest,
    action: null,
    frontier: [],
    resumeRoute: route
  };
  return {
    version: SEMANTIC_INTAKE_STATE_VERSION,
    status: "current",
    reason: null,
    draftDigest: currentDigest,
    action: jsonValue(state.lastAction, "semantic intake action"),
    frontier: [...state.frontier],
    resumeRoute: route
  };
}
