import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export const SEMANTIC_SOURCE_LIMITS = Object.freeze({
  maxSources: 64,
  maxBytes: 2 * 1024 * 1024,
  maxFileBytes: 256 * 1024
});

function sourceRows(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.sources) ? value.sources : [];
}

function normalizedDeclaredPath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim().replaceAll("\\", "/");
  if (!path || path.includes("\0") || isAbsolute(path)) return null;
  const normalized = posix.normalize(path);
  return normalized === "." ? null : normalized;
}

function withinRoot(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function finding(code, path, detail) {
  return { code, path, ...(detail ? { detail } : {}) };
}

function canonicalInventoryDigest(sources) {
  const payload = sources.map(({ path, sha256: digest, bytes }) =>
    `${path}\0${digest}\0${bytes}`).join("\n");
  return `sha256:${sha256(payload)}`;
}

export function semanticSourceInventoryFindings(inventory) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory) ||
      inventory.version !== 1 || inventory.algorithm !== "sha256" ||
      !Array.isArray(inventory.sources) ||
      JSON.stringify(Object.keys(inventory).sort()) !==
        JSON.stringify(["algorithm", "digest", "sources", "version"]))
    return [finding("invalid-source-inventory", "")];
  const findings = [];
  const canonicalRows = [];
  const seen = new Set();
  for (const [index, row] of inventory.sources.entries()) {
    const path = normalizedDeclaredPath(row?.path);
    if (!path || path !== row.path || seen.has(path) ||
        !row || typeof row !== "object" || Array.isArray(row) ||
        JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(["bytes", "path", "sha256"]) ||
        !Number.isSafeInteger(row?.bytes) || row.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(String(row?.sha256 || ""))) {
      findings.push(finding("invalid-source-inventory-row", String(row?.path || ""), { index }));
      continue;
    }
    seen.add(path);
    canonicalRows.push({ path, sha256: row.sha256, bytes: row.bytes });
  }
  const sorted = [...canonicalRows].sort((left, right) => compareText(left.path, right.path));
  if (JSON.stringify(sorted) !== JSON.stringify(canonicalRows))
    findings.push(finding("noncanonical-source-inventory-order", ""));
  if (canonicalInventoryDigest(sorted) !== inventory.digest)
    findings.push(finding("source-inventory-digest-mismatch", ""));
  return findings;
}

/**
 * Compare two source inventories without filesystem access.
 * A null baseline means that no freshness assertion has been recorded yet.
 */
export function semanticSourceFreshnessFindings(baseline, current) {
  if (baseline === null || baseline === undefined) return [];
  const invalid = Array.isArray(baseline) ? [] : semanticSourceInventoryFindings(baseline);
  if (invalid.length) return invalid;
  const before = new Map(sourceRows(baseline).map((row) => [row?.path, row]));
  const after = new Map(sourceRows(current).map((row) => [row?.path, row]));
  const findings = [];

  for (const path of [...before.keys()].sort(compareText)) {
    const previous = before.get(path);
    const present = after.get(path);
    if (!present) findings.push(finding("source-missing", path));
    else if (present.sha256 !== previous.sha256)
      findings.push(finding("source-digest-changed", path, {
        expected: previous.sha256,
        actual: present.sha256
      }));
  }
  for (const path of [...after.keys()].sort(compareText))
    if (!before.has(path)) findings.push(finding("source-added", path));

  return findings;
}

/**
 * Build a deterministic, read-only inventory for explicitly declared local files.
 * Filesystem functions are injectable so path and freshness behavior stays unit-testable.
 */
export function inspectSemanticSources({
  projectRoot,
  sourcePaths = [],
  baseline = null,
  limits: limitOverrides = {},
  fs = { lstat: lstatSync, readFile: readFileSync, realpath: realpathSync }
} = {}) {
  if (typeof projectRoot !== "string" || !projectRoot.trim())
    throw new TypeError("projectRoot must be a non-empty string");
  if (!Array.isArray(sourcePaths))
    throw new TypeError("sourcePaths must be an array");

  const declaredRoot = resolve(projectRoot);
  const root = fs.realpath(declaredRoot);
  const sources = [];
  const findings = [];
  const seen = new Set();
  const limits = Object.fromEntries(Object.entries(SEMANTIC_SOURCE_LIMITS).map(([key, fallback]) =>
    [key, Number.isSafeInteger(limitOverrides[key]) && limitOverrides[key] > 0
      ? limitOverrides[key] : fallback]));
  let totalBytes = 0;

  if (sourcePaths.length > limits.maxSources) findings.push(finding(
    "source-count-limit", "", { count: sourcePaths.length, maximum: limits.maxSources }));

  for (const [index, declared] of sourcePaths.slice(0, limits.maxSources).entries()) {
    const path = normalizedDeclaredPath(declared);
    if (!path) {
      findings.push(finding("invalid-source-path", String(declared ?? ""), { index }));
      continue;
    }
    if (seen.has(path)) {
      findings.push(finding("duplicate-source-path", path, { index }));
      continue;
    }
    seen.add(path);

    const absolute = resolve(declaredRoot, path);
    if (!withinRoot(declaredRoot, absolute)) {
      findings.push(finding("source-outside-project", path));
      continue;
    }

    let stat;
    try {
      stat = fs.lstat(absolute);
    } catch (error) {
      findings.push(finding("source-missing", path, { reason: error?.code || "unreadable" }));
      continue;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      findings.push(finding("source-not-file", path));
      continue;
    }

    let canonical;
    try {
      canonical = fs.realpath(absolute);
    } catch (error) {
      findings.push(finding("source-missing", path, { reason: error?.code || "unreadable" }));
      continue;
    }
    if (!withinRoot(root, canonical)) {
      findings.push(finding("source-outside-project", path));
      continue;
    }
    let canonicalStat;
    try {
      canonicalStat = fs.lstat(canonical);
    } catch (error) {
      findings.push(finding("source-missing", path, { reason: error?.code || "unreadable" }));
      continue;
    }
    if (!canonicalStat.isFile()) {
      findings.push(finding("source-not-file", path));
      continue;
    }
    if (Number.isSafeInteger(canonicalStat.size) && canonicalStat.size > limits.maxFileBytes) {
      findings.push(finding("source-file-size-limit", path, {
        bytes: canonicalStat.size, maximum: limits.maxFileBytes
      }));
      continue;
    }
    if (Number.isSafeInteger(canonicalStat.size) &&
        totalBytes + canonicalStat.size > limits.maxBytes) {
      findings.push(finding("source-byte-limit", path, {
        bytes: totalBytes + canonicalStat.size, maximum: limits.maxBytes
      }));
      continue;
    }

    let content;
    try {
      content = fs.readFile(canonical);
    } catch (error) {
      findings.push(finding("source-unreadable", path, { reason: error?.code || "unreadable" }));
      continue;
    }
    if (content.byteLength > limits.maxFileBytes || totalBytes + content.byteLength > limits.maxBytes) {
      findings.push(finding(content.byteLength > limits.maxFileBytes
        ? "source-file-size-limit" : "source-byte-limit", path, {
        bytes: content.byteLength > limits.maxFileBytes
          ? content.byteLength : totalBytes + content.byteLength,
        maximum: content.byteLength > limits.maxFileBytes ? limits.maxFileBytes : limits.maxBytes
      }));
      continue;
    }
    totalBytes += content.byteLength;
    sources.push({ path, bytes: content.byteLength, sha256: sha256(content) });
  }

  sources.sort((left, right) => compareText(left.path, right.path));
  findings.sort((left, right) =>
    compareText(left.path, right.path) || compareText(left.code, right.code));
  const inventory = {
    version: 1,
    algorithm: "sha256",
    sources,
    digest: canonicalInventoryDigest(sources)
  };
  return {
    inventory,
    findings,
    staleFindings: semanticSourceFreshnessFindings(baseline, inventory)
  };
}
