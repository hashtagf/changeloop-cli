import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { auditTraceability } from "../evidence/traceability.mjs";
import { detectEvidenceWiring } from "../evidence/evidence-bootstrap.mjs";
import { nextAfterValidate } from "../core/next-step.mjs";
import {
  taskBlocks, taskMetadata
} from "../contracts/change-artifacts.mjs";
import { createSpecDeltaValidator } from "./validation/spec-delta.mjs";

// Module scope, taking `fail` explicitly: the check has no runtime state and
// the deterministic tests exercise it against a stubbed CLI.
export function assertOpenSpecStrictValid(id, dir, fail) {
  // dir is <projectRoot>/openspec/changes/<id> for both the root and the
  // sandbox copy, so the CLI runs against whichever tree is being validated.
  const projectRoot = resolve(dir, "..", "..", "..");
  const probe = spawnSync("openspec", ["--version"], {
    cwd: projectRoot, encoding: "utf8", timeout: 15_000
  });
  if (probe.error || probe.status !== 0) {
    console.error("WARNING: OpenSpec CLI unavailable; strict spec lint deferred to Land, which requires it");
    return;
  }
  const lint = spawnSync("openspec",
    ["validate", id, "--type", "change", "--strict", "--json", "--no-interactive"],
    { cwd: projectRoot, encoding: "utf8", timeout: 60_000 });
  if (lint.error || lint.status !== 0) {
    const detail = `${lint.stdout || ""}\n${lint.stderr || ""}`.trim().slice(0, 4000);
    fail(`OpenSpec strict validation failed for '${id}'; repair the spec delta wording before Prove:\n${detail}`);
  }
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
  fail
}) {
  // `dir` is an override for the one case where the ledger is no longer at the
  // active path: an archive that moved the change directory and then failed.
  function pendingTasks(id, dir = activeChangePath(id)) {
    const path = join(dir, "tasks.md");
    if (!existsSync(path)) return [];
    return taskBlocks(readFileSync(path, "utf8")).filter((task) => !task.done);
  }

  const {
    assertNewCapabilitiesAreAdditive,
    assertNoDroppedScenarios,
    changeSpecScenarios,
    droppedScenarioFindings,
    newCapabilityOperationFindings
  } = createSpecDeltaValidator({ root, activeChangePath, walk, fail });

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
    const required = state.schema === "foundation-rapid"
      ? ["proposal.md", "tasks.md", "evidence.yaml"]
      : ["proposal.md", "design.md", "tasks.md", "evidence.yaml"];
    if (state.groundingRequired) required.push("grounding.yaml");
    // `repositories.yaml` sits in both schemas' `apply.requires` and is written
    // by `createChange`, but nothing checked it here: deleting the file passed
    // `change validate` and only failed later, inside Land, where the recovery
    // is expensive. Gated with `execution.yaml` because the two arrived
    // together in the version-2 packet.
    if (Number(state.version || 1) >= 2)
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
    ["template angle marker", /<(?:Problem|Observable|Only load-bearing|choice|constraint|meaningful alternative|Public contracts|risk|mitigation|provider|name|stable scenario name|action or event|Explicitly excluded|code, API|semantic boundary|path or surface|focused check)[^>]*>/i],
    ["template removal comment", /<!--[\s\S]*?(?:delete when unused|include the complete modified requirement|name removed behavior)[\s\S]*?-->/i]
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
      for (const [label, pattern] of scaffoldPatterns)
        if (pattern.test(content)) findings.push(`${name}: ${label}`);
    }
    if (findings.length)
      fail(`change artifacts still contain scaffold or unresolved content: ${findings.join("; ")}`);
  }

  function groundingValue(id, state, dir) {
    if (!state.groundingRequired) return null;
    const groundingPath = join(dir, "grounding.yaml");
    let value;
    try {
      value = JSON.parse(readFileSync(groundingPath, "utf8"));
    } catch {
      fail(`${id}/grounding.yaml must be JSON-compatible YAML`);
    }
    if (![1, 2].includes(value.version))
      fail(`${id}/grounding.yaml requires version 1 or 2`);
    if (Number(state.groundingVersion || 1) >= 2 && value.version !== 2)
      fail(`${id}/grounding.yaml requires version 2 for this change; migrate all newly material decisions in one Decision Sheet`);
    const groundingDigest = stableHash(value);
    if (state.groundingDigest && state.groundingDigest !== groundingDigest)
      fail(`${id}/grounding.yaml changed after its decision batch was locked; ` +
        `use change resolve ${id} --reopen-grounding --decision-ref <ref> ` +
        "--reopen-reason <reason> for one batched revision, or retire and replace the change");
    const firstLock = !state.groundingDigest;
    const decision = value.decisionBatch || {};
    if (decision.status !== "locked")
      fail(`${id}/grounding.yaml decisionBatch.status must be locked`);
    if (!["prd", "backlog", "user-batch", "recommended-default", "mixed"].includes(decision.source))
      fail(`${id}/grounding.yaml decisionBatch.source must be prd|backlog|user-batch|recommended-default|mixed`);
    if (!String(decision.reference || "").trim())
      fail(`${id}/grounding.yaml decisionBatch.reference is required`);
    if (!["single-batch", "no-material-questions"].includes(decision.mode))
      fail(`${id}/grounding.yaml decisionBatch.mode must be single-batch|no-material-questions`);
    if (!Number.isFinite(Date.parse(String(decision.lockedAt || ""))))
      fail(`${id}/grounding.yaml decisionBatch.lockedAt must be an ISO-8601 timestamp`);
    if (!Array.isArray(decision.decisions) || decision.decisions.length === 0)
      fail(`${id}/grounding.yaml decisionBatch.decisions must record every locked choice/default`);
    const decisionIds = new Set();
    for (const [index, row] of decision.decisions.entries()) {
      const label = `${id}/grounding.yaml decisionBatch.decisions[${index}]`;
      if (!["prd", "backlog", "user-batch", "recommended-default"].includes(row.source))
        fail(`${label}.source must be prd|backlog|user-batch|recommended-default`);
      for (const field of ["id", "question", "answer"])
        if (!String(row[field] || "").trim()) fail(`${label}.${field} is required`);
      if (decisionIds.has(row.id)) fail(`${label}.id is duplicated`);
      decisionIds.add(row.id);
    }

    if (!Array.isArray(value.readSet) || value.readSet.length === 0)
      fail(`${id}/grounding.yaml readSet must be non-empty`);

    if (value.version === 2) {
      const risk = value.risk || {};
      if (!["low", "medium", "high"].includes(risk.tier))
        fail(`${id}/grounding.yaml risk.tier must be low|medium|high`);
      if (!Array.isArray(risk.classes) || risk.classes.length === 0 ||
          risk.classes.some((entry) => !String(entry || "").trim()))
        fail(`${id}/grounding.yaml risk.classes must be a non-empty string array`);
      if (!String(risk.rationale || "").trim())
        fail(`${id}/grounding.yaml risk.rationale is required`);
      const routedTier = reviewPolicy(id, state, evidence(id, dir)).tier;
      const rank = { low: 0, medium: 1, high: 2 };
      if (rank[risk.tier] < rank[routedTier])
        fail(`${id}/grounding.yaml risk.tier '${risk.tier}' understates the deterministic review tier '${routedTier}'`);

      const conditional = (name, valueRow, listName) => {
        const label = `${id}/grounding.yaml ${name}`;
        if (!["applicable", "not-applicable"].includes(valueRow?.status))
          fail(`${label}.status must be applicable|not-applicable`);
        if (!String(valueRow?.sourceReason || "").trim())
          fail(`${label}.sourceReason is required even when the section is N/A`);
        if (!Array.isArray(valueRow?.[listName]))
          fail(`${label}.${listName} must be an array`);
        if (valueRow.status === "applicable" && valueRow[listName].length === 0)
          fail(`${label}.${listName} must be non-empty when applicable`);
      };
      conditional("productionEntry", value.productionEntry, "paths");
      conditional("realWire", value.realWire, "contracts");
      conditional("activationSemantics", value.activationSemantics, "activatedPaths");
      if (!Array.isArray(value.activationSemantics?.failureSemanticChanges))
        fail(`${id}/grounding.yaml activationSemantics.failureSemanticChanges must be an array`);
      conditional("serviceInteractions", value.serviceInteractions, "rows");
      conditional("observability", value.observability, "rows");

      const v2Contract = evidence(id, dir);
      const v2Capabilities = new Set(v2Contract.claims
        .flatMap((claim) => claim.capabilities || []));
      const riskClasses = new Set((risk.classes || [])
        .map((entry) => String(entry).toLowerCase()));
      const semantics = `${state.intent || ""} ${[...riskClasses].join(" ")}`.toLowerCase();
      const selected = selectedRepositories(id, state);
      const mandatoryService = state.coupling === "coupled" || selected.length > 1 ||
        ["cross-repo-contract", "integration", "live", "queue", "resilience"]
          .some((capability) => v2Capabilities.has(capability)) ||
        /\b(queue|broker|rabbit|kafka|event|callback|consumer|producer)\w*\b/.test(semantics);
      const mandatoryWire = mandatoryService ||
        ["compatibility", "browser"].some((capability) => v2Capabilities.has(capability)) ||
        /\b(wire|contract|http|api|json|message|payload)\w*\b/.test(semantics);
      const mandatoryActivation = [...riskClasses].some((entry) =>
        ["legacy", "activation", "cutover"].some((token) => entry.includes(token))) ||
        /\b(activat|cutover|enable existing|wire existing|turn on)\w*\b/.test(semantics);
      if (value.productionEntry.status !== "applicable")
        fail(`${id}/grounding.yaml productionEntry cannot be N/A for an implementation claim`);
      if (mandatoryWire && value.realWire.status !== "applicable")
        fail(`${id}/grounding.yaml realWire is required by the declared contract/integration risk`);
      if (mandatoryActivation && value.activationSemantics.status !== "applicable")
        fail(`${id}/grounding.yaml activationSemantics is required when existing behavior is activated or cut over`);
      if (mandatoryService && value.serviceInteractions.status !== "applicable")
        fail(`${id}/grounding.yaml serviceInteractions is required by the declared cross-service/queue surface`);
      if (mandatoryService && value.observability.status !== "applicable")
        fail(`${id}/grounding.yaml observability is required for every declared service interaction`);

      const v2Repositories = new Map(selected.map((repository) =>
        [repository.id, repository]));
      const resolveRows = (name, rows, allowedRoles) => {
        for (const [index, source] of rows.entries()) {
          const label = `${id}/grounding.yaml ${name}[${index}]`;
          const repository = v2Repositories.get(source?.repository || "root");
          const sourcePath = String(source?.path || "");
          if (!repository) fail(`${label} references an unselected repository`);
          if (!sourcePath || isAbsolute(sourcePath))
            fail(`${label}.path must be repository-relative`);
          const absolute = resolve(repository.workspacePath, sourcePath);
          if (!pathInside(repository.workspacePath, absolute) || !existsSync(absolute))
            fail(`${label}.path does not resolve inside repository '${repository.id}'`);
          if (!value.readSet.some((row) =>
            (row.repository || "root") === repository.id && row.path === sourcePath &&
            allowedRoles.includes(row.role)))
            fail(`${label} must appear in readSet with role ${allowedRoles.join("|")}`);
        }
      };
      resolveRows("productionEntry.paths", value.productionEntry.paths || [],
        ["production-path", "runtime-path"]);
      resolveRows("realWire.contracts", value.realWire.contracts || [],
        ["contract", "test-topology"]);
      resolveRows("activationSemantics.activatedPaths",
        value.activationSemantics.activatedPaths || [],
        ["production-path", "runtime-path"]);

      const interactionIds = new Set();
      for (const [index, row] of (value.serviceInteractions?.rows || []).entries()) {
        const label = `${id}/grounding.yaml serviceInteractions.rows[${index}]`;
        for (const field of [
          "id", "owner", "producer", "consumer", "contract", "delivery",
          "timeoutRetry", "idempotency", "ordering", "consistency",
          "rollout", "rollback"
        ])
          if (!String(row?.[field] || "").trim()) fail(`${label}.${field} is required`);
        if (interactionIds.has(row.id)) fail(`${label}.id is duplicated`);
        interactionIds.add(row.id);
      }
      const observedInteractions = new Set();
      for (const [index, row] of (value.observability?.rows || []).entries()) {
        const label = `${id}/grounding.yaml observability.rows[${index}]`;
        for (const field of [
          "interactionId", "correlation", "structuredEvents", "sli",
          "alert", "runbook", "operatorQuestion"
        ])
          if (!String(row?.[field] || "").trim()) fail(`${label}.${field} is required`);
        if (row.interactionId !== "local" && !interactionIds.has(row.interactionId))
          fail(`${label}.interactionId does not reference a service interaction`);
        observedInteractions.add(row.interactionId);
      }
      if (value.serviceInteractions?.status === "applicable")
        for (const interactionId of interactionIds)
          if (!observedInteractions.has(interactionId))
            fail(`${id}/grounding.yaml observability must cover interaction '${interactionId}'`);
      if (!Array.isArray(value.criticalCases) || !Array.isArray(value.mutants))
        fail(`${id}/grounding.yaml criticalCases and mutants must be arrays`);
      const criticalIds = new Set();
      for (const [index, row] of value.criticalCases.entries()) {
        const label = `${id}/grounding.yaml criticalCases[${index}]`;
        if (!String(row?.id || "").trim() || criticalIds.has(row.id))
          fail(`${label}.id must be non-empty and unique`);
        if (!Array.isArray(row.claimIds) || row.claimIds.length === 0)
          fail(`${label}.claimIds must be non-empty`);
        if (!["production-entry", "real-wire", "contract-oracle", "failure-path"]
          .includes(row.oracle))
          fail(`${label}.oracle is invalid`);
        criticalIds.add(row.id);
      }
      const mutantIds = new Set();
      for (const [index, row] of value.mutants.entries()) {
        const label = `${id}/grounding.yaml mutants[${index}]`;
        if (!String(row?.id || "").trim() || mutantIds.has(row.id))
          fail(`${label}.id must be non-empty and unique`);
        if (!Array.isArray(row.claimIds) || row.claimIds.length === 0 ||
            !String(row.class || "").trim())
          fail(`${label} requires claimIds and class`);
        if (!criticalIds.has(row.killerCaseId))
          fail(`${label}.killerCaseId must name a critical case`);
        mutantIds.add(row.id);
      }
    }

    const repositories = new Map(selectedRepositories(id, state)
      .map((repository) => [repository.id, repository]));
    const roles = new Set([
      "requirement", "backlog", "architecture", "contract", "composition-root",
      "runtime-path", "production-path", "test-topology", "dependency-source", "history"
    ]);
    const immutableRoles = new Set([
      "requirement", "backlog", "architecture", "contract", "dependency-source", "history"
    ]);
    for (const [index, source] of value.readSet.entries()) {
      const label = `${id}/grounding.yaml readSet[${index}]`;
      const repository = repositories.get(source.repository || "root");
      if (!repository) fail(`${label} references an unselected repository`);
      if (!roles.has(source.role)) fail(`${label}.role is invalid`);
      if (!["full", "targeted"].includes(source.mode)) fail(`${label}.mode must be full|targeted`);
      const sourcePath = String(source.path || "");
      if (!sourcePath || isAbsolute(sourcePath)) fail(`${label}.path must be repository-relative`);
      const absolute = resolve(repository.workspacePath, sourcePath);
      if (!pathInside(repository.workspacePath, absolute) || !existsSync(absolute))
        fail(`${label}.path does not resolve inside repository '${repository.id}'`);
      if (!/^[a-f0-9]{64}$/i.test(String(source.sha256 || "")))
        fail(`${label}.sha256 must be a SHA-256 hex digest`);
      // Check the real source while locking. Production sources are expected to
      // change in Build; the immutable groundingDigest below keeps their
      // *baseline* hashes from being rewritten afterward.
      if ((firstLock || immutableRoles.has(source.role)) &&
          fileDigest(absolute) !== String(source.sha256).toLowerCase())
        fail(`${label}.sha256 does not match the baseline file`);
    }
    if (!value.readSet.some((source) => ["requirement", "backlog"].includes(source.role)))
      fail(`${id}/grounding.yaml must read a requirement or backlog source`);

    const contract = evidence(id, dir);
    const readRoles = new Set(value.readSet.map((source) => source.role));
    if (state.coupling === "coupled")
      for (const role of ["architecture", "contract", "composition-root"])
        if (!readRoles.has(role))
          fail(`${id}/grounding.yaml coupled work requires a ${role} readSet entry`);
    const claimCapabilities = new Set(contract.claims.flatMap((claim) => claim.capabilities || []));
    if (["test", "integration", "live", "mutation", "browser"].some((capability) =>
      claimCapabilities.has(capability)) && !readRoles.has("test-topology"))
      fail(`${id}/grounding.yaml test-backed claims require a test-topology readSet entry`);
    if (((state.securityTriggers || []).length > 0 ||
        ["security", "security-static"].some((capability) => claimCapabilities.has(capability))) &&
        !readRoles.has("dependency-source"))
      fail(`${id}/grounding.yaml security work requires a dependency-source readSet entry`);
    const claimIds = new Set(contract.claims.map((claim) => claim.id));
    if (!Array.isArray(value.claims) || value.claims.length !== claimIds.size)
      fail(`${id}/grounding.yaml must map every evidence claim exactly once`);
    const seen = new Set();
    const evidenceClasses = new Set([
      "static", "unit", "test", "integration", "live", "mutation",
      "security", "review", "acceptance", "browser", "deployment",
      "cross-repo-contract"
    ]);
    for (const [index, claim] of value.claims.entries()) {
      const label = `${id}/grounding.yaml claims[${index}]`;
      if (!claimIds.has(claim.id)) fail(`${label}.id references an unknown evidence claim`);
      if (seen.has(claim.id)) fail(`${label}.id is duplicated`);
      seen.add(claim.id);
      if (!Array.isArray(claim.productionPath) || claim.productionPath.length === 0)
        fail(`${label}.productionPath must be a non-empty array`);
      for (const [pathIndex, production] of claim.productionPath.entries()) {
        const pathLabel = `${label}.productionPath[${pathIndex}]`;
        const repository = repositories.get(production?.repository || "root");
        const sourcePath = String(production?.path || "");
        if (!repository) fail(`${pathLabel} references an unselected repository`);
        if (!sourcePath || isAbsolute(sourcePath))
          fail(`${pathLabel}.path must be repository-relative`);
        const absolute = resolve(repository.workspacePath, sourcePath);
        if (!pathInside(repository.workspacePath, absolute) || !existsSync(absolute))
          fail(`${pathLabel}.path does not resolve inside repository '${repository.id}'`);
        if (!value.readSet.some((source) =>
          (source.repository || "root") === repository.id &&
          source.path === sourcePath && source.role === "production-path"))
          fail(`${pathLabel} must appear in readSet with role production-path and a baseline digest`);
      }
      if (!Array.isArray(claim.failurePaths) || claim.failurePaths.length === 0)
        fail(`${label}.failurePaths must be a non-empty array`);
      for (const [failureIndex, failurePath] of claim.failurePaths.entries()) {
        const failureLabel = `${label}.failurePaths[${failureIndex}]`;
        const repository = repositories.get(failurePath?.repository || "root");
        const sourcePath = String(failurePath?.path || "");
        if (!repository) fail(`${failureLabel} references an unselected repository`);
        if (!sourcePath || isAbsolute(sourcePath))
          fail(`${failureLabel}.path must be repository-relative`);
        const absolute = resolve(repository.workspacePath, sourcePath);
        if (!pathInside(repository.workspacePath, absolute) || !existsSync(absolute))
          fail(`${failureLabel}.path does not resolve inside repository '${repository.id}'`);
        if (!String(failurePath?.failure || "").trim())
          fail(`${failureLabel}.failure is required`);
        if (!value.readSet.some((source) =>
          (source.repository || "root") === repository.id && source.path === sourcePath))
          fail(`${failureLabel} must appear in readSet with a baseline digest`);
      }
      if (!Array.isArray(claim.evidenceClass) || claim.evidenceClass.length === 0 ||
          claim.evidenceClass.some((entry) => !String(entry || "").trim()))
        fail(`${label}.evidenceClass must be a non-empty string array`);
      if (claim.evidenceClass.some((entry) => !evidenceClasses.has(entry)))
        fail(`${label}.evidenceClass contains an unsupported class`);
      if (!String(claim.testDoubleGap || "").trim())
        fail(`${label}.testDoubleGap must be none or describe the gap`);
      if (claim.testDoubleGap !== "none" &&
          !claim.evidenceClass.some((entry) => ["integration", "live"].includes(entry)))
        fail(`${label} declares a test-double gap without integration or live evidence`);
      const evidenceClaim = contract.claims.find((entry) => entry.id === claim.id);
      const capabilities = new Set(evidenceClaim?.capabilities || []);
      const capabilityAliases = {
        static: ["static-analysis", "security-static"],
        unit: ["test"],
        test: ["test"],
        integration: ["integration"],
        live: ["live"],
        mutation: ["mutation"],
        security: ["security", "security-static"],
        review: ["review"],
        acceptance: ["acceptance"],
        browser: ["browser"],
        deployment: ["deployment"],
        "cross-repo-contract": ["compatibility", "integration"]
      };
      for (const evidenceClass of claim.evidenceClass)
        if (!capabilityAliases[evidenceClass].some((capability) => capabilities.has(capability)))
          fail(`${label}.evidenceClass '${evidenceClass}' is not declared by evidence.yaml for claim '${claim.id}'`);
      if (evidenceClaim?.impact === "high" &&
          !claim.evidenceClass.some((entry) =>
            ["integration", "live", "security", "review"].includes(entry)))
        fail(`${label} maps a high-impact claim only to low-fidelity evidence`);
    }

    if (value.version === 2) {
      const materialTestClaims = contract.claims.filter((claim) =>
        claim.impact !== "low" &&
        (claim.capabilities || []).some((capability) =>
          ["test", "integration", "live", "browser"].includes(capability)));
      const criticalCoverage = new Set((value.criticalCases || [])
        .flatMap((row) => row.claimIds || []));
      for (const claim of materialTestClaims)
        if (!criticalCoverage.has(claim.id))
          fail(`${id}/grounding.yaml material test claim '${claim.id}' requires a stable criticalCases row`);
      for (const [index, row] of (value.criticalCases || []).entries())
        for (const claimId of row.claimIds || [])
          if (!claimIds.has(claimId))
            fail(`${id}/grounding.yaml criticalCases[${index}] references unknown claim '${claimId}'`);
      const mutationClaims = contract.claims.filter((claim) =>
        (claim.capabilities || []).includes("mutation"));
      const mutationCoverage = new Set((value.mutants || [])
        .flatMap((row) => row.claimIds || []));
      for (const claim of mutationClaims)
        if (!mutationCoverage.has(claim.id))
          fail(`${id}/grounding.yaml mutation claim '${claim.id}' requires a named mutant and killer case`);
      for (const [index, row] of (value.mutants || []).entries())
        for (const claimId of row.claimIds || [])
          if (!claimIds.has(claimId))
            fail(`${id}/grounding.yaml mutants[${index}] references unknown claim '${claimId}'`);
      const executionProviders = Object.values(rawExecution(id, dir).providers || {});
      const configuredCriticalCases = new Set(executionProviders
        .flatMap((provider) => provider.criticalCases || []));
      for (const row of value.criticalCases || [])
        if (!configuredCriticalCases.has(row.id))
          fail(`${id}/execution.yaml must bind critical case '${row.id}' in a provider.criticalCases list`);
      const mutationProviders = executionProviders.filter((provider) =>
        provider.resultProtocol === "foundation-mutation-v2");
      const configuredMutants = new Set(mutationProviders
        .flatMap((provider) => provider.requiredMutants || []));
      for (const row of value.mutants || [])
        if (!configuredMutants.has(row.id))
          fail(`${id}/execution.yaml must bind mutant '${row.id}' in a foundation-mutation-v2 provider.requiredMutants list`);
        else {
          const provider = mutationProviders.find((candidate) =>
            (candidate.requiredMutants || []).includes(row.id));
          if (provider?.mutantKillers?.[row.id] !== row.killerCaseId)
            fail(`${id}/execution.yaml mutantKillers.${row.id} must equal grounding killerCaseId '${row.killerCaseId}'`);
          if (!(provider?.criticalCases || []).includes(row.killerCaseId))
            fail(`${id}/execution.yaml mutation provider must require killer critical case '${row.killerCaseId}'`);
        }
    }

    if (!Array.isArray(value.derivedFacts || []))
      fail(`${id}/grounding.yaml derivedFacts must be an array`);
    for (const [index, fact] of (value.derivedFacts || []).entries())
      if (!String(fact.fact || "").trim() || !String(fact.command || "").trim())
        fail(`${id}/grounding.yaml derivedFacts[${index}] requires fact and command`);
    return { value, digest: groundingDigest, firstLock, lockedAt: decision.lockedAt };
  }

  function validate(id, source = "root", options = {}) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const dir = source === "active" ? activeChangePath(id, state) : changePath(id);
    const missing = changeArtifactGaps(state, dir);
    if (missing.length) fail(`missing change artifacts: ${missing.join(", ")}`);
    assertNoScaffolds(state, dir);
    const grounding = groundingValue(id, state, dir);
    if (!["low", "medium", "high"].includes(state.impact || ""))
      fail(`resolve impact for '${id}'`);
    if (!["isolated", "coupled"].includes(state.coupling || ""))
      fail(`resolve coupling for '${id}'`);
    if (state.acceptance?.decision === "undecided")
      fail(`acceptance decision is unresolved for '${id}'; ask the user whether subjective human acceptance is required, then resolve with --acceptance-required or --acceptance-not-required`);
    assertNewCapabilitiesAreAdditive(id, dir);
    assertNoDroppedScenarios(id, dir);
    // The OpenSpec strict lint used to surface only inside 'openspec archive',
    // after the code had landed, so a pure wording defect forced a re-prove.
    // Same tool, same mode, earlier. Quiet internal validations skip the
    // subprocess; the explicit gate is the one that must catch it. Rapid
    // changes declare skip_specs and have no deltas to lint.
    if (!options.quiet && state.schema !== "foundation-rapid")
      assertOpenSpecStrictValid(id, dir, fail);

    const tasks = readFileSync(join(dir, "tasks.md"), "utf8");
    const parsedTasks = taskBlocks(tasks);
    const taskIds = parsedTasks.map((task) => task.id).filter(Boolean);
    if (parsedTasks.length && taskIds.length !== parsedTasks.length)
      fail("every implementation task requires a stable ID such as T001");
    if (new Set(taskIds).size !== taskIds.length)
      fail("tasks.md contains duplicate task IDs");
    // The gate is about a task that names a lifecycle *command*, so the slash
    // has to start a token. Matching a bare `/land` anywhere also matched the
    // path `runtime/workflow/land-runtime.mjs`, which made every change that
    // declares that file's path in `[paths:]` unvalidatable — the guard blocked
    // work on the very code it guards.
    const lifecycleTasks = taskBlocks(tasks).filter((task) =>
      !task.done && /(?:^|[\s(`"'])\/(?:prove|land)\b/.test(task.text));
    if (lifecycleTasks.length)
      fail("tasks.md contains a lifecycle gate; /prove and /land are commands, not implementation tasks");

    const claims = evidence(id, dir).claims;
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const selectedRepositoryIds = new Set(selectedRepositories(id, state)
      .map((repository) => repository.id));
    for (const claim of claims) {
      if (!["low", "medium", "high"].includes(claim.impact || ""))
        fail(`claim '${claim.id}' requires impact low|medium|high`);
      if (claim.repositories !== undefined &&
          (!Array.isArray(claim.repositories) || claim.repositories.length === 0 ||
           claim.repositories.some((repository) => !selectedRepositoryIds.has(repository))))
        fail(`claim '${claim.id}' repositories must reference selected repositories`);
      if ((claim.repositories || []).length > 1 &&
          !claim.capabilities.includes("cross-repo-contract"))
        fail(`claim '${claim.id}' spans repositories and requires cross-repo-contract`);
    }
    handoffContract(id, {
      state,
      claimIds: new Set(claimById.keys()),
      taskIds: new Set(taskIds)
    });

    let acceptance = resolvedAcceptance(id, state, { claims });
    const unknownAcceptanceClaims = acceptance.claimIds.filter((claim) => !claimById.has(claim));
    if (unknownAcceptanceClaims.length)
      fail(`acceptance references unknown claim(s): ${unknownAcceptanceClaims.join(", ")}`);
    if (acceptance.required && acceptance.claimIds.length === 0) {
      if (acceptance.version < 2) {
        acceptance = {
          ...acceptance,
          claimIds: claims.map((claim) => claim.id),
          scopeOrigin: "legacy-all"
        };
        console.error("WARNING: migrated legacy acceptance scope to all current claims");
      } else {
        // Declaring acceptance required without naming what is to be accepted
        // leaves every later command refusing the change — validate, readiness,
        // sync and Land alike. The old wording named two flags of `change
        // resolve`, a command already run by the time anything reads this, and
        // said nothing about how to get out. Both exits belong here.
        fail(`change '${id}' requires acceptance but nothing is in scope. Either name the ` +
          "claims a person is accepting:\n" +
          `  claude-foundation change resolve ${id} --impact <impact> --coupling <coupling> ` +
          "--acceptance-required --acceptance-reason <why> --acceptance-claims <ids>\n" +
          "or declare capability 'acceptance' on a claim in evidence.yaml. To withdraw the " +
          "requirement instead, re-resolve with --acceptance-not-required.");
      }
    }
    if (acceptance.required) {
      // A claim declaring capability `acceptance` outranks the resolve flag —
      // `resolvedAcceptance` ORs the two — and this rewrite then persists the
      // derived answer. Silently. So `--acceptance-not-required` appeared to
      // do nothing, forever, and the only way to learn why was to read
      // `resolvedAcceptance`. Name the claims that hold the gate open, the way
      // `policyCapabilityTrigger` names the file that pulled a capability in.
      if (acceptance.scopeOrigin === "claim-capability")
        console.error(`WARNING: acceptance stays required because claim(s) ${acceptance.claimIds.join(", ")} declare capability 'acceptance'; --acceptance-not-required cannot drop a human gate while that capability remains in evidence.yaml`);
      state.acceptance = {
        version: 2,
        decision: "required",
        required: true,
        reason: acceptance.reason || "declared evidence capability",
        claimIds: acceptance.claimIds,
        scopeOrigin: acceptance.scopeOrigin || "explicit",
        declaredAt: state.acceptance?.declaredAt || now()
      };
    }

    for (const task of parsedTasks) {
      const metadata = taskMetadata(task);
      if (metadata.claims.length > 50)
        fail(`task '${task.id}' references more than 50 claims`);
      const unknownClaims = metadata.claims.filter((claim) => !claimById.has(claim));
      if (unknownClaims.length)
        fail(`task '${task.id}' references unknown claim(s): ${unknownClaims.join(", ")}`);
      const outOfScopeClaims = metadata.claims.filter((claimId) => {
        const repositories = claimById.get(claimId)?.repositories || [];
        return repositories.length > 0 && !repositories.includes(metadata.repository);
      });
      if (outOfScopeClaims.length)
        fail(`task '${task.id}' references claim(s) outside repository '${metadata.repository}': ${outOfScopeClaims.join(", ")}`);
    }

    const selected = selectedRepositories(id, state);
    if (selected.length > 1) {
      const unscopedTasks = parsedTasks.filter((task) =>
        !/\[repo:[a-z0-9-]+\]/i.test(task.text));
      if (unscopedTasks.length)
        fail(`multi-repository tasks require [repo:<id>] scope (${unscopedTasks.map((task) => task.id).join(", ")})`);
      for (const task of parsedTasks) {
        const metadata = taskMetadata(task);
        const repository = metadata.repository;
        if (repository && !selectedRepositoryIds.has(repository))
          fail(`task '${task.id}' references unselected repository '${repository}'`);
        if (metadata.paths.some((path) =>
          isAbsolute(path) || path === ".." || path.startsWith("../") || path.includes("/../")))
          fail(`task '${task.id}' contains an unsafe path scope`);
        if (["implementation", "migration"].includes(metadata.kind) && metadata.paths.length === 0)
          fail(`multi-repository task '${task.id}' requires [paths:<repo-relative-paths>]`);
      }
    }

    if (claims.some((claim) => claim.impact === "high")) state.reviewRequired = true;
    state.evidenceCapabilities = [...new Set(claims.flatMap((claim) => claim.capabilities))];
    // Case-insensitive and `xs`-aware: this compared against the literal "S",
    // so an atomic start's own "xs" fell through to the wide budget and the
    // check only ever passed via the impact disjunct.
    const budgets = ["xs", "s"].includes(String(state.size || "").toLowerCase())
      || state.impact === "low"
      ? { "proposal.md": 900, "design.md": 1400, "tasks.md": 900 }
      : { "proposal.md": 1600, "design.md": 2600, "tasks.md": 1600 };
    for (const [name, limit] of Object.entries(budgets)) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      const words = readFileSync(path, "utf8").trim().split(/\s+/).filter(Boolean).length;
      if (words > limit)
        console.error(`WARNING: ${name} is ${words} words (soft budget ${limit}); retain only load-bearing content`);
    }
    // Lock only after every validation gate above passes. A malformed task or
    // unresolved acceptance decision must not freeze a grounding ledger that
    // has never represented a valid Change contract.
    if (grounding?.firstLock) {
      state.groundingDigest = grounding.digest;
      state.groundingLockedAt = grounding.lockedAt;
      if (state.groundingReopenPending) {
        state.groundingReopens = [...(state.groundingReopens || []), {
          ...state.groundingReopenPending,
          newDigest: grounding.digest,
          newLockedAt: grounding.lockedAt,
          contractFingerprint: contractFingerprint(id, dir),
          completedAt: now()
        }];
        delete state.groundingReopenPending;
      }
    }
    saveRuntime(state);
    // A declared surface predicts capabilities that the *changed* surface will
    // only reveal once files exist — by which point this contract is signed and
    // its evidence collected. Warn, never fail: the forecast is a prediction the
    // author owns, and failing here would be routed around by declaring nothing.
    if (state.declaredSurface?.length && !options.quiet) {
      const covered = new Set(requiredProviders(id).map((provider) =>
        providerCapability(provider, providerConfig(id, provider))));
      const missing = forecastCapabilities(state.declaredSurface)
        .capabilities.filter((capability) => !covered.has(capability));
      // A warning that names no action is a warning nobody acts on, and this
      // one fires at the last moment the contract is still cheap to change.
      // Say what each outcome actually is now: a wired capability is enforced,
      // an unwired one is carried as an advisory rather than becoming an
      // unsatisfiable gate at Prove — except review, which stops the loop until
      // a reviewer or a foundation.json waiver exists.
      if (missing.length) {
        console.error(`WARNING: declared surface forecasts ${missing.join(", ")} with no provider`);
        console.error(`  wire them now: claude-foundation evidence init ${id} --write`);
        console.error(`  inspect first: claude-foundation evidence doctor ${id}`);
        if (missing.includes("review"))
          console.error("  review needs a configured fresh reviewer at Prove; a one-family project selects codex-sol or claude-opus and commits review.diversity='single-model' while keeping independence required");
        console.error("  anything left unwired is carried as a non-blocking advisory, not a gate");
      }
    }
    // Review is the one gate a change cannot wire its way out of, and the loop
    // used to reveal it at Prove — after the build is spent, and with the
    // waiver that resolves it named nowhere. A forecast only covers what is not
    // yet required; once it *is* required, saying so here is the last cheap
    // moment to find a reviewer or decide the project reviews itself.
    // Guarded for the same reason as `advisoryCapabilities`: `reviewPolicy`
    // reads the changed surface, which a multi-repository change cannot resolve
    // until its sandboxes exist. A hint must never be able to fail validate.
    if (!options.quiet && changedSurfaceResolvable(id, state)) {
      const policy = reviewPolicy(id, state, evidence(id, dir));
      if (policy.required && !policy.independenceWaived) {
        console.error("NOTE: this change requires review evidence; an independent reviewer must exist by Prove");
        console.error("  one-family project: select codex-sol or claude-opus and set review.diversity='single-model'; the reviewer still uses a distinct identity and fresh session");
      }
    }
    if (!options.quiet)
      console.log(`VALID ${id} (${state.schema}, ${claims.length} claims)\n  next: ${nextAfterValidate(state.status, id)}`);
  }

  function requiredProviders(id) {
    const state = loadRuntime(id);
    const contract = evidence(id);
    const providers = contract.providers || {};
    const waived = new Set((state.waivers || []).map((row) => row.capability));
    const required = new Set();
    const addCapability = (capability, repositories = []) => {
      if (waived.has(capability)) return;
      const instances = Object.entries(providers).filter(([provider, config]) => {
        if (providerCapability(provider, config) !== capability) return false;
        if (!config.repository || repositories.length === 0) return true;
        return repositories.includes(config.repository);
      }).map(([provider]) => provider);
      if (instances.length) instances.forEach((provider) => required.add(provider));
      else required.add(capability);
    };
    for (const claim of contract.claims) {
      for (const capability of claim.capabilities) {
        addCapability(capability, claim.repositories || []);
        if (capability === "test" && !waived.has("test"))
          addCapability("discovery", claim.repositories || []);
      }
    }
    if (reviewPolicy(id, state, contract).required) addCapability("review");
    if (resolvedAcceptance(id, state, contract).required) addCapability("acceptance");
    for (const capability of policyCapabilitySplit(id, contract).enforced)
      addCapability(capability);
    return [...required].sort();
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
    for (const capability of policyCapabilities(id))
      (configured.has(capability) || declared.has(capability) ? enforced : advisory)
        .push(capability);
    return { enforced, advisory };
  }

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

  function waiveGate(id, flags = {}) {
    const capability = String(flags.capability || "").trim();
    const decisionRef = String(flags["decision-ref"] || "").trim();
    const reason = String(flags.reason || "").trim();
    if (!capability) fail("change waive requires --capability <capability>");
    if (!decisionRef)
      fail("change waive requires --decision-ref <host-user-decision>; ask the user to authorize withdrawing this gate before recording it");
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const waivers = state.waivers || [];
    if (flags.revoke) {
      if (!waivers.some((row) => row.capability === capability))
        fail(`capability '${capability}' has no recorded waiver to revoke`);
      state.waivers = waivers.filter((row) => row.capability !== capability);
      saveRuntime(state);
      console.log(`WAIVER REVOKED ${id}/${capability}\n  the capability is required again\n  next: claude-foundation proof run ${id}`);
      return;
    }
    if (!reason) fail("change waive requires --reason <why>");
    if (capability === "review")
      fail("review cannot be waived here; use the configured risk route or record an explicit policy/change decision");
    if (capability === "acceptance")
      fail(`acceptance cannot be waived here; withdraw the requirement instead: claude-foundation change resolve ${id} --acceptance-not-required`);
    if (waivers.some((row) => row.capability === capability))
      fail(`capability '${capability}' is already waived`);
    const required = requiredProviders(id);
    if (!required.includes(capability) && !required.some((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === capability))
      fail(`capability '${capability}' is not required by change '${id}'; nothing to waive`);
    state.waivers = [...waivers, {
      capability,
      reason,
      authority: { kind: "host-user-decision", reference: decisionRef },
      recordedAt: now()
    }];
    saveRuntime(state);
    console.log(`GATE WAIVED ${id}/${capability}\n  reason: ${reason}\n  decision: ${decisionRef}\n  recorded in proof advisories; the claim keeps declaring it\n  next: claude-foundation proof run ${id}`);
  }

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
      stableHash
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
