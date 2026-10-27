// Scratch router: classifies a compiled change by intent, technical domain,
// and risk level from the signals the agreement already declares, then names
// the approval artifacts each reviewer role needs. Pure data so the package
// renderer, preview suggestions, and approval lanes read one table.
import { WORK_TYPES } from "./work-types.mjs";

export const RISK_LEVELS = Object.freeze(["Low", "Medium", "High", "Critical"]);
export const APPROVAL_ROLES = Object.freeze(["product-owner", "tech-lead", "qa", "devops", "security"]);

const RISK_SIGNALS = new Set([
  "access-control", "persisted-data-change", "external-integration", "performance-slo",
  "user-interface", "high-operational-risk", "external-side-effect", "financial", "input-domain"
]);
// Signals whose discovery weight is 3: any of them alone makes a change High.
const HEAVY_SIGNALS = new Set([
  "access-control", "persisted-data-change", "high-operational-risk", "external-side-effect", "financial"
]);
const INTENTS = Object.freeze({
  feature: "feature", bugfix: "bugfix", refactor: "refactor", migration: "migration",
  experiment: "experiment", deprecation: "decommission"
});

// source: design (a typed design field), provider (a provider capability),
// derived (the harness derives it). A runnable artifact needs a preview run
// and is offered from High upward; its capability names the provider to use.
export const ARTIFACTS = Object.freeze({
  impact: { label: "Change impact (As-Is + file map)", source: "derived", ref: "fileMap" },
  testmap: { label: "Test matrix", source: "derived", ref: "testMap" },
  flow: { label: "User journey and acceptance criteria", source: "design", ref: "userFlow" },
  ui: { label: "UI state matrix", source: "design", ref: "uiStates" },
  shot: { label: "Interactive prototype or screenshot", source: "provider", ref: "browser", runnable: true, capability: "browser" },
  nav: { label: "Device navigation flow", source: "design", ref: "userFlow" },
  a11y: { label: "Accessibility preview", source: "provider", ref: "accessibility", runnable: true, capability: "accessibility" },
  api: { label: "API contract and sequence diagram", source: "design", ref: "apiContracts" },
  playground: { label: "API playground (mock)", source: "provider", ref: "integration", runnable: true, capability: "integration" },
  state: { label: "State machine", source: "design", ref: "jobContract" },
  integ: { label: "Integration flow and failure matrix", source: "design", ref: "integrations" },
  retry: { label: "Retry, timeout, and dead-letter simulation", source: "provider", ref: "resilience", runnable: true, capability: "resilience" },
  perm: { label: "Permission matrix", source: "design", ref: "permission-rejection" },
  concur: { label: "Concurrency and double-submit test", source: "provider", ref: "concurrency", runnable: true, capability: "concurrency" },
  ledger: { label: "Ledger and idempotency design", source: "design", ref: "timeout-retry-idempotency" },
  timeline: { label: "Job timeline", source: "design", ref: "jobContract" },
  compat: { label: "Contract diff and compatibility", source: "provider", ref: "compatibility" },
  erd: { label: "ERD and schema diff", source: "design", ref: "dataModel" },
  dryrun: { label: "Migration dry run and rollback", source: "provider", ref: "data-migration", runnable: true, capability: "data-migration" },
  lineage: { label: "Data lineage", source: "design", ref: "diagrams" },
  sample: { label: "Sample results or dashboard mock", source: "provider", ref: "browser", runnable: true, capability: "browser" },
  c4: { label: "Architecture diagram and trade-offs", source: "design", ref: "diagrams" },
  plan: { label: "Topology diff or plan", source: "provider", ref: "plan-check", runnable: true, capability: "plan-check" },
  pipe: { label: "Deployment preview", source: "provider", ref: "deployment", runnable: true, capability: "deployment" },
  alert: { label: "Alert and dashboard preview", source: "provider", ref: "observability" },
  bench: { label: "Benchmark before and after", source: "provider", ref: "performance" },
  threat: { label: "Threat model", source: "design", ref: "security-privacy" },
  repro: { label: "Reproduction and root cause", source: "design", ref: "bugfix" },
  equiv: { label: "Behavior equivalence (characterization)", source: "design", ref: "refactor" },
  evaluation: { label: "Agent trace and evaluation", source: "provider", ref: "evaluation" },
  config: { label: "Config diff and rollout/rollback", source: "design", ref: "configContract" },
  guard: { label: "Experiment guardrail", source: "provider", ref: "experiment-guardrail" }
});

const has = (s, ...keys) => keys.some((key) => s.has(key));
// [id, key, name, group, detect(signals), artifacts, roles]
const DOMAIN_ROWS = [
  [1, "requirement", "Requirement / Product", "product", (s) => has(s, "feature", "experiment"), ["flow"], ["product-owner"]],
  [2, "ux-ui", "UX/UI Design", "product", (s) => has(s, "ui"), ["flow", "ui"], ["product-owner"]],
  [3, "web-frontend", "Web Frontend", "product", (s) => has(s, "ui") && !has(s, "client-release"), ["ui", "shot"], ["product-owner", "qa"]],
  [4, "mobile", "Mobile App", "product", (s) => has(s, "client-release"), ["nav", "shot"], ["product-owner", "qa"]],
  [5, "a11y-l10n", "Accessibility / Localization", "product", (s) => has(s, "user-interface"), ["a11y"], ["qa"]],
  [6, "backend-api", "Backend / API", "application", (s) => has(s, "api"), ["api", "playground"], ["tech-lead"]],
  [7, "business-workflow", "Business Workflow", "application", (s) => has(s, "async") && has(s, "feature"), ["state"], ["product-owner", "tech-lead"]],
  [8, "integration", "Third-party Integration", "application", (s) => has(s, "integration", "external-integration", "integrations"), ["integ", "retry"], ["tech-lead"]],
  [9, "event-queue", "Event-Driven / Queue", "application", (s) => has(s, "async"), ["state", "retry"], ["tech-lead"]],
  [10, "authz", "Authentication / Authorization", "application", (s) => has(s, "access-control"), ["perm"], ["security"]],
  [11, "payment", "Payment / Financial", "application", (s) => has(s, "financial"), ["ledger", "concur"], ["tech-lead", "security"]],
  [12, "background-job", "Background Job / Scheduler", "application", (s) => has(s, "async") && !has(s, "feature"), ["timeline", "retry"], ["tech-lead"]],
  [13, "library", "SDK / Shared Library", "application", (s) => has(s, "library", "dependency"), ["compat"], ["tech-lead"]],
  [14, "database", "Database / Schema", "data", (s) => has(s, "data", "persisted-data-change"), ["erd"], ["tech-lead"]],
  // Data that lives only in the browser has no server migration to rehearse.
  [15, "data-migration", "Data Migration", "data", (s) => has(s, "migration", "data-fix") ||
    (has(s, "persisted-data-change") && has(s, "data") && !has(s, "browser-storage")), ["dryrun"], ["tech-lead", "devops"]],
  [16, "pipeline", "Data Pipeline / ETL", "data", (s) => has(s, "data") && has(s, "async") && !has(s, "feature"), ["lineage"], ["tech-lead"]],
  // A product feature that stores its own records is CRUD, not reporting.
  [17, "reporting", "BI / Reporting / Search", "data", (s) => has(s, "example:report", "example:search") ||
    (has(s, "data") && has(s, "ui") && !has(s, "api", "feature", "persisted-data-change")), ["sample"], ["product-owner"]],
  [18, "architecture", "System Architecture", "platform", (s) => has(s, "coupled", "cross-repository"), ["c4"], ["tech-lead"]],
  [19, "infrastructure", "DevOps / Infrastructure", "platform", (s) => has(s, "infra"), ["plan"], ["devops"]],
  [20, "delivery", "CI/CD / Deployment", "platform", (s) => has(s, "infra", "cicd", "high-operational-risk"), ["pipe"], ["devops"]],
  [21, "observability", "Observability / SRE", "platform", (s) => has(s, "observability"), ["alert"], ["devops"]],
  [22, "performance", "Performance / Scalability", "platform", (s) => has(s, "performance", "performance-slo"), ["bench"], ["tech-lead", "devops"]],
  [23, "security", "Security / Privacy / Compliance", "platform", (s) => has(s, "privacy", "security", "security-triggers", "external-side-effect", "access-control"), ["threat"], ["security"]],
  [24, "bugfix", "Bug Fix / Incident", "maintenance", (s) => has(s, "bugfix"), ["repro"], ["qa", "tech-lead"]],
  [25, "refactor", "Refactoring / Technical Debt", "maintenance", (s) => has(s, "refactor"), ["equiv"], ["tech-lead", "qa"]],
  [26, "qa", "QA / Test Automation", "maintenance", (s) => has(s, "test"), ["testmap"], ["qa"]],
  [27, "ai", "AI / LLM / Agent", "delivery", (s) => has(s, "ml"), ["evaluation"], ["tech-lead", "qa"]],
  [28, "release", "Release / Configuration / Feature Flags", "delivery", (s) => has(s, "config", "client-release", "experiment"), ["config", "guard"], ["devops", "product-owner"]]
];
export const DOMAINS = Object.freeze(DOMAIN_ROWS.map(([id, key, name, group, , artifacts, roles]) =>
  Object.freeze({ id, key, name, group, artifacts: Object.freeze(artifacts), roles: Object.freeze(roles) })));

// Paths a change touches can reveal a risk its draft did not declare. They only
// raise routing (level, domains, artifacts, approval lanes); discovery and
// review still follow the declared signals.
const PATH_SIGNALS = Object.freeze([
  ["persisted-data-change", /(^|\/)(migrations?|migrate|prisma)\/|(^|\/)schema\.[a-z]+$|\.sql$/i],
  ["access-control", /(^|\/)(auth|authz|permissions?|rbac|acl)(\/|[._-])/i],
  ["financial", /(payments?|billing|refunds?|checkout|wallets?|ledger|invoices?)/i],
  ["user-interface", /\.(tsx|jsx|vue|svelte|css|scss)$|(^|\/)(components|pages|views)\//i],
  ["high-operational-risk", /\.tf$|(^|\/)(terraform|k8s|kubernetes|helm)\/|(^|\/)Dockerfile$|(^|\/)\.github\/workflows\//i],
  ["external-integration", /webhooks?/i]
]);

export function inferPathSignals(paths = []) {
  const found = [];
  for (const path of [...new Set((Array.isArray(paths) ? paths : []).map(String))])
    for (const [signal, pattern] of PATH_SIGNALS)
      if (pattern.test(path) && !found.some((row) => row.signal === signal)) found.push({ signal, path });
  return found;
}

const strings = (value) => Array.isArray(value)
  ? [...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))]
  : [];

// `light` names declared signals that count as ordinary weight for this change,
// such as stored data that never leaves the browser.
export function riskLevel({ riskSignals = [], impact = "", light = [] } = {}) {
  const signals = strings(riskSignals);
  const level = String(impact).trim().toLowerCase();
  const reasons = [`impact:${level || "unspecified"}`, ...signals.map((signal) => `risk:${signal}`)];
  if (level === "high" && signals.some((signal) => signal === "financial" || signal === "access-control"))
    return { level: "Critical", reasons };
  if (level === "high" || signals.some((signal) => HEAVY_SIGNALS.has(signal) && !light.includes(signal)))
    return { level: "High", reasons };
  if (level === "medium" || signals.length) return { level: "Medium", reasons };
  return { level: "Low", reasons };
}

/**
 * Route a change. Unknown work types and risk signals are ignored with a
 * warning so an old or hand-edited agreement still produces a package.
 */
export function routeChange(source = {}) {
  const workTypes = strings(source.workTypes ?? source.workType);
  const riskSignals = strings(source.riskSignals);
  const warnings = [
    ...workTypes.filter((type) => !WORK_TYPES.includes(type)).map((type) => `unknown workType '${type}' ignored`),
    ...riskSignals.filter((signal) => !RISK_SIGNALS.has(signal)).map((signal) => `unknown riskSignal '${signal}' ignored`)
  ];
  const signals = new Set([
    ...workTypes.filter((type) => WORK_TYPES.includes(type)),
    ...riskSignals.filter((signal) => RISK_SIGNALS.has(signal))
  ]);
  const coupling = String(source.coupling || "").trim().toLowerCase();
  if (coupling === "coupled" || coupling === "cross-repository") signals.add(coupling);
  if (Array.isArray(source.integrations) && source.integrations.length) signals.add("integrations");
  if (Array.isArray(source.securityTriggers) && source.securityTriggers.length) signals.add("security-triggers");
  const inferred = inferPathSignals(source.paths).filter((row) => !signals.has(row.signal));
  for (const row of inferred) signals.add(row.signal);
  // Example block types and the data store refine domains; they are not signals.
  for (const type of strings(source.exampleTypes)) signals.add(`example:${type}`);
  // A touched migration path outranks a browser-only claim.
  const browserStorage = source.browserStorage === true &&
    !inferPathSignals(source.paths).some((row) => row.signal === "persisted-data-change");
  if (browserStorage) signals.add("browser-storage");

  const { level, reasons: signalReasons } = riskLevel({
    riskSignals: [...signals].filter((s) => RISK_SIGNALS.has(s)), impact: source.impact,
    light: browserStorage ? ["persisted-data-change"] : [] });
  const reasons = [...signalReasons.filter((reason) =>
    !inferred.some((row) => reason === `risk:${row.signal}`)),
  ...inferred.map((row) => `path:${row.path}→${row.signal}`)];
  const domains = DOMAIN_ROWS.filter((row) => row[4](signals)).map(([id]) => DOMAINS[id - 1]);
  const artifacts = new Map();
  const add = (id, domain, roles) => {
    const row = artifacts.get(id) || { id, ...ARTIFACTS[id], runnable: !!ARTIFACTS[id].runnable, domains: [], roles: [] };
    if (domain !== null && !row.domains.includes(domain)) row.domains.push(domain);
    for (const role of roles) if (!row.roles.includes(role)) row.roles.push(role);
    artifacts.set(id, row);
  };
  // Every change shows its impact and test map; low risk shows nothing else.
  add("impact", null, ["tech-lead"]);
  add("testmap", null, ["qa"]);
  const runnableAllowed = level === "High" || level === "Critical";
  if (level !== "Low") for (const domain of domains)
    for (const id of domain.artifacts)
      if (!ARTIFACTS[id].runnable || runnableAllowed) add(id, domain.id, domain.roles);

  const rows = [...artifacts.values()];
  const roles = APPROVAL_ROLES.filter((role) => rows.some((row) => row.roles.includes(role)));
  const intents = workTypes.filter((type) => INTENTS[type]).map((type) => INTENTS[type]);
  return {
    intents: intents.length ? intents : ["feature"],
    level,
    reasons,
    domains: domains.map(({ id, key, name, group }) => ({ id, key, name, group })),
    artifacts: rows,
    roles,
    warnings
  };
}
