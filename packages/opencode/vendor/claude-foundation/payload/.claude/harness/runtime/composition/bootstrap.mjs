import {
  existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function insideSandboxCopy(path) {
  const segments = path.split(sep);
  return segments.some((segment, index) => segment === ".foundation" &&
    ["sandboxes", "repository-sandboxes"].includes(segments[index + 1]));
}

function findRoot({ start, pinned, fail, warn }) {
  let cursor = resolve(pinned || start);
  for (;;) {
    if (existsSync(join(cursor, "openspec", "config.yaml")) &&
        existsSync(join(cursor, ".claude", "harness", "foundation.mjs"))) {
      if (pinned || !insideSandboxCopy(cursor)) return cursor;
      warn(`claude-foundation: control-plane state resolves at the project root; ` +
        `provider commands still execute in the registered change sandbox (found sandbox copy at ${cursor})`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) fail("not inside a Foundation project");
    cursor = parent;
  }
}

function canonicalPath(path) {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

export function createBootstrap({ start, pinned, fail, warn = console.error }) {
  const root = canonicalPath(findRoot({ start, pinned, fail, warn }));
  const paths = {
    runtime: join(root, ".foundation", "runtime"),
    receipts: join(root, ".foundation", "receipts"),
    logs: join(root, ".foundation", "logs"),
    evidenceVault: join(root, ".foundation", "evidence"),
    snapshots: join(root, ".foundation", "snapshots"),
    transactions: join(root, ".foundation", "transactions"),
    plans: join(root, ".foundation", "plans"),
    leases: join(root, ".foundation", "leases"),
    prototypes: join(root, ".foundation", "prototypes"),
    attestations: join(root, ".foundation", "attestations"),
    authority: join(root, ".foundation", "authority"),
    handoffs: join(root, ".foundation", "handoffs"),
    instructionManifests: join(root, ".foundation", "instruction-manifests"),
    recovery: join(root, ".foundation", "recovery"),
    changes: join(root, "openspec", "changes")
  };
  for (const name of [
    "runtime", "receipts", "logs", "evidenceVault", "snapshots", "transactions",
    "plans", "leases", "attestations", "authority", "handoffs",
    "instructionManifests", "changes"
  ]) mkdirSync(paths[name], { recursive: true });

  function readJson(path, fallback = null) {
    try { return JSON.parse(readFileSync(path, "utf8")); }
    catch (error) {
      if (fallback !== null) return fallback;
      fail(`invalid JSON: ${relative(root, path)} (${error.message})`);
    }
  }

  function readJsonOrNull(path) {
    try { return JSON.parse(readFileSync(path, "utf8")); }
    catch { return null; }
  }

  function writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    try {
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) rmSync(temporary);
    }
  }

  function pathInside(parent, candidate) {
    const rel = relative(resolve(parent), resolve(candidate));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }

  return {
    root, paths, readJson, readJsonOrNull, writeJson, canonicalPath, pathInside,
    now: () => new Date().toISOString()
  };
}
