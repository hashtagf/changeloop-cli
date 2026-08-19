import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export function createRepositoryTopology({
  root, slugify, readJson, canonicalPath, pathInside, activeChangePath,
  loadRuntime, git, gitHead, fail
}) {
  function discoveredSubmodules() {
    const path = join(root, ".gitmodules");
    if (!existsSync(path)) return [];
    const rows = [];
    let current = null;
    for (const raw of readFileSync(path, "utf8").split("\n")) {
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

  function catalog() {
    const path = join(root, "openspec", "repositories.yaml");
    const configured = existsSync(path) ? readJson(path) : { version: 1, repositories: [] };
    if (configured.version !== 1 || !Array.isArray(configured.repositories))
      fail("openspec/repositories.yaml requires version 1 and a repositories array");
    const discovered = discoveredSubmodules();
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
    const rows = [{
      id: "root", type: "root", path: ".", role: "control-plane",
      mode: "write", dependsOn: []
    }, ...merged].map((repository) => {
      if (!repository || typeof repository !== "object") fail("repository entries must be objects");
      const discoveredValue = discovered.find((item) =>
        item.path === repository.path || item.id === repository.id) || {};
      return {
        ...discoveredValue, ...repository,
        id: repository.id || discoveredValue.id,
        type: repository.type || discoveredValue.type || "git",
        mode: repository.mode || "write",
        dependsOn: repository.dependsOn || []
      };
    });
    const ids = new Set();
    const paths = new Set();
    for (const repository of rows) {
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
      const absolute = canonicalPath(resolve(root, repository.path || ""));
      if (!pathInside(root, absolute) && repository.allowOutsideRoot !== true)
        fail(`repository '${repository.id}' path escapes the control root; set allowOutsideRoot only for an explicitly trusted sibling repository`);
      const normalized = relative(root, absolute) || ".";
      if (paths.has(normalized)) fail(`duplicate repository path '${normalized}'`);
      paths.add(normalized);
      repository.path = absolute;
      repository.relativePath = normalized.replaceAll("\\", "/");
    }
    for (const repository of rows)
      for (const dependency of repository.dependsOn)
        if (!ids.has(dependency))
          fail(`repository '${repository.id}' depends on unknown repository '${dependency}'`);
    const drift = discovered.filter((repository) =>
      !configuredByPath.has(repository.path) && !configuredIds.has(repository.id));
    return { version: 1, repositories: rows, discovered, drift };
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
    const requested = selection?.repositories || [{ id: "root", mode: "write" }];
    const rows = [];
    const seen = new Set();
    for (const entry of requested) {
      const normalized = typeof entry === "string" ? { id: entry } : entry;
      const repository = catalogValue.repositories.find((item) => item.id === normalized.id);
      if (!repository) reportFailure(`${id}/repositories.yaml references unknown repository '${normalized.id}'`);
      if (seen.has(repository.id)) reportFailure(`${id}/repositories.yaml repeats '${repository.id}'`);
      seen.add(repository.id);
      const runtimeState = state.repositories?.[repository.id] || {};
      rows.push({
        ...repository,
        mode: normalized.mode || repository.mode,
        dependsOn: normalized.dependsOn || repository.dependsOn || [],
        baseHead: options.useTargetPaths
          ? gitHead(repository.path)
          : runtimeState.baseHead || gitHead(repository.path),
        workspacePath: canonicalPath(options.useTargetPaths
          ? repository.path
          : runtimeState.path || (repository.id === "root"
            ? state.workspace?.path || root : repository.path))
      });
    }
    const selectedIds = new Set(rows.map((repository) => repository.id));
    for (const repository of rows)
      for (const dependency of repository.dependsOn)
        if (!selectedIds.has(dependency))
          reportFailure(`change '${id}' must select dependency '${dependency}' for repository '${repository.id}'`);
    return rows;
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
      const state = !existsSync(repository.path) ? "missing" :
        !head ? "not-git" : status?.stdout.trim() ? "dirty" : "clean";
      console.log([
        repository.id, repository.type, repository.relativePath, state,
        head?.slice(0, 12) || "-",
        selectedIds ? (selectedIds.has(repository.id) ? "selected" : "excluded") : ""
      ].filter(Boolean).join("\t"));
    }
    for (const repository of catalogValue.drift)
      console.error(`WARNING: unregistered submodule '${repository.path}'`);
  }

  return {
    discoveredSubmodules, catalog, changeSelection, selectionIdsAt,
    selected, byId, show
  };
}
