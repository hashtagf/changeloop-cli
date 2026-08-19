export function parseJsonOutput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
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
  return {
    totalTests,
    passed: passFooter ? Number(passFooter[1]) : null,
    failed: failFooter ? Number(failFooter[1]) : null,
    format: "tap"
  };
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

export function playwrightReportSummary(report) {
  const claims = new Set();
  const attachments = new Set();
  let tests = 0;
  let failed = 0;
  let skipped = 0;
  const skippedClaims = new Set();
  // Annotations are carried down from suites to the tests they contain, and a
  // claim is credited only where a test actually ran. Playwright emits the
  // annotations of a `test.skip`/`test.fixme`/filtered-out test and still
  // exits 0, so harvesting them regardless recorded claims as proven by tests
  // that never executed.
  function visit(value, inherited) {
    if (!value || typeof value !== "object") return;
    let carried = inherited;
    if (Array.isArray(value.annotations)) {
      const own = value.annotations
        .filter((annotation) => annotation?.type === "claim" && annotation.description)
        .map((annotation) => String(annotation.description));
      if (own.length) carried = [...carried, ...own];
    }
    if (Array.isArray(value.attachments))
      for (const attachment of value.attachments)
        if (attachment?.path) attachments.add(String(attachment.path));
    if (Array.isArray(value.results)) {
      tests += 1;
      const statuses = value.results.map((result) => result?.status).filter(Boolean);
      const didFail = statuses.some((status) =>
        ["failed", "timedOut", "interrupted"].includes(status));
      const didSkip = !didFail && statuses.length &&
        statuses.every((status) => status === "skipped");
      if (didFail) failed += 1;
      else if (didSkip) skipped += 1;
      for (const claim of carried) (didSkip ? skippedClaims : claims).add(claim);
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach((item) => visit(item, carried));
      else if (child && typeof child === "object") visit(child, carried);
    }
  }
  visit(report, []);
  return {
    claims: [...claims].sort(), attachments: [...attachments].sort(),
    skippedClaims: [...skippedClaims].filter((claim) => !claims.has(claim)).sort(),
    tests, failed, skipped
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
