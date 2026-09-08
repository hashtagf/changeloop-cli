import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { configDigest, normalizeCrapReport, normalizeMutationReport } from "./quality-protocol.mjs";

export const QUALITY_ADAPTER_VERSION = "1";

function safeRead(repository, path, pathInside) {
  if (typeof path !== "string" || !path || isAbsolute(path))
    throw new Error("adapter input must be a repository-relative path");
  const absolute = resolve(repository.path, path);
  if (!pathInside(repository.path, absolute)) throw new Error(`adapter input escapes repository: ${path}`);
  return readFileSync(absolute, "utf8");
}

function normalizedPath(repository, path) {
  const absolute = resolve(repository.path, path);
  const rel = relative(repository.path, absolute).replaceAll("\\", "/");
  return rel.replace(/^\.\//, "");
}

function tool(provider) {
  return {
    name: provider.tool?.name || provider.adapter,
    version: String(provider.tool?.version || "unknown"),
    adapterVersion: QUALITY_ADAPTER_VERSION,
    configDigest: configDigest({ adapter: provider.adapter, inputs: provider.inputs,
      tool: provider.tool || null })
  };
}

function canonicalComplexity(value) {
  const rows = Array.isArray(value) ? value : value.functions;
  if (!Array.isArray(rows)) throw new Error("complexity input requires a functions array");
  return rows.map((row) => ({
    id: row.id || row.name,
    path: String(row.path || row.file || "").replaceAll("\\", "/"),
    line: Number(row.line || row.startLine || row.lineno),
    endLine: Number(row.endLine || row.endline || row.line || row.startLine || row.lineno),
    complexity: Number(row.complexity ?? row.cyclomatic ?? row.rank)
  }));
}

function canonicalCoverage(value) {
  const rows = Array.isArray(value) ? value : value.functions;
  if (!Array.isArray(rows)) throw new Error("coverage input requires a functions array");
  return rows.map((row) => ({
    id: row.id || row.name,
    path: String(row.path || row.file || "").replaceAll("\\", "/"),
    line: Number(row.line || row.startLine || row.lineno),
    coveragePercent: Number(row.coveragePercent ?? row.coverage ?? row.percent),
    coverageKind: row.coverageKind || row.kind || "function"
  }));
}

function joinFunctionRecords(complexity, coverage, coverageClass = "unit") {
  return complexity.map((fn) => {
    const exact = coverage.find((row) => row.path === fn.path && row.id === fn.id);
    const line = coverage.filter((row) => row.path === fn.path)
      .sort((left, right) => Math.abs(left.line - fn.line) - Math.abs(right.line - fn.line))[0];
    const match = exact || line || null;
    return {
      ...fn,
      coverageKind: match?.coverageKind || "unavailable",
      coverageClass,
      coveragePercent: match && Number.isFinite(match.coveragePercent) ? match.coveragePercent : null,
      crap: null,
      mapping: exact ? "exact" : match ? "range" : "unmapped"
    };
  });
}

function within(inner, outer) {
  const start = inner?.start || inner;
  const end = inner?.end || start;
  return start && end && start.line >= outer.start.line && end.line <= outer.end.line;
}

function istanbulCoverageForFunction(file, fn) {
  const entries = Object.entries(file.fnMap || {});
  const candidates = entries.filter(([, value]) =>
    value.loc?.start?.line === fn.line ||
    (value.loc?.start?.line <= fn.line && value.loc?.end?.line >= fn.line));
  const selected = candidates.sort((left, right) => {
    const leftNamed = left[1].name === fn.id ? -1 : 0;
    const rightNamed = right[1].name === fn.id ? -1 : 0;
    return leftNamed - rightNamed ||
      (left[1].loc.end.line - left[1].loc.start.line) -
      (right[1].loc.end.line - right[1].loc.start.line);
  })[0];
  const range = selected?.[1]?.loc || { start: { line: fn.line }, end: { line: fn.endLine } };
  const branches = Object.entries(file.branchMap || {}).filter(([, branch]) => within(branch.loc, range));
  const counts = branches.flatMap(([id]) => file.b?.[id] || []);
  if (counts.length) return { coverageKind: "branch",
    coveragePercent: counts.filter((count) => count > 0).length / counts.length * 100,
    mapping: selected ? "exact" : "range" };
  if (selected) return { coverageKind: "function",
    coveragePercent: Number(file.f?.[selected[0]] || 0) > 0 ? 100 : 0,
    mapping: "function-fallback" };
  const statements = Object.entries(file.statementMap || {}).filter(([, location]) => within(location, range));
  if (statements.length) return { coverageKind: "statement",
    coveragePercent: statements.filter(([id]) => Number(file.s?.[id] || 0) > 0).length / statements.length * 100,
    mapping: "range" };
  return { coverageKind: "unavailable", coveragePercent: null, mapping: "unmapped" };
}

function javascriptIstanbulAdapter({ repository, provider, inputs, repositoryCommit, workspaceDigest }) {
  const complexity = canonicalComplexity(JSON.parse(inputs.complexity));
  const coverage = JSON.parse(inputs.coverage);
  const byPath = new Map(Object.entries(coverage).map(([path, value]) =>
    [normalizedPath(repository, path), value]));
  const functions = complexity.map((fn) => {
    const path = normalizedPath(repository, fn.path);
    const measured = byPath.has(path)
      ? istanbulCoverageForFunction(byPath.get(path), { ...fn, path })
      : { coverageKind: "unavailable", coveragePercent: null, mapping: "unmapped" };
    return { ...fn, path, coverageClass: provider.coverageClass || "unit", ...measured, crap: null };
  });
  return normalizeCrapReport({ protocol: "foundation-crap-v1", repository: repository.id,
    repositoryCommit, workspaceDigest, language: provider.language || "javascript", tool: tool(provider), functions });
}

function canonicalFunctionAdapter({ repository, provider, inputs, repositoryCommit, workspaceDigest }) {
  const complexity = canonicalComplexity(JSON.parse(inputs.complexity));
  const coverage = canonicalCoverage(JSON.parse(inputs.coverage));
  return normalizeCrapReport({
    protocol: "foundation-crap-v1", repository: repository.id,
    repositoryCommit, workspaceDigest, language: provider.language, tool: tool(provider),
    functions: joinFunctionRecords(complexity, coverage, provider.coverageClass || "unit")
  });
}

function pythonAdapter({ repository, provider, inputs, repositoryCommit, workspaceDigest }) {
  const radon = JSON.parse(inputs.complexity);
  const coverage = JSON.parse(inputs.coverage);
  const complexity = [];
  for (const [path, blocks] of Object.entries(radon)) for (const block of blocks || []) {
    if (!["F", "M"].includes(block.type)) continue;
    complexity.push({ id: block.fullname || block.name, path: path.replaceAll("\\", "/"),
      line: Number(block.lineno), endLine: Number(block.endline || block.lineno),
      complexity: Number(block.complexity) });
  }
  const functions = complexity.map((fn) => {
    const file = coverage.files?.[fn.path] || coverage.files?.[resolve(repository.path, fn.path)];
    if (!file) return { ...fn, coverageClass: provider.coverageClass || "unit",
      coverageKind: "unavailable", coveragePercent: null,
      crap: null, mapping: "unmapped" };
    const executed = new Set(file.executed_lines || []);
    const measured = new Set([...(file.executed_lines || []), ...(file.missing_lines || [])]);
    const relevant = [...measured].filter((line) => line >= fn.line && line <= fn.endLine);
    if (!relevant.length) return { ...fn, coverageClass: provider.coverageClass || "unit",
      coverageKind: "unavailable", coveragePercent: null,
      crap: null, mapping: "unmapped" };
    const percent = relevant.filter((line) => executed.has(line)).length / relevant.length * 100;
    return { ...fn, coverageClass: provider.coverageClass || "unit",
      coverageKind: "statement", coveragePercent: percent,
      crap: null, mapping: "range" };
  });
  return normalizeCrapReport({ protocol: "foundation-crap-v1", repository: repository.id,
    repositoryCommit, workspaceDigest, language: "python", tool: tool(provider), functions });
}

export function parseGoComplexity(source) {
  return source.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.+):(\d+):\d+$/);
    if (!match) throw new Error(`invalid Go complexity row: ${line}`);
    return { complexity: Number(match[1]), id: `${match[2]}.${match[3]}`,
      path: match[4].replaceAll("\\", "/"), line: Number(match[5]), endLine: Number(match[5]) };
  });
}

export function parseGoFunctionCoverage(source) {
  return source.split(/\r?\n/).filter((line) => line && !/^total:/.test(line)).map((line) => {
    const match = line.match(/^(.+):(\d+):\s+(\S+)\s+([0-9.]+)%$/);
    if (!match) throw new Error(`invalid Go function coverage row: ${line}`);
    return { path: match[1].replaceAll("\\", "/"), line: Number(match[2]), id: match[3],
      coveragePercent: Number(match[4]), coverageKind: "function" };
  });
}

function goAdapter({ repository, provider, inputs, repositoryCommit, workspaceDigest }) {
  const complexity = parseGoComplexity(inputs.complexity).map((row) => ({
    ...row, path: normalizedPath(repository, row.path)
  }));
  const coverage = parseGoFunctionCoverage(inputs.coverage).map((row) => ({
    ...row, path: normalizedPath(repository, row.path)
  }));
  // Go coverage names omit package qualification; line/path mapping is the
  // authoritative fallback when the fully-qualified gocyclo name differs.
  return normalizeCrapReport({ protocol: "foundation-crap-v1", repository: repository.id,
    repositoryCommit, workspaceDigest, language: "go", tool: tool(provider),
    functions: joinFunctionRecords(complexity, coverage, provider.coverageClass || "unit") });
}

function phpCloverAdapter({ repository, provider, inputs, repositoryCommit, workspaceDigest }) {
  const source = inputs.clover;
  const functions = [];
  const attributes = (source) => Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)]
    .map((match) => [match[1], match[2]]));
  const filePattern = /<file\s+[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/file>/g;
  let file;
  while ((file = filePattern.exec(source))) {
    const path = normalizedPath(repository, file[1]);
    const methodPattern = /<method\s+([^>]*)>([\s\S]*?)<\/method>/g;
    let method;
    while ((method = methodPattern.exec(file[2]))) {
      const attr = (name) => method[1].match(new RegExp(`${name}="([^"]+)"`))?.[1];
      const metrics = method[2].match(/<metrics\s+([^>]*)\/?\s*>/)?.[1] || "";
      const metric = (name) => metrics.match(new RegExp(`${name}="([^"]+)"`))?.[1];
      const statements = Number(metric("statements") || 0);
      const covered = Number(metric("coveredstatements") || 0);
      functions.push({ id: attr("name"), path, line: Number(attr("line") || 1),
        endLine: Number(attr("line") || 1), complexity: Number(metric("complexity") || 1),
        coverageKind: "statement", coverageClass: provider.coverageClass || "unit",
        coveragePercent: statements ? covered / statements * 100 : 0,
        crap: null, mapping: "exact" });
    }
    // PHPUnit/Clover commonly represents methods as self-closing line rows.
    // Count is function execution coverage; complexity is still method-local.
    const linePattern = /<line\s+([^>]*\btype="method"[^>]*)\/?\s*>/g;
    let line;
    while ((line = linePattern.exec(file[2]))) {
      const attr = attributes(line[1]);
      if (!attr.name || functions.some((fn) => fn.path === path && fn.id === attr.name &&
          fn.line === Number(attr.num || 1))) continue;
      functions.push({ id: attr.name, path, line: Number(attr.num || 1),
        endLine: Number(attr.num || 1), complexity: Number(attr.complexity || 1),
        coverageKind: "function", coverageClass: provider.coverageClass || "unit",
        coveragePercent: Number(attr.count || 0) > 0 ? 100 : 0,
        crap: null, mapping: "function-fallback" });
    }
  }
  return normalizeCrapReport({ protocol: "foundation-crap-v1", repository: repository.id,
    repositoryCommit, workspaceDigest, language: "php", tool: tool(provider), functions });
}

const STATUS = Object.freeze({
  Killed: "killed", Survived: "survived", NoCoverage: "no-coverage",
  Timeout: "timeout", CompileError: "compile-error", RuntimeError: "runtime-error",
  Ignored: "unavailable", Skipped: "unavailable"
});

function mutationRows(value) {
  if (Array.isArray(value.mutants)) return value.mutants;
  if (value.files && typeof value.files === "object")
    return Object.entries(value.files).flatMap(([path, file]) =>
      (file.mutants || []).map((mutant) => ({ ...mutant, path: mutant.path || path })));
  throw new Error("mutation input requires mutants or files.*.mutants");
}

function genericMutationAdapter({ repository, provider, inputs, repositoryCommit, workspaceDigest }) {
  const value = JSON.parse(inputs.mutation);
  const mutants = mutationRows(value).map((mutant, index) => {
    const location = mutant.location?.start || mutant.location || {};
    const nativeStatus = mutant.status || mutant.state;
    const reason = mutant.reason || mutant.statusReason || mutant.description || null;
    const explicitlyEquivalent = mutant.equivalent === true && typeof reason === "string" && reason.trim();
    const status = explicitlyEquivalent ? "ignored-equivalent" :
      STATUS[nativeStatus] || String(nativeStatus || "unavailable").toLowerCase();
    return {
      id: String(mutant.id ?? `${mutant.path}:${location.line || mutant.line || 1}:${index}`),
      path: normalizedPath(repository, mutant.path || mutant.fileName || "unknown"),
      line: Number(location.line || mutant.line || 1),
      operator: String(mutant.mutatorName || mutant.mutator || mutant.operator || "unknown"),
      status,
      killedBy: status === "killed" ? (mutant.killedBy || mutant.killedByTests || []).map(String) : [],
      changedSurface: "unknown",
      ...(reason ? { reason: String(reason) } : {}),
      ...(Number.isFinite(mutant.durationMs) ? { durationMs: mutant.durationMs } : {})
    };
  });
  return normalizeMutationReport({ protocol: "foundation-automated-mutation-v1",
    repository: repository.id, repositoryCommit, workspaceDigest, language: provider.language,
    tool: tool(provider), mutants });
}

export const QUALITY_ADAPTERS = Object.freeze({
  "canonical-functions": { capability: "crap", inputs: ["complexity", "coverage"], run: canonicalFunctionAdapter },
  "javascript-istanbul": { capability: "crap", inputs: ["complexity", "coverage"], run: javascriptIstanbulAdapter },
  "python-radon-coverage": { capability: "crap", inputs: ["complexity", "coverage"], run: pythonAdapter },
  "go-complexity-cover": { capability: "crap", inputs: ["complexity", "coverage"], run: goAdapter },
  "php-clover": { capability: "crap", inputs: ["clover"], run: phpCloverAdapter },
  "generic-mutation-json": { capability: "automated-mutation", inputs: ["mutation"], run: genericMutationAdapter }
});

export function runBuiltinQualityAdapter({ repository, capability, provider, pathInside, repositoryCommit,
  workspaceDigest }) {
  const adapter = QUALITY_ADAPTERS[provider.adapter];
  if (!adapter) throw new Error(`unknown built-in quality adapter '${provider.adapter || ""}'`);
  if (adapter.capability !== capability)
    throw new Error(`adapter '${provider.adapter}' provides ${adapter.capability}, not ${capability}`);
  const inputs = {};
  for (const name of adapter.inputs) {
    const path = provider.inputs?.[name];
    if (!path) throw new Error(`adapter '${provider.adapter}' requires input '${name}'`);
    inputs[name] = safeRead(repository, path, pathInside);
  }
  return adapter.run({ repository, provider, inputs, repositoryCommit,
    workspaceDigest: workspaceDigest || configDigest({ repository: repository.id, repositoryCommit }) });
}
