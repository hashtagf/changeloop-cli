import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  compositeRepositorySelection, isolatedRepositoryState, repositoryBaseHead,
  worktreeOwnedByTarget
} from "../core/repository-binding.mjs";

export {
  compositeRepositorySelection, isolatedRepositoryState, repositoryBaseHead
} from "../core/repository-binding.mjs";

export function normalizedSelectionEntry(entry) {
  return typeof entry === "string" ? { id: entry } : entry;
}

export function selectedRepository(catalogValue, id, entry, reportFailure) {
  const repository = catalogValue.repositories.find((item) => item.id === entry.id);
  if (!repository)
    reportFailure(`${id}/repositories.yaml references unknown repository '${entry.id}'`);
  return repository;
}

export function selectedRepositoryRuntimeIssue({
  repository, entry, state, options = {}, canonicalPath, root = null,
  changeId = null, ownsWorktree = worktreeOwnedByTarget
}) {
  if (options.useTargetPaths || !isolatedRepositoryState(state) ||
      repository.id === "root") return null;
  const runtime = state.repositories?.[repository.id];
  if (!runtime)
    return `isolated runtime state is missing repository '${repository.id}'`;
  if (runtime.mode !== "worktree")
    return `isolated repository '${repository.id}' has invalid mode '${runtime.mode || "missing"}'`;
  for (const field of ["path", "targetPath", "baseHead"])
    if (!runtime[field])
      return `isolated repository '${repository.id}' is missing ${field}`;
  const access = entry.mode || repository.mode;
  if (runtime.access !== access)
    return `isolated repository '${repository.id}' access changed from '${
      runtime.access || "missing"}' to '${access}'`;
  if (canonicalPath(runtime.targetPath) !== canonicalPath(repository.path))
    return `isolated repository '${repository.id}' target path no longer matches the repository catalog`;
  if (root && changeId) {
    const expectedPath = join(root, ".foundation", "repository-sandboxes",
      changeId, repository.id);
    if (canonicalPath(runtime.path) !== canonicalPath(expectedPath))
      return `isolated repository '${repository.id}' path is not its canonical sandbox path`;
    if (!existsSync(runtime.path))
      return `isolated repository '${repository.id}' workspace is missing`;
    if (!ownsWorktree(runtime.path, repository.path))
      return `isolated repository '${repository.id}' worktree is not owned by its selected target`;
  }
  return null;
}

export function selectedRepositoryRow({
  repository, entry, state, options, root, canonicalPath, gitHead,
  changeId = "<change>", reportFailure = (message) => { throw new Error(message); }
}) {
  const issue = selectedRepositoryRuntimeIssue({
    repository, entry, state, options, canonicalPath, root, changeId
  });
  if (issue)
    reportFailure(`${issue}; repair it with 'claude-foundation sandbox create ${changeId} --all', inspect preserved state with 'claude-foundation sandbox inspect ${changeId}', or retire the change with 'claude-foundation change abandon ${changeId} --reason <reason> --decision-ref <ref>'`);
  const runtimeState = state.repositories?.[repository.id] ||
    (repository.id === "root" ? state.workspace : null) || {};
  return {
    ...repository,
    mode: entry.mode || repository.mode,
    dependsOn: entry.dependsOn || repository.dependsOn || [],
    baseHead: options.withoutGit
      ? runtimeState.baseHead || repository.baseHead || null
      : options.useTargetPaths
        ? gitHead(repository.path)
      : runtimeState.baseHead || gitHead(repository.path),
    workspacePath: canonicalPath(options.useTargetPaths
      ? repository.path
      : runtimeState.path || (repository.id === "root"
        ? state.workspace?.path || root : repository.path))
  };
}

export function assertSelectedDependencies(rows, id, reportFailure) {
  const selectedIds = new Set(rows.map((repository) => repository.id));
  for (const repository of rows)
    for (const dependency of repository.dependsOn)
      if (!selectedIds.has(dependency))
        reportFailure(`change '${id}' must select dependency '${dependency}' for repository '${repository.id}'`);
}

export function selectRepositories({
  id, catalogValue, selection, state, options, root, canonicalPath, gitHead,
  reportFailure
}) {
  const requested = selection?.repositories || [{ id: "root", mode: "write" }];
  const rows = [];
  const seen = new Set();
  for (const value of requested) {
    const entry = normalizedSelectionEntry(value);
    const repository = selectedRepository(catalogValue, id, entry, reportFailure);
    if (seen.has(repository.id))
      reportFailure(`${id}/repositories.yaml repeats '${repository.id}'`);
    seen.add(repository.id);
    rows.push(selectedRepositoryRow({
      repository, entry, state, options, root, canonicalPath, gitHead,
      changeId: id, reportFailure
    }));
  }
  assertSelectedDependencies(rows, id, reportFailure);
  return rows;
}

export function parseDiscoveredSubmodules(value, slugify) {
  const rows = [];
  let current = null;
  for (const raw of value.split("\n")) {
    const section = raw.match(/^\s*\[submodule\s+"([^"]+)"\]\s*$/);
    if (section) {
      if (current?.path) rows.push(current);
      current = { id: slugify(section[1]), name: section[1], type: "submodule" };
      continue;
    }
    if (!current) continue;
    const field = raw.match(/^\s*(path|url|branch)\s*=\s*(.+?)\s*$/);
    if (field) current[field[1]] = field[2];
  }
  if (current?.path) rows.push(current);
  return rows;
}

export function mergeCatalogRepositories(configured, discovered) {
  const configuredByPath = new Map(configured.repositories.map((repository) =>
    [repository.path, repository]));
  const configuredIds = new Set(configured.repositories.map((repository) => repository.id));
  const merged = [
    ...discovered.map((repository) => ({
      ...repository, ...(configuredByPath.get(repository.path) || {})
    })),
    ...configured.repositories.filter((repository) =>
      !discovered.some((item) => item.path === repository.path) &&
      !discovered.some((item) => item.id === repository.id))
  ];
  return { configuredByPath, configuredIds, merged };
}

export function normalizedCatalogRepository(repository, discovered, fail) {
  if (!repository || typeof repository !== "object")
    fail("repository entries must be objects");
  const discoveredValue = discovered.find((item) =>
    item.path === repository.path || item.id === repository.id) || {};
  return {
    ...discoveredValue, ...repository,
    id: repository.id || discoveredValue.id,
    type: repository.type || discoveredValue.type || "git",
    mode: repository.mode || "write",
    dependsOn: repository.dependsOn || []
  };
}

export function assertCatalogRepository(repository, ids, fail) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(repository.id || ""))
    fail(`invalid repository id '${repository.id || ""}'`);
  if (ids.has(repository.id)) fail(`duplicate repository id '${repository.id}'`);
  ids.add(repository.id);
  if (!["root", "submodule", "git", "external"].includes(repository.type))
    fail(`repository '${repository.id}' has invalid type '${repository.type}'`);
  if (!["read", "write"].includes(repository.mode))
    fail(`repository '${repository.id}' mode must be read|write`);
  if (!Array.isArray(repository.dependsOn) ||
      repository.dependsOn.some((item) => typeof item !== "string"))
    fail(`repository '${repository.id}' dependsOn must be an array`);
  if (repository.setupCommand !== undefined && repository.setupCommand !== null &&
      (typeof repository.setupCommand !== "string" || repository.setupCommand.trim() === ""))
    fail(`repository '${repository.id}' setupCommand must be a non-empty string`);
}

export function normalizeCatalogRepositoryPath(
  repository, paths, root, canonicalPath, pathInside, fail
) {
  const absolute = canonicalPath(resolve(root, repository.path || ""));
  if (!pathInside(root, absolute) && repository.allowOutsideRoot !== true)
    fail(`repository '${repository.id}' path escapes the control root; set allowOutsideRoot only for an explicitly trusted sibling repository`);
  const normalized = relative(root, absolute) || ".";
  if (paths.has(normalized)) fail(`duplicate repository path '${normalized}'`);
  paths.add(normalized);
  repository.path = absolute;
  repository.relativePath = normalized.replaceAll("\\", "/");
}

export function assertCatalogDependencies(rows, ids, fail) {
  for (const repository of rows)
    for (const dependency of repository.dependsOn)
      if (!ids.has(dependency))
        fail(`repository '${repository.id}' depends on unknown repository '${dependency}'`);
}

export function buildRepositoryCatalog({
  root, configured, discovered, canonicalPath, pathInside, fail
}) {
  const { configuredByPath, configuredIds, merged } =
    mergeCatalogRepositories(configured, discovered);
  const rows = [{
    id: "root", type: "root", path: ".", role: "control-plane",
    mode: "write", dependsOn: []
  }, ...merged].map((repository) =>
    normalizedCatalogRepository(repository, discovered, fail));
  const ids = new Set();
  const paths = new Set();
  for (const repository of rows) {
    assertCatalogRepository(repository, ids, fail);
    normalizeCatalogRepositoryPath(
      repository, paths, root, canonicalPath, pathInside, fail);
  }
  assertCatalogDependencies(rows, ids, fail);
  const drift = discovered.filter((repository) =>
    !configuredByPath.has(repository.path) && !configuredIds.has(repository.id));
  return { version: 1, repositories: rows, discovered, drift };
}

export function repositoryDisplayState(path, head, status) {
  return !existsSync(path) ? "missing" :
    !head ? "not-git" : status?.stdout.trim() ? "dirty" : "clean";
}

export function repositoryDisplayRow(repository, head, state, selectedIds) {
  return [
    repository.id, repository.type, repository.relativePath, state,
    head?.slice(0, 12) || "-",
    selectedIds ? (selectedIds.has(repository.id) ? "selected" : "excluded") : ""
  ].filter(Boolean).join("\t");
}

export function createRepositoryTopology({
  root, slugify, readJson, canonicalPath, pathInside, activeChangePath,
  loadRuntime, git, gitHead, fail
}) {
  function discoveredSubmodules() {
    const path = join(root, ".gitmodules");
    if (!existsSync(path)) return [];
    return parseDiscoveredSubmodules(readFileSync(path, "utf8"), slugify);
  }

  function catalog() {
    const path = join(root, "openspec", "repositories.yaml");
    const configured = existsSync(path) ? readJson(path) : { version: 1, repositories: [] };
    if (configured.version !== 1 || !Array.isArray(configured.repositories))
      fail("openspec/repositories.yaml requires version 1 and a repositories array");
    const discovered = discoveredSubmodules();
    return buildRepositoryCatalog({
      root, configured, discovered, canonicalPath, pathInside, fail
    });
  }

  function changeSelectionAt(id, dir, reportFailure = fail) {
    const path = join(dir, "repositories.yaml");
    if (!existsSync(path)) return null;
    const value = readJson(path);
    if (value.version !== 1 || !Array.isArray(value.repositories) || value.repositories.length === 0)
      reportFailure(`${id}/repositories.yaml requires version 1 and a non-empty repositories array`);
    return value;
  }

  function changeSelection(id, reportFailure = fail) {
    return changeSelectionAt(id, activeChangePath(id), reportFailure);
  }

  function selectionIdsAt(dir) {
    const path = join(dir, "repositories.yaml");
    if (!existsSync(path)) return ["root"];
    const value = readJson(path);
    if (value.version !== 1 || !Array.isArray(value.repositories))
      fail(`${relative(root, path)} requires version 1 and a repositories array`);
    return value.repositories.map((entry) => typeof entry === "string" ? entry : entry.id).sort();
  }

  function selected(id, state = loadRuntime(id), reportFailure = fail, options = {}) {
    const catalogValue = catalog();
    const selection = changeSelectionAt(id,
      options.changeDir || activeChangePath(id), reportFailure);
    return selectRepositories({
      id, catalogValue, selection, state, options, root, canonicalPath, gitHead,
      reportFailure
    });
  }

  function byId(id, repositoryId, state = loadRuntime(id)) {
    const repository = selected(id, state).find((item) => item.id === repositoryId);
    if (!repository) fail(`change '${id}' does not select repository '${repositoryId}'`);
    return repository;
  }

  function show(id = null) {
    const catalogValue = catalog();
    const selectedIds = id ? new Set(selected(id).map((repository) => repository.id)) : null;
    for (const repository of catalogValue.repositories) {
      const head = gitHead(repository.path);
      const status = head ? git(["status", "--porcelain"], repository.path) : null;
      const state = repositoryDisplayState(repository.path, head, status);
      console.log(repositoryDisplayRow(repository, head, state, selectedIds));
    }
    for (const repository of catalogValue.drift)
      console.error(`WARNING: unregistered submodule '${repository.path}'`);
  }

  return {
    discoveredSubmodules, catalog, changeSelection, selectionIdsAt,
    selected, byId, show
  };
}
