// User intent is conversation-owned; repository facts retain their source inventory.
import { sortedJson } from "../../core/trust.mjs";

const text = (v) => typeof v === "string" ? v.trim() : "";
const rows = (v) => Array.isArray(v) ? v : [];
const dependencyList = (v) => v === undefined ||
  Array.isArray(v) && v.every((key) => !!text(key));
const active = (r) => r && !["superseded", "cancelled"].includes(r.status);
const ref = (r) => `${r?.key}@${r?.revision}`;
const kinds = new Set(["behavior", "constraint", "example", "exception", "non-goal", "success-criterion"]);
const statuses = new Set(["stated", "confirmed", "proposed", "unresolved", "superseded", "cancelled"]);
const fields = ["intent", "requirements", "conversation", "questions", "experiments", "work", "historyGaps"];

export function intakeTemplate() {
  return {
    purpose: "research",
    intent: { goal: "", outcome: "", actors: [], scope: [] },
    requirements: [], conversation: [], questions: [], experiments: [], work: [], historyGaps: []
  };
}

export function intakeSnapshot(record) {
  return Object.fromEntries(["purpose", ...fields].map((key) => [key, record[key]]));
}

export function currentRequirements(record) {
  return rows(record.requirements).filter(active);
}

export function intakeIssues(record, previous = null) {
  if (record?.version !== 2) return [];
  const issues = [];
  const issue = (at, message) => issues.push(`intake ${at}: ${message}`);
  const stringArray = (value, at) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) { issue(at, "must be an array"); return; }
    if (value.some((entry) => !text(entry))) issue(at, "must contain nonempty strings");
  };
  if (!["research", "change"].includes(record.purpose)) issue("purpose", "must be research|change");
  if (!record.intent || typeof record.intent !== "object" || Array.isArray(record.intent))
    issue("intent", "must be an object");
  for (const key of ["actors", "scope"]) stringArray(record.intent?.[key], `intent.${key}`);
  for (const key of fields.filter((key) => key !== "intent"))
    if (!Array.isArray(record[key])) issue(key, "must be an array");
  const index = (name, identity = (r) => r.key) => {
    const found = new Map();
    for (const row of rows(record[name])) {
      const key = identity(row || {});
      if (!row || !text(row.key)) issue(name, "each row needs a key");
      else if (found.has(key)) issue(name, `duplicate identity '${key}'`);
      else found.set(key, row);
    }
    return found;
  };
  const conversations = index("conversation");
  const requirements = index("requirements", ref);
  const questions = index("questions");
  const work = index("work");
  const experimentIndex = index("experiments");
  const events = (value, at, requireUser = false) => {
    if (!Array.isArray(value) || !value.length) issue(at, "conversationKeys must cite retained events");
    for (const key of rows(value)) if (!conversations.has(key)) issue(at, `unknown conversation '${key}'`);
    if (requireUser && !rows(value).some((key) => conversations.get(key)?.speaker === "user"))
      issue(at, "user intent/answer needs a user conversation event; silence is not confirmation");
  };
  for (const event of conversations.values()) {
    if (!["user", "agent"].includes(event.speaker)) issue(event.key, "speaker must be user|agent");
    if (!text(event.statement)) issue(event.key, "statement is required");
    if (!text(event.source)) issue(event.key, "source must identify the accessible message or retained note");
  }
  for (const row of requirements.values()) {
    const at = ref(row);
    if (!Number.isSafeInteger(row.revision) || row.revision < 1) issue(at, "revision must be a positive integer");
    if (!kinds.has(row.kind)) issue(at, "unknown requirement kind");
    if (!statuses.has(row.status)) issue(at, "unknown requirement status");
    if (!["user", "agent"].includes(row.origin)) issue(at, "origin must be user|agent");
    if (!text(row.statement)) issue(at, "statement is required");
    for (const key of ["examples", "criteria"]) stringArray(row[key], `${at}.${key}`);
    events(row.conversationKeys, at, row.origin === "user" || ["stated", "confirmed"].includes(row.status));
    if (typeof row.material !== "boolean") issue(at, "material must be boolean");
    if (!active(row) && !text(row.reason)) issue(at, "retirement needs a reason");
    if (row.status === "superseded" && (!row.supersededBy || !requirements.has(ref(row.supersededBy)) ||
        ref(row.supersededBy) === at)) issue(at, "supersededBy must reference a different retained revision");
  }
  const currentKeys = new Set();
  for (const row of currentRequirements(record)) {
    if (currentKeys.has(row.key)) issue(row.key, "only one active revision is allowed");
    currentKeys.add(row.key);
  }
  for (const row of questions.values()) {
    if (!text(row.question)) issue(row.key, "question is required");
    if (!["open", "answered", "deferred"].includes(row.status)) issue(row.key, "unknown question status");
    if (typeof row.material !== "boolean") issue(row.key, "material must be boolean");
    if (row.status === "answered") {
      if (!text(row.answer)) issue(row.key, "answered question needs answer");
      events(row.conversationKeys, row.key, true);
    }
    if (row.status === "deferred" && !text(row.reason)) issue(row.key, "deferral needs reason");
    for (const key of ["dependsOn", "workKeys"]) stringArray(row[key], `${row.key}.${key}`);
    for (const key of rows(row.dependsOn)) if (!questions.has(key)) issue(row.key, `unknown dependency '${key}'`);
    for (const key of rows(row.workKeys)) if (!work.has(key)) issue(row.key, `unknown work '${key}'`);
  }
  const visiting = new Set(), visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) { issue(key, "question dependency cycle"); return; }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of rows(questions.get(key)?.dependsOn)) if (questions.has(dependency)) visit(dependency);
    visiting.delete(key); visited.add(key);
  };
  for (const key of questions.keys()) visit(key);
  for (const row of work.values()) {
    if (!text(row.outcome)) issue(row.key, "work outcome is required");
    stringArray(row.questionKeys, `${row.key}.questionKeys`);
    for (const key of rows(row.questionKeys)) if (!questions.has(key)) issue(row.key, `unknown question '${key}'`);
  }
  for (const row of rows(record.experiments)) {
    if (!row || typeof row !== "object") { issue("experiments", "rows must be objects"); continue; }
    for (const key of ["criteria", "findings", "limitations", "prototypePaths"])
      stringArray(row[key], `${row.key}.${key}`);
    if (!text(row.question) || !rows(row.criteria).length) issue(row.key, "experiment needs question and criteria");
    if (!["planned", "complete"].includes(row.status)) issue(row.key, "status must be planned|complete");
    if (typeof row.material !== "boolean") issue(row.key, "material must be boolean");
    if (!rows(row.requirementRefs).length) issue(row.key, "experiment needs requirementRefs");
    for (const r of rows(row.requirementRefs)) if (!requirements.has(ref(r)))
      issue(row.key, `unknown requirement revision '${ref(r)}'`);
    if (row.status === "complete" && (!rows(row.findings).length || !rows(row.limitations).length))
      issue(row.key, "complete experiment needs findings and limitations");
    if (row.supersededBy && (!experimentIndex.has(row.supersededBy) || row.supersededBy === row.key || !text(row.reason)))
      issue(row.key, "superseded experiment needs another retained experiment and reason");
    for (const path of rows(row.prototypePaths)) {
      if (typeof path !== "string" || !path.startsWith(`.foundation/prototypes/${record.id}/`) ||
          path.includes("\\") || path.split("/").some((part) => part === ".." || part === "."))
        issue(row.key, "prototypePaths must stay within the investigation prototype directory");
    }
  }
  for (const gap of rows(record.historyGaps)) if (!text(gap)) issue("historyGaps", "gaps must be nonempty strings");
  if (previous) {
    for (const old of rows(previous.conversation)) {
      const next = conversations.get(old.key);
      if (!next || sortedJson(next) !== sortedJson(old)) issue(old.key, "retained conversation event changed or disappeared");
    }
    for (const old of rows(previous.requirements)) {
      const next = requirements.get(ref(old));
      if (!next) { issue(ref(old), "retained requirement disappeared; keep it with explicit retirement"); continue; }
      const immutable = (r) => Object.fromEntries(Object.entries(r).filter(([k]) =>
        !["status", "reason", "supersededBy", "conversationKeys"].includes(k)));
      if (sortedJson(immutable(old)) !== sortedJson(immutable(next)))
        issue(ref(old), "requirement content changed without a new revision");
      for (const key of rows(old.conversationKeys))
        if (!rows(next.conversationKeys).includes(key)) issue(ref(old), "requirement provenance disappeared");
      if (old.status !== next.status && !text(next.reason)) issue(ref(old), "status transition needs reason");
      if (!active(old) && sortedJson(old) !== sortedJson(next)) issue(ref(old), "retired revision must remain unchanged");
    }
    for (const old of rows(previous.questions)) {
      const next = questions.get(old.key);
      if (!next) issue(old.key, "retained question disappeared; answer or defer it");
      else if (old.status === "answered" && sortedJson(old) !== sortedJson(next))
        issue(old.key, "answered question must remain unchanged; add a new question for corrections");
    }
    for (const old of rows(previous.experiments)) {
      const next = experimentIndex.get(old.key);
      if (!next) issue(old.key, "retained experiment disappeared");
      else if (old.status === "complete") {
        const result = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !["supersededBy", "reason"].includes(k)));
        if (sortedJson(result(old)) !== sortedJson(result(next)))
          issue(old.key, "completed result changed; retain it and supersede with a new experiment");
      }
    }
    for (const gap of rows(previous.historyGaps))
      if (!rows(record.historyGaps).includes(gap)) issue("historyGaps", "retained history gap disappeared");
  }
  return issues;
}

export function intakeFrontier(record) {
  if (record?.version !== 2) return { questions: [], independentWork: [], staleExperiments: [], pendingExperiments: [], unresolved: [] };
  const open = rows(record.questions).filter((q) => q && q.status !== "answered");
  const answered = new Set(rows(record.questions).filter((q) => q?.status === "answered" && text(q.key)).map((q) => q.key));
  // A nonmaterial question is never asked, so a material question that depends
  // on one would otherwise stay unaskable; only material dependencies gate it.
  const nonmaterial = new Set(open.filter((q) => q.material === false && text(q.key)).map((q) => q.key));
  const questions = open.filter((q) => q.material === true && dependencyList(q.dependsOn) &&
    rows(q.dependsOn).every((key) => answered.has(key) || nonmaterial.has(key)));
  const independentWork = rows(record.work).filter((w) => w && text(w.key) && text(w.outcome) &&
    dependencyList(w.questionKeys) && rows(w.questionKeys).every((key) => answered.has(key)));
  const current = new Set(currentRequirements(record).map(ref));
  const staleExperiments = rows(record.experiments).filter((e) => e && !e.supersededBy &&
    rows(e.requirementRefs).some((r) => !current.has(ref(r))));
  const unresolved = currentRequirements(record).filter((r) => r.material && ["proposed", "unresolved"].includes(r.status));
  const pendingExperiments = rows(record.experiments).filter((e) => e?.material && e.status === "planned" && !e.supersededBy);
  return { questions, independentWork, staleExperiments, pendingExperiments, unresolved, open };
}

export function intakeReadinessIssues(record) {
  if (record?.version !== 2 || record.purpose !== "change" || !record.changeIntent ||
      record.conclusion?.status === "not-worth-changing") return [];
  const issues = [];
  if (!text(record.intent?.goal) || !text(record.intent?.outcome)) issues.push("change intent needs goal and observable outcome");
  if (!currentRequirements(record).some((r) => ["stated", "confirmed"].includes(r.status)))
    issues.push("change needs at least one explicit user requirement; no blanket confirmation is required");
  return issues;
}
