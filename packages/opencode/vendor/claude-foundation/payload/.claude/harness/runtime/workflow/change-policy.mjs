import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function createChangePolicy({
  root, excludedWorkspaceDirs, providers, gitHead, git, porcelainStatusRecords,
  workspaceManifest, loadRuntime, selectedRepositories, isCurrentChangePath,
  readJson, fileDigest, fail
}) {
  const policyCache = new Map();

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

  function carriedInUnchanged(workspace, preexisting, rel, state = null) {
    const copied = state?.workspace?.sandboxPreexisting;
    if (copied && Object.prototype.hasOwnProperty.call(copied, rel)) {
      const path = join(workspace, rel);
      try {
        if (existsSync(path) && copied[rel] === fileDigest(path)) return true;
      } catch {}
    }
    if (!preexisting || !Object.prototype.hasOwnProperty.call(preexisting, rel))
      return false;
    const path = join(workspace, rel);
    try {
      return existsSync(path) && preexisting[rel] === fileDigest(path);
    } catch {
      return false;
    }
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
      return Boolean(repository.id === "root"
        ? state.repositories?.root?.baseHead || state.workspace?.baseHead
        : state.repositories?.[repository.id]?.baseHead);
    });
  }

  function canonicalChangedSurface(id, state = loadRuntime(id)) {
    const repositories = selectedRepositories(id, state);
    const rows = [];
    for (const repository of repositories) {
      const workspace = repository.workspacePath;
      const preexisting = repository.id === "root"
        ? state.workspace?.preexisting || null : null;
      const sources = new Map();
      const add = (path, source) => {
        if (!path) return;
        const normalized = path.replaceAll("\\", "/");
        if (excludedWorkspaceDirs.has(normalized.split("/")[0])) return;
        if (repository.id === "root" &&
            (isCurrentChangePath(normalized, id) || normalized.startsWith("openspec/changes/"))) return;
        if (!sources.has(normalized)) sources.set(normalized, new Set());
        sources.get(normalized).add(source);
      };
      const head = gitHead(workspace);
      if (head) {
        const baseHead = repository.id === "root"
          ? state.repositories?.root?.baseHead || state.workspace?.baseHead || null
          : state.repositories?.[repository.id]?.baseHead || null;
        if (!baseHead)
          fail(`cannot resolve changed surface for repository '${repository.id}': missing baseHead; sync or recreate the change sandbox`);
        if (baseHead !== head) {
          const committed = git(["diff", "--name-only", "-z", `${baseHead}...HEAD`], workspace);
          if (committed.status !== 0)
            fail(`cannot resolve changed surface for repository '${repository.id}' from base ${baseHead}`);
          committed.stdout.split("\0").filter(Boolean).forEach((path) => add(path, "committed"));
        }
        changedFilesInWorkspace(id, workspace, head)
          .filter((path) => !carriedInUnchanged(workspace, preexisting, path, state))
          .forEach((path) => add(path, "dirty"));
      } else if (repository.id === "root") {
        changedFiles(id, state)
          .filter((path) => !carriedInUnchanged(workspace, preexisting, path, state))
          .forEach((path) => add(path, "dirty"));
      }
      for (const [path, rowSources] of sources)
        rows.push({ repositoryId: repository.id, path, sources: [...rowSources].sort() });
    }
    return rows.sort((left, right) =>
      left.repositoryId.localeCompare(right.repositoryId) || left.path.localeCompare(right.path));
  }

  function capabilitiesForPaths(paths) {
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
    return { capabilities: [...required].sort(), triggers };
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

  function forecastCapabilities(globs) {
    return capabilitiesForPaths(expandDeclaredSurface(globs || []));
  }

  function policyAnalysis(id) {
    if (policyCache.has(id)) return policyCache.get(id);
    const state = loadRuntime(id);
    const result = capabilitiesForPaths(canonicalChangedSurface(id, state)
      .map((row) => `${row.repositoryId}/${row.path}`));
    policyCache.set(id, result);
    return result;
  }

  function policyCapabilities(id) { return policyAnalysis(id).capabilities; }

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
    policyCapabilityTrigger,
    clearPolicyCache
  };
}
