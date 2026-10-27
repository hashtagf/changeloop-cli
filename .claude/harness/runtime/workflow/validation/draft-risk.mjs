import { draftWorkTypes } from "./design-blueprints.mjs";
import { inferWorkTypes } from "./dev-document.mjs";
import { isSemanticVersion } from "./draft-version.mjs";

// Risk, not diff size, selects the lane, so a semantic draft's impact and
// coupling are derived from what it actually touches. An omitted or understated
// declaration never lowers that: the harness raises it and records why, so the
// proposal shows the reason. Derivation only raises; high impact and every
// other declared signal stay with the author.

const IMPACT_RANK = { low: 0, medium: 1, high: 2 };
const COUPLING_RANK = { isolated: 0, coupled: 1 };
// Top-level roots that hold separately owned units: two of them is coupling.
const UNIT_ROOT = /^(services|packages|apps|libs|modules)\/([^/*?{[]+)/;
// Durable state: migrations, schema files, and database directories.
const PERSISTENCE_PATH = /\.(?:sql|prisma)$|(?:^|\/)(?:migrations?|db|database|schema|schemas)\/|(?:^|\/)[^/]*migrat[^/]*$/i;
const CONTRACT_TYPES = ["api", "data", "async"];
const DATA_TEXT = /\b(?:migrations?|rollbacks?|roll back|databases?|sql)\b/i;
const CONTRACT_TEXT = new RegExp("\\b(?:apis?|endpoints?|webhooks?|(?:request|response|wire)\\s+payloads?|graphql|grpc|openapi|" +
  "(?:events?|messages?|public|published|wire|service)\\s+(?:contracts?|schemas?))\\b", "i");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function scopePath(path) {
  return text(path).replace(/^\.\//, "");
}

function draftPaths(source) {
  return [
    ...(Array.isArray(source?.tasks) ? source.tasks : []).flatMap((task) => strings(task?.paths)),
    ...(Array.isArray(source?.fileMap) ? source.fileMap : []).map((row) => text(row?.path))
  ].map(scopePath).filter(Boolean);
}

function scenarioText(scenario) {
  if (typeof scenario === "string") return [scenario];
  return [scenario?.name, scenario?.when, scenario?.then, scenario?.scenario,
    ...strings(scenario?.given), ...strings(scenario?.and),
    text(scenario?.given), text(scenario?.and)];
}

// The words that state behavior: intent, reason, requirements, and scenarios.
function draftText(source) {
  return [source?.intent, source?.why, source?.summary,
    ...(Array.isArray(source?.requirements) ? source.requirements : []).flatMap((row) => [
      row?.description, row?.outcome, row?.requirement, row?.title, ...strings(row?.details),
      text(row?.details),
      ...(Array.isArray(row?.scenarios) ? row.scenarios : row?.scenario ? [row.scenario] : [])
        .flatMap(scenarioText)
    ])].map(text).filter(Boolean).join("\n");
}

function repositoryIds(source) {
  const ids = new Set();
  for (const entry of Array.isArray(source?.repositories) ? source.repositories : []) {
    const id = text(typeof entry === "string" ? entry : entry?.id);
    if (id) ids.add(id);
  }
  for (const task of Array.isArray(source?.tasks) ? source.tasks : [])
    ids.add(text(task?.repository) || "root");
  for (const row of Array.isArray(source?.requirements) ? source.requirements : [])
    strings(row?.repositories).forEach((id) => ids.add(id));
  return [...ids].sort();
}

function couplingReasons(source, paths) {
  const roots = [...new Set(paths.map((path) => path.match(UNIT_ROOT))
    .filter(Boolean).map((match) => `${match[1]}/${match[2]}`))].sort();
  const reasons = [];
  if (roots.length > 1) reasons.push(`tasks span ${roots.join(", ")}`);
  const repositories = repositoryIds(source);
  if (repositories.length > 1) reasons.push(`repositories ${repositories.join(", ")}`);
  if (Array.isArray(source?.integrations) && source.integrations.length)
    reasons.push("declares integrations");
  if (Array.isArray(source?.externalOperations) && source.externalOperations.length)
    reasons.push("declares external operations");
  return reasons;
}

// A declared work type is the author's classification and replaces text
// inference; persistence paths are hard evidence and always count.
function impactReasons(source, paths) {
  const reasons = [];
  const persistence = paths.filter((path) => PERSISTENCE_PATH.test(path));
  if (persistence.length) reasons.push(`data work: tasks touch ${persistence.slice(0, 3).join(", ")}`);
  const declared = draftWorkTypes(source).length > 0;
  const types = inferWorkTypes(source).filter((type) => CONTRACT_TYPES.includes(type) &&
    (declared || type !== "data"));
  if (types.length)
    reasons.push(`${declared ? "declared" : "inferred"} work type ${types.join(", ")}`);
  if (!declared) {
    const words = draftText(source);
    const data = words.match(DATA_TEXT);
    const contract = words.match(CONTRACT_TEXT);
    if (data) reasons.push(`requirements name data work ('${data[0]}')`);
    if (contract) reasons.push(`requirements name a published contract ('${contract[0]}')`);
  }
  return reasons;
}

/**
 * The impact and coupling a semantic draft's own content implies. Derived
 * values are at most medium/coupled; the reasons name the evidence.
 */
export function deriveDraftRisk(source) {
  const paths = draftPaths(source);
  const impact = impactReasons(source, paths);
  const coupling = couplingReasons(source, paths);
  return {
    impact: impact.length ? "medium" : "low",
    coupling: coupling.length ? "coupled" : "isolated",
    reasons: { impact, coupling }
  };
}

// The declared values a derivation replaced, so a stored draft keeps only what
// the author wrote and a later revision derives again from its own content.
export function declaredDraftRisk(source) {
  if (!source?._riskDerivation) return source;
  const { _riskDerivation: derivation, ...rest } = source;
  for (const key of ["impact", "coupling"]) {
    if (!(key in (derivation.declared || {}))) continue;
    if (derivation.declared[key] === undefined) delete rest[key];
    else rest[key] = derivation.declared[key];
  }
  return rest;
}

/**
 * Raise an omitted or understated impact/coupling to the derived value and
 * record why. Only semantic drafts (v3/v4/v5) are derived; legacy drafts and
 * values outside the known scale are left for preflight to judge.
 */
export function withDerivedRisk(input) {
  const source = declaredDraftRisk(input);
  if (!source || typeof source !== "object" || !isSemanticVersion(source.version)) return source;
  const derived = deriveDraftRisk(source);
  const result = { ...source };
  const derivation = { declared: {} };
  for (const [key, rank, fallback] of [
    ["impact", IMPACT_RANK, "low"], ["coupling", COUPLING_RANK, "isolated"]
  ]) {
    const declared = text(source[key]).toLowerCase() || fallback;
    if (!(declared in rank) || rank[derived[key]] <= rank[declared]) continue;
    derivation.declared[key] = source[key];
    derivation[key] = {
      value: derived[key],
      from: text(source[key]) ? declared : null,
      reasons: derived.reasons[key]
    };
    result[key] = derived[key];
  }
  if (!derivation.impact && !derivation.coupling) return source;
  result._riskDerivation = derivation;
  return result;
}

// "medium (derived: data work: tasks touch db/001.sql; declared low)".
export function riskLabel(draft, key) {
  const value = text(draft?.[key]);
  const entry = draft?._riskDerivation?.[key];
  if (!value || !entry || entry.value !== value) return value;
  return `${value} (derived: ${entry.reasons.join("; ")}` +
    (entry.from ? `; declared ${entry.from}` : "") + ")";
}

// One line for an agent repair that the derived lane caused.
export function riskDerivationSummary(draft) {
  const parts = ["impact", "coupling"].filter((key) => draft?._riskDerivation?.[key])
    .map((key) => `${key} ${riskLabel(draft, key)}`);
  return parts.length ? `the harness derived ${parts.join(", ")}` : "";
}
