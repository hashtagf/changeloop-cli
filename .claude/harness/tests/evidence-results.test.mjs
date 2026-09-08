import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateEvidenceStatus,
  adapterResources,
  collectPlaywrightAttachments,
  configuredCommand,
  evidenceResultValue,
  mutationProtocolResult,
  numericReportValue,
  parseJsonOutput,
  parseNodeTestSpecOutput,
  parseTapOutput,
  playwrightAnnotationCriticalCases,
  playwrightAnnotationClaims,
  playwrightReportSummary,
  playwrightTestOutcome,
  recordPlaywrightTest,
  resourcesConflict,
  visitPlaywrightReport
} from "../runtime/evidence/evidence-results.mjs";
import { criticalCaseResult } from "../runtime/evidence/adapter-runtime.mjs";

test("all adapters share one typed evidence-result contract", () => {
  assert.deepEqual(evidenceResultValue({
    provider: "test", status: "pass", observations: [{ id: "CASE-1" }]
  }), {
    version: 1, provider: "test", status: "pass",
    observations: [{ id: "CASE-1" }]
  });
  assert.equal(aggregateEvidenceStatus(["pass", "inconclusive", "fail"]), "fail");
  assert.equal(aggregateEvidenceStatus(["fail", "error", "pass"]), "error");
  assert.throws(() => evidenceResultValue({ provider: "", status: "pass" }),
    /requires provider/);
  assert.throws(() => evidenceResultValue({ provider: "test", status: "blocked" }),
    /invalid evidence status/);
  assert.throws(() => evidenceResultValue({
    provider: "test", status: "pass", observations: null
  }), /observations must be an array/);
});

test("result parsers accept JSON and complete TAP summaries", () => {
  assert.equal(parseJsonOutput(""), null);
  assert.deepEqual(parseJsonOutput("  {\"status\":\"ok\"}  "), { status: "ok" });
  assert.equal(parseJsonOutput("not json"), null);

  assert.equal(parseTapOutput(null), null);
  assert.equal(parseTapOutput("ordinary output"), null);
  assert.equal(parseTapOutput("TAP version 13\n# no totals"), null);
  assert.deepEqual(parseTapOutput([
    "TAP version 13", "1..2", "ok 1 - first", "not ok 2 - second",
    "# tests 2", "# pass 1", "# fail 1"
  ].join("\n")), {
    totalTests: 2, passed: 1, failed: 1, format: "tap",
    criticalCases: [
      { id: "first", status: "pass" },
      { id: "second", status: "fail" }
    ]
  });
  assert.deepEqual(parseTapOutput("ok 1 - works\n1..1"), {
    totalTests: 1, passed: null, failed: null, format: "tap",
    criticalCases: [{ id: "works", status: "pass" }]
  });
  assert.deepEqual(parseTapOutput([
    "TAP version 13",
    "ok 1 - an unknown id is rejected [unknown-id-rejected]",
    "ok 2 - an interrupted write preserves data [interrupted-save-preserves-store]",
    "1..2", "# tests 2", "# pass 2", "# fail 0"
  ].join("\n")).criticalCases, [
    { id: "an unknown id is rejected [unknown-id-rejected]", status: "pass" },
    { id: "an interrupted write preserves data [interrupted-save-preserves-store]", status: "pass" }
  ]);
  assert.equal(parseTapOutput(`TAP version 13\n1..${"9".repeat(400)}`), null);
});

test("nested TAP critical cases match stable IDs before title punctuation", () => {
  const report = parseTapOutput([
    "TAP version 13",
    "# Subtest: persistence",
    "    ok 1 - CC-001-store-survives: preserves bytes",
    "    not ok 2 - CC-002-store-rejects: reports corruption",
    "    1..2",
    "not ok 1 - persistence",
    "1..1", "# tests 2", "# pass 1", "# fail 1"
  ].join("\n"));
  assert.deepEqual(criticalCaseResult(report, [
    "CC-001-store-survives", "CC-002-store-rejects"
  ]), {
    status: "fail",
    observations: [
      { id: "CC-001-store-survives", status: "pass" },
      { id: "CC-002-store-rejects", status: "fail" }
    ]
  });
});

test("Node spec output exposes totals and critical-case observations", () => {
  assert.deepEqual(parseNodeTestSpecOutput([
    "✔ zero window [AC1] (1.2ms)",
    "✖ negative window [AC2] (0.4ms)",
    "ℹ tests 2", "ℹ pass 1", "ℹ fail 1"
  ].join("\n")), {
    totalTests: 2, passed: 1, failed: 1, format: "node-spec",
    criticalCases: [
      { id: "zero window [AC1]", status: "pass" },
      { id: "negative window [AC2]", status: "fail" }
    ]
  });
  assert.equal(parseNodeTestSpecOutput("ordinary output"), null);
});

test("mutation protocol parser accepts markers and supported JSON fields only", () => {
  assert.equal(mutationProtocolResult(null), null);
  for (const result of [
    "behavioral-kill", "test-failure", "survived", "crash", "timeout", "not-applied"
  ])
    assert.equal(mutationProtocolResult(
      `diagnostic\nFOUNDATION_MUTATION_RESULT=${result}\n`), result);
  assert.equal(mutationProtocolResult(JSON.stringify({
    foundationMutationResult: "behavioral-kill"
  })), "behavioral-kill");
  assert.equal(mutationProtocolResult(JSON.stringify({
    mutationResult: "timeout"
  })), "timeout");
  assert.equal(mutationProtocolResult(JSON.stringify({
    foundationMutationResult: "unsupported", mutationResult: "survived"
  })), null);
  assert.equal(mutationProtocolResult("not json"), null);
});

test("numeric report lookup checks direct, summary, and stats containers safely", () => {
  assert.equal(numericReportValue(null, ["tests"]), null);
  assert.equal(numericReportValue([], ["tests"]), null);
  assert.equal(numericReportValue({ tests: 3, summary: { tests: 4 } }, ["tests"]), 3);
  assert.equal(numericReportValue({ summary: { tests: 4 } }, ["tests"]), 4);
  assert.equal(numericReportValue({ summary: [], stats: { total: 5 } },
    ["tests", "total"]), 5);
  for (const value of [-1, 1.5, "2", null])
    assert.equal(numericReportValue({ tests: value }, ["tests"]), null);
});

test("configured commands normalize direct Playwright flags without duplication", () => {
  assert.deepEqual(configuredCommand("test", {
    adapter: "shell", command: ["node", "test.mjs"]
  }), { command: "node", args: ["test.mjs"], display: "node test.mjs" });

  const direct = configuredCommand("browser", {
    adapter: "playwright", command: ["playwright", "test"], project: "chromium"
  });
  assert.deepEqual(direct.args,
    ["test", "--project=chromium", "--reporter=json"]);
  assert.equal(direct.display,
    "playwright test --project=chromium --reporter=json");

  const pinned = configuredCommand("browser", {
    adapter: "playwright",
    command: ["/tools/playwright", "test", "--project", "webkit", "--reporter=line"],
    project: "chromium"
  });
  assert.deepEqual(pinned.args,
    ["test", "--project", "webkit", "--reporter=line"]);
  assert.deepEqual(configuredCommand("browser", {
    adapter: "playwright", command: ["npx", "@playwright/test", "--reporter", "dot"]
  }).args, ["@playwright/test", "--reporter", "dot"]);
  assert.deepEqual(configuredCommand("browser", {
    adapter: "playwright", command: ["node", "custom-runner.mjs"]
  }).args, ["custom-runner.mjs"]);
});

test("adapter resources are scoped, stable, and honor explicit declarations", () => {
  const capability = (provider) => provider === "mutant" ? "mutation" : "test";
  assert.deepEqual(adapterResources("custom", {
    resources: ["database", "database", "browser"]
  }, capability), ["browser", "database"]);
  assert.deepEqual(adapterResources("contract", {
    adapter: "contract-digest", repository: "api"
  }, capability), ["workspace-read"]);
  assert.deepEqual(adapterResources("browser", {
    adapter: "playwright", repository: "app"
  }, capability), ["browser:app", "dev-server:app", "workspace-read"]);
  assert.deepEqual(adapterResources("mutant", {
    adapter: "command", repository: "api"
  }, capability), ["workspace-write:api"]);
  assert.deepEqual(adapterResources("test", { adapter: "command" }, capability),
    ["workspace-read"]);
});

test("resource conflicts serialize workspace writers and shared exclusive resources", () => {
  assert.equal(resourcesConflict(["workspace-write:api"], ["workspace-read"]), true);
  assert.equal(resourcesConflict(["workspace-read"], ["workspace-write:app"]), true);
  assert.equal(resourcesConflict(["database"], ["database"]), true);
  assert.equal(resourcesConflict(["workspace-read"], ["workspace-read"]), false);
  assert.equal(resourcesConflict(["browser:app"], ["browser:api"]), false);
  assert.equal(resourcesConflict([], []), false);
});

test("Playwright result helpers classify annotations and terminal outcomes", () => {
  assert.deepEqual(playwrightAnnotationClaims(null), []);
  assert.deepEqual(playwrightAnnotationClaims([
    { type: "claim", description: "claim:a" },
    { type: "note", description: "ignored" },
    { type: "claim" }, null
  ]), ["claim:a"]);
  assert.deepEqual(playwrightAnnotationCriticalCases([
    { type: "critical-case", description: "CC-A" },
    { type: "claim", description: "ignored" }
  ]), ["CC-A"]);
  assert.deepEqual(playwrightTestOutcome([{ status: "passed" }]),
    { failed: false, skipped: false });
  assert.deepEqual(playwrightTestOutcome([{ status: "skipped" }, { status: "skipped" }]),
    { failed: false, skipped: true });
  for (const status of ["failed", "timedOut", "interrupted"])
    assert.deepEqual(playwrightTestOutcome([{ status }, { status: "skipped" }]),
      { failed: true, skipped: false });
  assert.deepEqual(playwrightTestOutcome([{}, null]), { failed: false, skipped: false });
});

test("playwrightReportSummary carries claims and critical cases only to executed tests", () => {
  const report = {
    annotations: [
      { type: "claim", description: "suite" },
      { type: "critical-case", description: "CC-SUITE" }
    ],
    suites: [{
      annotations: [{ type: "claim", description: "nested" }],
      specs: [
        {
          annotations: [
            { type: "claim", description: "passed" },
            { type: "critical-case", description: "CC-PASS" }
          ],
          attachments: [{ path: "trace.zip" }, {}, null],
          results: [{ status: "passed" }]
        },
        {
          annotations: [
            { type: "claim", description: "skipped-only" },
            { type: "critical-case", description: "CC-SKIP" }
          ],
          attachments: [{ path: "skip.png" }],
          results: [{ status: "skipped" }]
        },
        {
          annotations: [
            { type: "claim", description: "suite" },
            { type: "critical-case", description: "CC-FAIL" }
          ],
          results: [{ status: "failed" }, { status: "skipped" }]
        }
      ]
    }]
  };
  report.self = report;
  assert.deepEqual(playwrightReportSummary(report), {
    claims: ["nested", "passed", "suite"],
    attachments: ["skip.png", "trace.zip"],
    skippedClaims: ["skipped-only"],
    criticalCases: [
      { id: "CC-FAIL", status: "fail" },
      { id: "CC-PASS", status: "pass" },
      { id: "CC-SKIP", status: "skipped" },
      { id: "CC-SUITE", status: "fail" }
    ],
    tests: 3, failed: 1, skipped: 1
  });
  assert.deepEqual(playwrightReportSummary(null), {
    claims: [], attachments: [], skippedClaims: [], criticalCases: [],
    tests: 0, failed: 0, skipped: 0
  });
});

test("visitPlaywrightReport ignores repeated object identities", () => {
  const testCase = {
    annotations: [{ type: "claim", description: "once" }],
    results: [{ status: "passed" }]
  };
  const state = {
    claims: new Set(), attachments: new Set(), skippedClaims: new Set(),
    criticalCases: new Map(), tests: 0, failed: 0, skipped: 0
  };
  visitPlaywrightReport({ children: [testCase, testCase] }, {
    claims: [], criticalCases: []
  }, state);
  assert.equal(state.tests, 1);
  assert.deepEqual([...state.claims], ["once"]);
  collectPlaywrightAttachments(null, state.attachments);
  recordPlaywrightTest(null, { claims: [], criticalCases: [] }, state);
  assert.equal(state.tests, 1);
});
