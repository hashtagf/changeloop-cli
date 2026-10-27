import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { EXCLUDED_WORKSPACE_DIRS } from "../../core/workspace-policy.mjs";
import { isExcludedPath } from "../../core/workspace-surface.mjs";
import { requiredDiscoveryDimensions } from "./semantic-intake.mjs";

const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 12_000,
  maxFiles: 3_000,
  maxBytes: 32 * 1024 * 1024,
  maxFileBytes: 256 * 1024,
  maxDepth: 12,
  maxReadSet: 24,
  maxGraphEdges: 6_000
});
const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".graphql", ".gql", ".h",
  ".hpp", ".html", ".java", ".js", ".jsx", ".json", ".kt", ".md", ".mjs",
  ".php", ".prisma", ".py", ".rb", ".rs", ".scala", ".sh", ".sql", ".svelte",
  ".swift", ".toml", ".ts", ".tsx", ".vue", ".xml", ".yaml", ".yml"
]);
const RESOLUTION_EXTENSIONS = [
  "", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".json", ".py", ".rs", ".go",
  "/index.js", "/index.jsx", "/index.mjs", "/index.ts", "/index.tsx"
];
const CATEGORY_ORDER = ["specs", "tests", "integrations", "persistence", "permissions"];
const GRAPH_LANGUAGE = Object.freeze({
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
  ".ts": "javascript", ".tsx": "javascript", ".py": "python",
  ".rs": "rust", ".go": "go", ".java": "java", ".kt": "kotlin",
  ".rb": "ruby", ".php": "php"
});
const SUPPORTED_GRAPH_LANGUAGES = new Set(["javascript", "python"]);
const CATEGORY_RULES = Object.freeze({
  specs: {
    path: /(^|\/)(?:openspec\/specs|specifications?|contracts?|docs\/[^/]*spec)(?:\/|$)|(?:^|\/)(?:openapi|asyncapi)\.(?:ya?ml|json)$/i,
    content: /\b(?:requirement|scenario|acceptance criteria|openapi|asyncapi|graphql schema)\b/i
  },
  tests: {
    path: /(^|\/)(?:tests?|__tests__|spec)(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/i,
    content: /\b(?:describe|it|test)\s*\(|\bassert(?:\.|\s)|\bpytest\b|#\[test\]/i
  },
  integrations: {
    path: /(^|\/)(?:integrations?|adapters?|clients?|routes?|api|webhooks?)(?:\/|$)|(?:openapi|asyncapi|graphql)/i,
    content: /\b(?:webhook|oauth|openapi|asyncapi|graphql|http client|external api|integration)\b/i
  },
  persistence: {
    path: /(^|\/)(?:migrations?|models?|repositories|database|db|storage|schema)(?:\/|$)|\.(?:prisma|sql)$/i,
    content: /\b(?:create table|alter table|migration|database|transaction|repository|persistent|prisma)\b/i
  },
  permissions: {
    path: /(^|\/)(?:auth|authorization|permissions?|policies|security|roles?)(?:\/|$)/i,
    content: /\b(?:permission|authorization|access control|role-based|rbac|acl|authenticate|authorize)\b/i
  }
});

// The paths install.sh manages (its MANAGED array) in a consumer. They are the
// harness, not the product, so a consumer's source inventory never selects
// them. The upstream source tree (it carries install.sh) keeps them.
export const MANAGED_INSTALL_PATHS = Object.freeze([
  ".claude/orchestrator.md", ".claude/commands", ".claude/harness", ".claude/skills",
  ".claude/rules", ".claude/hooks", "openspec/schemas", ".foundation/.gitignore",
  ".foundation/README.md", "WORKFLOW.md"
]);

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const normalizedPath = (value) => String(value || "").replaceAll("\\", "/");
const withinRoot = (root, candidate) => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};

function normalizeLimits(value = {}) {
  const limits = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const candidate = value[key];
    limits[key] = Number.isSafeInteger(candidate) && candidate > 0 ? candidate : fallback;
  }
  return limits;
}

function queryTerms(query) {
  const values = Array.isArray(query) ? query : [query];
  return [...new Set(values.flatMap((value) =>
    String(value || "").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_-]+/gu) || [])
    .filter((term) => term.length >= 2))].sort(compareText);
}

function normalizeSeedPaths(paths) {
  return new Set((Array.isArray(paths) ? paths : []).map(normalizedPath)
    .map((path) => posix.normalize(path)).filter((path) => path && path !== "." &&
      path !== ".." && !path.startsWith("../") && !isAbsolute(path)));
}

function normalizedPathSet(paths) {
  return new Set((Array.isArray(paths) ? paths : []).map(normalizedPath)
    .map((path) => posix.normalize(path)).filter((path) => path && path !== "." &&
      path !== ".." && !path.startsWith("../") && !isAbsolute(path)));
}

function pathAncestors(paths) {
  const ancestors = new Set();
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1)
      ancestors.add(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

function sourceCandidate(path) {
  const name = basename(path).toLowerCase();
  return SOURCE_EXTENSIONS.has(extname(name)) || [
    "dockerfile", "makefile", "gemfile", "procfile"
  ].includes(name);
}

function classify(path, content) {
  const categories = [];
  const reasons = [];
  for (const category of CATEGORY_ORDER) {
    const rule = CATEGORY_RULES[category];
    if (rule.path.test(path)) {
      categories.push(category);
      reasons.push(`path:${category}`);
    } else if (rule.content.test(content)) {
      categories.push(category);
      reasons.push(`content:${category}`);
    }
  }
  return { categories, reasons };
}

function relativeImportSpecifiers(path, content) {
  const values = [];
  const jsPattern = /(?:\bfrom\s*|\brequire\s*\(|\bimport\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of content.matchAll(jsPattern)) values.push({ kind: "import", specifier: match[1] });
  const sideEffectPattern = /\bimport\s*["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of content.matchAll(sideEffectPattern))
    values.push({ kind: "import", specifier: match[1] });
  if (extname(path) === ".py") {
    const pythonPattern = /^\s*from\s+(\.{1,2}[\w.]+)\s+import\s+/gm;
    for (const match of content.matchAll(pythonPattern)) {
      const dots = match[1].match(/^\.+/)[0].length;
      const suffix = match[1].slice(dots).replaceAll(".", "/");
      values.push({ kind: "import", specifier: `${dots === 1 ? "./" : "../"}${suffix}` });
    }
  }
  return values;
}

function resolvedImport(from, specifier, paths) {
  const base = posix.normalize(posix.join(dirname(from), specifier));
  for (const suffix of RESOLUTION_EXTENSIONS) {
    const candidate = `${base}${suffix}`;
    if (paths.has(candidate)) return candidate;
  }
  return null;
}

function graphFor(files, maxEdges) {
  const paths = new Set(files.map((row) => row.path));
  const dependencies = [];
  for (const file of files) {
    for (const item of relativeImportSpecifiers(file.path, file.content)) {
      const target = resolvedImport(file.path, item.specifier, paths);
      if (target && target !== file.path) dependencies.push({
        from: file.path, to: target, kind: item.kind, evidence: item.specifier
      });
      if (dependencies.length > maxEdges) return { exceeded: true };
    }
  }
  dependencies.sort((left, right) => compareText(left.from, right.from) ||
    compareText(left.to, right.to) || compareText(left.evidence, right.evidence));
  const callers = dependencies.map((row) => ({
    target: row.to, caller: row.from, kind: row.kind, evidence: row.evidence
  })).sort((left, right) => compareText(left.target, right.target) ||
    compareText(left.caller, right.caller));
  const tests = dependencies.filter((row) =>
    files.find((file) => file.path === row.from)?.categories.includes("tests"))
    .map((row) => ({ test: row.from, target: row.to, evidence: row.evidence }));
  const surfaces = Object.fromEntries(CATEGORY_ORDER.map((category) => [category,
    files.filter((file) => file.categories.includes(category)).map((file) => file.path)]));
  const detected = [...new Set(files.map((file) => GRAPH_LANGUAGE[extname(file.path)])
    .filter(Boolean))].sort(compareText);
  const unsupported = detected.filter((language) => !SUPPORTED_GRAPH_LANGUAGES.has(language));
  return {
    exceeded: false, dependencies, callers, tests, surfaces,
    completeness: {
      status: unsupported.length ? "partial" : "complete",
      supported: detected.filter((language) => SUPPORTED_GRAPH_LANGUAGES.has(language)),
      unsupported
    }
  };
}

function rankFiles(files, terms, seedPaths, graph) {
  const dependenciesOfSeeds = new Set(graph.dependencies.filter((row) => seedPaths.has(row.from))
    .map((row) => row.to));
  const callersOfSeeds = new Set(graph.callers.filter((row) => seedPaths.has(row.target))
    .map((row) => row.caller));
  return files.map((file) => {
    let score = 0;
    const reasons = [...file.reasons];
    if (seedPaths.has(file.path)) {
      score += 100;
      reasons.push("declared-seed");
    }
    const lowerPath = file.path.toLocaleLowerCase("en-US");
    const lowerContent = file.content.toLocaleLowerCase("en-US");
    for (const term of terms) {
      if (lowerPath.includes(term)) {
        score += 20;
        reasons.push(`query-path:${term}`);
      } else if (lowerContent.includes(term)) {
        score += 5;
        reasons.push(`query-content:${term}`);
      }
    }
    if (dependenciesOfSeeds.has(file.path)) {
      score += 15;
      reasons.push("dependency-of-seed");
    }
    if (callersOfSeeds.has(file.path)) {
      score += 15;
      reasons.push("caller-of-seed");
    }
    // A category describes what a file is, not whether it is relevant to this
    // change. Only boost a file after query, seed, or graph evidence selected it.
    if (score > 0) score += file.categories.length * 6;
    return {
      path: file.path,
      bytes: file.bytes,
      categories: file.categories,
      score,
      reasons: [...new Set(reasons)].sort(compareText)
    };
  }).sort((left, right) => right.score - left.score || compareText(left.path, right.path));
}

function boundedReadSet(ranked, maximum) {
  return ranked.filter((row) => row.score > 0 || row.reasons.includes("declared-seed"))
    .slice(0, maximum);
}

const trimmed = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * Repository discovery serves the standard lane. A rapid-shaped change (low
 * impact, isolated, no security trigger, review, acceptance, or risk-derived
 * discovery dimension) that is not already on the standard lane skips it.
 */
export function repositoryIntelligenceRequired(source = {}, { standardLane = false } = {}) {
  if (standardLane) return true;
  if (["medium", "high"].includes(trimmed(source.impact))) return true;
  if (trimmed(source.coupling) && trimmed(source.coupling) !== "isolated") return true;
  const triggers = (Array.isArray(source.securityTriggers) ? source.securityTriggers : [])
    .filter((trigger) => trimmed(trigger) && trimmed(trigger) !== "none");
  if (triggers.length) return true;
  if (source.reviewRequired || source.acceptance?.required === true) return true;
  return requiredDiscoveryDimensions({ ...source, securityTriggers: triggers }).length > 0;
}

/**
 * A valid "not scanned" result. Nothing was measured, so counts, scan, and
 * graph stay null (unknown), never zero, and `complete` is false.
 */
export function skippedRepositoryIntelligence(reason = "rapid-lane") {
  return {
    version: 1,
    status: "skipped",
    complete: false,
    reason,
    queryTerms: [],
    limits: null,
    scan: null,
    findings: [],
    candidates: null,
    readSet: [],
    graph: null
  };
}

function blockedResult({ limits, terms, scan, findings }) {
  return {
    version: 1,
    status: "blocked",
    complete: false,
    queryTerms: terms,
    limits,
    scan,
    findings: findings.sort((left, right) => compareText(left.path || "", right.path || "") ||
      compareText(left.code, right.code)),
    candidates: [],
    readSet: [],
    graph: { dependencies: [], callers: [], tests: [], surfaces: {},
      completeness: { status: "unavailable", supported: [], unsupported: [] } }
  };
}

/**
 * Discover and rank repository evidence without mutating project or harness state.
 * A traversal/read error or exhausted hard limit invalidates the whole result so
 * callers cannot mistake a partial scan for complete repository coverage.
 */
export function inspectRepositoryIntelligence({
  projectRoot,
  query = [],
  seedPaths = [],
  excludedDirectories = EXCLUDED_WORKSPACE_DIRS,
  trackedPaths = [],
  includedPaths = null,
  excludedPaths = [],
  managedPaths = MANAGED_INSTALL_PATHS,
  limits: limitOverrides = {},
  fs = { readdir: readdirSync, readFile: readFileSync, realpath: realpathSync, stat: statSync }
} = {}) {
  if (typeof projectRoot !== "string" || !projectRoot.trim())
    throw new TypeError("projectRoot must be a non-empty string");
  const limits = normalizeLimits(limitOverrides);
  const terms = queryTerms(query);
  const seeds = normalizeSeedPaths(seedPaths);
  const trackedFiles = normalizedPathSet(trackedPaths);
  const tracked = new Set([...trackedFiles, ...pathAncestors(trackedFiles)]);
  const included = includedPaths === null ? null : normalizedPathSet(includedPaths);
  const excludedFiles = normalizedPathSet(excludedPaths);
  const includedAncestors = included === null ? null : pathAncestors(included);
  const findings = [];
  const scan = { entries: 0, files: 0, bytes: 0 };
  const files = [];
  let root;
  try {
    root = fs.realpath(resolve(projectRoot));
  } catch (error) {
    return blockedResult({ limits, terms, scan, findings: [{
      code: "scan-root-unreadable", path: "", detail: error?.code || "unreadable"
    }] });
  }
  // A seed the agent named inside a managed path is still read.
  let upstream = false;
  try { upstream = Boolean(fs.stat?.(resolve(root, "install.sh"))?.isFile?.()); }
  catch { upstream = false; }
  const managed = upstream ? [] : normalizedPathSet(managedPaths);
  const isManaged = (path) => [...managed].some((prefix) =>
    (path === prefix || path.startsWith(`${prefix}/`)) &&
    ![...seeds].some((seed) => seed === path || seed.startsWith(`${path}/`) || path.startsWith(`${seed}/`)));

  const walk = (absoluteDirectory, relativeDirectory, depth) => {
    if (findings.some((row) => row.blocking)) return;
    if (depth > limits.maxDepth) {
      findings.push({ code: "scan-depth-limit", path: relativeDirectory, blocking: true });
      return;
    }
    let entries;
    try {
      entries = fs.readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      findings.push({ code: "scan-directory-unreadable", path: relativeDirectory,
        detail: error?.code || "unreadable", blocking: true });
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      scan.entries += 1;
      const path = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (!entry.isDirectory() && excludedFiles.has(path)) continue;
      if (managed.size && isManaged(path)) continue;
      if (included && entry.isDirectory() && !includedAncestors.has(path)) continue;
      if (included && !entry.isDirectory() && !included.has(path)) continue;
      if (scan.entries > limits.maxEntries) {
        findings.push({ code: "scan-entry-limit", path, blocking: true });
        return;
      }
      if (isExcludedPath(path, { excluded: excludedDirectories, tracked: tracked.has(path) })) continue;
      const absolute = resolve(root, ...path.split("/"));
      if (!withinRoot(root, absolute)) {
        findings.push({ code: "scan-path-outside-project", path, blocking: true });
        return;
      }
      if (entry.isSymbolicLink()) {
        findings.push({ code: "scan-symlink-skipped", path });
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolute, path, depth + 1);
        if (findings.some((row) => row.blocking)) return;
        continue;
      }
      if (!entry.isFile() || !sourceCandidate(path)) continue;
      scan.files += 1;
      if (scan.files > limits.maxFiles) {
        findings.push({ code: "scan-file-limit", path, blocking: true });
        return;
      }
      let knownBytes = null;
      if (typeof fs.stat === "function") {
        try { knownBytes = fs.stat(absolute).size; }
        catch (error) {
          findings.push({ code: "scan-file-unreadable", path,
            detail: error?.code || "unreadable", blocking: true });
          return;
        }
      }
      if (knownBytes !== null && knownBytes > limits.maxFileBytes) {
        const pathRelevant = seeds.has(path);
        findings.push({ code: pathRelevant ? "scan-file-size-limit" : "scan-file-size-skipped", path,
          detail: { bytes: knownBytes, maximum: limits.maxFileBytes },
          ...(pathRelevant ? { blocking: true } : {}) });
        if (pathRelevant) return;
        continue;
      }
      let content;
      try {
        content = fs.readFile(absolute);
      } catch (error) {
        findings.push({ code: "scan-file-unreadable", path,
          detail: error?.code || "unreadable", blocking: true });
        return;
      }
      if (content.byteLength > limits.maxFileBytes) {
        // A path-name match cannot justify reading an unbounded file (for
        // example every change matches CHANGELOG.md). Only an explicit seed
        // makes an oversized file part of the required grounding set.
        const pathRelevant = seeds.has(path);
        findings.push({ code: pathRelevant ? "scan-file-size-limit" : "scan-file-size-skipped", path,
          detail: { bytes: content.byteLength, maximum: limits.maxFileBytes },
          ...(pathRelevant ? { blocking: true } : {}) });
        if (pathRelevant) return;
        continue;
      }
      scan.bytes += content.byteLength;
      if (scan.bytes > limits.maxBytes) {
        findings.push({ code: "scan-byte-limit", path, blocking: true });
        return;
      }
      const text = content.toString("utf8");
      const classification = classify(path, text);
      files.push({ path, bytes: content.byteLength, content: text, ...classification });
    }
  };

  walk(root, "", 0);
  if (findings.some((row) => row.blocking))
    return blockedResult({ limits, terms, scan, findings });

  const discoveredPaths = new Set(files.map((row) => row.path));
  for (const seed of [...seeds].sort(compareText)) {
    if (!discoveredPaths.has(seed)) findings.push({
      code: "seed-not-discovered", path: seed, blocking: true
    });
  }
  if (findings.some((row) => row.blocking))
    return blockedResult({ limits, terms, scan, findings });

  const graph = graphFor(files, limits.maxGraphEdges);
  if (graph.exceeded) {
    findings.push({ code: "scan-graph-edge-limit", path: "", blocking: true });
    return blockedResult({ limits, terms, scan, findings });
  }
  delete graph.exceeded;
  const candidates = rankFiles(files, terms, seeds, graph);
  return {
    version: 1,
    status: "ready",
    complete: true,
    queryTerms: terms,
    limits,
    scan,
    findings: findings.sort((left, right) => compareText(left.path, right.path)),
    candidates,
    readSet: boundedReadSet(candidates, limits.maxReadSet),
    graph
  };
}
