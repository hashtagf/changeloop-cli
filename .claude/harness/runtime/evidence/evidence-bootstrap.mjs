import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

function readJsonCandidate(path, warnings, source) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    warnings.push({ source, reason: "invalid-json", detail: error.message });
    return null;
  }
}

function packageManagerAt(workspace) {
  if (existsSync(join(workspace, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(workspace, "yarn.lock"))) return "yarn";
  if (existsSync(join(workspace, "bun.lock")) || existsSync(join(workspace, "bun.lockb")))
    return "bun";
  return "npm";
}

function packageScriptCommand(manager, script, args = []) {
  if (manager === "yarn") return ["yarn", script, ...args];
  if (manager === "pnpm") return ["pnpm", "run", script, ...args];
  if (manager === "bun") return ["bun", "run", script, ...args];
  return ["npm", "run", script, ...(args.length ? ["--", ...args] : [])];
}

function riskyPackageScript(value) {
  return /(?:^|[;&|])\s*(?:sudo|curl|wget)\b|\brm\s+-rf\b|\$\(|`/.test(String(value || ""));
}

function packageScriptRisk(tooling, script) {
  return [`pre${script}`, script, `post${script}`]
    .filter((name) => riskyPackageScript(tooling.scripts[name]));
}

function packageTooling(workspace, repository, warnings) {
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

function providerInstanceName(capability, repository, repositoryCount) {
  return repositoryCount === 1 && repository.id === "root"
    ? capability : `${capability}-${repository.id}`;
}

function providerCandidate(provider, capability, repository, repositoryCount,
  config, source, confidence = "high", detail = null) {
  const scoped = repositoryCount === 1 && repository.id === "root"
    ? config : { ...config, capability, repository: repository.id };
  return {
    provider: provider || providerInstanceName(capability, repository, repositoryCount),
    capability, repository: repository.id, confidence, recommended: confidence === "high",
    source, detail, config: scoped
  };
}

function testCandidates(tooling, repository, repositoryCount) {
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
    minimum: 1,
    reportFormat: framework.reportFormat || "auto"
  }, source, repositoryCount === 1 ? "high" : "review",
  repositoryCount === 1
    ? `structured ${framework.name} output`
    : `structured ${framework.name} output; multi-repository discovery wiring requires review`)];
}

function browserCandidates(tooling, repository, repositoryCount) {
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
    inputMode: "browser-automation"
  }, `package.json#scripts.${script}`, "high", "project-owned Playwright script")];
}

function scriptCandidates(capability, tooling, repository, repositoryCount) {
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
    adapter: "command", command: packageScriptCommand(tooling.manager, name)
  }, `package.json#scripts.${name}`, name === preferred ? "high" : "alternative",
  safe.length > 1 ? `alternatives detected: ${safe.join(", ")}` : "project-owned package script"));
}

function capabilityRepositories(capability, repositories, contract) {
  const scoped = new Set(contract.claims
    .filter((claim) => claim.capabilities.includes(capability))
    .flatMap((claim) => claim.repositories || []));
  if (!scoped.size) return repositories.filter((repository) => repository.mode === "write");
  return repositories.filter((repository) => scoped.has(repository.id));
}

export function detectEvidenceWiring({
  id, root, contract, repositories, required, providerConfig, providerCapability,
  knownProviders, commandExists, stableHash
}) {
  const warnings = [];
  const tooling = new Map(repositories.map((repository) => [
    repository.id, packageTooling(repository.workspacePath, repository, warnings)
  ]));
  const configured = Object.entries(contract.providers || {}).map(([provider, config]) => {
    const repositoryId = config.repository || "root";
    const repository = repositories.find((row) => row.id === repositoryId);
    const executable = config.adapter === "external" ? null : config.command?.[0] || null;
    return {
      provider, capability: providerCapability(provider, config), repository: repositoryId,
      adapter: config.adapter, executable,
      available: executable === null ? null : commandExists(executable, repository?.workspacePath || root)
    };
  });
  const missing = required.filter((provider) => !providerConfig(provider));
  const candidates = [];
  const unresolved = [];
  const discoveryCovered = new Set();
  for (const requiredProvider of missing) {
    const existingConfig = providerConfig(requiredProvider);
    const capability = knownProviders.has(requiredProvider)
      ? requiredProvider : providerCapability(requiredProvider, existingConfig) || requiredProvider;
    if (capability === "discovery" && discoveryCovered.size) continue;
    if (["review", "acceptance"].includes(capability)) {
      unresolved.push({ provider: requiredProvider, capability, repository: null,
        reason: "external-authority", next: `record verifiable external ${capability} evidence` });
      continue;
    }
    const targets = capabilityRepositories(capability, repositories, contract);
    let found = false;
    for (const repository of targets) {
      const packageInfo = tooling.get(repository.id);
      const rows = capability === "test" ? testCandidates(packageInfo, repository, repositories.length) :
        capability === "browser" ? browserCandidates(packageInfo, repository, repositories.length) :
        capability === "discovery" ? [] :
        scriptCandidates(capability, packageInfo, repository, repositories.length);
      if (rows.length) {
        found = true;
        candidates.push(...rows.map((row) =>
          row.provider === capability && requiredProvider !== capability
            ? { ...row, provider: requiredProvider } : row));
        if (capability === "test" && rows.some((row) => row.config?.adapter === "test-discovery"))
          discoveryCovered.add(repository.id);
      }
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
  const dedupe = (rows) => [...new Map(rows.map((row) =>
    [stableHash([row.provider, row.capability, row.repository, row.source, row.reason]), row])).values()];
  const unavailable = configured.filter((row) => row.available === false).map((row) => ({
    provider: row.provider, capability: row.capability, repository: row.repository,
    reason: "command-unavailable", executable: row.executable,
    next: `install or reconfigure the project-owned executable '${row.executable}'`
  }));
  return {
    version: 1, changeId: id,
    status: unavailable.length ? "INFRASTRUCTURE_ERROR" :
      unresolved.length || candidates.length ? "NEEDS_CONFIGURATION" : "READY",
    configured, candidates: dedupe(candidates), unresolved: dedupe(unresolved),
    unavailable, warnings
  };
}
