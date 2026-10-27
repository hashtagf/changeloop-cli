import {
  agreementDriftError, agreementIdentity, agreementRestoredNotice, repairWhitespaceDrift,
  restoreDriftedAgreement, userDecisionError
} from "../core/user-decisions.mjs";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync,
  realpathSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { acquireProcessLock } from "../core/process-lock.mjs";
import { DRAFT_FOLDER_VERSION, loadDraftFolder } from "./draft-folder.mjs";
import { transitionLifecycleState } from "../core/lifecycle-reducer.mjs";
import { foundationChangeStores, retiredChangeStores } from "./retired-change-stores.mjs";
import { nextCommand, resumeThrough } from "../core/next-step.mjs";
import { taskBlocks, taskMetadata } from "../contracts/change-artifacts.mjs";
import { matchesSecurityTerm, materialSecurityTriggers } from "./security-policy.mjs";
import {
  agentDecision, authoredDecisionReason, expandMinimalSemanticDraft, mergeSemanticDraft,
  MINIMAL_DRAFT_WRITING, minimalDraftFolderTemplate, normalizeSemanticDraft, renderRequirementMarkdown,
  renderSpecHeading, semanticDraftTemplate, unknownTaskFieldWarnings
} from "./semantic-draft.mjs";
import { isSemanticV4Plus, isSemanticVersion } from "./validation/draft-version.mjs";
import { assembleReviewPolicy, collectReviewSignals } from "../evidence/evidence-contract.mjs";
import { classifyReviewRisk } from "../evidence/review-routing.mjs";
import { reviewModelClass } from "../evidence/review-diff.mjs";
import {
  FIXES_DIMENSIONS, riskSignalDimensions, semanticIntakeAction, semanticIntakeIssues
} from "./validation/semantic-intake.mjs";
import { inferPathSignals } from "../contracts/scratch-router.mjs";
import { inspectSemanticSources } from "./validation/semantic-source-inventory.mjs";
import {
  inspectRepositoryIntelligence, repositoryIntelligenceRequired, skippedRepositoryIntelligence
} from "./validation/repository-intelligence.mjs";
import {
  planSemanticIntakeDepth,
  semanticIntakeEffectivenessSnapshot,
  semanticQuestionQualityFindings
} from "./validation/semantic-intake-intelligence.mjs";
import { planAmendmentInvalidation } from "./validation/amendment-invalidation.mjs";
import {
  planSelectiveProofRecovery, rebindSelectiveProofReceipt, demoteSelectivePreservation
} from "./validation/selective-proof-plan.mjs";
import {
  reduceSemanticIntakeState, semanticDraftDigest, semanticIntakeResumeProjection
} from "./semantic-intake-state.mjs";
import {
  amendmentRepositoryOrderIssues, amendmentTaskRepositoryIssues, amendmentVerifyPathIssues,
  compileSemanticAmendment,
  semanticAmendmentTemplate, taskContractOnlyAmendment, taskRepositoryIssues, verifyPathIssues,
  writeSemanticAmendment
} from "./semantic-amendment.mjs";
import { amendmentInvestigationSource, investigationCoverageIssues,
  renderInvestigationCoverage } from "./validation/investigation-coverage.mjs";
import { validateInvestigationBinding } from "./investigation-runtime.mjs";
import {
  DESIGN_FIELDS, designBlueprintWarnings, draftHasBlueprints, draftWorkTypes, renderDesignBlueprints,
  renderFailureMatrixBody, renderFileMapBody, renderJobContractBody, renderTestMapBody, renderUiStatesBody,
  renderWorkType, verifyCountAdvisories
} from "./validation/design-blueprints.mjs";
import {
  derivedByHarness, derivedFailureMatrix, derivedFileMap, derivedTestMap, docsOnlyDraft, inferWorkTypes,
  renderComponentMap, renderFileTree, renderUserFlow, withNewPaths
} from "./validation/dev-document.mjs";
import {
  coverageNoteLine, renderDefinitionOfDone, renderPacketHeader, renderScope, renderTraceability, reviewTier
} from "./validation/packet-overview.mjs";
import { OUTLINE, outlineRow, outlineSections, sectionHeading } from "./validation/outline-contract.mjs";
import {
  PROCESS_FIELDS, complianceAction, complianceEnabledFromConfig
} from "./validation/process-fields.mjs";
import { groundingFromQuality } from "./validation/quality-fields.mjs";
import { targetEditDigest, targetEditPaths } from "./target-edits.mjs";
import {
  declaredDraftRisk, riskDerivationSummary, riskLabel, withDerivedRisk
} from "./validation/draft-risk.mjs";
import {
  fileMapWithTasks, intakeDecisions, openQuestionItems, readerGuideWarnings,
  capabilityTable, discoveryAppendixBody, investigationAppendixBody,
  renderOpenQuestions, renderSuccessCriteria, renderUserStories
} from "./validation/reader-guide.mjs";

// Marks a start whose re-inspected intake is not DONE (see completedDraftIntake).
const INCOMPLETE_INTAKE = Symbol("incomplete-intake");

// A v5 draft keeps nfr and observability in change.json. A draft with grounding
// v2 already carries them (withQualityGrounding); one without a grounding v2
// ledger (none, or the decisions-only v3) still gets them in grounding.yaml:
// added to its v3 ledger, or as a derived ledger that no gate validates when
// grounding is not required. v3 and v4 drafts and v2 ledgers are unchanged.
export function v5QualityGrounding(draft, { groundingRequired = false } = {}) {
  if (Number(draft?._semanticVersion ?? draft?.version) !== 5) return null;
  const grounding = draft.grounding;
  if (grounding?.version === 2) return null;
  if (!grounding && groundingRequired) return null;
  if (grounding && grounding.version !== 3) return null;
  const nfr = Array.isArray(draft.nfr) && draft.nfr.length > 0;
  const observability = draft.observability !== undefined && draft.observability !== null;
  if (!nfr && !observability) return null;
  const derived = groundingFromQuality(draft);
  return {
    ...(grounding || { version: 2, derivedFrom: "change.json" }),
    ...(nfr ? { nfrAssessment: derived.nfrAssessment } : {}),
    ...(observability ? { observability: derived.observability } : {})
  };
}

// An amendment that only replaces outline sections changes no requirement,
// claim, or task.
export function sectionsOnlyAmendment(amendment) {
  const list = (field) => Array.isArray(amendment?.[field]) ? amendment[field] : [];
  return list("sections").length > 0 && [
    "addRequirements", "reviseRequirements", "removeRequirements",
    "updateTasks", "addTasks", "removeTasks"
  ].every((field) => !list(field).length);
}

const DOCUMENT_REVIEW_CAPABILITIES = new Set(["review", "acceptance", "semantic-acceptance"]);

// A sections-only amendment rewrites prose the reviewer reads but no claim, so
// it invalidates only whole-packet review providers (and their dependents)
// and preserves every claim-bound receipt. Approval is not reopened.
export function documentSectionInvalidation(providers = {}) {
  const rows = Object.entries(providers || {}).map(([id, config]) => ({ id, ...config }));
  const affected = new Set(rows.filter((row) =>
    DOCUMENT_REVIEW_CAPABILITIES.has(String(row.capability || ""))).map((row) => row.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) {
      if (affected.has(row.id)) continue;
      if ((Array.isArray(row.dependsOn) ? row.dependsOn : []).some((id) => affected.has(id))) {
        affected.add(row.id);
        changed = true;
      }
    }
  }
  const affectedProviders = [...affected].sort();
  const preservedProviders = rows.map((row) => row.id).filter((id) => !affected.has(id)).sort();
  const invalidate = affectedProviders.length > 0;
  return {
    version: 1, status: "READY", findings: [],
    affectedClaims: [], affectedTasks: [], affectedProviders, preservedProviders,
    approval: { invalidate: false, reasons: [] },
    proof: {
      invalidate,
      reasons: invalidate ? ["document-sections-changed"] : [],
      invalidateReceipts: affectedProviders,
      preserveReceipts: preservedProviders
    },
    coverage: { global: false, dimensions: ["document-sections"] }
  };
}

// Typed draft risk signals as persisted on the change: lowercased, unique, sorted.
export function riskSignalValues(signals) {
  return [...new Set((Array.isArray(signals) ? signals : [])
    .map((value) => String(value).trim().toLowerCase()).filter(Boolean))].sort();
}

// Each API error a contract lists needs the status or code a client matches
// on; without one the design renders `?` and Build guesses the wire shape.
// An agent repair at inspect, never a user question.
export function apiContractErrorIssues(draft) {
  const contracts = Array.isArray(draft?.apiContracts) ? draft.apiContracts : [];
  const issues = [];
  contracts.forEach((contract, index) => {
    if (!Array.isArray(contract?.errors)) return;
    contract.errors.forEach((error, position) => {
      const identified = error && typeof error === "object"
        ? [error.status, error.code].some((value) =>
          (typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" && value.trim()))
        : /\b[1-5]\d\d\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(String(error ?? ""));
      if (!identified)
        issues.push(`apiContracts[${index}].errors[${position}] needs a status or code ` +
          "(for example { status: 404, code: \"NOT_FOUND\", when: \"...\" })");
    });
  });
  return issues;
}

export function atomicStartPreflight(draft, { groundingRequired = false } = {}) {
  const issues = [];
  if (![1, 2].includes(draft?.version) && !isSemanticVersion(draft?.version))
    issues.push("start draft requires version 1, 2, 3, 4, or 5");
  if (!String(draft?.intent || "").trim())
    issues.push("start draft requires non-empty 'intent'");
  const acceptance = draft?.acceptance;
  if (!acceptance || typeof acceptance.required !== "boolean")
    issues.push("start draft requires acceptance.required true|false from an explicit user-facing decision");
  else if (acceptance.required && !String(acceptance.reason || "").trim())
    issues.push("start draft requires acceptance.reason when acceptance.required is true");
  else if (!acceptance.required && (String(acceptance.reason || "").trim() ||
      (acceptance.claimIds || []).length))
    issues.push("start draft acceptance.reason and acceptance.claimIds require acceptance.required true");

  const impact = draft?.impact || "low";
  const coupling = draft?.coupling || "isolated";
  const securityTriggers = draft?.securityTriggers || [];
  if (!["low", "medium", "high"].includes(impact))
    issues.push("start draft impact must be low|medium|high");
  if (!["isolated", "coupled"].includes(coupling))
    issues.push("start draft coupling must be isolated|coupled");
  if (!Array.isArray(securityTriggers) ||
      securityTriggers.some((trigger) => typeof trigger !== "string" || !trigger.trim()))
    issues.push("start draft securityTriggers must be an array of non-empty strings");
  if (draft?.externalOperations !== undefined &&
      !Array.isArray(draft.externalOperations))
    issues.push("draft externalOperations must be an array");
  if (!draft?.execution || draft.execution.version !== 1 ||
      !draft.execution.providers || Object.keys(draft.execution.providers).length === 0)
    issues.push("start draft requires executable evidence wiring");

  const safeTriggers = Array.isArray(securityTriggers) ? securityTriggers : [];
  const rapid = impact === "low" && coupling === "isolated" &&
    safeTriggers.filter((trigger) => trigger.toLowerCase() !== "none").length === 0 &&
    !draft?.reviewRequired && !acceptance?.required;
  if (groundingRequired && ![2, 3].includes(draft?.grounding?.version))
    issues.push("start draft requires grounding.version 2 or 3 after the initial Decision Sheet");
  if (!rapid && groundingRequired && draft?.grounding?.version !== 3) {
    const categories = [
      "performance", "capacity", "availability", "securityPrivacy",
      "accessibility", "operability", "compatibility", "recoverability"
    ];
    const missing = categories.filter((category) =>
      !draft?.grounding?.nfrAssessment?.[category]);
    if (missing.length)
      issues.push(`standard start draft requires every grounding.nfrAssessment category before creation: ${missing.join(", ")}`);
  }
  if (!rapid && !Array.isArray(draft?.decisions))
    issues.push("standard start draft requires decisions to be an array; use [] when no durable decision qualifies");
  return { issues, classification: { impact, coupling, securityTriggers: safeTriggers }, rapid };
}

function specRequirementBlocks(specTexts) {
  const blocks = [];
  for (const text of specTexts) {
    let current = null;
    for (const line of String(text || "").split("\n")) {
      if (/^###\s+Requirement:/.test(line)) {
        current = { lines: [line], scenarios: new Set() };
        blocks.push(current);
        continue;
      }
      if (/^##\s/.test(line) || /^###\s/.test(line)) { current = null; continue; }
      if (!current) continue;
      current.lines.push(line);
      const scenario = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
      if (scenario) current.scenarios.add(scenario[1]);
    }
  }
  return blocks.map((block) => ({
    text: block.lines.join("\n").trim(), scenarios: block.scenarios
  }));
}

/**
 * Fingerprint each semantic requirement of a compiled packet by its claims and
 * the spec block that carries those claims' scenarios. Keys come from
 * `claim.requirementKey`, so legacy claims without one are not tracked.
 */
export function requirementFingerprints({ claims = [], specTexts = [] } = {}) {
  const blocks = specRequirementBlocks(specTexts);
  const byKey = new Map();
  for (const claim of claims) {
    const key = String(claim?.requirementKey || "").trim();
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) || []), claim]);
  }
  const fingerprints = {};
  for (const [key, rows] of byKey) {
    const scenarios = new Set(rows.map((claim) => claim.scenario).filter(Boolean));
    const text = blocks.filter((block) =>
      [...scenarios].some((name) => block.scenarios.has(name))).map((block) => block.text);
    const ordered = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    fingerprints[key] = createHash("sha256")
      .update(JSON.stringify({ claims: ordered, text })).digest("hex");
  }
  return fingerprints;
}

/**
 * Fingerprint each semantic requirement from its authored draft row and
 * evidence entry, so outcome-only edits are visible even in spec-less packets.
 */
export function draftRequirementFingerprints(draft) {
  const fingerprints = {};
  for (const row of Array.isArray(draft?.requirements) ? draft.requirements : []) {
    const key = String(row?.key || "").trim();
    if (!key) continue;
    fingerprints[key] = createHash("sha256")
      .update(JSON.stringify({ requirement: row, evidence: draft.evidence?.[key] ?? null }))
      .digest("hex");
  }
  return fingerprints;
}

export function requirementDelta(before = {}, after = {}) {
  const keys = (object) => Object.keys(object).sort();
  return {
    added: keys(after).filter((key) => !(key in before)),
    revised: keys(after).filter((key) => key in before && before[key] !== after[key]),
    removed: keys(before).filter((key) => !(key in after))
  };
}

/**
 * Fold a new revision delta into the unapproved one so a single approval covers
 * every change since the last approved agreement.
 */
export function mergeApprovalDelta(prior, next) {
  const added = new Set(prior?.added || []);
  const revised = new Set(prior?.revised || []);
  const removed = new Set(prior?.removed || []);
  for (const key of next.added || []) {
    if (removed.delete(key)) revised.add(key);
    else added.add(key);
  }
  for (const key of next.revised || [])
    if (!added.has(key)) revised.add(key);
  for (const key of next.removed || []) {
    revised.delete(key);
    if (!added.delete(key)) removed.add(key);
  }
  const sorted = (set) => [...set].sort();
  return { added: sorted(added), revised: sorted(revised), removed: sorted(removed) };
}

// A waiver bound to an earlier contract revision stops applying when an
// amendment moves the revision; the amendment says which ones, so the gate
// does not silently reappear.
export function invalidatedWaivers(waivers, contractRevision) {
  return (Array.isArray(waivers) ? waivers : [])
    .filter((row) => row?.binding &&
      Number(row.binding.contractRevision) !== Number(contractRevision || 0))
    .map((row) => row.capability).filter(Boolean).sort();
}

export function formatInvalidatedWaivers(id, waivers, contractRevision) {
  const capabilities = invalidatedWaivers(waivers, contractRevision);
  return capabilities.length
    ? `  waivers no longer apply: ${capabilities.join(", ")} (bound to an earlier contract ` +
      `revision; now ${Number(contractRevision || 0)}); if still intended, ask the user and ` +
      `record each again: claude-foundation change waive ${id} --capability <capability> ` +
      "--reason <why> --decision-ref <user-decision>\n"
    : "";
}

export function formatApprovalDelta(delta) {
  const list = (values) => values?.length ? values.join(", ") : "none";
  return `  added: ${list(delta.added)}\n  revised: ${list(delta.revised)}\n` +
    `  removed: ${list(delta.removed)}`;
}

export function priorChangeResidue(root, id) {
  return [
    join(root, ".foundation", "runtime", `${id}.json`),
    join(root, ".foundation", "receipts", id),
    join(root, ".foundation", "evidence", id),
    join(root, ".foundation", "handoffs", id),
    // Per-change bookkeeping (review requests and reports, instruction
    // manifests, the open attestation challenge, delivery state) leaks into a
    // reused id. Without a retirement record it may belong to a live change,
    // so it blocks reuse.
    ...retiredChangeStores(foundationChangeStores(root), id).map(([, path]) => path)
  ].filter((path) => existsSync(path));
}

// The newest retirement record of this id: an abandonment or a Land undo.
function retirementRecord(root, id) {
  const candidates = [
    [join(root, ".foundation", "recovery", "abandoned", id), "abandon.json"],
    [join(root, ".foundation", "recovery", "land-undone", id), "undo.json"]
  ].flatMap(([directory, name]) => existsSync(directory)
    ? readdirSync(directory)
      .filter((entry) => entry === name || entry.startsWith(`${name}.previous-`))
      .map((entry) => ({ directory, mtime: statSync(join(directory, entry)).mtimeMs }))
    : []);
  return candidates.sort((left, right) => right.mtime - left.mtime)[0]?.directory || null;
}

// An abandon (or Land undo) that predates a store's quarantine left that
// per-change bookkeeping behind. That is harness bookkeeping, not a live change,
// when the id's retirement record exists: finish the quarantine into that
// record (a delivery record is moved, never deleted) so the id is reusable
// fresh. Any other residue — runtime, receipts, evidence, handoffs — is left
// alone and still blocks reuse.
export function settleAbandonedReviewResidue(root, id, now) {
  const leaked = retiredChangeStores(foundationChangeStores(root), id);
  const residue = priorChangeResidue(root, id);
  const leakedPaths = leaked.map(([, path]) => path);
  if (!residue.length || residue.some((path) => !leakedPaths.includes(path))) return [];
  const record = retirementRecord(root, id);
  if (!record) return [];
  const moved = [];
  for (const [name, source] of leaked) {
    if (!existsSync(source)) continue;
    const destination = join(record, name);
    if (existsSync(destination))
      renameSync(destination, `${destination}.previous-${
        String(now()).replace(/[^0-9A-Za-z]/g, "-")}`);
    renameSync(source, destination);
    moved.push(name);
  }
  return moved;
}

export function materializeChangeTemplates({
  schema,
  source,
  target,
  intent,
  groundingRequired,
  conditional = false,
  includeDesign = true,
  instantiate
}) {
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, ".openspec.yaml"), schema === "foundation-rapid"
    ? `schema: ${schema}\nskip_specs: true\n`
    : `schema: ${schema}\n`);
  const core = conditional
    ? ["proposal.md", "tasks.md", "evidence.yaml"]
    : ["proposal.md", "tasks.md", "evidence.yaml", "execution.yaml",
        "repositories.yaml", "handoffs.yaml"];
  for (const name of core)
    writeFileSync(join(target, name), instantiate(join(source, name), intent));
  if (groundingRequired && !conditional)
    writeFileSync(join(target, "grounding.yaml"),
      instantiate(join(source, "grounding.yaml"), intent));
  if (schema === "foundation-standard") {
    if (includeDesign)
      writeFileSync(join(target, "design.md"), instantiate(join(source, "design.md"), intent));
    if (!conditional) {
      mkdirSync(join(target, "specs", "change"), { recursive: true });
      writeFileSync(join(target, "specs", "change", "spec.md"),
        instantiate(join(source, "spec.md"), intent));
    }
  }
}

export function initialChangeState({
  root,
  id,
  intent,
  schema,
  groundingRequired,
  riskBasedCi,
  gitHead,
  preexistingDirty,
  initialBudget,
  now,
  semanticDraftVersion = null,
  groundingVersion = null,
  externalOperationsVersion = 1,
  designRequired = true
}) {
  const standard = schema === "foundation-standard";
  return {
    version: 2, id, intent, schema, status: "change", ambiguity: "clear",
    groundingRequired,
    groundingVersion: groundingRequired ? (groundingVersion || 2) : null,
    semanticDraftVersion,
    artifactDefaultsVersion: isSemanticVersion(semanticDraftVersion) ? 2 : null,
    nfrAssessmentRequired: standard && groundingRequired && groundingVersion !== 3,
    decisionMetadataRequired: standard && designRequired,
    semanticInvariantsRequired: standard,
    riskBasedCiRequired: standard && riskBasedCi,
    externalOperationsVersion,
    graphExecutionVersion: 1,
    // Standard changes must pass through the explicit decision boundary before
    // validation. Keep the marker opt-in so runtime files created before this
    // field existed remain valid and rapid changes keep their short lane.
    resolutionRequired: standard,
    resolvedAt: null,
    revision: 0, contractRevision: 0, executionRevision: 0,
    impact: standard ? null : "low",
    coupling: standard ? null : "isolated",
    securityTriggers: [], reviewRequired: false, evidenceCapabilities: [],
    acceptance: {
      version: 2,
      decision: standard ? "undecided" : "not-required",
      required: false, reason: null, claimIds: [], declaredAt: null
    },
    reviewHistory: { version: 1, aiAttempts: 0, totalAttempts: 0, chainHead: null },
    workspace: {
      mode: "current", path: root, baseHead: gitHead(root),
      preexisting: preexistingDirty(root)
    },
    budget: initialBudget(schema, id),
    createdAt: now(), updatedAt: now()
  };
}

const decisionTextList = (value) => (Array.isArray(value) ? value : [value])
  .map((item) => String(item ?? "").trim()).filter(Boolean);
const decisionText = (value) => decisionTextList(value ?? []).join("; ");

// An option is a plain string or { option, reason?, pros?, cons? }; either
// way it reads as one line of text, never "[object Object]".
export function renderDecisionOption(option) {
  if (option === null || option === undefined) return "";
  if (typeof option !== "object") return String(option).trim();
  const name = String(option.option ?? option.name ?? "").trim();
  const pros = decisionTextList(option.pros);
  const cons = decisionTextList(option.cons);
  const detail = [
    String(option.reason ?? option.why ?? "").trim(),
    pros.length ? `pros: ${pros.join(", ")}` : "",
    cons.length ? `cons: ${cons.join(", ")}` : ""
  ].filter(Boolean).join("; ");
  return name && detail ? `${name}: ${detail}` : name || detail;
}

function renderRejectedOptions(decision) {
  const listed = decision.rejected ?? decision.alternatives;
  const options = (Array.isArray(decision.options) ? decision.options : [])
    .filter((option) => option && typeof option === "object" ? option.chosen !== true : true);
  if (!Array.isArray(listed) && !options.length)
    return listed && typeof listed === "object" ? renderDecisionOption(listed) : listed;
  const rows = [...(Array.isArray(listed) ? listed : listed ? [listed] : []), ...options];
  const texts = rows.map(renderDecisionOption)
    .filter((value) => value && value !== decision.choice && !/^none$/i.test(value));
  return [...new Set(texts)].join(rows.some((row) => row && typeof row === "object") ? "; " : ", ");
}

export function proposedDecision(decision) {
  return String(decision?.status || "").trim().toLowerCase() === "proposed";
}

export function renderDraftDecisions(decisions) {
  if (!Array.isArray(decisions))
    throw new Error("standard start draft requires decisions to be an array; use [] when no durable decision qualifies");
  if (!decisions.length) return "`none`";
  const optional = (label, value) => value && !/^none$/i.test(String(value))
    ? `\n  - **${label}:** ${value}` : "";
  return decisions.map((decision, index) => {
    const decisionId = decision.id || `DEC-${String(index + 1).padStart(3, "0")}`;
    const rejected = renderRejectedOptions(decision);
    const drivers = decisionTextList(decision.drivers ?? []);
    const context = [
      decision.context || decision.question || "",
      drivers.length ? `Drivers: ${drivers.join(", ")}.` : ""
    ].filter(Boolean).join(" ");
    const consequences = [
      decision.consequences || "Not stated in the draft",
      decision.confirmation ? `Confirmation: ${decision.confirmation}` : ""
    ].filter(Boolean).join(" ");
    return `- **Decision ID:** ${decisionId}\n` +
      `  - **Status:** ${decision.status || "accepted"}` +
      optional("Context", context) +
      `\n  - **Decision:** ${decision.choice}\n  - **Why:** ${decision.why || decision.reason}\n` +
      `  - **Rejected:** ${rejected || "none"}\n` +
      `  - **Consequences:** ${consequences}` +
      optional("Decided by", decision.decidedBy) +
      optional("Decision ref", decision.decisionRef) +
      optional("Supersedes", decision.supersedes) +
      optional("Superseded by", decision.supersededBy);
  }).join("\n");
}

export function draftBullets(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function tableCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|");
}

// A rapid packet has no design.md, so the decisions it records (normally the
// defaults the agent chose without asking) are listed in the proposal.
export function renderRapidDecisions(decisions = []) {
  const rows = (Array.isArray(decisions) ? decisions : [])
    .filter((decision) => !proposedDecision(decision))
    .filter((decision) => String(decision?.key || "").trim() && String(decision?.choice || "").trim())
    .map((decision) => {
      const reason = authoredDecisionReason(decision);
      const by = String(decision.decidedBy || "").trim().toLowerCase() || "agent";
      return `- **${decision.key}:** ${decision.choice}` + (reason ? ` — ${reason}` : "") +
        ` (decided by ${by})`;
    });
  return rows.length ? `## Decisions\n\n${rows.join("\n")}` : "";
}

// A proposed decision is not yet agreed: the proposal lists it with the
// options on the table so the user ratifies or changes it before approval.
export function renderProposedDecisions(decisions = [], language = "") {
  const thai = /^th\b/i.test(String(language || ""));
  const rows = (Array.isArray(decisions) ? decisions : [])
    .filter((decision) => proposedDecision(decision) && String(decision?.choice || "").trim())
    .map((decision) => {
      const reason = authoredDecisionReason(decision);
      const options = (Array.isArray(decision.options) ? decision.options : [])
        .map(renderDecisionOption).filter(Boolean);
      // Every authored part of a proposed decision is shown: it has no other
      // home until it is accepted and moves to design.md.
      const drivers = decisionTextList(decision.drivers ?? []);
      const details = [
        drivers.length ? `${thai ? "ปัจจัย" : "Drivers"}: ${drivers.join(", ")}` : "",
        meaningful(decisionText(decision.consequences))
          ? `${thai ? "ผลที่ตามมา" : "Consequences"}: ${decisionText(decision.consequences)}` : "",
        meaningful(decisionText(decision.confirmation))
          ? `${thai ? "ยืนยันโดย" : "Confirmation"}: ${decisionText(decision.confirmation)}` : ""
      ].filter(Boolean);
      return `- **${decision.key || decision.id}:** ${decision.choice}` + (reason ? ` — ${reason}` : "") +
        (options.length ? ` (options: ${options.join("; ")})` : "") +
        (details.length ? `. ${details.join(". ")}` : "");
    });
  if (!rows.length) return "";
  const heading = /^th\b/i.test(String(language || "")) ? "เรื่องที่ต้องให้ผู้ใช้ตัดสิน" : "Decisions to ratify";
  return `## ${heading}\n\n${rows.join("\n")}`;
}

// A standard draft the agent left without a reason, failure matrix, or evidence
// capabilities still compiles; this appendix tells the reader what the harness
// filled in rather than what the author wrote.
function derivedNotesBody(draft, rapid) {
  const notes = derivedByHarness(draft, { standard: !rapid });
  return notes.length ? draftBullets(notes) : "";
}

// A renderer that returns its own "## " heading supplies only the body; the
// outline row supplies the localized heading.
function sectionBody(markdown) {
  return String(markdown || "").replace(/^## [^\n]*\n+/, "").trim();
}

function proposalImpact(draft, state, rapid) {
  const triggers = (draft.securityTriggers || []).filter(Boolean);
  const fixes = (draft.fixes || []).length ? [`- **Fixes:** ${draft.fixes.join(", ")}`] : [];
  return [
    `- **Impact:** ${riskLabel(draft, "impact") || state.impact || "medium"}`,
    `- **Coupling:** ${riskLabel(draft, "coupling") || state.coupling || "coupled"}`,
    // A rapid change states only what departs from its defaults (code
    // surface, no security trigger); the standard lane keeps the statement.
    ...(rapid && !(draft.surfaces || []).some((surface) => surface !== "code") ? [] :
      [`- **Affected surfaces:** ${(draft.surfaces || ["code"]).join(", ")}`]),
    ...(rapid && !triggers.length ? [] :
      [`- **Security triggers:** ${triggers.length ? triggers.join(", ") : "none detected"}`]),
    ...(rapid && docsOnlyDraft(draft)
      ? ["- **Specs:** none; docs-only work modifies no living spec"] : []),
    ...fixes
  ].join("\n");
}

function provenanceBody(value) {
  if (!value || typeof value !== "object") return String(value ?? "").trim();
  return Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
    .map(([key, entry]) => `- **${key}:** ${typeof entry === "object" ? JSON.stringify(entry) : entry}`).join("\n");
}

function amendmentsBody(value) {
  return (Array.isArray(value) ? value : []).map((row) => typeof row === "string" ? `- ${row}` :
    `- ${[row?.at || row?.date, row?.reason || row?.summary].filter(Boolean).join(": ")}`)
    .filter((line) => line !== "- ").join("\n");
}

// A v5 draft's authored prose for one author-owned outline row, exactly as
// written: only the blank lines separating it from its heading and from the
// next section are dropped. Derived and machine rows never take prose.
function authoredProse(draft, document, row) {
  if (row.owner !== "author") return "";
  const body = draft?.prose?.[document]?.[row.key];
  if (typeof body !== "string") return "";
  return body.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

// The outline rows a document renders, in outline order: those whose
// condition holds plus any author row the v5 prose fills.
function outlineRowsWithProse(document, draft, context) {
  const included = new Set(outlineSections(document, draft, context).map((row) => row.key));
  return OUTLINE[document].filter((row) => included.has(row.key) || authoredProse(draft, document, row));
}

// Reading order comes from the outline contract: decisions a reader makes
// (summary, why, stories, success, scope, impact, open decisions, process
// records) come first, then acceptance and Definition of done, and only then
// the appendices. Each fact has one home: tasks and their checks live in
// tasks.md (the acceptance table links to them), the folder tree sits in
// design.md's file map, and a rapid packet, which has no design.md, keeps its
// decisions and compact dev document here. A row with nothing to say is
// omitted, and archive-only rows never render before Land. `context` carries
// harness-derived facts the draft does not hold: the review route label
// (policy) and repositories the change does not select.
export function renderDraftProposal(draft, state, context = {}) {
  const title = draft.title || state.intent;
  const language = draft.language;
  const rapid = state?.schema === "foundation-rapid";
  // A rapid change has no design.md, so its compact dev document (flow,
  // components, descriptive sections the agent wrote, failures) lives here.
  // Authoring them never moves the change off rapid.
  const compact = rapid && isSemanticVersion(draft._semanticVersion);
  const compactPlan = () => [
    renderUserFlow(draft), renderComponentMap(draft), renderDesignBlueprints({
      workType: draft.workType, bugfix: draft.bugfix, refactor: draft.refactor, configContract: draft.configContract,
      failureMatrix: derivedFailureMatrix(draft),
      fileMap: fileMapWithTasks(draft.fileMap, draft.tasks), testMap: draft.testMap
    })].filter(Boolean);
  const fieldRender = (key) => PROCESS_FIELDS[key].render(draft[key], { language });
  const bodies = {
    summary: () => String(draft.summary || "").trim(),
    why: () => String(draft.why || "").trim(),
    userStories: () => renderUserStories(draft, language),
    successCriteria: () => renderSuccessCriteria(draft),
    scope: () => sectionBody(renderScope(draft, context)),
    capabilities: () => capabilityTable(draft),
    impact: () => proposalImpact(draft, state, rapid),
    decisionsToRatify: () => [sectionBody(renderProposedDecisions(draft.decisions, language)),
      renderOpenQuestions(draft)].filter(Boolean).join("\n"),
    decisionLog: () => fieldRender("decisionLog"),
    communication: () => [fieldRender("communication"),
      (() => {
        const note = fieldRender("releaseNote");
        return note ? `### Release note\n\n${note}` : "";
      })()].filter(Boolean).join("\n\n"),
    demo: () => fieldRender("demo"),
    acceptance: () => sectionBody(renderTraceability(draft)),
    definitionOfDone: () => sectionBody(renderDefinitionOfDone(draft, context)),
    investigation: () => investigationAppendixBody(draft, title),
    discovery: () => discoveryAppendixBody(draft, language),
    derived: () => derivedNotesBody(draft, rapid),
    provenance: () => provenanceBody(draft.provenance),
    amendments: () => amendmentsBody(draft.amendments ?? context.amendments)
  };
  // Content the outline places right after a row: authored Constraints and
  // Non-goals close Scope (their headings are what Land and PR readers find),
  // the rapid compact dev document follows them, and a rapid packet's
  // decisions follow Impact.
  const after = {
    scope: () => [
      (draft.constraints || []).length ? `## Constraints\n\n${draftBullets(draft.constraints)}` : "",
      (draft.nonGoals || []).length ? `## Non-goals\n\n${draftBullets(draft.nonGoals)}` : "",
      ...(compact ? compactPlan() : [])],
    impact: () => [rapid ? renderRapidDecisions(draft.decisions) : ""]
  };
  const sections = [];
  for (const row of outlineRowsWithProse("proposal", draft, { language, archived: false })) {
    if (row.archiveOnly || row.key === "header") continue;
    const body = [authoredProse(draft, "proposal", row), bodies[row.key]?.() || ""]
      .filter(Boolean).join("\n\n");
    if (body) sections.push(`## ${sectionHeading(row, language)}\n\n${body}`);
    sections.push(...(after[row.key]?.() || []).filter(Boolean));
  }
  const header = renderPacketHeader(draft, state, context);
  return [`# Change: ${title}`, header, ...sections].filter(Boolean).join("\n\n") + "\n";
}

// Keeps the harness-owned facts of a proposal current when resolve changes
// them: impact, coupling, the lane (a rapid change upgraded to standard), and
// the review line of the definition of done. Authored text is never touched,
// and a proposal in an older layout (no such lines) is returned unchanged.
export function synchronizeProposalClassification(proposal, state, context = {}) {
  let next = String(proposal || "");
  if (state.upgradedFrom === "foundation-rapid")
    next = next.replace(/(\*\*Lane:\*\* )rapid \([^\n]*\)/,
      "$1standard (upgraded from rapid at resolve; see Impact)");
  if (context.reviewLabel) {
    next = next.replace(/^(- Review: ).*$/m, (line, prefix) => `${prefix}${context.reviewLabel}.`);
    // The header names the tier of the same route.
    next = next.replace(/^(- \*\*Review:\*\* )[^·\n]*?(?=( · |$))/m,
      (line, prefix) => `${prefix}${reviewTier(context.reviewLabel)}`);
  }
  for (const [label, value] of [
    ["Impact", state.impact], ["Coupling", state.coupling]
  ]) {
    if (!value) continue;
    const pattern = new RegExp(
      `^(\\s*-\\s*\\*\\*${label}:\\*\\*\\s*)(.*)$`, "im");
    // A derived value keeps its "(derived: ...)" reason while it still holds.
    next = next.replace(pattern, (line, prefix, current) =>
      current === value || current.startsWith(`${value} (derived: `) ? line : `${prefix}${value}`);
  }
  return next;
}

export function draftDomainRows(domainLanguage = []) {
  return domainLanguage.length
    ? domainLanguage.map((term) =>
      `| ${term.term} | ${term.meaning} | ${term.avoid} |`).join("\n")
    : "| `none` | This change introduces no project-specific term. | `none` |";
}

function meaningful(value) {
  const normalized = String(value ?? "").trim();
  return normalized && !/^`?none`?[.]?$/i.test(normalized) ? normalized : "";
}

// The open questions of a compiled proposal: the plain bullets of its
// "Decisions to ratify and open questions" section (proposed decisions are
// the bold-keyed bullets beside them).
export function proposalOpenQuestions(proposal) {
  const row = outlineRow("proposal", "decisionsToRatify");
  const headings = [row.heading.en, row.heading.th].map((heading) =>
    heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const section = String(proposal || "")
    .match(new RegExp(`^## (?:${headings})\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"))?.[1] || "";
  return [...section.matchAll(/^- (?!\*\*)(.+?)\s*$/gm)].map((match) => match[1]);
}

// Rows whose English heading is a parser marker: packetWorkTypes reads
// "## Work type" (and the refactor/bugfix headings), durableDecisionSection
// reads "## Decisions". They keep that heading in every packet language.
const DESIGN_MARKER_ROWS = new Set(["workType", "decisions", "bugfix", "refactor"]);

function designLanguage(draft) {
  return /^th\b/i.test(String(draft?.language || "")) ? "th" : "en";
}

function designText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return renderDecisionOption(value) ||
    Object.values(value).map((item) => String(item ?? "").trim()).filter(Boolean).join(" — ");
  return String(value).trim();
}

function mermaidBlock(value) {
  const source = typeof value === "string" ? value : value?.source;
  if (!String(source || "").trim()) return "";
  const purpose = typeof value === "object" ? designText(value?.purpose) : "";
  return `${purpose ? `${purpose}\n\n` : ""}\`\`\`mermaid\n${String(source).trim()}\n\`\`\``;
}

function designDiagrams(diagrams) {
  return (Array.isArray(diagrams) ? diagrams : []).map((diagram) => {
    const title = diagram.title || diagram.key;
    if (diagram.type === "mermaid" && diagram.source)
      return `### ${title}\n\n${diagram.purpose || ""}\n\n\`\`\`mermaid\n${diagram.source}\n\`\`\``;
    const target = diagram.path || diagram.source;
    return `### ${title}\n\n${diagram.purpose || ""}\n\n[Diagram source](${target})`;
  }).join("\n\n");
}

function joinParts(...parts) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join("\n\n");
}

// design.md follows the outline contract: each row renders once, under its
// localized heading, from its typed field module or the derived renderer, so
// no fact is written twice. Empty rows are omitted rather than rendered as
// `none` placeholders. Open questions live only in the proposal; proposed
// decisions wait for the user there too, so design.md records only accepted
// or superseded decisions.
export function renderDraftDesign(draft) {
  const language = designLanguage(draft);
  const field = (key) => {
    const value = draft[key];
    if (value === undefined || value === null) return "";
    try { return DESIGN_FIELDS[key].render(value, { language }); }
    catch { return ""; }
  };
  const declared = draftWorkTypes(draft);
  const inferred = declared.length ? [] : inferWorkTypes(draft);
  const decisions = [...(draft.decisions || []), ...intakeDecisions(draft)]
    .filter((decision) => !proposedDecision(decision));
  const risks = (draft.risks || []).filter((risk) => meaningful(risk?.risk))
    .map((risk) => `| ${risk.risk} | ${risk.mitigation} | ${risk.owner} |`).join("\n");
  const assumptions = (Array.isArray(draft.assumptions) ? draft.assumptions : [draft.assumptions])
    .map(designText).filter(Boolean);
  const authoredFileMap = Array.isArray(draft.fileMap) && draft.fileMap.length > 0;
  const componentMap = sectionBody(renderComponentMap(draft));
  const domain = field("domain");
  const prototype = draft.prototypeSelection;
  const bodies = {
    overview: () => meaningful(designText(draft.overview)),
    currentState: () => meaningful(draft.currentState),
    domainLanguage: () => (draft.domainLanguage || []).length
      ? `| Canonical term | Meaning | Avoid |\n|---|---|---|\n${draftDomainRows(draft.domainLanguage)}` : "",
    assumptions: () => assumptions.map((row) => `- ${row}`).join("\n"),
    workType: () => sectionBody(renderWorkType(declared, inferred)),
    architecture: () => joinParts(mermaidBlock(draft.diagram), field("boundaries")),
    tenancy: () => field("tenancy"),
    userFlow: () => sectionBody(renderUserFlow(draft)),
    runtime: () => designDiagrams(draft.diagrams),
    domainModel: () => joinParts(domain,
      componentMap && domain ? `### ${language === "th" ? "แผนที่ component" : "Component map"}\n\n${componentMap}`
        : componentMap),
    apiContracts: () => Array.isArray(draft.apiContracts) ? field("apiContracts") : "",
    eventContracts: () => joinParts(field("eventContracts"), renderJobContractBody(draft.jobContract)),
    dataModel: () => field("dataModel"),
    uiContract: () => joinParts(field("ui"), renderUiStatesBody(draft.uiStates)),
    configContract: () => field("configContract"),
    integrations: () => field("integrations"),
    decisions: () => decisions.length ? renderDraftDecisions(decisions) : "",
    observability: () => joinParts(field("observability"), field("trackingPlan")),
    rollout: () => joinParts(meaningful(draft.compatibility), field("rollout")),
    risks: () => risks ? `| Risk | Mitigation | Evidence owner |\n|---|---|---|\n${risks}` : "",
    fileMap: () => renderFileMapBody(authoredFileMap ? fileMapWithTasks(draft.fileMap, draft.tasks)
      : derivedFileMap(draft), { derived: !authoredFileMap, fileTree: renderFileTree(draft) }),
    prototype: () => prototype
      ? `- **Selected:** ${prototype.selected}\n- **Reference:** ${prototype.reference}\n` +
        `- **Reason:** ${prototype.reason || "Recorded in the selection reference"}` : ""
  };
  const context = { workTypes: declared.length ? declared : inferred, language };
  const sections = [];
  // Derived rows count as supplied: settled intake answers are decisions, and
  // failure and test maps read from scenarios and task checks.
  const failureMatrix = derivedFailureMatrix(draft);
  const testMap = derivedTestMap(draft);
  bodies.failureMatrix = () => renderFailureMatrixBody(failureMatrix);
  bodies.testMap = () => renderTestMapBody(testMap);
  for (const row of outlineRowsWithProse("design", { ...draft, decisions, failureMatrix, testMap }, context)) {
    const render = bodies[row.key] || (DESIGN_FIELDS[row.key] ? () => field(row.key) : null);
    const body = [authoredProse(draft, "design", row), render ? String(render() || "").trim() : ""]
      .filter(Boolean).join("\n\n");
    if (!body) continue;
    const heading = DESIGN_MARKER_ROWS.has(row.key) ? row.heading.en : sectionHeading(row, language);
    sections.push(`## ${heading}\n\n${body}`);
  }
  return `# Design\n\n${sections.join("\n\n")}\n`;
}

// The review route a change will take, in words that cannot be misread.
// Under risk-tiered policy every change but a quiet low-tier rapid change gets
// an AI review, so the tier and the model class of its first pass are named
// instead. Legacy policy keeps its required/not-required meaning.
export function reviewRouteLabel({
  reviewPolicy = "legacy", lowRiskModel = "fast", modelByTier = undefined,
  state = {}, claims = [], grounding = null
} = {}) {
  const rows = (Array.isArray(claims) ? claims : []).filter((claim) =>
    claim && typeof claim === "object" && Array.isArray(claim.capabilities));
  let signals;
  try { signals = collectReviewSignals(state, { claims: rows }, [], grounding); }
  catch { signals = null; }
  if (reviewPolicy === "risk-tiered") {
    if (!signals) return "risk-tiered AI review (tier set at validation)";
    const riskRoute = classifyReviewRisk({
      state, claims: rows, capabilities: signals.capabilities, grounding,
      requiredTriggers: signals.requiredTriggers
    });
    const { tier } = riskRoute;
    const assembled = assembleReviewPolicy({
      state, signals, riskRoute, policy: {}, riskTiered: true
    });
    if (!assembled.required)
      return "not required (rapid lane, low tier: deterministic evidence only)";
    const model = reviewModelClass({
      tier, triggers: assembled.triggers,
      declaredReview: Boolean(state.reviewRequired) && !state.reviewKeywordOnly,
      settings: { lowRiskModel, modelByTier }
    });
    return `risk-tiered AI review (${tier} tier, ${model} model)`;
  }
  const required = Boolean(state.reviewRequired) ||
    Boolean(signals && (signals.requiredTriggers.length || signals.capabilities.has("review")));
  return required ? "required" : "not required (legacy review policy: no AI review runs)";
}

// Legacy v1/v2 drafts always declare decisions and keep their rapid lane; a
// semantic draft that authored design content must not lose it to rapid.
export function semanticDraftKeepsDesign(draft, rapid) {
  // Authored content only: a declared work type alone is not design content,
  // and neither is a default the agent recorded without asking. Purely
  // descriptive dev-document sections render compactly in a rapid proposal,
  // so they never move a low-risk change to standard; risk still does.
  return Boolean(rapid) && isSemanticVersion(draft?._semanticVersion) &&
    draftNeedsDesign({
      ...draft, workType: [],
      ...Object.fromEntries(RAPID_DESCRIPTIVE_SECTIONS.map((key) => [key, undefined])),
      decisions: (draft.decisions || []).filter((decision) => !agentDecision(decision))
    });
}

// Dev-document sections that describe the change rather than decide it.
const RAPID_DESCRIPTIVE_SECTIONS = Object.freeze([
  "fileMap", "failureMatrix", "testMap", "componentMap", "userFlow", "configContract", "refactor",
  "bugfix"
]);

export function draftNeedsDesign(draft) {
  return Boolean(
    draft.design || draftHasBlueprints(draft) || draft.prototypeSelection || (draft.diagrams || []).length ||
    (draft.integrations || []).length || (draft.decisions || []).length ||
    intakeDecisions(draft).length || draft.diagram ||
    (draft.assumptions || []).length || (draft.openQuestions || []).length ||
    (draft.risks || []).length ||
    (draft.compatibility && String(draft.compatibility).toLowerCase() !== "none") ||
    (draft.specs || []).some((spec) =>
      String(spec.operation || "added").toLowerCase() === "removed")
  );
}

export function renderDraftTask(task, index) {
  const taskId = task.id || `T${String(index + 1).padStart(3, "0")}`;
  const metadata = [
    task.semanticKey ? `[key:${task.semanticKey}]` : "",
    task.repository ? `[repo:${task.repository}]` : "",
    task.kind ? `[kind:${task.kind}]` : "",
    task.requestedModel || task.model
      ? `[model:${task.requestedModel || task.model}]` : "",
    task.paths?.length ? `[paths:${task.paths.join(",")}]` : "",
    task.dependsOn?.length ? `[depends:${task.dependsOn.join(",")}]` : "",
    task.resources?.length ? `[resources:${task.resources.join(",")}]` : "",
    task.claims?.length ? `[claims:${task.claims.join(",")}]` : "",
    task.inputSchema ? `[input-schema:${task.inputSchema}]` : "",
    task.outputSchema ? `[output-schema:${task.outputSchema}]` : ""
  ].filter(Boolean).join(" ");
  return `- [ ] **${taskId}** ${task.outcome} ${metadata} — verify: \`${task.verify}\``;
}

// Shown by `change start --template` only when the project declares
// repositories besides the control root (nested or trusted siblings): a draft
// that omits the binding compiles every task into root, where their code is
// not built. A read repository is listed with its mode; it owns no edits.
export function repositoryDraftGuidance(repositories = []) {
  const declared = (Array.isArray(repositories) ? repositories : [])
    .filter((row) => row?.id && row.id !== "root" && row.relativePath &&
      row.relativePath !== "." && row.relativePath !== "..");
  if (!declared.length) return {};
  const first = declared.find((row) => row.mode !== "read") || declared[0];
  return {
    minimalDraftRepositories: "This project declares repositories besides root. A task " +
      "whose files live in one names it in 'repository', writes 'paths' and 'verify' " +
      "relative to that repository's root (verify runs there; no cd into it), and the " +
      "draft lists every repository its tasks use in 'repositories' (add root when a task " +
      "edits root files). Omit both for root-only work.",
    declaredRepositories: declared.map((row) => ({ id: row.id, path: row.relativePath,
      ...(row.mode === "read" ? { mode: "read" } : {}) })),
    repositoryExample: {
      repositories: [{ id: first.id, mode: "write" }],
      tasks: [{
        outcome: "Implement and verify the bounded outcome",
        repository: first.id, paths: ["src/**"], verify: "npm test"
      }]
    }
  };
}

export function renderDraftTasks(tasks) {
  return `# Tasks\n\n> This is the sole implementation ledger.\n\n` +
    tasks.map(renderDraftTask).join("\n") + "\n";
}

// A draft without an id is named from its intent; an intent that slugs to
// fewer than three words (a Thai intent slugs to "change") is named from its
// first capability and requirement key so the id stays meaningful.
export function draftChangeId(draft, slugify) {
  if (draft?.id) return slugify(String(draft.id));
  const fromIntent = slugify(String(draft?.intent || ""));
  if (fromIntent.split("-").filter(Boolean).length >= 3) return fromIntent;
  const spec = Array.isArray(draft?.specs) ? draft.specs[0] : null;
  const key = draft?._requirementKeys?.[0] || draft?.claims?.[0]?.requirementKey ||
    spec?.requirement;
  if (!spec?.name || !key) return fromIntent;
  return slugify(`${spec.name}-${key}`);
}

export function groupDraftSpecs(specs, slugify) {
  const grouped = new Map();
  for (const spec of specs) {
    const capability = slugify(spec.name);
    grouped.set(capability, [...(grouped.get(capability) || []), spec]);
  }
  return grouped;
}

export function renderDraftSpecDocument(specs, renderRequirement, { newCapability = false } = {}) {
  const operationOrder = ["added", "modified", "removed"];
  const sections = operationOrder.flatMap((operation) => {
    const requirements = specs.filter((spec) =>
      String(spec.operation || "added").toLowerCase() === operation);
    if (!requirements.length) return [];
    return [`## ${operation.toUpperCase()} Requirements\n\n` +
      requirements.map(renderRequirement).join("\n\n")];
  });
  const lead = specs.find((spec) => spec.title || spec.overview) || specs[0];
  return `${renderSpecHeading(lead, { newCapability })}` +
    `\n\n${sections.join("\n\n")}\n`;
}

// `capabilityExists` reports whether openspec/specs already holds the
// capability; only a new capability's delta states a Purpose.
export function materializeDraftSpecs({
  basePath, specs, slugify, renderRequirement, capabilityExists = () => true,
  remove = rmSync, makeDirectory = mkdirSync, write = writeFileSync
}) {
  remove(join(basePath, "specs"), { recursive: true, force: true });
  for (const [capability, capabilitySpecs] of groupDraftSpecs(specs, slugify)) {
    const specDir = join(basePath, "specs", capability);
    makeDirectory(specDir, { recursive: true });
    write(join(specDir, "spec.md"),
      renderDraftSpecDocument(capabilitySpecs, renderRequirement,
        { newCapability: !capabilityExists(capability) }));
  }
}

export function deriveDraftBookkeeping(input, slugify) {
  const draft = structuredClone(input);
  const claims = (draft.claims || []).map((claim, index) => ({
    ...claim,
    id: claim.id || slugify(claim.scenario || `claim-${index + 1}`)
  }));
  const claimIds = claims.map((claim) => claim.id);
  draft.claims = claims;
  draft.tasks = (draft.tasks || []).map((task, index) => ({
    ...task,
    id: task.id || `T${String(index + 1).padStart(3, "0")}`,
    ...(!task.claims?.length && draft.tasks.length === 1 && claimIds.length
      ? { claims: claimIds } : {})
  }));
  if (draft.acceptance?.required && !draft.acceptance.claimIds?.length &&
      claimIds.length === 1)
    draft.acceptance.claimIds = claimIds;
  const providers = draft.execution?.providers || {};
  if (draft.tasks.length === 1 && draft.tasks[0].verify) {
    for (const provider of Object.values(providers))
      if (["test-discovery", "command"].includes(provider.adapter) && !provider.command)
        provider.command = ["sh", "-c", draft.tasks[0].verify];
  }
  if (draft.grounding?.claims?.length === claims.length)
    draft.grounding.claims = draft.grounding.claims.map((claim, index) => ({
      ...claim,
      id: claim.id || claims[index].id
    }));
  if (draft.grounding?.criticalCases) {
    draft.grounding.criticalCases = draft.grounding.criticalCases.map((row, index) => ({
      ...row,
      id: row.id || `CC-${String(index + 1).padStart(3, "0")}`,
      ...(!row.claimIds?.length && claimIds.length === 1
        ? { claimIds: claimIds } : {})
    }));
    const caseIds = draft.grounding.criticalCases.map((row) => row.id);
    for (const provider of Object.values(draft.execution?.providers || {}))
      if (["test-discovery", "playwright"].includes(provider.adapter) &&
          !provider.criticalCases?.length)
        provider.criticalCases = caseIds;
  }
  return draft;
}

// The approval package is a reading aid: a render failure becomes a warning
// and the user approves from the packet as before.
export function approvalPackageLine(link) {
  if (link?.path) return `  approval package: ${link.path}\n`;
  if (link?.error) return `  warning: approval package not written (${link.error}); review the packet, then run claude-foundation package <change>\n`;
  return "";
}

// Advisory only, never a repair: what the approval page will lack. A medium or
// high change without concrete examples, a performance change without a target
// number, or a defect or migration without an affected count. Kept apart from
// the coverage note so that line's wording stays unchanged.
const SCRATCH_COUNT_WORK = new Set(["bugfix", "migration", "deprecation"]);
const hasDigit = (value) => /\d/.test(String(value ?? ""));
export function scratchNoteLine(draft) {
  const impact = String(draft?.impact || "").trim().toLowerCase();
  if (impact !== "medium" && impact !== "high") return "";
  const examples = Array.isArray(draft?.examples) ? draft.examples : [];
  const types = new Set((Array.isArray(draft?.workType) ? draft.workType : [draft?.workType]).map((type) => String(type || "")));
  const signals = new Set(Array.isArray(draft?.riskSignals) ? draft.riskSignals : []);
  const gaps = [];
  if (!examples.length) gaps.push("no concrete example (optional 'examples')");
  if (types.has("performance") || signals.has("performance-slo")) {
    const target = examples.some((row) => row?.type === "perf" &&
      (row.metrics || []).some((metric) => typeof metric?.target === "number"));
    if (!target && !hasDigit(draft?.successMeasure)) gaps.push("no target number (perf example target or 'successMeasure')");
  }
  if ([...types].some((type) => SCRATCH_COUNT_WORK.has(type)) && !hasDigit(draft?.scratch?.asIs))
    gaps.push("no affected count (optional 'scratch.asIs')");
  return gaps.length ? `scratch (advisory, approval page): ${gaps.join("; ")}` : "";
}

// Advisory only, never a repair or a gate: a touched path that points at a risk
// the draft neither declares nor covers in discovery (a migration file with no
// persisted-data-change coverage, say). A declared signal is already held to its
// coverage by intake, so only undeclared ones are named here.
export function pathRiskNoteLine(draft) {
  const paths = [
    ...(Array.isArray(draft?.tasks) ? draft.tasks.flatMap((task) => Array.isArray(task?.paths) ? task.paths : []) : []),
    ...(Array.isArray(draft?.fileMap) ? draft.fileMap.map((row) => row?.path).filter(Boolean) : [])
  ];
  const declared = new Set((Array.isArray(draft?.riskSignals) ? draft.riskSignals : [])
    .map((signal) => String(signal).trim().toLowerCase()));
  const covered = new Set((Array.isArray(draft?.discovery?.coverage) ? draft.discovery.coverage : [])
    .filter((row) => ["covered", "not-applicable"].includes(String(row?.status || "").toLowerCase()))
    .map((row) => row.dimension));
  const dimensions = riskSignalDimensions();
  const gaps = inferPathSignals(paths).filter((row) => !declared.has(row.signal)).flatMap((row) => {
    const missing = (dimensions[row.signal] || []).filter((dimension) => !covered.has(dimension));
    return missing.length ? [`${row.path} suggests ${row.signal} (no coverage for ${missing.join(", ")})`] : [];
  });
  return gaps.length
    ? `path risk (advisory): ${gaps.join("; ")}; declare the riskSignal or add discovery coverage rows when it applies`
    : "";
}

export function createChangeLifecycle({
  root,
  policy,
  approvalPackageLink = () => null,
  // { configured, required }: roles from approval.roles and the lanes this
  // change needs (configured roles the scratch router selects).
  approvalLanes = () => ({ configured: [], required: [] }),
  securityTerms,
  fail,
  pathInside,
  readJson,
  writeJson,
  slugify,
  changePath,
  activeChangePath = changePath,
  loadRuntime,
  saveRuntime,
  setOperationChangeId,
  initialBudget,
  git = null,
  gitHead,
  preexistingDirty,
  now,
  bindClaudeSession,
  validate,
  showPacket,
  measureStage,
  receiptPath = null,
  receiptValidity = null,
  contractFingerprint = null,
  requiredProviders = null,
  providerConfig = null,
  claimsForProvider = null,
  providerWorkspaceHash = null,
  providerInputIdentity = null,
  relevantHash = null,
  stableHash = null,
  trapFailures = (operation) => operation(),
  rollbackStart = () => [],
  repositoryCatalog = null
}) {
  // Declared repositories other than the control root (submodules and
  // registered siblings). An unreadable catalog is reported by the commands
  // that use it; here it only means no repository-binding checks apply.
  function declaredRepositories() {
    if (!repositoryCatalog) return [];
    try {
      const rows = trapFailures(() => repositoryCatalog())?.repositories;
      return Array.isArray(rows) ? rows.filter((row) => row?.id && row.id !== "root") : [];
    } catch { return []; }
  }

  function changeRepositorySelection(changeDir) {
    const path = join(changeDir, "repositories.yaml");
    if (!existsSync(path)) return ["root"];
    try {
      const rows = readJson(path).repositories;
      return Array.isArray(rows)
        ? rows.map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean)
        : ["root"];
    } catch { return ["root"]; }
  }

  // The selection rows themselves, so a repository `dependsOn` is visible.
  function changeRepositoryRows(changeDir) {
    const path = join(changeDir, "repositories.yaml");
    if (!existsSync(path)) return null;
    try {
      const rows = readJson(path).repositories;
      return Array.isArray(rows) ? rows : null;
    } catch { return null; }
  }

  const workflowPolicy = () => typeof policy === "function" ? policy() : policy;

  function amendmentRevision(state) {
    return JSON.stringify({
      revision: Number(state.revision || 0),
      contractRevision: Number(state.contractRevision || 0),
      executionRevision: Number(state.executionRevision || 0)
    });
  }

  function assertAmendmentRevision(id, expected, label = "change amendment") {
    if (amendmentRevision(loadRuntime(id)) !== expected)
      fail(`${label} for '${id}' conflicted with a newer change revision; ` +
        "reload the active agreement and retry");
  }

  // Amend and revise share one per-change lock so neither can replace the
  // packet or runtime state while the other is mid-transaction.
  function withAmendmentLock(id, observedRevision, operation, label = "change amendment") {
    const lock = acquireProcessLock(
      join(root, ".foundation", "locks", `amend-${id}.lock`), { now });
    if (!lock.acquired)
      fail(`${label} for '${id}' is already in progress; ` +
        "reload the active agreement and retry");
    try {
      assertAmendmentRevision(id, observedRevision, label);
      return operation();
    } finally {
      lock.release();
    }
  }

  function selectiveBinding(id, provider, contractRevision, receipt = null) {
    if (!receiptValidity || !providerConfig || !claimsForProvider || !providerWorkspaceHash ||
        !providerInputIdentity || !relevantHash || !stableHash) return null;
    const config = providerConfig(id, provider);
    const claims = claimsForProvider(id, provider).map((claim) => claim.id).sort();
    const workspaceHash = providerWorkspaceHash(id, provider, relevantHash(id));
    const inputs = providerInputIdentity(id, provider, config, workspaceHash);
    return {
      provider,
      status: receipt?.status || "pass",
      validity: receipt ? receiptValidity(id, provider, workspaceHash).validity : "valid",
      binding: {
        contractRevision,
        providerFingerprint: stableHash({ config, claims }),
        claimsFingerprint: stableHash(claims),
        inputIdentity: inputs
      }
    };
  }
  function templateDir(schema) {
    return join(root, "openspec", "schemas", schema, "templates");
  }

  function instantiate(path, title) {
    return readFileSync(path, "utf8")
      .replaceAll("<title>", title)
      .replaceAll("replace-with-stable-claim-id", `${slugify(title)}-outcome`);
  }

  function assertChangeAvailable(id) {
    if (existsSync(changePath(id))) fail(`change already exists: ${id}`);
    settleAbandonedReviewResidue(root, id, now);
    const residue = priorChangeResidue(root, id);
    if (residue.length)
      fail(`change id '${id}' was used before and its recorded history remains ` +
        `(${residue.map((path) => path.slice(root.length + 1)).join(", ")}); pick a new id`);
  }

  // `folderIssues` (revise) collects a v5 folder's prose issues instead of
  // failing, so they reach the same EDIT batch as the draft's other issues.
  // `allowMissing` (start) also collects an unreadable change.json and returns
  // null, so the folder's issues still come back as one EDIT.
  function draftSource(draftPath, prior = {}, { folderIssues = null, allowMissing = false } = {}) {
    const source = resolve(root, draftPath);
    if (!pathInside(root, source) || !existsSync(source))
      fail("new --draft requires a JSON file inside the project (or a v5 draft folder)");
    // `minimalDraft` is the template's example key, never draft content. A
    // draft without `version` in the minimal v4 shape compiles as v4.
    const raw = statSync(source).isDirectory()
      ? draftFolderSource(source, folderIssues, { allowMissing }) : readJson(source);
    if (raw === null && allowMissing && folderIssues?.length) return null;
    const context = { ...minimalDraftContext, ...prior };
    // Impact and coupling are derived from the draft's content, never lowered.
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("minimalDraft" in raw))
      return withDerivedRisk(expandMinimalSemanticDraft(raw, context));
    const { minimalDraft: _example, ...draft } = raw;
    return withDerivedRisk(expandMinimalSemanticDraft(draft, context));
  }

  // A v5 draft folder: change.json plus authored proposal.md and design.md.
  function draftFolderSource(source, collect = null, { allowMissing = false } = {}) {
    const { draft, issues } = loadDraftFolder(source, { name: relative(root, source).replaceAll("\\", "/") || "." });
    if (issues.length && collect && (draft || allowMissing)) { collect.push(...issues); return draft; }
    if (issues.length) fail(`semantic draft validation failed:\n  - ${issues.join("\n  - ")}`);
    return draft;
  }

  // A minimal draft chooses among existing capabilities before inventing one.
  const minimalDraftContext = {
    loadCanonicalSpec: canonicalSpecText,
    listCanonicalCapabilities: () => {
      const specs = join(root, "openspec", "specs");
      if (!existsSync(specs)) return [];
      return readdirSync(specs, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(specs, entry.name, "spec.md")))
        .map((entry) => entry.name).sort();
    }
  };

  function canonicalSpecText(capability) {
    const path = join(root, "openspec", "specs", slugify(capability), "spec.md");
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  function semanticSourcePaths(source) {
    return [...new Set((source.discovery?.coverage || [])
      .flatMap((row) => Array.isArray(row?.sources) ? row.sources : [])
      .map((path) => String(path || "").trim()).filter(Boolean))];
  }

  function semanticIntakeStatePath(sourcePath, scope = "draft") {
    const source = relative(root, resolve(root, sourcePath)).replaceAll("\\", "/");
    // Preserve the v1/v2 draft-state filename while namespacing amendment
    // snapshots so one file can be inspected against different active changes.
    const identity = scope === "draft" ? source : `${scope}\0${source}`;
    const key = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    return join(root, ".foundation", "intake", `${key}.json`);
  }

  function semanticSourceInspection(source, baseline = null, discoveredPaths = []) {
    return inspectSemanticSources({
      projectRoot: root,
      sourcePaths: [...new Set([...semanticSourcePaths(source), ...discoveredPaths])],
      baseline
    });
  }

  function repositoryGitPaths() {
    if (typeof git !== "function") return { includedPaths: null, trackedPaths: [] };
    const tracked = git(["ls-files", "-z"], root);
    const included = git([
      "ls-files", "-z", "--cached", "--others", "--exclude-standard"
    ], root);
    if (tracked.status !== 0 || included.status !== 0)
      return { includedPaths: null, trackedPaths: [] };
    return {
      trackedPaths: tracked.stdout.split("\0").filter(Boolean),
      includedPaths: included.stdout.split("\0").filter(Boolean)
    };
  }

  // "skipped" (rapid-shaped change) is usable like "ready"; only "blocked" is not.
  const intelligenceUsable = (intelligence) =>
    ["ready", "skipped"].includes(intelligence.repository.status);

  function repositoryIntelligence(source, excludedPaths = [], { standardLane = false } = {}) {
    if (!repositoryIntelligenceRequired(source, { standardLane })) {
      const repository = skippedRepositoryIntelligence();
      const depth = planSemanticIntakeDepth(source, { repository: {} });
      return { repository, depth, selected: [], selectedBytes: 0 };
    }
    const query = [source.intent, source.why, ...(source.changes || []),
      ...(source.requirements || []).flatMap((row) => [
        row?.key, row?.requirement, row?.description, row?.outcome
      ])];
    const repositoryPaths = repositoryGitPaths();
    const excluded = new Set(excludedPaths.map((path) =>
      String(path || "").replaceAll("\\", "/")));
    const repository = inspectRepositoryIntelligence({
      projectRoot: root,
      query,
      seedPaths: semanticSourcePaths(source),
      trackedPaths: repositoryPaths.trackedPaths,
      excludedPaths: [...excluded],
      includedPaths: repositoryPaths.includedPaths === null ? null
        : repositoryPaths.includedPaths.filter((path) => !excluded.has(path)),
      limits: { maxReadSet: 48 }
    });
    const graph = repository.graph || {};
    const surfaces = graph.surfaces || {};
    const depth = planSemanticIntakeDepth(source, { repository: {
      candidateFileCount: repository.candidates?.length || 0,
      integrationCount: surfaces.integrations?.length || 0,
      dependentCount: graph.callers?.length || 0,
      persistenceBoundaryCount: surfaces.persistence?.length || 0,
      permissionBoundaryCount: surfaces.permissions?.length || 0
    } });
    let selectedBytes = 0;
    const selected = [];
    for (const row of repository.readSet || []) {
      if (selected.length >= depth.limits.maxSourceFiles) break;
      if (selectedBytes + row.bytes > depth.limits.maxSourceBytes) continue;
      selected.push(row.path);
      selectedBytes += row.bytes;
    }
    return { repository, depth, selected, selectedBytes };
  }

  function validateDraftFields(draft) {
    // A semantic draft may leave 'why' out; its proposal then has no Why
    // section instead of repeating the intent.
    const requiredStrings = isSemanticVersion(draft._semanticVersion)
      ? ["currentState", "compatibility"] : ["why", "currentState", "compatibility"];
    for (const field of requiredStrings)
      if (!String(draft[field] || "").trim())
        fail(`draft requires non-empty '${field}'`);
    const requiredArrays = isSemanticVersion(draft._semanticVersion)
      ? ["changes", "tasks", "claims", "specs"]
      : ["changes", "nonGoals", "decisions", "risks", "tasks", "claims", "specs"];
    for (const field of requiredArrays)
      if (!Array.isArray(draft[field]) || draft[field].length === 0)
        fail(`draft requires a non-empty '${field}' array`);
  }

  function domainLanguageIssues(draft) {
    if (draft.domainLanguage === undefined) return [];
    if (!Array.isArray(draft.domainLanguage)) return ["draft domainLanguage must be an array"];
    return draft.domainLanguage.flatMap((term, index) => ["term", "meaning", "avoid"]
      .filter((field) => !String(term?.[field] || "").trim())
      .map((field) => `draft domainLanguage[${index}].${field} is required`));
  }

  function validateDraftDomainLanguage(draft) {
    const issues = domainLanguageIssues(draft);
    if (issues.length === 1) fail(issues[0]);
    if (issues.length) fail(`draft domain language validation failed:\n  - ${issues.join("\n  - ")}`);
  }

  function validateDraftPolicy(draft) {
    if (workflowPolicy().workflow.grounding === "required" &&
        ![2, 3].includes(draft.grounding?.version))
      fail("draft requires grounding.version 2 or 3 from the single Decision Sheet");
    if (draft.externalOperations !== undefined && !Array.isArray(draft.externalOperations))
      fail("draft externalOperations must be an array");
  }

  function validateDraftSpec(spec, index, warnedLegacyOperation) {
    const label = `draft specs[${index}]`;
    for (const field of ["name", "requirement", "description"])
      if (!String(spec?.[field] || "").trim()) fail(`${label}.${field} is required`);
    const operation = String(spec.operation || "added").toLowerCase();
    let warned = warnedLegacyOperation;
    if (!spec.operation && !warned) {
      console.error("WARNING: legacy draft specs without operation are treated as added; declare added|modified|removed after comparing the canonical spec");
      warned = true;
    }
    if (!["added", "modified", "removed"].includes(operation))
      fail(`${label}.operation must be added|modified|removed`);
    const scenarios = normalizedDraftScenarios(spec);
    if (operation !== "removed" && scenarios.length === 0)
      fail(`${label}.scenarios must be non-empty for ${operation}`);
    for (const [scenarioIndex, scenario] of scenarios.entries())
      for (const field of ["name", "when", "then"])
        if (!String(scenario?.[field] || "").trim())
          fail(`${label}.scenarios[${scenarioIndex}].${field} is required`);
    if (operation === "removed" && !String(spec.migration || "").trim())
      fail(`${label}.migration is required for removed requirements`);
    return warned;
  }

  function validateDraftSpecs(draft) {
    let warnedLegacyOperation = false;
    for (const [index, spec] of draft.specs.entries()) {
      warnedLegacyOperation = validateDraftSpec(spec, index, warnedLegacyOperation);
    }
  }

  function loadDraft(draftPath, { deferPolicy = false, preparedSource = null } = {}) {
    const source = preparedSource || draftSource(draftPath);
    // Version 1 is a compatibility contract: callers that supplied every
    // ledger key receive the exact same object back. Version 2 delegates the
    // mechanical IDs and unambiguous cross-ledger bindings to the harness.
    let draft = source;
    if (source.version === 2) draft = deriveDraftBookkeeping(source, slugify);
    // Versions above the current semantic schema are unknown, not legacy.
    if (Number.isInteger(source.version) && source.version > 5)
      fail("semantic draft validation failed:\n  - semantic draft version must be 3, 4, or 5");
    if (isSemanticVersion(source.version)) {
      const normalized = normalizeSemanticDraft(source, slugify, {
        defaultRapidEvidence: true,
        requireScratch: true,
        requireUndo: true,
        repositories: declaredRepositories(),
        loadCanonicalSpec: (capability) => {
          const path = join(root, "openspec", "specs", slugify(capability), "spec.md");
          return existsSync(path) ? readFileSync(path, "utf8") : null;
        }
      });
      if (normalized.issues.length)
        fail(`semantic draft validation failed:\n  - ${normalized.issues.join("\n  - ")}`);
      draft = normalized.draft;
      validateSemanticReferences(draft);
    }
    validateDraftFields(draft);
    validateDraftDomainLanguage(draft);
    if (!deferPolicy) validateDraftPolicy(draft);
    validateDraftSpecs(draft);
    return draft;
  }

  function semanticReferenceIssues(draft) {
    const issues = [];
    const validateLocalFile = (field, value) => {
      const path = resolve(root, value);
      try {
        const project = realpathSync(root);
        const canonical = realpathSync(path);
        if (!pathInside(project, canonical) || !statSync(canonical).isFile())
          throw new Error("not a contained regular file");
      } catch {
        issues.push(`semantic draft ${field} must reference an existing regular file inside the project`);
      }
    };
    const referencedPaths = [];
    if (draft.prototypeSelection?.reference)
      referencedPaths.push(["prototypeSelection.reference", draft.prototypeSelection.reference]);
    for (const [index, row] of (draft.discovery?.coverage || []).entries())
      for (const [sourceIndex, source] of (row.sources || []).entries())
        referencedPaths.push([
          `discovery.coverage[${index}].sources[${sourceIndex}]`, source
        ]);
    for (const [index, diagram] of (draft.diagrams || []).entries()) {
      if (!["mermaid", "svg", "png"].includes(diagram?.type))
        issues.push(`semantic draft diagrams[${index}].type must be mermaid|svg|png`);
      if (!String(diagram?.key || "").trim())
        issues.push(`semantic draft diagrams[${index}].key is required`);
      if (!String(diagram?.purpose || "").trim())
        issues.push(`semantic draft diagrams[${index}].purpose is required`);
      if (diagram.type === "mermaid" && !String(diagram.source || "").trim())
        issues.push(`semantic draft diagrams[${index}].source is required`);
      if (diagram.type !== "mermaid") {
        const path = diagram.path || diagram.source;
        if (!String(path || "").trim())
          issues.push(`semantic draft diagrams[${index}].path is required`);
        else referencedPaths.push([`diagrams[${index}].path`, path]);
      }
    }
    for (const [field, value] of referencedPaths) validateLocalFile(field, value);
    for (const [index, integration] of (draft.integrations || []).entries()) {
      const source = String(integration?.documentation?.source || "").trim();
      if (!source) continue;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
        let url;
        try { url = new URL(source); }
        catch {
          issues.push(`semantic draft integrations[${index}].documentation.source must be a valid HTTPS URL`);
          continue;
        }
        if (url.protocol !== "https:")
          issues.push(`semantic draft integrations[${index}].documentation.source must use HTTPS`);
        const version = String(integration?.documentation?.version || "").trim();
        if (/^(?:latest|current|main|master|head)$/i.test(version))
          issues.push(`semantic draft integrations[${index}].documentation.version must identify a fixed version`);
        continue;
      }
      validateLocalFile(`integrations[${index}].documentation.source`, source);
    }
    return issues;
  }

  function validateSemanticReferences(draft) {
    const issues = semanticReferenceIssues(draft);
    if (issues.length) fail(issues.join("\n  - "));
  }

  function normalizedDraftScenarios(spec) {
    if (Array.isArray(spec.scenarios)) return spec.scenarios;
    return (spec.scenario || spec.when || spec.then)
      ? [{ name: spec.scenario, when: spec.when, then: spec.then }]
      : [];
  }

  function renderDraftRequirement(spec) {
    return renderRequirementMarkdown(spec, normalizedDraftScenarios(spec));
  }

  // Design blueprints warn rather than block: the agent completes a thin
  // design before presenting it for approval.
  // The compiled packet's files, so the agent opens real paths instead of
  // guessing where the compiler put each artifact.
  function packetFileLines(id) {
    const base = changePath(id);
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile()) files.push(relative(root, path).split("\\").join("/"));
      }
    };
    try { walk(base); } catch { return ""; }
    const lines = files.sort().map((file) => `  file: ${file}\n`);
    let semantic = false;
    try { semantic = isSemanticVersion(loadRuntime(id)?.semanticDraftVersion); } catch {}
    if (!files.some((file) => file.includes("/specs/")))
      lines.push(semantic
        ? "  specs: none (docs-only change; it modifies no living spec)\n"
        : "  specs: none (legacy rapid packet without delta specs)\n");
    // The task list, so the agent can start Build without opening tasks.md.
    try {
      for (const line of readFileSync(join(base, "tasks.md"), "utf8").split("\n")) {
        const task = line.match(/^\s*-\s*\[[ xX]\]\s*\*{0,2}(T\d+)\*{0,2}\s*(.*)$/);
        if (!task) continue;
        // Drop the bracketed ledger metadata; keep the outcome and its verify.
        const summary = task[2].replace(/\s*\[[a-z-]+:[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
        lines.push(`  task: ${task[1]} ${summary.slice(0, 200)}\n`);
      }
    } catch {}
    return lines.join("");
  }

  // `source` is the authored draft: unknown task fields are gone after
  // normalization. Every schema prints them; they never block.
  function designWarningLines(draft, schema, source = draft) {
    if (!isSemanticVersion(draft._semanticVersion)) return "";
    const verify = verifyCountAdvisories(draft.tasks)
      .map((warning) => `  verify advisory: ${warning}\n`).join("") +
      unknownTaskFieldWarnings(source).map((warning) => `  task warning: ${warning}\n`).join("");
    if (schema !== "foundation-standard") return verify;
    return [...designBlueprintWarnings(draft), ...readerGuideWarnings(draft)]
      .map((warning) => `  design warning: ${warning}\n`).join("") + verify;
  }

  // Facts the proposal states from policy and topology rather than from the
  // draft: the review route the change will take (the same label resolve
  // prints) and declared repositories its tasks do not select.
  function proposalContext(draft, state) {
    const declared = declaredRepositories().map((row) => row.id);
    const used = new Set([
      ...(Array.isArray(draft.repositories) ? draft.repositories : [])
        .map((entry) => (typeof entry === "string" ? entry : entry?.id)),
      ...(draft.tasks || []).map((task) => task.repository || "root")
    ].filter(Boolean));
    const policy = workflowPolicy();
    return {
      unselectedRepositories: declared.filter((repository) => !used.has(repository)),
      reviewLabel: reviewRouteLabel({
        reviewPolicy: policy.workflow?.reviewPolicy, lowRiskModel: policy.review?.lowRiskModel,
        state: { ...state, impact: draft.impact, coupling: draft.coupling,
          securityTriggers: draft.securityTriggers || [], reviewRequired: Boolean(draft.reviewRequired) },
        claims: draft.claims || []
      })
    };
  }

  function materializeDraft(id, draft) {
    const state = loadRuntime(id);
    const basePath = changePath(id);
    // Task paths their repository's checkout does not have yet read as
    // additions; a repository whose root is unknown throws and stays a change.
    const documented = withNewPaths(draft, (path, repository) => {
      if (!repository) return existsSync(join(root, path));
      const relativePath = declaredRepositories().find((row) => row.id === repository)?.relativePath;
      if (!relativePath) throw new Error(`repository ${repository} has no known root`);
      return existsSync(join(root, relativePath, path));
    });
    writeFileSync(join(basePath, "proposal.md"),
      renderDraftProposal(documented, state, proposalContext(draft, state)));
    // A standard v4 change is built from its dev document, so design.md is
    // always written; v3 keeps writing it only for authored design content.
    if (state.schema === "foundation-standard" &&
        (!isSemanticVersion(draft._semanticVersion) || isSemanticV4Plus(draft._semanticVersion) ||
          draftNeedsDesign(draft)))
      writeFileSync(join(basePath, "design.md"), renderDraftDesign(documented));
    const qualityGrounding = v5QualityGrounding(draft, { groundingRequired: state.groundingRequired });
    if (qualityGrounding) writeJson(join(basePath, "grounding.yaml"), qualityGrounding);
    else if (state.groundingRequired && draft.grounding)
      writeJson(join(basePath, "grounding.yaml"), draft.grounding);
    writeFileSync(join(basePath, "tasks.md"), renderDraftTasks(draft.tasks));
    const contract = readJson(join(basePath, "evidence.yaml"));
    contract.claims = draft.claims;
    if (isSemanticVersion(draft._semanticVersion) && draft._derivedExecution)
      contract.providers = draft.execution.providers;
    writeJson(join(basePath, "evidence.yaml"), contract);
    if (draft.execution && !(isSemanticVersion(draft._semanticVersion) && draft._derivedExecution))
      writeJson(join(basePath, "execution.yaml"), draft.execution);
    if (!isSemanticVersion(draft._semanticVersion) || draft.externalOperations?.length)
      writeJson(join(basePath, "handoffs.yaml"), {
        version: 1,
        operations: draft.externalOperations || []
      });
    if (draft.repositories?.length) writeJson(join(basePath, "repositories.yaml"), {
      version: 1,
      repositories: draft.repositories
    });
    // A semantic rapid draft compiles the same concise delta specs as the
    // standard lane, so Land merges its behavior into openspec/specs. The
    // template's skip_specs marker would contradict them; only a legacy rapid
    // packet without deltas, or declared docs-only work (no system behavior),
    // keeps it.
    const rapidSpecs = state.schema === "foundation-rapid" &&
      isSemanticVersion(draft._semanticVersion) && (draft.specs || []).length > 0 &&
      !docsOnlyDraft(draft);
    if (state.schema === "foundation-standard" || rapidSpecs)
      materializeDraftSpecs({
        basePath, specs: draft.specs, slugify,
        renderRequirement: renderDraftRequirement,
        capabilityExists: (capability) => canonicalSpecText(capability) !== null
      });
    if (rapidSpecs) writeFileSync(join(basePath, ".openspec.yaml"), "schema: foundation-rapid\n");
  }

  // The artifacts the standard schema adds over the rapid one. Written only
  // when absent, so an upgrade never overwrites work already done.
  function materializeStandardArtifacts(id, intent) {
    const source = templateDir("foundation-standard");
    const target = changePath(id);
    const design = join(target, "design.md");
    if (!existsSync(design))
      writeFileSync(design, instantiate(join(source, "design.md"), intent));
    const grounding = join(target, "grounding.yaml");
    if (workflowPolicy().workflow.grounding === "required" && !existsSync(grounding))
      writeFileSync(grounding, instantiate(join(source, "grounding.yaml"), intent));
    const spec = join(target, "specs", "change", "spec.md");
    // A compiled rapid packet already carries its delta specs.
    let hasSpecs = false;
    try {
      hasSpecs = readdirSync(join(target, "specs"), { withFileTypes: true })
        .some((entry) => entry.isDirectory() && existsSync(join(target, "specs", entry.name, "spec.md")));
    } catch {}
    if (!hasSpecs && !existsSync(spec)) {
      mkdirSync(join(target, "specs", "change"), { recursive: true });
      writeFileSync(spec, instantiate(join(source, "spec.md"), intent));
    }
    // The rapid marker declared skip_specs; keeping it beside the specs/ this
    // upgrade just materialized makes the packet self-contradictory and fails
    // OpenSpec strict validation.
    writeFileSync(join(target, ".openspec.yaml"), "schema: foundation-standard\n");
  }

  function createChange(intent, flags, preparedDraft = undefined, options = {}) {
    // An existing well-formed id is kept verbatim so a revise targets the same
    // packet, including one created before ids stopped ending in "-".
    const id = /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(flags.id || ""))
      ? flags.id : slugify(flags.id || intent);
    setOperationChangeId(id);
    // An archived change keeps its runtime state, receipts, and evidence vault
    // as history. A new change reusing the id would inherit them — review
    // rounds it never ran, receipts bound to another workspace — so the id is
    // refused rather than quietly adopted. Atomic start checks once before its
    // rollback boundary so cleanup can never delete a pre-existing change.
    if (!options.availabilityChecked) assertChangeAvailable(id);
    const draft = preparedDraft !== undefined
      ? preparedDraft
      : flags.draft ? loadDraft(flags.draft) : null;
    if (preparedDraft === undefined && flags.draft && isSemanticV4Plus(draft?._semanticVersion))
      fail("semantic draft v4 must use 'change start <draft.json>' so repository intake is enforced");
    const schema = flags.rapid ? "foundation-rapid" : "foundation-standard";
    const source = templateDir(schema);
    const target = changePath(id);
    const groundingRequired = workflowPolicy().workflow.grounding === "required" ||
      Boolean(draft?.grounding);
    const semantic = isSemanticVersion(draft?._semanticVersion);
    // The rapid schema declares no spec artifact, so a rapid change never has
    // deltas to find. OpenSpec reads that absence as an error — every rapid
    // change was invalid to `openspec validate`, and Land printed five lines of
    // raw validator text at the user for a lane whose whole point is small work.
    // `skip_specs` is the flag OpenSpec's own message names for exactly this.
    materializeChangeTemplates({
      schema, source, target, intent, groundingRequired,
      conditional: semantic,
      includeDesign: !semantic || draftNeedsDesign(draft),
      instantiate
    });
    const state = initialChangeState({
      root, id, intent, schema, groundingRequired,
      riskBasedCi: workflowPolicy().land?.riskBasedCi === true,
      gitHead, preexistingDirty, initialBudget, now,
      semanticDraftVersion: semantic ? draft._semanticVersion : null,
      groundingVersion: draft?.grounding?.version || null,
      externalOperationsVersion: semantic
        ? (draft.externalOperations?.length ? 1 : null) : 1,
      designRequired: !semantic || draftNeedsDesign(draft)
    });
    // The document language is recorded, never applied: the agent writes the
    // prose and the harness does not translate it.
    if (semantic && String(draft.language || "").trim())
      state.documentLanguage = String(draft.language).trim();
    saveRuntime(state);
    if (draft) materializeDraft(id, draft);
    if (!options.deferSessionBinding) bindClaudeSession(id, "change");
    const next = schema === "foundation-standard"
      ? `resolve decisions with change resolve ${id} before authoring or validation`
      : `complete artifacts, validate, then /build ${id}`;
    // Atomic start and revise print one authoritative next step after AGREED
    // or REVISED; a per-step `next` here contradicted it.
    console.log(`CREATED ${id}\n  schema: ${schema}` +
      (options.deferSessionBinding ? "" : `\n  next: ${next}`));
    return id;
  }

  // The minimal v5 folder leads; the typed-field reference follows for richer
  // drafts. The decisions note travels with the template the agent already
  // reads, so recording unasked defaults costs no always-loaded instruction
  // words. `save` leads because agents copy from this output: a shell-written
  // draft is refused by the host, while the file tool falls under the seeded
  // `Edit(/.foundation/drafts/**)` rule. A v4 JSON draft still starts.
  function rapidStartTemplate() {
    return {
      save: "Write each file of minimalDraft (filled in) with the Write tool into the folder " +
        ".foundation/drafts/<id>/ (change.json with version 5, then proposal.md); that path " +
        "is pre-allowed and the tool creates the folder. Do not save it through the shell " +
        "(heredoc, cat >, echo >, mkdir chains): the host refuses those. Then run " +
        "claude-foundation change start .foundation/drafts/<id>; when the request already " +
        "approved the spec, add --approve-spec --decision-ref <ref> and any --through stage " +
        "to that same call.",
      minimalDraft: minimalDraftFolderTemplate(),
      minimalDraftWorkType: "Set workType in change.json to every catalog type the change " +
        "is (feature, bugfix, api, ui, data, migration, …) and copy each type's block from " +
        "workTypeExamples into change.json; the type selects the required sections. Omitted, " +
        "it is guessed from paths and may miss them.",
      minimalDraftProse: "Write prose only under draftFolderV5's listed headings, in outline " +
        "order. why, summary, userStories, and successCriteria go in proposal.md as prose or " +
        "in change.json as fields, not both. The keys below are change.json's typed fields.",
      minimalDraftWriting: MINIMAL_DRAFT_WRITING,
      minimalDraftCapability: "Optionally add a top-level capability to the minimal draft: a " +
        "short noun phrase naming the living spec, such as kanban-board. Omitted, the draft " +
        "joins the matching existing capability or derives a short name from the intent.",
      minimalDraftDecisions: "Add decisions: [{ key, choice, reason? }] to the minimal draft " +
        "for every default you chose without asking the user (for example stack, storage, " +
        "framework); they are listed in the proposal as decided by the agent.",
      // Typed declarations are the only risk input; prose is never scanned, so
      // the template the agent copies from has to say when each one applies.
      minimalDraftRiskSignals: "Add riskSignals: [...] to the minimal draft for each that " +
        "applies: 'access-control' when some callers may act and others must be refused " +
        "(owner, role, admin, 401/403) and then tag at least one scenario access: \"allow\" " +
        "and one access: \"deny\"; 'financial' when money is charged, captured, refunded or " +
        "transferred, or a retry must not repeat it; 'performance-slo' when the request is to " +
        "make something faster or meet a latency/throughput target (prove it with a provider " +
        "using adapter 'benchmark'); 'persisted-data-change' for stored data or schema " +
        "changes; 'external-integration' for third-party calls; 'input-domain' only when " +
        "values from outside the program (an HTTP request, uploaded file, CLI argument or " +
        "message payload) must be validated or rejected, not for ordinary function arguments.",
      minimalDraftRiskCoverage: "Each declared risk signal needs one discovery.coverage row " +
        "per dimension it requires, in the same draft: {\"dimension\": \"<dimension>\", " +
        "\"status\": \"covered\", \"covers\": [\"<requirement key>\"]}, or \"status\": " +
        "\"not-applicable\" with a \"rationale\". Required dimensions: " +
        Object.entries(riskSignalDimensions())
          .map(([signal, dimensions]) => `${signal} → ${dimensions.join(", ")}`).join("; ") +
        `; fixes → ${FIXES_DIMENSIONS.join(", ")}.`,
      minimalDraftFixes: "When the request reports a defect introduced by an earlier change " +
        "that is already archived under openspec/changes/archive/<date>-<id>, add fixes: " +
        "[\"<id>\"] to the minimal draft and cover the analogous boundaries, not only the " +
        "reported one: fixes requires an input-boundary coverage row whose requirement " +
        "has a scenario for each analogous boundary.",
      ...repositoryDraftGuidance(declaredRepositories()),
      ...semanticDraftTemplate(),
      // The field reference describes change.json, so it carries the v5 version.
      version: DRAFT_FOLDER_VERSION
    };
  }

  function complianceEnabled() {
    const path = join(root, "openspec", "config.yaml");
    return existsSync(path) && complianceEnabledFromConfig(readFileSync(path, "utf8"));
  }

  // The compliance change record is off unless openspec/config.yaml enables
  // it; then the draft's compliance block routes one owned action (or none).
  function complianceGate(source) {
    if (!source || !isSemanticV4Plus(source.version) || !complianceEnabled()) return null;
    return complianceAction(source.compliance, { enabled: true });
  }

  function inspectSemanticIntakeSource(source, {
    statePath, resume, quiet = false, validateCompiledDraft = true,
    excludedSourcePath = null, standardLane = false, extraIssues = []
  }) {
    let previous = null;
    if (existsSync(statePath)) {
      try { previous = JSON.parse(readFileSync(statePath, "utf8")); }
      catch { previous = null; }
    }
    const sameDraft = previous?.draftDigest === semanticDraftDigest(source);
    const intelligence = repositoryIntelligence(source,
      excludedSourcePath ? [excludedSourcePath] : [], { standardLane });
    const sourceInspection = intelligenceUsable(intelligence)
      ? semanticSourceInspection(
        source, sameDraft ? previous?.sourceInventory : null, intelligence.selected)
      : inspectSemanticSources({ projectRoot: root, sourcePaths: [] });
    const intakeIssues = semanticIntakeIssues(source);
    const normalized = validateCompiledDraft
      ? normalizeSemanticDraft(source, slugify, {
        defaultRapidEvidence: true,
        requireScratch: true,
        requireUndo: true,
        repositories: declaredRepositories(),
        loadCanonicalSpec: (capability) => {
          const path = join(root, "openspec", "specs", slugify(capability), "spec.md");
          return existsSync(path) ? readFileSync(path, "utf8") : null;
        }
      })
      : { issues: [], draft: source };
    const additionalIssues = [
      ...normalized.issues.filter((issue) => !intakeIssues.includes(issue)),
      // Start rejects these after intake; report them in this same EDIT batch.
      ...(validateCompiledDraft
        ? startDraftChecks(normalized.draft, { structural: !normalized.issues.length }).issues
        : []),
      ...semanticReferenceIssues(normalized.draft),
      ...extraIssues,
      ...(source.investigation !== undefined
        ? validateInvestigationBinding({ projectRoot: root, binding: source.investigation, git })
          .map((issue) => `investigation ${issue}`)
        : []),
      ...semanticQuestionQualityFindings(source, {
        sourceFacts: source.discovery?.sourceFacts || [],
        sourceInventory: sourceInspection.inventory
      }).map((finding) => `semantic decision ${finding.code}: ${finding.key || finding.path}`),
      ...(intelligence.repository.status === "blocked"
        ? intelligence.repository.findings.map((finding) =>
          `repository discovery ${finding.code}: ${finding.path || "(root)"}`)
        : []),
      ...sourceInspection.findings.map((finding) =>
        `semantic source ${finding.code}: ${finding.path || "(unknown)"}`)
    ];
    // The harness records the inventory digest itself. `discovery.sourceDigest`
    // is optional; freshness comes from comparing the selected sources against
    // the previous snapshot, so a correct first draft can reach DONE at once.
    // Compliance (opt-in per repository): agent repairs join this EDIT batch;
    // a missing approver is one user question asked after them.
    const compliance = complianceGate(source);
    if (compliance?.owner === "agent") additionalIssues.push(...compliance.issues);
    const action = semanticIntakeAction(source, {
      resume, additionalIssues,
      sourceFreshnessFindings: sourceInspection.staleFindings,
      frontierLimit: intelligence.depth.limits.frontierLimit,
      userQuestion: compliance?.owner === "user"
        ? { key: compliance.field, question: compliance.question, kind: "compliance-approver" }
        : null
    });
    // Stale sources return one EDIT; the snapshot then adopts the current
    // inventory so the re-inspect after the agent re-reads can reach DONE.
    // Retaining the old inventory made every re-inspect stale again.
    const retainedInventory = sourceInspection.inventory;
    const effectiveness = semanticIntakeEffectivenessSnapshot(source, {
      repository: {
        candidateFileCount: intelligence.repository.candidates?.length || 0,
        integrationCount: intelligence.repository.graph?.surfaces?.integrations?.length || 0,
        dependentCount: intelligence.repository.graph?.callers?.length || 0,
        persistenceBoundaryCount:
          intelligence.repository.graph?.surfaces?.persistence?.length || 0,
        permissionBoundaryCount:
          intelligence.repository.graph?.surfaces?.permissions?.length || 0
      },
      sourceFacts: source.discovery?.sourceFacts || [],
      sourceInventory: sourceInspection.inventory,
      history: previous?.effectiveness?.history
    });
    const state = reduceSemanticIntakeState(previous, {
      draft: source, action, resumeRoute: resume, sourceInventory: retainedInventory,
      effectiveness
    });
    writeJson(statePath, state);
    const result = {
      ...action,
      // Advisory: a known runner whose default output Prove cannot count.
      designWarnings: [...designBlueprintWarnings(source), ...verifyCountAdvisories(source.tasks),
        ...unknownTaskFieldWarnings(source)],
      intakeState: {
        path: relative(root, statePath),
        revision: state.revision,
        draftDigest: state.draftDigest,
        sourceDigest: state.sourceInventory?.digest || null
      },
      intelligence: {
        depth: state.effectiveness.depth,
        repository: {
          status: intelligence.repository.status,
          complete: intelligence.repository.complete,
          scan: intelligence.repository.scan,
          selectedSources: intelligence.selected,
          selectedBytes: intelligence.selectedBytes,
          findings: intelligence.repository.findings
        }
      },
      effectiveness: state.effectiveness
    };
    if (!quiet) console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // A v5 folder's heading, order, placeholder, and change.json issues come
  // back as one agent-owned draft-repair EDIT with the resume route; nothing
  // is created. With a readable v4+ change.json they join intake's own issues.
  function startDraftSource(draftPath) {
    const folderIssues = [];
    const source = draftSource(draftPath, {}, { folderIssues, allowMissing: true });
    return { source, folderIssues };
  }

  function startResume(draftPath) {
    return `claude-foundation change start ${draftPath} --inspect`;
  }

  function folderRepairAction(draftPath, folderIssues) {
    return semanticIntakeAction({ version: 5 }, {
      resume: startResume(draftPath), additionalIssues: folderIssues
    });
  }

  function inspectDraft(draftPath, options = {}) {
    const prepared = options.preparedSource
      ? { source: options.preparedSource, folderIssues: options.folderIssues || [] }
      : startDraftSource(draftPath);
    const { source, folderIssues } = prepared;
    if (folderIssues.length && !isSemanticV4Plus(source?.version)) {
      const action = folderRepairAction(draftPath, folderIssues);
      if (!options.quiet) console.log(JSON.stringify(action, null, 2));
      return action;
    }
    return inspectSemanticIntakeSource(source, {
      statePath: semanticIntakeStatePath(draftPath),
      resume: startResume(draftPath),
      quiet: options.quiet,
      excludedSourcePath: relative(root, resolve(root, draftPath)).replaceAll("\\", "/"),
      extraIssues: folderIssues
    });
  }

  function amendmentIntakeSource(amendment) {
    return {
      version: 4,
      intent: String(amendment.reason || "Amend the active agreement"),
      impact: amendment.impact || "low",
      coupling: amendment.coupling || "isolated",
      size: amendment.size,
      changeSize: amendment.changeSize,
      requirements: [...(amendment.addRequirements || []),
        ...(amendment.reviseRequirements || [])],
      integrations: amendment.integrations || [],
      externalOperations: amendment.externalOperations || [],
      securityTriggers: amendment.securityTriggers || [],
      riskSignals: amendment.riskSignals || [],
      discovery: amendment.discovery
    };
  }

  function amendmentRepositoryIssues(id, state, amendment) {
    const changeDir = activeChangePath(id, state);
    const tasksPath = join(changeDir, "tasks.md");
    const tasksContent = existsSync(tasksPath) ? readFileSync(tasksPath, "utf8") : "";
    return [
      ...amendmentTaskRepositoryIssues(amendment, tasksContent, {
        repositories: declaredRepositories(),
        selection: changeRepositorySelection(changeDir),
        exists: existsSync
      }),
      // An added task's derived repository order must not close a cycle.
      ...amendmentRepositoryOrderIssues(amendment, tasksContent, {
        repositories: declaredRepositories(),
        selection: changeRepositoryRows(changeDir) || undefined
      })
    ];
  }

  function inspectAmendment(id, amendmentPath, options = {}) {
    const active = loadRuntime(id);
    if (!isSemanticV4Plus(active.semanticDraftVersion))
      fail(`change amend --inspect requires a semantic-draft v4 or v5 change; '${id}' is version ${
        active.semanticDraftVersion || "legacy"}`);
    const path = resolve(root, amendmentPath);
    if (!pathInside(root, path) || !existsSync(path))
      fail("change amend requires a JSON file inside the project");
    const amendment = options.preparedSource || readJson(path);
    // Build creates files in the workspace, so a verify path is checked there.
    const workspaceRoot = active.workspace?.path && existsSync(active.workspace.path)
      ? active.workspace.path : root;
    const tasksPath = join(activeChangePath(id, active), "tasks.md");
    return inspectSemanticIntakeSource(amendmentIntakeSource(amendment), {
      statePath: semanticIntakeStatePath(amendmentPath, `amend:${id}`),
      resume: `claude-foundation change amend ${id} ${amendmentPath} --inspect`,
      quiet: options.quiet,
      validateCompiledDraft: false,
      excludedSourcePath: relative(root, path).replaceAll("\\", "/"),
      standardLane: active.schema === "foundation-standard",
      extraIssues: [...amendmentVerifyPathIssues(amendment,
        existsSync(tasksPath) ? readFileSync(tasksPath, "utf8") : "",
        { exists: (candidate) => existsSync(join(workspaceRoot, candidate)) ||
          existsSync(join(root, candidate)) }),
      ...amendmentRepositoryIssues(id, active, amendment),
      ...investigationCoverageIssues(amendmentInvestigationSource(
        active.investigationAgreement || active.draftSource?.draft, amendment)),
      ...(amendment.investigation ? validateInvestigationBinding({
        projectRoot: root, binding: amendment.investigation, git }) : [])]
    });
  }

  function applyGroundingReopen(state, flags) {
    if (flags["reopen-grounding"]) {
      const decisionRef = String(flags["decision-ref"] || "").trim();
      const reason = String(flags["reopen-reason"] || "").trim();
      if (!decisionRef || !reason)
        fail("--reopen-grounding requires --decision-ref and --reopen-reason");
      if (state.groundingReopenPending)
        fail("grounding already has an open revision; complete and validate that batch first");
      if (!state.groundingDigest)
        fail("--reopen-grounding requires a currently locked grounding ledger");
      if ((state.groundingReopens || []).some((row) => row.decisionRef === decisionRef))
        fail("--decision-ref was already used for a grounding reopen");
      state.groundingReopenPending = {
        version: 1,
        decisionRef,
        reason,
        priorDigest: state.groundingDigest,
        priorLockedAt: state.groundingLockedAt || null,
        openedAt: now()
      };
      delete state.groundingDigest;
      delete state.groundingLockedAt;
      state.contractRevision = Number(state.contractRevision || 0) + 1;
    } else if ((flags["decision-ref"] && !flags["ci-not-required"]) || flags["reopen-reason"])
      fail("--decision-ref and --reopen-reason require --reopen-grounding");
  }

  // Signed CI is project policy, read once at creation and pinned into the
  // change. A project that relaxes `land.riskBasedCi` afterwards — the
  // historical default many installs still carry — was left with every open
  // change pinned to the old value, and the only ways out were a hand edit of
  // runtime state or of foundation.json from inside Build, which the phase
  // guard rightly refuses. Resolve re-reads the policy, and a user who cannot
  // produce signed CI for one change records that decision here instead.
  function applyResolveCiPolicy(state, flags) {
    if (flags["ci-not-required"]) {
      const decisionRef = String(flags["decision-ref"] || "").trim();
      if (!decisionRef) fail("--ci-not-required requires --decision-ref");
      state.riskBasedCiRequired = false;
      state.ciWaiver = { version: 1, decisionRef, declaredAt: now() };
      return;
    }
    if (state.ciWaiver) return;
    state.riskBasedCiRequired = state.schema === "foundation-standard" &&
      workflowPolicy().land?.riskBasedCi === true;
  }

  function applyResolveAttributes(state, flags) {
    // The only consumer gates on strict equality with "unclear", so an
    // unvalidated value silently defeats the /investigate blocker it feeds.
    if (flags.ambiguity && !["clear", "unclear"].includes(flags.ambiguity))
      fail("--ambiguity must be clear|unclear");
    for (const key of ["ambiguity", "impact", "coupling"])
      if (flags[key]) state[key] = flags[key];
    // Sizes are stored lowercase and validated. `--size` was accepted verbatim
    // with no enum, so `--size medium` or `--size 5` persisted happily, and the
    // one place that read it compared against the literal "S" — which
    // `startAtomic`'s own "xs" could never match. Now that size scales the
    // request budget, an unrecognized value would silently take the default
    // lane instead of the one the author asked for.
    if (flags.size) {
      const size = String(flags.size).toLowerCase();
      if (!["xs", "s", "m", "l"].includes(size)) fail("--size must be xs|s|m|l");
      state.size = size;
    }
    // The paths the author expects to touch, declared before they exist. Policy
    // infers capabilities from the *changed* surface, which at change time is
    // empty — so a `.tsx` file pulls `accessibility` only once it is written,
    // by which point the contract is signed and the evidence is collected.
    // Declaring nothing keeps that behavior exactly; this is advisory input to
    // a forecast, never an input to enforcement.
    if (flags.surface !== undefined) {
      const globs = String(flags.surface).split(",")
        .map((value) => value.trim()).filter(Boolean);
      if (!globs.length) fail("--surface requires at least one path or glob");
      state.declaredSurface = [...new Set(globs)].sort();
    }
  }

  function applyResolveSecurity(state, flags) {
    // Word boundaries, not substrings. `includes("access")` fired on
    // "accessibility" and `includes("migration")` on "migration guide", so
    // routine work acquired external review it did not need — while the
    // trigger the docs promise ("semantic, not syntax") went unmet either way.
    // Thai terms, written without word spaces, match as substrings.
    const termsIn = (value) =>
      securityTerms.filter((term) => matchesSecurityTerm(value, term));
    const explicitSecurity = String(flags.security || "").split(",")
      .map((value) => value.trim()).filter((value) => value && value.toLowerCase() !== "none");
    // Declared triggers (the draft, `--security`, or a prior resolve) keep
    // their full weight. A term found only in the intent text is a keyword
    // signal: it makes review required and nothing else, so a rapid change
    // that mentions "billing" stays on the rapid lane (user decision).
    const keywordOnly = new Set((state.keywordSecurityTriggers || [])
      .map((value) => String(value).trim().toLowerCase()));
    state.securityTriggers = materialSecurityTriggers([
      ...(state.securityTriggers || []).filter((value) =>
        !["", "none"].includes(String(value).trim().toLowerCase()) &&
        !keywordOnly.has(String(value).trim().toLowerCase())),
      ...termsIn(flags.security), ...explicitSecurity
    ], state.intent, securityTerms);
    const declared = new Set(state.securityTriggers.map((value) => value.toLowerCase()));
    const keywordTriggers = materialSecurityTriggers(termsIn(state.intent), state.intent, securityTerms)
      .filter((value) => !declared.has(value.toLowerCase()));
    if (keywordTriggers.length) state.keywordSecurityTriggers = keywordTriggers;
    else delete state.keywordSecurityTriggers;
    // Coupling alone no longer summons a reviewer. `coupled` means the change
    // spans components, which earns the standard schema's design.md and specs/
    // below — but at low impact there is nothing for an independent reader to
    // protect, and the cross-repository cases that do matter are caught
    // separately: reviewPolicy raises `multi-repository-claim` for any claim
    // above low impact that spans repositories, without consulting this flag.
    const declaredReview = state.impact === "high" ||
      (state.coupling === "coupled" && state.impact !== "low") ||
      state.securityTriggers.length > 0 || Boolean(flags.review);
    state.reviewRequired = declaredReview || keywordTriggers.length > 0;
    // Persisted only for the keyword-only case so verification risk can tell
    // it from a declared review (`--review`, impact, coupling, triggers).
    if (!declaredReview && keywordTriggers.length) state.reviewKeywordOnly = true;
    else delete state.reviewKeywordOnly;
    return { declaredReview };
  }

  function applyResolveAcceptance(state, flags) {
    if (flags["acceptance-required"] && flags["acceptance-not-required"])
      fail("resolve cannot combine --acceptance-required and --acceptance-not-required");
    if ((flags["acceptance-reason"] || flags["acceptance-claims"]) &&
        !flags["acceptance-required"])
      fail("--acceptance-reason and --acceptance-claims require --acceptance-required");
    if (flags["acceptance-required"]) {
      const reason = String(flags["acceptance-reason"] || "").trim();
      if (!reason) fail("--acceptance-required requires --acceptance-reason");
      const acceptanceClaims = String(flags["acceptance-claims"] || "").split(",")
        .map((value) => value.trim()).filter(Boolean);
      state.acceptance = {
        version: 2,
        decision: "required",
        required: true,
        reason,
        claimIds: acceptanceClaims,
        scopeOrigin: "explicit",
        declaredAt: now()
      };
    } else if (flags["acceptance-not-required"])
      state.acceptance = {
        version: 2, decision: "not-required", required: false,
        reason: null, claimIds: [], declaredAt: now()
      };
  }

  // A review required only by intent keywords does not upgrade the lane.
  function upgradeResolvedSchema(id, state, { declaredReview = state.reviewRequired } = {}) {
    if (state.schema === "foundation-rapid" &&
        (state.impact !== "low" || state.coupling !== "isolated" || declaredReview ||
         state.acceptance?.required)) {
      state.schema = "foundation-standard";
      state.upgradedFrom = "foundation-rapid";
      state.groundingRequired = workflowPolicy().workflow.grounding === "required";
      state.nfrAssessmentRequired = true;
      state.decisionMetadataRequired = true;
      state.semanticInvariantsRequired = true;
      state.riskBasedCiRequired = !state.ciWaiver &&
        workflowPolicy().land?.riskBasedCi === true;
      // The rapid packet has no design.md and no specs/, which the standard
      // schema requires. Leaving them absent made `validate` refuse a change
      // whose only listed next command was `validate` — a dead end that had to
      // be guessed out of. Instantiate them here, with the upgrade.
      materializeStandardArtifacts(id, state.intent);
      return true;
    }
    return false;
  }

  // Best effort: the packet's claims and grounding as they stand at resolve.
  // Validation recomputes the authoritative route from the same inputs.
  function resolutionReviewLabel(id, state) {
    const dir = changePath(id);
    const parse = (name) => {
      try { return JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { return null; }
    };
    const claims = parse("evidence.yaml")?.claims;
    return reviewRouteLabel({
      reviewPolicy: workflowPolicy().workflow?.reviewPolicy,
      lowRiskModel: workflowPolicy().review?.lowRiskModel,
      modelByTier: workflowPolicy().review?.modelByTier,
      state,
      claims: Array.isArray(claims) ? claims : [],
      grounding: parse("grounding.yaml")
    });
  }

  // Set while atomic start or revise runs its create/resolve steps, which
  // print their own single `next` at the end.
  let atomicStepOutput = false;

  function printResolution(id, state, upgraded) {
    // The surface line appears only when one was declared, so a change that
    // never used the flag keeps producing the output it produced before it
    // existed.
    const surfaceLine = state.declaredSurface?.length
      ? `\n  surface: ${state.declaredSurface.join(", ")}` : "";
    // Named only when a decision waived it, so every earlier output is intact.
    const ciLine = state.ciWaiver
      ? `\n  signed CI: waived (${state.ciWaiver.decisionRef})` : "";
    console.log(`RESOLVED ${id}\n  impact: ${state.impact}\n  coupling: ${state.coupling}\n  review: ${resolutionReviewLabel(id, state)}\n  acceptance: ${state.acceptance?.decision || (state.acceptance?.required ? "required" : "legacy-not-required")}\n  security: ${[...state.securityTriggers,
      ...(state.keywordSecurityTriggers || []).map((value) => `${value} (intent keyword: review only)`)
    ].join(", ") || "none"}${surfaceLine}${ciLine}\n  schema: ${state.schema}${upgraded ? " (upgraded from foundation-rapid; design.md and specs/ added)" : ""}${atomicStepOutput ? "" : `\n  next: ${nextCommand(state.status, id, state)}`}`);
  }

  function approvalPacketRoot(id) {
    return approvalPacketRootFor(loadRuntime(id), id);
  }

  // Open questions live in the proposal's "Decisions to ratify and open
  // questions" section (design.md no longer repeats them); a packet compiled
  // earlier keeps them under design.md's "### Open questions".
  function designOpenQuestions(id, packetRoot = approvalPacketRoot(id)) {
    const dir = join(packetRoot, "openspec", "changes", id);
    const designPath = join(dir, "design.md");
    const proposalPath = join(dir, "proposal.md");
    return [...new Set([
      ...(existsSync(designPath) ? openQuestionItems(readFileSync(designPath, "utf8")) : []),
      ...(existsSync(proposalPath) ? proposalOpenQuestions(readFileSync(proposalPath, "utf8")) : [])
    ])];
  }

  // The questions an approval would be refused over, as the user decision the
  // agent asks in one batch. Null when nothing is open.
  function openQuestionsDecision(id) {
    const questions = designOpenQuestions(id);
    if (!questions.length) return null;
    const error = userDecisionError("OPEN_QUESTIONS",
      `Ask the user the design's open questions before approving the spec: ${questions.join(" | ")}`, [
        { id: "answer", outcome: "Answer each open question; the agent records the answers in the " +
          "draft and revises the change, then asks for spec approval again" },
        { id: "pause", outcome: "Leave the change unapproved for now" }
      ], "answer");
    error.decision.questions = questions;
    return error;
  }

  function resolveChange(id, flags) {
    const decisionFlags = ["approve-spec", "continue-review", "accept-target-edits"];
    if (decisionFlags.some((key) => flags[key])) {
      const decisionRef = String(flags["decision-ref"] || "").trim();
      if (!decisionRef) fail("This operation requires --decision-ref from an explicit user answer");
      if (Object.keys(flags).some((key) => ![...decisionFlags, "decision-ref", "role"].includes(key)) ||
          decisionFlags.filter((key) => flags[key]).length > 1)
        fail("Record one user decision at a time, separately from agreement edits");
      const role = flags.role === undefined ? null : String(flags.role).trim();
      if (role !== null && !flags["approve-spec"]) fail("--role applies only to --approve-spec");
      if (role !== null) {
        const { configured } = approvalLanes(id, loadRuntime(id));
        if (!configured.length)
          fail("--role needs approval.roles in foundation.json; without lanes approve once without --role");
        if (!configured.includes(role))
          fail(`unknown approval role '${role}'; approval.roles allows: ${configured.join(", ")}`);
      }
      const state = loadRuntime(id);
      if (state.status === "archived") fail(`change '${id}' is already archived`);
      let approvedDelta = null;
      if (flags["approve-spec"]) {
        validate(id, "root", { quiet: true });
        const current = loadRuntime(id);
        const approvalRoot = current.workspace?.path &&
          existsSync(join(current.workspace.path, "openspec", "changes", id))
          ? current.workspace.path : root;
        // Consent binds one identity; an unamended isolated packet that differs
        // from the target could never satisfy the approval check.
        const amended = (current.amendments || []).some((entry) =>
          Number(entry?.revision) === Number(current.contractRevision || 0));
        if (approvalRoot !== root && !amended &&
            agreementIdentity(approvalRoot, id) !== agreementIdentity(root, id) &&
            !repairWhitespaceDrift(root, approvalRoot, id)) {
          const saved = restoreDriftedAgreement(root, approvalRoot, id);
          if (saved) console.error(agreementRestoredNotice(id, saved));
          else {
            const drift = agreementDriftError(id, approvalRoot);
            fail(drift.message, 1, { owner: drift.owner, boundary: drift.boundary, code: drift.code });
          }
        }
        // Consent covers a settled agreement: an open question is answered and
        // revised into the change first, never approved around.
        const openQuestions = designOpenQuestions(id, approvalRoot);
        if (openQuestions.length)
          fail("resolve the design's open questions before approving the spec:\n  - " +
            `${openQuestions.join("\n  - ")}\nAsk the user, record the answers, and revise the change.`);
        const consent = { identity: agreementIdentity(approvalRoot, id),
          revision: Number(current.contractRevision || 0), decisionRef, approvedAt: now() };
        const { required } = approvalLanes(id, current);
        const prior = current.specApproval || {};
        // Only consent given on these exact bytes and revision survives.
        const lanes = Object.fromEntries(Object.entries(prior.lanes || {})
          .filter(([, lane]) => lane?.identity === consent.identity && Number(lane.revision) === consent.revision));
        const priorComplete = prior.identity === consent.identity && Number(prior.revision) === consent.revision;
        if (role === null) {
          // Approval without a role is the whole approval and covers every lane
          // required now; a lane added by a later revision is asked again.
          for (const lane of required) lanes[lane] = consent;
          current.specApproval = { required: true, ...consent,
            ...(required.length ? { lanes, requiredLanes: required } : {}) };
        } else {
          lanes[role] = consent;
          if (priorComplete) {
            // A lane recorded after the whole approval adds to it, never revokes it.
            current.specApproval = { ...prior, lanes, requiredLanes: required };
          } else {
            const complete = required.every((lane) => lanes[lane]);
            current.specApproval = complete
              ? { required: true, ...consent, decisionRef: required.map((lane) => lanes[lane].decisionRef).join(",") || decisionRef,
                lanes, requiredLanes: required }
              : { required: true, lanes, requiredLanes: required };
          }
        }
        approvedDelta = current.specApproval.identity ? current.pendingApprovalDelta || null : null;
        if (current.specApproval.identity) delete current.pendingApprovalDelta;
        saveRuntime(current);
      } else if (flags["accept-target-edits"]) {
        // Binds the exact edited bytes: a later edit is a new question.
        const dirtyNow = preexistingDirty(root);
        const snapshot = state.workspace?.targetDirty || state.workspace?.preexisting || {};
        const paths = targetEditPaths(snapshot, dirtyNow);
        if (!paths.length) fail("No target checkout edits outside the sandbox need a decision");
        state.targetEditsAccepted = { digest: targetEditDigest(paths, dirtyNow), paths,
          decisionRef, acceptedAt: now() };
        saveRuntime(state);
      } else {
        // Compatibility: review is bounded by its rounds, not elapsed time,
        // so there is no window to extend. The flag stays accepted.
        console.log(`NOTE: review has no time window; '--continue-review' changes nothing`);
      }
      const lanesState = flags["approve-spec"] ? loadRuntime(id).specApproval : null;
      const pendingLanes = lanesState && !lanesState.identity
        ? (lanesState.requiredLanes || []).filter((lane) => !lanesState.lanes?.[lane]) : [];
      console.log(`DECISION RECORDED ${id}\n` +
        (role !== null ? `  approval lane: ${role}\n` : "") +
        (pendingLanes.length ? `  approval lanes still needed: ${pendingLanes.join(", ")}\n` : "") +
        (approvedDelta ? `  approved requirement delta:\n${formatApprovalDelta(approvedDelta)}\n` : "") +
        `  next: claude-foundation advance ${id} --through ${flags["approve-spec"]
          ? resumeThrough(loadRuntime(id))
          : flags["accept-target-edits"] ? "archived" : "proven"}`);
      return;
    }
    const state = loadRuntime(id);
    applyGroundingReopen(state, flags);
    applyResolveAttributes(state, flags);
    const { declaredReview } = applyResolveSecurity(state, flags);
    applyResolveAcceptance(state, flags);
    applyResolveCiPolicy(state, flags);
    const upgraded = upgradeResolvedSchema(id, state, { declaredReview });
    const proposalPath = join(changePath(id), "proposal.md");
    if (existsSync(proposalPath)) {
      const proposal = readFileSync(proposalPath, "utf8");
      const synchronized = synchronizeProposalClassification(proposal, state,
        { reviewLabel: proposal.includes("\n- Review: ") ? resolutionReviewLabel(id, state) : "" });
      if (synchronized !== proposal) writeFileSync(proposalPath, synchronized);
    }
    state.resolvedAt = now();
    saveRuntime(state);
    printResolution(id, state, upgraded);
    return { state, upgraded };
  }

  // Typed draft risk signals stay on the change so review routing can read
  // them at Prove (see review-routing SECURITY_RISK_SIGNAL_TIERS). Absent
  // signals leave the state untouched, so existing fingerprints do not move.
  function persistRiskSignals(id, signals) {
    const values = riskSignalValues(signals);
    const state = loadRuntime(id);
    if (!values.length && state.riskSignals === undefined) return;
    if (values.length) state.riskSignals = values;
    else delete state.riskSignals;
    saveRuntime(state);
  }

  // The archived changes a draft declares it fixes stay on the change so an
  // escaped defect links back to its origin. Absent, the state is untouched.
  function persistFixes(id, fixes) {
    const values = Array.isArray(fixes) ? fixes : [];
    const state = loadRuntime(id);
    if (!values.length && state.fixes === undefined) return;
    if (values.length) state.fixes = [...values];
    else delete state.fixes;
    saveRuntime(state);
  }

  // Each declared fix names a change archived under
  // openspec/changes/archive/<YYYY-MM-DD>-<id>, which Git carries across machines.
  function fixesIssues(draft) {
    const archive = join(root, "openspec", "changes", "archive");
    const archived = new Set(existsSync(archive)
      ? readdirSync(archive, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .map((entry) => entry.name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)?.[1]).filter(Boolean)
      : []);
    return (Array.isArray(draft?.fixes) ? draft.fixes : [])
      .filter((id) => typeof id === "string" && id.trim() && !archived.has(id.trim()))
      .map((id) => `semantic draft fixes ${id.trim()} is not an archived change`);
  }

  function startResolutionFlags(draft, classification, rapid) {
    const { impact, coupling, securityTriggers } = classification;
    return {
      impact,
      coupling,
      size: String(draft.size || (rapid ? "xs" : "s")).toLowerCase(),
      security: securityTriggers.join(","),
      review: Boolean(draft.reviewRequired),
      "acceptance-required": Boolean(draft.acceptance?.required),
      "acceptance-not-required": !draft.acceptance?.required,
      "acceptance-reason": draft.acceptance?.reason || undefined,
      "acceptance-claims": (draft.acceptance?.claimIds || []).join(",") || undefined
    };
  }

  // Draft v4 compilation requires the semantic intake snapshot for the same
  // draft path to be current and DONE. Start and revise share this gate; only
  // their snapshot namespace and resume route differ. With `reinspect`, a
  // missing or stale snapshot is re-inspected in place: DONE continues, and any
  // other action is returned under INCOMPLETE_INTAKE instead of failing.
  function completedDraftIntake(source, draftPath, { statePath, resume, inspect, reinspect = false }) {
    if (!isSemanticV4Plus(source.version)) return null;
    const inspectedIntake = () => {
      const inspected = inspect();
      if (inspected.action === "DONE") return inspected.effectiveness || null;
      if (reinspect) return { [INCOMPLETE_INTAKE]: inspected };
      fail(`version-4 drafts require a current completed semantic intake; ` +
        `resume with '${resume}'`);
    };
    let intakeState = null;
    if (existsSync(statePath)) {
      try { intakeState = JSON.parse(readFileSync(statePath, "utf8")); }
      catch { intakeState = null; }
    }
    if (!intakeState) return inspectedIntake();
    const sourcePath = relative(root, resolve(root, draftPath)).replaceAll("\\", "/");
    const intelligence = repositoryIntelligence(source, [sourcePath]);
    const sourceInspection = intelligenceUsable(intelligence)
      ? semanticSourceInspection(source, null, intelligence.selected)
      : inspectSemanticSources({ projectRoot: root, sourcePaths: [] });
    const projection = semanticIntakeResumeProjection(intakeState, source, {
      resumeRoute: resume, sourceInventory: sourceInspection.inventory
    });
    const investigationIssues = source.investigation === undefined ? []
      : validateInvestigationBinding({ projectRoot: root, binding: source.investigation, git });
    if (!intelligenceUsable(intelligence) || sourceInspection.findings.length ||
        investigationIssues.length ||
        projection.status !== "current" || projection.action?.action !== "DONE") {
      if (reinspect) return inspectedIntake();
      fail(`version-4 drafts require a current completed semantic intake; ` +
        `resume with '${resume}'`);
    }
    return intakeState.effectiveness || null;
  }

  // Every start-time draft check that does not need created state. Inspect
  // reports these with the compiler's issues, so one EDIT carries them all;
  // `structural: false` (the compiler already refused the draft) skips only
  // the evidence-wiring row, which a refused compile cannot produce.
  function startDraftChecks(draft, { structural = true } = {}) {
    const preflight = atomicStartPreflight(draft, {
      groundingRequired: workflowPolicy().workflow.grounding === "required" ||
        Boolean(draft.grounding)
    });
    // A low-impact draft that already carries design content (file map, UI
    // states, decisions, answered intake choices...) would lose it in the rapid
    // packet, which has no design.md or specs/. Keep it on the standard schema;
    // the preflight gates still apply the rapid lane's requirements.
    const keepsDesign = semanticDraftKeepsDesign(draft, preflight.rapid);
    const rapid = preflight.rapid && !keepsDesign;
    const issues = [...preflight.issues.filter((issue) =>
      structural || !issue.includes("executable evidence wiring")), ...domainLanguageIssues(draft),
      // Caught here, in the same EDIT batch, instead of when Build runs the check.
      ...verifyPathIssues(draft.tasks, { exists: (path) => existsSync(join(root, path)) }),
      // Build dispatches each task to its repository; a task whose files live
      // in a declared repository but is bound to root would build elsewhere.
      ...taskRepositoryIssues(draft.tasks, {
        repositories: declaredRepositories(), selection: draft.repositories, exists: existsSync
      }),
      ...apiContractErrorIssues(draft), ...fixesIssues(draft)];
    return { issues, preflight, keepsDesign, rapid };
  }

  function preflightDraft(draftPath, source) {
    const draft = measureStage("change.load-draft", () =>
      loadDraft(draftPath, { deferPolicy: true, preparedSource: source }));
    const { issues, preflight, keepsDesign, rapid } =
      measureStage("change.preflight", () => startDraftChecks(draft));
    if (issues.length)
      fail(`start draft preflight failed:\n  - ${issues.join("\n  - ")}`);
    const { classification } = preflight;
    if (keepsDesign)
      console.log("NOTE: the draft carries design content, so it uses foundation-standard " +
        "to keep design.md and specs/");
    const derived = riskDerivationSummary(draft);
    if (derived) console.log(`NOTE: ${derived}`);
    const coverage = coverageNoteLine(draft);
    if (coverage) console.log(`NOTE: ${coverage}`);
    const scratch = scratchNoteLine(draft);
    if (scratch) console.log(`NOTE: ${scratch}`);
    const pathRisk = pathRiskNoteLine(draft);
    if (pathRisk) console.log(`NOTE: ${pathRisk}`);
    const filled = derivedByHarness(draft, { standard: !rapid });
    if (filled.length)
      console.log(`NOTE: derived by harness (listed in proposal.md): ${
        filled.map((line) => line.replace(/\*\*([^*]+):\*\*.*$/, "$1").toLowerCase()).join(", ")}`);
    return { draft, rapid, resolutionFlags: startResolutionFlags(draft, classification, rapid) };
  }

  // Bare `change start <draft>` inspects and starts in one command: a DONE
  // intake continues to the atomic start, while any other inspect action is
  // printed exactly as `--inspect` would and returned without creating state.
  function startAtomic(draftPath, options = {}) {
    const { source, folderIssues } = startDraftSource(draftPath);
    const inspect = () => inspectDraft(draftPath, { quiet: true, preparedSource: source, folderIssues });
    // Folder issues and a pending compliance action never pass a recorded
    // intake: they always reinspect, so the EDIT or ASK_USER is returned.
    const completedIntakeEffectiveness = folderIssues.length || complianceGate(source)
      ? { [INCOMPLETE_INTAKE]: inspect() }
      : completedDraftIntake(source, draftPath, {
        statePath: semanticIntakeStatePath(draftPath),
        resume: startResume(draftPath),
        inspect,
        reinspect: true
      });
    const incomplete = completedIntakeEffectiveness?.[INCOMPLETE_INTAKE];
    if (incomplete) {
      console.log(JSON.stringify(incomplete, null, 2));
      return incomplete;
    }
    const { draft, rapid, resolutionFlags } = preflightDraft(draftPath, source);
    const id = draftChangeId(draft, slugify);
    assertChangeAvailable(id);
    try {
      trapFailures(() => {
        measureStage("change.materialize", () => createChange(draft.intent, { rapid, id: draft.id || id }, draft, {
          availabilityChecked: true,
          deferSessionBinding: true
        }));
        atomicStepOutput = true;
        // Typed risk signals persist before resolve: its printed review route
        // read the state without them and called an input-domain change
        // "not required" even though Prove then ran a medium-tier review.
        persistRiskSignals(id, draft.riskSignals);
        let resolution;
        try { resolution = measureStage("change.resolve", () => resolveChange(id, resolutionFlags)); }
        finally { atomicStepOutput = false; }
        // Resolve upgrades a rapid draft only on a declared signal; intent
        // keywords make review required without changing the lane. Only an
        // upgrade needs a second projection; the common path was previously
        // rewritten unconditionally after createChange had already materialized it.
        if (resolution.upgraded) materializeDraft(id, draft);
        persistFixes(id, draft.fixes);
        // Atomic start is a public Change gate. Use the same explicit validation
        // as `change validate`, including OpenSpec strict lint when available.
        measureStage("change.validate", () => validate(id, "root"));
        bindClaudeSession(id, "change");
        const pending = loadRuntime(id);
        pending.specApproval = { required: true };
        if (isSemanticVersion(draft._semanticVersion)) {
          pending.requirementFingerprints = draftRequirementFingerprints(draft);
          // The compiled-from draft, so `change revise --merge` takes a patch.
          pending.draftSource = compiledDraftSource(pending, source);
        }
        if (completedIntakeEffectiveness)
          pending.semanticIntakeEffectiveness = completedIntakeEffectiveness;
        saveRuntime(pending);
        const openQuestions = designOpenQuestions(id, root);
        console.log(`AGREED ${id}\n  inspect: openspec/changes/${id}/\n` + packetFileLines(id) +
          "  awaiting user approval before Build\n" +
          approvalPackageLine(approvalPackageLink(id)) +
          openQuestionLines(openQuestions) +
          designWarningLines(draft, loadRuntime(id).schema, source) +
          `  next: ${openQuestions.length
            ? `ask these with the approval, record the answers in the draft, then claude-foundation change revise ${id} ${draftPath} --approve-spec --decision-ref <user-decision> --through proven`
            : `claude-foundation advance ${id} --approve-spec --decision-ref <user-decision> --through proven`}`);
      });
    } catch (error) {
      let rollbackIssues;
      try { rollbackIssues = rollbackStart(id) || []; }
      catch (rollbackError) {
        rollbackIssues = [`rollback failed: ${rollbackError.message || rollbackError}`];
      }
      const failure = error?.message || String(error);
      const detail = rollbackIssues.length
        ? `${failure}; rollback issues: ${rollbackIssues.join("; ")}`
        : `${failure}; partial atomic start rolled back`;
      fail(detail);
    }
    if (options.consumeDraft) {
      const draftFile = resolve(root, draftPath);
      // A v5 draft is a folder; a file draft stays a single unlink.
      try { rmSync(draftFile, { recursive: true }); }
      catch (error) {
        console.error(`WARNING: atomic start succeeded but could not remove draft '${
          relative(root, draftFile)}': ${error.message}`);
      }
    }
    try { rmSync(semanticIntakeStatePath(draftPath), { force: true }); }
    catch (error) {
      console.error(`WARNING: atomic start succeeded but could not remove semantic intake state: ${
        error.message}`);
    }
    return id;
  }

  // Open questions travel with the approval packet, so the user answers them
  // in the same exchange instead of after an approval is refused.
  function openQuestionLines(questions) {
    return questions.length
      ? `  open questions (ask with the approval):\n${questions.map((question) =>
        `    - ${question}`).join("\n")}\n`
      : "";
  }

  function packetFingerprints(dir) {
    const evidencePath = join(dir, "evidence.yaml");
    const claims = existsSync(evidencePath) ? readJson(evidencePath).claims || [] : [];
    const specsDir = join(dir, "specs");
    const specTexts = existsSync(specsDir)
      ? readdirSync(specsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .map((entry) => join(specsDir, entry.name, "spec.md"))
        .filter((path) => existsSync(path)).sort()
        .map((path) => readFileSync(path, "utf8"))
      : [];
    return requirementFingerprints({ claims, specTexts });
  }

  function recordApprovalDelta(state, delta) {
    state.pendingApprovalDelta = {
      ...mergeApprovalDelta(state.pendingApprovalDelta, delta),
      revision: Number(state.contractRevision || 0)
    };
    return state.pendingApprovalDelta;
  }

  function approvalPacketRootFor(state, id) {
    return state.workspace?.path &&
      existsSync(join(state.workspace.path, "openspec", "changes", id))
      ? state.workspace.path : root;
  }

  // The user approves a change once. A later revision or amendment that only
  // adds or revises requirements is the agent carrying out that consent, so
  // the current approval moves to the new packet with an audit row; Land still
  // shows the real diff. Removing a requirement narrows what the user agreed
  // to and still asks, as does a change that was never approved.
  function carrySpecApproval(prior, next, id, delta, reason) {
    const approval = prior.specApproval;
    if (!approval?.identity || !approval.decisionRef || prior.pendingApprovalDelta ||
        Number(approval.revision) !== Number(prior.contractRevision || 0) ||
        delta.removed?.length) return false;
    const carriedAt = now();
    const fromRevision = Number(approval.revision);
    const toRevision = Number(next.contractRevision || 0);
    const { carriedFrom: _prior, ...consent } = approval;
    const identity = agreementIdentity(approvalPacketRootFor(next, id), id);
    // Lane consent carries under the same rule as the whole approval.
    const lanes = consent.lanes ? Object.fromEntries(Object.entries(consent.lanes)
      .map(([role, lane]) => [role, { ...lane, identity, revision: toRevision }])) : undefined;
    const carried = { ...consent, ...(lanes ? { lanes } : {}), identity,
      revision: toRevision, carriedFrom: { revision: fromRevision, reason, carriedAt } };
    // The revision may route new roles: carried lanes still count, and a newly
    // required lane must approve before the approval is whole again.
    const { required } = approvalLanes(id, next);
    const missing = required.filter((role) => !lanes?.[role]);
    if (required.length && (lanes || missing.length)) {
      const { identity: _identity, revision: _revision, decisionRef: _ref, approvedAt: _at, ...rest } = carried;
      next.specApproval = missing.length
        ? { ...rest, required: true, lanes: lanes || {}, requiredLanes: required }
        : { ...carried, requiredLanes: required };
    } else next.specApproval = carried;
    next.approvalCarries = [...(prior.approvalCarries || []), {
      fromRevision, toRevision, reason,
      delta: { added: delta.added || [], revised: delta.revised || [], removed: [] },
      carriedAt
    }];
    delete next.pendingApprovalDelta;
    return true;
  }

  function revisionRuntimePath(id) {
    return join(root, ".foundation", "runtime", `${id}.json`);
  }

  // A pre-Build revision replaces the whole compiled packet, so it is limited
  // to changes whose agreement has not produced any Build or Prove result.
  function assertRevisable(id) {
    // Archive moves the packet but keeps runtime state, so status is checked
    // first to return the successor-change route rather than "not found".
    if (!existsSync(revisionRuntimePath(id)))
      fail(`change revise requires an existing active change; '${id}' was not found`);
    const state = loadRuntime(id);
    if (["proven", "archived"].includes(state.status))
      fail(`change revise cannot rewrite an agreement in '${state.status}' status; ` +
        "start a successor change");
    if (!existsSync(changePath(id)))
      fail(`change revise requires an existing active change; '${id}' was not found`);
    if (!isSemanticVersion(state.semanticDraftVersion))
      fail(`change revise requires a semantic-draft v3 or v4 change; '${id}' is a legacy agreement`);
    const amend = `claude-foundation change amend ${id} <amendment.json> --inspect`;
    const receipts = join(root, ".foundation", "receipts", id);
    const built = (state.workspace && (state.workspace.mode !== "current" ||
        resolve(state.workspace.path || root) !== resolve(root))) ||
      (existsSync(receipts) && readdirSync(receipts).length > 0) ||
      /^\s*-\s*\[[xX]\]/m.test(readFileSync(join(changePath(id), "tasks.md"), "utf8"));
    if (built)
      fail(`change revise is only available before Build; '${id}' has Build or proof state. ` +
        `Use '${amend}' instead`);
    return state;
  }

  // A revise recompiles the whole draft; requirement keys and the capability
  // the replaced packet already uses keep their identity.
  function priorDraftIdentity(id) {
    const evidencePath = join(changePath(id), "evidence.yaml");
    const claims = existsSync(evidencePath) ? readJson(evidencePath).claims || [] : [];
    const specs = join(changePath(id), "specs");
    return {
      priorRequirementKeys: [...new Set([
        ...Object.keys(loadRuntime(id).requirementFingerprints || {}),
        ...claims.map((claim) => String(claim?.requirementKey || "").trim()).filter(Boolean)
      ])],
      priorCapabilities: existsSync(specs)
        ? readdirSync(specs, { withFileTypes: true })
          .filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        : []
    };
  }

  // The draft a packet was compiled from, bound to the contract revision it
  // produced: an amendment or grounding reopen afterwards changes the
  // agreement without it, so a partial revision would silently drop that.
  function compiledDraftSource(state, draft) {
    return { contractRevision: Number(state.contractRevision || 0), draft: declaredDraftRisk(draft) };
  }

  // `merge` applies the file as a patch to the draft the change was compiled
  // from (see mergeSemanticDraft); without it the file is the whole draft.
  function revisionSource(id, draftPath, { merge = false } = {}) {
    const folderIssues = [];
    const source = merge ? mergedRevisionSource(id, draftPath)
      : draftSource(draftPath, priorDraftIdentity(id), { folderIssues });
    if (source.id !== undefined && source.id !== id && slugify(source.id) !== id)
      fail(`change revise draft id '${source.id}' does not match change '${id}'`);
    const revision = { ...source, id };
    if (folderIssues.length) revisionFolderIssues.set(revision, folderIssues);
    return revision;
  }

  // A v5 folder's heading/prose issues, keyed by the revision source they
  // belong to; kept off the draft so its digest and recorded copy stay clean.
  const revisionFolderIssues = new WeakMap();

  function mergedRevisionSource(id, draftPath) {
    const path = resolve(root, draftPath);
    if (!pathInside(root, path) || !existsSync(path))
      fail("change revise --merge requires a JSON patch file inside the project");
    if (statSync(path).isDirectory())
      fail("change revise --merge takes a JSON patch file; pass a v5 draft folder without --merge");
    const state = loadRuntime(id);
    const base = state.draftSource?.draft;
    if (!base || typeof base !== "object")
      fail(`change revise --merge needs the draft '${id}' was compiled from, which changes ` +
        "started before partial revision do not record; pass the whole revised draft without --merge");
    if (state.draftSource.contractRevision !== Number(state.contractRevision || 0))
      fail(`change revise --merge cannot patch '${id}': its agreement changed after the recorded ` +
        "draft (an amendment or grounding reopen); pass the whole revised draft without --merge");
    const patch = readJson(path);
    // A merge patches content; moving the draft between versions (v4 to v5)
    // changes how every row is read, so it takes a whole-draft revision.
    if (patch?.version !== undefined && patch.version !== base.version)
      fail(`change revise --merge cannot change the draft version of '${id}' ` +
        `(${base.version ?? "unversioned"} to ${patch.version}); pass the whole revised draft without --merge`);
    let merged;
    try { merged = mergeSemanticDraft(base, patch); }
    catch (error) { fail(`change revise --merge: ${error.message || error}`); }
    // A minimal draft stays minimal, so rows the patch adds without a key get
    // derived keys, titles, and scenario names exactly as at start. A minimal
    // v5 draft keeps version 5; only the implicit v4 version is dropped.
    if (merged._minimalDraft && patch.version === undefined && merged.version !== DRAFT_FOLDER_VERSION)
      delete merged.version;
    // A minimal v5 draft is keyed after its first expansion; its marker is what
    // keeps it minimal, so only an implicit-v4 draft drops it.
    if (merged.version !== DRAFT_FOLDER_VERSION) delete merged._minimalDraft;
    return withDerivedRisk(
      expandMinimalSemanticDraft(merged, { ...minimalDraftContext, ...priorDraftIdentity(id) }));
  }

  function reviseRoute(id, draftPath, merge) {
    return `claude-foundation change revise ${id} ${draftPath}${merge ? " --merge" : ""}`;
  }

  function revisionIntakeOptions(id, draftPath, source, { merge = false } = {}) {
    const resume = `${reviseRoute(id, draftPath, merge)} --inspect`;
    return {
      statePath: semanticIntakeStatePath(draftPath, `revise:${id}`),
      resume,
      inspect: () => inspectRevision(id, draftPath, { quiet: true, preparedSource: source, merge })
    };
  }

  function inspectRevision(id, draftPath, options = {}) {
    assertRevisable(id);
    const merge = Boolean(options.merge);
    const source = options.preparedSource || revisionSource(id, draftPath, { merge });
    if (!isSemanticV4Plus(source.version))
      fail(`change revise --inspect requires a semantic-draft v4 or v5 draft; got version ${source.version}`);
    const { statePath, resume } = revisionIntakeOptions(id, draftPath, source, { merge });
    return inspectSemanticIntakeSource(source, {
      statePath, resume, quiet: options.quiet,
      excludedSourcePath: relative(root, resolve(root, draftPath)).replaceAll("\\", "/"),
      extraIssues: revisionFolderIssues.get(source) || []
    });
  }

  function reviseChange(id, draftPath, options = {}) {
    const observedRevision = amendmentRevision(assertRevisable(id));
    return withAmendmentLock(id, observedRevision,
      () => reviseChangeUnlocked(id, draftPath, options, observedRevision), "change revision");
  }

  function reviseChangeUnlocked(id, draftPath, options, expectedRevision) {
    const prior = assertRevisable(id);
    setOperationChangeId(id);
    const merge = Boolean(options.merge);
    const source = revisionSource(id, draftPath, { merge });
    const intake = revisionIntakeOptions(id, draftPath, source, { merge });
    // One call: a missing or stale intake is inspected in place. DONE revises;
    // any other action is printed as `--inspect` would and nothing changes.
    // Folder prose issues never pass a recorded intake: they always reinspect.
    const completedIntakeEffectiveness = revisionFolderIssues.has(source)
      ? { [INCOMPLETE_INTAKE]: intake.inspect() }
      : completedDraftIntake(source, draftPath, { ...intake, reinspect: true });
    const incomplete = completedIntakeEffectiveness?.[INCOMPLETE_INTAKE];
    if (incomplete) {
      console.log(JSON.stringify(incomplete, null, 2));
      return incomplete;
    }
    const { draft, rapid, resolutionFlags } = preflightDraft(draftPath, source);

    // Build does not take this lock, so recheck that no workspace, receipt, or
    // revision appeared during intake and compilation before anything moves.
    assertAmendmentRevision(id, expectedRevision, "change revision");
    assertRevisable(id);
    const basePath = changePath(id);
    const runtimeFile = revisionRuntimePath(id);
    // Changes compiled before draft fingerprints existed compare both sides
    // from their packets so one method never marks every requirement revised.
    const storedBefore = prior.requirementFingerprints;
    const before = storedBefore || packetFingerprints(basePath);
    const priorRuntime = readFileSync(runtimeFile);
    const transactionRoot = mkdtempSync(join(dirname(basePath), `.${id}-revise-`));
    const priorPath = join(transactionRoot, "prior");
    let moved = false;
    let delta;
    try {
      renameSync(basePath, priorPath);
      moved = true;
      trapFailures(() => {
        createChange(draft.intent, { rapid, id }, draft, {
          availabilityChecked: true, deferSessionBinding: true
        });
        // Signals persist before resolve so its printed review route counts them.
        persistRiskSignals(id, draft.riskSignals);
        atomicStepOutput = true;
        let resolution;
        try { resolution = resolveChange(id, resolutionFlags); }
        finally { atomicStepOutput = false; }
        if (resolution.upgraded) materializeDraft(id, draft);
        persistFixes(id, draft.fixes);
        validate(id, "root");
        bindClaudeSession(id, "change");
        const next = loadRuntime(id);
        next.revision = Number(prior.revision || 0) + 1;
        next.contractRevision = Number(prior.contractRevision || 0) + 1;
        next.executionRevision = Number(prior.executionRevision || 0) + 1;
        next.createdAt = prior.createdAt || next.createdAt;
        if (prior.budget) next.budget = prior.budget;
        next.specApproval = { required: true };
        if (completedIntakeEffectiveness)
          next.semanticIntakeEffectiveness = completedIntakeEffectiveness;
        const draftFingerprints = draftRequirementFingerprints(draft);
        delta = requirementDelta(before,
          storedBefore ? draftFingerprints : packetFingerprints(basePath));
        next.requirementFingerprints = draftFingerprints;
        next.draftSource = compiledDraftSource(next, source);
        if (!carrySpecApproval(prior, next, id, delta, "pre-build-revision")) {
          if (prior.pendingApprovalDelta) next.pendingApprovalDelta = prior.pendingApprovalDelta;
          recordApprovalDelta(next, delta);
        }
        next.revisions = [...(prior.revisions || []), {
          version: 1, revision: next.contractRevision, kind: "pre-build-revision",
          delta, appliedAt: now()
        }];
        saveRuntime(next);
      });
    } catch (error) {
      const issues = [];
      try {
        if (moved) {
          rmSync(basePath, { recursive: true, force: true });
          renameSync(priorPath, basePath);
        }
        writeFileSync(runtimeFile, priorRuntime);
      } catch (restoreError) {
        issues.push(`restore failed: ${restoreError.message || restoreError}; ` +
          `prior packet retained at ${relative(root, priorPath)}`);
      }
      if (!issues.length) rmSync(transactionRoot, { recursive: true, force: true });
      fail(`${error?.message || error}; ${issues.length
        ? issues.join("; ") : "change revision rolled back"}`);
    }
    rmSync(transactionRoot, { recursive: true, force: true });
    if (options.consumeDraft) {
      // A v5 draft is a folder; a file draft stays a single unlink.
      try { rmSync(resolve(root, draftPath), { recursive: true }); }
      catch (error) {
        console.error(`WARNING: revision succeeded but could not remove draft '${
          draftPath}': ${error.message}`);
      }
    }
    try { rmSync(intake.statePath, { force: true }); }
    catch (error) {
      console.error(`WARNING: revision succeeded but could not remove semantic intake state: ${
        error.message}`);
    }
    const state = loadRuntime(id);
    const pending = state.pendingApprovalDelta;
    const openQuestions = designOpenQuestions(id, root);
    console.log(`REVISED ${id}\n  revision: ${state.contractRevision}\n` +
      (pending
        ? `  requirement delta awaiting approval:\n${formatApprovalDelta(pending)}\n`
        : `  requirement delta (covered by the current approval):\n${formatApprovalDelta(delta)}\n`) +
      `  inspect: openspec/changes/${id}/\n` + packetFileLines(id) +
      openQuestionLines(openQuestions) +
      designWarningLines(draft, state.schema, source) +
      `  next: ${openQuestions.length
        ? `ask these with the approval, record the answers in the draft, then ${reviseRoute(id, draftPath, merge)} --approve-spec --decision-ref <user-decision> --through proven`
        : pending || !state.specApproval?.identity
          ? `claude-foundation advance ${id} --approve-spec --decision-ref <user-decision> --through proven`
          : `claude-foundation advance ${id} --through ${resumeThrough(state)}`}`);
    return delta;
  }

  // Claims whose command evidence already passed and is still valid: the task
  // verify commands those receipts ran are finished work, not open drafts.
  function provenCommandClaimIds(id) {
    if (!receiptPath || !receiptValidity || !requiredProviders || !providerConfig ||
        !claimsForProvider) return [];
    return [...new Set(requiredProviders(id).flatMap((provider) => {
      if (!["command", "test-discovery"].includes(providerConfig(id, provider)?.adapter)) return [];
      const path = receiptPath(id, provider);
      if (!existsSync(path)) return [];
      let receipt = null;
      try { receipt = readJson(path); } catch { return []; }
      if (receipt?.status !== "pass" || receiptValidity(id, provider).validity !== "valid") return [];
      return claimsForProvider(id, provider).map((claim) => claim.id);
    }))];
  }

  function amendChangeUnlocked(id, amendmentPath, options, state, expectedRevision) {
    if (!isSemanticVersion(state.semanticDraftVersion))
      fail(`change amend requires a semantic-draft v3 or v4 change; '${id}' is a legacy agreement`);
    if (["applied", "archived"].includes(state.status))
      fail(`change amend cannot rewrite an agreement in '${state.status}' status; start a successor change`);
    if (state.land?.status || state.workspace?.applied)
      fail("change amend cannot rewrite an agreement after Land has started; recover Land before starting a successor change");
    const source = resolve(root, amendmentPath);
    if (!pathInside(root, source) || !existsSync(source))
      fail("change amend requires a JSON file inside the project");
    const amendment = readJson(source);
    if (amendment.investigation) {
      const bindingIssues = validateInvestigationBinding({ projectRoot: root, binding: amendment.investigation, git });
      if (bindingIssues.length) fail(`investigation amendment binding failed:\n  - ${bindingIssues.join("\n  - ")}`);
    }
    const amendmentStatePath = semanticIntakeStatePath(amendmentPath, `amend:${id}`);
    let completedAmendmentIntakeEffectiveness = null;
    // A verify-only correction changes no requirement, so it has no semantic
    // intake to complete.
    // A sections-only amendment rewrites prose and no requirement either.
    const sectionsOnly = sectionsOnlyAmendment(amendment);
    if (isSemanticV4Plus(state.semanticDraftVersion) && !taskContractOnlyAmendment(amendment) &&
        !sectionsOnly) {
      const resume = `claude-foundation change amend ${id} ${amendmentPath} --inspect`;
      let intakeState = null;
      if (existsSync(amendmentStatePath)) {
        try { intakeState = JSON.parse(readFileSync(amendmentStatePath, "utf8")); }
        catch { intakeState = null; }
      }
      const intakeSource = amendmentIntakeSource(amendment);
      const amendmentRelativePath = relative(root, source).replaceAll("\\", "/");
      const intelligence = repositoryIntelligence(intakeSource, [amendmentRelativePath],
        { standardLane: state.schema === "foundation-standard" });
      const sourceInspection = intelligenceUsable(intelligence)
        ? semanticSourceInspection(intakeSource, null, intelligence.selected)
        : inspectSemanticSources({ projectRoot: root, sourcePaths: [] });
      const projection = semanticIntakeResumeProjection(intakeState, intakeSource, {
        resumeRoute: resume, sourceInventory: sourceInspection.inventory
      });
      if (!intelligenceUsable(intelligence) || sourceInspection.findings.length ||
          projection.status !== "current" || projection.action?.action !== "DONE") {
        // One call: inspect in place. DONE amends; any other action is printed
        // as `--inspect` would and the agreement is left untouched.
        const inspected = inspectAmendment(id, amendmentPath,
          { quiet: true, preparedSource: amendment });
        if (inspected.action !== "DONE") {
          console.log(JSON.stringify(inspected, null, 2));
          return inspected;
        }
        completedAmendmentIntakeEffectiveness = inspected.effectiveness || null;
      } else completedAmendmentIntakeEffectiveness = intakeState?.effectiveness || null;
    }
    const basePath = activeChangePath(id, state);
    // A task-contract amendment skips intake, so its repository binding is
    // checked here; an intake amendment was checked by its inspection.
    if (taskContractOnlyAmendment(amendment)) {
      const repositoryIssues = amendmentRepositoryIssues(id, state, amendment);
      if (repositoryIssues.length)
        fail(`semantic amendment validation failed:\n  - ${repositoryIssues.join("\n  - ")}`);
    }
    const contract = readJson(join(basePath, "evidence.yaml"));
    const tasksContent = readFileSync(join(basePath, "tasks.md"), "utf8");
    const compiled = compileSemanticAmendment({
      amendment, contract, tasksContent, slugify, renderTask: renderDraftTask,
      investigationSource: state.investigationAgreement || state.draftSource?.draft,
      semanticDraftVersion: state.semanticDraftVersion,
      provenClaimIds: (amendment?.updateTasks || []).some((task) =>
        task && ["verify", "paths", "dependsOn"].some((field) => Object.hasOwn(task, field))) ||
        (Array.isArray(amendment?.removeTasks) && amendment.removeTasks.length)
        ? provenCommandClaimIds(id) : [],
      retiredTaskIds: (state.amendments || []).flatMap((row) =>
        (row?.removedTasks || []).map((task) => task?.id).filter(Boolean)),
      repositories: declaredRepositories(),
      repositorySelection: changeRepositoryRows(basePath),
      loadCanonicalSpec: (capability) => {
        const path = join(root, "openspec", "specs", slugify(capability), "spec.md");
        return existsSync(path) ? readFileSync(path, "utf8") : null;
      }
    });
    if (compiled.issues.length)
      fail(`semantic amendment validation failed:\n  - ${compiled.issues.join("\n  - ")}`);
    const coverageChanges = [...(compiled.discovery?.coverage || []).map((row) => ({
      dimension: row.dimension,
      claimIds: compiled.claims.filter((claim) =>
        (row.covers || []).includes(claim.requirementKey)).map((claim) => claim.id)
    })),
    // A changed task verify command invalidates the evidence for that task's
    // claims (every claim when the task binds none), so Prove reruns it.
    ...(compiled.taskContractChanges.length
      ? [{ dimension: "task-verify", claimIds: compiled.taskContractClaimIds }] : []),
    // A withdrawn task's claims are now proven by the tasks that keep them.
    ...(compiled.removedTasks?.length
      ? [{ dimension: "task-removal", claimIds: compiled.removedTaskClaimIds }] : []),
    // An added task's claims are proven again with it, even for a requirement
    // the agreement already had.
    ...(compiled.addedTaskClaimIds?.length
      ? [{ dimension: "task-addition", claimIds: compiled.addedTaskClaimIds }] : [])];
    const configuredProviderNames = requiredProviders ? requiredProviders(id) : [];
    const providerEntries = new Map(Object.entries(compiled.providers || {}));
    for (const name of configuredProviderNames) {
      if (providerEntries.has(name)) continue;
      const config = providerConfig ? providerConfig(id, name) : null;
      if (config) providerEntries.set(name, config);
    }
    const providers = Object.fromEntries([...providerEntries].map(([name, config]) => [name, {
        capability: config.capability || name,
        ...(Array.isArray(config.claims) ? { claims: config.claims.filter((claim) =>
          !compiled.removedClaimIds.includes(claim)) } : {}),
        ...(Array.isArray(config.dependsOn) ? { dependsOn: config.dependsOn } : {})
      }]
    ));
    const invalidation = sectionsOnly ? documentSectionInvalidation(providers) : planAmendmentInvalidation({
      claims: compiled.claims,
      tasks: taskBlocks(compiled.tasksContent).map(taskMetadata),
      providers,
      coverageDelta: {
        addedClaimIds: compiled.addedClaimIds,
        changedClaimIds: compiled.changedClaimIds,
        removedClaimIds: compiled.removedClaimIds,
        coverageChanges
      },
      priorClaims: compiled.priorClaims
    });
    if (invalidation.status !== "READY")
      fail(`semantic amendment invalidation planning failed:\n  - ${
        invalidation.findings.map((finding) => `${finding.code}: ${finding.message}`).join("\n  - ")}`);
    compiled.invalidation = invalidation;

    const priorContractRevision = Number(state.contractRevision || 0);
    const priorContractFingerprint = contractFingerprint ? contractFingerprint(id) : null;
    const proofAdvancePath = join(root, ".foundation", "evidence", id, "proof-advance.json");
    const priorProofAdvance = existsSync(proofAdvancePath)
      ? readFileSync(proofAdvancePath, "utf8") : null;
    const receiptBackups = new Map();
    const receiptBindings = [];
    if (receiptPath && existsSync(dirname(receiptPath(id, "__provider__")))) {
      for (const provider of invalidation.proof.preserveReceipts) {
        const path = receiptPath(id, provider);
        if (!existsSync(path)) continue;
        const receipt = readJson(path);
        receiptBackups.set(provider, receipt);
        const binding = selectiveBinding(id, provider, priorContractRevision, receipt);
        if (binding) receiptBindings.push(binding);
      }
    }

    const transactionRoot = mkdtempSync(join(dirname(basePath), `.${id}-amend-`));
    const stagedPath = join(transactionRoot, "next");
    const priorPath = join(transactionRoot, "prior");
    cpSync(basePath, stagedPath, { recursive: true, errorOnExist: true });
    // The amendment history line carries the contract revision it produces.
    try {
      writeSemanticAmendment(stagedPath, compiled, slugify,
        { schema: state.schema, revision: priorContractRevision + 1 });
    }
    catch (error) {
      rmSync(transactionRoot, { recursive: true, force: true });
      fail(`${error?.message || error}; semantic amendment rolled back`);
    }
    const priorState = structuredClone(state);
    const rebindAuditPaths = [];
    const rebindAudits = [];
    let installed = false;
    try {
      assertAmendmentRevision(id, expectedRevision);
      renameSync(basePath, priorPath);
      renameSync(stagedPath, basePath);
      installed = true;
      validate(id, "active");
      assertAmendmentRevision(id, expectedRevision);
      const currentContractRevision = priorContractRevision + 1;
      const currentRequiredProviders = requiredProviders ? requiredProviders(id) : [];
      const currentBindings = invalidation.proof.preserveReceipts
        .map((provider) => selectiveBinding(id, provider, currentContractRevision))
        .filter(Boolean);
      let proofRecovery = planSelectiveProofRecovery({
        changeId: id,
        invalidation,
        requiredProviders: currentRequiredProviders,
        receiptBindings,
        currentBindings,
        priorContractRevision,
        currentContractRevision
      });
      compiled.invalidation.proofRecovery = proofRecovery;
      if (proofRecovery.status === "READY" && receiptPath && contractFingerprint) {
        const nextFingerprint = contractFingerprint(id);
        for (const provider of proofRecovery.providers.preserved) {
          const priorReceipt = receiptBackups.get(provider);
          if (!priorReceipt) throw new Error(`selective proof receipt '${provider}' disappeared`);
          // A task-only amendment leaves the contract as it was: a receipt
          // already bound to it needs no rebind, and one that is not is rerun.
          if (nextFingerprint === priorContractFingerprint) {
            if (priorReceipt.contractFingerprint !== nextFingerprint)
              compiled.invalidation.proofRecovery = proofRecovery = demoteSelectivePreservation(
                proofRecovery, provider, "RECEIPT_STALE_FOR_UNCHANGED_CONTRACT");
            continue;
          }
          const rebound = rebindSelectiveProofReceipt({
            receipt: priorReceipt,
            provider,
            plan: proofRecovery,
            fromContractFingerprint: priorContractFingerprint,
            toContractFingerprint: nextFingerprint,
            reboundAt: now()
          });
          writeJson(receiptPath(id, provider), rebound);
          if (receiptValidity(id, provider).validity !== "valid")
            throw new Error(`selective proof receipt '${provider}' failed post-rebind validation`);
          const audit = {
            version: 1,
            kind: "semantic-amendment-receipt-rebind",
            changeId: id,
            provider,
            recordedAt: rebound.contractRebind.reboundAt,
            contract: proofRecovery.contract,
            decision: proofRecovery.decisions.find((row) => row.provider === provider),
            priorReceiptDigest: stableHash(priorReceipt),
            reboundReceiptDigest: stableHash(rebound)
          };
          const auditDirectory = join(root, ".foundation", "evidence", id, "receipt-rebinds");
          mkdirSync(auditDirectory, { recursive: true });
          const providerKey = createHash("sha256").update(provider).digest("hex").slice(0, 12);
          const auditPath = join(auditDirectory,
            `${currentContractRevision}-${providerKey}-${stableHash(audit).slice(0, 12)}.json`);
          writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, {
            encoding: "utf8", flag: "wx"
          });
          rebindAuditPaths.push(auditPath);
          rebindAudits.push({
            provider,
            path: relative(root, auditPath).replaceAll("\\", "/"),
            digest: stableHash(audit)
          });
        }
      }
      const nextState = loadRuntime(id);
      if (compiled.investigationAgreement) nextState.investigationAgreement = compiled.investigationAgreement;
      nextState.revision = Number(nextState.revision || 0) + 1;
      nextState.contractRevision = Number(nextState.contractRevision || 0) + 1;
      nextState.executionRevision = Number(nextState.executionRevision || 0) + 1;
      nextState.amendments = [...(nextState.amendments || []), {
        version: 1,
        revision: nextState.contractRevision,
        reason: String(amendment.reason || "Agreement expanded during Build"),
        requirementKeys: compiled.addedRequirementKeys,
        revisedRequirementKeys: compiled.revisedRequirementKeys,
        removedRequirementKeys: compiled.removedRequirementKeys,
        removedClaims: compiled.removedClaimIds,
        invalidatedClaims: compiled.invalidatedClaims,
        ...(compiled.taskContractChanges.length
          ? { taskContractChanges: compiled.taskContractChanges } : {}),
        ...(compiled.removedTasks?.length ? { removedTasks: compiled.removedTasks } : {}),
        invalidation: {
          affectedTasks: invalidation.affectedTasks,
          affectedProviders: invalidation.affectedProviders,
          preservedProviders: invalidation.preservedProviders,
          approval: invalidation.approval,
          proof: invalidation.proof,
          proofRecovery,
          rebindAudits
        },
        ...(completedAmendmentIntakeEffectiveness
          ? { semanticIntakeEffectiveness: completedAmendmentIntakeEffectiveness } : {}),
        appliedAt: now()
      }];
      const amendmentDelta = {
        added: compiled.addedRequirementKeys,
        revised: compiled.revisedRequirementKeys,
        removed: compiled.removedRequirementKeys
      };
      const requirementDelta = Object.values(amendmentDelta).some((keys) => keys.length);
      // Merge the amendment's risk signals before carrying consent: approval
      // lanes are routed from them, and a new signal can require a new lane.
      const amendedSignals = riskSignalValues([
        ...(priorState.riskSignals || []), ...(amendment.riskSignals || [])]);
      if (amendedSignals.length) nextState.riskSignals = amendedSignals;
      if (!carrySpecApproval(priorState, nextState, id, amendmentDelta,
        `semantic-amendment: ${String(amendment.reason || "Agreement expanded during Build")}`) &&
          (requirementDelta || nextState.pendingApprovalDelta))
        recordApprovalDelta(nextState, amendmentDelta);
      if (nextState.requirementFingerprints) {
        const fingerprints = { ...nextState.requirementFingerprints,
          ...draftRequirementFingerprints({
            requirements: [...(amendment.addRequirements || []),
              ...(amendment.reviseRequirements || [])],
            evidence: amendment.evidence
          }) };
        for (const key of compiled.removedRequirementKeys) delete fingerprints[key];
        nextState.requirementFingerprints = fingerprints;
      }
      // A proven candidate is still amendable until Land begins. Re-enter
      // Build so advance dispatches added tasks and re-finalizes this revision;
      // the prior proof and Land grant cannot authorize the amended packet.
      if (priorState.status === "proven")
        transitionLifecycleState(nextState, "building", "proven-agreement-amended");
      saveRuntime(nextState);
      // A prior proof-advance checkpoint describes the old contract. Even when
      // every executable receipt is preserved, the coordinator must re-enter
      // Prove and finalize the amended packet instead of accepting that stale
      // READY projection as if it covered the new revision.
      rmSync(proofAdvancePath, { force: true });
      rmSync(priorPath, { recursive: true, force: true });
    } catch (error) {
      if (installed && existsSync(basePath))
        rmSync(basePath, { recursive: true, force: true });
      if (existsSync(priorPath)) renameSync(priorPath, basePath);
      if (receiptPath)
        for (const [provider, receipt] of receiptBackups)
          writeJson(receiptPath(id, provider), receipt);
      for (const path of rebindAuditPaths) rmSync(path, { force: true });
      if (priorProofAdvance !== null) {
        mkdirSync(dirname(proofAdvancePath), { recursive: true });
        writeFileSync(proofAdvancePath, priorProofAdvance);
      }
      if (installed) saveRuntime(priorState);
      fail(`${error?.message || error}; semantic amendment rolled back`);
    } finally {
      rmSync(transactionRoot, { recursive: true, force: true });
    }
    if (options.consumeAmendment) {
      try { rmSync(source); }
      catch (error) {
        console.error(`WARNING: amendment succeeded but could not remove '${
          relative(root, source)}': ${error.message}`);
      }
    }
    try { rmSync(amendmentStatePath, { force: true }); }
    catch (error) {
      console.error(`WARNING: amendment succeeded but could not remove semantic intake state: ${
        error.message}`);
    }
    const amended = loadRuntime(id);
    console.log(`AMENDED ${id}\n  revision: ${amended.contractRevision}\n` +
      `  invalidated claims: ${[...compiled.invalidatedClaims, ...compiled.removedClaimIds.map((claim) =>
        `${claim} (removed)`)].join(", ") || "none"}\n` +
      (compiled.removedTasks?.length ? `  removed tasks: ${compiled.removedTasks.map((task) =>
        task.key ? `${task.id} (${task.key})` : task.id).join(", ")}\n` : "") +
      (compiled.taskContractChanges.some((task) => task.reopened)
        ? `  reopened tasks: ${compiled.taskContractChanges.filter((task) => task.reopened)
          .map((task) => task.id).join(", ")} (verified again before they count as done)\n` : "") +
      `  proof: ${compiled.invalidation.proofRecovery?.recovery?.instruction ||
        "re-enter Prove so receipt bindings are recomputed"}\n` +
      formatInvalidatedWaivers(id, amended.waivers, amended.contractRevision) +
      (amended.pendingApprovalDelta
        ? `  requirement delta awaiting approval:\n${formatApprovalDelta(amended.pendingApprovalDelta)}\n`
        : `  requirement delta (covered by the current approval):\n${formatApprovalDelta({
          added: compiled.addedRequirementKeys, revised: compiled.revisedRequirementKeys,
          removed: compiled.removedRequirementKeys })}\n`) +
      `  proof command: ${compiled.invalidation.proofRecovery?.recovery?.command ||
        `claude-foundation advance ${id} --through proven`}\n` +
      `  next: claude-foundation advance ${id}`);
    return compiled;
  }

  function amendChange(id, amendmentPath, options = {}) {
    const state = loadRuntime(id);
    const observedRevision = amendmentRevision(state);
    return withAmendmentLock(id, observedRevision,
      () => amendChangeUnlocked(id, amendmentPath, options, state, observedRevision));
  }

  return {
    templateDir,
    instantiate,
    loadDraft,
    materializeDraft,
    createChange,
    rapidStartTemplate,
    amendmentTemplate: semanticAmendmentTemplate,
    inspectDraft,
    inspectAmendment,
    startAtomic,
    inspectRevision,
    reviseChange,
    amendChange,
    resolveChange,
    openQuestionsDecision
  };
}
