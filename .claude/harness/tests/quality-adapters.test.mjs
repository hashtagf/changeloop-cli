import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  parseGoComplexity, parseGoFunctionCoverage, runBuiltinQualityAdapter
} from "../runtime/quality/adapter-registry.mjs";

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "foundation-quality-adapter-"));
  const repository = { id: "root", path: root };
  const pathInside = (parent, candidate) => {
    const value = relative(resolve(parent), resolve(candidate));
    return value === "" || (!value.startsWith("..") && !value.startsWith("/"));
  };
  try { return run({ root, repository, pathInside }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("canonical function adapter computes CRAP in Harness", () => withFixture(({ root, repository, pathInside }) => {
  writeFileSync(join(root, "complexity.json"), JSON.stringify({ functions: [
    { id: "authorize", path: "src/auth.ts", line: 4, endLine: 20, complexity: 10 }
  ] }));
  writeFileSync(join(root, "coverage.json"), JSON.stringify({ functions: [
    { id: "authorize", path: "src/auth.ts", line: 4, coveragePercent: 50, coverageKind: "branch" }
  ] }));
  const report = runBuiltinQualityAdapter({ repository, capability: "crap", pathInside,
    repositoryCommit: "abc", provider: { adapter: "canonical-functions", language: "typescript",
      inputs: { complexity: "complexity.json", coverage: "coverage.json" }, tool: { name: "fixture", version: "1" } } });
  assert.equal(report.functions[0].crap, 22.5);
  assert.equal(report.functions[0].mapping, "exact");
}));

test("JavaScript adapter maps Istanbul branch coverage to complexity records", () => withFixture(({ root, repository, pathInside }) => {
  writeFileSync(join(root, "complexity.json"), JSON.stringify({ functions: [
    { name: "authorize", path: "src/auth.ts", line: 4, endLine: 10, cyclomatic: 3 }
  ] }));
  writeFileSync(join(root, "coverage.json"), JSON.stringify({
    [join(root, "src", "auth.ts")]: {
      fnMap: { 0: { name: "authorize", loc: { start: { line: 4, column: 0 }, end: { line: 10, column: 1 } } } },
      f: { 0: 2 },
      branchMap: { 0: { loc: { start: { line: 6, column: 0 }, end: { line: 6, column: 10 } } } },
      b: { 0: [2, 0] }, statementMap: {}, s: {}
    }
  }));
  const report = runBuiltinQualityAdapter({ repository, capability: "crap", pathInside,
    repositoryCommit: "abc", provider: { adapter: "javascript-istanbul", language: "typescript",
      inputs: { complexity: "complexity.json", coverage: "coverage.json" },
      tool: { name: "eslint+istanbul", version: "1" } } });
  assert.equal(report.functions[0].coveragePercent, 50);
  assert.equal(report.functions[0].coverageKind, "branch");
}));

test("Go adapter parses gocyclo and function coverage", () => withFixture(({ root, repository, pathInside }) => {
  assert.equal(parseGoComplexity("12 auth Authorize internal/auth/auth.go:42:1")[0].complexity, 12);
  assert.equal(parseGoFunctionCoverage("internal/auth/auth.go:42:\tAuthorize\t85.0%")[0].coveragePercent, 85);
  writeFileSync(join(root, "complexity.txt"), "12 auth Authorize internal/auth/auth.go:42:1\n");
  writeFileSync(join(root, "coverage.txt"), "internal/auth/auth.go:42:\tAuthorize\t85.0%\ntotal:\t(statements)\t80.0%\n");
  const report = runBuiltinQualityAdapter({ repository, capability: "crap", pathInside,
    repositoryCommit: "abc", provider: { adapter: "go-complexity-cover", language: "go",
      inputs: { complexity: "complexity.txt", coverage: "coverage.txt" }, tool: { name: "gocyclo+cover", version: "1" } } });
  assert.equal(report.functions[0].coveragePercent, 85);
  assert.equal(report.functions[0].mapping, "range");
}));

test("Python adapter maps executed lines into Radon function ranges", () => withFixture(({ root, repository, pathInside }) => {
  writeFileSync(join(root, "radon.json"), JSON.stringify({ "app.py": [
    { type: "F", name: "authorize", lineno: 1, endline: 4, complexity: 4 }
  ] }));
  writeFileSync(join(root, "coverage.json"), JSON.stringify({ files: {
    "app.py": { executed_lines: [1, 2, 3], missing_lines: [4] }
  } }));
  const report = runBuiltinQualityAdapter({ repository, capability: "crap", pathInside,
    repositoryCommit: "abc", provider: { adapter: "python-radon-coverage", language: "python",
      inputs: { complexity: "radon.json", coverage: "coverage.json" }, tool: { name: "radon+coverage", version: "1" } } });
  assert.equal(report.functions[0].coveragePercent, 75);
  assert.equal(report.functions[0].coverageKind, "statement");
}));

test("PHP Clover adapter extracts method complexity and coverage", () => withFixture(({ root, repository, pathInside }) => {
  writeFileSync(join(root, "clover.xml"), `<coverage><project><file name="src/Auth.php">
    <method name="authorize" line="10"><metrics complexity="6" statements="4" coveredstatements="3"/></method>
  </file></project></coverage>`);
  const report = runBuiltinQualityAdapter({ repository, capability: "crap", pathInside,
    repositoryCommit: "abc", provider: { adapter: "php-clover", language: "php",
      inputs: { clover: "clover.xml" }, tool: { name: "clover", version: "1" } } });
  assert.equal(report.functions[0].complexity, 6);
  assert.equal(report.functions[0].coveragePercent, 75);
}));

test("PHP Clover adapter accepts PHPUnit method line records", () => withFixture(({ root, repository, pathInside }) => {
  writeFileSync(join(root, "clover.xml"), `<coverage><project><file name="src/Auth.php">
    <line num="10" type="method" name="authorize" complexity="6" count="1"/>
    <line num="30" type="method" name="deny" complexity="3" count="0"/>
  </file></project></coverage>`);
  const report = runBuiltinQualityAdapter({ repository, capability: "crap", pathInside,
    repositoryCommit: "abc", provider: { adapter: "php-clover", language: "php",
      inputs: { clover: "clover.xml" }, tool: { name: "phpunit-clover", version: "1" } } });
  assert.deepEqual(report.functions.map((fn) => [fn.id, fn.complexity, fn.coveragePercent]),
    [["authorize", 6, 100], ["deny", 3, 0]]);
}));

test("generic mutation adapter normalizes Stryker-like reports", () => withFixture(({ root, repository, pathInside }) => {
  writeFileSync(join(root, "mutation.json"), JSON.stringify({ files: {
    "src/auth.ts": { mutants: [
      { id: "m1", mutatorName: "ConditionalExpression", status: "Killed",
        location: { start: { line: 4 } }, killedBy: ["case-1"] },
      { id: "m2", mutatorName: "BooleanLiteral", status: "NoCoverage",
        location: { start: { line: 8 } } },
      { id: "m3", mutatorName: "Ignored", status: "Skipped",
        location: { start: { line: 9 } }, reason: "filtered by tool" },
      { id: "m4", mutatorName: "Equivalent", status: "Ignored", equivalent: true,
        location: { start: { line: 10 } }, reason: "compiler proves identical bytecode" }
    ] }
  } }));
  const report = runBuiltinQualityAdapter({ repository, capability: "automated-mutation", pathInside,
    repositoryCommit: "abc", provider: { adapter: "generic-mutation-json", language: "typescript",
      inputs: { mutation: "mutation.json" }, tool: { name: "stryker", version: "9" } } });
  assert.deepEqual(report.mutants.map((mutant) => mutant.status),
    ["killed", "no-coverage", "unavailable", "ignored-equivalent"]);
}));

test("adapter inputs cannot escape the repository", () => withFixture(({ repository, pathInside }) => {
  assert.throws(() => runBuiltinQualityAdapter({ repository, capability: "crap", pathInside,
    repositoryCommit: "abc", provider: { adapter: "canonical-functions", language: "javascript",
      inputs: { complexity: "../secret.json", coverage: "coverage.json" } } }), /escapes repository/);
}));
