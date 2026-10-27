#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export function npmLockfileConsistency(packageJson, lockfile) {
  const root = lockfile?.packages?.[""] || lockfile || {};
  const issues = [];
  if (packageJson.name && root.name !== packageJson.name)
    issues.push(`package name '${packageJson.name}' is missing or differs in package-lock.json`);
  if (packageJson.version && root.version !== packageJson.version)
    issues.push(`package version '${packageJson.version}' is missing or differs in package-lock.json`);
  // v1 stores resolved dependency objects, not root manifest declarations.
  // npm's install-plan validation below owns their interpretation.
  if (lockfile?.lockfileVersion === 1) return issues;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const expected = packageJson[field] || {};
    const actual = root[field] || {};
    for (const [name, spec] of Object.entries(expected))
      if (actual[name] !== spec)
        issues.push(`${field}.${name} '${spec}' is missing or differs in package-lock.json`);
    for (const name of Object.keys(actual))
      if (!(name in expected)) issues.push(`${field}.${name} remains only in package-lock.json`);
  }
  return issues;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkNpmWorkspace(workspace = process.cwd(), {
  validateInstall = true, spawn = spawnSync
} = {}) {
  const packagePath = join(workspace, "package.json");
  const lockPath = join(workspace, "package-lock.json");
  if (!existsSync(packagePath) || !existsSync(lockPath))
    return { status: "not-applicable", issues: [], packagePath, lockPath };
  const issues = npmLockfileConsistency(readJson(packagePath), readJson(lockPath));
  if (issues.length || !validateInstall)
    return { status: issues.length ? "fail" : "pass", issues, packagePath, lockPath };
  // Let the installed package manager validate its own resolution semantics,
  // including workspace links and peer dependencies. Dry-run preserves both
  // node_modules and manifests; offline and ignore-scripts prevent downloads
  // and lifecycle execution. Missing cache/tooling is an error, never a pass.
  const result = spawn("npm", ["ci", "--dry-run", "--offline", "--ignore-scripts",
    "--no-audit", "--no-fund", "--logs-max=0"], {
    cwd: workspace, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024
  });
  if (result.status === 0 && !result.error)
    return { status: "pass", issues: [], packagePath, lockPath };
  const detail = String(result.stderr || result.error?.message || result.stdout ||
    "npm install-plan validation failed").trim();
  return {
    status: !result.error && /\bEUSAGE\b|Missing: .* from lock file|Invalid: lock file/.test(detail)
      ? "fail" : "error",
    issues: [detail.slice(-4000)], packagePath, lockPath
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let result;
  try { result = checkNpmWorkspace(); }
  catch (error) {
    result = { status: "error", issues: [error.message] };
  }
  console.log(JSON.stringify({
    protocol: "foundation-npm-lockfile-check-v1",
    status: result.status,
    issues: result.issues
  }));
  if (!["pass", "not-applicable"].includes(result.status)) process.exitCode = 1;
}
