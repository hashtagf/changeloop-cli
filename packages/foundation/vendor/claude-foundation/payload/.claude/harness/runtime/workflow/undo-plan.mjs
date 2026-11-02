import { riskLevel } from "../contracts/scratch-router.mjs";
import { bareAbsenceIssue } from "./validation/explicit-absence.mjs";

// How a change is undone. The author's `scratch.undo` wins; otherwise the
// rollback a draft already states in another field counts. The approval page
// and the High/Critical rule read the same answer, so they cannot disagree.

const list = (value) => Array.isArray(value) ? value : [];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function text(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return text(value.map(text).filter(Boolean).join(", "));
  if (isObject(value)) return text(Object.entries(value).map(([key, item]) => {
    const shown = text(item);
    return shown ? `${key}: ${shown}` : null;
  }).filter(Boolean).join("; "));
  return null;
}

const rows = (value) => Array.isArray(value) ? value : isObject(value) && Array.isArray(value.entities) ? value.entities : [];

// [source named on the page, reader]
export const UNDO_FIELDS = Object.freeze([
  ["rollout", (draft) => text(draft?.rollout?.rollback)],
  ["dataModel", (draft) => text(rows(draft?.dataModel).map((row) => row?.rollback))],
  ["migrationPlan", (draft) => text(draft?.migrationPlan?.rollbackWindow)],
  ["dependencyChange", (draft) => text(list(draft?.dependencyChange).map((row) => row?.rollbackPin))],
  ["dataFix", (draft) => text(draft?.dataFix?.rollback)],
  ["pipelinePlan", (draft) => text(draft?.pipelinePlan?.rollback)]
]);

// { value, source } or null when the draft says nothing about undoing it.
export function undoPlan(draft) {
  const own = text(draft?.scratch?.undo);
  if (own) return { value: own, source: "scratch.undo" };
  for (const [source, read] of UNDO_FIELDS) {
    const value = read(draft);
    if (value) return { value, source };
  }
  return null;
}

// Repairs for a draft being started or revised. A High or Critical change must
// say how to undo it, or say plainly that it cannot be and why; any change that
// writes none or unknown for undo must give the reason.
export function undoIssues(draft) {
  const issues = [];
  const bare = bareAbsenceIssue(draft?.scratch?.undo, "semantic draft scratch.undo");
  if (bare) issues.push(bare);
  const { level } = riskLevel({ riskSignals: draft?.riskSignals, impact: draft?.impact });
  if ((level === "High" || level === "Critical") && !undoPlan(draft))
    issues.push(`semantic draft scratch.undo is required for risk level ${level}: say how to undo it, ` +
      "or 'none: <reason>' when it cannot be undone; an existing rollback field also counts " +
      `(${UNDO_FIELDS.map(([source]) => source).join(", ")})`);
  return issues;
}
