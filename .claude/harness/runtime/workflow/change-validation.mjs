import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { auditTraceability } from "../evidence/traceability.mjs";
import { detectEvidenceWiring } from "../evidence/evidence-bootstrap.mjs";
import { nextAfterValidate } from "../core/next-step.mjs";
import { gateRepairPlan } from "../core/convergent-gate.mjs";
import { compiledExecutionSurfaceValue } from "../core/authority-policy.mjs";
import {
  taskBlocks, taskMetadata
} from "../contracts/change-artifacts.mjs";
import { createSpecDeltaValidator } from "./validation/spec-delta.mjs";

const GROUNDING_READ_ROLES = [
  "requirement", "backlog", "architecture", "contract", "composition-root",
  "runtime-path", "production-path", "test-topology", "dependency-source", "history"
];
const CRITICAL_CASE_ORACLES = [
  "production-entry", "real-wire", "contract-oracle", "failure-path"
];

// Module scope, taking `fail` explicitly: the check has no runtime state and
// the deterministic tests exercise it against a stubbed CLI.
export function assertOpenSpecStrictValid(id, dir, fail, options = {}) {
  // dir is <projectRoot>/openspec/changes/<id> for both the root and the
  // sandbox copy, so the CLI runs against whichever tree is being validated.
  const projectRoot = resolve(dir, "..", "..", "..");
  const probe = spawnSync("openspec", ["--version"], {
    cwd: projectRoot, encoding: "utf8", timeout: 15_000
  });
  if (probe.error || probe.status !== 0) {
    if (!options.quiet)
      console.error("WARNING: OpenSpec CLI unavailable; strict spec lint deferred to tool preparation");
    return;
  }
  const lint = spawnSync("openspec",
    ["validate", id, "--type", "change", "--strict", "--json", "--no-interactive"],
    { cwd: projectRoot, encoding: "utf8", timeout: 60_000 });
  if (lint.error || lint.status !== 0) {
    const raw = `${lint.stdout || ""}\n${lint.stderr || ""}`.trim();
    let detail = raw.slice(0, 4000);
    try {
      const report = JSON.parse(lint.stdout);
      const issues = (report.items || []).flatMap((item) => item.issues || []);
      if (issues.length) detail = issues.map((issue) =>
        `- ${issue.path || "spec"}: ${issue.message}`).join("\n");
    } catch { /* retain bounded raw CLI output */ }
    fail(`OpenSpec strict validation failed for '${id}'; repair the spec delta ` +
      `wording before Prove:\n${detail}\nRecovery: keep only non-empty delta files; ` +
      "each starts with ## ADDED Requirements, ## MODIFIED Requirements, or " +
      "## REMOVED Requirements.");
  }
}

function normalizedScope(path) {
  return String(path || "").replace(/^\.\//, "")
    .replace(/\/\*\*?$/, "").replace(/\/$/, "");
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globMatchesPath(scope, path) {
  const raw = String(scope || "").replace(/^\.\//, "").replace(/\/$/, "");
  let pattern = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === "*") {
      if (raw[index + 1] === "*") {
        pattern += ".*";
        index += 1;
      } else pattern += "[^/]*";
    } else if (character === "?") pattern += "[^/]";
    else pattern += escapeRegex(character);
  }
  return new RegExp(`^${pattern}$`).test(path);
}

function scopeCouldTouchPath(scope, path) {
  const raw = String(scope || "").replace(/^\.\//, "").replace(/\/$/, "");
  if (raw === "*") return true;
  if (/[*?]/.test(raw)) {
    if (globMatchesPath(raw, path)) return true;
    const prefix = raw.slice(0, raw.search(/[*?]/)).replace(/\/$/, "");
    return Boolean(prefix && (prefix === path || prefix.startsWith(`${path}/`)));
  }
  const normalized = normalizedScope(raw);
  return path === normalized || path.startsWith(`${normalized}/`) ||
    normalized.startsWith(`${path}/`);
}

export function groundingTaskOverlapFindings(readSet = [], tasks = []) {
  const immutableRoles = new Set([
    "requirement", "backlog", "architecture", "contract",
    "dependency-source", "history"
  ]);
  const findings = [];
  for (const source of readSet) {
    if (!immutableRoles.has(source?.role)) continue;
    const sourceRepo = source.repository || "root";
    const sourcePath = normalizedScope(source.path);
    if (!sourcePath) continue;
    for (const task of tasks.map(taskMetadata)) {
      if (!["implementation", "migration"].includes(task.kind) ||
          task.repository !== sourceRepo) continue;
      for (const declared of task.paths) {
        if (scopeCouldTouchPath(declared, sourcePath)) {
          findings.push({
            taskId: task.id,
            repository: sourceRepo,
            path: source.path,
            role: source.role,
            taskPath: declared
          });
          break;
        }
      }
    }
  }
  return findings;
}

function taskOwnsGroundingPath(tasks, repository, path) {
  return tasks.map(taskMetadata).some((task) =>
    ["implementation", "migration"].includes(task.kind) &&
    task.repository === repository && task.paths.some((scope) =>
      scopeCouldTouchPath(scope, path)));
}

export function plannedGroundingPathEligible(source, pathExists, tasks = [], firstLock = true) {
  if (source?.sha256 !== "planned") return false;
  if (!["production-path", "runtime-path", "test-topology"]
    .includes(source?.role)) return false;
  if (firstLock && pathExists) return false;
  return taskOwnsGroundingPath(tasks, source.repository || "root",
    normalizedScope(source.path));
}

export function plannedGroundingPathRecovery(source, pathExists, tasks = [], firstLock = true) {
  if (source?.sha256 !== "planned" || pathExists || !firstLock) return null;
  const allowedRoles = [
    "production-path", "runtime-path", "test-topology"
  ];
  if (!allowedRoles.includes(source?.role))
    return `path is marked planned but role '${source?.role || "missing"}' cannot own ` +
      `a new path; change role to ${allowedRoles.join("|")} and add ` +
      `[kind:implementation] [repo:${source?.repository || "root"}] ` +
      `[paths:${source?.path}] to its owning task`;
  if (taskOwnsGroundingPath(tasks, source.repository || "root",
    normalizedScope(source.path))) return null;
  const repository = source.repository || "root";
  return `path is marked planned but no implementation or migration task owns it; ` +
    `add [kind:implementation] [repo:${repository}] [paths:${source.path}] to the ` +
    `owning task (a matching glob is also valid), then keep sha256 as planned`;
}

export function groundingPathRowShapeIssue(label, row) {
  if (row && typeof row === "object" && !Array.isArray(row)) return null;
  return `${label} must be an object with repository and path, for example ` +
    `{"repository":"root","path":"src/index.js"}`;
}

export function groundingMissingReadSourceRecovery(sourcePath, repositoryId, role) {
  return `for a new path add ` +
    `{"repository":"${repositoryId}","path":"${sourcePath}",` +
    `"role":"${role}","mode":"full","sha256":"planned"} to readSet ` +
    `and add [kind:implementation] [repo:${repositoryId}] [paths:${sourcePath}] ` +
    `to its owning task`;
}

export function hasObservableSecurityControl(claim) {
  return /(?:cannot|denied|reject|refus|block|prevent|unauthor|forbid|invalid|malform|oversiz|travers|isolation|privacy|redact|saniti|escap)/i
    .test(`${claim?.id || ""} ${claim?.scenario || ""}`);
}

export function groundingInteractionRequirements({
  coupling = "isolated", repositoryCount = 1, capabilities = [], semantics = ""
} = {}) {
  const declared = capabilities instanceof Set ? capabilities : new Set(capabilities);
  const semanticText = String(semantics).toLowerCase();
  const explicitServiceBoundary =
    /\b(queue|message broker|rabbit(?:mq)?|kafka|webhook|cross-service|remote service|event (?:bus|stream|consumer|producer))\w*\b/
      .test(semanticText);
  const service = coupling === "coupled" || repositoryCount > 1 ||
    ["cross-repo-contract", "integration", "live", "queue"]
      .some((capability) => declared.has(capability)) ||
    explicitServiceBoundary;
  const wire = service || ["compatibility", "browser"]
    .some((capability) => declared.has(capability)) ||
    /\b(wire|contract|http|api|json|message|payload)\w*\b/.test(semanticText);
  return { service, wire };
}

export function claimContractIssues(claims = [], selectedRepositoryIds = new Set()) {
  return claims.flatMap((claim) => {
    const issues = [];
    if (!["low", "medium", "high"].includes(claim.impact || ""))
      issues.push(`claim '${claim.id}' requires impact low|medium|high`);
    if (claim.repositories !== undefined &&
        (!Array.isArray(claim.repositories) || claim.repositories.length === 0 ||
         claim.repositories.some((repository) => !selectedRepositoryIds.has(repository))))
      issues.push(`claim '${claim.id}' repositories must reference selected repositories`);
    if ((claim.repositories || []).length > 1 &&
        !claim.capabilities.includes("cross-repo-contract"))
      issues.push(`claim '${claim.id}' spans repositories and requires cross-repo-contract`);
    return issues;
  });
}

export function taskContractIssues(tasks = [], claims = [],
  selectedRepositoryIds = new Set(), multiRepository = false) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const issues = [];
  for (const task of tasks) {
    const metadata = taskMetadata(task);
    if (metadata.claims.length > 50)
      issues.push(`task '${task.id}' references more than 50 claims`);
    const unknownClaims = metadata.claims.filter((claim) => !claimById.has(claim));
    if (unknownClaims.length)
      issues.push(`task '${task.id}' references unknown claim(s): ${unknownClaims.join(", ")}`);
    const outOfScopeClaims = metadata.claims.filter((claimId) => {
      const repositories = claimById.get(claimId)?.repositories || [];
      return repositories.length > 0 && !repositories.includes(metadata.repository);
    });
    if (outOfScopeClaims.length)
      issues.push(`task '${task.id}' references claim(s) outside repository '${metadata.repository}': ${outOfScopeClaims.join(", ")}`);
  }
  if (!multiRepository) return issues;
  const unscopedTasks = tasks.filter((task) =>
    !/\[repo:[a-z0-9-]+\]/i.test(task.text));
  if (unscopedTasks.length)
    issues.push(`multi-repository tasks require [repo:<id>] scope (${unscopedTasks.map((task) => task.id).join(", ")})`);
  for (const task of tasks) {
    const metadata = taskMetadata(task);
    if (metadata.repository && !selectedRepositoryIds.has(metadata.repository))
      issues.push(`task '${task.id}' references unselected repository '${metadata.repository}'`);
    if (metadata.paths.some((path) =>
      isAbsolute(path) || path === ".." || path.startsWith("../") || path.includes("/../")))
      issues.push(`task '${task.id}' contains an unsafe path scope`);
    if (["implementation", "migration"].includes(metadata.kind) && metadata.paths.length === 0)
      issues.push(`multi-repository task '${task.id}' requires [paths:<repo-relative-paths>]`);
  }
  return issues;
}

export function validationPreflightIssues(id, state, missing = []) {
  const issues = [];
  if (missing.length)
    issues.push(`missing change artifacts: ${missing.join(", ")}`);
  if (state.resolutionRequired === true && !state.resolvedAt)
    issues.push(`resolve decisions for '${id}' before validation: claude-foundation change resolve ${id} --impact <low|medium|high> --coupling <isolated|coupled> --acceptance-required|--acceptance-not-required`);
  if (!["low", "medium", "high"].includes(state.impact || ""))
    issues.push(`resolve impact for '${id}'`);
  if (!["isolated", "coupled"].includes(state.coupling || ""))
    issues.push(`resolve coupling for '${id}'`);
  if (state.acceptance?.decision === "undecided")
    issues.push(`acceptance decision is unresolved for '${id}'; ask the user whether subjective human acceptance is required, then resolve with --acceptance-required or --acceptance-not-required`);
  return issues;
}

export function proposalClassificationIssues(state, proposal = "") {
  // Version-2 changes are created by the runtime with these fields. OpenSpec
  // owns the agreement; the runtime values are only its compiled projection.
  // Grandfather older packets whose free-form proposal had no stable labels.
  if (Number(state.version || 1) < 2) return [];
  const value = String(proposal || "");
  const field = (name) => value.match(
    new RegExp(`^\\s*-\\s*\\*\\*${name}:\\*\\*\\s*([^\\n]+?)\\s*$`, "im"))?.[1]
    ?.trim().toLowerCase() || null;
  const declared = { impact: field("Impact"), coupling: field("Coupling") };
  const issues = [];
  for (const [name, allowed] of Object.entries({
    impact: ["low", "medium", "high"], coupling: ["isolated", "coupled"]
  })) {
    // Packets created before the stable labels remain valid. Current templates
    // are synchronized by resolve; when a concrete label exists, it is part of
    // the agreement and must not drift from the compiled projection.
    if (declared[name] && allowed.includes(declared[name]) && declared[name] !== state[name])
      issues.push(`proposal.md ${name} '${declared[name]}' disagrees with compiled runtime ${name} '${state[name]}'; re-resolve the agreement instead of editing machine state`);
  }
  return issues;
}

export function assertValidationPreflight(id, state, missing, fail) {
  if (state.status === "archived") fail(`change '${id}' is already archived`);
  const issues = validationPreflightIssues(id, state, missing);
  if (issues.length)
    fail(`change validation preflight failed:\n  - ${issues.join("\n  - ")}`);
}

export function validationChangeDirectory(id, source, state,
  activeChangePath, changePath) {
  return source === "active" ? activeChangePath(id, state) : changePath(id);
}

export function validateImplementationTasks(tasks, fail) {
  const taskIds = tasks.map((task) => task.id).filter(Boolean);
  if (tasks.length && taskIds.length !== tasks.length)
    fail("every implementation task requires a stable ID such as T001");
  if (new Set(taskIds).size !== taskIds.length)
    fail("tasks.md contains duplicate task IDs");
  const lifecycleTasks = tasks.filter((task) =>
    !task.done && /(?:^|[\s(`"'])\/(?:prove|land)\b/.test(task.text));
  if (lifecycleTasks.length)
    fail("tasks.md contains a lifecycle gate; /prove and /land are commands, not implementation tasks");
  return taskIds;
}

export function normalizeValidationAcceptance(id, state, claims, acceptance,
  fail, warn = console.error, timestamp = new Date().toISOString()) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const unknown = acceptance.claimIds.filter((claim) => !claimById.has(claim));
  if (unknown.length)
    fail(`acceptance references unknown claim(s): ${unknown.join(", ")}`);
  let resolved = acceptance;
  if (resolved.required && resolved.claimIds.length === 0) {
    if (resolved.version < 2) {
      resolved = {
        ...resolved,
        claimIds: claims.map((claim) => claim.id),
        scopeOrigin: "legacy-all"
      };
      warn("WARNING: migrated legacy acceptance scope to all current claims");
    } else {
      fail(`change '${id}' requires acceptance but nothing is in scope. Either name the ` +
        "claims a person is accepting:\n" +
        `  claude-foundation change resolve ${id} --impact <impact> --coupling <coupling> ` +
        "--acceptance-required --acceptance-reason <why> --acceptance-claims <ids>\n" +
        "or declare capability 'acceptance' on a claim in evidence.yaml. To withdraw the " +
        "requirement instead, re-resolve with --acceptance-not-required.");
    }
  }
  if (!resolved.required) return resolved;
  if (resolved.scopeOrigin === "claim-capability")
    warn(`WARNING: acceptance stays required because claim(s) ${resolved.claimIds.join(", ")} declare capability 'acceptance'; --acceptance-not-required cannot drop a human gate while that capability remains in evidence.yaml`);
  state.acceptance = {
    version: 2,
    decision: "required",
    required: true,
    reason: resolved.reason || "declared evidence capability",
    claimIds: resolved.claimIds,
    scopeOrigin: resolved.scopeOrigin || "explicit",
    declaredAt: state.acceptance?.declaredAt || timestamp
  };
  return resolved;
}

export function validationDocumentBudgets(state) {
  return ["xs", "s"].includes(String(state.size || "").toLowerCase()) ||
    state.impact === "low"
    ? { "proposal.md": 900, "design.md": 1400, "tasks.md": 900 }
    : { "proposal.md": 1600, "design.md": 2600, "tasks.md": 1600 };
}

export function lockValidatedGrounding(state, grounding, fingerprint, timestamp) {
  if (!grounding?.firstLock) return;
  state.groundingDigest = grounding.digest;
  state.groundingLockedAt = grounding.lockedAt;
  if (!state.groundingReopenPending) return;
  state.groundingReopens = [...(state.groundingReopens || []), {
    ...state.groundingReopenPending,
    newDigest: grounding.digest,
    newLockedAt: grounding.lockedAt,
    contractFingerprint: fingerprint,
    completedAt: timestamp
  }];
  delete state.groundingReopenPending;
}

export function warnValidationDocumentBudgets(dir, state,
  exists = existsSync, read = readFileSync, warn = console.error) {
  for (const [name, limit] of Object.entries(validationDocumentBudgets(state))) {
    const path = join(dir, name);
    if (!exists(path)) continue;
    const words = read(path, "utf8").trim().split(/\s+/).filter(Boolean).length;
    if (words > limit)
      warn(`WARNING: ${name} is ${words} words (soft budget ${limit}); retain only load-bearing content`);
  }
}

export function reportDeclaredSurfaceForecast(id, state, quiet, covered,
  forecast, warn = console.error) {
  if (!state.declaredSurface?.length || quiet) return;
  const missing = forecast(state.declaredSurface).capabilities
    .filter((capability) => !covered.has(capability));
  if (!missing.length) return;
  warn(`WARNING: declared surface forecasts ${missing.join(", ")} with no provider`);
  warn("  wire them now: claude-foundation evidence init " + id + " --write");
  warn("  inspect first: claude-foundation evidence doctor " + id);
  if (missing.includes("review"))
    warn("  review needs a configured fresh reviewer at Prove; a one-family project selects codex-sol or claude-opus and commits review.diversity='single-model' while keeping independence required");
  warn("  anything left unwired is carried as a non-blocking advisory, not a gate");
}

export function reportValidationReviewAssurance(quiet, resolvable, policy,
  assurance, note = console.error) {
  if (quiet || !resolvable) return null;
  if (assurance)
    note(`NOTE: review assurance posture: ${assurance.summary}`);
  if (policy.required && !policy.independenceWaived) {
    note("NOTE: this change requires review evidence; an independent reviewer must exist by Prove");
    note("  one-family project: select codex-sol or claude-opus and set review.diversity='single-model'; the reviewer still uses a distinct identity and fresh session");
  }
  return assurance;
}

export function waiverRequest(flags, fail) {
  const capability = String(flags.capability || "").trim();
  const decisionRef = String(flags["decision-ref"] || "").trim();
  const reason = String(flags.reason || "").trim();
  if (!capability) fail("change waive requires --capability <capability>");
  if (!decisionRef)
    fail("change waive requires --decision-ref <host-user-decision>; ask the user to authorize withdrawing this gate before recording it");
  return { capability, decisionRef, reason };
}

export function revokeGateWaiver(context, id, state, waivers, request) {
  if (!waivers.some((row) => row.capability === request.capability))
    context.fail(`capability '${request.capability}' has no recorded waiver to revoke`);
  state.waivers = waivers.filter((row) => row.capability !== request.capability);
  context.saveRuntime(state);
  context.log(`WAIVER REVOKED ${id}/${request.capability}\n  the capability is required again\n  next: claude-foundation proof run ${id}`);
}

export function assertWaivableCapability(context, id, request, waivers) {
  if (!request.reason) context.fail("change waive requires --reason <why>");
  if (request.capability === "review")
    context.fail("review cannot be waived here; use the configured risk route or record an explicit policy/change decision");
  if (request.capability === "acceptance")
    context.fail(`acceptance cannot be waived here; withdraw the requirement instead: claude-foundation change resolve ${id} --acceptance-not-required`);
  if (waivers.some((row) => row.capability === request.capability))
    context.fail(`capability '${request.capability}' is already waived`);
  const required = context.requiredProviders(id);
  if (!required.includes(request.capability) && !required.some((provider) =>
    context.providerCapability(provider,
      context.providerConfig(id, provider)) === request.capability))
    context.fail(`capability '${request.capability}' is not required by change '${id}'; nothing to waive`);
}

export function waiveGateOperation(context, id, flags = {}) {
  const request = waiverRequest(flags, context.fail);
  const state = context.loadRuntime(id);
  if (state.status === "archived") context.fail(`change '${id}' is already archived`);
  const waivers = state.waivers || [];
  if (flags.revoke)
    return revokeGateWaiver(context, id, state, waivers, request);
  assertWaivableCapability(context, id, request, waivers);
  state.waivers = [...waivers, {
    capability: request.capability,
    reason: request.reason,
    authority: { kind: "host-user-decision", reference: request.decisionRef },
    recordedAt: context.now()
  }];
  context.saveRuntime(state);
  context.log(`GATE WAIVED ${id}/${request.capability}\n  reason: ${request.reason}\n  decision: ${request.decisionRef}\n  recorded in proof advisories; the claim keeps declaring it\n  next: claude-foundation proof run ${id}`);
}

function failValidationLayer(fail, name, issues) {
  if (issues.length)
    fail(`${name} validation failed:\n  - ${issues.join("\n  - ")}`);
}

export const NFR_CATEGORY_CAPABILITIES = Object.freeze({
  performance: ["performance"],
  capacity: ["performance", "resilience"],
  availability: ["resilience"],
  securityPrivacy: ["security-static"],
  accessibility: ["accessibility"],
  operability: ["observability"],
  compatibility: ["compatibility", "cross-repo-contract"],
  recoverability: ["resilience", "data-migration", "deployment"]
});

export function semanticInvariantIdentityIssues(row, label, invariantIds) {
  const issues = [];
  const id = String(row?.id || "").trim();
  if (!/^INV-[A-Z0-9][A-Z0-9-]*$/i.test(id))
    issues.push(`${label}.id must match INV-<stable-id>`);
  if (invariantIds.has(id.toUpperCase()))
    issues.push(`${label}.id '${id}' is duplicated`);
  invariantIds.add(id.toUpperCase());
  if (!String(row?.statement || "").trim())
    issues.push(`${label}.statement is required`);
  return issues;
}

export function semanticInvariantCollectionIssues(row, label) {
  const issues = [];
  for (const field of ["decisionIds", "claimIds", "specScenarios"])
    if (!Array.isArray(row?.[field]) || row[field].length === 0)
      issues.push(`${label}.${field} must be a non-empty array`);
  return issues;
}

export function semanticInvariantReferenceIssues(row, label, context) {
  const issues = [];
  for (const decisionId of row?.decisionIds || [])
    if (!context.decisionIds.has(decisionId))
      issues.push(`${label} references unknown decision '${decisionId}'`);
  for (const claimId of row?.claimIds || []) {
    context.boundClaims.add(claimId);
    if (!context.claims.has(claimId))
      issues.push(`${label} references unknown claim '${claimId}'`);
  }
  for (const scenario of row?.specScenarios || [])
    if (!context.scenarioNames.has(String(scenario).toLowerCase()))
      issues.push(`${label} references unknown spec scenario '${scenario}'`);
  return issues;
}

export function compatibilityInvariantBindingIssues(claims, boundClaims) {
  return [...claims.values()]
    .filter((claim) => (claim.capabilities || []).some((capability) =>
      ["compatibility", "cross-repo-contract"].includes(capability)))
    .filter((claim) => !boundClaims.has(claim.id))
    .map((claim) =>
      `compatibility claim '${claim.id}' requires a semantic invariant binding; ` +
      "add {id, statement, decisionIds:[...], claimIds:[...], specScenarios:[...]} " +
      "to grounding.yaml semanticInvariants");
}

export function semanticInvariantIssues(invariants, contract, decisionIds,
  specScenarios, { required = false } = {}) {
  const rows = Array.isArray(invariants) ? invariants : [];
  if (required && !Array.isArray(invariants))
    return ["grounding.yaml semanticInvariants must be an array"];
  const claims = new Map((contract?.claims || []).map((claim) => [claim.id, claim]));
  const context = {
    claims,
    decisionIds,
    scenarioNames: new Set([...specScenarios].map((name) => name.toLowerCase())),
    invariantIds: new Set(),
    boundClaims: new Set()
  };
  const issues = [];
  for (const [index, row] of rows.entries()) {
    const label = `semanticInvariants[${index}]`;
    issues.push(...semanticInvariantIdentityIssues(row, label, context.invariantIds));
    issues.push(...semanticInvariantCollectionIssues(row, label));
    issues.push(...semanticInvariantReferenceIssues(row, label, context));
  }
  issues.push(...compatibilityInvariantBindingIssues(claims, context.boundClaims));
  return issues;
}

const DURABLE_DECISION_FIELDS = [
  "Status", "Decision", "Why", "Rejected", "Consequences",
  "Supersedes", "Superseded by"
];

export function durableDecisionSection(content) {
  const rawSection = String(content || "").match(
    /^## Decisions\s*$([\s\S]*?)(?=^## Compatibility and migration\s*$)/m
  )?.[1]?.trim();
  if (!rawSection)
    return { issues: ["design.md requires a Decisions section"] };
  const section = rawSection.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (/^`?none`?[.!]?$/i.test(section)) return { issues: [] };
  if (/^- \*\*Decision:\*\*/m.test(section))
    return { issues: [
      "every durable decision requires Decision ID metadata; legacy Decision entries are not allowed"
    ] };
  const starts = [...section.matchAll(/^- \*\*Decision ID:\*\*\s*(\S.*?)\s*$/gm)];
  if (!starts.length)
    return { issues: [
      "each durable decision requires a stable Decision ID or the section must be `none`"
    ] };
  return { issues: null, section, starts };
}

export function durableDecisionValues(block) {
  return Object.fromEntries(DURABLE_DECISION_FIELDS.map((field) => [field,
    block.match(new RegExp(
      `^\\s+- \\*\\*${field}:\\*\\*\\s*(.+?)\\s*$`, "mi"))?.[1]?.trim()
  ]));
}

export function durableDecisionBlockIssues(block, id, ids, values) {
  const issues = [];
  const label = `decision '${id}'`;
  if (!/^DEC-[A-Z0-9][A-Z0-9-]*$/i.test(id))
    issues.push(`${label} ID must match DEC-<stable-id>`);
  if (ids.has(id.toUpperCase())) issues.push(`${label} is duplicated`);
  const allowedLine = new RegExp(
    `^(?:- \\*\\*Decision ID:\\*\\*|\\s+- \\*\\*(?:${DURABLE_DECISION_FIELDS.join("|")}):\\*\\*)`
  );
  if (block.split("\n").some((line) => line.trim() && !allowedLine.test(line)))
    issues.push(`${label} contains content outside its metadata fields`);
  for (const field of DURABLE_DECISION_FIELDS)
    if (!values[field]) issues.push(`${label} requires ${field}`);
  if (values.Status && !["accepted", "superseded"].includes(values.Status.toLowerCase()))
    issues.push(`${label} Status must be accepted|superseded`);
  return issues;
}

export function parseDurableDecisions(section, starts) {
  const issues = starts[0].index !== 0
    ? ["Decisions contains content outside a Decision ID block"] : [];
  const ids = new Set();
  const decisions = [];
  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1]?.index ?? section.length;
    const block = section.slice(start.index, end);
    const id = start[1].trim();
    const values = durableDecisionValues(block);
    issues.push(...durableDecisionBlockIssues(block, id, ids, values));
    ids.add(id.toUpperCase());
    decisions.push({ id: id.toUpperCase(), label: `decision '${id}'`, values });
  }
  return { issues, decisions };
}

const DURABLE_DECISION_REFERENCE =
  /^(?:[a-z0-9][a-z0-9._-]*#)?DEC-[A-Z0-9][A-Z0-9-]*$/i;

export function localDecisionReference(value) {
  return !value.includes("#") ? value.toUpperCase() : null;
}

export function durableDecisionReferenceIssues(decision, field, value, byId) {
  if (/^none$/i.test(value)) return [];
  if (!DURABLE_DECISION_REFERENCE.test(value))
    return [`${decision.label} ${field} must be none, DEC-<id>, or <change>#DEC-<id>`];
  const local = localDecisionReference(value);
  const issues = [];
  if (local === decision.id)
    issues.push(`${decision.label} ${field} cannot reference itself`);
  if (local && !byId.has(local))
    issues.push(`${decision.label} ${field} references unknown local decision '${value}'`);
  return issues;
}

export function durableDecisionStatusIssues(decision, supersededBy) {
  const status = decision.values.Status?.toLowerCase();
  const issues = [];
  if (status === "superseded" && /^none$/i.test(supersededBy))
    issues.push(`${decision.label} with superseded status must name its replacement`);
  if (status === "accepted" && !/^none$/i.test(supersededBy))
    issues.push(`${decision.label} naming Superseded by must have superseded status`);
  return issues;
}

export function durableDecisionReciprocityIssues(
  decision, supersedes, supersededBy, byId
) {
  const issues = [];
  const supersedesLocal = !/^none$/i.test(supersedes)
    ? localDecisionReference(supersedes) : null;
  if (supersedesLocal && byId.has(supersedesLocal) &&
      byId.get(supersedesLocal).values["Superseded by"]?.toUpperCase() !== decision.id)
    issues.push(`${decision.label} Supersedes '${supersedes}' requires a reciprocal Superseded by link`);
  const supersededByLocal = !/^none$/i.test(supersededBy)
    ? localDecisionReference(supersededBy) : null;
  if (supersededByLocal && byId.has(supersededByLocal) &&
      byId.get(supersededByLocal).values.Supersedes?.toUpperCase() !== decision.id)
    issues.push(`${decision.label} Superseded by '${supersededBy}' requires a reciprocal Supersedes link`);
  return issues;
}

export function durableDecisionGraphIssues(decisions) {
  const issues = [];
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  for (const decision of decisions) {
    const supersedes = decision.values.Supersedes || "";
    const supersededBy = decision.values["Superseded by"] || "";
    issues.push(...durableDecisionReferenceIssues(
      decision, "Supersedes", supersedes, byId));
    issues.push(...durableDecisionReferenceIssues(
      decision, "Superseded by", supersededBy, byId));
    issues.push(...durableDecisionStatusIssues(decision, supersededBy));
    issues.push(...durableDecisionReciprocityIssues(
      decision, supersedes, supersededBy, byId));
  }
  return issues;
}

export function durableDecisionMetadataIssues(content) {
  const section = durableDecisionSection(content);
  if (section.issues) return section.issues;
  const parsed = parseDurableDecisions(section.section, section.starts);
  return [...parsed.issues, ...durableDecisionGraphIssues(parsed.decisions)];
}

export function providersForCapability(
  providers, providerCapability, capability, repositories = []
) {
  const instances = [];
  for (const [provider, config] of Object.entries(providers)) {
    if (providerCapability(provider, config) !== capability) continue;
    if (config.repository && repositories.length > 0 &&
        !repositories.includes(config.repository)) continue;
    instances.push(provider);
  }
  return instances;
}

export function addRequiredCapability(context, capability, repositories = []) {
  if (context.waived.has(capability)) return;
  const instances = providersForCapability(
    context.providers, context.providerCapability, capability, repositories);
  if (instances.length)
    for (const provider of instances) context.required.add(provider);
  else context.required.add(capability);
}

export function requiredProvidersOperation(context, id) {
  const state = context.loadRuntime(id);
  const contract = context.evidence(id);
  const capabilityContext = {
    providers: contract.providers || {},
    providerCapability: context.providerCapability,
    waived: new Set((state.waivers || []).map((row) => row.capability)),
    required: new Set()
  };
  for (const claim of contract.claims) {
    for (const capability of claim.capabilities) {
      addRequiredCapability(
        capabilityContext, capability, claim.repositories || []);
      if (capability === "test" && !capabilityContext.waived.has("test"))
        addRequiredCapability(
          capabilityContext, "discovery", claim.repositories || []);
    }
  }
  if (context.reviewPolicy(id, state, contract).required)
    addRequiredCapability(capabilityContext, "review");
  if (context.resolvedAcceptance(id, state, contract).required)
    addRequiredCapability(capabilityContext, "acceptance");
  for (const capability of context.policyCapabilitySplit(id, contract).enforced)
    addRequiredCapability(capabilityContext, capability);
  const qualityMode = context.foundationPolicy?.().quality?.changeGate || "warn";
  const highRisk = state.impact === "high" ||
    (state.securityTriggers || []).length > 0;
  if (qualityMode === "enforce-high-risk" && highRisk)
    for (const capability of ["changed-quality", "mutation"])
      addRequiredCapability(capabilityContext, capability);
  return [...capabilityContext.required].sort();
}

export function missingHighRiskQualityCapabilities(state, claims, policy) {
  if (policy?.quality?.changeGate !== "enforce-high-risk") return [];
  if (state.impact !== "high" && !(state.securityTriggers || []).length) return [];
  return ["changed-quality", "mutation"].filter((capability) =>
    !claims.some((claim) => (claim.capabilities || []).includes(capability)));
}

export function createChangeValidationRuntime({
  markBlocked = () => {},
  root,
  activeChangePath,
  changePath,
  walk,
  loadRuntime,
  saveRuntime,
  evidence,
  selectedRepositories,
  providerCapability,
  providerConfig,
  resolvedAcceptance,
  reviewPolicy,
  reviewAssurancePosture = () => null,
  policyCapabilities,
  policyCapabilityTrigger,
  changedSurfaceResolvable,
  forecastCapabilities,
  rawExecution,
  handoffContract,
  contractFingerprint,
  commandExists,
  stableHash,
  fileDigest,
  pathInside,
  knownProviders,
  writeJson,
  now,
  authorityPreflight = () => ({ status: "READY", blockers: [], decision: null }),
  executionContract = null,
  foundationPolicy = () => ({ quality: { changeGate: "warn" } }),
  fail: terminalFail
}) {
  let activeValidationCapture = null;
  const fail = (message) => {
    if (activeValidationCapture) {
      activeValidationCapture.push(String(message));
      return;
    }
    return terminalFail(message);
  };

  function capturedIssueLines(name, messages) {
    const prefix = `${name} validation failed:\n  - `;
    return messages.flatMap((message) => message.startsWith(prefix)
      ? message.slice(prefix.length).split("\n  - ") : [message]);
  }

  function captureValidationGroup(groups, name, operation) {
    const messages = [];
    activeValidationCapture = messages;
    let value;
    try {
      value = operation();
    } catch (error) {
      // A failed shape check may make its dependent code unreadable. Preserve
      // the explicit finding and skip that dependency instead of inventing a
      // second error from a TypeError. Unexpected failures still surface.
      if (messages.length === 0 || !(error instanceof TypeError)) throw error;
    } finally {
      activeValidationCapture = null;
    }
    const issues = capturedIssueLines(name, messages);
    if (issues.length) groups.push({ name, issues });
    return value;
  }

  function failCollectedValidation(groups) {
    const populated = groups.filter((group) => group.issues?.length);
    if (!populated.length) return;
    // Keep one physical line per group. Agents sometimes pipe this bounded
    // output through head/tail despite the public workflow; line-bounded
    // rendering still exposes every independent group in that failure mode.
    const rendered = populated.map((group) => `[${group.name}] ` +
      group.issues.map((issue) => issue.replace(/\s*\n\s*/g, " ")).join("; "))
      .join("\n");
    const limit = 16_000;
    const bounded = rendered.length > limit
      ? `${rendered.slice(0, limit)}\n  - output truncated; repair these findings and validate again`
      : rendered;
    const repairPlan = gateRepairPlan(populated.map((group, groupIndex) => ({
      id: `change-group-${groupIndex + 1}`,
      phase: "change",
      gate: group.name,
      classification: "contract",
      rootCause: group.name,
      message: `Repair all ${group.issues.length} finding(s) in ${group.name}`
    })), { phase: "change", gate: "change-validation" });
    fail(`change validation failed (${populated.length} groups):\n${bounded}\n` +
      `Repair plan: ${JSON.stringify(repairPlan)}\n` +
      "Recovery: repair only fields named above; do not add planned readSet rows " +
      "unless a finding requires them. Re-run change validate as a standalone " +
      "command without a pipe.");
  }

  // `dir` is an override for the one case where the ledger is no longer at the
  // active path: an archive that moved the change directory and then failed.
  function pendingTasks(id, dir = activeChangePath(id)) {
    const path = join(dir, "tasks.md");
    if (!existsSync(path)) return [];
    return taskBlocks(readFileSync(path, "utf8")).filter((task) => !task.done);
  }

  const {
    assertExistingCapabilityOperations, assertNewCapabilitiesAreAdditive,
    assertNoDroppedScenarios,
    changeSpecScenarios,
    droppedScenarioFindings,
    newCapabilityOperationFindings
  } = createSpecDeltaValidator({ root, activeChangePath, walk, fail });

  function validationRepositories(id, state, dir) {
    const rootSource = resolve(dir) === resolve(changePath(id));
    return selectedRepositories(id, state, fail, {
      changeDir: dir,
      useTargetPaths: rootSource
    });
  }

  function traceabilityAuditValue(id) {
    const state = loadRuntime(id);
    const dir = activeChangePath(id, state);
    const contract = evidence(id, dir);
    const tasks = taskBlocks(readFileSync(join(dir, "tasks.md"), "utf8"))
      .map(taskMetadata);
    const scenarios = state.schema === "foundation-standard"
      ? changeSpecScenarios(id, dir)
      : [];
    const configuredCapabilities = Object.entries(contract.providers || {})
      .map(([provider, config]) => providerCapability(provider, config))
      .filter(Boolean);
    return auditTraceability({
      id,
      state,
      contract,
      tasks,
      scenarios,
      configuredCapabilities
    });
  }

  function showTraceabilityAudit(id, flags = {}) {
    const audit = traceabilityAuditValue(id);
    if (flags.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`TRACEABILITY ${id}: ${audit.status.toUpperCase()}`);
      console.log(`  scenarios: ${audit.summary.scenarios}; claims: ${audit.summary.claims}; tasks: ${audit.summary.tasks}`);
      console.log(`  linked claims: ${audit.summary.linkedClaims}/${audit.summary.claims}; linked tasks: ${audit.summary.linkedTasks}/${audit.summary.tasks}`);
      for (const finding of audit.findings)
        console.log(`  ${finding.level.toUpperCase().padEnd(7)} ${finding.code}: ${finding.message}`);
    }
    // A failing traceability audit is a refusal, not a crash. It exits without
    // `die` because the findings are already printed above, so it declares the
    // block explicitly instead.
    if (audit.status === "error") { markBlocked(); process.exitCode = 1; }
  }

  function changeArtifactGaps(state, dir) {
    const conditional = Number(state.artifactDefaultsVersion || 0) >= 2;
    const required = state.schema === "foundation-rapid"
      ? ["proposal.md", "tasks.md", "evidence.yaml"]
      : ["proposal.md", "tasks.md", "evidence.yaml"];
    if (state.schema === "foundation-standard" &&
        (!conditional || state.decisionMetadataRequired))
      required.push("design.md");
    if (state.groundingRequired) required.push("grounding.yaml");
    // `repositories.yaml` sits in both schemas' `apply.requires` and is written
    // by `createChange`, but nothing checked it here: deleting the file passed
    // `change validate` and only failed later, inside Land, where the recovery
    // is expensive. Gated with `execution.yaml` because the two arrived
    // together in the version-2 packet.
    if (Number(state.version || 1) >= 2 && !conditional)
      required.push("execution.yaml", "repositories.yaml");
    if (state.externalOperationsVersion)
      required.push("handoffs.yaml");
    const missing = required.filter((name) => !existsSync(join(dir, name)));
    if (state.schema === "foundation-standard") {
      let specCount = 0;
      walk(join(dir, "specs"), () => { specCount += 1; });
      if (specCount === 0) missing.push("specs/**/*.md");
    }
    return missing;
  }

  const scaffoldPatterns = [
    ["replace-with marker", /replace-with/i],
    ["unresolved clarification", /\[NEEDS CLARIFICATION(?::[^\]]*)?\]/i],
    ["unresolved TODO/TBD", /\b(?:TODO|TBD)\b/],
    ["template angle marker", /<(?:Problem|Observable|Only load-bearing|choice|constraint|meaningful alternative|operational, compatibility|Public contracts|risk|mitigation|provider|name|existing name|stable scenario name|every existing stable scenario name|action or event|complete modified observable behavior|behavior being retired|replacement, compatibility consequence|Explicitly excluded|code, API|semantic boundary|path or surface|focused check)[^>]*>/i],
    ["template removal comment", /<!--[\s\S]*?(?:delete (?:this section )?when unused|include the complete modified requirement|name removed behavior|use only when the canonical spec)[\s\S]*?-->/i]
  ];

  function assertNoScaffolds(state, dir) {
    // Strict scaffold rejection is a contract for changes created under the
    // grounding workflow. Grandfathering older ledgers avoids turning a
    // runtime upgrade into unrelated cleanup work across every active change.
    if (!state.groundingRequired) return;
    const files = [
      "proposal.md", "design.md", "tasks.md", "evidence.yaml",
      "execution.yaml", "repositories.yaml", "handoffs.yaml"
    ];
    if (state.groundingRequired) files.push("grounding.yaml");
    const specsRoot = join(dir, "specs");
    walk(specsRoot, (path) => {
      if (path.endsWith(".md")) files.push(relative(dir, path));
    });
    const findings = [];
    for (const name of [...new Set(files)]) {
      const artifact = join(dir, name);
      if (!existsSync(artifact)) continue;
      const content = readFileSync(artifact, "utf8");
      for (const [label, pattern] of scaffoldPatterns) {
        const match = pattern.exec(content);
        if (!match) continue;
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        const excerpt = match[0].split(/\r?\n/)[0].trim().slice(0, 72);
        findings.push(`${name}:${line}: ${label}${excerpt ? ` (${excerpt})` : ""}`);
      }
    }
    if (findings.length)
      fail(`change artifacts still contain scaffold or unresolved content: ${findings.join("; ")}`);
  }

  function assertArchiveSafeArtifacts(id, dir) {
    const runnable = [];
    // OpenSpec archives the complete packet under openspec/changes/archive.
    // Runnable source copied here as "test topology" is then rediscovered by
    // Node, pytest, Jest, and similar default test globs from an invalid cwd.
    // A packet records source paths and digests in grounding.yaml; it never
    // needs an executable copy of the inspected file.
    const executableExtensions = new Set([
      ".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx",
      ".kt", ".mjs", ".cjs", ".php", ".py", ".rb", ".rs", ".sh",
      ".swift", ".ts", ".tsx"
    ]);
    walk(dir, (path) => {
      const rel = relative(dir, path).replaceAll("\\", "/");
      const name = rel.toLowerCase();
      const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
      if (executableExtensions.has(extension)) runnable.push(rel);
    });
    if (runnable.length)
      fail(`${id} contains runnable source inside the change packet: ${runnable.sort().join(", ")}. ` +
        "Record test-topology paths and digests in grounding.yaml; do not copy executable files into openspec/changes because archive test discovery will execute them.");
  }

  function readGroundingDocument(id, state, dir) {
    let value;
    try {
      value = JSON.parse(readFileSync(join(dir, "grounding.yaml"), "utf8"));
    } catch {
      fail(`${id}/grounding.yaml must be JSON-compatible YAML`);
    }
    if (![1, 2, 3].includes(value.version))
      fail(`${id}/grounding.yaml requires version 1, 2, or 3`);
    if (Number(state.groundingVersion || 1) >= 2 &&
        value.version !== Number(state.groundingVersion))
      fail(`${id}/grounding.yaml requires version ${state.groundingVersion} for this change`);
    const digest = stableHash(value);
    if (state.groundingDigest && state.groundingDigest !== digest)
      fail(`${id}/grounding.yaml changed after its decision batch was locked; ` +
        `use change resolve ${id} --reopen-grounding --decision-ref <ref> ` +
        "--reopen-reason <reason> for one batched revision, or retire and replace the change");
    return { value, digest, firstLock: !state.groundingDigest };
  }

  function validateGroundingDecision(id, decision) {
    const issues = [];
    if (decision.status !== "locked")
      issues.push(`${id}/grounding.yaml decisionBatch.status must be locked`);
    if (!["prd", "backlog", "user-batch", "recommended-default", "mixed"].includes(decision.source))
      issues.push(`${id}/grounding.yaml decisionBatch.source must be prd|backlog|user-batch|recommended-default|mixed`);
    if (!String(decision.reference || "").trim())
      issues.push(`${id}/grounding.yaml decisionBatch.reference is required`);
    if (!["single-batch", "no-material-questions"].includes(decision.mode))
      issues.push(`${id}/grounding.yaml decisionBatch.mode must be single-batch|no-material-questions`);
    if (!Number.isFinite(Date.parse(String(decision.lockedAt || ""))))
      issues.push(`${id}/grounding.yaml decisionBatch.lockedAt must be an ISO-8601 timestamp`);
    if (!Array.isArray(decision.decisions) || decision.decisions.length === 0)
      issues.push(`${id}/grounding.yaml decisionBatch.decisions must record every locked choice/default`);
    const ids = new Set();
    for (const [index, row] of (Array.isArray(decision.decisions) ? decision.decisions : []).entries()) {
      const label = `${id}/grounding.yaml decisionBatch.decisions[${index}]`;
      if (!["prd", "backlog", "user-batch", "recommended-default"].includes(row.source))
        issues.push(`${label}.source must be prd|backlog|user-batch|recommended-default`);
      for (const field of ["id", "question", "answer"])
        if (!String(row[field] || "").trim()) issues.push(`${label}.${field} is required`);
      if (ids.has(row.id)) issues.push(`${label}.id is duplicated`);
      ids.add(row.id);
    }
    failValidationLayer(fail, "grounding decision", issues);
    return ids;
  }

  function validateGroundingV3(id, value) {
    const issues = [];
    if (!Array.isArray(value.decisions) || value.decisions.length === 0)
      issues.push(`${id}/grounding.yaml decisions must contain each non-derived material decision`);
    const ids = new Set();
    for (const [index, decision] of (value.decisions || []).entries()) {
      const label = `${id}/grounding.yaml decisions[${index}]`;
      for (const field of ["id", "choice", "reason"])
        if (!String(decision?.[field] || "").trim()) issues.push(`${label}.${field} is required`);
      if (ids.has(decision?.id)) issues.push(`${label}.id is duplicated`);
      ids.add(decision?.id);
      if (decision?.derivedAt || decision?.digest || decision?.readSet || decision?.productionPath)
        issues.push(`${label} contains derived runtime data; grounding v3 stores decisions only`);
    }
    failValidationLayer(fail, "grounding v3 decision", issues);
  }

  function validateGroundingSemanticInvariants(id, state, dir, value, decisionIds) {
    if (!state.semanticInvariantsRequired) return;
    const specScenarios = new Set();
    walk(join(dir, "specs"), (path) => {
      if (!path.endsWith(".md")) return;
      const content = readFileSync(path, "utf8");
      for (const match of content.matchAll(/^#### Scenario:\s*(.+?)\s*$/gm))
        specScenarios.add(match[1].trim());
    });
    failValidationLayer(fail, "semantic invariant", semanticInvariantIssues(
      value.semanticInvariants, evidence(id, dir), decisionIds, specScenarios,
      { required: true }));
  }

  function validateConditionalGroundingSection(id, name, row, listName) {
    const label = `${id}/grounding.yaml ${name}`;
    if (!["applicable", "not-applicable"].includes(row?.status))
      fail(`${label}.status must be applicable|not-applicable`);
    if (!String(row?.sourceReason || "").trim())
      fail(`${label}.sourceReason is required even when the section is N/A`);
    if (!Array.isArray(row?.[listName])) fail(`${label}.${listName} must be an array`);
    if (row.status === "applicable" && row[listName].length === 0)
      fail(`${label}.${listName} must be non-empty when applicable`);
  }

  function groundingV2Context(id, state, dir, value) {
    const risk = value.risk || {};
    if (!["low", "medium", "high"].includes(risk.tier))
      fail(`${id}/grounding.yaml risk.tier must be low|medium|high`);
    if (!Array.isArray(risk.classes) || risk.classes.length === 0 ||
        risk.classes.some((entry) => !String(entry || "").trim()))
      fail(`${id}/grounding.yaml risk.classes must be a non-empty string array`);
    if (!String(risk.rationale || "").trim())
      fail(`${id}/grounding.yaml risk.rationale is required`);
    const contract = evidence(id, dir);
    const routedTier = reviewPolicy(id, state, contract).tier;
    const rank = { low: 0, medium: 1, high: 2 };
    if (rank[risk.tier] < rank[routedTier])
      fail(`${id}/grounding.yaml risk.tier '${risk.tier}' understates the deterministic review tier '${routedTier}'`);
    validateConditionalGroundingSection(id, "productionEntry", value.productionEntry, "paths");
    validateConditionalGroundingSection(id, "realWire", value.realWire, "contracts");
    validateConditionalGroundingSection(
      id, "activationSemantics", value.activationSemantics, "activatedPaths");
    if (!Array.isArray(value.activationSemantics?.failureSemanticChanges))
      fail(`${id}/grounding.yaml activationSemantics.failureSemanticChanges must be an array`);
    validateConditionalGroundingSection(
      id, "serviceInteractions", value.serviceInteractions, "rows");
    validateConditionalGroundingSection(id, "observability", value.observability, "rows");
    const capabilities = new Set(contract.claims
      .flatMap((claim) => claim.capabilities || []));
    const riskClasses = new Set(risk.classes
      .map((entry) => String(entry).toLowerCase()));
    const semantics = `${state.intent || ""} ${[...riskClasses].join(" ")}`.toLowerCase();
    const selected = validationRepositories(id, state, dir);
    const interactions = groundingInteractionRequirements({
      coupling: state.coupling, repositoryCount: selected.length,
      capabilities, semantics
    });
    const mandatoryService = interactions.service;
    const mandatoryWire = interactions.wire;
    const mandatoryActivation = [...riskClasses].some((entry) =>
      ["legacy", "activation", "cutover"].some((token) => entry.includes(token))) ||
      /\b(activat|cutover|enable existing|wire existing|turn on)\w*\b/.test(semantics);
    return {
      risk, contract, capabilities, riskClasses, semantics, selected,
      mandatoryService, mandatoryWire, mandatoryActivation
    };
  }

  function requiredNfrCategories(state, v2) {
    const required = new Set();
    const requireWhen = (category, capabilities) => {
      if (capabilities.some((capability) => v2.capabilities.has(capability)))
        required.add(category);
    };
    requireWhen("performance", ["performance"]);
    requireWhen("availability", ["resilience"]);
    requireWhen("securityPrivacy", ["security-static"]);
    requireWhen("accessibility", ["accessibility"]);
    requireWhen("operability", ["observability"]);
    requireWhen("compatibility", ["compatibility", "cross-repo-contract"]);
    requireWhen("recoverability", ["data-migration", "deployment"]);
    if ((state.securityTriggers || []).length) required.add("securityPrivacy");
    if (v2.mandatoryService)
      ["availability", "operability", "recoverability"].forEach((name) => required.add(name));
    if (v2.capabilities.has("data-migration"))
      ["compatibility", "recoverability"].forEach((name) => required.add(name));
    if (/\b(performance|latency|throughput)\b/.test(v2.semantics)) required.add("performance");
    if (/\b(capacity|scalability|scale)\b/.test(v2.semantics)) required.add("capacity");
    if (/\b(availability|uptime|reliability)\b/.test(v2.semantics)) required.add("availability");
    return required;
  }

  function applicableNfrClaimIssues(label, category, row, context) {
    const issues = [];
    const allowedCapabilities = NFR_CATEGORY_CAPABILITIES[category];
    const consequences = {
      resilience: "availability must also be applicable",
      "data-migration": "compatibility and recoverability must also be applicable",
      deployment: "recoverability must also be applicable"
    };
    const consequenceHint = allowedCapabilities
      .filter((capability) => consequences[capability])
      .map((capability) => `${capability} => ${consequences[capability]}`)
      .join("; ");
    for (const claimId of row.claimIds) {
      const claim = context.claimById.get(claimId);
      if (!claim) {
        issues.push(`${label} references unknown claim '${claimId}'`);
        continue;
      }
      if (!allowedCapabilities.some((capability) =>
        (claim.capabilities || []).includes(capability)))
        issues.push(`${label} claim '${claimId}' must declare one of: ${allowedCapabilities.join(", ")}${
          consequenceHint ? `; capability consequences: ${consequenceHint}` : ""}`);
      if (!context.taskClaimIds.has(claimId))
        issues.push(`${label} claim '${claimId}' has no implementation task owner`);
    }
    if (!allowedCapabilities.some((capability) =>
      context.configuredCapabilities.has(capability)))
      issues.push(`${label} has no configured capable evidence provider`);
    if (category === "securityPrivacy" && !row.claimIds.some((claimId) =>
      hasObservableSecurityControl(context.claimById.get(claimId))))
      issues.push(`${label} requires an observable negative-path or privacy-control claim; ` +
        `the claim scenario must name the outcome, such as rejected, refused, denied, ` +
        `blocked, sanitized, escaped, isolated, or redacted`);
    return issues;
  }

  function nfrCategoryIssues(id, category, row, context) {
    const issues = [];
    const label = `${id}/grounding.yaml nfrAssessment.${category}`;
    if (!row || !["applicable", "not-applicable"].includes(row.status)) {
      issues.push(`${label}.status must be applicable|not-applicable`);
      return issues;
    }
    if (!String(row.sourceReason || "").trim()) issues.push(`${label}.sourceReason is required`);
    if (!Array.isArray(row.claimIds)) {
      issues.push(`${label}.claimIds must be an array`);
      return issues;
    }
    if (context.required.has(category) && row.status !== "applicable")
      issues.push(`${label} is required by the declared risk or evidence capability`);
    if (row.status === "not-applicable") {
      if (row.claimIds.length) issues.push(`${label}.claimIds must be empty when not applicable`);
      return issues;
    }
    const target = String(row.target || "").trim();
    if (!target || /^none$/i.test(target)) issues.push(`${label}.target is required when applicable`);
    if (["performance", "capacity"].includes(category) && !/\d/.test(target))
      issues.push(`${label}.target must contain a measurable numeric threshold`);
    if (row.claimIds.length === 0)
      issues.push(`${label}.claimIds must be non-empty when applicable`);
    issues.push(...applicableNfrClaimIssues(label, category, row, context));
    return issues;
  }

  function validateNfrAssessment(id, state, value, parsedTasks, v2) {
    if (!state.nfrAssessmentRequired) return;
    const assessment = value.nfrAssessment;
    if (!assessment || typeof assessment !== "object" || Array.isArray(assessment))
      fail(`${id}/grounding.yaml nfrAssessment is required for this change`);
    const categoryNames = Object.keys(NFR_CATEGORY_CAPABILITIES);
    const unknown = Object.keys(assessment).filter((name) => !categoryNames.includes(name));
    const issues = unknown.length
      ? [`${id}/grounding.yaml nfrAssessment has unknown categories: ${unknown.join(", ")}`]
      : [];
    const context = {
      required: requiredNfrCategories(state, v2),
      claimById: new Map(v2.contract.claims.map((claim) => [claim.id, claim])),
      taskClaimIds: new Set(parsedTasks.map(taskMetadata)
        .filter((task) => ["implementation", "migration"].includes(task.kind))
        .flatMap((task) => task.claims)),
      configuredCapabilities: new Set(Object.entries(v2.contract.providers || {})
        .map(([provider, config]) => providerCapability(provider, config)).filter(Boolean))
    };
    for (const category of categoryNames)
      issues.push(...nfrCategoryIssues(id, category, assessment[category], context));
    failValidationLayer(fail, "NFR assessment", issues);
  }

  function validateRequiredV2Sections(id, value, v2) {
    if (value.productionEntry.status !== "applicable")
      fail(`${id}/grounding.yaml productionEntry cannot be N/A for an implementation claim`);
    if (v2.mandatoryWire && value.realWire.status !== "applicable")
      fail(`${id}/grounding.yaml realWire is required by the declared contract/integration risk`);
    if (v2.mandatoryActivation && value.activationSemantics.status !== "applicable")
      fail(`${id}/grounding.yaml activationSemantics is required when existing behavior is activated or cut over`);
    if (v2.mandatoryService && value.serviceInteractions.status !== "applicable")
      fail(`${id}/grounding.yaml serviceInteractions is required by the declared cross-service/queue surface`);
    if (v2.mandatoryService && value.observability.status !== "applicable")
      fail(`${id}/grounding.yaml observability is required for every declared service interaction`);
  }

  function validateGroundingSourceRows(id, value, selected, parsedTasks, firstLock) {
    const repositories = new Map(selected.map((repository) => [repository.id, repository]));
    const issues = [];
    const validateRows = (name, rows, allowedRoles) => {
      for (const [index, source] of rows.entries()) {
        const label = `${id}/grounding.yaml ${name}[${index}]`;
        const shapeIssue = groundingPathRowShapeIssue(label, source);
        if (shapeIssue) {
          issues.push(shapeIssue);
          continue;
        }
        const repository = repositories.get(source?.repository || "root");
        const sourcePath = String(source?.path || "");
        if (!repository) {
          issues.push(`${label} references an unselected repository`);
          continue;
        }
        if (!sourcePath || isAbsolute(sourcePath)) {
          issues.push(`${label}.path must be repository-relative`);
          continue;
        }
        const absolute = resolve(repository.workspacePath, sourcePath);
        const readSource = value.readSet.find((row) =>
          (row.repository || "root") === repository.id && row.path === sourcePath &&
          allowedRoles.includes(row.role));
        const planned = plannedGroundingPathEligible(readSource, existsSync(absolute),
          parsedTasks, firstLock);
        if (!pathInside(repository.workspacePath, absolute) ||
            (!existsSync(absolute) && !planned)) {
          const recovery = plannedGroundingPathRecovery(readSource, existsSync(absolute),
            parsedTasks, firstLock);
          issues.push(`${label}.path does not resolve inside repository '${repository.id}'` +
            (recovery ? `; ${recovery}` : ""));
        }
        if (!readSource) {
          const allowedRole = allowedRoles.includes("test-topology")
            ? "test-topology" : allowedRoles[0];
          const repositoryId = source.repository || "root";
          const newPathRecovery = !existsSync(absolute)
            ? `; ${groundingMissingReadSourceRecovery(sourcePath, repositoryId, allowedRole)}`
            : "";
          issues.push(`${label} must appear in readSet with role ${allowedRoles.join("|")}` +
            newPathRecovery);
        }
      }
    };
    validateRows("productionEntry.paths", value.productionEntry.paths,
      ["production-path", "runtime-path"]);
    validateRows("realWire.contracts", value.realWire.contracts,
      ["contract", "test-topology"]);
    validateRows("activationSemantics.activatedPaths",
      value.activationSemantics.activatedPaths, ["production-path", "runtime-path"]);
    failValidationLayer(fail, "grounding source", issues);
  }

  function requiredInteractionFields(row, fields, label) {
    const missing = fields.filter((field) => !String(row?.[field] || "").trim());
    return missing.length
      ? [`${label} requires non-empty fields: ${missing.join(", ")}`]
      : [];
  }

  function validateServiceInteractionRows(id, value) {
    const issues = [];
    const interactionIds = new Set();
    for (const [index, row] of (value.serviceInteractions?.rows || []).entries()) {
      const label = `${id}/grounding.yaml serviceInteractions.rows[${index}]`;
      issues.push(...requiredInteractionFields(row, [
        "id", "owner", "producer", "consumer", "contract", "delivery",
        "timeoutRetry", "idempotency", "ordering", "consistency", "rollout", "rollback"
      ], label));
      if (interactionIds.has(row.id)) issues.push(`${label}.id is duplicated`);
      interactionIds.add(row.id);
    }
    const observed = new Set();
    for (const [index, row] of (value.observability?.rows || []).entries()) {
      const label = `${id}/grounding.yaml observability.rows[${index}]`;
      issues.push(...requiredInteractionFields(row, [
        "interactionId", "correlation", "structuredEvents", "sli",
        "alert", "runbook", "operatorQuestion"
      ], label));
      if (row.interactionId !== "local" && !interactionIds.has(row.interactionId))
        issues.push(`${label}.interactionId does not reference a service interaction`);
      observed.add(row.interactionId);
    }
    if (value.serviceInteractions?.status === "applicable")
      for (const interactionId of interactionIds)
        if (!observed.has(interactionId))
          issues.push(`${id}/grounding.yaml observability must cover interaction '${interactionId}'`);
    failValidationLayer(fail, "service interaction", issues);
  }

  function validateGroundingCriticalCases(id, rows) {
    const issues = [];
    const criticalIds = new Set();
    for (const [index, row] of rows.entries()) {
      const label = `${id}/grounding.yaml criticalCases[${index}]`;
      if (!String(row?.id || "").trim() || criticalIds.has(row.id))
        issues.push(`${label}.id must be non-empty and unique`);
      if (!Array.isArray(row.claimIds) || row.claimIds.length === 0)
        issues.push(`${label}.claimIds must be non-empty`);
      if (!CRITICAL_CASE_ORACLES.includes(row.oracle))
        issues.push(`${label}.oracle must be one of: ${CRITICAL_CASE_ORACLES.join("|")}`);
      criticalIds.add(row.id);
    }
    return { criticalIds, issues };
  }

  function validateGroundingMutants(id, rows, criticalIds) {
    const issues = [];
    const mutantIds = new Set();
    for (const [index, row] of rows.entries()) {
      const label = `${id}/grounding.yaml mutants[${index}]`;
      if (!String(row?.id || "").trim() || mutantIds.has(row.id))
        issues.push(`${label}.id must be non-empty and unique`);
      if (!Array.isArray(row.claimIds) || row.claimIds.length === 0 ||
          !String(row.class || "").trim())
        issues.push(`${label} requires claimIds and class`);
      if (!criticalIds.has(row.killerCaseId))
        issues.push(`${label}.killerCaseId must name a critical case`);
      mutantIds.add(row.id);
    }
    return issues;
  }

  function validateCriticalCasesAndMutants(id, value) {
    if (!Array.isArray(value.criticalCases) || !Array.isArray(value.mutants))
      fail(`${id}/grounding.yaml criticalCases and mutants must be arrays`);
    const { criticalIds, issues } = validateGroundingCriticalCases(id, value.criticalCases);
    issues.push(...validateGroundingMutants(id, value.mutants, criticalIds));
    failValidationLayer(fail, "critical case and mutant", issues);
  }

  function validateGroundingReadSet(id, value, repositories, firstLock, parsedTasks) {
    const roles = new Set(GROUNDING_READ_ROLES);
    const issues = [];
    const immutableRoles = new Set([
      "requirement", "backlog", "architecture", "contract", "dependency-source", "history"
    ]);
    for (const [index, source] of value.readSet.entries()) {
      const label = `${id}/grounding.yaml readSet[${index}]`;
      const repository = repositories.get(source.repository || "root");
      if (!repository) {
        issues.push(`${label} references an unselected repository`);
        continue;
      }
      if (!roles.has(source.role))
        issues.push(`${label}.role must be one of: ${GROUNDING_READ_ROLES.join("|")}`);
      if (!["full", "targeted"].includes(source.mode))
        issues.push(`${label}.mode must be full|targeted`);
      const sourcePath = String(source.path || "");
      if (!sourcePath || isAbsolute(sourcePath)) {
        issues.push(`${label}.path must be repository-relative`);
        continue;
      }
      const absolute = resolve(repository.workspacePath, sourcePath);
      const pathExists = existsSync(absolute);
      const planned = plannedGroundingPathEligible(source, pathExists,
        parsedTasks, firstLock);
      const inside = pathInside(repository.workspacePath, absolute);
      if (!inside || (!pathExists && !planned)) {
        const recovery = plannedGroundingPathRecovery(source, pathExists,
          parsedTasks, firstLock);
        issues.push(`${label}.path does not resolve inside repository '${repository.id}'` +
          (recovery ? `; ${recovery}` : ""));
      }
      if (source.sha256 === "planned" && !planned)
        issues.push(`${label}.sha256 may be 'planned' only for a new implementation-owned ` +
          "production, runtime, test-topology, or dependency path");
      if (planned) continue;
      if (!inside || !pathExists) continue;
      if (!/^[a-f0-9]{64}$/i.test(String(source.sha256 || "")))
        issues.push(`${label}.sha256 must be a SHA-256 hex digest`);
      if ((firstLock || immutableRoles.has(source.role)) &&
          fileDigest(absolute) !== String(source.sha256).toLowerCase())
        issues.push(`${label}.sha256 does not match the baseline file. ` +
          `If '${sourcePath}' is intentionally edited by this change, its role ` +
          "must be production-path or runtime-path (immutable roles pin decision " +
          "sources); re-role the row and refresh its sha256. If the edit is " +
          "unintended drift, restore the file to its baseline.");
    }
    failValidationLayer(fail, "grounding readSet", issues);
  }

  function validateGroundingTaskOverlap(id, value, parsedTasks) {
    const overlap = groundingTaskOverlapFindings(value.readSet, parsedTasks);
    if (overlap.length)
      fail(`${id}/grounding.yaml immutable readSet overlaps implementation task paths:\n  - ${
        overlap.map((row) => `${row.taskId}: ${row.repository}/${row.path} ` +
          `(${row.role}) overlaps [paths:${row.taskPath}]`).join("\n  - ")
      }\nFiles the change will edit must use role production-path or runtime-path; keep immutable decision sources outside writable task scopes.`);
    if (!value.readSet.some((source) => ["requirement", "backlog"].includes(source.role)))
      fail(`${id}/grounding.yaml must read a requirement or backlog source`);
  }

  function validateGroundingReadRoles(id, state, contract, readSet) {
    const roles = new Set(readSet.map((source) => source.role));
    if (state.coupling === "coupled")
      for (const role of ["architecture", "contract", "composition-root"])
        if (!roles.has(role))
          fail(`${id}/grounding.yaml coupled work requires a ${role} readSet entry`);
    const capabilities = new Set(contract.claims.flatMap((claim) => claim.capabilities || []));
    if (["test", "integration", "live", "mutation", "browser"].some((capability) =>
      capabilities.has(capability)) && !roles.has("test-topology"))
      fail(`${id}/grounding.yaml test-backed claims require a test-topology readSet entry`);
    const securityWork = (state.securityTriggers || []).length > 0 ||
      ["security", "security-static"].some((capability) => capabilities.has(capability));
    if (securityWork && !roles.has("dependency-source"))
      fail(`${id}/grounding.yaml security work requires a dependency-source readSet entry`);
  }

  function groundingPathIssues(id, label, row, repositories, value, role,
    failureRequired, parsedTasks, firstLock) {
    const issues = [];
    const shapeIssue = groundingPathRowShapeIssue(label, row);
    if (shapeIssue) return [shapeIssue];
    const repository = repositories.get(row?.repository || "root");
    const sourcePath = String(row?.path || "");
    if (!repository) return [`${label} references an unselected repository`];
    if (!sourcePath || isAbsolute(sourcePath))
      return [`${label}.path must be repository-relative`];
    const absolute = resolve(repository.workspacePath, sourcePath);
    const includedSource = value.readSet.find((source) =>
      (source.repository || "root") === repository.id && source.path === sourcePath &&
      (!role || source.role === role));
    const planned = plannedGroundingPathEligible(includedSource, existsSync(absolute),
      parsedTasks, firstLock);
    if (!pathInside(repository.workspacePath, absolute) ||
        (!existsSync(absolute) && !planned)) {
      const recovery = plannedGroundingPathRecovery(includedSource, existsSync(absolute),
        parsedTasks, firstLock);
      issues.push(`${label}.path does not resolve inside repository '${repository.id}'` +
        (recovery ? `; ${recovery}` : ""));
    }
    if (failureRequired && !String(row?.failure || "").trim())
      issues.push(`${label}.failure is required`);
    if (!includedSource)
      issues.push(role
        ? `${label} must appear in readSet with role ${role} and a baseline digest`
        : `${label} must appear in readSet with a baseline digest`);
    return issues;
  }

  function groundingClaimEvidenceIssues(label, claim, evidenceClaim) {
    const issues = [];
    const classes = new Set([
      "static", "unit", "test", "integration", "live", "mutation", "security",
      "review", "acceptance", "browser", "deployment", "cross-repo-contract",
      "changed-quality"
    ]);
    if (!Array.isArray(claim.evidenceClass) || claim.evidenceClass.length === 0 ||
        claim.evidenceClass.some((entry) => !String(entry || "").trim()))
      return [`${label}.evidenceClass must be a non-empty string array`];
    const unsupported = claim.evidenceClass.filter((entry) => !classes.has(entry));
    if (unsupported.length)
      issues.push(`${label}.evidenceClass contains unsupported class(es): ${unsupported.join(", ")}; ` +
        `supported: ${[...classes].join("|")}`);
    if (!String(claim.testDoubleGap || "").trim())
      issues.push(`${label}.testDoubleGap must be none or describe the gap`);
    if (claim.testDoubleGap !== "none" &&
        !claim.evidenceClass.some((entry) => ["integration", "live"].includes(entry)))
      issues.push(`${label} declares a test-double gap without integration or live evidence`);
    const capabilities = new Set(evidenceClaim?.capabilities || []);
    const aliases = {
      static: ["static-analysis", "security-static"], unit: ["test"], test: ["test"],
      integration: ["integration"], live: ["live"], mutation: ["mutation"],
      security: ["security", "security-static"], review: ["review"],
      acceptance: ["acceptance"], browser: ["browser"], deployment: ["deployment"],
      "cross-repo-contract": ["compatibility", "integration"],
      "changed-quality": ["changed-quality"]
    };
    for (const evidenceClass of claim.evidenceClass)
      if (aliases[evidenceClass] &&
          !aliases[evidenceClass].some((capability) => capabilities.has(capability)))
        issues.push(`${label}.evidenceClass '${evidenceClass}' is not declared by evidence.yaml for claim '${claim.id}'`);
    if (evidenceClaim?.impact === "high" && !claim.evidenceClass.some((entry) =>
      ["integration", "live", "security", "review"].includes(entry)))
      issues.push(`${label} maps a high-impact claim only to low-fidelity evidence; ` +
        "add at least one of: integration|live|security|review");
    return issues;
  }

  function validateGroundingClaims(id, value, contract, repositories,
    parsedTasks, firstLock) {
    const issues = [];
    const claimIds = new Set(contract.claims.map((claim) => claim.id));
    if (!Array.isArray(value.claims) || value.claims.length !== claimIds.size)
      issues.push(`${id}/grounding.yaml must map every evidence claim exactly once`);
    const seen = new Set();
    for (const [index, claim] of (Array.isArray(value.claims) ? value.claims : []).entries()) {
      const label = `${id}/grounding.yaml claims[${index}]`;
      if (!claimIds.has(claim.id)) issues.push(`${label}.id references an unknown evidence claim`);
      if (seen.has(claim.id)) issues.push(`${label}.id is duplicated`);
      seen.add(claim.id);
      if (!Array.isArray(claim.productionPath) || claim.productionPath.length === 0)
        issues.push(`${label}.productionPath must be a non-empty array`);
      for (const [pathIndex, row] of (Array.isArray(claim.productionPath)
        ? claim.productionPath : []).entries())
        issues.push(...groundingPathIssues(id, `${label}.productionPath[${pathIndex}]`, row,
          repositories, value, "production-path", false, parsedTasks, firstLock));
      if (!Array.isArray(claim.failurePaths) || claim.failurePaths.length === 0)
        issues.push(`${label}.failurePaths must be a non-empty array`);
      for (const [pathIndex, row] of (Array.isArray(claim.failurePaths)
        ? claim.failurePaths : []).entries())
        issues.push(...groundingPathIssues(id, `${label}.failurePaths[${pathIndex}]`, row,
          repositories, value, null, true, parsedTasks, firstLock));
      const evidenceClaim = contract.claims.find((entry) => entry.id === claim.id);
      issues.push(...groundingClaimEvidenceIssues(label, claim, evidenceClaim));
    }
    failValidationLayer(fail, "grounding claim", issues);
    return claimIds;
  }

  function validateV2ClaimCoverage(id, value, contract, claimIds) {
    const rowClaimIds = (row) => Array.isArray(row?.claimIds) ? row.claimIds : [];
    const material = contract.claims.filter((claim) => claim.impact !== "low" &&
      (claim.capabilities || []).some((capability) =>
        ["test", "integration", "live", "browser"].includes(capability)));
    const criticalCoverage = new Set(value.criticalCases.flatMap(rowClaimIds));
    const uncovered = material.filter((claim) => !criticalCoverage.has(claim.id));
    if (uncovered.length)
      fail(`${id}/grounding.yaml material test claims ` +
        `${uncovered.map((claim) => `'${claim.id}'`).join(", ")} each require a ` +
        "stable criticalCases row shaped as {id, claimIds:[claim-id], " +
        `oracle:${CRITICAL_CASE_ORACLES.join("|")}}; when adding each row, also ` +
        "bind its id in execution.yaml provider.criticalCases before revalidating");
    for (const [index, row] of value.criticalCases.entries())
      for (const claimId of rowClaimIds(row))
        if (!claimIds.has(claimId))
          fail(`${id}/grounding.yaml criticalCases[${index}] references unknown claim '${claimId}'`);
    const mutationClaims = contract.claims.filter((claim) =>
      (claim.capabilities || []).includes("mutation"));
    const mutationCoverage = new Set(value.mutants.flatMap(rowClaimIds));
    for (const claim of mutationClaims)
      if (!mutationCoverage.has(claim.id))
        fail(`${id}/grounding.yaml mutation claim '${claim.id}' requires a named mutant and killer case`);
    for (const [index, row] of value.mutants.entries())
      for (const claimId of rowClaimIds(row))
        if (!claimIds.has(claimId))
          fail(`${id}/grounding.yaml mutants[${index}] references unknown claim '${claimId}'`);
  }

  function validateV2ExecutionBindings(id, dir, value) {
    const providers = Object.values(rawExecution(id, dir).providers || {});
    const configuredCases = new Set(providers.flatMap((provider) => provider.criticalCases || []));
    for (const row of value.criticalCases || [])
      if (!configuredCases.has(row.id))
        fail(`${id}/execution.yaml must bind critical case '${row.id}' in a provider.criticalCases list`);
    const mutationProviders = providers.filter((provider) =>
      provider.resultProtocol === "foundation-mutation-v2");
    const configuredMutants = new Set(mutationProviders
      .flatMap((provider) => provider.requiredMutants || []));
    for (const row of value.mutants || []) {
      if (!configuredMutants.has(row.id)) {
        fail(`${id}/execution.yaml must bind mutant '${row.id}' in a foundation-mutation-v2 provider.requiredMutants list`);
        continue;
      }
      const provider = mutationProviders.find((candidate) =>
        (candidate.requiredMutants || []).includes(row.id));
      if (provider?.mutantKillers?.[row.id] !== row.killerCaseId)
        fail(`${id}/execution.yaml mutantKillers.${row.id} must equal grounding killerCaseId '${row.killerCaseId}'`);
      if (!(provider?.criticalCases || []).includes(row.killerCaseId))
        fail(`${id}/execution.yaml mutation provider must require killer critical case '${row.killerCaseId}'`);
    }
  }

  function validateDerivedGroundingFacts(id, value) {
    if (!Array.isArray(value.derivedFacts || []))
      fail(`${id}/grounding.yaml derivedFacts must be an array`);
    for (const [index, fact] of (value.derivedFacts || []).entries())
      if (!String(fact.fact || "").trim() || !String(fact.command || "").trim())
        fail(`${id}/grounding.yaml derivedFacts[${index}] requires fact and command`);
  }

  function groundingValue(id, state, dir, parsedTasks = [], initialGroups = []) {
    // Cross-artifact diagnostics are supplied through initialGroups, but they
    // are not grounding-specific. Rapid/optional-grounding changes used to
    // return here and silently accept unknown task claims and other contract
    // errors. Preserve the short lane while still enforcing its packet.
    if (!state.groundingRequired) {
      failCollectedValidation(initialGroups);
      return null;
    }
    const grounding = readGroundingDocument(id, state, dir);
    const { value, digest: groundingDigest, firstLock } = grounding;
    if (value.version === 3) {
      const groups = initialGroups.filter((group) => group.issues?.length)
        .map((group) => ({ ...group, issues: [...group.issues] }));
      captureValidationGroup(groups, "grounding v3 decision",
        () => validateGroundingV3(id, value));
      failCollectedValidation(groups);
      return {
        value,
        digest: groundingDigest,
        firstLock,
        lockedAt: state.groundingLockedAt || now()
      };
    }
    const decision = value.decisionBatch || {};
    const groups = initialGroups.filter((group) => group.issues?.length)
      .map((group) => ({ ...group, issues: [...group.issues] }));
    const decisionIds = captureValidationGroup(groups, "grounding decision",
      () => validateGroundingDecision(id, decision)) || new Set();
    captureValidationGroup(groups, "semantic invariant",
      () => validateGroundingSemanticInvariants(id, state, dir, value, decisionIds));

    const readableReadSet = Array.isArray(value.readSet) && value.readSet.length > 0;
    if (!readableReadSet)
      groups.push({
        name: "grounding readSet",
        issues: [`${id}/grounding.yaml readSet must be non-empty`]
      });

    let v2 = null;
    if (value.version === 2) {
      v2 = captureValidationGroup(groups, "grounding risk and shape",
        () => groundingV2Context(id, state, dir, value));
      if (v2) {
        captureValidationGroup(groups, "NFR assessment",
          () => validateNfrAssessment(id, state, value, parsedTasks, v2));
        captureValidationGroup(groups, "required grounding sections",
          () => validateRequiredV2Sections(id, value, v2));
        if (readableReadSet)
          captureValidationGroup(groups, "grounding source",
            () => validateGroundingSourceRows(
              id, value, v2.selected, parsedTasks, firstLock));
        captureValidationGroup(groups, "service interaction",
          () => validateServiceInteractionRows(id, value));
        captureValidationGroup(groups, "critical case and mutant",
          () => validateCriticalCasesAndMutants(id, value));
      }
    }

    const repositories = new Map(validationRepositories(id, state, dir)
      .map((repository) => [repository.id, repository]));
    if (readableReadSet) {
      captureValidationGroup(groups, "grounding readSet",
        () => validateGroundingReadSet(id, value, repositories, firstLock, parsedTasks));
      captureValidationGroup(groups, "grounding task overlap",
        () => validateGroundingTaskOverlap(id, value, parsedTasks));
    }

    const contract = evidence(id, dir);
    let claimIds = new Set();
    if (readableReadSet) {
      captureValidationGroup(groups, "grounding read roles",
        () => validateGroundingReadRoles(id, state, contract, value.readSet));
      claimIds = captureValidationGroup(groups, "grounding claim",
        () => validateGroundingClaims(id, value, contract, repositories,
          parsedTasks, firstLock)) || new Set();
    }

    if (value.version === 2 && Array.isArray(value.criticalCases) &&
        Array.isArray(value.mutants)) {
      captureValidationGroup(groups, "critical case coverage",
        () => validateV2ClaimCoverage(id, value, contract, claimIds));
      captureValidationGroup(groups, "execution binding",
        () => validateV2ExecutionBindings(id, dir, value));
    }

    captureValidationGroup(groups, "derived grounding facts",
      () => validateDerivedGroundingFacts(id, value));
    failCollectedValidation(groups);
    return { value, digest: groundingDigest, firstLock, lockedAt: decision.lockedAt };
  }

  function validate(id, source = "root", options = {}) {
    const state = loadRuntime(id);
    const dir = validationChangeDirectory(
      id, source, state, activeChangePath, changePath);
    assertValidationPreflight(id, state, changeArtifactGaps(state, dir), fail);
    const classificationIssues = proposalClassificationIssues(
      state, readFileSync(join(dir, "proposal.md"), "utf8"));
    if (classificationIssues.length)
      fail(`change agreement classification failed:\n  - ${classificationIssues.join("\n  - ")}`);
    assertArchiveSafeArtifacts(id, dir);
    assertNoScaffolds(state, dir);
    const contractDiagnostics = [];
    if (state.decisionMetadataRequired) {
      const design = readFileSync(join(dir, "design.md"), "utf8");
      contractDiagnostics.push(...durableDecisionMetadataIssues(design)
        .map((issue) => `design: ${issue}`));
    }
    const tasks = readFileSync(join(dir, "tasks.md"), "utf8");
    const parsedTasks = taskBlocks(tasks);
    const executableEvidence = evidence(id, dir);
    const claims = executableEvidence.claims;
    const selectedRepositoryIds = new Set(validationRepositories(id, state, dir)
      .map((repository) => repository.id));
    contractDiagnostics.push(...claimContractIssues(claims, selectedRepositoryIds)
      .map((issue) => `claims: ${issue}`));
    const selected = validationRepositories(id, state, dir);
    contractDiagnostics.push(...taskContractIssues(
      parsedTasks, claims, selectedRepositoryIds, selected.length > 1)
      .map((issue) => `tasks: ${issue}`));
    const grounding = groundingValue(id, state, dir, parsedTasks, [{
      name: "cross-artifact contract", issues: contractDiagnostics
    }]);
    assertNewCapabilitiesAreAdditive(id, dir);
    assertExistingCapabilityOperations(id, dir);
    assertNoDroppedScenarios(id, dir);
    // The OpenSpec strict lint used to surface only inside 'openspec archive',
    // after the code had landed, so a pure wording defect forced a re-prove.
    // Same tool, same mode, earlier. Quiet changes presentation only; skipping
    // the subprocess here let an invalid agreement travel all the way to Land.
    // Rapid changes declare skip_specs and have no deltas to lint.
    if (state.schema !== "foundation-rapid")
      assertOpenSpecStrictValid(id, dir, fail, { quiet: options.quiet });

    // The gate is about a task that names a lifecycle *command*, so the slash
    // has to start a token. Matching a bare `/land` anywhere also matched the
    // path `runtime/workflow/land-runtime.mjs`, which made every change that
    // declares that file's path in `[paths:]` unvalidatable — the guard blocked
    // work on the very code it guards.
    const taskIds = validateImplementationTasks(parsedTasks, fail);

    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    handoffContract(id, {
      state,
      claimIds: new Set(claimById.keys()),
      taskIds: new Set(taskIds)
    });

    const acceptance = resolvedAcceptance(id, state, { claims });
    normalizeValidationAcceptance(id, state, claims, acceptance,
      fail, console.error, acceptance.required ? now() : null);

    if (claims.some((claim) => claim.impact === "high")) state.reviewRequired = true;
    state.evidenceCapabilities = [...new Set(claims.flatMap((claim) => claim.capabilities))];
    const budgetReviewRisk = changedSurfaceResolvable(id, state)
      ? reviewPolicy(id, state, executableEvidence) : null;
    state.executionSurface = compiledExecutionSurfaceValue({
      tasks: parsedTasks,
      claims,
      providers: executableEvidence.providers,
      repositories: selected,
      reviewTier: budgetReviewRisk?.tier || null,
      securityTriggerCount: (state.securityTriggers || []).length
    });
    const missingQuality = missingHighRiskQualityCapabilities(
      state, claims, foundationPolicy());
    if (missingQuality.length)
      fail(`${id}/evidence.yaml high-risk quality policy requires claim capabilities: ${missingQuality.join(", ")}; configure project-owned providers or record a capability waiver`);
    // Case-insensitive and `xs`-aware: this compared against the literal "S",
    // so an atomic start's own "xs" fell through to the wide budget and the
    // check only ever passed via the impact disjunct.
    warnValidationDocumentBudgets(dir, state);
    // Lock only after every validation gate above passes. A malformed task or
    // unresolved acceptance decision must not freeze a grounding ledger that
    // has never represented a valid Change contract.
    if (!options.inspect) {
      if (grounding?.firstLock)
        lockValidatedGrounding(state, grounding, contractFingerprint(id, dir), now());
      else
        lockValidatedGrounding(state, grounding, null, null);
      saveRuntime(state);
    }
    // A declared surface predicts capabilities that the *changed* surface will
    // only reveal once files exist — by which point this contract is signed and
    // its evidence collected. Warn, never fail: the forecast is a prediction the
    // author owns, and failing here would be routed around by declaring nothing.
    const coveredCapabilities = state.declaredSurface?.length && !options.quiet
      ? new Set(requiredProviders(id).map((provider) =>
        providerCapability(provider, providerConfig(id, provider))))
      : new Set();
    reportDeclaredSurfaceForecast(id, state, options.quiet,
      coveredCapabilities, forecastCapabilities);
    // Review is the one gate a change cannot wire its way out of, and the loop
    // used to reveal it at Prove — after the build is spent, and with the
    // waiver that resolves it named nowhere. A forecast only covers what is not
    // yet required; once it *is* required, saying so here is the last cheap
    // moment to find a reviewer or decide the project reviews itself.
    // Guarded for the same reason as `advisoryCapabilities`: `reviewPolicy`
    // reads the changed surface, which a multi-repository change cannot resolve
    // until its sandboxes exist. A hint must never be able to fail validate.
    const reviewResolvable = !options.quiet && changedSurfaceResolvable(id, state);
    const policy = reviewResolvable
      ? reviewPolicy(id, state, evidence(id, dir))
      : {};
    const assurance = reportValidationReviewAssurance(
      options.quiet, reviewResolvable, policy,
      reviewResolvable ? reviewAssurancePosture(policy) : null);
    const compiled = executionContract?.(id) || null;
    const preflight = compiled?.authority || authorityPreflight(id);
    if (!options.quiet) {
      console.log(`VALID ${id} (${state.schema}, ${claims.length} claims)\n  next: ${nextAfterValidate(state.status, id)}`);
      if (preflight.status !== "READY")
        console.log(`  authority: ${preflight.status}; ${preflight.blockers
          .map((blocker) => `${blocker.code}: ${blocker.next}`).join("; ")}`);
    }
    return {
      version: 1, changeId: id, reviewAssurance: assurance,
      authorityPreflight: preflight,
      ...(compiled ? { executionContract: compiled } : {})
    };
  }

  // A capability the policy infers from the *realized* diff is a risk hint, not
  // a contract the author signed. It can only appear once the files exist —
  // after Build — and an inferred capability nobody wired defaults to adapter
  // "external" (`evidence-contract`), so the required set grew past the point
  // where the contract could still be negotiated and Prove stopped on a gate
  // that had no way to pass. Enforce an inferred capability only where the
  // project actually wired a provider for it, or where the author declared the
  // same capability on a claim; otherwise carry it as an advisory that is
  // reported and recorded but does not block.
  //
  // `review` is deliberately unaffected: `reviewPolicy` reads the same inferred
  // set and adds review itself, and it owns a documented waiver
  // (`review.independence`, `review.diversity` in foundation.json). Downgrading
  // it here would drop a gate that has a way out rather than one that does not.
  function policyCapabilitySplit(id, contract = evidence(id)) {
    const configured = new Set(Object.entries(contract.providers || {})
      .map(([provider, config]) => providerCapability(provider, config)));
    const declared = new Set(contract.claims.flatMap((claim) => claim.capabilities || []));
    const enforced = [];
    const advisory = [];
    const state = loadRuntime(id);
    for (const capability of policyCapabilities(id)) {
      const trigger = policyCapabilityTrigger(id, capability) || "";
      const npmManifestChanged = capability === "dependency-supply-chain" &&
        /(?:^|\/)package\.json$/.test(trigger) &&
        existsSync(join(state.workspace?.path || root, "package-lock.json"));
      (configured.has(capability) || declared.has(capability) || npmManifestChanged
        ? enforced : advisory)
        .push(capability);
    }
    return { enforced, advisory };
  }

  const requiredProviders = requiredProvidersOperation.bind(null, {
    loadRuntime, evidence, providerCapability, reviewPolicy,
    resolvedAcceptance, policyCapabilitySplit, foundationPolicy
  });

  // Advisories are the record that the downgrade above happened. Dropping an
  // inferred capability silently would make "the policy saw nothing" and "the
  // policy saw something nobody wired" identical in the evidence, which is
  // exactly the distinction a later reader needs.
  // Advisories are reporting, never a gate, so they must not be able to fail a
  // command. The changed surface is unresolvable in states that are not errors
  // — a multi-repository change before its sandboxes exist cannot answer "what
  // changed" yet — and that path exits the process rather than throwing, so the
  // precondition is checked instead of caught. `requiredProviders` deliberately
  // does not get this treatment: dropping an inferred capability there would
  // under-require evidence, so it must still stop.
  function advisoryCapabilities(id) {
    const waived = (loadRuntime(id).waivers || []).map((row) => ({
      capability: row.capability,
      reason: "user-waived",
      detail: row.reason,
      authority: row.authority,
      recordedAt: row.recordedAt,
      next: `restore it: claude-foundation change waive ${id} --capability ${
        row.capability} --revoke --decision-ref <ref>`
    }));
    if (!changedSurfaceResolvable(id)) return waived;
    return [
      ...policyCapabilitySplit(id).advisory.map((capability) => ({
        capability,
        trigger: policyCapabilityTrigger(id, capability),
        reason: "policy-inferred-unwired",
        next: `configure a project-owned ${capability} provider in openspec/changes/${
          id}/execution.yaml, or accept the advisory`
      })),
      ...waived
    ];
  }

  const waiveGate = waiveGateOperation.bind(null, {
    loadRuntime, saveRuntime, requiredProviders, providerCapability,
    providerConfig, now, fail, log: console.log
  });

  function evidenceDetectionValue(id) {
    const state = loadRuntime(id);
    const contract = evidence(id);
    const repositories = selectedRepositories(id, state);
    return detectEvidenceWiring({
      id,
      root,
      contract,
      repositories,
      // Detection wires what Prove will look for *and* what it downgraded to an
      // advisory: an inferred capability with a safe project-owned script is
      // better wired than waived, and `evidence init --write` is the only thing
      // that can promote it back into the enforced set.
      required: [...new Set([
        ...requiredProviders(id),
        ...advisoryCapabilities(id).map((row) => row.capability)
      ])].sort(),
      providerConfig: (provider) => providerConfig(id, provider),
      providerCapability,
      knownProviders,
      commandExists,
      stableHash,
      declaredSurface: state.declaredSurface || []
    });
  }

  function showEvidenceDetection(id) {
    console.log(JSON.stringify(evidenceDetectionValue(id), null, 2));
  }

  function initializeEvidence(id, flags = {}) {
    const detection = evidenceDetectionValue(id);
    // `activeChangePath` points into the sandbox while one is active, which is
    // right for reading a Build packet and fatal for writing contract. `sync`
    // is one-way source → sandbox: it removes the destination, copies the
    // source over it, and merges back only `tasks.md`. Writing detected
    // providers into the sandbox therefore handed them to the next sync to
    // delete — silently, in both trees, after reporting them written. The
    // durable directory is what Land archives and what sync copies forward, so
    // it is the only placement a sync cannot destroy.
    const executionPath = join(changePath(id), "execution.yaml");
    // Build still has to see the wiring without paying for a sync, which would
    // bump `revision` and drop `provenHash`. The mirror is the identical value,
    // and the next sync overwrites it from the same source.
    const activePath = activeChangePath(id);
    const mirrorPath = activePath === changePath(id)
      ? null : join(activePath, "execution.yaml");
    const current = rawExecution(id);
    const additions = {};
    for (const candidate of detection.candidates.filter((row) => row.recommended && row.config)) {
      if (current.providers[candidate.provider] || additions[candidate.provider]) continue;
      additions[candidate.provider] = candidate.config;
    }
    const preview = {
      version: 1,
      changeId: id,
      write: Boolean(flags.write),
      path: relative(root, executionPath).replaceAll("\\", "/"),
      additions,
      skipped: detection.candidates
        .filter((row) => !row.recommended || !row.config)
        .map((row) => ({
          provider: row.provider,
          confidence: row.confidence,
          detail: row.detail
        }))
    };
    if (flags.write && Object.keys(additions).length) {
      const next = {
        ...current,
        providers: { ...current.providers, ...additions }
      };
      writeJson(executionPath, next);
      if (mirrorPath) writeJson(mirrorPath, next);
      preview.written = Object.keys(additions).sort();
    } else {
      preview.written = [];
    }
    console.log(JSON.stringify(preview, null, 2));
  }

  function showEvidenceDoctor(id) {
    const detection = evidenceDetectionValue(id);
    console.log(`EVIDENCE DOCTOR ${id}: ${detection.status}`);
    for (const row of detection.configured)
      console.log(`  OK       ${row.provider}: ${row.adapter} (${row.repository})`);
    for (const row of detection.candidates)
      console.log(`  ${row.recommended ? "CANDIDATE" : "REVIEW   "} ${row.provider}: ${row.source}${row.detail ? `; ${row.detail}` : ""}`);
    for (const row of detection.unresolved)
      console.log(`  BLOCKED  ${row.provider}: ${row.reason}; next: ${row.next}`);
    for (const row of detection.unavailable)
      console.log(`  BLOCKED  ${row.provider}: ${row.reason}; next: ${row.next}`);
    for (const row of detection.warnings)
      console.log(`  WARNING  ${row.source}: ${row.reason}; ${row.detail}`);
    if (detection.candidates.some((row) => row.recommended))
      console.log(`  next: claude-foundation evidence init ${id} --write`);
  }

  return {
    advisoryCapabilities,
    assertExistingCapabilityOperations,
    assertNoScaffolds,
    assertNewCapabilitiesAreAdditive,
    assertNoDroppedScenarios,
    changeArtifactGaps,
    changeSpecScenarios,
    droppedScenarioFindings,
    groundingValue,
    evidenceDetectionValue,
    initializeEvidence,
    newCapabilityOperationFindings,
    pendingTasks,
    requiredProviders,
    showEvidenceDetection,
    showEvidenceDoctor,
    showTraceabilityAudit,
    taskBlocks,
    taskMetadata,
    traceabilityAuditValue,
    validate,
    waiveGate
  };
}
