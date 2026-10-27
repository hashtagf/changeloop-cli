import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { checkNpmWorkspace } from "./npm-lockfile-check.mjs";

const PROVIDER_SCRIPT_ALIASES = {
  "static-analysis": ["check", "typecheck", "type-check", "lint"],
  integration: ["test:integration", "integration"],
  compatibility: ["test:compatibility", "compatibility"],
  performance: ["test:performance", "performance", "bench"],
  "security-static": ["security", "security:static", "scan:security"],
  accessibility: ["test:accessibility", "accessibility", "a11y"],
  "data-migration": ["test:migration", "migration:check"],
  resilience: ["test:resilience", "resilience"],
  observability: ["test:observability", "observability"],
  deployment: ["test:deployment", "deployment:check"],
  "dependency-supply-chain": ["supply-chain", "dependencies:audit", "audit:dependencies"]
};

export function readJsonCandidate(path, warnings, source) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    warnings.push({ source, reason: "invalid-json", detail: error.message });
    return null;
  }
}

export function packageManagerAt(workspace) {
  if (existsSync(join(workspace, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(workspace, "yarn.lock"))) return "yarn";
  if (existsSync(join(workspace, "bun.lock")) || existsSync(join(workspace, "bun.lockb")))
    return "bun";
  return "npm";
}

export function packageScriptCommand(manager, script, args = []) {
  if (manager === "yarn") return ["yarn", script, ...args];
  if (manager === "pnpm") return ["pnpm", "run", script, ...args];
  if (manager === "bun") return ["bun", "run", script, ...args];
  return ["npm", "run", script, ...(args.length ? ["--", ...args] : [])];
}

export function riskyPackageScript(value) {
  return /(?:^|[;&|])\s*(?:sudo|curl|wget)\b|\brm\s+-rf\b|\$\(|`/.test(String(value || ""));
}

export function packageScriptRisk(tooling, script) {
  return [`pre${script}`, script, `post${script}`]
    .filter((name) => riskyPackageScript(tooling.scripts[name]));
}

export function safePackageScriptInputs(workspace, raw, declaredSurface = []) {
  const scripts = (Array.isArray(raw) ? raw : [raw]).map((value) => String(value || ""));
  if (!declaredSurface.length || scripts.some((value) => /[;&|$`()<>"']/.test(value)))
    return [];
  const files = scripts.flatMap((value) =>
    value.trim().split(/\s+/).slice(1)).flatMap((token) => {
    if (!token || token.startsWith("-") || isAbsolute(token) ||
        token.split(/[\\/]+/).includes("..")) return [];
    const rel = token.replaceAll("\\", "/").replace(/^\.\/+/, "");
    try { return existsSync(join(workspace, rel)) && statSync(join(workspace, rel)).isFile()
      ? [rel] : []; }
    catch { return []; }
  });
  return files.length
    ? [...new Set([...declaredSurface, "package.json", ...files])].sort() : [];
}

export function candidateInputs(tooling, script, repository, declaredSurface) {
  const lifecycle = [`pre${script}`, script, `post${script}`]
    .filter((name) => typeof tooling.scripts[name] === "string")
    .map((name) => tooling.scripts[name]);
  const inputs = safePackageScriptInputs(repository.workspacePath,
    lifecycle, declaredSurface);
  return inputs.length ? { inputs } : {};
}

export function packageTooling(workspace, repository, warnings) {
  const path = join(workspace, "package.json");
  const packageJson = readJsonCandidate(path, warnings,
    `${repository.relativePath}/package.json`.replace(/^\.\//, ""));
  if (!packageJson) return null;
  return {
    path,
    packageJson,
    dependencies: { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) },
    scripts: packageJson.scripts || {},
    manager: packageManagerAt(workspace)
  };
}

export function providerInstanceName(capability, repository, repositoryCount) {
  return repositoryCount === 1 && repository.id === "root"
    ? capability : `${capability}-${repository.id}`;
}

export function providerCandidate(provider, capability, repository, repositoryCount,
  config, source, confidence = "high", detail = null) {
  const scoped = repositoryCount === 1 && repository.id === "root"
    ? config : { ...config, capability, repository: repository.id };
  return {
    provider: provider || providerInstanceName(capability, repository, repositoryCount),
    capability, repository: repository.id, confidence, recommended: confidence === "high",
    source, detail, config: scoped
  };
}

export function testCandidates(tooling, repository, repositoryCount, declaredSurface) {
  if (!tooling) return [];
  const { dependencies, scripts, manager } = tooling;
  const script = scripts.test ? "test" :
    Object.keys(scripts).find((name) => ["test:unit", "unit"].includes(name));
  if (!script) return [];
  const raw = String(scripts[script]);
  const source = `package.json#scripts.${script}`;
  const riskyScripts = packageScriptRisk(tooling, script);
  if (riskyScripts.length) return [{
    provider: providerInstanceName("test", repository, repositoryCount),
    capability: "test", repository: repository.id, confidence: "review",
    recommended: false, source,
    detail: `script requires operator review before execution: ${riskyScripts.join(", ")}`,
    config: null
  }];
  const frameworks = [];
  if (dependencies.vitest || /\bvitest\b/.test(raw))
    frameworks.push({ name: "vitest", args: ["--run", "--reporter=json"] });
  if (dependencies.jest || /\bjest\b/.test(raw))
    frameworks.push({ name: "jest", args: ["--json"] });
  if (dependencies.mocha || /\bmocha\b/.test(raw))
    frameworks.push({ name: "mocha", args: ["--reporter=json"] });
  if (/\bnode\s+--test\b/.test(raw))
    frameworks.push({ name: "node-test", args: ["--test-reporter=tap"], reportFormat: "tap" });
  if (frameworks.length !== 1) return frameworks.length > 1 ? [{
    provider: providerInstanceName("test", repository, repositoryCount),
    capability: "test", repository: repository.id, confidence: "ambiguous",
    recommended: false, source,
    detail: `multiple test frameworks detected: ${frameworks.map((item) => item.name).join(", ")}`,
    config: null
  }] : [];
  const framework = frameworks[0];
  return [providerCandidate(null, "test", repository, repositoryCount, {
    adapter: "test-discovery",
    command: packageScriptCommand(manager, script, framework.args),
    ...candidateInputs(tooling, script, repository, declaredSurface),
    minimum: 1,
    reportFormat: framework.reportFormat || "auto"
  }, source, repositoryCount === 1 ? "high" : "review",
  repositoryCount === 1
    ? `structured ${framework.name} output`
    : `structured ${framework.name} output; multi-repository discovery wiring requires review`)];
}

export function browserCandidates(tooling, repository, repositoryCount, declaredSurface) {
  if (!tooling) return [];
  const { dependencies, scripts, manager } = tooling;
  if (!dependencies["@playwright/test"] && !dependencies.playwright) return [];
  const script = Object.keys(scripts).find((name) =>
    ["test:e2e", "e2e", "playwright", "test:browser"].includes(name) &&
    /playwright/.test(String(scripts[name])));
  if (!script || packageScriptRisk(tooling, script).length) return [];
  return [providerCandidate(null, "browser", repository, repositoryCount, {
    adapter: "playwright",
    command: packageScriptCommand(manager, script),
    ...candidateInputs(tooling, script, repository, declaredSurface),
    inputMode: "browser-automation"
  }, `package.json#scripts.${script}`, "high", "project-owned Playwright script")];
}

export function scriptCandidates(capability, tooling, repository, repositoryCount, declaredSurface) {
  if (!tooling) return [];
  const aliases = PROVIDER_SCRIPT_ALIASES[capability] || [];
  const matches = aliases.filter((name) => typeof tooling.scripts[name] === "string");
  if (!matches.length) return [];
  const safe = matches.filter((name) => !packageScriptRisk(tooling, name).length);
  if (!safe.length) return matches.map((name) => ({
    provider: providerInstanceName(capability, repository, repositoryCount),
    capability, repository: repository.id, confidence: "review", recommended: false,
    source: `package.json#scripts.${name}`,
    detail: "script requires operator review before execution", config: null
  }));
  const preferred = capability === "static-analysis" && safe.length === 1 && safe[0] !== "check"
    ? safe[0] : null;
  return safe.map((name) => providerCandidate(null, capability, repository, repositoryCount, {
    adapter: "command", command: packageScriptCommand(tooling.manager, name),
    ...candidateInputs(tooling, name, repository, declaredSurface)
  }, `package.json#scripts.${name}`, name === preferred ? "high" : "alternative",
  safe.length > 1 ? `alternatives detected: ${safe.join(", ")}` : "project-owned package script"));
}

export function npmLockfileCandidates(tooling, repository, repositoryCount, declaredSurface) {
  if (!tooling || tooling.manager !== "npm" ||
      !existsSync(join(repository.workspacePath, "package-lock.json")) ||
      !existsSync(join(repository.workspacePath, ".claude", "harness", "runtime",
        "evidence", "npm-lockfile-check.mjs"))) return [];
  return [providerCandidate(null, "dependency-supply-chain", repository, repositoryCount, {
    adapter: "command",
    version: "2",
    command: ["node", ".claude/harness/runtime/evidence/npm-lockfile-check.mjs"]
  }, "package.json + package-lock.json", repositoryCount === 1 ? "high" : "review",
  `built-in deterministic npm manifest/lockfile consistency check (discovery: ${
    checkNpmWorkspace(repository.workspacePath, { validateInstall: false }).status})`)];
}

export function capabilityRepositories(capability, repositories, contract) {
  const scoped = new Set(contract.claims
    .filter((claim) => claim.capabilities.includes(capability))
    .flatMap((claim) => claim.repositories || []));
  if (!scoped.size) return repositories.filter((repository) => repository.mode === "write");
  return repositories.filter((repository) => scoped.has(repository.id));
}

export function configuredEvidenceProviders({
  contract, repositories, providerCapability, commandExists, root
}) {
  return Object.entries(contract.providers || {}).map(([provider, config]) => {
    const repositoryId = config.repository || "root";
    const repository = repositories.find((row) => row.id === repositoryId);
    const executable = config.adapter === "external" ? null : config.command?.[0] || null;
    return {
      provider, capability: providerCapability(provider, config), repository: repositoryId,
      adapter: config.adapter, executable,
      available: executable === null ? null :
        commandExists(executable, repository?.workspacePath || root)
    };
  });
}

export function requiredEvidenceCapability(
  requiredProvider, knownProviders, providerCapability, providerConfig
) {
  const existingConfig = providerConfig(requiredProvider);
  return knownProviders.has(requiredProvider)
    ? requiredProvider : providerCapability(requiredProvider, existingConfig) || requiredProvider;
}

export function evidenceCandidateRows(
  capability, tooling, repository, repositoryCount, declaredSurface
) {
  if (capability === "test")
    return testCandidates(tooling, repository, repositoryCount, declaredSurface);
  if (capability === "browser")
    return browserCandidates(tooling, repository, repositoryCount, declaredSurface);
  if (capability === "dependency-supply-chain")
    return npmLockfileCandidates(tooling, repository, repositoryCount, declaredSurface);
  if (capability === "discovery") return [];
  return scriptCandidates(capability, tooling, repository, repositoryCount, declaredSurface);
}

export function discoverMissingEvidence({
  missing, providerConfig, providerCapability, knownProviders, repositories, contract,
  tooling, declaredSurface, root = process.cwd()
}) {
  const candidates = [];
  const unresolved = [];
  const discoveryCovered = new Set();
  for (const requiredProvider of missing) {
    const capability = requiredEvidenceCapability(
      requiredProvider, knownProviders, providerCapability, providerConfig);
    if (capability === "discovery" && discoveryCovered.size) continue;
    if (["review", "acceptance"].includes(capability)) {
      unresolved.push({ provider: requiredProvider, capability, repository: null,
        reason: "external-authority", next: `record verifiable external ${capability} evidence` });
      continue;
    }
    const targets = capabilityRepositories(capability, repositories, contract);
    const consumerQualityConfig = join(root, "quality", "foundation-quality.json");
    if (capability === "static-analysis" && existsSync(consumerQualityConfig)) {
      candidates.push({
        provider: requiredProvider,
        capability,
        // Quality is an orchestration provider: it starts from the Foundation
        // root workspace and routes its own selected repository lanes.
        repository: null,
        confidence: "high",
        recommended: true,
        source: "quality/foundation-quality.json",
        detail: "Foundation consumer quality gate bound to all affected repositories",
        config: {
          adapter: "command",
          command: ["node", ".claude/harness/foundation.mjs", "quality-run", "--enforce"],
          repositories: targets.map((repository) => repository.id)
        }
      });
      continue;
    }
    let found = false;
    for (const repository of targets) {
      const rows = evidenceCandidateRows(capability, tooling.get(repository.id), repository,
        repositories.length, declaredSurface);
      if (!rows.length) continue;
      found = true;
      candidates.push(...rows.map((row) =>
        row.provider === capability && requiredProvider !== capability
          ? { ...row, provider: requiredProvider } : row));
      if (capability === "test" &&
          rows.some((row) => row.config?.adapter === "test-discovery"))
        discoveryCovered.add(repository.id);
    }
    if (!found && capability !== "discovery") unresolved.push({
      provider: requiredProvider, capability,
      repository: targets.length === 1 ? targets[0].id : null,
      reason: "no-safe-project-command",
      next: `configure a project-owned ${capability} command in execution.yaml`
    });
  }
  if (missing.includes("discovery") && !discoveryCovered.size && !providerConfig("discovery"))
    unresolved.push({ provider: "discovery", capability: "discovery", repository: null,
      reason: "structured-test-count-unavailable",
      next: "configure test-discovery with JSON or TAP output" });
  return { candidates, unresolved };
}

export function dedupeEvidenceRows(rows, stableHash) {
  return [...new Map(rows.map((row) =>
    [stableHash([row.provider, row.capability, row.repository, row.source, row.reason]), row]
  )).values()];
}

export function unavailableEvidenceProviders(configured) {
  return configured.filter((row) => row.available === false).map((row) => ({
    provider: row.provider, capability: row.capability, repository: row.repository,
    reason: "command-unavailable", executable: row.executable,
    next: `install or reconfigure the project-owned executable '${row.executable}'`
  }));
}

export function evidenceWiringStatus(unavailable, unresolved, candidates) {
  return unavailable.length ? "INFRASTRUCTURE_ERROR" :
    unresolved.length || candidates.length ? "NEEDS_CONFIGURATION" : "READY";
}

export function detectEvidenceWiring({
  id, root, contract, repositories, required, providerConfig, providerCapability,
  knownProviders, commandExists, stableHash, declaredSurface = []
}) {
  const warnings = [];
  const tooling = new Map(repositories.map((repository) => [
    repository.id, packageTooling(repository.workspacePath, repository, warnings)
  ]));
  const configured = configuredEvidenceProviders({
    contract, repositories, providerCapability, commandExists, root
  });
  const missing = required.filter((provider) => !providerConfig(provider));
  const { candidates, unresolved } = discoverMissingEvidence({
    missing, providerConfig, providerCapability, knownProviders, repositories, contract,
    tooling, declaredSurface, root
  });
  const unavailable = unavailableEvidenceProviders(configured);
  return {
    version: 1, changeId: id,
    status: evidenceWiringStatus(unavailable, unresolved, candidates),
    configured, candidates: dedupeEvidenceRows(candidates, stableHash),
    unresolved: dedupeEvidenceRows(unresolved, stableHash),
    unavailable, warnings
  };
}
