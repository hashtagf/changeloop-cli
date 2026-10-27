import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repositoryBaseHead } from "../core/repository-binding.mjs";
import { isPostReleaseCapability } from "../evidence/provider-catalog.mjs";
import { changeWorkTypes as packetChangeWorkTypes } from "./task-change.mjs";

export { repositoryBaseHead } from "../core/repository-binding.mjs";

export function addChangedSurfaceSource({
  sources, path, source, repositoryId, changeId, excludedWorkspaceDirs,
  isCurrentChangePath
}) {
  if (!path) return;
  const normalized = path.replaceAll("\\", "/");
  if (excludedWorkspaceDirs.has(normalized.split("/")[0])) return;
  if (repositoryId === "root" &&
      (isCurrentChangePath(normalized, changeId) || normalized.startsWith("openspec/changes/")))
    return;
  if (!sources.has(normalized)) sources.set(normalized, new Set());
  sources.get(normalized).add(source);
}

export function changedSurfaceRows(repositoryId, sources) {
  return [...sources].map(([path, rowSources]) => ({
    repositoryId, path, sources: [...rowSources].sort()
  }));
}

export function sortChangedSurface(rows) {
  return rows.sort((left, right) =>
    left.repositoryId.localeCompare(right.repositoryId) || left.path.localeCompare(right.path));
}

export function unchangedManifestEntry(fileDigest, workspace, manifest, rel) {
  if (!manifest || !Object.prototype.hasOwnProperty.call(manifest, rel))
    return false;
  const path = join(workspace, rel);
  try {
    return existsSync(path) && manifest[rel] === fileDigest(path);
  } catch {
    return false;
  }
}

export function carriedInUnchanged(
  fileDigest, workspace, preexisting, rel, state = null
) {
  const copied = state?.workspace?.sandboxPreexisting;
  if (unchangedManifestEntry(fileDigest, workspace, copied, rel)) return true;
  return unchangedManifestEntry(fileDigest, workspace, preexisting, rel);
}

// Evidence each work type needs beyond what its changed paths reveal.
export const WORK_TYPE_CAPABILITIES = Object.freeze({
  api: Object.freeze(["compatibility"]),
  library: Object.freeze(["compatibility"]),
  deprecation: Object.freeze(["compatibility"]),
  performance: Object.freeze(["performance"]),
  async: Object.freeze(["concurrency"]),
  integration: Object.freeze(["integration"]),
  ui: Object.freeze(["accessibility"]),
  dependency: Object.freeze(["dependency-supply-chain"]),
  infra: Object.freeze(["plan-check", "deployment"]),
  migration: Object.freeze(["parity"]),
  ml: Object.freeze(["evaluation"]),
  "client-release": Object.freeze(["release-health"]),
  experiment: Object.freeze(["experiment-guardrail"]),
  observability: Object.freeze(["observability"]),
  data: Object.freeze(["data-migration"]),
  privacy: Object.freeze(["security-static"]),
  // Reuse existing capabilities so no project must wire a new provider; a
  // pipeline change adds none beyond the default test.
  "data-fix": Object.freeze(["data-migration"]),
  security: Object.freeze(["security-static"])
});

function normalizedWorkTypes(workTypes) {
  return [...new Set((workTypes || [])
    .map((type) => String(type || "").trim().toLowerCase()).filter(Boolean))].sort();
}

// Work-type evidence split by phase. `capabilities` gate proof and Land;
// `postRelease` capabilities (release health, experiment guardrails) only
// gate the rollout and are never blocking. Triggers name the work type.
export function capabilitiesForWorkTypes(workTypes) {
  const capabilities = new Set();
  const postRelease = new Set();
  const triggers = {};
  for (const type of normalizedWorkTypes(workTypes))
    for (const capability of WORK_TYPE_CAPABILITIES[type] || []) {
      (isPostReleaseCapability(capability) ? postRelease : capabilities).add(capability);
      (triggers[capability] ||= []).push(`work-type:${type}`);
    }
  return {
    capabilities: [...capabilities].sort(), postRelease: [...postRelease].sort(), triggers
  };
}

// Agent-owned setup actions for blocking work-type capabilities the project
// has no configured provider for. Wiring a provider is agent work, never a
// user question, and each action carries the route that resumes proof.
export function workTypeProviderSetupActions(id, workTypes, configuredCapabilities = []) {
  const configured = new Set(configuredCapabilities);
  const { capabilities, triggers } = capabilitiesForWorkTypes(workTypes);
  return capabilities.filter((capability) => !configured.has(capability))
    .map((capability) => ({
      kind: "configure-provider",
      action: "EDIT",
      owner: "agent",
      capability,
      trigger: triggers[capability][0],
      instruction: `Configure a project-owned ${capability} provider in openspec/changes/${
        id}/execution.yaml (detect one with claude-foundation evidence init ${id} --write).`,
      command: `claude-foundation evidence init ${id} --write`,
      resume: `claude-foundation advance ${id} --through proven`
    }));
}

// The compiled packet's work types; the active sandbox copy wins over root.
function defaultChangeWorkTypes(root) {
  return (id, state) => {
    const candidates = [
      state?.status === "archived" && state.archivedChangePath
        ? join(root, state.archivedChangePath) : null,
      state?.workspace?.path ? join(state.workspace.path, "openspec", "changes", id) : null,
      join(root, "openspec", "changes", id)
    ];
    const path = candidates.find((candidate) => candidate && existsSync(candidate));
    if (!path) return [];
    try { return packetChangeWorkTypes(path) || []; } catch { return []; }
  };
}

export function createChangePolicy({
  root, excludedWorkspaceDirs, providers, gitHead, git, porcelainStatusRecords,
  workspaceManifest, loadRuntime, selectedRepositories, isCurrentChangePath,
  readJson, fileDigest, fail,
  // Root-relative paths of repositories declared in the topology. Their
  // gitlink (or a missing/empty mirror of it) in the root workspace is that
  // repository's own pointer, never root task content.
  declaredRepositoryPaths = () => [],
  // (id, state) -> declared or inferred work types of the change.
  changeWorkTypes = defaultChangeWorkTypes(root)
}) {
  const policyCache = new Map();
  const carriedInUnchangedFor = carriedInUnchanged.bind(null, fileDigest);

  // Registered with state-runtime's clearSnapshotCache so a surface mutation
  // invalidates this cache too — it used to clear a dead Map of its own.
  function clearPolicyCache(id = null) {
    if (id) policyCache.delete(id);
    else policyCache.clear();
  }

  function changedFilesInWorkspace(id, workspace, knownHead = undefined) {
    const head = knownHead === undefined ? gitHead(workspace) : knownHead;
    if (!head) return [];
    const result = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], workspace);
    if (result.status !== 0) return [];
    const paths = porcelainStatusRecords(result.stdout)
      .flatMap((row) => (row.origPath ? [row.path, row.origPath] : [row.path]));
    return [...new Set(paths)].sort();
  }

  function changedFiles(id, state) {
    const workspace = state.workspace?.path || root;
    const gitFiles = changedFilesInWorkspace(id, workspace);
    if (gitHead(workspace)) return gitFiles;
    if (state.workspace?.mode === "copy" && state.workspace.baseline) {
      const current = workspaceManifest(workspace, id, true);
      const baseline = state.workspace.sandboxBaseline || state.workspace.baseline;
      return [...new Set([
        ...Object.keys(baseline), ...Object.keys(current)
      ])].filter((path) => baseline[path] !== current[path]).sort();
    }
    return [];
  }

  // `canonicalChangedSurface` calls `fail`, which exits the process rather than
  // throwing, so a caller that only wants a hint cannot protect itself with
  // try/catch. It has to ask first. This mirrors the one precondition that
  // function enforces — a repository with a git head needs a recorded base to
  // diff against — and is deliberately the only thing it answers: a false here
  // costs an advisory, never a gate.
  function changedSurfaceResolvable(id, state = loadRuntime(id)) {
    let repositories;
    try { repositories = selectedRepositories(id, state); }
    catch { return false; }
    return repositories.every((repository) => {
      if (!gitHead(repository.workspacePath)) return true;
      return Boolean(repositoryBaseHead(repository, state));
    });
  }

  function canonicalChangedSurface(id, state = loadRuntime(id)) {
    const repositories = selectedRepositories(id, state);
    const rows = [];
    const repositoryPointers = new Set((declaredRepositoryPaths() || [])
      .map((path) => String(path || "").replaceAll("\\", "/").replace(/\/+$/, ""))
      .filter((path) => path && path !== "." && !path.startsWith("../")));
    for (const repository of repositories) {
      const workspace = repository.workspacePath;
      const preexisting = repository.id === "root"
        ? state.workspace?.preexisting || null : null;
      const sources = new Map();
      const add = (path, source) => {
        if (repository.id === "root" && path &&
            repositoryPointers.has(path.replaceAll("\\", "/").replace(/\/+$/, ""))) return;
        addChangedSurfaceSource({
          sources, path, source, repositoryId: repository.id, changeId: id,
          excludedWorkspaceDirs, isCurrentChangePath
        });
      };
      const head = gitHead(workspace);
      if (head) {
        const baseHead = repositoryBaseHead(repository, state);
        if (!baseHead)
          fail(`cannot resolve changed surface for repository '${repository.id}': missing baseHead; sync or recreate the change sandbox`);
        if (baseHead !== head) {
          const committed = git(["diff", "--name-only", "-z", `${baseHead}...HEAD`], workspace);
          if (committed.status !== 0)
            fail(`cannot resolve changed surface for repository '${repository.id}' from base ${baseHead}`);
          committed.stdout.split("\0").filter(Boolean).forEach((path) => add(path, "committed"));
        }
        changedFilesInWorkspace(id, workspace, head)
          .filter((path) => !carriedInUnchangedFor(workspace, preexisting, path, state))
          .forEach((path) => add(path, "dirty"));
      } else if (repository.id === "root") {
        changedFiles(id, state)
          .filter((path) => !carriedInUnchangedFor(workspace, preexisting, path, state))
          .forEach((path) => add(path, "dirty"));
      }
      rows.push(...changedSurfaceRows(repository.id, sources));
    }
    return sortChangedSurface(rows);
  }

  function capabilitiesForPaths(paths, workTypes = []) {
    const relevantFiles = paths
      .filter((path) => !path.startsWith("openspec/changes/") &&
        !path.startsWith("root/openspec/changes/"));
    const defaults = [
      {
        patterns: [/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/,
          /(^|\/)(package\.json|composer\.json|Cargo\.toml|go\.mod|Gemfile)$/],
        capabilities: ["dependency-supply-chain"]
      },
      {
        patterns: [/(^|\/)(migrations?|schema|ddl)(\/|\.|$)/i],
        capabilities: ["data-migration"]
      },
      {
        patterns: [/\.(tsx|jsx|vue|svelte|html|css|scss)$/i],
        capabilities: ["accessibility"]
      },
      {
        patterns: [/(^|\/)(openapi|swagger|asyncapi|proto|contracts?)(\/|\.|$)/i],
        capabilities: ["compatibility"]
      },
      {
        patterns: [/(^|\/)(auth|identity|permissions?|sessions?|tokens?)(\/|\.|$)/i],
        capabilities: ["security-static", "review"]
      },
      {
        patterns: [/(^|\/)(Dockerfile|deploy|deployment|helm|terraform|infra)(\/|\.|$)/i,
          /(^|\/)\.github\/workflows\//],
        capabilities: ["deployment"]
      }
    ];
    const required = new Set();
    const triggers = {};
    const require = (capability, path) => {
      required.add(capability);
      (triggers[capability] ||= []).push(path);
    };
    for (const policy of defaults) {
      const trigger = relevantFiles.find((path) =>
        policy.patterns.some((pattern) => pattern.test(path)));
      if (trigger !== undefined)
        policy.capabilities.forEach((capability) => require(capability, trigger));
    }
    if (existsSync(join(root, "quality", "foundation-quality.json"))) {
      const executable = relevantFiles.find((path) =>
        /\.(?:[cm]?js|jsx|tsx?|go|py|php|sh|bash)$/i.test(path));
      if (executable !== undefined) require("static-analysis", executable);
    }
    const configured = readJson(join(root, ".foundation", "policy.json"), { rules: [] });
    for (const rule of configured.rules || []) {
      if (!Array.isArray(rule.paths) || !Array.isArray(rule.capabilities)) continue;
      const trigger = relevantFiles.find((path) => rule.paths.some((prefix) =>
        typeof prefix === "string" &&
        (path === prefix.replace(/\*\*?$/, "") ||
         path.startsWith(prefix.replace(/\*\*?$/, "")))));
      if (trigger !== undefined)
        for (const capability of rule.capabilities)
          if (providers.has(capability)) require(capability, trigger);
    }
    const byWork = capabilitiesForWorkTypes(workTypes);
    for (const capability of byWork.capabilities)
      byWork.triggers[capability].forEach((trigger) => require(capability, trigger));
    for (const capability of byWork.postRelease)
      (triggers[capability] ||= []).push(...byWork.triggers[capability]);
    return {
      capabilities: [...required].sort(), postRelease: byWork.postRelease, triggers
    };
  }

  function globToRegExp(glob) {
    let out = "";
    for (let i = 0; i < glob.length; i += 1) {
      const character = glob[i];
      if (character === "*") {
        if (glob[i + 1] === "*") {
          if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; } else { out += ".*"; i += 1; }
        } else out += "[^/]*";
        continue;
      }
      if (character === "?") { out += "[^/]"; continue; }
      out += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${out}$`);
  }

  const FORECAST_WALK_LIMIT = 5000;
  function expandDeclaredSurface(globs) {
    const paths = new Set();
    let budget = FORECAST_WALK_LIMIT;
    for (const glob of globs) {
      const declared = String(glob).replace(/^\.\//, "");
      if (!declared) continue;
      paths.add(declared);
      const wildcard = declared.search(/[*?[]/);
      if (wildcard === -1) continue;
      const prefix = declared.slice(0, wildcard);
      const directory = prefix.endsWith("/") ? prefix : prefix.replace(/\/[^/]*$/, "");
      const base = directory ? join(root, directory) : root;
      if (!existsSync(base)) continue;
      const matcher = globToRegExp(declared);
      const walk = (absolute, relativePath) => {
        if (budget <= 0) return;
        let entries;
        try { entries = readdirSync(absolute, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (budget <= 0) return;
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          const next = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          if (entry.isDirectory()) { walk(join(absolute, entry.name), next); continue; }
          budget -= 1;
          if (matcher.test(next)) paths.add(next);
        }
      };
      walk(base, directory.replace(/\/$/, ""));
    }
    return [...paths];
  }

  function forecastCapabilities(globs, workTypes = []) {
    return capabilitiesForPaths(expandDeclaredSurface(globs || []), workTypes);
  }

  function workTypesFor(id, state) {
    try { return normalizedWorkTypes(changeWorkTypes(id, state)); } catch { return []; }
  }

  function policyAnalysis(id) {
    if (policyCache.has(id)) return policyCache.get(id);
    const state = loadRuntime(id);
    const workTypes = workTypesFor(id, state);
    const result = {
      ...capabilitiesForPaths(canonicalChangedSurface(id, state)
        .map((row) => `${row.repositoryId}/${row.path}`), workTypes),
      workTypes
    };
    policyCache.set(id, result);
    return result;
  }

  function policyCapabilities(id) { return policyAnalysis(id).capabilities; }

  // Post-release capabilities the work types owe: rollout gates, never blocking.
  function policyRolloutCapabilities(id) { return policyAnalysis(id).postRelease; }

  // Agent-owned provider setup for work-type capabilities with no configured
  // provider. `configuredCapabilities` are the capabilities of the change's
  // configured providers.
  function policyProviderSetupActions(id, configuredCapabilities = []) {
    return workTypeProviderSetupActions(id, policyAnalysis(id).workTypes,
      configuredCapabilities);
  }

  function policyCapabilityTrigger(id, capability) {
    const paths = policyAnalysis(id).triggers[capability];
    return paths && paths.length ? paths[0] : null;
  }

  return {
    changedFilesInWorkspace,
    changedFiles,
    canonicalChangedSurface,
    changedSurfaceResolvable,
    capabilitiesForPaths,
    forecastCapabilities,
    policyCapabilities,
    policyRolloutCapabilities,
    policyProviderSetupActions,
    policyCapabilityTrigger,
    clearPolicyCache
  };
}
