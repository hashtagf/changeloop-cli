import {
  appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { repositoryDeliveryOrder } from "./repository-delivery-saga.mjs";
import { environmentCause, errorCodes } from "./advance-recovery.mjs";
import {
  createDeliveryIntegrity, deliveryProjectionEntry, assertLandEntryMode, assertDeliveryEntries
} from "./delivery-integrity.mjs";

export const DELIVERY_PROTOCOL_VERSION = 2;
export const DELIVERY_RECEIPT_SCHEMA_VERSION = 1;

const TYPE_LABELS = {
  "feature-frontend": "Feature — Frontend",
  "feature-backend": "Feature — Backend",
  "bug-fix": "Bug Fix",
  "refactor-technical-debt": "Refactor / Technical Debt",
  "database-migration": "Database / Migration",
  "infrastructure-devops": "Infrastructure / DevOps",
  performance: "Performance",
  "security-hotfix": "Security / Hotfix"
};

const TYPE_SECTIONS = {
  "feature-frontend": ["Design and visual evidence", "Responsive and states", "Accessibility and analytics"],
  "feature-backend": ["API contract", "Data and authorization", "Idempotency and concurrency"],
  "bug-fix": ["Problem", "Root cause", "Fix", "Regression evidence"],
  "refactor-technical-debt": ["Objective", "Behavior change", "Before and after", "Quality metrics"],
  "database-migration": ["Schema change", "Migration execution", "Compatibility", "Backup and rollback"],
  "infrastructure-devops": ["Infrastructure change", "Expected result", "Operational verification"],
  performance: ["Benchmark method", "Before and after metrics", "Capacity impact"],
  "security-hotfix": ["Threat or incident", "Attack or failure path", "Mitigation", "Security regression evidence"]
};

const SECRET_FIELD = /(?:password|passwd|private[_-]?key|secret|credential|access[_-]?token|refresh[_-]?token|api[_-]?key)/i;
const SECRET_VALUE = /(?:AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{16,}|https?:\/\/[^\s/:@]+:[^\s@]+@)/i;

function clean(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function deliveryPolicy(policy = {}) {
  const configured = policy?.deliver || {};
  return {
    provider: clean(configured.provider) || "auto",
    remote: clean(configured.remote) || "origin",
    defaultBaseBranch: clean(configured.defaultBaseBranch) || null,
    branchPattern: clean(configured.branchPattern) || DEFAULT_BRANCH_PATTERN,
    commitSubject: clean(configured.commitSubject) || DEFAULT_COMMIT_SUBJECT,
    ticketPattern: clean(configured.ticketPattern) || null,
    missingPresentationEvidence: clean(configured.missingPresentationEvidence) || "draft",
    missingRequiredEvidence: clean(configured.missingRequiredEvidence) || "block",
    updateOwnedPullRequest: configured.updateOwnedPullRequest !== false,
    allowForcePush: false,
    allowDefaultBranchPush: false,
    allowedHosts: Array.isArray(configured.allowedHosts)
      ? configured.allowedHosts.map(clean).filter(Boolean) : ["github.com"]
  };
}

export function safeBranchComponent(value) {
  return clean(value).toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\/{2,}/g, "/")
    .replace(/(?:^|\/)\.+(?:\/|$)/g, "/")
    .replace(/^[-/.]+|[-/.]+$/g, "")
    .slice(0, 120) || "change";
}

export const DEFAULT_BRANCH_PATTERN = "change/{changeId}";
export const DEFAULT_COMMIT_SUBJECT = "{commitType}: {title}";
export const COMMIT_SUBJECT_MAX_LENGTH = 180;
export const BRANCH_NAME_MAX_LENGTH = 200;
const NAMING_PLACEHOLDERS = ["changeId", "title", "commitType", "prType", "ticket"];
const PLACEHOLDER = /\{([^{}]*)\}/g;

// A project naming setting that cannot produce a valid commit subject or
// branch. Deliver refuses it before any workspace, commit, or push exists.
function namingInvalid(message) {
  const error = new Error(`${message}; correct the 'deliver' naming settings in foundation.json and retry Deliver`);
  error.code = "DELIVERY_NAMING_INVALID";
  return error;
}

function templatePlaceholders(template, setting) {
  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
  const unknown = unique(names.filter((name) => !NAMING_PLACEHOLDERS.includes(name)));
  if (unknown.length)
    throw namingInvalid(`deliver.${setting} uses unknown placeholder ${unknown.map((name) => `{${name}}`).join(", ")} ` +
      `(supported: ${NAMING_PLACEHOLDERS.map((name) => `{${name}}`).join(", ")})`);
  if (/[{}]/.test(template.replace(PLACEHOLDER, "")))
    throw namingInvalid(`deliver.${setting} has an unbalanced brace`);
  return names;
}

// `{ticket}` is the first match of the project's `deliver.ticketPattern` in
// the change id, then the archived title, why, and summary (capture group 1
// when the pattern has one). A template that needs a ticket the change does
// not carry is refused, never filled with a guess.
export function deliveryTicket(ticketPattern, sources = []) {
  if (!ticketPattern) return null;
  let pattern;
  try { pattern = new RegExp(ticketPattern); }
  catch (error) { throw namingInvalid(`deliver.ticketPattern is not a valid regular expression (${error.message})`); }
  for (const source of sources) {
    const match = String(source ?? "").match(pattern);
    const value = clean(match?.[1] ?? match?.[0]);
    if (value) return value;
  }
  return null;
}

// The values naming templates may reference, all derived from the
// checkpointed narrative so a resumed or follow-up delivery names its commit
// and branch the same way.
export function deliveryNamingValues({ changeId, narrative = {}, ticketPattern = null }) {
  const title = clean(narrative.title) || clean(changeId);
  return {
    changeId: clean(changeId),
    title,
    commitType: title.toLowerCase().startsWith("fix") ? "fix" : "feat",
    prType: clean(narrative.type) || "feature-backend",
    ticket: deliveryTicket(ticketPattern, [changeId, narrative.title, narrative.why, narrative.summary]),
    ticketConfigured: Boolean(ticketPattern)
  };
}

function fillTemplate(template, setting, values, transform = (value) => value) {
  const names = templatePlaceholders(template, setting);
  if (names.includes("ticket") && !values.ticket)
    throw namingInvalid(values.ticketConfigured
      ? `deliver.${setting} uses {ticket} but no match for deliver.ticketPattern was found in the change id, title, or proposal`
      : `deliver.${setting} uses {ticket} but deliver.ticketPattern is not configured`);
  return template.replace(PLACEHOLDER, (_, name) => transform(clean(values[name]), name));
}

// The delivery commit subject. The default template reproduces the
// historical `feat: <title>` / `fix: <title>` subject byte for byte.
export function deliveryCommitSubject(template, values) {
  if (!clean(template) || clean(template) === DEFAULT_COMMIT_SUBJECT)
    return `${values.commitType}: ${values.title}`.slice(0, COMMIT_SUBJECT_MAX_LENGTH);
  const subject = clean(fillTemplate(clean(template), "commitSubject", values));
  if (!subject) throw namingInvalid("deliver.commitSubject produces an empty commit subject");
  if (/[\r\n]/.test(subject)) throw namingInvalid("deliver.commitSubject must produce a single-line subject");
  if (/[\u0000-\u001f\u007f]/.test(subject))
    throw namingInvalid("deliver.commitSubject produces a control character");
  if (subject.length > COMMIT_SUBJECT_MAX_LENGTH)
    throw namingInvalid(`deliver.commitSubject produces a ${subject.length}-character subject (limit ${COMMIT_SUBJECT_MAX_LENGTH})`);
  return subject;
}

// The delivery branch. A pattern using only `{changeId}` keeps its historical
// normalization unchanged. With any other placeholder, values are slugged
// (`{ticket}` is kept as matched) and the project's literal text is kept as
// written; the result is checked here and with `git check-ref-format`.
export function deliveryBranchName(pattern, changeId, values = {}) {
  const template = clean(pattern) || DEFAULT_BRANCH_PATTERN;
  if (templatePlaceholders(template, "branchPattern").every((name) => name === "changeId"))
    return safeBranchComponent(template.replaceAll("{changeId}", safeBranchComponent(changeId)));
  const slug = (value) => safeBranchComponent(value).replaceAll("/", "-").slice(0, 60).replace(/[-.]+$/, "");
  const branch = fillTemplate(template, "branchPattern", { ...values, changeId },
    (value, name) => name === "ticket" ? value
      : name === "changeId" ? safeBranchComponent(value).replaceAll("/", "-") : slug(value));
  const problem = branchNameProblem(branch);
  if (problem) throw namingInvalid(`deliver.branchPattern produces an invalid branch '${branch}': ${problem}`);
  return branch;
}

export function branchNameProblem(branch) {
  if (!branch) return "it is empty";
  if (branch.length > BRANCH_NAME_MAX_LENGTH) return `it is longer than ${BRANCH_NAME_MAX_LENGTH} characters`;
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(branch) || branch.includes("@{") || branch === "@" ||
      branch.includes("..") || branch.includes("//") || /^[-/.]|[/.]$|\.lock(?:\/|$)|\/\./.test(branch))
    return "it is not a valid Git branch name";
  return null;
}

export function parseGitHubRemote(value) {
  const raw = clean(value);
  const https = raw.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  const ssh = raw.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  const match = https || ssh;
  if (!match) return null;
  return { host: match[1].toLowerCase(), owner: match[2], repository: match[3], slug: `${match[2]}/${match[3]}` };
}

export function classifyPullRequest({ text = "", paths = [] } = {}) {
  const source = `${text}\n${paths.join("\n")}`.toLowerCase();
  const matches = (pattern) => pattern.test(source);
  if (matches(/\b(security|vulnerab|cve|idor|xss|csrf|auth(?:entication|orization)?|hotfix|incident)\b/))
    return "security-hotfix";
  if (matches(/\b(database|migration|migrate|schema|index|backfill|postgres|mysql|mongo)\b/))
    return "database-migration";
  if (matches(/\b(terraform|kubernetes|k8s|docker|helm|cloudflare|ci\/cd|workflow|infrastructure|devops)\b/))
    return "infrastructure-devops";
  if (matches(/\b(performance|latency|throughput|benchmark|p50|p95|p99|rps|capacity)\b/))
    return "performance";
  if (matches(/\b(bug|fix|incorrect|regression|root cause|failure|broken)\b/))
    return "bug-fix";
  if (matches(/\b(refactor|technical debt|complexity|crap score|mutation score|cleanup)\b/))
    return "refactor-technical-debt";
  if (paths.some((path) => /(?:^|\/)(?:app|pages|components|web|frontend|ui)(?:\/|$)|\.(?:css|scss|tsx|jsx|vue|svelte)$/i.test(path)))
    return "feature-frontend";
  return "feature-backend";
}

export function markdownSection(source, heading) {
  const lines = String(source || "").split(/\r?\n/);
  const wanted = clean(heading).toLowerCase();
  const start = lines.findIndex((line) => {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    return match && clean(match[1]).toLowerCase() === wanted;
  });
  if (start < 0) return "";
  const level = lines[start].match(/^#+/)[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    const marker = line.match(/^(#+)\s+/);
    if (marker && marker[1].length <= level) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

function bullets(source) {
  return String(source || "").split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(?:\*\*[^*]+\*\*\s*)?(.+)$/)?.[1])
    .map(clean).filter(Boolean);
}

function taskTitles(source) {
  return String(source || "").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*-\s+\[[ xX]\]\s+\*\*(T\d+)\*\*\s+(.+?)(?:\s+—|\s+\[repo:|$)/);
    return match ? [`${match[1]} — ${clean(match[2])}`] : [];
  });
}

function relatedReferences(source) {
  const urls = String(source || "").match(/https?:\/\/[^\s)>]+/g) || [];
  return unique(urls).slice(0, 20);
}

function pullRequestUrlKey(value) {
  return clean(value).replace(/[#?].*$/, "").replace(/[.,;:]+$/, "").replace(/\/+$/, "")
    .replace(/\/(?:files|commits|checks)$/, "").toLowerCase();
}

// A follow-up change records the delivery it continues by citing that
// delivery's pull-request URL in its agreement (proposal or design). Only a
// URL that a verified receipt of another change in this project produced
// binds; an ordinary related link never redirects publication.
export function followUpDeliveryCandidates({ changeId, proposal = "", design = "", receipts = [] }) {
  const cited = new Set(relatedReferences(`${proposal}\n${design}`).map(pullRequestUrlKey));
  return receipts.filter((receipt) => receipt && receipt.changeId !== changeId &&
    !receipt.multiRepository && receipt.branch && receipt.pullRequest?.url &&
    cited.has(pullRequestUrlKey(receipt.pullRequest.url)));
}

export function pullRequestNarrative({ changeId, state, proposal, design, tasks, proof, paths }) {
  const why = markdownSection(proposal, "Why") || clean(state.intent) || `Deliver ${changeId}`;
  const changes = markdownSection(proposal, "What changes") || markdownSection(proposal, "What Changes");
  const nonGoals = markdownSection(proposal, "Non-goals") || markdownSection(proposal, "Non-Goals");
  // Older proposals list "What changes"; the current layout states the same
  // requirement titles once, in Scope.
  const scoped = String(proposal || "").match(/^\s*-\s*\*\*In scope(?: \([^)]*\))?:\*\*\s*(.+)$/m)?.[1]
    ?.split(/;\s+/).map(clean).filter(Boolean) || [];
  const included = bullets(changes).length ? bullets(changes)
    : scoped.length ? scoped : taskTitles(tasks);
  const excluded = bullets(nonGoals);
  const titleSource = included[0] || clean(state.intent) || changeId;
  const title = titleSource.replace(/[`*_]/g, "").replace(/[.!]$/, "").slice(0, 120);
  const type = classifyPullRequest({ text: `${proposal}\n${design}\n${tasks}`, paths });
  const receipts = Array.isArray(proof?.receipts) ? proof.receipts : [];
  return {
    changeId,
    title,
    summary: included.length ? included.join("\n") : clean(changes) || title,
    why,
    relatedWork: relatedReferences(`${proposal}\n${design}`),
    included,
    excluded,
    type,
    testEvidence: receipts.map((receipt) => ({
      provider: receipt.provider,
      repositoryId: receipt.repositoryId || null,
      reference: receipt.path,
      digest: receipt.sha256 || null
    })),
    risk: `Impact: ${state.impact || "unknown"}; coupling: ${state.coupling || "unknown"}.`,
    rollback: markdownSection(design, "Rollback") ||
      markdownSection(design, "Compatibility and migration") ||
      "Revert the delivery commit; no deployment or merge is performed by Deliver.",
    monitoring: markdownSection(design, "Monitoring") ||
      "No runtime monitoring plan was declared in the archived change.",
    paths
  };
}

function receiptEvidenceText(root, proof, readJson) {
  return (proof?.receipts || []).flatMap((entry) => {
    const receipt = entry?.path ? readJson(join(root, entry.path), {}) : {};
    return [entry.provider, receipt.observed,
      ...(receipt.references || []),
      ...(receipt.artifacts || []).flatMap((artifact) =>
        [artifact.type, artifact.path, artifact.name, artifact.description])]
      .map(clean).filter(Boolean);
  }).join("\n").toLowerCase();
}

export function deliveryEvidenceAssessment({ root, lifecycle, proof, narrative, readJson }) {
  const requiredIssues = [];
  if (proof?.status !== "pass") requiredIssues.push("finalized proof is missing or not passing");
  if (!proof?.proofRunId || proof.proofRunId !== lifecycle?.land?.proofRunId)
    requiredIssues.push("proof run does not match the Land binding");
  if (!Array.isArray(proof?.receipts) || proof.receipts.length === 0)
    requiredIssues.push("proof has no durable receipt manifest");
  for (const entry of proof?.receipts || []) {
    const path = entry?.path ? join(root, entry.path) : null;
    if (!path || !existsSync(path) || pathIdentityForEvidence(path) !== entry.sha256)
      requiredIssues.push(`proof receipt is missing or changed: ${entry?.provider || "unknown"}`);
  }

  const evidenceText = receiptEvidenceText(root, proof, readJson);
  const presentationPatterns = {
    "feature-frontend": /screenshot|visual|image|\.png\b|\.jpe?g\b|\.webp\b|\.gif\b|video|\.webm\b|\.mp4\b/,
    "feature-backend": /request|response|api|integration|contract/,
    "bug-fix": /regression|before|after|reproduc|root.?cause/,
    "refactor-technical-debt": /coverage|complexity|mutation|crap|behavior|test/,
    "database-migration": /migration|schema|backfill|record|lock|database/,
    "infrastructure-devops": /metric|grafana|terraform|plan|docker|kubernetes|helm|infrastructure/,
    performance: /benchmark|k6|latency|throughput|p50|p95|p99|rps|cpu|memory/,
    "security-hotfix": /attack|security|vulnerab|authorization|authentication|incident|idor|xss|csrf/
  };
  const pattern = presentationPatterns[narrative.type];
  const presentationComplete = Boolean(pattern?.test(evidenceText));
  const scoreParts = {
    summary: Boolean(clean(narrative.summary)),
    why: Boolean(clean(narrative.why)),
    scope: narrative.paths.length > 0,
    evidence: requiredIssues.length === 0,
    risk: Boolean(clean(narrative.risk)),
    rollback: Boolean(clean(narrative.rollback)),
    monitoring: Boolean(clean(narrative.monitoring)),
    typeEvidence: presentationComplete
  };
  const score = Math.round(Object.values(scoreParts).filter(Boolean).length /
    Object.keys(scoreParts).length * 100);
  return {
    requiredComplete: requiredIssues.length === 0,
    requiredIssues,
    presentationComplete,
    presentationIssue: presentationComplete ? null :
      `No ${TYPE_LABELS[narrative.type] || narrative.type} presentation evidence was identified in the proven receipts.`,
    quality: { score, checks: scoreParts }
  };
}

function pathIdentityForEvidence(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function markdownList(values, empty) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

export function renderPullRequestBody(narrative, { draft = false } = {}) {
  const typeSections = TYPE_SECTIONS[narrative.type] || [];
  const evidence = narrative.testEvidence.map((row) =>
    `- **${row.provider}**${row.repositoryId ? ` (${row.repositoryId})` : ""}: \`${row.reference}\`${row.digest ? ` — \`${row.digest.slice(0, 12)}\`` : ""}`);
  const related = narrative.relatedWork.length ? narrative.relatedWork : [`OpenSpec change: \`${narrative.changeId}\``];
  const extra = typeSections.map((heading) =>
    `## ${heading}\n\nNot separately declared; see the verified evidence and archived design above.`).join("\n\n");
  return [
    "## Summary", "", narrative.summary, "",
    "## Why", "", narrative.why, "",
    "## Related Work", "", markdownList(related, `OpenSpec change: \`${narrative.changeId}\``), "",
    "## Type", "", TYPE_LABELS[narrative.type] || narrative.type, "",
    "## Scope", "", "### Included", "",
    markdownList(narrative.included, "See the proven path projection below."), "",
    "### Not Included", "", markdownList(narrative.excluded, "No explicit non-goals were declared."), "",
    "### Proven paths", "", markdownList(narrative.paths.map((path) => `\`${path}\``), "No product path changes."), "",
    "## Test & Evidence", "", markdownList(evidence, "No receipt references were available."), "",
    "## Risk", "", narrative.risk, "",
    "## Rollback", "", narrative.rollback, "",
    "## Monitoring", "", narrative.monitoring,
    narrative.quality ? `\n\n## PR Quality\n\nScore: **${narrative.quality.score}/100**` : "",
    extra ? `\n\n${extra}` : "",
    draft ? "\n\n> This pull request is a draft because presentation evidence is incomplete." : "",
    "\n\n---\nGenerated from archived OpenSpec and content-bound Foundation proof."
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function containsSecretMaterial(value) {
  if (SECRET_VALUE.test(String(value || ""))) return true;
  return String(value || "").split(/\r?\n/).some((line) => {
    const match = line.match(/^\s*([^:=]+)\s*[:=]\s*(.+)$/);
    return match && SECRET_FIELD.test(match[1].replace(/[^a-z0-9]/gi, "")) && clean(match[2]) &&
      !/^(?:none|not applicable|redacted|\*+|x+)$/i.test(clean(match[2]));
  });
}

function resultText(result) {
  return clean(result?.stderr || result?.stdout || result?.error?.message);
}

// Remote and provider operations fail for reasons the repository operator
// owns (credentials, network, remote configuration). They are typed here so
// Deliver waits on that owner only for them, never for an unrelated failure
// whose message happens to mention a remote.
const PROVIDER_GIT_COMMANDS = new Set(["push", "fetch", "ls-remote"]);

function providerUnavailable(message) {
  const error = new Error(message);
  error.code = "DELIVERY_PROVIDER_UNAVAILABLE";
  return error;
}

function runChecked(run, executable, args, options, label) {
  const result = run(executable, args, options);
  if (result.status !== 0) {
    const error = new Error(`${label}: ${resultText(result) || `exit ${result.status}`}`);
    error.code = executable === "gh" || (executable === "git" && PROVIDER_GIT_COMMANDS.has(args[0]))
      ? "DELIVERY_PROVIDER_UNAVAILABLE" : "DELIVERY_EXTERNAL_COMMAND_FAILED";
    error.command = executable;
    error.result = result;
    throw error;
  }
  return result;
}

function workspaceDrift(message) {
  const error = new Error(message);
  error.code = "DELIVERY_PROJECTION_DRIFT";
  error.stage = "delivery-workspace";
  return error;
}

function copyEntry(source, destination) {
  rmSync(destination, { recursive: true, force: true });
  const stat = lstatSync(source, { throwIfNoEntry: false });
  if (!stat) return;
  mkdirSync(dirname(destination), { recursive: true });
  if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), destination);
  else cpSync(source, destination, {
    recursive: stat.isDirectory(), dereference: false, verbatimSymlinks: true,
    preserveTimestamps: true
  });
}

function filesUnder(root, rel) {
  const absolute = join(root, rel);
  if (!existsSync(absolute)) return [rel];
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return [rel];
  const rows = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(path);
      else rows.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(absolute);
  return rows.length ? rows : [rel];
}

function archivedSpecPaths(root, archivedChangePath) {
  const specs = join(root, archivedChangePath, "specs");
  if (!existsSync(specs)) return [];
  return readdirSync(specs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `openspec/specs/${entry.name}/spec.md`);
}

// Land journal entries that changed bytes or mode, each still at its proven
// identity in the target.
function changedLandEntries(base, entries, pathIdentity, where = "") {
  const changed = entries.filter((entry) => !(entry.before === entry.after &&
    (entry.beforeMode === undefined || entry.beforeMode === entry.afterMode)));
  for (const entry of changed) {
    assertLandEntryMode(base, entry, pathIdentity);
    if (pathIdentity(join(base, entry.path)) !== entry.after) {
      const error = new Error(`proven path changed after Land${where}: ${entry.path}`);
      error.code = "DELIVERY_PROJECTION_DRIFT";
      error.path = entry.path;
      throw error;
    }
  }
  return changed;
}

function safeRepositoryId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function repositoryDeliveryProjection({
  repository, lifecycle, transactions, readJson, pathIdentity
}) {
  const runtime = lifecycle.repositories?.[repository.id];
  const transactionId = runtime?.delivery?.transactionId;
  if (!transactionId)
    throw new Error(`repository '${repository.id}' has no Land delivery transaction`);
  const journalPath = join(transactions, "repository-delivery",
    safeRepositoryId(repository.id), lifecycle.id, transactionId, "journal.json");
  const journal = readJson(journalPath, {});
  if (!journal || !["verified", "committed"].includes(journal.status) ||
      !Array.isArray(journal.entries))
    throw new Error(`repository '${repository.id}' has no verified Land journal`);
  const entries = changedLandEntries(repository.path, journal.entries, pathIdentity,
    ` in '${repository.id}'`);
  const roots = unique(entries.map((entry) => entry.path)).sort();
  return {
    version: 2,
    changeId: lifecycle.id,
    repositoryId: repository.id,
    baseHead: runtime.baseHead || journal.baseHead || null,
    sourceProjectionHash: runtime.delivery.projectionHash || journal.projectionHash,
    integrity: "land-bound",
    roots,
    entries: unique(roots.flatMap((path) => filesUnder(repository.path, path))).sort()
      .map((path) => deliveryProjectionEntry(repository.path, path, pathIdentity))
  };
}

export function deliveryProjection({ root, state, readJson, transactionJournalPath, pathIdentity }) {
  if (state.status !== "archived") {
    const error = new Error(`change '${state.id}' is not archived`);
    error.code = "DELIVERY_REQUIRES_ARCHIVED";
    throw error;
  }
  const transactionId = state.workspace?.apply?.transactionId;
  if (!transactionId) throw new Error(`archived change '${state.id}' has no applied projection`);
  const journal = readJson(transactionJournalPath(state.id, transactionId), {});
  if (!journal || !Array.isArray(journal.entries) || journal.status !== "committed")
    throw new Error(`archived change '${state.id}' has no committed apply journal`);
  const activeChange = `openspec/changes/${state.id}`;
  const productEntries = changedLandEntries(root,
    journal.entries.filter((entry) => entry.path !== activeChange), pathIdentity);
  const archive = clean(state.archivedChangePath);
  if (!archive || !existsSync(join(root, archive)))
    throw new Error(`archived OpenSpec packet for '${state.id}' is unavailable`);
  if (state.deliveryIntegrity?.version !== 2) {
    const error = new Error("Archived mode evidence is unavailable in this legacy change; automatic Deliver cannot reconstruct historical modes. Preserve the archived work and review the current diff for separately authorized Git publication.");
    error.code = "DELIVERY_MODE_EVIDENCE_UNAVAILABLE";
    throw error;
  }
  assertDeliveryEntries(root, state.deliveryIntegrity.entries, pathIdentity);
  const roots = unique([
    ...productEntries.map((entry) => entry.path),
    activeChange,
    archive,
    ...archivedSpecPaths(root, archive)
  ]).sort();
  const paths = unique(roots.flatMap((path) => filesUnder(root, path))).sort();
  const entries = paths.map((path) => deliveryProjectionEntry(root, path, pathIdentity));
  const projectionHash = state.workspace?.apply?.projectionHash || journal.projectionHash;
  return {
    version: 2,
    changeId: state.id,
    baseHead: state.workspace?.baseHead || journal.baseHead || null,
    sourceProjectionHash: projectionHash,
    integrity: "land-bound",
    roots,
    entries
  };
}

function gitOutput(git, args, cwd, label) {
  const result = git(args, cwd);
  if (result.status !== 0) throw new Error(`${label}: ${resultText(result)}`);
  return clean(result.stdout);
}

function deliveryEnvelope(changeId, action, fields = {}) {
  return { version: DELIVERY_PROTOCOL_VERSION, changeId, action, ...fields };
}

// A Deliver question in the blocked-decision shape: typed options with
// outcomes, a recommendation, and a preserved pause. `options` keeps the
// legacy id list for existing hosts.
function deliveryDecision(changeId, { boundary, reason, options, recommended, ...fields }) {
  const choices = [...options, ["pause", "Keep the current state and deliver nothing for now."]];
  return deliveryEnvelope(changeId, "ASK_USER", {
    completed: false, boundary, reason, ...fields,
    options: options.map(([id]) => id),
    decision: {
      kind: boundary, summary: reason,
      options: choices.map(([id, outcome]) => ({ id, outcome })),
      recommended: recommended || options[0][0]
    }
  });
}

// A remote or local delivery command that failed for a cause only the user
// can clear (a rejected credential such as a push 403, a full disk, a denied
// network) asks the user with that exact cause, through the same classifier
// and decision shape as `advance`. Anything else stays the operator's wait.
function userEnvironmentDecision(changeId, error, resumeCommand) {
  if (!["DELIVERY_PROVIDER_UNAVAILABLE", "DELIVERY_EXTERNAL_COMMAND_FAILED"].includes(error?.code))
    return null;
  const found = environmentCause({ codes: [...errorCodes(error), error.result?.error?.code],
    text: `${error.message}\n${resultText(error.result)}` });
  if (!found) return null;
  const summary = `${found.fix}. Only the user can clear this (${found.cause}): ${error.message}`;
  const value = deliveryDecision(changeId, {
    boundary: "user-environment", owner: "user", reason: summary, resumeCommand,
    options: [["fixed", `${found.fix}; then the agent runs '${resumeCommand}'.`]],
    recommended: "fixed"
  });
  return { ...value, decision: { ...value.decision, cause: found.cause, category: found.category,
    fix: found.fix, options: value.decision.options.map((option) =>
      option.id === "fixed" ? { ...option, command: resumeCommand } : option) } };
}

const LANDABLE_STATUSES = new Set(["proven", "applied"]);

function followUpNotice(followUp) {
  return followUp.mode === "update-existing"
    ? { mode: followUp.mode, of: followUp.of, url: followUp.url,
      notice: `Updated the existing pull request ${followUp.url} instead of opening a new one.` }
    : { mode: followUp.mode, of: followUp.of, ...(followUp.url ? { url: followUp.url } : {}),
      notice: followUp.notice };
}

export function createPullRequestRuntime({
  root,
  deliveriesRoot,
  loadRuntime,
  activeChangePath,
  proofPath,
  transactionJournalPath,
  pathIdentity,
  readJson,
  writeJson,
  stableHash,
  git,
  transactions = null,
  selectedRepositories = null,
  foundationPolicy = () => ({}),
  // `advance --through archived` for a proven change Deliver was invoked on.
  landChange = null,
  now = () => new Date().toISOString(),
  run = spawnSync,
  fail = (message) => { throw new Error(message); }
}) {
  const integrity = createDeliveryIntegrity({ git, run, runChecked, gitOutput });
  const statePath = (id) => join(deliveriesRoot, id, "state.json");
  const receiptPath = (id) => join(deliveriesRoot, id, "receipt.json");
  const bodyPath = (id) => join(deliveriesRoot, id, "pull-request.md");
  const eventsPath = (id) => join(deliveriesRoot, id, "events.jsonl");
  const workspacePath = (id) => join(deliveriesRoot, id, "workspace");
  const repositoryWorkspacePath = (id, repositoryId) => repositoryId === "root"
    ? workspacePath(id)
    : join(deliveriesRoot, id, "repositories", safeRepositoryId(repositoryId), "workspace");
  const repositoryBodyPath = (id, repositoryId) => repositoryId === "root"
    ? bodyPath(id)
    : join(deliveriesRoot, id, "repositories", safeRepositoryId(repositoryId), "pull-request.md");

  function saveDelivery(value) {
    value.updatedAt = now();
    writeJson(statePath(value.changeId), value);
    return value;
  }

  function loadDelivery(id) {
    return readJson(statePath(id), {
      version: DELIVERY_PROTOCOL_VERSION,
      changeId: id,
      status: "new",
      history: []
    });
  }

  function checkpoint(state, status, details = {}) {
    state.status = status;
    Object.assign(state, details);
    state.history = [...(state.history || []), { status, at: now() }].slice(-50);
    const saved = saveDelivery(state);
    appendEvent(state.changeId, { status, at: saved.updatedAt });
    return saved;
  }

  function appendEvent(changeId, fields) {
    mkdirSync(dirname(eventsPath(changeId)), { recursive: true });
    appendFileSync(eventsPath(changeId), `${JSON.stringify({ version: 1, changeId, ...fields })}\n`);
  }

  // The delivery workspace is harness-owned scratch until its branch is
  // pushed. Drift there (an interrupted attempt, a stray edit) is repaired by
  // rebuilding it once from the Land-bound projection, never by a new change.
  const UNPUBLISHED = ["binding-verified", "workspace-prepared", "commit-created"];
  function rebuildWorkspace(delivery, reason) {
    const workspace = delivery.workspace;
    if (workspace && existsSync(workspace)) {
      if (git(["worktree", "remove", "--force", workspace], root).status !== 0)
        rmSync(workspace, { recursive: true, force: true });
      git(["worktree", "prune"], root);
    }
    if (delivery.branch) git(["branch", "-D", delivery.branch], root);
    for (const key of ["workspace", "commit", "stagedPaths", "recovered"]) delete delivery[key];
    if (delivery.followUp) delete delivery.followUp.parent;
    return checkpoint(delivery, "binding-verified", {
      workspaceRebuilt: { at: now(), reason }
    });
  }

  function archivedSources(id, lifecycle) {
    const changeRoot = activeChangePath(id, lifecycle);
    const read = (name) => existsSync(join(changeRoot, name))
      ? readFileSync(join(changeRoot, name), "utf8") : "";
    return { proposal: read("proposal.md"), design: read("design.md"), tasks: read("tasks.md") };
  }

  function providerGitOutput(args, cwd, label) {
    try { return gitOutput(git, args, cwd, label); }
    catch (error) { throw providerUnavailable(error.message); }
  }

  function providerContext(policy, repositoryRoot = root) {
    const remoteUrl = providerGitOutput(["remote", "get-url", policy.remote], repositoryRoot,
      `cannot resolve Git remote '${policy.remote}'`);
    const remote = parseGitHubRemote(remoteUrl);
    if (!remote || (policy.provider !== "auto" && policy.provider !== "github"))
      throw providerUnavailable(`Deliver currently requires a GitHub remote; found '${remoteUrl}'`);
    if (!policy.allowedHosts.includes(remote.host))
      throw providerUnavailable(`Git remote host '${remote.host}' is not allowed by delivery policy`);
    const pushUrls = providerGitOutput(["remote", "get-url", "--push", "--all", policy.remote],
      repositoryRoot, "cannot resolve effective push remote").split("\n").filter(Boolean);
    if (!pushUrls.length || pushUrls.some((url) => {
      const destination = parseGitHubRemote(url);
      return !destination || destination.host !== remote.host ||
        destination.slug.toLowerCase() !== remote.slug.toLowerCase();
    })) throw providerUnavailable("Git push remote does not match the approved GitHub repository; correct the push URLs or URL rewrite rules and retry Deliver");
    // Query the remote: a cached origin/HEAD may be stale, and a configured PR
    // base is not authority to publish to the actual default branch.
    const heads = runChecked(run, "git", ["ls-remote", "--symref", policy.remote, "HEAD"],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 },
      "cannot determine remote default branch");
    const defaultBranch = String(heads.stdout).match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
    if (!defaultBranch) throw providerUnavailable("Git remote default branch is unavailable; restore remote access and retry Deliver");
    return { remote, remoteName: policy.remote, pushUrls: [...new Set(pushUrls)].sort(),
      defaultBranch, baseBranch: policy.defaultBaseBranch || defaultBranch };
  }

  function assertProviderBinding(expected, observed) {
    const identity = (value) => ({ remote: value.remote,
      remoteName: value.remoteName, baseBranch: value.baseBranch,
      ...(expected?.pushUrls ? { pushUrls: value.pushUrls } : {}) });
    if (expected && stableHash(identity(expected)) !== stableHash(identity(observed)))
      throw providerUnavailable("Git remote delivery binding changed; restore the approved remote, push URLs and base branch before retrying Deliver");
  }

  function assertDeliveryBranch(branch, provider) {
    if ([provider.baseBranch, provider.defaultBranch].includes(branch)) {
      const error = new Error(`delivery branch '${branch}' is the remote default or PR base branch; configure a feature branch and retry Deliver`);
      error.code = "DELIVERY_DEFAULT_BRANCH_FORBIDDEN";
      throw error;
    }
  }

  function prepareWorkspace(id, state, projection, branch, repositoryRoot = root,
    workspace = workspacePath(id), start = projection.baseHead) {
    const currentHead = gitOutput(git, ["rev-parse", "HEAD"], repositoryRoot,
      "cannot inspect target HEAD");
    // The delivery branch is built from the Land base and the proven content
    // is verified separately, so commits added on top of that base (the user
    // committing other work) do not change what is delivered. A rewritten
    // history — reset or rebase away from the base — still stops for a choice.
    const descendsFromBase = projection.baseHead && currentHead !== projection.baseHead &&
      git(["merge-base", "--is-ancestor", projection.baseHead, currentHead], repositoryRoot).status === 0;
    if (!projection.baseHead || (currentHead !== projection.baseHead && !descendsFromBase)) {
      const error = new Error(`target HEAD moved after Land (expected ${projection.baseHead || "unknown"}, observed ${currentHead})`);
      error.code = "DELIVERY_TARGET_MOVED";
      throw error;
    }
    if (!existsSync(workspace)) {
      mkdirSync(dirname(workspace), { recursive: true });
      const branchExists = git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repositoryRoot).status === 0;
      if (branchExists && state.branch === branch) {
        runChecked(run, "git", ["worktree", "add", workspace, branch],
          { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot restore delivery worktree");
      } else {
        runChecked(run, "git", ["worktree", "add", "--detach", workspace, start],
          { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot create delivery worktree");
        runChecked(run, "git", ["switch", "-c", branch],
          { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot create delivery branch");
        for (const path of projection.roots)
          copyEntry(join(repositoryRoot, path), join(workspace, path));
        if (repositoryRoot === root)
          rmSync(join(workspace, "openspec", "changes", id), { recursive: true, force: true });
      }
    }
    const observedBranch = gitOutput(git, ["branch", "--show-current"], workspace,
      "cannot inspect delivery branch");
    if (observedBranch !== branch)
      throw new Error(`delivery workspace uses unexpected branch '${observedBranch || "detached"}'`);
    return workspace;
  }

  function stageProjection(workspace, projection, gitlinks = []) {
    integrity.assertConversion(workspace, projection);
    const stageable = projection.roots.filter((path) => {
      if (lstatSync(join(workspace, path), { throwIfNoEntry: false })) return true;
      const tracked = git(["ls-files", "-z", "--", path], workspace);
      return tracked.status === 0 && Boolean(tracked.stdout);
    });
    if (!stageable.length) throw new Error("delivery projection has no stageable paths");
    const result = git(["add", "-A", "--", ...stageable], workspace);
    if (result.status !== 0) throw new Error(`cannot stage delivery projection: ${resultText(result)}`);
    for (const link of gitlinks) {
      const update = git(["update-index", "--add", "--cacheinfo",
        `160000,${link.commit},${link.path}`], workspace);
      if (update.status !== 0)
        throw new Error(`cannot stage delivered gitlink '${link.path}': ${resultText(update)}`);
    }
    const staged = gitOutput(git, ["diff", "--cached", "--name-only", "-z"], workspace,
      "cannot inspect staged projection").split("\0").filter(Boolean).sort();
    const allowedGitlinks = new Set(gitlinks.map((link) => link.path));
    const outside = staged.filter((path) => !allowedGitlinks.has(path) &&
      !projection.roots.some((rootPath) => path === rootPath || path.startsWith(`${rootPath}/`)));
    if (outside.length) throw new Error(`delivery staged paths outside the proven projection: ${outside.join(", ")}`);
    if (!staged.length) throw new Error("delivery projection produces no commit");
    integrity.assertTree(workspace, projection,
      gitOutput(git, ["write-tree"], workspace, "cannot inspect staged delivery tree"), gitlinks);
    return staged;
  }

  // Commit subject and branch from the project's `deliver` naming templates.
  // Both are settled before any workspace exists, so an invalid setting is
  // refused without a commit, push, or pull request.
  function namingValues(policy, id, narrative) {
    return deliveryNamingValues({ changeId: id, narrative, ticketPattern: policy.ticketPattern });
  }

  function commitSubject(policy, id, narrative) {
    return deliveryCommitSubject(policy.commitSubject, namingValues(policy, id, narrative));
  }

  function deliveryBranch(policy, id, narrative, repositoryRoot = root) {
    const branch = deliveryBranchName(policy.branchPattern, id, namingValues(policy, id, narrative));
    if (git(["check-ref-format", `refs/heads/${branch}`], repositoryRoot).status !== 0)
      throw namingInvalid(`deliver.branchPattern produces '${branch}', which git check-ref-format rejects`);
    return branch;
  }

  function createCommit(workspace, message) {
    runChecked(run, "git", ["commit", "-m", message],
      { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot create delivery commit");
    return gitOutput(git, ["rev-parse", "HEAD"], workspace, "cannot resolve delivery commit");
  }

  function recoverCommit(workspace, projection, gitlinks = []) {
    const head = gitOutput(git, ["rev-parse", "HEAD"], workspace,
      "cannot inspect delivery workspace HEAD");
    if (head === projection.baseHead) return null;
    const count = Number(gitOutput(git,
      ["rev-list", "--count", `${projection.baseHead}..${head}`], workspace,
      "cannot inspect delivery commit history"));
    if (count !== 1) throw workspaceDrift("delivery branch contains an unexpected commit history");
    const changed = gitOutput(git,
      ["diff", "--name-only", "-z", projection.baseHead, head], workspace,
      "cannot inspect recovered delivery commit").split("\0").filter(Boolean);
    const allowedGitlinks = new Set(gitlinks.map((link) => link.path));
    const outside = changed.filter((path) => !allowedGitlinks.has(path) &&
      !projection.roots.some((rootPath) => path === rootPath || path.startsWith(`${rootPath}/`)));
    if (outside.length)
      throw workspaceDrift(`delivery commit contains paths outside the proven projection: ${outside.join(", ")}`);
    const dirty = gitOutput(git, ["status", "--porcelain"], workspace,
      "cannot inspect recovered delivery workspace");
    const unexpectedDirty = dirty.split("\n").filter(Boolean).filter((line) => {
      const path = line.slice(3).split(" -> ").at(-1);
      return !allowedGitlinks.has(path);
    });
    if (unexpectedDirty.length)
      throw workspaceDrift("delivery workspace changed after its commit");
    return { commit: head, stagedPaths: changed, recovered: true };
  }

  function githubJson(args, failure, invalid, empty) {
    const result = run("gh", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw providerUnavailable(`${failure}: ${resultText(result)}`);
    try { return JSON.parse(result.stdout || empty); }
    catch { throw providerUnavailable(invalid); }
  }

  function findPullRequest(provider, branch, baseBranch) {
    const rows = githubJson(["pr", "list", "--repo", provider.remote.slug,
      "--head", branch, "--base", baseBranch, "--state", "open",
      "--json", "number,url,state,isDraft,headRefOid", "--limit", "10"],
    "cannot query pull requests", "GitHub returned invalid pull-request JSON", "[]");
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  function openPullRequest(provider, branch, narrative, body, draft,
    pullRequestBodyPath = bodyPath(narrative.changeId)) {
    mkdirSync(dirname(pullRequestBodyPath), { recursive: true });
    writeFileSync(pullRequestBodyPath, body);
    const args = ["pr", "create", "--repo", provider.remote.slug,
      "--head", branch, "--base", provider.baseBranch,
      "--title", narrative.title, "--body-file", pullRequestBodyPath];
    if (draft) args.push("--draft");
    const result = runChecked(run, "gh", args,
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, "cannot open pull request");
    return clean(result.stdout).split(/\s+/).find((value) => /^https:\/\//.test(value)) || null;
  }

  // `successors` are later commits this project's own follow-up deliveries
  // pushed onto the same pull request; a head at one of them still counts as
  // this delivery when the delivered commit remains in its history.
  function verifyPullRequest(provider, url, commit, successors = []) {
    if (!url) throw providerUnavailable("GitHub did not return a pull-request URL");
    const value = githubJson(["pr", "view", url, "--repo", provider.remote.slug,
      "--json", "number,url,state,isDraft,headRefName,baseRefName,headRefOid"],
    "cannot verify pull request", "GitHub returned invalid pull-request verification JSON", "{}");
    const followedUp = value.headRefOid !== commit && successors.includes(value.headRefOid) &&
      git(["merge-base", "--is-ancestor", commit, value.headRefOid], root).status === 0;
    if (value.state !== "OPEN" || (value.headRefOid !== commit && !followedUp) ||
        value.baseRefName !== provider.baseBranch)
      throw new Error("pull-request read-back does not match the delivered commit and base branch");
    if (!clean(value.url).startsWith(`https://${provider.remote.host}/`))
      throw new Error("pull-request URL is outside the approved Git host");
    return value;
  }

  function priorReceipts(id) {
    if (!existsSync(deliveriesRoot)) return [];
    return readdirSync(deliveriesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== id &&
        existsSync(receiptPath(entry.name)))
      .map((entry) => readJson(receiptPath(entry.name), null))
      .filter((receipt) => receipt?.version === DELIVERY_RECEIPT_SCHEMA_VERSION);
  }

  // Review follow-up: when the change cites exactly one pull request this
  // project delivered and that pull request is still open on the same base,
  // Deliver pushes to its branch (fast-forward only) and updates it instead
  // of opening a second one. Anything else opens a new pull request and says
  // why. The binding is checkpointed so a resumed delivery never re-decides.
  function bindFollowUp(id, provider, sources) {
    // A pull request carries its original delivery and every follow-up that
    // updated it; bind to the newest receipt in that chain, once per PR.
    const byPullRequest = new Map();
    for (const row of followUpDeliveryCandidates({
      changeId: id, ...sources, receipts: priorReceipts(id)
    })) {
      const key = pullRequestUrlKey(row.pullRequest?.url);
      byPullRequest.set(key, [...(byPullRequest.get(key) || []), row]);
    }
    const candidates = [...byPullRequest.values()].map((rows) => {
      const origin = rows.find((row) => row.followUp?.mode !== "update-existing") || rows[0];
      return followUpSuccessors(origin).at(-1) || origin;
    });
    if (candidates.length === 0) return null;
    if (candidates.length > 1) return {
      mode: "new-pull-request", of: candidates.map((row) => row.changeId).sort(),
      notice: "The change cites more than one delivered pull request; a new pull request was opened instead of guessing which to update."
    };
    const [original] = candidates;
    const current = githubJson(["pr", "view", original.pullRequest.url, "--repo", provider.remote.slug,
      "--json", "number,url,state,headRefName,baseRefName,headRefOid"],
    "cannot read the pull request this change follows up", "GitHub returned invalid pull-request JSON", "{}");
    const reusable = current.state === "OPEN" && current.headRefName === original.branch &&
      current.baseRefName === provider.baseBranch &&
      ![provider.baseBranch, provider.defaultBranch].includes(original.branch);
    if (!reusable) return {
      mode: "new-pull-request", of: original.changeId, url: original.pullRequest.url,
      notice: `The pull request ${original.pullRequest.url} is ${
        current.state === "OPEN" ? "no longer on its delivered branch and base"
          : String(current.state || "unavailable").toLowerCase()
      }; a new pull request was opened for this follow-up.`
    };
    return {
      mode: "update-existing", of: original.changeId, url: current.url || original.pullRequest.url,
      number: current.number ?? original.pullRequest.number, branch: original.branch
    };
  }

  function fetchFollowUpHead(workspace, provider, branch) {
    runChecked(run, "git", ["fetch", "--no-tags", provider.remoteName, `refs/heads/${branch}`],
      { cwd: workspace, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 },
      "cannot fetch the pull-request branch this change follows up");
    return gitOutput(git, ["rev-parse", "FETCH_HEAD^{commit}"], workspace,
      "cannot resolve the pull-request branch this change follows up");
  }

  function existingReceipt(id, lifecycle) {
    if (!existsSync(receiptPath(id))) return null;
    const receipt = readJson(receiptPath(id));
    if (!receipt) return null;
    if (receipt.version !== DELIVERY_RECEIPT_SCHEMA_VERSION ||
        receipt.changeId !== id || receipt.archivedAt !== lifecycle.archivedAt)
      return null;
    return receipt;
  }

  function archivedRepositories(id, lifecycle) {
    if (!selectedRepositories) return [{
      id: "root", path: root, mode: "write", dependsOn: [], relativePath: "."
    }];
    return selectedRepositories(id, lifecycle, fail, {
      changeDir: join(root, lifecycle.archivedChangePath), useTargetPaths: true
    }).filter((repository) => repository.mode === "write");
  }

  // Steps shared by single- and multi-repository delivery. Each path keeps its
  // own checkpoint and receipt shape; these helpers only do the work.
  function requestDelivery(delivery) {
    if (delivery.status === "new") checkpoint(delivery, "requested", {
      requestedAt: now(), authority: {
        kind: "explicit-deliver-command",
        allowed: ["create-feature-branch", "stage-proven-projection", "commit",
          "push-feature-branch", "open-or-update-pr"],
        forbidden: ["force-push", "push-default-branch", "merge", "deploy", "publish"]
      }
    });
  }

  function boundProjection(repository, lifecycle, saved) {
    return integrity.bindProjection(repository.path,
      (saved?.version === 2 ? saved : null) || (repository.id === "root"
        ? deliveryProjection({ root, state: lifecycle, readJson, transactionJournalPath, pathIdentity })
        : repositoryDeliveryProjection({ repository, lifecycle, transactions, readJson, pathIdentity })));
  }

  function presentation({ id, lifecycle, sources, proof, policy, narrative, paths }) {
    narrative ||= pullRequestNarrative({ changeId: id, state: lifecycle, ...sources, proof, paths });
    const evidence = deliveryEvidenceAssessment({ root, lifecycle, proof, narrative, readJson });
    if (!evidence.requiredComplete && policy.missingRequiredEvidence === "block") {
      const error = new Error(`required delivery evidence is incomplete: ${
        evidence.requiredIssues.join("; ")}`);
      error.code = "DELIVERY_EVIDENCE_BLOCKED";
      throw error;
    }
    narrative.quality = evidence.quality;
    narrative.presentationEvidence = {
      complete: evidence.presentationComplete, issue: evidence.presentationIssue
    };
    const draft = !evidence.presentationComplete &&
      policy.missingPresentationEvidence === "draft";
    const body = renderPullRequestBody(narrative, { draft });
    if (containsSecretMaterial(body))
      throw new Error("generated pull-request body appears to contain secret material");
    return { narrative, evidence, draft, body };
  }

  // Verifies a checkpointed commit (returning null) or recovers or creates it.
  function ensureCommit(workspace, projection, subject, existing, gitlinks, drift) {
    if (existing) {
      if (gitOutput(git, ["rev-parse", "HEAD"], workspace,
        "cannot verify delivery commit") !== existing) throw drift();
      return null;
    }
    const recovered = recoverCommit(workspace, projection, gitlinks);
    if (recovered) return recovered;
    const stagedPaths = stageProjection(workspace, projection, gitlinks);
    return { commit: createCommit(workspace, subject), stagedPaths };
  }

  // Never forced: a branch that moved after its head was fetched is refused
  // by the remote instead of overwritten.
  function pushCommit(policy, provider, workspace, commit, branch, label) {
    const currentProvider = providerContext(policy, workspace);
    assertProviderBinding(provider, currentProvider);
    assertDeliveryBranch(branch, currentProvider);
    runChecked(run, "git", ["push", "--set-upstream", provider.remoteName,
      `${commit}:refs/heads/${branch}`],
    { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, label);
  }

  function publishedPullRequest(provider, branch, previousUrl, commit, open) {
    const found = findPullRequest(provider, branch, provider.baseBranch);
    return verifyPullRequest(provider,
      found ? found.url || previousUrl || null : open(), commit);
  }

  // The chain of verified follow-up deliveries that updated this delivery's
  // pull request, each built directly on the commit before it.
  function followUpSuccessors(receipt) {
    const key = pullRequestUrlKey(receipt.pullRequest?.url);
    const updates = priorReceipts(receipt.changeId).filter((row) =>
      row.followUp?.mode === "update-existing" && !row.multiRepository && row.commit &&
      row.branch === receipt.branch && pullRequestUrlKey(row.pullRequest?.url) === key);
    const chain = [];
    for (let current = receipt; ;) {
      const next = updates.find((row) => row.followUp.of === current.changeId &&
        row.followUp.parent === current.commit && !chain.includes(row));
      if (!next) return chain;
      chain.push(next);
      current = next;
    }
  }

  function reusedPullRequests(policy, priorReceipt, repositories, delivery) {
    if (!priorReceipt.multiRepository) {
      const provider = providerContext(policy);
      assertProviderBinding(delivery.provider, provider);
      const successors = followUpSuccessors(priorReceipt);
      const verified = verifyPullRequest(provider, priorReceipt.pullRequest.url,
        priorReceipt.commit, successors.map((row) => row.commit));
      const index = successors.findIndex((row) => row.commit === verified.headRefOid);
      return [{ ...priorReceipt.pullRequest, ...verified,
        ...(index >= 0 ? { followedUpBy: successors.slice(0, index + 1).map((row) => row.changeId) } : {}) }];
    }
    const byId = new Map(repositories.map((repository) => [repository.id, repository]));
    return Object.entries(priorReceipt.repositories || {}).map(([repositoryId, record]) => {
      const repository = byId.get(repositoryId);
      if (!repository)
        throw new Error(`delivered repository '${repositoryId}' is no longer selected`);
      const provider = providerContext(policy, repository.path);
      const verified = verifyPullRequest(provider, record.pullRequest.url, record.commit);
      return { ...record.pullRequest, ...verified, repositoryId };
    });
  }

  async function advanceMulti(id, lifecycle, delivery, policy, repositories) {
    if (!transactions) throw new Error("multi-repository Deliver has no transaction store");
    requestDelivery(delivery);
    const ordered = repositoryDeliveryOrder(repositories);
    const rootRepository = ordered.find((row) => row.id === "root");
    const execution = [
      ...ordered.filter((row) => row.id !== "root"),
      ...(rootRepository ? [rootRepository] : [])
    ];
    const proof = readJson(proofPath(id), {});
    const sources = archivedSources(id, lifecycle);
    const completed = new Map();
    delivery.repositories ||= {};
    // Validate every selected projection and destination before any repository
    // publishes. A later invalid root must not leave earlier child PRs behind.
    const prepared = new Map();
    const repositoryPaths = (repository, projection) => projection.entries.map((entry) =>
      repository.id === "root" ? entry.path : `${repository.id}:${entry.path}`);
    for (const repository of execution) {
      const node = delivery.repositories[repository.id] || { status: "new" };
      const projection = boundProjection(repository, lifecycle, node.projection);
      const noChange = repository.id !== "root" && projection.roots.length === 0;
      const provider = noChange ? null : providerContext(policy, repository.path);
      // The same narrative presentation() settles below, so naming is
      // validated for every repository before any of them publishes.
      const naming = noChange ? null : node.narrative || pullRequestNarrative({
        changeId: id, state: lifecycle, ...sources, proof, paths: repositoryPaths(repository, projection)
      });
      const branch = node.branch || (noChange ? null : deliveryBranch(policy, id, naming, repository.path));
      const subject = noChange || node.commit ? null : commitSubject(policy, id, naming);
      if (provider) {
        assertProviderBinding(node.provider, provider);
        assertDeliveryBranch(branch, provider);
      }
      prepared.set(repository.id, { projection, provider, branch, subject });
    }

    for (const repository of execution) {
      let node = delivery.repositories[repository.id] || { status: "new" };
      const { projection, provider, branch, subject } = prepared.get(repository.id);
      if (repository.id !== "root" && projection.roots.length === 0) {
        delivery.repositories[repository.id] = {
          ...node, status: "no-change", projection,
          repository: { id: repository.id, path: repository.path }
        };
        checkpoint(delivery, "repositories-delivering");
        continue;
      }
      const { narrative, draft, body } = presentation({
        id, lifecycle, sources, proof, policy, narrative: node.narrative,
        paths: repositoryPaths(repository, projection)
      });
      const workspace = node.workspace || repositoryWorkspacePath(id, repository.id);
      const gitlinks = repository.id === "root" ? repositories
        .filter((row) => row.type === "submodule" && row.id !== "root" &&
          row.relativePath && completed.has(row.id))
        .map((row) => ({ path: row.relativePath, commit: completed.get(row.id).commit })) : [];

      if (!existsSync(workspace))
        prepareWorkspace(id, node, projection, branch, repository.path, workspace);
      node = { ...node, status: node.status === "new" ? "workspace-prepared" : node.status,
        workspace, branch, projection, narrative, draft, provider, repository: {
          id: repository.id, path: repository.path, relativePath: repository.relativePath || null
        } };
      delivery.repositories[repository.id] = node;
      checkpoint(delivery, "repositories-delivering");

      const made = ensureCommit(workspace, projection, subject, node.commit, gitlinks,
        () => new Error(`delivery workspace commit changed for repository '${repository.id}'`));
      if (made) {
        if (!made.recovered) node.stagedPaths = made.stagedPaths;
        node.commit = made.commit;
        node.status = "commit-created";
        checkpoint(delivery, "repositories-delivering");
      }
      const { commit } = node;
      integrity.assertTree(workspace, projection, commit, gitlinks);
      integrity.assertPullRequestBase(workspace, provider, projection);
      if (node.status === "commit-created") {
        pushCommit(policy, provider, workspace, commit, branch,
          `cannot push delivery branch for '${repository.id}'`);
        node.status = "branch-pushed";
        node.provider = provider;
        checkpoint(delivery, "repositories-delivering");
      }
      const pullRequest = publishedPullRequest(provider, branch, node.pullRequest?.url, commit,
        () => openPullRequest(provider, branch, narrative, body, draft,
          repositoryBodyPath(id, repository.id)));
      node.status = "verified";
      node.pullRequest = {
        provider: "github", repositoryId: repository.id, number: pullRequest.number,
        url: pullRequest.url, state: pullRequest.state, draft: Boolean(pullRequest.isDraft),
        headCommit: pullRequest.headRefOid, baseBranch: provider.baseBranch
      };
      checkpoint(delivery, "repositories-delivering");
      completed.set(repository.id, node);
    }

    const delivered = execution.filter((repository) =>
      delivery.repositories[repository.id]?.pullRequest);
    const pullRequests = delivered.map((repository) =>
      delivery.repositories[repository.id].pullRequest);
    const receipt = {
      version: DELIVERY_RECEIPT_SCHEMA_VERSION,
      changeId: id,
      archivedAt: lifecycle.archivedAt,
      multiRepository: true,
      pullRequests,
      repositories: Object.fromEntries(delivered.map((repository) => {
        const node = delivery.repositories[repository.id];
        return [repository.id, {
          commit: node.commit, branch: node.branch,
          projectionHash: stableHash(node.projection.entries),
          pullRequest: node.pullRequest
        }];
      })),
      verifiedAt: now()
    };
    writeJson(receiptPath(id), receipt);
    checkpoint(delivery, "verified", { receiptDigest: stableHash(receipt) });
    return deliveryEnvelope(id, "DONE", {
      completed: true, reached: "pr-opened", reused: false, pullRequests
    });
  }

  // Invoking Deliver on a proven change is the user's authority to Land it
  // first: the normal `advance --through archived` route lands (issuing its
  // grant under this invocation), then delivery continues in the same call.
  async function landThenDeliver(id) {
    saveDelivery({ ...loadDelivery(id), landAuthority: {
      kind: "explicit-deliver-command", requestedAt: now()
    } });
    const landed = await landChange(id);
    if (loadRuntime(id).status !== "archived")
      return deliveryEnvelope(id, landed?.action && landed.action !== "DONE" ? landed.action : "WAIT", {
        completed: false, boundary: landed?.boundary || "land",
        reason: landed?.reason || "Land has not reached archived yet.",
        land: landed || null, resumeCommand: `claude-foundation deliver advance ${id}`
      });
    const delivered = await advance(id);
    return { ...delivered, land: { reached: "archived", authority: "explicit-deliver-command" } };
  }

  async function advance(id) {
    const lifecycle = loadRuntime(id);
    if (lifecycle.status !== "archived") {
      if (landChange && LANDABLE_STATUSES.has(lifecycle.status)) return landThenDeliver(id);
      return deliveryDecision(id, {
        boundary: "change-not-proven",
        reason: `Deliver needs a proven change; '${id}' is ${lifecycle.status || "not started"}.`,
        options: [["finish-build-and-prove-then-deliver",
          `Finish Build and Prove with 'claude-foundation advance ${id} --through archived', then run Deliver again.`]],
        resumeCommand: `claude-foundation deliver advance ${id}`
      });
    }
    let delivery = loadDelivery(id);
    try {
      const policy = deliveryPolicy(foundationPolicy());
      const repositories = archivedRepositories(id, lifecycle);
      const priorReceipt = existingReceipt(id, lifecycle);
      // A receipt written before multi-repository support has no
      // `multiRepository` flag and stays readable for idempotent reuse.
      const multi = repositories.length > 1 || repositories.some((row) => row.id !== "root");
      if (priorReceipt?.multiRepository || (priorReceipt && !multi))
        return deliveryEnvelope(id, "DONE", {
          completed: true, reached: "pr-opened", reused: true,
          pullRequests: reusedPullRequests(policy, priorReceipt, repositories, delivery)
        });
      if (multi) return await advanceMulti(id, lifecycle, delivery, policy, repositories);
      const provider = providerContext(policy);
      assertProviderBinding(delivery.provider, provider);
      requestDelivery(delivery);
      const projection = boundProjection({ id: "root", path: root }, lifecycle, delivery.projection);
      const binding = {
        archivedAt: lifecycle.archivedAt,
        proofRunId: lifecycle.land?.proofRunId || null,
        preArchiveWorkspaceHash: lifecycle.preArchiveWorkspaceHash || null,
        sourceProjectionHash: projection.sourceProjectionHash,
        targetHead: projection.baseHead
      };
      const bindingDigest = stableHash(binding);
      if (delivery.bindingDigest && delivery.bindingDigest !== bindingDigest)
        throw new Error("delivery binding changed after preparation");
      if (!["workspace-prepared", "commit-created", "branch-pushed", "pr-opened"].includes(delivery.status))
        delivery = checkpoint(delivery, "binding-verified", { binding, bindingDigest, projection });
      const sources = archivedSources(id, lifecycle);
      const proof = readJson(proofPath(id), {});
      const { narrative, evidence, draft, body } = presentation({
        id, lifecycle, sources, proof, policy, narrative: delivery.narrative,
        paths: projection.entries.map((entry) => entry.path)
      });
      const branch = delivery.branch || deliveryBranch(policy, id, narrative);
      // A follow-up's commit uses the same subject template as any delivery.
      const subject = delivery.commit ? null : commitSubject(policy, id, narrative);
      assertDeliveryBranch(branch, provider);
      if (!delivery.provider) delivery = checkpoint(delivery, delivery.status, { provider });
      if (delivery.followUp === undefined)
        delivery = checkpoint(delivery, delivery.status, {
          // A delivery already under way keeps the branch it started on.
          followUp: delivery.workspace || delivery.commit ? null : bindFollowUp(id, provider, sources)
        });
      const followUp = delivery.followUp?.mode === "update-existing" ? delivery.followUp : null;
      // The remote branch receiving the commit. A follow-up publishes onto the
      // pull request it continues; its local branch keeps this change's name.
      const pushBranch = followUp ? followUp.branch : branch;
      assertDeliveryBranch(pushBranch, provider);
      let workspace = delivery.workspace;
      if (!workspace || !existsSync(workspace)) {
        if (followUp && !followUp.parent) {
          followUp.parent = fetchFollowUpHead(root, provider, followUp.branch);
          delivery = checkpoint(delivery, delivery.status);
        }
        workspace = prepareWorkspace(id, delivery, projection, branch, root, workspacePath(id),
          followUp ? followUp.parent : projection.baseHead);
        delivery = checkpoint(delivery, "workspace-prepared", { workspace, branch, narrative, draft });
      }
      // Tree and history checks compare against the commit the delivery
      // builds on: the Land base, or the followed pull request's head.
      const parentProjection = followUp ? { ...projection, baseHead: followUp.parent } : projection;
      const made = ensureCommit(workspace, parentProjection, subject, delivery.commit, [],
        () => workspaceDrift("delivery workspace commit changed after checkpoint"));
      if (made) delivery = checkpoint(delivery, "commit-created", made);
      const { commit } = delivery;
      integrity.assertTree(workspace, parentProjection, commit);
      integrity.assertPullRequestBase(workspace, provider, projection);
      if (delivery.status === "commit-created") {
        pushCommit(policy, provider, workspace, commit, pushBranch, "cannot push delivery branch");
        delivery = checkpoint(delivery, "branch-pushed", { pushedAt: now(), provider });
      }
      const pullRequest = publishedPullRequest(provider, pushBranch, delivery.pullRequest?.url, commit,
        () => openPullRequest(provider, pushBranch, narrative, body, draft));
      delivery = checkpoint(delivery, "pr-opened", { pullRequest });
      const receipt = {
        version: DELIVERY_RECEIPT_SCHEMA_VERSION,
        changeId: id,
        archivedAt: lifecycle.archivedAt,
        bindingDigest,
        projectionHash: stableHash(projection.entries),
        commit,
        branch: pushBranch,
        baseBranch: provider.baseBranch,
        ...(delivery.followUp ? { followUp: delivery.followUp } : {}),
        pullRequest: {
          provider: "github",
          number: pullRequest.number,
          url: pullRequest.url,
          state: pullRequest.state,
          draft: Boolean(pullRequest.isDraft),
          headCommit: pullRequest.headRefOid
        },
        evidence: {
          requiredComplete: evidence.requiredComplete,
          presentationComplete: evidence.presentationComplete
        },
        quality: evidence.quality,
        verifiedAt: now()
      };
      writeJson(receiptPath(id), receipt);
      checkpoint(delivery, "verified", { receiptDigest: stableHash(receipt) });
      return deliveryEnvelope(id, "DONE", {
        completed: true, reached: followUp ? "pr-updated" : "pr-opened", reused: false,
        pullRequests: [receipt.pullRequest],
        ...(delivery.followUp ? { followUp: followUpNotice(delivery.followUp) } : {})
      });
    } catch (error) {
      delivery.lastError = { message: error.message, code: error.code || "DELIVERY_FAILED", at: now() };
      saveDelivery(delivery);
      appendEvent(id, { status: "failed", code: delivery.lastError.code, at: delivery.lastError.at });
      const resumeCommand = `claude-foundation deliver advance ${id}`;
      if (error.stage === "delivery-workspace" && !delivery.repositories &&
          UNPUBLISHED.includes(delivery.status) && !delivery.workspaceRebuilt) {
        rebuildWorkspace(delivery, error.message);
        return advance(id);
      }
      if (error.stage === "delivery-workspace")
        return deliveryDecision(id, {
          boundary: "delivery-workspace", owner: "repository-operator",
          reason: `${error.message}; a rebuilt delivery workspace still differs from the proven ` +
            "content, usually because a repository commit hook rewrites staged files",
          options: [
            ["fix-the-repository-hook-and-retry-deliver", "Stop the hook from rewriting staged files, then retry Deliver."],
            ["leave-archived-without-deliver", "Keep the change archived and open no pull request."]
          ],
          resumeCommand
        });
      if (["DELIVERY_PROJECTION_DRIFT", "DELIVERY_TARGET_MOVED", "DELIVERY_PR_BASE_DRIFT"].includes(error.code))
        return deliveryDecision(id, {
          boundary: "content-identity", reason: error.message,
          options: [
            ["restore-the-proven-content-and-retry-deliver", "Restore the proven content or Land base, then retry Deliver."],
            ["leave-archived-without-deliver", "Keep the change archived and open no pull request."]
          ],
          resumeCommand
        });
      if (error.code === "DELIVERY_EVIDENCE_BLOCKED")
        return deliveryDecision(id, {
          boundary: "required-evidence", reason: error.message,
          options: [
            ["create-a-follow-up-change-with-required-evidence", "Produce the missing required evidence in a follow-up change, then deliver."],
            ["cancel-delivery", "Keep the change archived and open no pull request."]
          ]
        });
      if (error.code === "DELIVERY_MODE_EVIDENCE_UNAVAILABLE")
        return deliveryDecision(id, {
          boundary: "legacy-mode-evidence", reason: error.message,
          options: [
            ["review-current-diff-for-separate-git-publication", "Review the current diff for a separately authorized Git publication."],
            ["leave-archived-without-deliver", "Keep the change archived and open no pull request."]
          ]
        });
      if (error.code === "DELIVERY_CONVERSION_UNSUPPORTED")
        return deliveryDecision(id, {
          boundary: "git-conversion", owner: "repository-operator", reason: error.message,
          options: [
            ["review-converted-content-for-separate-git-publication", "Review the converted content for a separately authorized Git publication."],
            ["leave-archived-without-deliver", "Keep the change archived and open no pull request."]
          ]
        });
      if (error.code === "DELIVERY_CONVERSION_CHANGED")
        return deliveryEnvelope(id, "WAIT", {
          completed: false, boundary: "git-conversion", owner: "repository-operator",
          reason: error.message, resumeCommand
        });
      if (error.code === "DELIVERY_NAMING_INVALID")
        return deliveryEnvelope(id, "WAIT", {
          completed: false, boundary: "delivery-policy", owner: "repository-operator",
          reason: error.message, resumeCommand
        });
      if (error.code === "DELIVERY_DEFAULT_BRANCH_FORBIDDEN")
        return deliveryEnvelope(id, "WAIT", {
          completed: false, boundary: "delivery-policy", owner: "repository-operator",
          reason: error.message
        });
      const userEnvironment = userEnvironmentDecision(id, error, resumeCommand);
      if (userEnvironment) return userEnvironment;
      if (error.code === "DELIVERY_PROVIDER_UNAVAILABLE")
        return deliveryEnvelope(id, "WAIT", {
          completed: false, boundary: "external-owner", owner: "repository-operator",
          reason: error.message, resumeCommand,
          wait: { owner: "repository-operator", checkCommand: resumeCommand,
            condition: `The repository operator makes the remote or provider available: ${error.message}` }
        });
      fail(error.message);
    }
  }

  async function showAdvance(id) {
    const value = await advance(id);
    console.log(JSON.stringify(value, null, 2));
    return value;
  }

  return { advance, showAdvance, statePath, receiptPath, bodyPath, eventsPath, workspacePath };
}
