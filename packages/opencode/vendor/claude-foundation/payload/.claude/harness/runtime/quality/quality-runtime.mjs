import {
  existsSync, mkdirSync, readFileSync, writeFileSync
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverConsumerQuality } from "./quality-discovery.mjs";
import {
  capabilityRequirement, defaultConsumerQualityConfig, profileCapabilities,
  validateConsumerQualityConfig
} from "./quality-policy.mjs";
import {
  configDigest, normalizeCrapReport, normalizeMutationReport, validateCapabilityReport
} from "./quality-protocol.mjs";
import { runBuiltinQualityAdapter } from "./adapter-registry.mjs";
import {
  aggregateQualityLanes, classifyMutationSurfaces, evaluateCrapRatchet,
  evaluateMutationRatchet, pathMatches
} from "./quality-evaluator.mjs";

export const QUALITY_CONFIG_RELATIVE = "quality/foundation-quality.json";
export const QUALITY_RESULT_RELATIVE = ".foundation/quality/results";

function laneShard(repository, capability, count) {
  let hash = 2166136261;
  for (const character of `${repository}\0${capability}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % count;
}

function executableExists(command, cwd) {
  if (!command) return false;
  if (command.includes("/") || command.includes("\\"))
    return existsSync(resolve(cwd, command));
  return String(process.env.PATH || "").split(delimiter)
    .some((directory) => existsSync(join(directory, command)));
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cleanStatus(git, cwd) {
  const result = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd);
  return result.status === 0 ? result.stdout : null;
}

function safeOutputPath(repository, output, pathInside) {
  const absolute = resolve(repository.path, output);
  if (isAbsolute(output) || !pathInside(repository.path, absolute))
    throw new Error(`quality provider output escapes repository '${repository.id}': ${output}`);
  return absolute;
}

function normalizeProviderResult(protocol, value, repository) {
  if (!protocol) return value;
  if (protocol === "foundation-quality-capabilities-v1") return validateCapabilityReport(value);
  const bound = { ...value, repository: repository.id,
    repositoryCommit: repository.head || null, workspaceDigest: repository.workspaceDigest };
  if (protocol === "foundation-crap-v1") return normalizeCrapReport(bound);
  if (protocol === "foundation-automated-mutation-v1") return normalizeMutationReport(bound);
  if (protocol === "foundation-mutation-v2") return value;
  throw new Error(`unsupported quality provider protocol '${protocol}'`);
}

export function runQualityProvider({ repository, capability, provider, git, pathInside, environment = {} }) {
  const command = provider.command || [];
  if (command.length && !executableExists(command[0], repository.path)) return {
    repository: repository.id, capability, status: "unavailable", assurance: "missing",
    reason: `executable '${command[0]}' is unavailable`, required: provider.required !== false
  };
  if (capability === "automated-mutation" &&
      !["tool", "harness-sandbox"].includes(provider.isolation)) return {
    repository: repository.id, capability, status: "fail", assurance: "missing",
    reason: "automated mutation provider requires isolation tool|harness-sandbox",
    required: provider.required !== false
  };
  if (capability === "automated-mutation" && provider.isolation === "harness-sandbox" &&
      !repository.isSandbox) return {
    repository: repository.id, capability, status: "unavailable", assurance: "missing",
    reason: "harness-sandbox mutation requires --change and a selected isolated workspace",
    required: provider.required !== false
  };
  const before = cleanStatus(git, repository.path);
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const result = command.length ? spawnSync(command[0], command.slice(1), {
      cwd: repository.path,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...environment,
        FOUNDATION_QUALITY_REPOSITORY: repository.id,
        FOUNDATION_QUALITY_CAPABILITY: capability }
    }) : { status: 0, stdout: "", stderr: "" };
  const after = cleanStatus(git, repository.path);
  if (before !== null && after !== null && before !== after) return {
    repository: repository.id, capability, status: "fail", assurance: "missing",
    reason: "provider changed repository state and did not restore it", durationMs: elapsed(),
    required: provider.required !== false
  };
  if (result.status !== 0) return {
    repository: repository.id, capability, status: "fail", assurance: "missing",
    reason: `provider exited ${result.status ?? "without status"}`,
    stderr: String(result.stderr || "").slice(-4000), durationMs: elapsed(),
    required: provider.required !== false
  };
  let value = null;
  if (provider.kind === "builtin") {
    try {
      value = runBuiltinQualityAdapter({ repository, capability, provider, pathInside,
        repositoryCommit: repository.head || null, workspaceDigest: repository.workspaceDigest });
    } catch (error) {
      return { repository: repository.id, capability, status: "fail", assurance: "missing",
        reason: `built-in adapter failed: ${error.message}`, durationMs: elapsed(),
        required: provider.required !== false };
    }
  } else if (provider.protocol) {
    try {
      const source = provider.output
        ? readFileSync(safeOutputPath(repository, provider.output, pathInside), "utf8")
        : result.stdout;
      value = normalizeProviderResult(provider.protocol, JSON.parse(source), repository);
    } catch (error) {
      return {
        repository: repository.id, capability, status: "fail", assurance: "missing",
        reason: `invalid ${provider.protocol} result: ${error.message}`, durationMs: elapsed(),
        required: provider.required !== false
      };
    }
  }
  return {
    repository: repository.id, capability, status: "pass", assurance: "full",
    durationMs: elapsed(), required: provider.required !== false, result: value,
    stdout: provider.protocol ? undefined : String(result.stdout || "").slice(-4000)
  };
}

function providerResultPath(root, repository, capability) {
  return join(root, QUALITY_RESULT_RELATIVE, repository, `${capability}.json`);
}

function baselinePath(root, repository, capability) {
  return join(root, "quality", "baselines", repository, `${capability}-v1.json`);
}

export function createQualityRuntime({
  root, repositoryCatalog, selectedRepositories, canonicalChangedSurface,
  declaredSurfaceMatcher, loadRuntime, git, gitHead, readJson, writeJson,
  pathInside, workspaceManifest = null, fail, log = console.log
}) {
  const configPath = join(root, QUALITY_CONFIG_RELATIVE);
  const repositoriesFor = (change = null) => {
    const state = change ? loadRuntime(change) : null;
    const rows = change ? selectedRepositories(change, state) : repositoryCatalog().repositories;
    return rows.map((repository) => {
      // Runtime state is the source of truth once a change has entered a sandbox.
      // Do not let a stale/cached selector row silently measure the target checkout.
      const runtimePath = state?.repositories?.[repository.id]?.path ||
        (repository.id === "root" ? state?.workspace?.path : null);
      const workspacePath = runtimePath || repository.workspacePath || repository.path;
      return {
      id: repository.id,
      path: workspacePath,
      targetPath: repository.path,
      relativePath: repository.relativePath || relative(root, repository.path) || ".",
      head: gitHead(workspacePath),
      workspaceDigest: configDigest(workspaceManifest
        ? workspaceManifest(workspacePath, change || "consumer-quality", false)
        : { path: workspacePath, head: gitHead(workspacePath) }),
      isSandbox: Boolean(change)
    };
    });
  };

  function discovery(options = {}) {
    return discoverConsumerQuality(repositoriesFor(
      options.change || process.env.FOUNDATION_CHANGE_ID || null));
  }

  function showDiscovery(options = {}) {
    const report = discovery(options);
    log(JSON.stringify(report, null, 2));
    return report;
  }

  function draft(options = {}) {
    const report = discovery(options);
    return defaultConsumerQualityConfig(report.repositories.map((repository) => ({
      id: repository.repository,
      profiles: repository.profiles,
      providers: repository.providers
    })));
  }

  function initialize(options = {}) {
    if (options.ci && options.ci !== "github") fail("quality init --ci currently supports only 'github'");
    const value = draft(options);
    if (options.write) {
      if (existsSync(configPath) && !options.force)
        fail(`${QUALITY_CONFIG_RELATIVE} already exists; inspect it or pass --force`);
      const workflowTemplates = options.ci === "github" ? [
        ["github-actions.yml", "foundation-quality.yml"],
        ["github-actions-nightly.yml", "foundation-quality-nightly.yml"],
        ["github-actions-release.yml", "foundation-quality-release.yml"]
      ] : [];
      for (const [, name] of workflowTemplates) {
        const target = join(root, ".github", "workflows", name);
        if (existsSync(target) && !options.force)
          fail(`.github/workflows/${name} already exists; inspect it or pass --force`);
      }
      writeJson(configPath, value);
      log(`quality configuration written: ${QUALITY_CONFIG_RELATIVE}`);
      if (options.ci === "github") {
        const templateRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..",
          "templates", "quality");
        for (const [source, name] of workflowTemplates) {
          const target = join(root, ".github", "workflows", name);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, readFileSync(join(templateRoot, source)));
          log(`quality CI template written: .github/workflows/${name}`);
        }
      }
    } else {
      log(JSON.stringify(value, null, 2));
      log(`preview only; pass --write to create ${QUALITY_CONFIG_RELATIVE}`);
      if (options.ci === "github")
        log("preview only; --write would also create PR, nightly, and release GitHub workflows");
    }
    return value;
  }

  function configured() {
    if (!existsSync(configPath))
      fail(`missing ${QUALITY_CONFIG_RELATIVE}; run 'claude-foundation quality init --write'`);
    const value = readJson(configPath);
    validateConsumerQualityConfig(value, new Set(repositoryCatalog().repositories.map((row) => row.id)));
    return value;
  }

  function doctor(options = {}) {
    const activeChange = options.change || process.env.FOUNDATION_CHANGE_ID || null;
    const discovered = discovery(options);
    const issues = [];
    let config = null;
    if (!existsSync(configPath)) issues.push({ level: "error", code: "missing-config",
      message: `missing ${QUALITY_CONFIG_RELATIVE}` });
    else {
      try { config = configured(); }
      catch (error) { issues.push({ level: "error", code: "invalid-config", message: error.message }); }
    }
    if (config) for (const repository of config.repositories) {
      const actual = repositoriesFor(activeChange).find((row) => row.id === repository.id);
      if (!actual) { issues.push({ level: "error", code: "repository-not-selected",
        repository: repository.id, message: "configured repository is not selected" }); continue; }
      const capabilities = new Set([
        ...profileCapabilities(repository.profiles), ...Object.keys(repository.providers)
      ]);
      for (const capability of [...capabilities].sort()) {
        const provider = repository.providers[capability];
        if (!provider) issues.push({ level: "warning", code: "provider-unsupported",
          repository: repository.id, capability,
          message: `no ${capability} provider; risk fallback policy applies` });
        else if (provider.command?.length && !executableExists(provider.command[0], actual.path))
          issues.push({ level: "error", code: "tool-unavailable", repository: repository.id,
            capability, message: `executable '${provider.command[0]}' is unavailable` });
        if (capability === "automated-mutation" && provider &&
            !["tool", "harness-sandbox"].includes(provider.isolation))
          issues.push({ level: "error", code: "mutation-not-isolated", repository: repository.id,
            capability, message: "mutation provider requires isolation tool|harness-sandbox" });
      }
    }
    if (config) {
      const configuredIds = new Set(config.repositories.map((repository) => repository.id));
      for (const repository of repositoriesFor(activeChange))
        if (!configuredIds.has(repository.id)) issues.push({ level: "error",
          code: "repository-unconfigured", repository: repository.id,
          message: "selected repository has no consumer quality configuration" });
    }
    const report = {
      protocol: "foundation-quality-doctor-v1", status: issues.some((issue) => issue.level === "error") ? "fail" : "pass",
      config: existsSync(configPath) ? QUALITY_CONFIG_RELATIVE : null, discovery: discovered, issues
    };
    log(JSON.stringify(report, null, 2));
    if (report.status === "fail" && options.enforce) fail("quality doctor failed");
    return report;
  }

  function changedByRepository(change, repositories) {
    const result = new Map(repositories.map((repository) => [repository.id, new Set()]));
    if (!change) return result;
    for (const row of canonicalChangedSurface(change, loadRuntime(change)))
      result.get(row.repositoryId)?.add(row.path);
    return result;
  }

  function scopeIssues(change) {
    if (!change) return [];
    const state = loadRuntime(change);
    const matcher = declaredSurfaceMatcher(change, state);
    return canonicalChangedSurface(change, state)
      .filter((row) => !matcher(row.path))
      .map((row) => ({ repository: row.repositoryId, path: row.path,
        reason: "changed path is outside the declared change surface" }));
  }

  function run(options = {}) {
    const config = configured();
    const shardCount = options["shard-count"] === undefined ? 1 : Number(options["shard-count"]);
    const shardIndex = options["shard-index"] === undefined ? 0 : Number(options["shard-index"]);
    if (!Number.isInteger(shardCount) || shardCount < 1 || !Number.isInteger(shardIndex) ||
        shardIndex < 0 || shardIndex >= shardCount)
      fail("quality run requires integer --shard-count >= 1 and 0 <= --shard-index < count");
    const selectedLane = (repository, capability) =>
      shardCount === 1 || laneShard(repository, capability, shardCount) === shardIndex;
    const activeChange = options.change || process.env.FOUNDATION_CHANGE_ID || null;
    const impact = activeChange ? loadRuntime(activeChange).impact || "medium" : "medium";
    const repositories = repositoriesFor(activeChange)
      .filter((repository) => !options.repository || repository.id === options.repository);
    if (options.repository && !repositories.length) fail(`unknown or unselected repository '${options.repository}'`);
    const changed = changedByRepository(activeChange, repositories);
    const lanes = [];
    for (const repository of repositories) {
      const repositoryConfig = config.repositories.find((row) => row.id === repository.id);
      if (!repositoryConfig) {
        if (selectedLane(repository.id, "configuration")) lanes.push({
          repository: repository.id, capability: "configuration", status: "fail",
          assurance: "missing", required: true,
          reason: "selected repository has no consumer quality configuration"
        });
        continue;
      }
      const configuredChanged = new Set([...(changed.get(repository.id) || [])].filter((path) =>
        (!repositoryConfig.include?.length || pathMatches(path, repositoryConfig.include)) &&
        !pathMatches(path, repositoryConfig.exclude || [])));
      for (const [capability, provider] of Object.entries(repositoryConfig.providers)) {
        if (options.capability && capability !== options.capability) continue;
        if (!selectedLane(repository.id, capability)) continue;
        const laneStarted = performance.now();
        const lane = runQualityProvider({ repository, capability, provider, git, pathInside,
          environment: { FOUNDATION_QUALITY_CHANGE: activeChange || "" } });
        if (lane.result) {
          writeJson(providerResultPath(root, repository.id, capability), lane.result);
          const basePath = baselinePath(root, repository.id, capability);
          const baseline = existsSync(basePath) ? readJsonFile(basePath) : null;
          if (capability === "crap") lane.evaluation = evaluateCrapRatchet({
            current: lane.result, baseline, changedPaths: options.full
              ? new Set(lane.result.functions.map((fn) => fn.path)) : configuredChanged,
            policy: config.policy, exceptions: config.exceptions
          });
          if (capability === "automated-mutation") {
            const mutationPaths = options.full
              ? new Set(lane.result.mutants.map((mutant) => mutant.path))
              : configuredChanged;
            lane.result = classifyMutationSurfaces(lane.result, mutationPaths);
            writeJson(providerResultPath(root, repository.id, capability), lane.result);
            lane.evaluation = evaluateMutationRatchet({ current: lane.result, baseline,
              policy: config.policy, exceptions: config.exceptions });
          }
          if (lane.evaluation?.status === "fail" || lane.evaluation?.summary?.fail > 0) {
            lane.status = "fail";
            lane.reason = "quality ratchet failed";
          }
        }
        lane.durationMs = performance.now() - laneStarted;
        lanes.push(lane);
      }
      for (const capability of profileCapabilities(repositoryConfig.profiles)) {
        if (repositoryConfig.providers[capability] ||
            (options.capability && capability !== options.capability)) continue;
        if (!selectedLane(repository.id, capability)) continue;
        const requirement = capabilityRequirement({
          status: "unsupported", capability, impact, policy: config.policy
        });
        lanes.push({ repository: repository.id, capability,
          status: requirement.blocking ? "unavailable" : "pass",
          assurance: requirement.assurance, reason: requirement.reason,
          required: requirement.blocking });
      }
    }
    for (const lane of lanes.filter((item) => item.assurance === "reduced-requires-evidence")) {
      const compensating = lanes.some((item) => item.repository === lane.repository &&
        item.status === "pass" && item.assurance === "full" &&
        ["test", "static-analysis", "coverage", "semantic-mutation", "integration"]
          .includes(item.capability));
      if (!compensating) {
        lane.status = "unavailable";
        lane.required = true;
        lane.reason = `${lane.reason}; compensating evidence is missing`;
      }
    }
    for (const issue of scopeIssues(activeChange)) lanes.push({
      ...issue, capability: "scope", status: "fail", assurance: "missing", required: true
    });
    const summary = aggregateQualityLanes(lanes);
    summary.generatedAt = new Date().toISOString();
    summary.change = activeChange;
    summary.shard = { index: shardIndex, count: shardCount };
    writeJson(join(root, QUALITY_RESULT_RELATIVE, "summary.json"), summary);
    log(JSON.stringify(summary, null, 2));
    if ((options.enforce || process.env.FOUNDATION_QUALITY_ENFORCE === "1" ||
        config.policy.mode === "enforce") && ["fail", "unavailable"].includes(summary.status))
      fail(`consumer quality gate ${summary.status}`);
    return summary;
  }

  function report() {
    const path = join(root, QUALITY_RESULT_RELATIVE, "summary.json");
    if (!existsSync(path)) fail("no consumer quality result; run 'claude-foundation quality run'");
    const value = readJson(path);
    log(JSON.stringify(value, null, 2));
    return value;
  }

  function baseline(options = {}) {
    const config = configured();
    const changes = [];
    for (const repository of config.repositories) {
      if (options.repository && repository.id !== options.repository) continue;
      for (const capability of ["crap", "automated-mutation"]) {
        if (options.capability && capability !== options.capability) continue;
        const source = providerResultPath(root, repository.id, capability);
        if (!existsSync(source)) continue;
        const target = baselinePath(root, repository.id, capability);
        changes.push({ repository: repository.id, capability,
          source: relative(root, source), target: relative(root, target), value: readJsonFile(source) });
      }
    }
    if (!changes.length) fail("no quality reports are available to baseline");
    if (options.write) {
      if (!options["decision-ref"] || !options.reason)
        fail("quality baseline --write requires --decision-ref and --reason");
      for (const change of changes) writeJson(join(root, change.target), change.value);
      const manifestPath = join(root, "quality", "baselines", "manifest.json");
      const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {
        protocol: "foundation-quality-baseline-manifest-v1", entries: []
      };
      manifest.entries.push({
        updatedAt: new Date().toISOString(),
        decisionRef: options["decision-ref"],
        reason: options.reason,
        reports: changes.map(({ repository, capability, target, value }) => ({
          repository, capability, target,
          tool: value.tool || null,
          repositoryCommit: value.repositoryCommit || null
        }))
      });
      writeJson(manifestPath, manifest);
      log(`quality baseline written: ${changes.length} report(s)`);
    } else {
      log(JSON.stringify(changes.map(({ value: _value, ...change }) => change), null, 2));
      log("preview only; pass --write to update versioned baselines");
    }
    return changes;
  }

  function debt() {
    const summaryPath = join(root, QUALITY_RESULT_RELATIVE, "summary.json");
    if (!existsSync(summaryPath)) fail("no consumer quality result; run 'claude-foundation quality run'");
    const summary = readJson(summaryPath);
    const changedFindings = summary.lanes.flatMap((lane) => {
      const functions = lane.evaluation?.changedFunctions || [];
      return functions.filter((fn) => fn.status === "fail").map((fn) => ({
        id: `${lane.repository}:changed:${fn.path}:${fn.id}`,
        repository: lane.repository, capability: lane.capability,
        target: `${fn.path}:${fn.id}`, reasons: fn.reasons, blocksCurrentChange: true
      }));
    });
    const inventoryFindings = summary.lanes.flatMap((lane) => {
      const functions = lane.result?.functions || [];
      const mutants = lane.result?.mutants || [];
      return [
        ...functions.filter((fn) => fn.crap !== null && fn.crap >= 30)
          .map((fn) => ({ id: `${lane.repository}:crap:${fn.path}:${fn.id}`,
            repository: lane.repository, capability: "crap", target: `${fn.path}:${fn.id}`,
            reasons: [`CRAP ${fn.crap}`], blocksCurrentChange: false })),
        ...mutants.filter((mutant) => ["survived", "no-coverage"].includes(mutant.status))
          .map((mutant) => ({ id: `${lane.repository}:mutation:${mutant.id}`,
            repository: lane.repository, capability: "automated-mutation", target: mutant.id,
            reasons: [mutant.status], blocksCurrentChange:
              mutant.changedSurface !== "legacy-unrelated" }))
      ];
    });
    const capabilityFindings = summary.lanes
      .filter((lane) => lane.assurance?.startsWith("reduced") || lane.status === "unavailable")
      .map((lane) => ({ id: `${lane.repository}:capability:${lane.capability}`,
        repository: lane.repository, capability: lane.capability,
        target: lane.capability, reasons: [lane.reason || lane.status],
        blocksCurrentChange: lane.status === "unavailable" }));
    const findings = [...new Map([...changedFindings, ...inventoryFindings, ...capabilityFindings]
      .map((finding) => [finding.id, finding])).values()]
      .sort((left, right) => left.id.localeCompare(right.id));
    const value = { protocol: "foundation-quality-debt-v1", generatedAt: new Date().toISOString(), findings };
    writeJson(join(root, QUALITY_RESULT_RELATIVE, "debt.json"), value);
    const markdown = [
      "# Consumer Quality Debt", "", `Generated: ${value.generatedAt}`, "",
      "| Repository | Capability | Target | Blocking | Reasons |",
      "|---|---|---|---:|---|",
      ...findings.map((finding) => `| ${finding.repository} | ${finding.capability} | \`${finding.target}\` | ${
        finding.blocksCurrentChange ? "yes" : "no"} | ${finding.reasons.join("; ").replaceAll("|", "\\|")} |`),
      ""
    ].join("\n");
    const markdownPath = join(root, QUALITY_RESULT_RELATIVE, "debt.md");
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, markdown);
    log(JSON.stringify(value, null, 2));
    return value;
  }

  return { discovery, showDiscovery, draft, initialize, configured, doctor, run, report, baseline, debt };
}
