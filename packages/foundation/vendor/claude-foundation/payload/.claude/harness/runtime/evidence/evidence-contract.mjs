import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { measuredNumber } from "../core/measured-number.mjs";
import { isExcludedPath } from "../core/workspace-surface.mjs";
import { classifyReviewRisk } from "./review-routing.mjs";

// Named once and read by both `reviewPolicy` and the change-time forecast. The
// forecast has to answer "will this need a reviewer?" from the same lists, but
// `contractFingerprint` hashes `reviewPolicy`'s returned object — so the answer
// is shared as a constant rather than by widening that return value, which
// would re-fingerprint every in-flight change and invalidate evidence nobody
// asked to re-earn.
export const REVIEW_FORCING_CAPABILITIES = Object.freeze([
  "review", "security-static", "data-migration", "compatibility",
  "cross-repo-contract", "state-identity"
]);
export const REVIEW_DIVERSITY_CAPABILITIES = Object.freeze([
  "security-static", "data-migration", "compatibility"
]);
export const ENVIRONMENT_LOCKFILES = Object.freeze([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
  "Cargo.lock", "go.sum", "Gemfile.lock", "composer.lock"
]);

export function providerRepositoryIds(config, selectedRepositoryIds = () => []) {
  const ids = config?.repositories ||
    (config?.adapter === "contract-digest" ? Object.keys(config.contract || {}) :
      config?.repository ? [config.repository] : selectedRepositoryIds());
  return [...new Set(ids)].sort();
}

export function normalizedAcceptanceValue(state) {
  const value = state.acceptance || {};
  return {
    version: Number(value.version || 1),
    decision: value.decision || (value.required ? "required" : "legacy-not-required"),
    required: Boolean(value.required),
    reason: value.required ? String(value.reason || "").trim() || null : null,
    claimIds: value.required ? [...new Set(value.claimIds || [])].sort() : [],
    scopeOrigin: value.scopeOrigin || null
  };
}

export function configuredProviderValue(providers, provider) {
  if (providers[provider]) return providers[provider];
  if (provider === "discovery" && providers.test?.adapter === "test-discovery")
    return providers.test;
  for (const config of Object.values(providers))
    if (Array.isArray(config.outputs) && config.outputs.includes(provider))
      return config;
  return null;
}

export function providerClaimIdsValue(declared, provider, config, die) {
  if (!config?.claims || config.claims === "declared") return declared;
  if (!Array.isArray(config.claims))
    die(`provider '${provider}' claims must be an array or 'declared'`);
  const forbidden = config.claims.filter((claim) => !declared.includes(claim));
  if (forbidden.length)
    die(`provider '${provider}' config references undeclared claim(s): ${forbidden.join(", ")}`);
  return config.claims;
}

export function providerRepositoryValue(repositoryById, id, config) {
  const repositoryId = config?.repository || null;
  if (!repositoryId) return null;
  return repositoryById(id, repositoryId);
}

export function providerWorkspaceValue(canonicalPath, root, runtime, repository) {
  return canonicalPath(repository?.workspacePath || runtime.workspace?.path || root);
}

export function resolvedAcceptanceValue(state, contract) {
  const normalized = normalizedAcceptanceValue(state);
  const declared = contract.claims.filter((claim) =>
    claim.capabilities.includes("acceptance")).map((claim) => claim.id);
  const claimIds = [...new Set([...normalized.claimIds, ...declared])].sort();
  return {
    ...normalized,
    required: normalized.required || declared.length > 0,
    claimIds,
    scopeOrigin: normalized.scopeOrigin || (declared.length ? "claim-capability" : null)
  };
}

export function executionFingerprintValue(stableHash, adapterProtocolVersion, contract) {
  return stableHash({
    adapterProtocolVersion,
    providers: contract.providers || {},
    services: contract.execution?.services || {}
  });
}

export function providerConfigOperation({ evidence }, id, provider) {
  return configuredProviderValue(evidence(id).providers || {}, provider);
}

export function providerClaimsOperation({
  claimsForProvider,
  providerConfig,
  die
}, id, provider, config = providerConfig(id, provider)) {
  const declared = claimsForProvider(id, provider).map((claim) => claim.id);
  return providerClaimIdsValue(declared, provider, config, die);
}

export function providerRepositoryOperation({
  providerConfig,
  repositoryById
}, id, provider, config = providerConfig(id, provider)) {
  return providerRepositoryValue(repositoryById, id, config);
}

export function providerWorkspaceOperation({
  providerConfig,
  providerRepository,
  canonicalPath,
  loadRuntime,
  root
}, id, provider, config = providerConfig(id, provider)) {
  return providerWorkspaceValue(canonicalPath, root, loadRuntime(id),
    providerRepository(id, provider, config));
}

export function resolvedAcceptanceOperation({
  loadRuntime,
  evidence
}, id, state = loadRuntime(id), contract = evidence(id)) {
  return resolvedAcceptanceValue(state, contract);
}

export function executionFingerprintOperation({
  activeChangePath,
  evidence,
  stableHash,
  adapterProtocolVersion
}, id, dir = activeChangePath(id)) {
  return executionFingerprintValue(stableHash, adapterProtocolVersion, evidence(id, dir));
}

export function environmentWorkspace({ root, repositoryById, loadRuntime }, config, id) {
  if (id && config?.repository)
    return repositoryById(id, config.repository).workspacePath;
  if (id) return loadRuntime(id).workspace?.path || root;
  return root;
}

export function environmentLockfiles(workspace, fileDigest) {
  return ENVIRONMENT_LOCKFILES
    .filter((name) => existsSync(join(workspace, name)))
    .map((name) => ({ path: name, sha256: fileDigest(join(workspace, name)) }));
}

export function environmentDescriptorOperation({
  root,
  repositoryById,
  loadRuntime,
  fileDigest,
  stableHash
}, config = null, id = null) {
  const workspace = environmentWorkspace({ root, repositoryById, loadRuntime }, config, id);
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    declared: config?.environment || null,
    envFingerprint: stableHash({
      literals: config?.env || {},
      inheritedNames: config?.envFrom || []
    }),
    lockfiles: environmentLockfiles(workspace, fileDigest)
  };
}

export function collectReviewSignals(state, contract, configuredCapabilities = []) {
  const capabilities = new Set([
    ...(state.evidenceCapabilities || []),
    ...contract.claims.flatMap((claim) => claim.capabilities || []),
    ...configuredCapabilities
  ]);
  const semantic = `${state.intent || ""} ${(state.securityTriggers || []).join(" ")}`
    .toLowerCase();
  const requiredTriggers = [];
  const diversityTriggers = [];
  const riskClaims = contract.claims.filter((claim) => claim.impact !== "low");
  if (riskClaims.some((claim) => claim.capabilities.some((capability) =>
    REVIEW_FORCING_CAPABILITIES.includes(capability))))
    requiredTriggers.push("risk-capability");
  if (riskClaims.some((claim) => (claim.repositories || []).length > 1))
    requiredTriggers.push("multi-repository-claim");
  if (/\b(concurren|race|deadlock|money|payment|billing|financial|migration|irreversible)\w*\b/.test(semantic))
    requiredTriggers.push("risk-semantics");
  if ((state.securityTriggers || []).length ||
      REVIEW_DIVERSITY_CAPABILITIES.some((value) => capabilities.has(value)))
    diversityTriggers.push("critical-capability");
  if (/\b(money|payment|billing|financial|migration|irreversible)\b/.test(semantic))
    diversityTriggers.push("critical-semantics");
  return { capabilities, requiredTriggers, diversityTriggers };
}

export function assembleReviewPolicy({
  state, signals, riskRoute, policy, riskTiered
}) {
  const { capabilities, requiredTriggers, diversityTriggers } = signals;
  const triggers = [...new Set([...requiredTriggers, ...diversityTriggers])].sort();
  // A project with one model available cannot satisfy diversity with a second
  // provider, so the only remaining path is a person — on every critical
  // change, forever. `review.diversity: "single-model"` in foundation.json
  // trades that for a same-family reviewer, and says so: the waiver is a
  // trigger of its own, so it travels into the review packet and the receipt
  // instead of quietly disappearing.
  //
  // `review.independence: "self"` is the same trade for the other property,
  // for a project driven from a single session: a fresh session is free only
  // when there is a second one to open. It applies at every impact, because
  // the changes that force review are exactly the ones that would otherwise
  // be understated to get past it — and it relaxes nothing else, so a
  // critical self-review still has to satisfy diversity on its own terms.
  //
  // contractFingerprint hashes this whole object, so a project that never
  // opts in must keep producing the byte-identical shape it produced before
  // either waiver existed — otherwise upgrading Foundation would
  // re-fingerprint every in-flight change and invalidate evidence nobody
  // asked to re-earn. Hence each key appears only when its waiver is in force.
  const singleModel = policy.diversity === "single-model";
  const diversityRequired = diversityTriggers.length > 0 ||
    (riskTiered && riskRoute.tier === "high");
  const waived = singleModel && diversityRequired;
  if (waived) triggers.push("diversity-waived-single-model");
  const selfReview = policy.independence === "self";
  if (selfReview) triggers.push("independence-waived-self-review");
  return {
    required: riskTiered
      ? true
      : Boolean(state.reviewRequired || requiredTriggers.length ||
        capabilities.has("review")),
    ...(riskTiered ? {
      tier: riskRoute.tier,
      route: riskRoute.route,
      maxAiAttempts: riskRoute.maxAiAttempts,
      requiresHumanFinal: riskRoute.requiresHumanFinal
    } : {}),
    independence: selfReview ? "self" : "required",
    diversity: diversityRequired && !singleModel ? "required" : "preferred",
    ...(waived ? { diversityWaived: true } : {}),
    ...(selfReview ? { independenceWaived: true } : {}),
    triggers: [...new Set(riskTiered
      ? [...triggers, ...riskRoute.triggers]
      : triggers)].sort()
  };
}

function inputPatternMatches(rel, pattern) {
  if (pattern.endsWith("/**"))
    return rel === pattern.slice(0, -3) || rel.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return rel.startsWith(prefix) && !rel.slice(prefix.length).includes("/");
  }
  return rel === pattern || rel.startsWith(`${pattern.replace(/\/$/, "")}/`);
}

function providerInputCovers(config, repositoryId, rel) {
  return (config.inputs || []).some((raw) => {
    const normalized = raw.replaceAll("\\", "/").replace(/^\.\/+/, "");
    const scoped = normalized.match(/^([a-z0-9][a-z0-9._-]*):(.*)$/i);
    if (scoped && scoped[1] !== repositoryId) return false;
    return inputPatternMatches(rel, scoped ? scoped[2] : normalized);
  });
}

export function commandWorkspaceFiles(config, workspace) {
  const files = [];
  const report = typeof config?.report === "string"
    ? config.report.replaceAll("\\", "/").replace(/^\.\/+/, "") : null;
  for (const token of config?.command || []) {
    if (!token || token.startsWith("-") || isAbsolute(token) ||
        token.split(/[\\/]+/).includes("..")) continue;
    const rel = token.replaceAll("\\", "/").replace(/^\.\/+/, "");
    // A report is an output contract, even when the command receives its path
    // as an argument. Binding it as an input would reject the first run after
    // the file appears and would make the provider depend on its own output.
    if (rel === report) continue;
    const path = join(workspace, rel);
    try {
      if (existsSync(path) && statSync(path).isFile()) files.push(rel);
    } catch {}
  }
  return [...new Set(files)].sort();
}

export function uncoveredCommandWorkspaceFiles({
  config, workspace, repositoryId = "root", tracked = () => false,
  declared = () => false
}) {
  return commandWorkspaceFiles(config, workspace).filter((rel) =>
    !tracked(rel) && !declared(rel) && !providerInputCovers(config, repositoryId, rel));
}

export function providerEvidencePolicy(config = {}) {
  return {
    timeoutMs: Number(config.timeoutMs || 120000),
    minimum: config.minimum ?? null,
    report: config.report || null,
    reportFormat: config.reportFormat || null,
    classification: config.classification || null,
    resultProtocol: config.resultProtocol || null,
    criticalCases: [...(config.criticalCases || [])].sort(),
    requiredMutants: [...(config.requiredMutants || [])].sort(),
    mutantKillers: Object.fromEntries(Object.entries(config.mutantKillers || {})
      .sort(([left], [right]) => left.localeCompare(right))),
    foregroundRequired: Boolean(config.foregroundRequired),
    foregroundAvailable: Boolean(config.foregroundAvailable),
    readiness: config.readiness || null
  };
}

export function providerReceiptWriterConflicts(configuredProviders, capabilityOf) {
  const discoveryWriters = new Map();
  const conflicts = [];
  for (const [provider, config] of Object.entries(configuredProviders || {})) {
    if (config?.adapter !== "test-discovery" ||
        capabilityOf(provider, config) !== "test") continue;
    const output = config.discoveryProvider || "discovery";
    if (output === provider)
      conflicts.push({ output, producers: [provider, provider], kind: "same-provider" });
    const prior = discoveryWriters.get(output);
    if (prior && prior !== provider)
      conflicts.push({ output, producers: [prior, provider], kind: "multiple-producers" });
    discoveryWriters.set(output, provider);
  }
  return conflicts;
}

export function adapterConfigurationIdentity(config = {}, command = null) {
  return {
    repository: config.repository || null,
    adapter: config.adapter || "external",
    adapterVersion: String(config.version || "1"),
    command: command || config.command || null,
    inputMode: config.inputMode || null,
    project: config.project || null,
    outputs: config.outputs || [],
    resources: config.resources || null,
    dependsOn: config.dependsOn || []
  };
}

export function adapterServiceIdentity(context, id, config = {}) {
  if (!config.service) return null;
  return {
    name: config.service,
    config: context.evidence(id).execution?.services?.[config.service] || null
  };
}

export function createAdapterFingerprint(context, id, provider, config, command = null) {
  const identity = adapterConfigurationIdentity(config, command);
  return context.stableHash({
    adapterProtocolVersion: context.adapterProtocolVersion,
    providerProtocolVersion: context.providerProtocolVersion,
    provider,
    capability: context.providerCapability(provider, config),
    repository: identity.repository,
    repositories: context.providerRepositories(id, provider, config)
      .map((repository) => repository.id),
    adapter: identity.adapter,
    adapterVersion: identity.adapterVersion,
    command: identity.command,
    claims: context.providerClaims(id, provider, config),
    environment: context.environmentDescriptor(config, id),
    inputMode: identity.inputMode,
    project: identity.project,
    outputs: identity.outputs,
    resources: identity.resources,
    dependsOn: identity.dependsOn,
    service: adapterServiceIdentity(context, id, config),
    executionPolicy: providerEvidencePolicy(config)
  });
}

export function providerHashField(capability, packetBound) {
  if (capability === "review") return "reviewHash";
  return packetBound ? "workspaceHash" : "codeHash";
}

export function providerHashExplicitlyScoped(config) {
  return Boolean(config?.repository || config?.repositories ||
    config?.adapter === "contract-digest");
}

export function repositoryFieldHash(context, id, snapshot, repository, field) {
  return snapshot.repositories?.[repository.id]?.[field] ||
    context.singleRelevantSnapshot(id, repository.workspacePath, true)[field];
}

export function providerWorkspaceHashOperation(context, id, provider, fallback = null) {
  const config = context.providerConfig(id, provider);
  const capability = context.providerCapability(provider, config);
  const field = providerHashField(
    capability, context.packetBoundCapability(id, provider));
  const explicitlyScoped = providerHashExplicitlyScoped(config);
  const repositories = context.providerRepositories(id, provider, config);
  if (!explicitlyScoped) {
    if (field === "workspaceHash") return fallback || context.relevantHash(id);
    return context.relevantSnapshot(id)[field] || fallback || context.relevantHash(id);
  }
  const snapshot = context.relevantSnapshot(id);
  if (repositories.length === 1)
    return repositoryFieldHash(context, id, snapshot, repositories[0], field);
  return context.stableHash({
    version: 1,
    field,
    repositories: repositories.map((repository) => ({
      id: repository.id,
      hash: repositoryFieldHash(context, id, snapshot, repository, field)
    }))
  });
}

export function normalizedProviderInputPatterns(inputs = []) {
  return [...new Set(inputs.map((item) =>
    item.replaceAll("\\", "/").replace(/^\.\/+/, "")))].sort();
}

export function providerInputRoots(context, id, workspace, patterns) {
  const scoped = patterns.filter((pattern) => /^[a-z0-9][a-z0-9._-]*:/i.test(pattern));
  const roots = new Map([
    [workspace, patterns.filter((pattern) => !scoped.includes(pattern))]
  ]);
  for (const pattern of scoped) {
    const separator = pattern.indexOf(":");
    const repositoryId = pattern.slice(0, separator);
    const rest = pattern.slice(separator + 1);
    const root = context.canonicalPath(context.repositoryById(id, repositoryId).workspacePath);
    roots.set(root, [...(roots.get(root) || []), rest]);
  }
  return roots;
}

export function collectProviderInputFiles(context, dir, base, patterns, label, files) {
  for (const entry of context.readDirectory(dir, { withFileTypes: true })) {
    if (context.excludedDirectories.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectProviderInputFiles(context, path, base, patterns, label, files);
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const rel = relative(base, path).replaceAll("\\", "/");
    if (patterns.some((pattern) => context.inputPatternMatches(rel, pattern)))
      files.push({
        path: label ? `${label}:${rel}` : rel,
        identity: context.filesystemEntryIdentity(path)
      });
  }
}

export function sortProviderInputFiles(files) {
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export function providerInputIdentityOperation(context, id, provider,
    config = context.providerConfig(id, provider), globalHash = null) {
  const workspace = context.canonicalPath(context.providerWorkspace(id, provider, config));
  if (!Array.isArray(config?.inputs) || config.inputs.length === 0) {
    const workspaceHash = globalHash || context.providerWorkspaceHash(id, provider);
    return {
      mode: "global",
      patterns: [],
      files: [],
      fingerprint: context.stableHash({ mode: "global", workspaceHash })
    };
  }
  const patterns = normalizedProviderInputPatterns(config.inputs);
  const roots = providerInputRoots(context, id, workspace, patterns);
  const files = [];
  for (const [base, scopePatterns] of roots) {
    if (!scopePatterns.length || !context.pathExists(base)) continue;
    collectProviderInputFiles(context, base, base, scopePatterns,
      base === workspace ? null : context.repositoryLabel(id, base), files);
  }
  sortProviderInputFiles(files);
  return {
    mode: "declared",
    patterns,
    files,
    fingerprint: context.stableHash({ mode: "declared", patterns, files })
  };
}

export function claimsForCapability(context, id, claims, capability) {
  if (capability === "review") return context.scopedReviewClaims(claims);
  if (capability === "acceptance") {
    const ids = context.resolvedAcceptance(
      id, context.loadRuntime(id), context.evidence(id)).claimIds;
    return claims.filter((claim) => ids.includes(claim.id));
  }
  if (context.policyCapabilities(id).includes(capability)) return claims;
  return claims.filter((claim) =>
    claim.capabilities.includes(capability) ||
    (capability === "discovery" && claim.capabilities.includes("test")));
}

export function providerClaimRepositories(config) {
  if (config?.repositories) return config.repositories;
  if (config?.adapter === "contract-digest") return Object.keys(config.contract || {});
  if (config?.repository) return [config.repository];
  return null;
}

export function claimsInRepositories(claims, repositories) {
  if (!repositories) return claims;
  return claims.filter((claim) =>
    !claim.repositories || claim.repositories.some((repository) =>
      repositories.includes(repository)));
}

export function claimsForProviderOperation(context, id, provider) {
  const claims = context.evidence(id).claims;
  const config = context.providerConfig(id, provider);
  const capability = context.providerCapability(provider, config);
  const scoped = claimsForCapability(context, id, claims, capability);
  return claimsInRepositories(scoped, providerClaimRepositories(config));
}

export function createEvidenceContract({
  ROOT, PROVIDERS, ADAPTERS, INPUT_MODES, EXCLUDED_WORKSPACE_DIRS,
  ADAPTER_PROTOCOL_VERSION, PROVIDER_PROTOCOL_VERSION,
  activeChangePath, readJson, repositoryById, selectedRepositories, providerCapability,
  canonicalPath, loadRuntime, relevantHash,
  relevantSnapshot, singleRelevantSnapshot, fileDigest, stableHash,
  filesystemEntryIdentity,
  policyCapabilities, foundationPolicy, handoffContract, git, declaredSurfaceMatcher, die
}) {
  function executionServiceSource(id, name, service) {
    const commandValid = Array.isArray(service?.command) &&
      service.command.length &&
      service.command.every((part) => typeof part === "string" && part);
    const staticRootValid = typeof service?.staticRoot === "string" &&
      service.staticRoot.trim() &&
      !isAbsolute(service.staticRoot) &&
      !service.staticRoot.split(/[\\/]+/).includes("..");
    if (!service || (!commandValid && !staticRootValid) ||
        (commandValid && staticRootValid))
      die(`service '${name}' requires exactly one of command or workspace-relative staticRoot`);
    return { staticRootValid };
  }

  function validateServiceReadiness(name, service, staticRootValid) {
    if (!service.readiness?.url)
      die(`service '${name}' requires readiness.url`);
    if (staticRootValid) {
      let protocol;
      try { protocol = new URL(service.readiness.url).protocol; } catch {}
      if (protocol !== "http:")
        die(`service '${name}' staticRoot readiness.url must use http`);
    }
    if (!service.readiness.expectBody && !service.readiness.expectHeader)
      die(`service '${name}' readiness requires expectBody or expectHeader identity`);
  }

  function validateServiceResources(name, service) {
    if (service.resources !== undefined &&
        (!Array.isArray(service.resources) ||
         service.resources.some((item) => typeof item !== "string" || !item)))
      die(`service '${name}' resources must be an array of strings`);
  }

  function validateServiceEnvironment(name, service) {
    if (service.env !== undefined &&
        (!service.env || typeof service.env !== "object" || Array.isArray(service.env)))
      die(`service '${name}' env must be an object`);
    const secretKey = Object.keys(service.env || {}).find((key) =>
      /(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)/i.test(key));
    if (secretKey)
      die(`service '${name}' must use envFrom for secret-like key '${secretKey}'`);
    if (service.envFrom !== undefined &&
        (!Array.isArray(service.envFrom) ||
         service.envFrom.some((value) => typeof value !== "string" ||
           !/^[A-Z][A-Z0-9_]*$/.test(value))))
      die(`service '${name}' envFrom must contain environment variable names`);
  }

  function validateExecutionService(id, name, service) {
    const { staticRootValid } = executionServiceSource(id, name, service);
    validateServiceReadiness(name, service, staticRootValid);
    validateServiceResources(name, service);
    if (service.repository !== undefined)
      repositoryById(id, service.repository);
    validateServiceEnvironment(name, service);
  }

  function rawExecution(id, dir = activeChangePath(id)) {
    const path = join(dir, "execution.yaml");
    if (!existsSync(path)) return { version: 1, providers: {}, services: {} };
    const value = readJson(path);
    if (value.version !== 1 || !value.providers || typeof value.providers !== "object" ||
        Array.isArray(value.providers))
      die(`${id}/execution.yaml requires version 1 and a providers object`);
    if (value.services !== undefined &&
        (!value.services || typeof value.services !== "object" || Array.isArray(value.services)))
      die(`${id}/execution.yaml services must be an object`);
    for (const [name, service] of Object.entries(value.services || {}))
      validateExecutionService(id, name, service);
    return { services: {}, ...value };
  }
  
  function scopedReviewClaims(claims) {
    const scoped = claims.filter((claim) =>
      claim.impact === "high" ||
      claim.capabilities.some((capability) => [
        "review", "security-static", "compatibility", "data-migration",
        "cross-repo-contract", "state-identity"
      ].includes(capability)));
    return scoped.length ? scoped : claims;
  }

  function validateEvidenceClaims(id, value) {
    if (![1, 2].includes(value.version) || !Array.isArray(value.claims) || value.claims.length === 0)
      die(`${id}/evidence.yaml must contain at least one claim`);
    if (value.version === 2 && (value.providers === null ||
        typeof (value.providers || {}) !== "object" || Array.isArray(value.providers)))
      die(`${id}/evidence.yaml providers must be an object`);
    const ids = new Set();
    for (const claim of value.claims) {
      if (!claim.id || ids.has(claim.id))
        die("evidence claim IDs must be non-empty and unique");
      ids.add(claim.id);
      if (!claim.scenario || !Array.isArray(claim.capabilities) || claim.capabilities.length === 0)
        die(`claim '${claim.id}' needs scenario and capabilities`);
      for (const capability of claim.capabilities)
        if (!PROVIDERS.has(capability))
          die(`claim '${claim.id}' uses unknown provider '${capability}'`);
    }
  }

  function validateProviderIdentity(id, provider, config) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider))
      die(`invalid provider instance id '${provider}'`);
    if (!config || typeof config !== "object" || Array.isArray(config))
      die(`provider '${provider}' configuration must be an object`);
    const capability = providerCapability(provider, config);
    if (!capability || !PROVIDERS.has(capability))
      die(`provider '${provider}' requires a known capability`);
    if (!ADAPTERS.has(config.adapter))
      die(`provider '${provider}' uses unknown adapter '${config.adapter || ""}'`);
    if (config.repository !== undefined) repositoryById(id, config.repository);
    return capability;
  }

  function validateProviderRepositories(id, provider, config) {
    if (config.repositories === undefined) return;
    if (!Array.isArray(config.repositories) || config.repositories.length === 0 ||
        config.repositories.some((repository) =>
          typeof repository !== "string" || !repository.trim()) ||
        new Set(config.repositories).size !== config.repositories.length)
      die(`provider '${provider}' repositories must be a non-empty array of unique repository IDs`);
    for (const repository of config.repositories) repositoryById(id, repository);
    if (config.repository && !config.repositories.includes(config.repository))
      die(`provider '${provider}' cwd repository '${config.repository}' must appear in repositories`);
  }

  function validateProviderCommand(provider, config) {
    if (!["external", "contract-digest"].includes(config.adapter) &&
        (!Array.isArray(config.command) || config.command.length === 0 ||
         config.command.some((part) => typeof part !== "string" || !part)))
      die(`provider '${provider}' adapter '${config.adapter}' requires a non-empty command array`);
  }

  function validateContractDigest(id, provider, config) {
    if (config.adapter !== "contract-digest") return;
    const sides = config.contract;
    if (!sides || typeof sides !== "object" || Array.isArray(sides) ||
        Object.keys(sides).length < 2)
      die(`provider '${provider}' contract-digest requires "contract" mapping at least two repository ids to a file path`);
    for (const [repository, path] of Object.entries(sides)) {
      if (typeof path !== "string" || !path.trim())
        die(`provider '${provider}' contract-digest path for '${repository}' must be a non-empty string`);
      repositoryById(id, repository);
    }
    if (config.repository !== undefined)
      die(`provider '${provider}' contract-digest spans repositories and cannot declare a single 'repository'`);
    if (config.repositories !== undefined) {
      const contractRepositories = Object.keys(sides).sort();
      const declaredRepositories = [...config.repositories].sort();
      if (JSON.stringify(contractRepositories) !== JSON.stringify(declaredRepositories))
        die(`provider '${provider}' repositories must exactly match its contract repositories`);
    }
  }

  function warnProviderReportSurface(provider, config) {
    if (typeof config.report !== "string" || !config.report.trim() ||
        isExcludedPath(config.report.replaceAll("\\", "/"),
          { excluded: EXCLUDED_WORKSPACE_DIRS })) return;
    console.error(`WARNING: provider '${provider}' writes its report to ${config.report}, inside the hashed workspace surface; its own output will expire the receipt it produces. Write it under one of: ${
      [...EXCLUDED_WORKSPACE_DIRS].filter((dir) => !dir.startsWith(".")).join(", ")}`);
  }

  function validateDiscoveryProvider(provider, config, capability, configuredProviders) {
    if (config.adapter !== "test-discovery") return;
    if (!["test", "discovery"].includes(capability))
      die("test-discovery adapter requires capability 'test' or 'discovery'");
    if (capability !== "test" || provider === "test") return;
    const discoveryProvider = config.discoveryProvider;
    if (!discoveryProvider || !configuredProviders[discoveryProvider] ||
        providerCapability(discoveryProvider, configuredProviders[discoveryProvider]) !== "discovery")
      die(`provider '${provider}' test-discovery requires a configured discoveryProvider`);
  }

  function validateProviderResourceLimits(provider, config) {
    if (config.timeoutMs !== undefined &&
        (measuredNumber(config.timeoutMs) === null || measuredNumber(config.timeoutMs) <= 0))
      die(`provider '${provider}' timeoutMs must be a positive number`);
    if (config.resources !== undefined &&
        (!Array.isArray(config.resources) ||
         config.resources.some((item) => typeof item !== "string" || !item)))
      die(`provider '${provider}' resources must be an array of strings`);
  }

  function validateProviderInputs(id, provider, config, capability) {
    if (config.inputs !== undefined &&
        (!Array.isArray(config.inputs) || config.inputs.length === 0 ||
         config.inputs.some((item) => typeof item !== "string" || !item ||
           isAbsolute(item) || item.split(/[\\/]/).includes(".."))))
      die(`provider '${provider}' inputs must be non-empty workspace-relative paths`);
    if (config.inputs !== undefined) {
      const scopedRepositories = new Set(config.repositories ||
        (config.adapter === "contract-digest" ? Object.keys(config.contract || {}) :
          config.repository ? [config.repository] : selectedRepositories(id).map((row) => row.id)));
      for (const input of config.inputs) {
        const scoped = input.match(/^([a-z0-9][a-z0-9._-]*):(.*)$/i);
        if (scoped && !scopedRepositories.has(scoped[1]))
          die(`provider '${provider}' input '${input}' references repository outside its repository scope`);
      }
    }
    if (["review", "acceptance", "semantic-acceptance"].includes(capability) &&
        config.inputs !== undefined)
      die(`${capability} capability cannot declare reusable inputs; it is bound to the full workspace`);
  }

  function validateCommandWorkspaceInputs(id, provider, config) {
    if (["external", "contract-digest"].includes(config.adapter)) return;
    const repositoryId = config.repository || "root";
    const repository = selectedRepositories(id).find((row) => row.id === repositoryId);
    const workspace = canonicalPath(repository?.workspacePath || repository?.path || ROOT);
    const declared = declaredSurfaceMatcher(id, loadRuntime(id));
    const uncovered = uncoveredCommandWorkspaceFiles({
      config, workspace, repositoryId, declared,
      tracked: (rel) => git(["ls-files", "--error-unmatch", "--", rel], workspace).status === 0
    });
    if (uncovered.length)
      die(`provider '${provider}' command names untracked workspace file(s) outside its inputs and declared surface: ${
        uncovered.join(", ")}; add provider inputs or declare the paths in the change surface`);
  }

  function validateMutationProtocol(provider, config, capability) {
    if (config.resultProtocol !== "foundation-mutation-v2") return;
    if (capability !== "mutation")
      die(`provider '${provider}' foundation-mutation-v2 requires capability 'mutation'`);
    if (!Array.isArray(config.requiredMutants) || config.requiredMutants.length === 0 ||
        config.requiredMutants.some((item) => typeof item !== "string" || !item.trim()) ||
        new Set(config.requiredMutants).size !== config.requiredMutants.length)
      die(`provider '${provider}' foundation-mutation-v2 requires unique requiredMutants IDs`);
    if (!config.mutantKillers || typeof config.mutantKillers !== "object" ||
        Array.isArray(config.mutantKillers) ||
        config.requiredMutants.some((id) => !String(config.mutantKillers[id] || "").trim()) ||
        Object.keys(config.mutantKillers).some((id) => !config.requiredMutants.includes(id)))
      die(`provider '${provider}' foundation-mutation-v2 requires one mutantKillers mapping per required mutant`);
  }

  function validateProviderProtocols(provider, config, capability) {
    if (config.reportFormat !== undefined && !["json", "tap", "spec", "auto"].includes(config.reportFormat))
      die(`provider '${provider}' reportFormat must be json|tap|spec|auto`);
    if (config.resultProtocol !== undefined &&
        !["foundation-mutation-v1", "foundation-mutation-v2"].includes(config.resultProtocol))
      die(`provider '${provider}' resultProtocol must be foundation-mutation-v1|foundation-mutation-v2`);
    if (config.criticalCases !== undefined &&
        (!Array.isArray(config.criticalCases) ||
         config.criticalCases.some((item) => typeof item !== "string" || !item.trim())))
      die(`provider '${provider}' criticalCases must be an array of non-empty IDs`);
    if (config.criticalCases?.length && ["external", "contract-digest"].includes(config.adapter))
      die(`provider '${provider}' adapter '${config.adapter}' cannot execute criticalCases; use a structured command adapter`);
    if (config.criticalCases?.length &&
        !["json", "tap", "spec"].includes(config.reportFormat))
      die(`provider '${provider}' criticalCases requires an explicit machine-readable reportFormat json|tap|spec; auto or plain output cannot prove stable case IDs before Build`);
    if (config.criticalCases?.length && config.reportFormat === "spec" &&
        !(Array.isArray(config.command) && config.command.some((part) =>
          part === "--test" || String(part).startsWith("--test="))))
      die(`provider '${provider}' criticalCases with reportFormat 'spec' requires a Node --test command; use --test, tap, or a JSON report before Build`);
    validateMutationProtocol(provider, config, capability);
  }

  function validateProviderRelationships(provider, config, configuredProviders, executionValue) {
    if (config.dependsOn !== undefined &&
        (!Array.isArray(config.dependsOn) || config.dependsOn.some((item) =>
          !configuredProviders[item] && !PROVIDERS.has(item))))
      die(`provider '${provider}' dependsOn contains an unknown provider`);
    if (config.dependsOn?.includes(provider))
      die(`provider '${provider}' cannot depend on itself`);
    if (config.outputs !== undefined &&
        (!Array.isArray(config.outputs) || config.outputs.some((item) =>
          !configuredProviders[item] && !PROVIDERS.has(item))))
      die(`provider '${provider}' outputs contains an unknown provider`);
    if (config.service !== undefined &&
        (!executionValue.services || !executionValue.services[config.service]))
      die(`provider '${provider}' references unknown service '${config.service}'`);
  }

  function validateProviderEnvironment(provider, config) {
    if (config.env !== undefined &&
        (!config.env || typeof config.env !== "object" || Array.isArray(config.env) ||
         Object.values(config.env).some((value) =>
           !["string", "number", "boolean"].includes(typeof value))))
      die(`provider '${provider}' env must be an object of scalar values`);
    if (config.envFrom !== undefined &&
        (!Array.isArray(config.envFrom) || config.envFrom.some((value) =>
          typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value))))
      die(`provider '${provider}' envFrom must contain environment variable names`);
    const secretKey = Object.keys(config.env || {}).find((key) =>
      /(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)/i.test(key));
    if (secretKey)
      die(`provider '${provider}' must use envFrom for secret-like key '${secretKey}'`);
    if (config.report !== undefined &&
        (typeof config.report !== "string" || isAbsolute(config.report) ||
         resolve(ROOT, config.report) === ROOT ||
         !resolve(ROOT, config.report).startsWith(`${ROOT}/`)))
      die(`provider '${provider}' report must be a workspace-relative path`);
  }

  function validateProviderReadiness(provider, config) {
    if (config.readiness === undefined) return;
    if (!config.readiness || typeof config.readiness !== "object" ||
        typeof config.readiness.url !== "string")
      die(`provider '${provider}' readiness requires a URL`);
    try { new URL(config.readiness.url); }
    catch { die(`provider '${provider}' readiness URL is invalid`); }
    if (config.readiness.expectStatus !== undefined &&
        (!Number.isInteger(Number(config.readiness.expectStatus)) ||
         Number(config.readiness.expectStatus) < 100 ||
         Number(config.readiness.expectStatus) > 599))
      die(`provider '${provider}' readiness expectStatus must be an HTTP status`);
    if (config.readiness.expectBody !== undefined &&
        typeof config.readiness.expectBody !== "string")
      die(`provider '${provider}' readiness expectBody must be a string`);
    if (config.readiness.expectHeader !== undefined &&
        (!config.readiness.expectHeader ||
         typeof config.readiness.expectHeader !== "object" ||
         Array.isArray(config.readiness.expectHeader)))
      die(`provider '${provider}' readiness expectHeader must be an object`);
  }

  function validateProviderCi(provider, config) {
    if (config.ci === undefined) return;
    if (config.adapter !== "external" || !config.ci || typeof config.ci !== "object" ||
        typeof config.ci.issuer !== "string" || !config.ci.issuer.trim() ||
        typeof config.ci.publicKey !== "string" || !config.ci.publicKey.includes("PUBLIC KEY"))
      die(`provider '${provider}' ci verification requires external adapter, issuer, and publicKey`);
  }

  function validateCapabilityConfiguration(provider, config, capability) {
    if (config.adapter === "playwright" && config.inputMode &&
        !INPUT_MODES.has(config.inputMode))
      die(`provider '${provider}' has invalid inputMode '${config.inputMode}'`);
    const defaultInputMode = config.adapter === "playwright" ? "browser-automation" : "";
    if (capability === "browser" && config.adapter !== "external" &&
        !INPUT_MODES.has(config.inputMode || defaultInputMode))
      die("configured browser provider requires a valid inputMode");
    if (capability === "mutation" && config.adapter !== "external" &&
        config.resultProtocol !== "foundation-mutation-v2" &&
        !["behavioral-kill", "test-failure"].includes(config.classification))
      die("configured mutation provider requires classification behavioral-kill|test-failure");
    if (capability === "review" && config.adapter !== "external")
      die("review capability requires an external provider");
    if (capability === "acceptance" && config.adapter !== "external")
      die("acceptance capability requires an external human provider");
    if (capability === "semantic-acceptance") {
      if (config.adapter !== "external")
        die("semantic-acceptance capability requires an external signed verdict provider");
      if (!config.semanticAcceptance ||
          typeof config.semanticAcceptance.issuer !== "string" ||
          !config.semanticAcceptance.issuer.trim() ||
          typeof config.semanticAcceptance.publicKey !== "string" ||
          !config.semanticAcceptance.publicKey.includes("PUBLIC KEY"))
        die(`provider '${provider}' semanticAcceptance requires issuer and publicKey`);
      if (!Array.isArray(config.acceptanceCases) || config.acceptanceCases.length === 0)
        die(`provider '${provider}' semantic-acceptance requires acceptanceCases`);
      const ids = new Set();
      for (const [index, row] of config.acceptanceCases.entries()) {
        if (!row || typeof row !== "object" ||
            !String(row.id || "").trim() || !String(row.claimId || "").trim() ||
            !String(row.partition || "").trim())
          die(`provider '${provider}' acceptanceCases[${index}] requires id, claimId, and partition`);
        if (ids.has(row.id))
          die(`provider '${provider}' acceptanceCases has duplicate id '${row.id}'`);
        if (Boolean(row.sourceProvider) !== Boolean(row.criticalCaseId))
          die(`provider '${provider}' acceptanceCases[${index}] must declare sourceProvider and criticalCaseId together`);
        if (row.requiresFailToPass !== undefined && typeof row.requiresFailToPass !== "boolean")
          die(`provider '${provider}' acceptanceCases[${index}].requiresFailToPass must be boolean`);
        ids.add(row.id);
      }
    }
    validateProviderCi(provider, config);
  }

  function validateSemanticAcceptanceClaims(provider, config, capability, claims) {
    if (capability !== "semantic-acceptance") return;
    const declared = new Set(claims.filter((claim) =>
      claim.capabilities.includes("semantic-acceptance")).map((claim) => claim.id));
    const unknown = config.acceptanceCases
      .map((row) => row.claimId).filter((claimId) => !declared.has(claimId));
    if (unknown.length)
      die(`provider '${provider}' acceptanceCases reference claim(s) without semantic-acceptance: ${
        [...new Set(unknown)].join(", ")}`);
  }

  function validateSemanticAcceptanceSources(provider, config, capability,
      configuredProviders) {
    if (capability !== "semantic-acceptance") return;
    for (const row of config.acceptanceCases) {
      if (!row.sourceProvider) continue;
      const source = configuredProviders[row.sourceProvider];
      if (!source || row.sourceProvider === provider)
        die(`provider '${provider}' acceptance case '${row.id}' has invalid sourceProvider '${row.sourceProvider}'`);
      if (!(source.criticalCases || []).includes(row.criticalCaseId))
        die(`provider '${provider}' acceptance case '${row.id}' source does not declare critical case '${row.criticalCaseId}'`);
    }
  }

  function validateProviderClaimCoverage(provider, config, capability, claims) {
    const declaredForProvider = (capability === "review"
      ? scopedReviewClaims(claims)
      : claims.filter((claim) => claim.capabilities.includes(capability) ||
        (capability === "discovery" && claim.capabilities.includes("test"))))
      .map((claim) => claim.id);
    if (config.claims === undefined || config.claims === "declared") return;
    if (!Array.isArray(config.claims))
      die(`provider '${provider}' claims must be an array or 'declared'`);
    const forbidden = config.claims.filter((claim) => !declaredForProvider.includes(claim));
    if (forbidden.length)
      die(`provider '${provider}' config references undeclared claim(s): ${forbidden.join(", ")}`);
    const missing = declaredForProvider.filter((claim) => !config.claims.includes(claim));
    if (missing.length)
      die(`provider '${provider}' config must cover every declared claim: ${missing.join(", ")}`);
  }

  function validateConfiguredProvider(id, provider, config, context) {
    const capability = validateProviderIdentity(id, provider, config);
    validateProviderRepositories(id, provider, config);
    validateProviderCommand(provider, config);
    validateContractDigest(id, provider, config);
    warnProviderReportSurface(provider, config);
    validateDiscoveryProvider(provider, config, capability, context.configuredProviders);
    validateProviderResourceLimits(provider, config);
    validateProviderInputs(id, provider, config, capability);
    validateCommandWorkspaceInputs(id, provider, config);
    validateProviderProtocols(provider, config, capability);
    validateProviderRelationships(provider, config, context.configuredProviders,
      context.executionValue);
    validateProviderEnvironment(provider, config);
    validateProviderReadiness(provider, config);
    validateCapabilityConfiguration(provider, config, capability);
    validateProviderClaimCoverage(provider, config, capability, context.claims);
    validateSemanticAcceptanceClaims(provider, config, capability, context.claims);
    validateSemanticAcceptanceSources(provider, config, capability,
      context.configuredProviders);
  }
  
  function evidence(id, dir = activeChangePath(id)) {
    const path = join(dir, "evidence.yaml");
    const value = readJson(path);
    validateEvidenceClaims(id, value);
    const executionValue = rawExecution(id, dir);
    const configuredProviders = {
      ...(value.providers || {}),
      ...(executionValue.providers || {})
    };
    for (const [provider, config] of Object.entries(configuredProviders)) {
      validateConfiguredProvider(id, provider, config, {
        configuredProviders, executionValue, claims: value.claims
      });
    }
    const writerConflict = providerReceiptWriterConflicts(
      configuredProviders, providerCapability)[0];
    if (writerConflict?.kind === "same-provider")
      die(`provider '${writerConflict.output}' cannot write both test and discovery into the same receipt identity; configure a distinct discoveryProvider`);
    if (writerConflict)
      die(`discovery receipt '${writerConflict.output}' has multiple writers ('${
        writerConflict.producers.join("', '")}'); each durable provider receipt requires one producer`);
    return { ...value, providers: configuredProviders, execution: executionValue };
  }
  
  function builtInProviderConfig(id, provider) {
    if (provider !== "dependency-supply-chain") return null;
    let repositories;
    try { repositories = selectedRepositories(id).filter((row) => row.mode === "write"); }
    catch { return null; }
    const candidates = repositories.filter((repository) =>
      existsSync(join(repository.workspacePath, "package.json")) &&
      existsSync(join(repository.workspacePath, "package-lock.json")));
    if (candidates.length !== 1) return null;
    const repository = candidates[0];
    return {
      adapter: "command",
      capability: "dependency-supply-chain",
      version: "2",
      command: ["node", join(ROOT, ".claude", "harness", "runtime", "evidence",
        "npm-lockfile-check.mjs")],
      repository: repository.id === "root" ? undefined : repository.id,
      // Workspace/local manifests and npm configuration affect the install
      // plan too. Whole-workspace binding avoids reusing incomplete evidence.
      builtIn: "npm-lockfile-consistency-v2"
    };
  }

  function providerConfig(id, provider) {
    return configuredProviderValue(evidence(id).providers || {}, provider) ||
      builtInProviderConfig(id, provider);
  }

  const resolvedAcceptance = resolvedAcceptanceOperation.bind(null, {
    loadRuntime,
    evidence
  });

  const claimsForProvider = claimsForProviderOperation.bind(null, {
    evidence,
    providerConfig,
    providerCapability,
    scopedReviewClaims,
    resolvedAcceptance,
    loadRuntime,
    policyCapabilities
  });
  
  const providerClaims = providerClaimsOperation.bind(null, {
    claimsForProvider,
    providerConfig,
    die
  });
  
  const providerRepository = providerRepositoryOperation.bind(null, {
    providerConfig,
    repositoryById
  });

  function providerRepositories(id, provider, config = providerConfig(id, provider)) {
    return providerRepositoryIds(config,
      () => selectedRepositories(id).map((row) => row.id))
      .map((repositoryId) => repositoryById(id, repositoryId));
  }
  
  const providerWorkspace = providerWorkspaceOperation.bind(null, {
    providerConfig,
    providerRepository,
    canonicalPath,
    loadRuntime,
    root: ROOT
  });
  
  // Which hash a provider's receipt is bound to, and therefore what expires it.
  //
  // `review` and `acceptance` are verdicts about the packet as much as the code
  // — a reviewer read the proposal — so they stay bound to the whole surface.
  // Everything else runs a command that cannot read `design.md`, and binding it
  // to the packet charged a full provider re-run for a note added after
  // proving. Those bind the code hash instead.
  //
  // The `fallback` a proof run passes in is the run's full workspace hash, so
  // it cannot answer for the code-bound half; the snapshot is read instead. In
  // a run that is the same cached snapshot the run created, so recording and
  // checking still agree on one value.
  function packetBoundCapability(id, provider) {
    return ["review", "acceptance", "semantic-acceptance"]
      .includes(providerCapability(provider, providerConfig(id, provider)));
  }

  const providerWorkspaceHash = providerWorkspaceHashOperation.bind(null, {
    providerConfig, providerCapability, packetBoundCapability, providerRepositories,
    relevantHash, relevantSnapshot, singleRelevantSnapshot, stableHash
  });
  
  // Which repository a scoped input root belongs to, for a stable label in the
  // recorded file list.
  function repositoryLabel(id, workspacePath) {
    for (const repository of selectedRepositories(id))
      if (canonicalPath(repository.workspacePath) === workspacePath) return repository.id;
    return null;
  }

  const providerInputIdentity = providerInputIdentityOperation.bind(null, {
    providerConfig,
    providerWorkspace,
    providerWorkspaceHash,
    canonicalPath,
    repositoryById,
    repositoryLabel,
    pathExists: existsSync,
    readDirectory: readdirSync,
    excludedDirectories: EXCLUDED_WORKSPACE_DIRS,
    inputPatternMatches,
    filesystemEntryIdentity,
    stableHash
  });
  
  const environmentDescriptor = environmentDescriptorOperation.bind(null, {
    root: ROOT,
    repositoryById,
    loadRuntime,
    fileDigest,
    stableHash
  });
  
  function contractFingerprint(id, dir = activeChangePath(id)) {
    const state = loadRuntime(id);
    const contract = evidence(id, dir);
    return stableHash({
      intent: state.intent,
      impact: state.impact,
      coupling: state.coupling,
      reviewRequired: Boolean(state.reviewRequired),
      reviewPolicy: reviewPolicy(id, state, contract),
      acceptance: resolvedAcceptance(id, state, contract),
      externalOperations: handoffContract(id).operations,
      claims: contract.claims,
      invariants: contract.invariants || []
    });
  }
  
  const normalizedAcceptance = normalizedAcceptanceValue;
  
  function reviewPolicy(id, state = loadRuntime(id), contract = evidence(id)) {
    const grounding = readJson(join(activeChangePath(id), "grounding.yaml"), {});
    const signals = collectReviewSignals(state, contract, policyCapabilities(id));
    const riskRoute = classifyReviewRisk({
      state, claims: contract.claims, capabilities: signals.capabilities, grounding,
      requiredTriggers: signals.requiredTriggers
    });
    const policy = foundationPolicy().review || {};
    const riskTiered = foundationPolicy().workflow.reviewPolicy === "risk-tiered";
    return assembleReviewPolicy({ state, signals, riskRoute, policy, riskTiered });
  }
  
  const executionFingerprint = executionFingerprintOperation.bind(null, {
    activeChangePath,
    evidence,
    stableHash,
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION
  });

  const adapterFingerprint = createAdapterFingerprint.bind(null, {
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
    stableHash,
    providerCapability,
    providerRepositories,
    providerClaims,
    environmentDescriptor,
    evidence
  });

  return {
    rawExecution,
    scopedReviewClaims,
    evidence,
    claimsForProvider,
    providerConfig,
    providerClaims,
    providerRepository,
    providerRepositories,
    providerWorkspace,
    providerWorkspaceHash,
    providerInputIdentity,
    environmentDescriptor,
    adapterFingerprint,
    contractFingerprint,
    normalizedAcceptance,
    resolvedAcceptance,
    reviewPolicy,
    executionFingerprint
  };
}
