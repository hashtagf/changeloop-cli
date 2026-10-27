import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { sortedJson } from "../core/trust.mjs";
import { inspectRepositoryIntelligence } from "./validation/repository-intelligence.mjs";
import {
  investigationDiscoveryExclusions, isInvestigationReport, writeInvestigationReport
} from "./investigation-report.mjs";
import {
  inspectSemanticSources, semanticSourceInventoryFindings
} from "./validation/semantic-source-inventory.mjs";

import {
  intakeTemplate, intakeSnapshot, intakeIssues, intakeFrontier, intakeReadinessIssues
} from "./validation/investigation-intake.mjs";

export const INVESTIGATION_STATE_VERSION = 2;
const OUTCOMES = new Set([
  "investigating", "needs-user-decision", "ready-for-change", "not-worth-changing"
]);
const HYPOTHESIS_STATUSES = new Set(["open", "supported", "falsified"]);
const DECISION_STATUSES = new Set(["open", "resolved"]);
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const text = (value) => typeof value === "string" ? value.trim() : "";
const strings = (value) => Array.isArray(value)
  ? value.map(text).filter(Boolean) : [];
const unique = (values) => [...new Set(values)].sort();

// `save` leads because the host refuses a shell-written JSON record, while the
// file tool falls under the seeded `Edit(/openspec/investigations/**)` rule;
// the record tolerates the note when the whole template is saved.
export function investigationRecordTemplate() {
  return {
    save: "Write this record with the Write tool to openspec/investigations/<id>.json " +
      "and keep it there; that path is pre-allowed and the tool creates the folder. Do not save it through the shell " +
      "(heredoc, cat >, echo >): the host refuses those. After each evidence batch run " +
      "claude-foundation investigate openspec/investigations/<id>.json.",
    version: 2,
    ...intakeTemplate(),
    id: "replace-with-investigation-id",
    activeChange: null,
    problem: "Describe the uncertainty or decision to investigate",
    mode: "analyze",
    sources: [],
    facts: [],
    hypotheses: [],
    options: [],
    selection: null,
    decisions: [],
    conclusion: { summary: "Investigation is in progress" },
    changeIntent: null
  };
}

function digest(value, domain = "foundation-investigation:1") {
  return createHash("sha256").update(`${domain}\0`)
    .update(sortedJson(value)).digest("hex");
}

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function safeExistingFile(root, declaredPath) {
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, declaredPath);
  if (!within(canonicalRoot, absolute) || !existsSync(absolute)) return null;
  let canonical;
  try { canonical = realpathSync(absolute); }
  catch { return null; }
  if (canonical !== absolute || !within(canonicalRoot, canonical)) return null;
  const stat = lstatSync(absolute);
  return stat.isFile() && !stat.isSymbolicLink() ? absolute : null;
}

function safeStateDirectory(root) {
  const canonicalRoot = realpathSync(resolve(root));
  const foundation = join(canonicalRoot, ".foundation");
  if (existsSync(foundation) && realpathSync(foundation) !== foundation) return null;
  mkdirSync(foundation, { recursive: true });
  const directory = join(foundation, "investigations");
  if (existsSync(directory) && realpathSync(directory) !== directory) return null;
  mkdirSync(directory, { recursive: true });
  return realpathSync(directory) === directory ? directory : null;
}

function repositoryQuery(record) {
  return [record?.problem, record?.changeIntent,
    ...(record?.facts || []).map((row) => row?.statement),
    ...(record?.hypotheses || []).map((row) => row?.statement)];
}

const isOpen = (row) => text(row?.status).toLowerCase() === "open";

// The harness derives the outcome a record omits: open decisions always mean
// needs-user-decision, and a settled record with a changeIntent concludes as
// ready-for-change in the same run. Explicit legacy values remain accepted.
export function derivedConclusionStatus(record) {
  const declared = text(record?.conclusion?.status).toLowerCase();
  if (record?.version === 2) {
    if (declared === "not-worth-changing") return declared;
    const frontier = intakeFrontier(record);
    if (frontier.open.some((q) => q.material) || frontier.unresolved.length)
      return "needs-user-decision";
    if (frontier.staleExperiments.some((e) => e.material) || frontier.pendingExperiments.length)
      return "investigating";
  }
  if ((Array.isArray(record?.decisions) ? record.decisions : []).some(isOpen))
    return "needs-user-decision";
  if (declared && declared !== "needs-user-decision") return declared;
  return text(record?.changeIntent) ? "ready-for-change" : "investigating";
}

function recordIssues(record) {
  const issues = [];
  if (!record || typeof record !== "object" || Array.isArray(record))
    return ["investigation record must be an object"];
  if (![1, 2].includes(record.version)) issues.push("investigation record version must be 1|2");
  if (!ID_PATTERN.test(text(record.id)))
    issues.push("investigation record id must be a lowercase kebab-case identifier");
  if (!text(record.problem)) issues.push("investigation record problem is required");
  if (record.activeChange !== undefined && record.activeChange !== null &&
      !ID_PATTERN.test(text(record.activeChange)))
    issues.push("investigation record activeChange must be a lowercase kebab-case change id");
  const mode = text(record.mode).toLowerCase();
  if (!new Set(["analyze", "compare"]).has(mode))
    issues.push("investigation record mode must be analyze|compare");
  if (!Array.isArray(record.sources)) issues.push("investigation record sources must be an array");
  if (strings(record.sources).some(isInvestigationReport))
    issues.push("generated investigation reports are presentation, not investigation sources");
  if (!Array.isArray(record.facts)) issues.push("investigation record facts must be an array");
  if (!Array.isArray(record.hypotheses))
    issues.push("investigation record hypotheses must be an array");
  if (!Array.isArray(record.decisions)) issues.push("investigation record decisions must be an array");
  const factKeys = new Set();
  for (const [index, fact] of (record.facts || []).entries()) {
    const label = `facts[${index}]`;
    const key = text(fact?.key);
    if (!key) issues.push(`${label}.key is required`);
    else if (factKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    factKeys.add(key);
    if (!text(fact?.statement)) issues.push(`${label}.statement is required`);
    if (!strings(fact?.sources).length) issues.push(`${label}.sources must ground the fact`);
  }
  const hypothesisKeys = new Set();
  const experiments = new Map((Array.isArray(record.experiments) ? record.experiments : [])
    .filter((row) => text(row?.key)).map((row) => [text(row.key), row]));
  for (const [index, hypothesis] of (record.hypotheses || []).entries()) {
    const label = `hypotheses[${index}]`;
    const key = text(hypothesis?.key);
    const status = text(hypothesis?.status).toLowerCase();
    if (!key) issues.push(`${label}.key is required`);
    else if (hypothesisKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    hypothesisKeys.add(key);
    if (!text(hypothesis?.statement)) issues.push(`${label}.statement is required`);
    if (!HYPOTHESIS_STATUSES.has(status))
      issues.push(`${label}.status must be open|supported|falsified`);
    const evidence = strings(hypothesis?.factKeys);
    if (status !== "open" && !evidence.length)
      issues.push(`${label}.factKeys must support a settled hypothesis`);
    for (const key of evidence)
      if (!factKeys.has(key)) issues.push(`${label}.factKeys references unknown fact '${key}'`);
    // experimentKeys is optional and v2-only; a v1 record keeps its prior validation.
    if (record.version !== 2 || hypothesis?.experimentKeys === undefined) continue;
    const name = key || label;
    if (!Array.isArray(hypothesis.experimentKeys) ||
        hypothesis.experimentKeys.some((value) => typeof value !== "string" || !text(value))) {
      issues.push(`hypothesis '${name}' experimentKeys must be an array of experiment keys`);
      continue;
    }
    for (const experimentKey of strings(hypothesis.experimentKeys)) {
      const experiment = experiments.get(experimentKey);
      if (!experiment)
        issues.push(`hypothesis '${name}' experimentKeys references unknown experiment '${experimentKey}'`);
      else if (text(experiment.supersededBy))
        issues.push(`hypothesis '${name}' experimentKeys references superseded experiment ` +
          `'${experimentKey}'; reference its replacement '${text(experiment.supersededBy)}'`);
    }
  }
  const decisionKeys = new Set();
  for (const [index, decision] of (record.decisions || []).entries()) {
    const label = `decisions[${index}]`;
    const key = text(decision?.key);
    const status = text(decision?.status).toLowerCase();
    if (!key) issues.push(`${label}.key is required`);
    else if (decisionKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    decisionKeys.add(key);
    if (!DECISION_STATUSES.has(status)) issues.push(`${label}.status must be open|resolved`);
    if (status === "open") {
      if (!text(decision?.question)) issues.push(`${label}.question is required`);
      if (unique(strings(decision?.alternatives)).length < 2)
        issues.push(`${label}.alternatives must contain at least two choices`);
      if (!text(decision?.recommended)) issues.push(`${label}.recommended is required`);
      if (!strings(decision?.recommendationFactKeys).length)
        issues.push(`${label}.recommendationFactKeys must ground the recommendation`);
    } else if (!text(decision?.choice) || !text(decision?.reason)) {
      issues.push(`${label}.choice and .reason are required when resolved`);
    }
    for (const factKey of strings(decision?.recommendationFactKeys))
      if (!factKeys.has(factKey))
        issues.push(`${label}.recommendationFactKeys references unknown fact '${factKey}'`);
  }
  const declaredOutcome = text(record.conclusion?.status).toLowerCase();
  if (declaredOutcome && !OUTCOMES.has(declaredOutcome))
    issues.push("conclusion.status must be investigating|needs-user-decision|ready-for-change|not-worth-changing");
  const outcome = derivedConclusionStatus(record);
  if (!text(record.conclusion?.summary)) issues.push("conclusion.summary is required");
  if (outcome === "ready-for-change" && !text(record.changeIntent))
    issues.push("changeIntent is required for a ready-for-change investigation");
  if (mode === "compare") {
    if ((record.options || []).length < 3 || (record.options || []).length > 5)
      issues.push("compare mode requires three to five options");
    const optionKeys = new Set();
    for (const [index, option] of (record.options || []).entries()) {
      const label = `options[${index}]`;
      const key = text(option?.key);
      if (!key) issues.push(`${label}.key is required`);
      else if (optionKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
      optionKeys.add(key);
      if (!text(option?.summary)) issues.push(`${label}.summary is required`);
      if (!strings(option?.findings).length) issues.push(`${label}.findings is required`);
      if (!strings(option?.tradeoffs).length) issues.push(`${label}.tradeoffs is required`);
      if (!strings(option?.sources).length) issues.push(`${label}.sources is required`);
      for (const path of strings(option?.prototypePaths)) {
        const normalized = posix.normalize(path.replaceAll("\\", "/"));
        if (!normalized.startsWith(`.foundation/prototypes/${text(record.id)}/`))
          issues.push(`${label}.prototypePaths must stay under .foundation/prototypes/${text(record.id)}/`);
      }
    }
    if (outcome !== "investigating") {
      const selected = text(record.selection?.optionKey);
      if (!selected || !optionKeys.has(selected))
        issues.push("selection.optionKey must name a compared option");
      if (!text(record.selection?.reason)) issues.push("selection.reason is required");
      const rejected = Array.isArray(record.selection?.rejected) ? record.selection.rejected : [];
      const rejectedKeys = new Set(rejected.map((row) => text(row?.optionKey)));
      for (const optionKey of optionKeys)
        if (optionKey !== selected && !rejectedKeys.has(optionKey))
          issues.push(`selection.rejected must explain option '${optionKey}'`);
      for (const [index, row] of rejected.entries())
        if (!optionKeys.has(text(row?.optionKey)) || !text(row?.reason))
          issues.push(`selection.rejected[${index}] requires a known option and reason`);
    }
  }
  return unique(issues);
}

function stateProjection(state) {
  return {
    version: state.version,
    id: state.id,
    requestDigest: state.requestDigest,
    sourceInventoryDigest: state.sourceInventory?.digest || null,
    status: state.status,
    workspace: state.workspace || null,
    repository: state.repository,
    facts: state.facts,
    hypotheses: state.hypotheses,
    options: state.options,
    selection: state.selection,
    decisions: state.decisions,
    conclusion: state.conclusion,
    changeIntent: state.changeIntent,
    metrics: state.metrics,
    ...(state.version === 2 ? { intake: state.intake, validatedIntake: state.validatedIntake } : {})
  };
}

export function investigationStateDigest(state) {
  return digest(stateProjection(state), "foundation-investigation-state:1");
}

function bindingFor(state) {
  return {
    version: state.version,
    id: state.id,
    statePath: state.path,
    stateDigest: state.stateDigest,
    sourceDigest: state.sourceInventory.digest,
    workspace: state.workspace || null,
    outcome: state.conclusion.status,
    summary: state.conclusion.summary,
    changeIntent: state.changeIntent || null,
    ...(state.version === 2 ? {
      intake: state.intake,
      intakeDigest: digest(state.intake, "foundation-investigation-intake:2")
    } : {})
  };
}

function activeWorkspace(projectRoot, changeId, git = null) {
  if (!changeId) return { root: projectRoot, binding: null, issues: [] };
  const runtimePath = join(projectRoot, ".foundation", "runtime", `${changeId}.json`);
  if (!existsSync(runtimePath) || !lstatSync(runtimePath).isFile() ||
      lstatSync(runtimePath).isSymbolicLink()) return {
    root: null, binding: null,
    issues: [`active change '${changeId}' runtime state is missing or unsafe`]
  };
  let runtime;
  try { runtime = JSON.parse(readFileSync(runtimePath, "utf8")); }
  catch { return { root: null, binding: null,
    issues: [`active change '${changeId}' runtime state is unreadable`] }; }
  if (["applied", "archived"].includes(text(runtime.status).toLowerCase()))
    return { root: null, binding: null,
      issues: [`active change '${changeId}' has already entered Land`] };
  const workspace = runtime.workspace || {};
  if (!["worktree", "copy"].includes(workspace.mode) || !text(workspace.path))
    return { root: null, binding: null,
      issues: [`active change '${changeId}' does not have an isolated Build sandbox`] };
  const declared = resolve(workspace.path);
  let sourceRoot;
  try {
    if (!existsSync(declared) || !lstatSync(declared).isDirectory() ||
        lstatSync(declared).isSymbolicLink()) throw new Error("missing");
    sourceRoot = realpathSync(declared);
  } catch {
    return { root: null, binding: null,
      issues: [`active change '${changeId}' sandbox is missing or unsafe`] };
  }
  if (sourceRoot === projectRoot) return { root: null, binding: null,
    issues: [`active change '${changeId}' is not bound to an isolated Build sandbox`] };
  let head = null;
  if (workspace.mode === "worktree") {
    const result = typeof git === "function" ? git(["rev-parse", "HEAD"], sourceRoot) : null;
    head = result?.status === 0 ? text(result.stdout) : null;
    if (!head) return { root: null, binding: null,
      issues: [`active change '${changeId}' worktree identity is stale or unreadable`] };
  }
  const identityInput = {
    changeId,
    mode: workspace.mode,
    sourceRoot,
    baseHead: workspace.baseHead || null,
    head,
    baselineDigest: workspace.mode === "copy"
      ? digest(workspace.baseline || {}, "foundation-investigation-copy-baseline:1") : null
  };
  return {
    root: sourceRoot,
    binding: { version: 1, ...identityInput,
      identity: digest(identityInput, "foundation-investigation-workspace:1") },
    issues: []
  };
}

export function validateInvestigationBinding({ projectRoot, binding, git = null } = {}) {
  const issues = [];
  const root = realpathSync(resolve(projectRoot));
  if (!binding || ![1, 2].includes(binding.version)) return ["investigation binding version must be 1|2"];
  const bindingId = text(binding.id);
  if (!ID_PATTERN.test(bindingId)) return ["investigation binding id is invalid"];
  const expectedPath = `.foundation/investigations/${bindingId}.json`;
  if (text(binding.statePath) !== expectedPath)
    issues.push(`investigation binding statePath must be '${expectedPath}'`);
  const path = safeExistingFile(root, text(binding.statePath));
  if (!path || !within(join(root, ".foundation", "investigations"), path))
    return unique([...issues, "investigation binding state is missing or unsafe"]);
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { return unique([...issues, "investigation binding state is unreadable"]); }
  if (![1, 2].includes(state.version) || state.version !== binding.version || state.status !== "DONE" ||
      state.conclusion?.status !== "ready-for-change")
    issues.push("investigation binding must reference a ready-for-change DONE state");
  if (state.version === 2 && (
      digest(state.intake, "foundation-investigation-intake:2") !== binding.intakeDigest ||
      sortedJson(state.intake) !== sortedJson(binding.intake)))
    issues.push("investigation binding intake digest or content is stale or mismatched");
  let sourceRoot = root;
  let workspaceCurrent = true;
  if (state.workspace) {
    const current = activeWorkspace(root, state.workspace.changeId, git);
    if (current.issues.length) {
      workspaceCurrent = false;
      issues.push(...current.issues);
    }
    else {
      sourceRoot = current.root;
      if (current.binding.identity !== state.workspace.identity ||
          current.binding.sourceRoot !== state.workspace.sourceRoot ||
          current.binding.baseHead !== state.workspace.baseHead)
        issues.push("investigation binding sandbox identity or base is stale");
    }
  }
  if (state.id !== binding.id || investigationStateDigest(state) !== binding.stateDigest ||
      state.stateDigest !== binding.stateDigest)
    issues.push("investigation binding state digest is stale or mismatched");
  const inventoryIssues = semanticSourceInventoryFindings(state.sourceInventory);
  if (inventoryIssues.length)
    issues.push("investigation binding source inventory is invalid or noncanonical");
  else if (state.sourceInventory.digest !== binding.sourceDigest)
    issues.push("investigation binding source digest is stale or mismatched");
  else if (workspaceCurrent) {
    const freshness = inspectSemanticSources({
      projectRoot: sourceRoot,
      sourcePaths: (state.sourceInventory?.sources || []).map((row) => row.path),
      baseline: state.sourceInventory
    });
    if (freshness.findings.length || freshness.staleFindings.length)
      issues.push("investigation binding sources changed after the investigation completed");
  }
  if (state.conclusion?.status !== binding.outcome)
    issues.push("investigation binding outcome does not match machine state");
  if (state.conclusion?.summary !== binding.summary ||
      (state.changeIntent || null) !== (binding.changeIntent || null))
    issues.push("investigation binding handoff content does not match machine state");
  if (digest(state.workspace || null, "foundation-investigation-workspace-binding:1") !==
      digest(binding.workspace || null, "foundation-investigation-workspace-binding:1"))
    issues.push("investigation binding workspace does not match machine state");
  const requestPath = safeExistingFile(root, text(state.requestPath));
  if (!requestPath) issues.push("investigation binding request is missing or unsafe");
  else if (workspaceCurrent) {
    try {
      const record = JSON.parse(readFileSync(requestPath, "utf8"));
      if (digest(record, "foundation-investigation-record:1") !== state.requestDigest) {
        issues.push("investigation binding request changed after the investigation completed");
      } else {
        const excludedPaths = unique([state.requestPath, state.path,
          ...investigationDiscoveryExclusions(sourceRoot, strings(record.sources))]);
        let includedPaths = null;
        let trackedPaths = [];
        if (typeof git === "function") {
          const tracked = git(["ls-files", "-z"], sourceRoot);
          const included = git([
            "ls-files", "-z", "--cached", "--others", "--exclude-standard"
          ], sourceRoot);
          if (tracked.status === 0 && included.status === 0) {
            trackedPaths = tracked.stdout.split("\0").filter(Boolean);
            includedPaths = included.stdout.split("\0").filter(Boolean)
              .filter((candidate) => !excludedPaths.includes(candidate) &&
                !candidate.startsWith(".foundation/"));
          }
        }
        const repository = inspectRepositoryIntelligence({
          projectRoot: sourceRoot,
          query: repositoryQuery(record),
          seedPaths: strings(record.sources),
          includedPaths,
          trackedPaths,
          excludedPaths,
          limits: { maxReadSet: 24 }
        });
        const selected = (repository.readSet || []).map((row) => row.path);
        if (repository.status !== "ready" ||
            JSON.stringify(selected) !== JSON.stringify(state.repository?.selectedSources || []))
          issues.push("investigation binding repository discovery is stale or incomplete");
      }
    } catch { issues.push("investigation binding request is unreadable"); }
  }
  return unique(issues);
}

export function createInvestigationRuntime({
  root, readJson, writeJson, now, fail, git = null, setOperationChangeId = null
} = {}) {
  const projectRoot = realpathSync(resolve(root));
  const statePath = (id) => join(projectRoot, ".foundation", "investigations",
    `${id}.json`);

  function repositoryPaths(excludedPaths, repositoryRoot = projectRoot) {
    if (typeof git !== "function") return {
      includedPaths: null, trackedPaths: [], excludedPaths
    };
    const tracked = git(["ls-files", "-z"], repositoryRoot);
    const included = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      repositoryRoot);
    if (tracked.status !== 0 || included.status !== 0) return {
      includedPaths: null, trackedPaths: [], excludedPaths
    };
    return {
      trackedPaths: tracked.stdout.split("\0").filter(Boolean),
      includedPaths: included.stdout.split("\0").filter(Boolean)
        .filter((path) => !excludedPaths.includes(path) && !path.startsWith(".foundation/")),
      excludedPaths
    };
  }

  function inspectInvestigation(recordPath) {
    const absolute = safeExistingFile(projectRoot, recordPath);
    if (!absolute)
      fail("investigate requires a regular JSON record inside the project");
    const record = readJson(absolute);
    const issues = recordIssues(record);
    const id = text(record?.id) || "invalid";
    const path = statePath(id);
    const previous = existsSync(path) ? readJson(path) : null;
    const retainedIssues = intakeIssues(record, previous?.validatedIntake);
    if (record?.version !== 2 && previous?.validatedIntake)
      retainedIssues.push("intake version cannot downgrade retained v2 history; restore the v2 record");
    issues.push(...retainedIssues, ...intakeReadinessIssues(record));
    const workspace = activeWorkspace(projectRoot, text(record?.activeChange), git);
    if (workspace.binding && typeof setOperationChangeId === "function")
      setOperationChangeId(workspace.binding.changeId);
    issues.push(...workspace.issues);
    const sourceRoot = workspace.root;
    const resume = `claude-foundation investigate ${recordPath}`;
    const relativeRecord = relative(projectRoot, absolute).replaceAll("\\", "/");
    const relativeState = `.foundation/investigations/${id}.json`;
    const paths = sourceRoot
      ? repositoryPaths(unique([relativeRecord, relativeState,
        ...investigationDiscoveryExclusions(sourceRoot, strings(record?.sources))]), sourceRoot)
      : { includedPaths: [], trackedPaths: [], excludedPaths: [] };
    const repository = sourceRoot ? inspectRepositoryIntelligence({
      projectRoot: sourceRoot,
      query: repositoryQuery(record),
      seedPaths: strings(record?.sources).filter((path) => !isInvestigationReport(path)),
      includedPaths: paths.includedPaths,
      trackedPaths: paths.trackedPaths,
      excludedPaths: paths.excludedPaths,
      limits: { maxReadSet: 24 }
    }) : {
      version: 1, status: "blocked", complete: false,
      scan: { entries: 0, files: 0, bytes: 0 }, findings: [], readSet: []
    };
    // Discovered sources are acknowledged automatically and hashed with the
    // declared ones; facts and options must still cite an inventoried source.
    const discovered = (repository.readSet || []).map((row) => row.path);
    const declared = strings(record?.sources).filter((path) => !isInvestigationReport(path));
    const inventoried = new Set(sourceRoot && repository.status === "ready"
      ? [...declared, ...discovered] : declared);
    const sourceInspection = inspectSemanticSources({
      projectRoot: sourceRoot || projectRoot,
      sourcePaths: sourceRoot && repository.status === "ready" ? unique([...inventoried]) : []
    });
    const cited = new Set();
    for (const [kind, rows] of [["fact", record?.facts], ["option", record?.options]])
      for (const row of Array.isArray(rows) ? rows : [])
        for (const source of strings(row?.sources)) {
          cited.add(source);
          if (!inventoried.has(source))
            issues.push(`${kind} '${text(row?.key) || "(missing)"}' cites source '${source}' ` +
              "outside the investigation inventory; add it to sources");
        }
    const unreadSources = discovered.filter((path) => !cited.has(path) && !declared.includes(path));
    const harnessIssues = [...workspace.issues];
    issues.push(...sourceInspection.findings.map((row) =>
      `investigation source ${row.code}: ${row.path || "(unknown)"}`));
    if (repository.status !== "ready") {
      const discoveryIssues = repository.findings.map((row) =>
        `repository discovery ${row.code}: ${row.path || "(root)"}`);
      issues.push(...discoveryIssues);
      harnessIssues.push(...discoveryIssues);
    }

    const openHypotheses = (record?.hypotheses || []).filter(isOpen);
    const openDecisions = (record?.decisions || []).filter(isOpen);
    const outcome = derivedConclusionStatus(record);
    const frontier = intakeFrontier(record);
    // A missing, stale, or unreadable Build sandbox is a harness fault: the
    // record cannot repair it, so it goes to the harness on the first run. A
    // change that already entered Land is a stale record binding instead.
    const sandboxIssues = workspace.issues.filter((issue) => !/already entered Land/.test(issue));
    let action;
    if (sandboxIssues.length) action = {
      action: "EDIT", owner: "harness", boundary: "investigation-workspace",
      reason: "The active change's Build sandbox is missing, stale, or unreadable; " +
        "repair the harness or sandbox, then rerun the same record.",
      investigation: { kind: "repair-harness", issues: unique(sandboxIssues),
        recordIssues: unique(issues.filter((issue) => !sandboxIssues.includes(issue))) }, resume
    };
    else if (issues.length) action = { action: "EDIT", owner: "agent", boundary: "investigation-record",
      reason: "Repair the investigation record and evidence bindings.",
      investigation: { kind: "repair-record", issues: unique(issues) }, resume };
    else if (outcome === "not-worth-changing" && !(record.facts || []).length) action = {
      action: "EDIT", owner: "agent", boundary: "source-investigation",
      reason: "Ground the no-change conclusion without asking irrelevant requirement questions.",
      investigation: { kind: "record-facts" }, resume
    };
    else if (outcome === "not-worth-changing") action = {
      action: "DONE", owner: "harness", boundary: "investigation",
      reason: "Investigation is complete without proposing a change.", resume
    };
    else if (frontier.questions.length || frontier.unresolved.length) action = {
      action: "ASK_USER", owner: "user", boundary: "consequential-semantics",
      reason: "Clarify only the material meaning; independent work may continue.",
      decision: { kind: "investigation-requirement", items: [
        ...frontier.questions.map((q) => ({ key: q.key, question: q.question,
          alternatives: q.alternatives || [], recommended: q.recommended || null })),
        ...frontier.unresolved.map((r) => ({ key: r.key,
          question: `Clarify the intended meaning of: ${r.statement}`, alternatives: [] }))
      ].slice(0, 3) }, resume
    };
    else if (frontier.staleExperiments.some((e) => e.material)) action = {
      action: "EDIT", owner: "agent", boundary: "experiment-review",
      reason: "Reassess only experiments affected by changed requirements.",
      investigation: { kind: "review-experiments",
        keys: frontier.staleExperiments.filter((e) => e.material).map((e) => e.key) }, resume
    };
    else if (frontier.pendingExperiments.length) action = {
      action: "EDIT", owner: "agent", boundary: "experiment-execution",
      reason: "Complete the material feasibility experiments before proposing the agreement.",
      investigation: { kind: "run-experiments", keys: frontier.pendingExperiments.map((e) => e.key) }, resume
    };
    else if (!(record.facts || []).length) action = {
      action: "EDIT", owner: "agent", boundary: "source-investigation",
      reason: "Record at least one source-grounded verified fact.",
      investigation: { kind: "record-facts" }, resume
    };
    else if (openHypotheses.length) action = {
      action: "EDIT", owner: "agent", boundary: "hypothesis-testing",
      reason: "Test or falsify the remaining hypotheses from repository evidence.",
      investigation: { kind: "test-hypotheses", keys: openHypotheses.map((row) => row.key) }, resume
    };
    else if (openDecisions.length) action = {
      action: "ASK_USER", owner: "user", boundary: "consequential-semantics",
      reason: "Repository evidence cannot settle these consequential choices.",
      decision: { kind: "investigation-decision", items: openDecisions.slice(0, 3).map((row) => ({
        key: row.key, question: row.question, alternatives: unique(strings(row.alternatives)),
        recommended: row.recommended, recommendationFactKeys: unique(strings(row.recommendationFactKeys))
      })) }, resume
    };
    else if (outcome === "investigating") action = {
      action: "EDIT", owner: "agent", boundary: "investigation-synthesis",
      reason: "Synthesize the settled evidence into a terminal investigation conclusion.",
      investigation: { kind: "conclude" }, resume
    };
    else if (outcome === "needs-user-decision") action = {
      action: "EDIT", owner: "agent", boundary: "investigation-questions",
      reason: "A material question is blocked and cannot be asked yet; " +
        "answer, defer, or unlink the questions it depends on.",
      investigation: { kind: "resolve-blocked-questions",
        keys: (frontier.open || []).filter((q) => q.material).map((q) => q.key) }, resume
    };
    else action = { action: "DONE", owner: "harness", boundary: "investigation",
      reason: "The investigation is source-grounded and has a terminal conclusion.", resume };

    const requestDigest = digest(record, "foundation-investigation-record:1");
    const progressDigest = digest({ requestDigest, source: sourceInspection.inventory?.digest,
      action: action.action, kind: action.investigation?.kind || action.decision?.kind || null });
    const noProgressCount = previous?.progressDigest === progressDigest && action.action !== "DONE"
      ? Number(previous.noProgress?.count || 0) + 1 : action.action === "DONE" ? 0 : 1;
    // Repeated no-progress reaches the user only when the repeated action was
    // itself a user question; harness or sandbox faults stay with the harness
    // and record or evidence stalls stay with the agent.
    if (noProgressCount >= 3 && action.action !== "DONE") {
      const repeated = { action: action.action,
        kind: action.investigation?.kind || action.decision?.kind || null };
      if (action.action === "ASK_USER") action = {
        action: "ASK_USER", owner: "user", boundary: "repeated-no-progress",
        reason: "The same investigation question remained unanswered three times.",
        decision: {
          kind: "repair-no-progress",
          recommended: "answer",
          options: [
            { id: "answer", outcome: "Answer the pending investigation decision." },
            { id: "pause", outcome: "Preserve state and pause the investigation." }
          ],
          items: action.decision?.items || []
        },
        resume
      };
      else if (harnessIssues.length) action = {
        action: "EDIT", owner: "harness", boundary: "repeated-no-progress",
        reason: "The investigation workspace or repository discovery failed the same way " +
          "three times; repair the harness or sandbox, then rerun the same record.",
        investigation: { kind: "repair-harness", issues: unique(harnessIssues), repeated }, resume
      };
      else action = {
        action: "EDIT", owner: "agent", boundary: "repeated-no-progress",
        reason: "The investigation produced the same unresolved result three times; " +
          "change the evidence strategy before rerunning.",
        investigation: { kind: "change-strategy", issues: unique(issues), repeated }, resume
      };
    }
    if (record?.version === 2) {
      action.independentWork = frontier.independentWork;
      action.pendingQuestions = frontier.open;
      action.staleExperiments = frontier.staleExperiments.map((e) => e.key);
    }
    const state = {
      version: record?.version === 2 || previous?.validatedIntake ? INVESTIGATION_STATE_VERSION : 1,
      ...(record?.version === 2 || previous?.validatedIntake ? {
        intake: record?.version === 2 ? intakeSnapshot(record) : previous.intake,
        validatedIntake: retainedIssues.length ? previous?.validatedIntake || null
          : intakeSnapshot(record)
      } : {}),
      kind: "investigation",
      id,
      path: relativeState,
      status: action.action,
      revision: Number(previous?.revision || 0) + 1,
      updatedAt: now(),
      requestPath: relativeRecord,
      requestDigest,
      progressDigest,
      sourceInventory: sourceInspection.inventory,
      workspace: workspace.binding,
      repository: {
        complete: repository.complete,
        scan: repository.scan,
        selectedSources: discovered,
        unreadSources,
        findings: repository.findings
      },
      facts: record?.facts || [],
      hypotheses: record?.hypotheses || [],
      options: record?.options || [],
      selection: record?.selection || null,
      decisions: record?.decisions || [],
      conclusion: record?.conclusion ? { ...record.conclusion, status: outcome } : null,
      changeIntent: text(record?.changeIntent) || null,
      action,
      noProgress: {
        count: noProgressCount,
        boundaryReached: noProgressCount >= 3,
        resume
      },
      metrics: {
        inspections: Number(previous?.metrics?.inspections || 0) + 1,
        selectedSourceCount: discovered.length,
        selectedSourceBytes: (repository.readSet || []).reduce((sum, row) => sum + row.bytes, 0),
        factCount: (record?.facts || []).length,
        supportedHypothesisCount: (record?.hypotheses || []).filter((row) =>
          text(row?.status).toLowerCase() === "supported").length,
        falsifiedHypothesisCount: (record?.hypotheses || []).filter((row) =>
          text(row?.status).toLowerCase() === "falsified").length,
        openDecisionCount: openDecisions.length,
        userDecisionRounds: Number(previous?.metrics?.userDecisionRounds || 0) +
          (action.action === "ASK_USER" ? 1 : 0)
      }
    };
    state.stateDigest = investigationStateDigest(state);
    const directory = safeStateDirectory(projectRoot);
    if (!directory || dirname(path) !== directory)
      fail("investigate state directory is unsafe");
    writeJson(path, state);
    const handoff = action.action === "DONE" && state.conclusion?.status === "ready-for-change"
      ? bindingFor(state) : null;
    const report = writeInvestigationReport({ projectRoot, sourceRoot, record, state, validationIssues: unique(issues) });
    const presentation = report.status === "current" ? action : {
      action: "EDIT", owner: "harness", boundary: "investigation-report",
      reason: `Investigation state is preserved, but the readable report is unavailable: ${report.reason}`,
      resume, investigation: { kind: "regenerate-report", outcome: action.action }
    };
    // The persisted status must match what was presented: a report failure
    // never leaves a DONE state that a Change handoff binding would accept.
    if (presentation !== action) {
      state.status = presentation.action;
      state.action = presentation;
      state.stateDigest = investigationStateDigest(state);
      writeJson(path, state);
    }
    const result = { ...presentation, state: { path: relative(projectRoot, path).replaceAll("\\", "/"),
      revision: state.revision, digest: state.stateDigest }, noProgress: state.noProgress,
      metrics: state.metrics, handoff: report.status === "current" ? handoff : null, report };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  return { inspectInvestigation, investigationRecordTemplate };
}
