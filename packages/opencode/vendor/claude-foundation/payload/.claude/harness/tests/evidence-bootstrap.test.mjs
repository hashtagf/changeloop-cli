import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  browserCandidates,
  candidateInputs,
  capabilityRepositories,
  configuredEvidenceProviders,
  dedupeEvidenceRows,
  detectEvidenceWiring,
  discoverMissingEvidence,
  evidenceCandidateRows,
  evidenceWiringStatus,
  npmLockfileCandidates,
  packageManagerAt,
  packageScriptCommand,
  packageScriptRisk,
  packageTooling,
  providerCandidate,
  providerInstanceName,
  readJsonCandidate,
  requiredEvidenceCapability,
  riskyPackageScript,
  scriptCandidates,
  testCandidates,
  unavailableEvidenceProviders
} from "../runtime/evidence/evidence-bootstrap.mjs";

test("npm manifest and lockfile get a deterministic built-in consistency candidate", () => {
  const root = workspace();
  try {
    mkdirSync(join(root, ".claude", "harness", "runtime", "evidence"), { recursive: true });
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    writeFileSync(join(root, ".claude", "harness", "runtime", "evidence",
      "npm-lockfile-check.mjs"), "");
    const rows = npmLockfileCandidates({ manager: "npm" }, repository(root), 1,
      ["package.json"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].capability, "dependency-supply-chain");
    assert.deepEqual(rows[0].config.command,
      ["node", ".claude/harness/runtime/evidence/npm-lockfile-check.mjs"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function workspace() {
  return mkdtempSync(join(tmpdir(), "foundation-evidence-bootstrap-"));
}

function repository(path, id = "root", mode = "write") {
  return { id, mode, workspacePath: path, relativePath: id === "root" ? "." : id };
}

test("JSON candidates report invalid input without treating absence as invalid", () => {
  const root = workspace();
  const warnings = [];
  try {
    assert.equal(readJsonCandidate(join(root, "missing.json"), warnings, "missing"), null);
    writeFileSync(join(root, "valid.json"), "{\"ok\":true}\n");
    assert.deepEqual(readJsonCandidate(join(root, "valid.json"), warnings, "valid"), { ok: true });
    writeFileSync(join(root, "bad.json"), "{");
    assert.equal(readJsonCandidate(join(root, "bad.json"), warnings, "bad"), null);
    assert.equal(warnings[0].source, "bad");
    assert.equal(warnings[0].reason, "invalid-json");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("package manager and command rendering retain every supported convention", () => {
  const roots = [workspace(), workspace(), workspace(), workspace(), workspace()];
  try {
    writeFileSync(join(roots[0], "pnpm-lock.yaml"), "");
    writeFileSync(join(roots[1], "yarn.lock"), "");
    writeFileSync(join(roots[2], "bun.lock"), "");
    writeFileSync(join(roots[3], "bun.lockb"), "");
    assert.deepEqual(roots.map(packageManagerAt), ["pnpm", "yarn", "bun", "bun", "npm"]);
    assert.deepEqual(packageScriptCommand("yarn", "test", ["--json"]),
      ["yarn", "test", "--json"]);
    assert.deepEqual(packageScriptCommand("pnpm", "test"), ["pnpm", "run", "test"]);
    assert.deepEqual(packageScriptCommand("bun", "test"), ["bun", "run", "test"]);
    assert.deepEqual(packageScriptCommand("npm", "test", ["--json"]),
      ["npm", "run", "test", "--", "--json"]);
    assert.deepEqual(packageScriptCommand("npm", "test"), ["npm", "run", "test"]);
  } finally { for (const root of roots) rmSync(root, { recursive: true, force: true }); }
});

test("package lifecycle risk detection catches shell download and deletion surfaces", () => {
  for (const value of ["sudo tool", "echo ok; curl x", "wget x", "rm -rf out", "$(bad)", "`bad`"]) 
    assert.equal(riskyPackageScript(value), true, value);
  assert.equal(riskyPackageScript("node test.mjs"), false);
  assert.equal(riskyPackageScript(null), false);
  assert.deepEqual(packageScriptRisk({ scripts: {
    pretest: "curl x", test: "node test.mjs", posttest: "rm -rf out"
  } }, "test"), ["pretest", "posttest"]);
});

test("candidate inputs and package tooling bind declared files and warn on corrupt manifests", () => {
  const root = workspace();
  const repo = repository(root);
  const warnings = [];
  try {
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "tests", "run.mjs"), "export default true;\n");
    const tooling = { scripts: {
      pretest: "node tests/run.mjs", test: "node --test", posttest: 7
    } };
    assert.deepEqual(candidateInputs(tooling, "test", repo, ["src/**"]), {
      inputs: ["package.json", "src/**", "tests/run.mjs"]
    });
    assert.deepEqual(candidateInputs(tooling, "test", repo, []), {});
    assert.equal(packageTooling(root, repo, warnings), null);
    writeFileSync(join(root, "package.json"), "{");
    assert.equal(packageTooling(root, repo, warnings), null);
    writeFileSync(join(root, "package.json"), JSON.stringify({
      dependencies: { vitest: "1" }, devDependencies: { eslint: "2" },
      scripts: { test: "vitest" }
    }));
    const result = packageTooling(root, repo, warnings);
    assert.deepEqual(result.dependencies, { vitest: "1", eslint: "2" });
    assert.deepEqual(result.scripts, { test: "vitest" });
    assert.equal(result.manager, "npm");
    writeFileSync(join(root, "package.json"), "{}\n");
    const empty = packageTooling(root, repo, warnings);
    assert.deepEqual(empty.dependencies, {});
    assert.deepEqual(empty.scripts, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("provider identity and candidate scoping preserve root and multi-repository shapes", () => {
  const root = repository("/root");
  const child = repository("/child", "api");
  assert.equal(providerInstanceName("test", root, 1), "test");
  assert.equal(providerInstanceName("test", child, 2), "test-api");
  const singleton = providerCandidate(null, "test", root, 1,
    { adapter: "command" }, "source");
  assert.deepEqual(singleton.config, { adapter: "command" });
  assert.equal(singleton.recommended, true);
  const scoped = providerCandidate("custom", "test", child, 2,
    { adapter: "command" }, "source", "review", "detail");
  assert.deepEqual(scoped.config, {
    adapter: "command", capability: "test", repository: "api"
  });
  assert.equal(scoped.recommended, false);
  assert.equal(scoped.detail, "detail");
});

test("test candidates distinguish missing, risky, ambiguous, and structured runners", () => {
  const repo = repository("/root");
  const base = { dependencies: {}, manager: "npm", scripts: {} };
  assert.deepEqual(testCandidates(null, repo, 1, []), []);
  assert.deepEqual(testCandidates(base, repo, 1, []), []);
  const risky = testCandidates({ ...base, scripts: {
    pretest: "curl bad", test: "node --test"
  } }, repo, 1, []);
  assert.equal(risky[0].confidence, "review");
  assert.equal(risky[0].config, null);

  const ambiguous = testCandidates({ ...base,
    dependencies: { jest: "1", mocha: "1" }, scripts: { test: "jest && mocha" }
  }, repo, 1, []);
  assert.equal(ambiguous[0].confidence, "ambiguous");
  assert.match(ambiguous[0].detail, /jest, mocha/);

  const cases = [
    [{ vitest: "1" }, "vitest", "--run", "auto"],
    [{ jest: "1" }, "jest", "--json", "auto"],
    [{ mocha: "1" }, "mocha", "--reporter=json", "auto"],
    [{}, "node --test", "--test-reporter=tap", "tap"]
  ];
  for (const [dependencies, raw, argument, format] of cases) {
    const rows = testCandidates({ ...base, dependencies, scripts: { test: raw } }, repo, 1, []);
    assert.equal(rows[0].config.command.includes(argument), true, raw);
    assert.equal(rows[0].config.reportFormat, format, raw);
    assert.equal(rows[0].confidence, "high");
  }
  const unit = testCandidates({ ...base, dependencies: { vitest: "1" },
    scripts: { unit: "vitest" } }, repo, 2, []);
  assert.equal(unit[0].confidence, "review");
  assert.match(unit[0].detail, /multi-repository/);
});

test("browser and generic script candidates enforce owned safe commands", () => {
  const repo = repository("/root");
  const base = { dependencies: {}, manager: "yarn", scripts: {} };
  assert.deepEqual(browserCandidates(null, repo, 1, []), []);
  assert.deepEqual(browserCandidates(base, repo, 1, []), []);
  assert.deepEqual(browserCandidates({ ...base, dependencies: { playwright: "1" },
    scripts: { e2e: "cypress" } }, repo, 1, []), []);
  assert.deepEqual(browserCandidates({ ...base, dependencies: { "@playwright/test": "1" },
    scripts: { e2e: "curl x && playwright test" } }, repo, 1, []), []);
  const browser = browserCandidates({ ...base, dependencies: { playwright: "1" },
    scripts: { "test:browser": "playwright test" } }, repo, 1, []);
  assert.equal(browser[0].config.adapter, "playwright");
  assert.equal(browser[0].config.inputMode, "browser-automation");

  assert.deepEqual(scriptCandidates("static-analysis", null, repo, 1, []), []);
  assert.deepEqual(scriptCandidates("unknown", base, repo, 1, []), []);
  const unsafe = scriptCandidates("static-analysis", { ...base,
    scripts: { lint: "curl x" } }, repo, 1, []);
  assert.equal(unsafe[0].confidence, "review");
  assert.equal(unsafe[0].config, null);
  const preferred = scriptCandidates("static-analysis", { ...base,
    scripts: { lint: "eslint ." } }, repo, 1, []);
  assert.equal(preferred[0].confidence, "high");
  const alternatives = scriptCandidates("static-analysis", { ...base,
    scripts: { check: "tsc", lint: "eslint .", typecheck: "curl x" }
  }, repo, 1, []);
  assert.deepEqual(alternatives.map((row) => row.confidence), ["alternative", "alternative"]);
  assert.match(alternatives[0].detail, /alternatives detected/);
});

test("capability repository routing honors claim scope and writable defaults", () => {
  const repositories = [
    repository("/root"), repository("/api", "api"), repository("/docs", "docs", "read")
  ];
  assert.deepEqual(capabilityRepositories("test", repositories, { claims: [] })
    .map((row) => row.id), ["root", "api"]);
  const contract = { claims: [
    { capabilities: ["test"], repositories: ["docs"] },
    { capabilities: ["other"] },
    { capabilities: ["test"], repositories: ["api", "docs"] }
  ] };
  assert.deepEqual(capabilityRepositories("test", repositories, contract)
    .map((row) => row.id), ["api", "docs"]);
});

test("configured providers and availability diagnostics preserve adapter semantics", () => {
  const repositories = [repository("/root"), repository("/api", "api")];
  const checked = [];
  const configured = configuredEvidenceProviders({
    contract: { providers: {
      external: { adapter: "external" },
      test: { adapter: "command", repository: "api", command: ["node"] },
      missing: { adapter: "command", repository: "ghost", command: [] }
    } }, repositories, root: "/root",
    providerCapability: (provider) => provider,
    commandExists: (command, path) => { checked.push([command, path]); return false; }
  });
  assert.equal(configured[0].available, null);
  assert.equal(configured[1].available, false);
  assert.equal(configured[2].available, null);
  assert.deepEqual(checked, [["node", "/api"]]);
  const unavailable = unavailableEvidenceProviders(configured);
  assert.equal(unavailable.length, 1);
  assert.match(unavailable[0].next, /'node'/);
  assert.equal(evidenceWiringStatus(unavailable, [], []), "INFRASTRUCTURE_ERROR");
  assert.equal(evidenceWiringStatus([], [{}], []), "NEEDS_CONFIGURATION");
  assert.equal(evidenceWiringStatus([], [], [{}]), "NEEDS_CONFIGURATION");
  assert.equal(evidenceWiringStatus([], [], []), "READY");
});

test("required capability and candidate dispatch cover known, custom, and discovery providers", () => {
  const known = new Set(["test"]);
  const config = () => null;
  assert.equal(requiredEvidenceCapability("test", known, () => "other", config), "test");
  assert.equal(requiredEvidenceCapability("custom", known, () => "browser", config), "browser");
  assert.equal(requiredEvidenceCapability("custom", known, () => null, config), "custom");
  const repo = repository("/root");
  const tooling = { dependencies: { vitest: "1", playwright: "1" }, manager: "npm",
    scripts: { test: "vitest", e2e: "playwright test", lint: "eslint ." } };
  assert.equal(evidenceCandidateRows("test", tooling, repo, 1, []).length, 1);
  assert.equal(evidenceCandidateRows("browser", tooling, repo, 1, []).length, 1);
  assert.deepEqual(evidenceCandidateRows("discovery", tooling, repo, 1, []), []);
  assert.equal(evidenceCandidateRows("static-analysis", tooling, repo, 1, []).length, 1);
});

test("missing evidence discovery produces candidates, authority stops, and actionable gaps", () => {
  const repo = repository("/root");
  const tooling = new Map([["root", {
    dependencies: { vitest: "1" }, manager: "npm", scripts: { test: "vitest" }
  }]]);
  const providerConfig = () => null;
  const providerCapability = (provider) => provider === "custom" ? "test" : provider;
  const result = discoverMissingEvidence({
    missing: ["custom", "discovery", "review", "performance"],
    providerConfig, providerCapability,
    knownProviders: new Set(["discovery", "review", "performance"]),
    repositories: [repo], contract: { claims: [] }, tooling, declaredSurface: []
  });
  assert.equal(result.candidates[0].provider, "custom");
  assert.equal(result.unresolved.some((row) => row.reason === "external-authority"), true);
  assert.equal(result.unresolved.some((row) => row.reason === "no-safe-project-command"), true);
  assert.equal(result.unresolved.some((row) =>
    row.reason === "structured-test-count-unavailable"), false);

  const absent = discoverMissingEvidence({
    missing: ["discovery"], providerConfig, providerCapability,
    knownProviders: new Set(["discovery"]), repositories: [repo],
    contract: { claims: [] }, tooling: new Map([["root", null]]), declaredSurface: []
  });
  assert.equal(absent.unresolved[0].reason, "structured-test-count-unavailable");
});

test("dedupe and top-level detection return stable ready, configuration, and infrastructure states", () => {
  const rows = [
    { provider: "test", capability: "test", repository: "root", source: "x" },
    { provider: "test", capability: "test", repository: "root", source: "x" }
  ];
  assert.equal(dedupeEvidenceRows(rows, JSON.stringify).length, 1);
  const root = workspace();
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      scripts: { test: "vitest" }, devDependencies: { vitest: "1" }
    }));
    const base = {
      id: "change", root, contract: { claims: [], providers: {} },
      repositories: [repository(root)], providerConfig: () => null,
      providerCapability: (provider) => provider, knownProviders: new Set(["test"]),
      commandExists: () => true, stableHash: JSON.stringify
    };
    const needs = detectEvidenceWiring({ ...base, required: ["test"] });
    assert.equal(needs.status, "NEEDS_CONFIGURATION");
    assert.equal(needs.candidates[0].capability, "test");
    const ready = detectEvidenceWiring({ ...base, required: [] });
    assert.equal(ready.status, "READY");

    mkdirSync(join(root, "quality"), { recursive: true });
    writeFileSync(join(root, "quality", "foundation-quality.json"), "{}\n");
    const quality = detectEvidenceWiring({ ...base,
      knownProviders: new Set(["static-analysis"]), required: ["static-analysis"] });
    assert.equal(quality.candidates[0].source, "quality/foundation-quality.json");
    assert.deepEqual(quality.candidates[0].config.repositories, ["root"]);
    assert.ok(quality.candidates[0].config.command.includes("--enforce"));

    const unavailable = detectEvidenceWiring({ ...base, required: [],
      contract: { claims: [], providers: {
        test: { adapter: "command", command: ["missing"] }
      } }, commandExists: () => false });
    assert.equal(unavailable.status, "INFRASTRUCTURE_ERROR");
    assert.equal(unavailable.unavailable[0].executable, "missing");

    writeFileSync(join(root, "package.json"), "{");
    const warned = detectEvidenceWiring({ ...base, required: [] });
    assert.equal(warned.warnings[0].reason, "invalid-json");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
