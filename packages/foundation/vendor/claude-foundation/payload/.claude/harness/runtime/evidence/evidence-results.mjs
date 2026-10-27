export const EVIDENCE_RESULT_VERSION = 1;
export const EVIDENCE_STATUSES = Object.freeze([
  "pass", "inconclusive", "fail", "error"
]);

const STATUS_SEVERITY = Object.freeze({
  pass: 0, inconclusive: 1, fail: 2, error: 3
});

export function aggregateEvidenceStatus(values) {
  return values.reduce((worst, value) => {
    if (!(value in STATUS_SEVERITY))
      throw new Error(`invalid evidence status '${value}'`);
    return STATUS_SEVERITY[value] > STATUS_SEVERITY[worst] ? value : worst;
  }, "pass");
}

export function evidenceResultValue({ provider, status, observations = [] }) {
  if (typeof provider !== "string" || !provider.trim())
    throw new Error("evidence result requires provider");
  if (!EVIDENCE_STATUSES.includes(status))
    throw new Error(`invalid evidence status '${status}'`);
  if (!Array.isArray(observations))
    throw new Error("evidence result observations must be an array");
  return {
    version: EVIDENCE_RESULT_VERSION,
    provider,
    status,
    observations: observations.map((observation) => ({ ...observation }))
  };
}

export function parseJsonOutput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

// A command that logs before its result: the whole output, else the last line
// that is a JSON object. Earlier lines are logs, never a second result.
export function parseLastJsonLine(value) {
  const whole = parseJsonOutput(value);
  if (whole !== null) return whole;
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith("{")) continue;
    const parsed = parseJsonOutput(lines[index]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  return null;
}

export function parseTapOutput(value) {
  const text = String(value || "");
  if (!/^(TAP version|\s*(?:ok|not ok)\b)/m.test(text)) return null;
  const testsFooter = [...text.matchAll(/^# tests\s+(\d+)\s*$/gm)].at(-1);
  const passFooter = [...text.matchAll(/^# pass\s+(\d+)\s*$/gm)].at(-1);
  const failFooter = [...text.matchAll(/^# fail\s+(\d+)\s*$/gm)].at(-1);
  const plan = [...text.matchAll(/^\s*1\.\.(\d+)\s*$/gm)].at(-1);
  const totalTests = Number(testsFooter?.[1] ?? plan?.[1]);
  if (!Number.isInteger(totalTests) || totalTests < 0) return null;
  const criticalCases = [...text.matchAll(/^\s*(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/gm)]
    .map((match) => {
      const directive = match[2].match(/\s+#\s*(SKIP|TODO)\b/i);
      const id = directive ? match[2].slice(0, directive.index).trim() : match[2].trim();
      return {
        id,
        status: directive ? directive[1].toLowerCase()
          : match[1] === "ok" ? "pass" : "fail"
      };
    })
    .filter((row) => row.id);
  return {
    totalTests,
    passed: passFooter ? Number(passFooter[1]) : null,
    failed: failFooter ? Number(failFooter[1]) : null,
    format: "tap",
    criticalCases
  };
}

// `go test -json` prints one event object per line. Each test's (and
// subtest's) last terminal action counts once, as `go test -v` prints one
// `--- PASS` per subtest. A package that fails with no failing test (a build
// error) still counts as a failure, so a broken build never reads as passing.
const GO_TERMINAL_ACTIONS = new Set(["pass", "fail", "skip"]);
export function parseGoTestJsonOutput(value) {
  const tests = new Map();
  const failedPackages = new Set();
  let events = 0;
  for (const line of String(value || "").split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    let event;
    try { event = JSON.parse(text); } catch { continue; }
    if (!event || typeof event.Action !== "string" || typeof event.Package !== "string") continue;
    events += 1;
    if (!GO_TERMINAL_ACTIONS.has(event.Action)) continue;
    if (typeof event.Test === "string" && event.Test)
      tests.set(`${event.Package}\0${event.Test}`, { id: event.Test, status: event.Action });
    else if (event.Action === "fail") failedPackages.add(event.Package);
  }
  if (!events || (!tests.size && !failedPackages.size)) return null;
  const rows = [...tests.values()];
  const count = (status) => rows.filter((row) => row.status === status).length;
  const failed = Math.max(count("fail"), failedPackages.size ? 1 : 0);
  return {
    totalTests: rows.length,
    passed: count("pass"),
    failed,
    format: "go-test-json",
    criticalCases: rows.map(({ id, status }) => ({ id, status }))
  };
}

export function parseNodeTestSpecOutput(value) {
  const text = String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
  const testsFooter = [...text.matchAll(/^ℹ tests\s+(\d+)\s*$/gm)].at(-1);
  if (!testsFooter) return null;
  const number = (label) => {
    const match = [...text.matchAll(new RegExp(`^ℹ ${label}\\s+(\\d+)\\s*$`, "gm"))].at(-1);
    return match ? Number(match[1]) : null;
  };
  const criticalCases = [...text.matchAll(/^\s*([✔✖])\s+(.+?)\s*$/gm)]
    .map((match) => ({
      id: match[2].replace(/\s+\([\d.]+ms\)\s*$/, "").trim(),
      status: match[1] === "✔" ? "pass" : "fail"
    })).filter((row) => row.id);
  return {
    totalTests: Number(testsFooter[1]),
    passed: number("pass"),
    failed: number("fail"),
    format: "node-spec",
    criticalCases
  };
}

// Vitest (`Tests  2 failed | 39 passed (41)`) and Jest
// (`Tests:       1 failed, 40 passed, 41 total`) print a counted footer,
// usually colored. The last footer wins so a watch rerun reports once.
export function parseRunnerSummaryOutput(value) {
  const text = String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
  const vitest = [...text.matchAll(/^\s*Tests\s{2,}(.+?)\s+\((\d+)\)\s*$/gm)].at(-1);
  const jest = [...text.matchAll(/^\s*Tests:\s+(.+?),?\s+(\d+) total\s*$/gm)].at(-1);
  const unittest = [...text.matchAll(/^Ran (\d+) tests? in [\d.]+s\s*\n+(OK|FAILED)\b(.*)$/gm)].at(-1);
  if (!vitest && !jest && unittest) {
    const totalTests = Number(unittest[1]);
    if (!Number.isSafeInteger(totalTests)) return null;
    const failed = unittest[2] === "OK" ? 0 :
      (unittest[3].match(/(?:failures|errors)=(\d+)/g) || [])
        .reduce((sum, part) => sum + Number(part.split("=")[1]), 0) || 1;
    return { totalTests, passed: Math.max(0, totalTests - failed), failed,
      format: "unittest-summary", criticalCases: [] };
  }
  const match = vitest || jest;
  if (!match) return null;
  const count = (label) => {
    const found = match[1].match(new RegExp(`(\\d+) ${label}`));
    return found ? Number(found[1]) : 0;
  };
  const totalTests = Number(match[2]);
  if (!Number.isSafeInteger(totalTests)) return null;
  return { totalTests, passed: count("passed"), failed: count("failed"),
    format: vitest ? "vitest-summary" : "jest-summary", criticalCases: [] };
}

// The dependency-free shell suites emit counted summaries, including when a
// host captures only their final lines. Bare PASS text is never a test count.
export function parseAssertionSummaryOutput(value) {
  const rows = String(value || "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /: (?:ALL PASS|\d+\/\d+ assertion\(s\) FAILED)/.test(line));
  if (!rows.length) return null;
  const seen = new Set();
  let totalTests = 0;
  let failed = 0;
  for (const row of rows) {
    const pass = row.match(/^(.+): ALL PASS \((\d+)\/(\d+) assertions\)$/);
    const fail = row.match(/^(.+): (\d+)\/(\d+) assertion\(s\) FAILED$/);
    const match = pass || fail;
    if (!match || seen.has(match[1])) return null;
    seen.add(match[1]);
    const count = Number(match[3]);
    const observed = Number(match[2]);
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(observed) ||
        observed > count || (pass && observed !== count)) return null;
    totalTests += count;
    failed += fail ? observed : 0;
    if (!Number.isSafeInteger(totalTests)) return null;
  }
  return { totalTests, failed, passed: totalTests - failed,
    format: "assertion-summary", criticalCases: [] };
}

// Rapid-lane fallback when no count parses: a line that only an executed,
// passing test prints. It proves "at least one test ran", never a count, and a
// runner line saying nothing ran vetoes every positive marker. A bare `✔` is
// also printed by linters and builders, so it counts only beside node's own
// runner summary reporting at least one test.
const NODE_RUNNER_SUMMARY = /^(?:ℹ|#) (?:tests|pass)\s+[1-9]\d*\s*$/m;
const EXECUTED_TEST_MARKERS = Object.freeze([
  ["node-spec-pass", /^\s*✔\s+\S/m, NODE_RUNNER_SUMMARY],
  ["tap-ok", /^\s*ok\s+[1-9]\d*\b/m],
  ["jest-file-pass", /^\s*PASS\s+\S+/m],
  ["go-test-pass", /^\s*--- PASS: \S+/m],
  ["go-package-ok", /^ok\s+\S+\s+[\d.]+s\s*$/m],
  ["unittest-case-ok", /^test\S*\s.*\.\.\.\s+ok\s*$/m],
  ["passed-count", /(?:^|[\s,|(])[1-9]\d*\s+(?:tests?\s+)?(?:passed|passing)\b/im],
  ["unittest-ran", /^Ran\s+[1-9]\d*\s+tests?\b/m],
  ["rspec-examples", /^\s*[1-9]\d*\s+examples?,\s+0\s+failures\b/m]
]);
const NO_TESTS_RAN = /\bno tests? (?:found|ran|were run|executed|to run)\b|\bno test files found\b|^Ran\s+0\s+tests?\b|(?:^|\s)0\s+(?:tests?\s+)?(?:passed|passing)\b|^\s*0\s+examples?\b/im;

export function parseExecutedTestEvidence(value) {
  const text = String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
  if (!text.trim() || NO_TESTS_RAN.test(text)) return null;
  for (const [marker, pattern, requires] of EXECUTED_TEST_MARKERS) {
    const match = text.match(pattern);
    if (match && (!requires || requires.test(text))) return { marker, line: match[0].trim().slice(0, 160) };
  }
  return null;
}

export function mutationProtocolResult(value) {
  const text = String(value || "");
  const line = text.match(
    /(?:^|\n)FOUNDATION_MUTATION_RESULT=(behavioral-kill|test-failure|survived|crash|timeout|not-applied)(?:\n|$)/
  );
  if (line) return line[1];
  const parsed = parseJsonOutput(text);
  const result = parsed?.foundationMutationResult || parsed?.mutationResult;
  return [
    "behavioral-kill", "test-failure", "survived", "crash", "timeout", "not-applied"
  ].includes(result) ? result : null;
}

export function numericReportValue(report, keys) {
  if (!report || typeof report !== "object") return null;
  for (const container of [report, report.summary, report.stats].filter((value) =>
    value && typeof value === "object" && !Array.isArray(value)))
    for (const key of keys) {
      const value = container[key];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    }
  return null;
}

export function playwrightAnnotationValues(annotations, type) {
  if (!Array.isArray(annotations)) return [];
  return annotations
    .filter((annotation) => annotation?.type === type && annotation.description)
    .map((annotation) => String(annotation.description));
}

export function playwrightAnnotationClaims(annotations) {
  return playwrightAnnotationValues(annotations, "claim");
}

export function playwrightAnnotationCriticalCases(annotations) {
  return playwrightAnnotationValues(annotations, "critical-case");
}

export function playwrightTestOutcome(results) {
  const statuses = Array.isArray(results) ? results.map((result) => result?.status) : [];
  const failed = statuses.some((status) =>
    ["failed", "timedOut", "interrupted"].includes(status));
  const skipped = !failed && statuses.length > 0 &&
    statuses.every((status) => status === "skipped");
  const inconclusive = !statuses.length || statuses.some((status) =>
    !["passed", "failed", "timedOut", "interrupted", "skipped"].includes(status));
  // Any failed attempt remains a failure, even when a later retry passed.
  return { failed, skipped, inconclusive };
}

export function collectPlaywrightAttachments(attachments, destination) {
  if (!Array.isArray(attachments)) return;
  for (const attachment of attachments)
    if (attachment?.path) destination.add(String(attachment.path));
}

export function recordPlaywrightTest(results, carried, state) {
  if (!Array.isArray(results)) return;
  state.tests += 1;
  const outcome = playwrightTestOutcome(results);
  if (outcome.failed) state.failed += 1;
  else if (outcome.skipped) state.skipped += 1;
  else if (outcome.inconclusive) state.inconclusive = (state.inconclusive || 0) + 1;
  if (outcome.skipped)
    for (const claim of carried.claims) state.skippedClaims.add(claim);
  else if (!outcome.failed && !outcome.inconclusive)
    for (const claim of carried.claims) state.claims.add(claim);
  const caseStatus = outcome.failed ? "fail" : outcome.inconclusive ? "inconclusive"
    : outcome.skipped ? "skipped" : "pass";
  const severity = new Map([["pass", 0], ["skipped", 1], ["inconclusive", 2], ["fail", 3]]);
  for (const id of carried.criticalCases) {
    const current = state.criticalCases.get(id);
    if (!current || severity.get(caseStatus) > severity.get(current))
      state.criticalCases.set(id, caseStatus);
  }
}

export function visitPlaywrightChildren(value, carried, state, seen) {
  for (const child of Object.values(value)) {
    if (Array.isArray(child))
      child.forEach((item) => visitPlaywrightReport(item, carried, state, seen));
    else if (child && typeof child === "object")
      visitPlaywrightReport(child, carried, state, seen);
  }
}

export function visitPlaywrightReport(value, inherited, state, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const ownClaims = playwrightAnnotationClaims(value.annotations);
  const ownCriticalCases = playwrightAnnotationCriticalCases(value.annotations);
  const carried = ownClaims.length || ownCriticalCases.length ? {
    claims: [...inherited.claims, ...ownClaims],
    criticalCases: [...inherited.criticalCases, ...ownCriticalCases]
  } : inherited;
  collectPlaywrightAttachments(value.attachments, state.attachments);
  if (Object.hasOwn(value, "results"))
    recordPlaywrightTest(Array.isArray(value.results) ? value.results : [], carried, state);
  visitPlaywrightChildren(value, carried, state, seen);
}

export function playwrightReportSummary(report) {
  const state = {
    claims: new Set(), attachments: new Set(), skippedClaims: new Set(),
    criticalCases: new Map(), tests: 0, failed: 0, skipped: 0, inconclusive: 0
  };
  // Annotations are carried down from suites to the tests they contain, and a
  // claim is credited only where a test actually ran. Playwright emits the
  // annotations of a `test.skip`/`test.fixme`/filtered-out test and still
  // exits 0, so harvesting them regardless recorded claims as proven by tests
  // that never executed.
  visitPlaywrightReport(report, { claims: [], criticalCases: [] }, state);
  return {
    claims: [...state.claims].sort(), attachments: [...state.attachments].sort(),
    skippedClaims: [...state.skippedClaims]
      .filter((claim) => !state.claims.has(claim)).sort(),
    criticalCases: [...state.criticalCases]
      .map(([id, status]) => ({ id, status }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    tests: state.tests, failed: state.failed, skipped: state.skipped,
    inconclusive: state.inconclusive
  };
}

export function configuredCommand(provider, config) {
  const [command, ...originalArgs] = config.command;
  const args = [...originalArgs];
  const directPlaywright = config.adapter === "playwright" &&
    ([command, ...args].some((part) =>
      part === "playwright" || part.endsWith("/playwright") || part === "@playwright/test"));
  if (directPlaywright) {
    if (config.project && !args.some((arg) => arg === "--project" || arg.startsWith("--project=")))
      args.push(`--project=${config.project}`);
    if (!args.some((arg) => arg === "--reporter" || arg.startsWith("--reporter=")))
      args.push("--reporter=json");
  }
  return { command, args, display: [command, ...args].join(" ") };
}

// Repo-qualified, the way the build planner already qualifies task resources.
// Unqualified defaults cut both ways: a Playwright provider in `api` and one
// in `app` both claimed the literal "dev-server" and serialized needlessly,
// while two providers in different repositories that genuinely share one
// database never conflicted at all. An explicit `resources` list stays verbatim
// — that is how an author declares real sharing across repositories.
export function adapterResources(provider, config, providerCapability) {
  if (Array.isArray(config.resources)) return [...new Set(config.resources)].sort();
  const scope = config.repository ? `:${config.repository}` : "";
  // Reads every declared side and writes nothing, so it never conflicts.
  if (config.adapter === "contract-digest") return ["workspace-read"];
  if (config.adapter === "playwright")
    return [`browser${scope}`, `dev-server${scope}`, "workspace-read"];
  if (providerCapability(provider, config) === "mutation")
    return [`workspace-write${scope}`];
  return ["workspace-read"];
}

export function resourcesConflict(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  // `workspace-write:api` still excludes every workspace user, so match on the
  // prefix rather than the exact token.
  const writes = (set) => [...set].some((item) => item.startsWith("workspace-write"));
  const touchesWorkspace = (set) => [...set].some((item) => item.startsWith("workspace-"));
  if (writes(a) && touchesWorkspace(b)) return true;
  if (writes(b) && touchesWorkspace(a)) return true;
  return [...a].some((item) => item !== "workspace-read" && b.has(item));
}
