import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
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

export function createEvidenceContract({
  ROOT, PROVIDERS, ADAPTERS, INPUT_MODES, EXCLUDED_WORKSPACE_DIRS,
  ADAPTER_PROTOCOL_VERSION, PROVIDER_PROTOCOL_VERSION,
  activeChangePath, readJson, repositoryById, selectedRepositories, providerCapability,
  canonicalPath, loadRuntime, relevantHash,
  relevantSnapshot, singleRelevantSnapshot, fileDigest, stableHash,
  policyCapabilities, foundationPolicy, handoffContract, die
}) {
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
    for (const [name, service] of Object.entries(value.services || {})) {
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
      if (service.resources !== undefined &&
          (!Array.isArray(service.resources) ||
           service.resources.some((item) => typeof item !== "string" || !item)))
        die(`service '${name}' resources must be an array of strings`);
      if (service.repository !== undefined)
        repositoryById(id, service.repository);
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
  
  function evidence(id, dir = activeChangePath(id)) {
    const path = join(dir, "evidence.yaml");
    const value = readJson(path);
    if (![1, 2].includes(value.version) || !Array.isArray(value.claims) || value.claims.length === 0)
      die(`${id}/evidence.yaml must contain at least one claim`);
    if (value.version === 2 && (value.providers === null ||
        typeof (value.providers || {}) !== "object" || Array.isArray(value.providers)))
      die(`${id}/evidence.yaml providers must be an object`);
    const ids = new Set();
    for (const claim of value.claims) {
      if (!claim.id || ids.has(claim.id)) die(`evidence claim IDs must be non-empty and unique`);
      ids.add(claim.id);
      if (!claim.scenario || !Array.isArray(claim.capabilities) || claim.capabilities.length === 0)
        die(`claim '${claim.id}' needs scenario and capabilities`);
      for (const provider of claim.capabilities)
        if (!PROVIDERS.has(provider)) die(`claim '${claim.id}' uses unknown provider '${provider}'`);
    }
    const executionValue = rawExecution(id, dir);
    const configuredProviders = {
      ...(value.providers || {}),
      ...(executionValue.providers || {})
    };
    for (const [provider, config] of Object.entries(configuredProviders)) {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider))
        die(`invalid provider instance id '${provider}'`);
      if (!config || typeof config !== "object" || Array.isArray(config))
        die(`provider '${provider}' configuration must be an object`);
      const capability = providerCapability(provider, config);
      if (!capability || !PROVIDERS.has(capability))
        die(`provider '${provider}' requires a known capability`);
      if (!ADAPTERS.has(config.adapter))
        die(`provider '${provider}' uses unknown adapter '${config.adapter || ""}'`);
      if (config.repository !== undefined)
        repositoryById(id, config.repository);
      if (config.repositories !== undefined) {
        if (!Array.isArray(config.repositories) || config.repositories.length === 0 ||
            config.repositories.some((repository) =>
              typeof repository !== "string" || !repository.trim()) ||
            new Set(config.repositories).size !== config.repositories.length)
          die(`provider '${provider}' repositories must be a non-empty array of unique repository IDs`);
        for (const repository of config.repositories) repositoryById(id, repository);
        if (config.repository && !config.repositories.includes(config.repository))
          die(`provider '${provider}' cwd repository '${config.repository}' must appear in repositories`);
      }
      if (!["external", "contract-digest"].includes(config.adapter) &&
          (!Array.isArray(config.command) || config.command.length === 0 ||
           config.command.some((part) => typeof part !== "string" || !part)))
        die(`provider '${provider}' adapter '${config.adapter}' requires a non-empty command array`);
      if (config.adapter === "contract-digest") {
        // Two sides minimum: a "shared" contract with one participant proves
        // nothing about agreement.
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
      // A report written inside the hashed surface expires the receipt it was
      // written to justify: the workspace hash is taken before providers run
      // and again at finalization, so the provider's own output makes every
      // receipt in the run stale — the run passes, then reports itself void.
      // A warning rather than a refusal, because a deterministic report that
      // is already committed reproduces byte-for-byte and leaves the hash
      // alone; that project is odd, not broken.
      if (typeof config.report === "string" && config.report.trim() &&
          !isExcludedPath(config.report.replaceAll("\\", "/"),
            { excluded: EXCLUDED_WORKSPACE_DIRS }))
        console.error(`WARNING: provider '${provider}' writes its report to ${config.report}, inside the hashed workspace surface; its own output will expire the receipt it produces. Write it under one of: ${
          [...EXCLUDED_WORKSPACE_DIRS].filter((dir) => !dir.startsWith(".")).join(", ")}`);
      // A discovery provider may declare this adapter too. It does not run on
      // its own — the test provider that names it writes both receipts in one
      // execution — but it has to be *configurable* so that a change with test
      // claims in two repositories can scope discovery per repository. Refusing
      // it here left multi-repository test evidence unprovable: the only other
      // adapters pass validation and then fail at execution, because none of
      // them can produce a discovered count.
      if (config.adapter === "test-discovery" && !["test", "discovery"].includes(capability))
        die("test-discovery adapter requires capability 'test' or 'discovery'");
      // Only the *test* half owes this reference. The discovery half is the
      // thing being referred to, and demanding it name a discovery provider of
      // its own asked it to point at itself.
      if (config.adapter === "test-discovery" && capability === "test" && provider !== "test") {
        if (!config.discoveryProvider ||
            !configuredProviders[config.discoveryProvider] ||
            providerCapability(
              config.discoveryProvider, configuredProviders[config.discoveryProvider]
            ) !== "discovery")
          die(`provider '${provider}' test-discovery requires a configured discoveryProvider`);
      }
      if (config.timeoutMs !== undefined &&
          (!Number.isFinite(Number(config.timeoutMs)) || Number(config.timeoutMs) <= 0))
        die(`provider '${provider}' timeoutMs must be a positive number`);
      if (config.resources !== undefined &&
          (!Array.isArray(config.resources) ||
           config.resources.some((item) => typeof item !== "string" || !item)))
        die(`provider '${provider}' resources must be an array of strings`);
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
      if (["review", "acceptance"].includes(capability) && config.inputs !== undefined)
        die(`${capability} capability cannot declare reusable inputs; it is bound to the full workspace`);
      if (config.reportFormat !== undefined &&
          !["json", "tap", "auto"].includes(config.reportFormat))
        die(`provider '${provider}' reportFormat must be json|tap|auto`);
      if (config.resultProtocol !== undefined &&
          !["foundation-mutation-v1", "foundation-mutation-v2"].includes(config.resultProtocol))
        die(`provider '${provider}' resultProtocol must be foundation-mutation-v1|foundation-mutation-v2`);
      if (config.criticalCases !== undefined &&
          (!Array.isArray(config.criticalCases) ||
           config.criticalCases.some((item) => typeof item !== "string" || !item.trim())))
        die(`provider '${provider}' criticalCases must be an array of non-empty IDs`);
      if (config.criticalCases?.length &&
          ["external", "contract-digest"].includes(config.adapter))
        die(`provider '${provider}' adapter '${config.adapter}' cannot execute criticalCases; use a structured command adapter`);
      if (config.resultProtocol === "foundation-mutation-v2") {
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
      if (config.dependsOn !== undefined &&
          (!Array.isArray(config.dependsOn) ||
           config.dependsOn.some((item) =>
             !configuredProviders[item] && !PROVIDERS.has(item))))
        die(`provider '${provider}' dependsOn contains an unknown provider`);
      if (config.dependsOn?.includes(provider))
        die(`provider '${provider}' cannot depend on itself`);
      if (config.outputs !== undefined &&
          (!Array.isArray(config.outputs) ||
           config.outputs.some((item) =>
             !configuredProviders[item] && !PROVIDERS.has(item))))
        die(`provider '${provider}' outputs contains an unknown provider`);
      if (config.service !== undefined &&
          (!executionValue.services || !executionValue.services[config.service]))
        die(`provider '${provider}' references unknown service '${config.service}'`);
      if (config.env !== undefined &&
          (!config.env || typeof config.env !== "object" || Array.isArray(config.env) ||
           Object.values(config.env).some((value) => !["string", "number", "boolean"].includes(typeof value))))
        die(`provider '${provider}' env must be an object of scalar values`);
      if (config.envFrom !== undefined &&
          (!Array.isArray(config.envFrom) ||
           config.envFrom.some((value) => typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value))))
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
      if (config.readiness !== undefined) {
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
      if (config.adapter === "playwright" && config.inputMode &&
          !INPUT_MODES.has(config.inputMode))
        die(`provider '${provider}' has invalid inputMode '${config.inputMode}'`);
      if (capability === "browser" && config.adapter !== "external" &&
          !INPUT_MODES.has(config.inputMode || (config.adapter === "playwright" ? "browser-automation" : "")))
        die("configured browser provider requires a valid inputMode");
      if (capability === "mutation" && config.adapter !== "external" &&
          config.resultProtocol !== "foundation-mutation-v2" &&
          !["behavioral-kill", "test-failure"].includes(config.classification))
        die("configured mutation provider requires classification behavioral-kill|test-failure");
      if (capability === "review" && config.adapter !== "external")
        die("review capability requires an external provider");
      if (capability === "acceptance" && config.adapter !== "external")
        die("acceptance capability requires an external human provider");
      if (config.ci !== undefined &&
          (config.adapter !== "external" || !config.ci || typeof config.ci !== "object" ||
           typeof config.ci.issuer !== "string" || !config.ci.issuer.trim() ||
           typeof config.ci.publicKey !== "string" || !config.ci.publicKey.includes("PUBLIC KEY")))
        die(`provider '${provider}' ci verification requires external adapter, issuer, and publicKey`);
      const declaredForProvider = (capability === "review"
        ? scopedReviewClaims(value.claims)
        : value.claims.filter((claim) =>
        claim.capabilities.includes(capability) ||
        (capability === "discovery" && claim.capabilities.includes("test"))))
        .map((claim) => claim.id);
      if (config.claims !== undefined && config.claims !== "declared") {
        if (!Array.isArray(config.claims))
          die(`provider '${provider}' claims must be an array or 'declared'`);
        const forbidden = config.claims.filter((claim) => !declaredForProvider.includes(claim));
        if (forbidden.length)
          die(`provider '${provider}' config references undeclared claim(s): ${forbidden.join(", ")}`);
        const missing = declaredForProvider.filter((claim) => !config.claims.includes(claim));
        if (missing.length)
          die(`provider '${provider}' config must cover every declared claim: ${missing.join(", ")}`);
      }
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
  
  function providerConfig(id, provider) {
    const providers = evidence(id).providers || {};
    if (providers[provider]) return providers[provider];
    if (provider === "discovery" && providers.test?.adapter === "test-discovery")
      return providers.test;
    for (const config of Object.values(providers))
      if (Array.isArray(config.outputs) && config.outputs.includes(provider))
        return config;
    return null;
  }

  function claimsForProvider(id, provider) {
    const claims = evidence(id).claims;
    const config = providerConfig(id, provider);
    const capability = providerCapability(provider, config);
    let scoped = capability === "review" ? scopedReviewClaims(claims)
      : capability === "acceptance" ? (() => {
        const ids = resolvedAcceptance(id, loadRuntime(id), evidence(id)).claimIds;
        return claims.filter((claim) => ids.includes(claim.id));
      })()
        : policyCapabilities(id).includes(capability) ? claims
          : claims.filter((claim) =>
            claim.capabilities.includes(capability) ||
            (capability === "discovery" && claim.capabilities.includes("test")));
    const scopedRepositories = config?.repositories ||
      (config?.adapter === "contract-digest" ? Object.keys(config.contract || {}) :
        config?.repository ? [config.repository] : null);
    if (scopedRepositories)
      scoped = scoped.filter((claim) =>
        !claim.repositories || claim.repositories.some((repository) =>
          scopedRepositories.includes(repository)));
    return scoped;
  }
  
  function providerClaims(id, provider, config = providerConfig(id, provider)) {
    const declared = claimsForProvider(id, provider).map((claim) => claim.id);
    if (!config?.claims || config.claims === "declared") return declared;
    if (!Array.isArray(config.claims)) die(`provider '${provider}' claims must be an array or 'declared'`);
    const forbidden = config.claims.filter((claim) => !declared.includes(claim));
    if (forbidden.length)
      die(`provider '${provider}' config references undeclared claim(s): ${forbidden.join(", ")}`);
    return config.claims;
  }
  
  function providerRepository(id, provider, config = providerConfig(id, provider)) {
    const repositoryId = config?.repository || null;
    if (!repositoryId) return null;
    return repositoryById(id, repositoryId);
  }

  function providerRepositories(id, provider, config = providerConfig(id, provider)) {
    const ids = config?.repositories ||
      (config?.adapter === "contract-digest" ? Object.keys(config.contract || {}) :
        config?.repository ? [config.repository] : selectedRepositories(id).map((row) => row.id));
    return [...new Set(ids)].sort().map((repositoryId) => repositoryById(id, repositoryId));
  }
  
  function providerWorkspace(id, provider, config = providerConfig(id, provider)) {
    return canonicalPath(providerRepository(id, provider, config)?.workspacePath ||
      loadRuntime(id).workspace?.path || ROOT);
  }
  
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
    return ["review", "acceptance"]
      .includes(providerCapability(provider, providerConfig(id, provider)));
  }

  function providerWorkspaceHash(id, provider, fallback = null) {
    const field = packetBoundCapability(id, provider) ? "workspaceHash" : "codeHash";
    const config = providerConfig(id, provider);
    const explicitlyScoped = Boolean(config?.repository || config?.repositories ||
      config?.adapter === "contract-digest");
    const repositories = providerRepositories(id, provider, config);
    if (!explicitlyScoped)
      return field === "workspaceHash"
        ? fallback || relevantHash(id)
        : relevantSnapshot(id)[field] || fallback || relevantHash(id);
    const snapshot = relevantSnapshot(id);
    if (repositories.length === 1) {
      const repository = repositories[0];
      return snapshot.repositories?.[repository.id]?.[field] ||
        singleRelevantSnapshot(id, repository.workspacePath, true)[field];
    }
    return stableHash({
      version: 1,
      field,
      repositories: repositories.map((repository) => ({
        id: repository.id,
        hash: snapshot.repositories?.[repository.id]?.[field] ||
          singleRelevantSnapshot(id, repository.workspacePath, true)[field]
      }))
    });
  }
  
  // Which repository a scoped input root belongs to, for a stable label in the
  // recorded file list.
  function repositoryLabel(id, workspacePath) {
    for (const repository of selectedRepositories(id))
      if (canonicalPath(repository.workspacePath) === workspacePath) return repository.id;
    return null;
  }

  function providerInputIdentity(id, provider, config = providerConfig(id, provider),
      globalHash = null) {
    const workspace = canonicalPath(providerWorkspace(id, provider, config));
    if (!Array.isArray(config?.inputs) || config.inputs.length === 0) {
      const workspaceHash = globalHash || providerWorkspaceHash(id, provider);
      return {
        mode: "global",
        patterns: [],
        files: [],
        fingerprint: stableHash({ mode: "global", workspaceHash })
      };
    }
    const patterns = [...new Set(config.inputs.map((item) =>
      item.replaceAll("\\", "/").replace(/^\.\/+/, "")))].sort();
    // A provider that spans repositories has no single workspace to walk, so
    // `inputs` may name one: `api:openapi.yaml` reads from repository `api`.
    // Without this a cross-repo provider could only bind to the composite hash
    // — all-or-nothing — and any edit anywhere invalidated its receipt.
    const scoped = patterns.filter((pattern) => /^[a-z0-9][a-z0-9._-]*:/i.test(pattern));
    const roots = new Map([[workspace, patterns.filter((pattern) => !scoped.includes(pattern))]]);
    for (const pattern of scoped) {
      const separator = pattern.indexOf(":");
      const repositoryId = pattern.slice(0, separator);
      const rest = pattern.slice(separator + 1);
      const repositoryRoot = canonicalPath(repositoryById(id, repositoryId).workspacePath);
      roots.set(repositoryRoot, [...(roots.get(repositoryRoot) || []), rest]);
    }
    const matches = (rel, pattern) => {
      if (pattern.endsWith("/**"))
        return rel === pattern.slice(0, -3) || rel.startsWith(pattern.slice(0, -2));
      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -1);
        return rel.startsWith(prefix) && !rel.slice(prefix.length).includes("/");
      }
      return rel === pattern || rel.startsWith(`${pattern.replace(/\/$/, "")}/`);
    };
    const files = [];
    const collect = (dir, base, scopePatterns, label) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (EXCLUDED_WORKSPACE_DIRS.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          collect(path, base, scopePatterns, label);
          continue;
        }
        if (!entry.isFile()) continue;
        const rel = relative(base, path).replaceAll("\\", "/");
        if (scopePatterns.some((pattern) => matches(rel, pattern)))
          files.push({ path: label ? `${label}:${rel}` : rel, sha256: fileDigest(path) });
      }
    };
    for (const [base, scopePatterns] of roots) {
      if (!scopePatterns.length || !existsSync(base)) continue;
      collect(base, base, scopePatterns, base === workspace ? null : repositoryLabel(id, base));
    }
    // Codepoint order, not localeCompare: the fingerprint must not depend on
    // the machine's collation tables, or identical inputs expire receipts.
    files.sort((left, right) =>
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return {
      mode: "declared",
      patterns,
      files,
      fingerprint: stableHash({ mode: "declared", patterns, files })
    };
  }
  
  function environmentDescriptor(config = null, id = null) {
    const workspace = id && config?.repository
      ? repositoryById(id, config.repository).workspacePath
      : (id ? loadRuntime(id).workspace?.path || ROOT : ROOT);
    const lockfiles = [
      "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
      "Cargo.lock", "go.sum", "Gemfile.lock", "composer.lock"
    ].filter((name) => existsSync(join(workspace, name)))
      .map((name) => ({ path: name, sha256: fileDigest(join(workspace, name)) }));
    return {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      declared: config?.environment || null,
      envFingerprint: stableHash({
        literals: config?.env || {},
        inheritedNames: config?.envFrom || []
      }),
      lockfiles
    };
  }
  
  function adapterFingerprint(id, provider, config, command = null) {
    return stableHash({
      adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
      providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
      provider,
      capability: providerCapability(provider, config),
      repository: config?.repository || null,
      repositories: providerRepositories(id, provider, config).map((repository) => repository.id),
      adapter: config?.adapter || "external",
      adapterVersion: String(config?.version || "1"),
      command: command || config?.command || null,
      claims: providerClaims(id, provider, config),
      environment: environmentDescriptor(config, id),
      inputMode: config?.inputMode || null,
      project: config?.project || null,
      outputs: config?.outputs || [],
      resources: config?.resources || null,
      dependsOn: config?.dependsOn || [],
      service: config?.service ? {
        name: config.service,
        config: evidence(id).execution?.services?.[config.service] || null
      } : null,
      executionPolicy: providerEvidencePolicy(config)
    });
  }
  
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
  
  function normalizedAcceptance(state) {
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
  
  function resolvedAcceptance(id, state = loadRuntime(id), contract = evidence(id)) {
    const normalized = normalizedAcceptance(state);
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
  
  function reviewPolicy(id, state = loadRuntime(id), contract = evidence(id)) {
    const grounding = readJson(join(activeChangePath(id), "grounding.yaml"), {});
    const capabilities = new Set([
      ...(state.evidenceCapabilities || []),
      ...contract.claims.flatMap((claim) => claim.capabilities || []),
      ...policyCapabilities(id)
    ]);
    const semantic = `${state.intent || ""} ${(state.securityTriggers || []).join(" ")}`.toLowerCase();
    const requiredTriggers = [];
    const diversityTriggers = [];
    const riskClaims = contract.claims.filter((claim) => claim.impact !== "low");
    const requiredCapabilities = REVIEW_FORCING_CAPABILITIES;
    if (riskClaims.some((claim) =>
      claim.capabilities.some((capability) => requiredCapabilities.includes(capability))))
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
    const riskRoute = classifyReviewRisk({
      state, claims: contract.claims, capabilities, grounding, requiredTriggers
    });
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
    const policy = foundationPolicy().review || {};
    const riskTiered = foundationPolicy().workflow.reviewPolicy === "risk-tiered";
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
  
  function executionFingerprint(id, dir = activeChangePath(id)) {
    const contract = evidence(id, dir);
    return stableHash({
      adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
      providers: contract.providers || {},
      services: contract.execution?.services || {}
    });
  }

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
