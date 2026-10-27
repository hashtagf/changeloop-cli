import {
  decisionStatus, projectDiscovery, requiredDiscoveryDimensions
} from "./semantic-intake.mjs";
import { isSemanticV4Plus } from "./draft-version.mjs";

const DEPTHS = Object.freeze({
  focused: Object.freeze({ maxSourceFiles: 12, maxSourceBytes: 192_000, frontierLimit: 2 }),
  standard: Object.freeze({ maxSourceFiles: 24, maxSourceBytes: 512_000, frontierLimit: 3 }),
  deep: Object.freeze({ maxSourceFiles: 48, maxSourceBytes: 1_024_000, frontierLimit: 3 })
});

const RISK_WEIGHTS = Object.freeze({
  "access-control": 3,
  "persisted-data-change": 3,
  "external-integration": 2,
  "performance-slo": 2,
  "user-interface": 1,
  "high-operational-risk": 3,
  "external-side-effect": 3,
  "financial": 3,
  "input-domain": 1
});

const text = (value) => typeof value === "string" ? value.trim() : "";
const strings = (value) => Array.isArray(value)
  ? value.map((item) => text(item)).filter(Boolean)
  : [];
const finiteCount = (value) => Number.isFinite(Number(value))
  ? Math.max(0, Math.trunc(Number(value)))
  : 0;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const ratio = (numerator, denominator) => denominator > 0
  ? Number((numerator / denominator).toFixed(4))
  : null;

function normalizedChoice(value) {
  return text(value).normalize("NFKC").toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

function impactScore(value) {
  return { low: 0, medium: 2, high: 4 }[text(value).toLowerCase()] ?? 1;
}

function sizeScore(source, repository) {
  const declared = text(source?.changeSize || source?.size).toLowerCase();
  if (["l", "large"].includes(declared)) return 4;
  if (["m", "medium"].includes(declared)) return 2;
  if (["s", "small"].includes(declared)) return 1;
  if (["xs", "extra-small"].includes(declared)) return 0;
  const files = finiteCount(repository?.candidateFileCount ?? repository?.changedFileCount);
  return files >= 25 ? 4 : files >= 8 ? 2 : files > 0 ? 1 : 0;
}

/**
 * Choose bounded investigation effort from typed change and repository signals.
 * Required semantic dimensions are returned verbatim and never reduced by the tier.
 */
export function planSemanticIntakeDepth(source = {}, { repository = {} } = {}) {
  const requiredDimensions = requiredDiscoveryDimensions(source);
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    if (points <= 0) return;
    score += points;
    reasons.push(reason);
  };

  add(impactScore(source.impact), `impact:${text(source.impact).toLowerCase() || "unspecified"}`);
  add(sizeScore(source, repository), "repository-size");
  const coupling = text(source.coupling).toLowerCase();
  add({ isolated: 0, coupled: 2, "cross-repository": 4 }[coupling] ?? 0,
    `coupling:${coupling || "unspecified"}`);
  const riskSignals = [...new Set(strings(source.riskSignals).map((value) => value.toLowerCase()))];
  for (const signal of riskSignals.sort(compareText))
    add(RISK_WEIGHTS[signal] || 0, `risk:${signal}`);
  const integrationCount = Math.max(
    Array.isArray(source.integrations) ? source.integrations.length : 0,
    finiteCount(repository.integrationCount)
  );
  add(Math.min(3, integrationCount), "integration-coupling");
  const dependentCount = finiteCount(repository.dependentCount);
  add(dependentCount >= 10 ? 3 : dependentCount >= 3 ? 2 : dependentCount > 0 ? 1 : 0,
    "dependency-coupling");
  add(Math.min(3, finiteCount(repository.persistenceBoundaryCount)), "persistence-boundary");
  add(Math.min(3, finiteCount(repository.permissionBoundaryCount)), "permission-boundary");

  const tier = score >= 9 ? "deep" : score >= 4 ? "standard" : "focused";
  return {
    version: 1,
    tier,
    score,
    reasons: [...new Set(reasons)].sort(compareText),
    limits: { ...DEPTHS[tier] },
    requiredDimensions,
    mandatoryDimensionCount: requiredDimensions.length
  };
}

function sourceFactRows(sourceFacts) {
  return Array.isArray(sourceFacts) ? sourceFacts : [];
}

function sourceInventoryIndex(sourceInventory) {
  const rows = Array.isArray(sourceInventory?.sources) ? sourceInventory.sources : [];
  return new Map(rows.map((row) => [text(row?.path), text(row?.sha256)]).filter(
    ([path, digest]) => path && digest));
}

function boundSourceReference(value, inventory) {
  if (typeof value === "string") {
    const path = text(value);
    return path && inventory.has(path) ? { path, digest: inventory.get(path) } : null;
  }
  const path = text(value?.sourcePath || value?.path);
  const digest = text(value?.sourceDigest || value?.digest);
  return path && digest && inventory.get(path) === digest ? { path, digest } : null;
}

/**
 * Evaluate only open user questions. Source facts are keyed structured evidence;
 * no English-only keyword inference is used.
 */
export function semanticQuestionQualityFindings(source = {}, {
  sourceFacts = [], sourceInventory = null
} = {}) {
  const decisions = Array.isArray(source.discovery?.decisions)
    ? source.discovery.decisions : [];
  const facts = sourceFactRows(sourceFacts);
  const inventory = sourceInventoryIndex(sourceInventory);
  const findings = [];
  const boundFacts = [];

  for (const [index, fact] of facts.entries()) {
    const path = `discovery.sourceFacts[${index}]`;
    const sourceKey = text(fact?.sourceKey);
    const decisionKey = text(fact?.decisionKey);
    const binding = boundSourceReference(fact, inventory);
    if (!sourceKey || !decisionKey || !binding ||
        (!text(fact?.answer) && fact?.supportsRecommendation !== true)) {
      findings.push({ code: "invalid-source-fact-binding", key: decisionKey, path });
      continue;
    }
    boundFacts.push(fact);
  }

  for (const [index, decision] of decisions.entries()) {
    if (decisionStatus(decision) !== "open") continue;
    const key = text(decision?.key);
    const path = `discovery.decisions[${index}]`;
    const alternatives = strings(decision?.alternatives);
    const normalized = alternatives.map(normalizedChoice);
    const duplicates = normalized.filter((choice, choiceIndex) =>
      choice && normalized.indexOf(choice) !== choiceIndex);
    if (duplicates.length) findings.push({
      code: "duplicate-alternatives", key, path,
      detail: { alternatives: [...new Set(duplicates)].sort(compareText) }
    });

    const recommendation = normalizedChoice(decision?.recommended);
    if (recommendation && !normalized.includes(recommendation)) findings.push({
      code: "recommendation-not-an-alternative", key, path
    });

    const evidenceRows = [
      ...(Array.isArray(decision?.recommendationSources)
        ? decision.recommendationSources : []),
      ...(Array.isArray(decision?.recommendationEvidence)
        ? decision.recommendationEvidence : [])
    ];
    const invalidEvidence = evidenceRows.filter((row) =>
      !boundSourceReference(row, inventory));
    if (invalidEvidence.length) findings.push({
      code: "invalid-recommendation-evidence-binding", key, path
    });
    const supportingFacts = boundFacts.filter((fact) =>
      text(fact?.decisionKey) === key && fact?.supportsRecommendation === true);
    const boundEvidence = evidenceRows.filter((row) => boundSourceReference(row, inventory));
    if (recommendation && !boundEvidence.length && !supportingFacts.length)
      findings.push({ code: "unsupported-recommendation", key, path });

    const answeringFacts = boundFacts.filter((fact) =>
      text(fact?.decisionKey) === key && text(fact?.answer));
    if (answeringFacts.length) findings.push({
      code: "question-answerable-from-source", key, path,
      detail: {
        sourceKeys: [...new Set(answeringFacts.map((fact) => text(fact.sourceKey)).filter(Boolean))]
          .sort(compareText)
      }
    });
  }

  return findings.sort((left, right) =>
    compareText(left.path, right.path) || compareText(left.code, right.code));
}

function measuredHistory(history) {
  if (history && typeof history === "object" && !Array.isArray(history)) {
    const fields = ["inspections", "questionRounds", "sourceRefreshes", "draftRepairs"];
    const measured = Object.fromEntries(fields.map((field) => [field,
      Number.isInteger(history[field]) && history[field] >= 0 ? history[field] : null]));
    return { observed: fields.every((field) => measured[field] !== null), ...measured };
  }
  if (!Array.isArray(history)) return {
    observed: false, inspections: null, questionRounds: null,
    sourceRefreshes: null, draftRepairs: null
  };
  const count = (type) => history.filter((event) => text(event?.type) === type).length;
  return {
    observed: true,
    inspections: count("inspection"),
    questionRounds: count("question-round"),
    sourceRefreshes: count("source-refresh"),
    draftRepairs: count("draft-repair")
  };
}

/** Produce a deterministic snapshot; unavailable history is null, never a false zero. */
export function semanticIntakeEffectivenessSnapshot(source = {}, options = {}) {
  const required = requiredDiscoveryDimensions(source);
  // Derived rows count: the draft content already covers those dimensions.
  const projected = isSemanticV4Plus(source.version) ? projectDiscovery(source) : source;
  const rows = Array.isArray(projected.discovery?.coverage) ? projected.discovery.coverage : [];
  const byDimension = new Map(rows.map((row) => [text(row?.dimension).toLowerCase(), row]));
  const requiredRows = required.map((dimension) => byDimension.get(dimension)).filter(Boolean);
  const complete = requiredRows.filter((row) =>
    ["covered", "not-applicable"].includes(text(row?.status).toLowerCase())).length;
  const grounded = requiredRows.filter((row) => strings(row?.sources).length > 0).length;
  const openQuestions = (source.discovery?.decisions || []).filter((row) =>
    decisionStatus(row) === "open").length;
  const resolvedQuestions = (source.discovery?.decisions || []).filter((row) =>
    decisionStatus(row) === "resolved" && text(row?.choice) && text(row?.reason)).length;
  const qualityFindings = semanticQuestionQualityFindings(source, options);
  const rejectedQuestions = new Set(qualityFindings.map((row) => row.key || row.path)).size;

  return {
    version: 1,
    depth: planSemanticIntakeDepth(source, options),
    coverage: {
      completed: complete,
      required: required.length,
      completionRatio: ratio(complete, required.length),
      grounded: grounded,
      groundingRatio: ratio(grounded, required.length)
    },
    questions: {
      open: openQuestions,
      // A draft edit can prove that a decision is resolved, but it cannot prove
      // that the user was asked or accepted the recommendation. Keep the old
      // field explicit and unavailable instead of turning eligible candidates
      // into a fabricated acceptance measurement.
      accepted: null,
      acceptanceMeasurement: "unavailable",
      eligible: Math.max(0, openQuestions - rejectedQuestions),
      resolved: resolvedQuestions,
      rejected: rejectedQuestions,
      findings: qualityFindings
    },
    history: measuredHistory(options.history)
  };
}
