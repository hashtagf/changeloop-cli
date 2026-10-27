import { QUALITY_PROFILES, validateProfiles } from "./language-profiles.mjs";

export const DEFAULT_CONSUMER_QUALITY_POLICY = Object.freeze({
  version: 1,
  mode: "report",
  enforcement: "changed-code-ratchet",
  authority: "evidence-only",
  coverage: {
    unitChangedMinimum: 80,
    integrationChangedMinimum: 70,
    criticalJourneyMinimum: 50
  },
  complexity: { warning: 11, refactor: 21, maximumChanged: 30 },
  crap: { warning: 20, maximumNew: 30, rejectRegression: true },
  mutation: {
    rejectScoreRegression: true,
    rejectNewNoCoverage: true,
    changedCodeTarget: 70,
    semanticKillRate: 100
  },
  unsupportedCapability: { default: "report", neverAssumePass: true, neverAssumeZero: true },
  remediation: {
    mode: "changed-code-only",
    allowBehaviorPreservingRefactor: true,
    allowPublicContractChange: false,
    allowCrossRepositoryExpansion: false
  },
  risks: {
    low: { crapRequired: false, requireCompensatingEvidence: false },
    medium: { crapRequired: false, requireCompensatingEvidence: true },
    high: { crapRequired: true, requireCompensatingEvidence: true }
  }
});

const PROVIDER_KINDS = new Set(["command", "builtin"]);
const PROTOCOLS = new Set([
  "foundation-quality-capabilities-v1", "foundation-crap-v1",
  "foundation-automated-mutation-v1", "foundation-mutation-v2"
]);

function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function failAt(message) { throw new Error(`invalid consumer quality config: ${message}`); }
function percent(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 100) failAt(`${label} must be 0..100`);
}

export function validateConsumerQualityPolicy(policy) {
  if (!object(policy) || policy.version !== 1) failAt("policy requires version 1");
  if (!["report", "enforce"].includes(policy.mode)) failAt("policy.mode must be report|enforce");
  if (policy.enforcement !== "changed-code-ratchet")
    failAt("policy.enforcement must be changed-code-ratchet");
  if (policy.authority !== "evidence-only") failAt("policy.authority must be evidence-only");
  for (const [name, value] of Object.entries(policy.coverage || {})) percent(value, `coverage.${name}`);
  if (!Number.isFinite(policy.complexity?.maximumChanged) || policy.complexity.maximumChanged < 1)
    failAt("complexity.maximumChanged must be >= 1");
  if (!Number.isFinite(policy.crap?.maximumNew) || policy.crap.maximumNew < 1)
    failAt("crap.maximumNew must be >= 1");
  percent(policy.mutation?.changedCodeTarget, "mutation.changedCodeTarget");
  percent(policy.mutation?.semanticKillRate, "mutation.semanticKillRate");
  if (policy.unsupportedCapability?.neverAssumePass !== true ||
      policy.unsupportedCapability?.neverAssumeZero !== true)
    failAt("unsupported capabilities must never assume pass or zero");
  if (policy.remediation?.mode !== "changed-code-only" ||
      policy.remediation?.allowCrossRepositoryExpansion !== false)
    failAt("remediation must remain changed-code-only without cross-repository expansion");
  return policy;
}

export function validateQualityProvider(provider, label) {
  if (!object(provider)) failAt(`${label} must be an object`);
  if (!PROVIDER_KINDS.has(provider.kind)) failAt(`${label}.kind must be command|builtin`);
  if (provider.kind === "command" && (!Array.isArray(provider.command) ||
      !provider.command.length || provider.command.some((part) => typeof part !== "string" || !part)))
    failAt(`${label}.command must be a non-empty string array`);
  if (provider.kind === "builtin" && (typeof provider.adapter !== "string" || !provider.adapter))
    failAt(`${label}.adapter is required for built-in providers`);
  if (provider.command !== undefined && (!Array.isArray(provider.command) ||
      !provider.command.length || provider.command.some((part) => typeof part !== "string" || !part)))
    failAt(`${label}.command must be a non-empty string array when present`);
  if (provider.inputs !== undefined && (!object(provider.inputs) ||
      Object.values(provider.inputs).some((path) => typeof path !== "string" || !path)))
    failAt(`${label}.inputs must contain repository-relative string paths`);
  if (provider.protocol !== undefined && !PROTOCOLS.has(provider.protocol))
    failAt(`${label}.protocol is not a Foundation quality protocol`);
  if (provider.output !== undefined && (typeof provider.output !== "string" || !provider.output))
    failAt(`${label}.output must be a non-empty repository-relative path`);
  return provider;
}

export function validateConsumerQualityConfig(config, repositoryIds = null) {
  if (!object(config) || config.version !== 1) failAt("requires version 1");
  validateConsumerQualityPolicy(config.policy);
  if (!Array.isArray(config.repositories) || !config.repositories.length)
    failAt("repositories must be a non-empty array");
  const ids = new Set();
  for (const repository of config.repositories) {
    if (!object(repository) || typeof repository.id !== "string" || !repository.id)
      failAt("each repository requires an id");
    if (ids.has(repository.id)) failAt(`duplicate repository '${repository.id}'`);
    ids.add(repository.id);
    if (repositoryIds && !repositoryIds.has(repository.id))
      failAt(`unknown repository '${repository.id}'`);
    validateProfiles(repository.profiles);
    if (!object(repository.providers)) failAt(`repository '${repository.id}' requires providers`);
    const applicable = new Set(profileCapabilities(repository.profiles));
    for (const [name, provider] of Object.entries(repository.providers)) {
      validateQualityProvider(provider, `repositories.${repository.id}.providers.${name}`);
      if (applicable.has(name) && provider.required === false)
        failAt(`repository '${repository.id}' cannot make profile capability '${name}' optional`);
    }
    if (repository.include !== undefined && (!Array.isArray(repository.include) ||
        repository.include.some((path) => typeof path !== "string" || !path)))
      failAt(`repository '${repository.id}' include must be a string array`);
    if (repository.exclude !== undefined && (!Array.isArray(repository.exclude) ||
        repository.exclude.some((path) => typeof path !== "string" || !path)))
      failAt(`repository '${repository.id}' exclude must be a string array`);
  }
  if (!Array.isArray(config.exceptions)) failAt("exceptions must be an array");
  const exceptionIds = new Set();
  for (const exception of config.exceptions) {
    if (!object(exception)) failAt("exception entries must be objects");
    for (const field of ["id", "repository", "target", "metric", "reason", "risk",
      "owner", "approvedBy", "expires", "trackingIssue"])
      if (typeof exception[field] !== "string" || !exception[field].trim())
        failAt(`exception requires ${field}`);
    if (exceptionIds.has(exception.id)) failAt(`duplicate exception '${exception.id}'`);
    exceptionIds.add(exception.id);
    if (repositoryIds && !repositoryIds.has(exception.repository))
      failAt(`exception '${exception.id}' references unknown repository '${exception.repository}'`);
    if (!Array.isArray(exception.compensatingEvidence) || !exception.compensatingEvidence.length ||
        exception.compensatingEvidence.some((item) => typeof item !== "string" || !item))
      failAt(`exception '${exception.id}' requires compensatingEvidence`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires) ||
        Number.isNaN(new Date(`${exception.expires}T00:00:00Z`).valueOf()))
      failAt(`exception '${exception.id}' has invalid expires date`);
    if (new Date(`${exception.expires}T23:59:59.999Z`) < new Date())
      failAt(`exception '${exception.id}' is expired`);
    if (new Date(`${exception.expires}T23:59:59.999Z`).valueOf() - Date.now() > 90 * 86400000)
      failAt(`exception '${exception.id}' expires more than 90 days from validation`);
    if (/[*?]/.test(exception.target))
      failAt(`exception '${exception.id}' target must identify one function or mutant, not a glob`);
  }
  return config;
}

export function profileCapabilities(profileNames) {
  validateProfiles(profileNames);
  return [...new Set(profileNames.flatMap((name) => QUALITY_PROFILES[name].capabilities))].sort();
}

export function capabilityRequirement({ status, capability, impact = "medium", policy }) {
  if (status === "available" || status === "not-applicable")
    return { blocking: false, assurance: status === "available" ? "full" : "not-applicable" };
  const risk = policy.risks[impact] || policy.risks.medium;
  const explicitlyRequired = capability === "crap" && risk.crapRequired;
  if (explicitlyRequired)
    return { blocking: true, assurance: "missing", reason: `${capability} is required for ${impact}-impact changes` };
  return {
    blocking: false,
    assurance: risk.requireCompensatingEvidence ? "reduced-requires-evidence" : "reduced",
    reason: `${capability} is ${status}`
  };
}

export function defaultConsumerQualityConfig(repositories) {
  return {
    version: 1,
    policy: structuredClone(DEFAULT_CONSUMER_QUALITY_POLICY),
    repositories: repositories.map((repository) => ({
      id: repository.id,
      profiles: repository.profiles,
      include: ["**/*"],
      exclude: ["**/node_modules/**", "**/vendor/**", "**/.git/**", "**/.foundation/**", "**/dist/**", "**/build/**"],
      providers: repository.providers || {}
    })),
    exceptions: []
  };
}
