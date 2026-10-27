// Typed design fields for work types (the work type catalog in
// change-doc-outline.md): bugfix with its security and hotfix variants,
// refactor, library contract, migration plan, integrations, performance
// analysis, dependency change, deprecation plan, infra plan, privacy
// assessment, experiment design, client release plan, and model card. Each field exposes validate (path-prefixed issues) and render
// (markdown body without the section heading, "" when empty). Older shapes
// (bugfix { reproduction, rootCause, regression }, refactor { invariants,
// characterization }, integrations [{ key, kind, documentation, concerns }])
// stay valid; only the new optional subfields are checked. Shapes follow the
// SECTION_HELP entries in dev-document.mjs, so a help example always passes.

import { absenceKind, bareAbsenceIssue } from "./explicit-absence.mjs";

const LABELS = Object.freeze({
  en: {
    part: "Part", detail: "Detail",
    reproduction: "Reproduction", expected: "Expected", observed: "Observed", environment: "Environment",
    rootCause: "Root cause", introducedBy: "Introduced by", blastRadius: "Blast radius",
    dataRepair: "Data repair", regression: "Regression proof",
    disclosure: "Disclosure", vulnerabilityClass: "Vulnerability class", affectedVersions: "Affected versions",
    exploitability: "Exploitability", owner: "Owner", embargo: "Embargo", advisory: "Advisory",
    backport: "Backport targets",
    hotfix: "Hotfix", incident: "Incident", mitigation: "Mitigation already applied",
    minimumScope: "Minimum fix scope", followUp: "Follow-up change",
    invariants: "Invariants", characterization: "Characterization", equivalenceEvidence: "Equivalence evidence",
    steps: "Mechanical steps", performanceNeutral: "Performance neutrality",
    package: "Package", semver: "Semver", runtimes: "Supported runtimes", symbols: "Public symbols",
    symbol: "Symbol", signature: "Signature", errors: "Errors", change: "Change",
    stdout: "stdout", stderr: "stderr", exitCodes: "Exit codes", code: "Code", meaning: "Meaning",
    deprecation: "Deprecation", changelog: "Changelog",
    from: "From", to: "To", seam: "Seam", dualRun: "Dual run", parity: "Parity check",
    tolerance: "tolerance", cutover: "Cutover criteria", rollbackWindow: "Rollback window",
    decommission: "Decommission task",
    integration: "Integration", kind: "Kind", documentation: "Documentation", version: "Version",
    concerns: "Concerns", docs: "Docs", auth: "Auth", secretRef: "Secret reference", limits: "Limits",
    sandbox: "Sandbox", mapping: "Anti-corruption mapping", webhook: "Webhook", outage: "Outage behavior",
    webhookSignature: "Webhook signature", replayWindow: "Webhook replay window", dedup: "Webhook dedup",
    baseline: "Baseline", method: "method", profile: "Profile", hypothesis: "Hypothesis", target: "Target",
    benchmark: "Benchmark", runs: "runs", variance: "variance", tradeoffs: "Trade-offs",
    regressionBudget: "Regression budget", none: "none", yes: "yes", no: "no",
    breakingChanges: "Breaking changes", cve: "CVE", license: "License", transitive: "Transitive impact",
    lockfile: "Lockfile diff", rollbackPin: "Rollback pin", provenance: "Provenance", sbom: "SBOM",
    what: "What is deprecated", replacement: "Replacement", consumers: "Consumers", announce: "Announce",
    warning: "Warning signal", usageMetric: "Usage metric", removeWhen: "Removal condition",
    iac: "IaC", planDiff: "Plan diff", environments: "Environments", capacity: "Capacity",
    costDelta: "Cost delta", secrets: "Secrets", provisioningOrder: "Provisioning order", drift: "Drift detection",
    externalOperations: "External operations",
    personalData: "Personal data", data: "Data", dataClass: "Class", purpose: "Purpose", lawfulBasis: "Lawful basis",
    minimization: "Minimization", retention: "Retention", deletion: "Deletion path",
    subjectRequests: "Subject requests", crossBorder: "Cross-border transfer", telemetryPii: "Telemetry PII check",
    privacyThreats: "Privacy threats (LINDDUN)", linddun: "LINDDUN", threat: "Threat", control: "Control",
    primaryMetric: "Primary metric", guardrails: "Guardrail metrics", unit: "Unit", allocation: "Allocation",
    sampleOrDuration: "Sample size or duration", stopRules: "Stop rules", exposureEvent: "Exposure event",
    decisionRule: "Decision rule", cleanupTask: "Cleanup task",
    minimumVersion: "Minimum supported version", coexistence: "Old and new clients", serverWindow: "Server compatibility window",
    storeReview: "Store review", stages: "Staged rollout", forcedUpgrade: "Forced upgrade", gate: "Crash-rate gate",
    intendedUse: "Intended use", outOfScope: "Out of scope", model: "Model", versionPin: "Version pin",
    dataSource: "Data source", evaluation: "Evaluation", evaluationSet: "Evaluation set", metric: "Metric",
    threshold: "Threshold", limitations: "Limitations", oversight: "Human oversight", costLatency: "Cost and latency",
    monitoring: "Monitoring", fallback: "Fallback",
    scope: "Scope", snapshot: "Snapshot before the fix", dryRun: "Dry run", rerunSafe: "Safe to rerun",
    rollback: "Rollback", weakness: "Weakness", verification: "How it is verified",
    changes: "What changes", permissions: "Permissions and secrets",
  },
  th: {
    part: "ส่วน", detail: "รายละเอียด",
    reproduction: "วิธีทำให้เกิดซ้ำ", expected: "ผลที่ควรเป็น", observed: "ผลที่เกิดจริง", environment: "สภาพแวดล้อม",
    rootCause: "สาเหตุที่แท้จริง", introducedBy: "commit ที่ทำให้เกิด", blastRadius: "ขอบเขตผลกระทบ",
    dataRepair: "การซ่อมข้อมูล", regression: "หลักฐาน regression",
    disclosure: "การเปิดเผยช่องโหว่", vulnerabilityClass: "ประเภทช่องโหว่", affectedVersions: "เวอร์ชันที่ได้รับผลกระทบ",
    exploitability: "ความเป็นไปได้ในการโจมตี", owner: "ผู้รับผิดชอบ", embargo: "ช่วงห้ามเปิดเผย", advisory: "ประกาศช่องโหว่",
    backport: "branch ที่ต้อง backport",
    hotfix: "Hotfix", incident: "เหตุการณ์", mitigation: "การบรรเทาที่ทำไปแล้ว",
    minimumScope: "ขอบเขตการแก้ขั้นต่ำ", followUp: "change ที่ตามมา",
    invariants: "สิ่งที่ต้องคงเดิม", characterization: "การทดสอบพฤติกรรมเดิม", equivalenceEvidence: "หลักฐานว่าพฤติกรรมเท่าเดิม",
    steps: "ขั้นตอนเชิงกลไก", performanceNeutral: "ประสิทธิภาพไม่เปลี่ยน",
    package: "แพ็กเกจ", semver: "Semver", runtimes: "runtime ที่รองรับ", symbols: "symbol สาธารณะ",
    symbol: "Symbol", signature: "Signature", errors: "ข้อผิดพลาด", change: "การเปลี่ยนแปลง",
    stdout: "stdout", stderr: "stderr", exitCodes: "Exit code", code: "รหัส", meaning: "ความหมาย",
    deprecation: "การเลิกใช้", changelog: "Changelog",
    from: "จาก", to: "ไปยัง", seam: "จุดต่อ (seam)", dualRun: "การรันคู่ขนาน", parity: "การตรวจความเท่ากัน",
    tolerance: "ค่าที่ยอมรับได้", cutover: "เงื่อนไขการสลับ", rollbackWindow: "ช่วงเวลาที่ rollback ได้",
    decommission: "task ปลดระบบเก่า",
    integration: "ระบบภายนอก", kind: "ประเภท", documentation: "เอกสาร", version: "เวอร์ชัน",
    concerns: "ข้อกังวล", docs: "เอกสาร", auth: "การยืนยันตัวตน", secretRef: "อ้างอิง secret", limits: "ขีดจำกัด",
    sandbox: "Sandbox", mapping: "การแปลงข้อมูล (anti-corruption)", webhook: "Webhook", outage: "พฤติกรรมเมื่อระบบภายนอกล่ม",
    webhookSignature: "ลายเซ็น webhook", replayWindow: "ช่วงกัน replay ของ webhook", dedup: "การกันซ้ำของ webhook",
    baseline: "ค่าตั้งต้น", method: "วิธีวัด", profile: "ผล profile", hypothesis: "สมมติฐาน", target: "เป้าหมาย",
    benchmark: "Benchmark", runs: "จำนวนรอบ", variance: "ความแปรปรวน", tradeoffs: "สิ่งที่แลก",
    regressionBudget: "งบ regression", none: "ไม่มี", yes: "ใช่", no: "ไม่",
    breakingChanges: "การเปลี่ยนแปลงที่ไม่เข้ากัน", cve: "CVE", license: "สัญญาอนุญาต", transitive: "ผลกระทบต่อ dependency ทางอ้อม",
    lockfile: "diff ของ lockfile", rollbackPin: "เวอร์ชันสำหรับ rollback", provenance: "ที่มาของแพ็กเกจ (provenance)", sbom: "SBOM",
    what: "สิ่งที่เลิกใช้", replacement: "สิ่งที่ใช้แทน", consumers: "ผู้ใช้งาน", announce: "การประกาศ",
    warning: "สัญญาณเตือน", usageMetric: "ตัวชี้วัดการใช้งาน", removeWhen: "เงื่อนไขการถอดออก",
    iac: "IaC", planDiff: "diff ของ plan", environments: "สภาพแวดล้อม", capacity: "ความจุ",
    costDelta: "ค่าใช้จ่ายที่เปลี่ยน", secrets: "Secret", provisioningOrder: "ลำดับการสร้างทรัพยากร", drift: "การตรวจ drift",
    externalOperations: "งานที่ทำนอกระบบ",
    personalData: "ข้อมูลส่วนบุคคล", data: "ข้อมูล", dataClass: "ระดับ", purpose: "วัตถุประสงค์", lawfulBasis: "ฐานทางกฎหมาย",
    minimization: "การเก็บเท่าที่จำเป็น", retention: "ระยะเวลาเก็บ", deletion: "วิธีลบ",
    subjectRequests: "คำขอของเจ้าของข้อมูล", crossBorder: "การส่งข้อมูลข้ามประเทศ", telemetryPii: "การตรวจ PII ใน telemetry",
    privacyThreats: "ภัยด้านความเป็นส่วนตัว (LINDDUN)", linddun: "LINDDUN", threat: "ภัยคุกคาม", control: "มาตรการ",
    primaryMetric: "ตัวชี้วัดหลัก", guardrails: "ตัวชี้วัดป้องกัน", unit: "หน่วยสุ่ม", allocation: "การแบ่งกลุ่ม",
    sampleOrDuration: "ขนาดตัวอย่างหรือระยะเวลา", stopRules: "เงื่อนไขหยุดการทดลอง", exposureEvent: "event การเห็น",
    decisionRule: "เกณฑ์ตัดสินใจ", cleanupTask: "task เก็บกวาด",
    minimumVersion: "เวอร์ชันต่ำสุดที่รองรับ", coexistence: "client เก่าและใหม่ที่ใช้พร้อมกัน", serverWindow: "ช่วงที่ server รองรับ",
    storeReview: "การตรวจของ store", stages: "การปล่อยแบบเป็นขั้น", forcedUpgrade: "การบังคับอัปเกรด", gate: "เกณฑ์อัตรา crash",
    intendedUse: "การใช้งานที่ตั้งใจ", outOfScope: "การใช้งานนอกขอบเขต", model: "โมเดล", versionPin: "เวอร์ชันที่ตรึงไว้",
    dataSource: "แหล่งข้อมูล", evaluation: "การประเมิน", evaluationSet: "ชุดประเมิน", metric: "ตัวชี้วัด",
    threshold: "เกณฑ์", limitations: "ข้อจำกัด", oversight: "การกำกับโดยมนุษย์", costLatency: "ค่าใช้จ่ายและ latency",
    monitoring: "การเฝ้าระวัง", fallback: "ทางสำรองเมื่อโมเดลล้มเหลว",
    scope: "ขอบเขต", snapshot: "สำเนาก่อนแก้", dryRun: "การลองรันแบบไม่เขียนจริง", rerunSafe: "รันซ้ำได้ปลอดภัย",
    rollback: "การย้อนกลับ", weakness: "จุดอ่อน", verification: "วิธีพิสูจน์",
    changes: "สิ่งที่เปลี่ยน", permissions: "สิทธิ์และ secret ที่ใช้",
  },
});

const BUGFIX_VARIANTS = Object.freeze(["security", "hotfix"]);
const SEMVER = Object.freeze(["major", "minor", "patch"]);
const FLOATING_VERSION = /^(?:latest|current|main|master|head)$/i;

function labels(language) {
  return language === "th" ? LABELS.th : LABELS.en;
}

function present(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("; ");
  if (isObject(value)) {
    return Object.entries(value).filter(([, item]) => present(item))
      .map(([key, item]) => `${key}: ${text(item)}`).join(", ");
  }
  return String(value ?? "").trim();
}

function cell(value, l = LABELS.en) {
  if (value === true) return l.yes;
  if (value === false) return l.no;
  return text(value).replace(/\r?\n/g, " ").replaceAll("|", "\\|") || "—";
}

function table(headers, rows) {
  return `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n` +
    rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

// A Part | Detail table of the supplied rows; rows without a value are left
// out, so a reader never scans dashes.
function partTable(rows, l) {
  const shown = rows.filter(([, value]) => present(value) || typeof value === "boolean");
  return shown.length ? table([l.part, l.detail], shown.map(([label, value]) => [label, cell(value, l)])) : "";
}

function first(row, keys) {
  for (const key of keys) if (present(row?.[key])) return row[key];
  return undefined;
}

function requireObject(value, path, issues) {
  if (isObject(value)) return true;
  issues.push(`${path} must be an object`);
  return false;
}

function requireFields(row, path, fields, issues) {
  for (const field of fields) if (!present(row[field])) issues.push(`${path}.${field} is required`);
}

function stringList(value, path, issues, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) issues.push(`${path} is required`);
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list of strings`);
    return;
  }
  if (required && !value.length) issues.push(`${path} must name at least one entry`);
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") issues.push(`${path}[${index}] must be a non-empty string`);
  });
}

function objectList(value, path, issues) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list`);
    return [];
  }
  return value.map((row, index) => {
    if (!isObject(row)) issues.push(`${path}[${index}] must be an object`);
    return isObject(row) ? [row, `${path}[${index}]`] : null;
  }).filter(Boolean);
}

// --- bugfix ---------------------------------------------------------------

function validateDisclosure(value, path, issues) {
  if (!requireObject(value, path, issues)) return;
  if (!present(first(value, ["vulnerabilityClass", "class"]))) issues.push(`${path}.vulnerabilityClass is required`);
  requireFields(value, path, ["affectedVersions", "exploitability", "owner"], issues);
  // "backports" is the spelling SECTION_HELP shows; "backport" the catalog's.
  const key = value.backport !== undefined ? "backport" : value.backports !== undefined ? "backports" : "";
  if (!key) issues.push(`${path}.backport is required`);
  else stringList(value[key], `${path}.${key}`, issues, { required: true });
}

function validateIncident(value, path, issues) {
  if (typeof value === "string") {
    if (!value.trim()) issues.push(`${path} is required`);
    return;
  }
  if (!requireObject(value, path, issues)) return;
  if (!present(value.link)) issues.push(`${path}.link is required`);
}

export function validateBugfix(value, path = "bugfix") {
  const issues = [];
  if (value === undefined || value === null) return issues;
  if (!requireObject(value, path, issues)) return issues;
  const variant = value.variant;
  if (variant !== undefined && !BUGFIX_VARIANTS.includes(String(variant).toLowerCase()))
    issues.push(`${path}.variant must be ${BUGFIX_VARIANTS.join("|")}`);
  const kind = String(variant ?? "").toLowerCase();
  if (value.disclosure !== undefined) validateDisclosure(value.disclosure, `${path}.disclosure`, issues);
  else if (kind === "security") issues.push(`${path}.disclosure is required for a security bugfix`);
  if (value.incident !== undefined) validateIncident(value.incident, `${path}.incident`, issues);
  else if (kind === "hotfix") issues.push(`${path}.incident is required for a hotfix bugfix`);
  if (value.backport !== undefined) stringList(value.backport, `${path}.backport`, issues, { required: kind === "hotfix" });
  else if (kind === "hotfix") issues.push(`${path}.backport is required for a hotfix bugfix`);
  return issues;
}

function incidentPart(value, key) {
  return isObject(value.incident) && present(value.incident[key]) ? value.incident[key] : value[key];
}

export function renderBugfix(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const blocks = [partTable([
    [l.reproduction, value.reproduction], [l.environment, value.environment],
    [l.expected, value.expected], [l.observed, value.observed],
    [l.rootCause, value.rootCause], [l.introducedBy, value.introducedBy],
    [l.blastRadius, value.blastRadius], [l.dataRepair, value.dataRepair],
    [l.regression, value.regression],
  ], l)];
  const disclosure = value.disclosure;
  if (isObject(disclosure) && present(disclosure)) blocks.push(`### ${l.disclosure}\n\n` + partTable([
    [l.vulnerabilityClass, first(disclosure, ["vulnerabilityClass", "class"])],
    [l.affectedVersions, disclosure.affectedVersions], [l.exploitability, disclosure.exploitability],
    [l.owner, disclosure.owner], [l.embargo, disclosure.embargo], [l.advisory, disclosure.advisory],
    [l.backport, first(disclosure, ["backport", "backports"])],
  ], l));
  const incident = isObject(value.incident) ? value.incident.link : value.incident;
  const hotfix = partTable([
    [l.incident, incident], [l.mitigation, incidentPart(value, "mitigation")],
    [l.minimumScope, incidentPart(value, "minimumScope")], [l.backport, value.backport],
    [l.followUp, incidentPart(value, "followUp")],
  ], l);
  if (hotfix) blocks.push(`### ${l.hotfix}\n\n${hotfix}`);
  return blocks.filter(Boolean).join("\n\n");
}

// --- refactor -------------------------------------------------------------

export function validateRefactor(value, path = "refactor") {
  const issues = [];
  if (value === undefined || value === null) return issues;
  if (!requireObject(value, path, issues)) return issues;
  stringList(value.steps, `${path}.steps`, issues);
  return issues;
}

export function renderRefactor(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const steps = Array.isArray(value.steps) && value.steps.length
    ? `**${l.steps}:**\n\n${value.steps.map((step, index) => `${index + 1}. ${cell(step, l)}`).join("\n")}` : "";
  return [partTable([
    [l.invariants, value.invariants], [l.characterization, value.characterization],
    [l.equivalenceEvidence, value.equivalenceEvidence], [l.performanceNeutral, value.performanceNeutral],
  ], l), steps].filter(Boolean).join("\n\n");
}

// --- libraryContract ------------------------------------------------------

function librarySymbols(value) {
  return value.symbols !== undefined ? ["symbols", value.symbols] : ["exports", value.exports];
}

export function validateLibraryContract(value, path = "libraryContract") {
  const issues = [];
  if (value === undefined || value === null) return issues;
  if (!requireObject(value, path, issues)) return issues;
  if (!present(value.semver)) issues.push(`${path}.semver is required`);
  else if (!SEMVER.includes(String(value.semver).toLowerCase()))
    issues.push(`${path}.semver must be ${SEMVER.join("|")}`);
  if (!present(value.changelog)) issues.push(`${path}.changelog is required`);
  stringList(value.runtimes, `${path}.runtimes`, issues);
  const [key, symbols] = librarySymbols(value);
  if (!present(symbols)) issues.push(`${path}.symbols is required`);
  for (const [row, rowPath] of objectList(symbols, `${path}.${key}`, issues)) {
    if (!present(first(row, ["name", "symbol"]))) issues.push(`${rowPath}.name is required`);
    if (!present(row.signature)) issues.push(`${rowPath}.signature is required`);
  }
  for (const [row, rowPath] of objectList(value.exitCodes, `${path}.exitCodes`, issues)) {
    if (row.code === undefined || row.code === null || row.code === "") issues.push(`${rowPath}.code is required`);
    if (!present(row.meaning)) issues.push(`${rowPath}.meaning is required`);
  }
  return issues;
}

export function renderLibraryContract(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const blocks = [partTable([
    [l.package, value.package], [l.semver, value.semver], [l.runtimes, value.runtimes],
    [l.errors, value.errors], [l.stdout, value.stdout], [l.stderr, value.stderr],
    [l.deprecation, value.deprecation], [l.changelog, value.changelog],
  ], l)];
  const [, symbols] = librarySymbols(value);
  const rows = (Array.isArray(symbols) ? symbols : []).filter(isObject);
  if (rows.length) blocks.push(`### ${l.symbols}\n\n` + table([l.symbol, l.signature, l.errors, l.change],
    rows.map((row) => [`\`${cell(first(row, ["name", "symbol"]), l)}\``, cell(row.signature, l),
      cell(row.errors, l), cell(row.change, l)])));
  const codes = (Array.isArray(value.exitCodes) ? value.exitCodes : []).filter(isObject);
  if (codes.length) blocks.push(`### ${l.exitCodes}\n\n` +
    table([l.code, l.meaning], codes.map((row) => [cell(row.code, l), cell(row.meaning, l)])));
  return blocks.filter(Boolean).join("\n\n");
}

// --- migrationPlan --------------------------------------------------------

export function validateMigrationPlan(value, path = "migrationPlan") {
  const issues = [];
  if (value === undefined || value === null) return issues;
  if (!requireObject(value, path, issues)) return issues;
  requireFields(value, path, ["from", "to", "seam", "cutover", "rollbackWindow"], issues);
  if (!present(first(value, ["decommissionTask", "decommission"]))) issues.push(`${path}.decommissionTask is required`);
  if (value.parity === undefined || value.parity === null) issues.push(`${path}.parity is required`);
  else if (requireObject(value.parity, `${path}.parity`, issues))
    requireFields(value.parity, `${path}.parity`, ["check", "tolerance"], issues);
  return issues;
}

export function renderMigrationPlan(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const parity = isObject(value.parity)
    ? [value.parity.check, present(value.parity.tolerance) ? `${l.tolerance} ${text(value.parity.tolerance)}` : ""]
      .filter(present).join("; ")
    : value.parity;
  return partTable([
    [l.from, value.from], [l.to, value.to], [l.seam, value.seam], [l.dualRun, value.dualRun],
    [l.parity, parity], [l.cutover, value.cutover], [l.rollbackWindow, value.rollbackWindow],
    [l.decommission, first(value, ["decommissionTask", "decommission"])],
  ], l);
}

// --- integrations ---------------------------------------------------------

function validateDocs(value, path, issues) {
  if (!requireObject(value, path, issues)) return;
  const source = String(first(value, ["source", "url"]) ?? "").trim();
  if (!source) issues.push(`${path}.source is required`);
  else {
    let url = null;
    try { url = new URL(source); } catch { /* reported below */ }
    if (!url || url.protocol !== "https:") issues.push(`${path}.source must be an HTTPS URL`);
  }
  const version = String(value.version ?? "").trim();
  if (!version) issues.push(`${path}.version is required`);
  else if (FLOATING_VERSION.test(version)) issues.push(`${path}.version must identify a fixed version`);
}

export function validateIntegrations(value, path = "integrations") {
  const issues = [];
  if (value === undefined || value === null) return issues;
  for (const [row, rowPath] of objectList(value, path, issues)) {
    if (row.docs !== undefined) validateDocs(row.docs, `${rowPath}.docs`, issues);
    if (row.secretRef !== undefined && (typeof row.secretRef !== "string" || !row.secretRef.trim()))
      issues.push(`${rowPath}.secretRef must name where the secret is stored`);
    if (row.webhook !== undefined && requireObject(row.webhook, `${rowPath}.webhook`, issues))
      requireFields(row.webhook, `${rowPath}.webhook`, ["signature", "replayWindow", "dedup"], issues);
  }
  return issues;
}

function integrationDetail(row, l) {
  const docs = isObject(row.docs)
    ? [first(row.docs, ["source", "url"]), row.docs.version].filter(present).map(text).join(" @ ") : row.docs;
  const webhook = isObject(row.webhook) ? row.webhook : {};
  return partTable([
    [l.owner, row.owner], [l.docs, docs], [l.auth, row.auth], [l.secretRef, row.secretRef],
    [l.limits, row.limits], [l.sandbox, row.sandbox], [l.mapping, row.mapping],
    [l.webhookSignature, webhook.signature], [l.replayWindow, webhook.replayWindow], [l.dedup, webhook.dedup],
    [l.outage, row.outage],
  ], l);
}

export function renderIntegrations(value, { language } = {}) {
  const rows = (Array.isArray(value) ? value : []).filter(isObject);
  if (!rows.length) return "";
  const l = labels(language);
  const summary = table([l.integration, l.kind, l.documentation, l.version, l.concerns], rows.map((row) => [
    cell(row.key, l), cell(row.kind, l), cell(row.documentation?.source, l), cell(row.documentation?.version, l),
    Array.isArray(row.concerns) && row.concerns.length ? cell(row.concerns.join(", "), l) : l.none,
  ]));
  const details = rows.map((row) => {
    const detail = integrationDetail(row, l);
    return detail ? `### ${cell(row.key, l)}\n\n${detail}` : "";
  }).filter(Boolean);
  return [summary, ...details].join("\n\n");
}

// --- performanceAnalysis --------------------------------------------------

export function validatePerformanceAnalysis(value, path = "performanceAnalysis") {
  const issues = [];
  if (value === undefined || value === null) return issues;
  if (!requireObject(value, path, issues)) return issues;
  if (value.baseline === undefined || value.baseline === null) issues.push(`${path}.baseline is required`);
  else if (requireObject(value.baseline, `${path}.baseline`, issues))
    requireFields(value.baseline, `${path}.baseline`, ["value", "method"], issues);
  requireFields(value, path, ["hypothesis", "target"], issues);
  if (value.benchmark !== undefined && requireObject(value.benchmark, `${path}.benchmark`, issues)) {
    requireFields(value.benchmark, `${path}.benchmark`, ["runs", "variance", "environment"], issues);
    const runs = value.benchmark.runs;
    if (typeof runs === "number" && (!Number.isInteger(runs) || runs < 1))
      issues.push(`${path}.benchmark.runs must be a positive whole number`);
  }
  return issues;
}

export function renderPerformanceAnalysis(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const baseline = isObject(value.baseline)
    ? [value.baseline.value, present(value.baseline.method) ? `${l.method}: ${text(value.baseline.method)}` : ""]
      .filter(present).map(text).join(" — ")
    : value.baseline;
  const bench = isObject(value.benchmark)
    ? [[l.runs, value.benchmark.runs], [l.variance, value.benchmark.variance],
      [l.environment.toLowerCase(), value.benchmark.environment]]
      .filter(([, item]) => present(item)).map(([label, item]) => `${label}: ${text(item)}`).join(", ")
    : value.benchmark;
  return partTable([
    [l.baseline, baseline], [l.profile, value.profile], [l.hypothesis, value.hypothesis],
    [l.target, value.target], [l.benchmark, bench], [l.tradeoffs, value.tradeoffs],
    [l.regressionBudget, value.regressionBudget],
  ], l);
}

// --- shared helpers for the operational work types -------------------------

// A bulleted list under a bold label; "" when the list is empty.
function bullets(label, value, l) {
  const items = (Array.isArray(value) ? value : present(value) ? [value] : []).filter(present);
  return items.length ? `**${label}:**\n\n${items.map((item) => `- ${cell(item, l)}`).join("\n")}` : "";
}

// The first present spelling of a field (catalog name first, SECTION_HELP name second).
function pick(value, keys) {
  return first(value, keys);
}

function requireOneOf(value, path, keys, issues) {
  if (!present(first(value, keys))) issues.push(`${path}.${keys[0]} is required`);
}

// Validates a list field under whichever spelling the author used.
function listOf(value, path, keys, issues, options) {
  const key = keys.find((name) => value[name] !== undefined) ?? keys[0];
  stringList(value[key], `${path}.${key}`, issues, options);
}

function startValidation(value, path, issues) {
  if (value === undefined || value === null) return false;
  return requireObject(value, path, issues);
}

// The fields each of these sections must answer (with a reason when the answer
// is none or unknown). The validators and the approval page's checklist both
// read this table, so what is checked and what is shown cannot drift.
export const REQUIRED_ANSWERS = Object.freeze({
  dataFix: Object.freeze(["scope", "snapshot", "dryRun", "rerunSafe", "rollback"]),
  hardening: Object.freeze(["weakness", "control", "verification"]),
  pipelinePlan: Object.freeze(["changes", "permissions", "blastRadius", "rollback"]),
  infraPlan: Object.freeze(["costDelta"]),
  experimentDesign: Object.freeze(["guardrails", "stopRules"]),
  modelCard: Object.freeze(["evaluation"])
});

// A newer required field: present, and "none" or "unknown" only with a reason,
// so the answer is always one the author can truthfully give.
function requireAnswer(row, path, field, issues) {
  if (!present(row[field])) issues.push(`${path}.${field} is required`);
  else {
    const bare = bareAbsenceIssue(row[field], `${path}.${field}`);
    if (bare) issues.push(bare);
  }
}

// The same for a list: entries, or one string saying none or unknown and why.
function requireAnswerList(row, path, field, issues) {
  const value = row[field];
  if (typeof value === "string") {
    if (absenceKind(value) === "reasoned") return;
    issues.push(bareAbsenceIssue(value, `${path}.${field}`) ||
      `${path}.${field} must be a list of strings, or 'unknown: <reason>'`);
    return;
  }
  stringList(value, `${path}.${field}`, issues, { required: true });
}

// --- dataFix, hardening, pipelinePlan -------------------------------------

export function validateDataFix(value, path = "dataFix") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  for (const field of REQUIRED_ANSWERS.dataFix) requireAnswer(value, path, field, issues);
  return issues;
}

export function renderDataFix(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  return partTable([
    [l.scope, value.scope], [l.snapshot, value.snapshot], [l.dryRun, value.dryRun],
    [l.rerunSafe, value.rerunSafe], [l.rollback, value.rollback],
  ], l);
}

export function validateHardening(value, path = "hardening") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  for (const field of REQUIRED_ANSWERS.hardening) requireAnswer(value, path, field, issues);
  return issues;
}

export function renderHardening(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  return partTable([
    [l.weakness, value.weakness], [l.control, value.control], [l.verification, value.verification],
  ], l);
}

export function validatePipelinePlan(value, path = "pipelinePlan") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  for (const field of REQUIRED_ANSWERS.pipelinePlan) requireAnswer(value, path, field, issues);
  return issues;
}

export function renderPipelinePlan(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  return partTable([
    [l.changes, value.changes], [l.permissions, value.permissions],
    [l.blastRadius, value.blastRadius], [l.rollback, value.rollback],
  ], l);
}

// --- dependencyChange -----------------------------------------------------

function validateDependencyRow(row, path, issues) {
  requireFields(row, path, ["package", "from", "to"], issues);
  if (present(row.to) && FLOATING_VERSION.test(String(row.to).trim())) issues.push(`${path}.to must identify a fixed version`);
  requireFields(row, path, ["rollbackPin", "provenance", "sbom"], issues);
}

// SECTION_HELP shows a list of package rows; the catalog shows one object.
// Both are accepted.
export function validateDependencyChange(value, path = "dependencyChange") {
  const issues = [];
  if (value === undefined || value === null) return issues;
  if (Array.isArray(value)) {
    if (!value.length) issues.push(`${path} must name at least one package`);
    for (const [row, rowPath] of objectList(value, path, issues)) validateDependencyRow(row, rowPath, issues);
    return issues;
  }
  if (requireObject(value, path, issues)) validateDependencyRow(value, path, issues);
  return issues;
}

function dependencyTable(row, l) {
  return partTable([
    [l.package, row.package], [l.from, row.from], [l.to, row.to],
    [l.breakingChanges, pick(row, ["breakingChanges", "breaking"])], [l.cve, pick(row, ["cve", "cves"])],
    [l.license, row.license], [l.transitive, row.transitive], [l.lockfile, row.lockfile],
    [l.rollbackPin, row.rollbackPin], [l.provenance, row.provenance], [l.sbom, row.sbom],
  ], l);
}

export function renderDependencyChange(value, { language } = {}) {
  const l = labels(language);
  if (Array.isArray(value)) {
    const rows = value.filter((row) => isObject(row) && present(row));
    if (rows.length === 1) return dependencyTable(rows[0], l);
    return rows.map((row) => {
      const body = dependencyTable(row, l);
      return body ? `### ${cell(row.package, l)}\n\n${body}` : "";
    }).filter(Boolean).join("\n\n");
  }
  return isObject(value) && present(value) ? dependencyTable(value, l) : "";
}

// --- deprecationPlan ------------------------------------------------------

export function validateDeprecationPlan(value, path = "deprecationPlan") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  requireFields(value, path, ["what", "replacement", "warning"], issues);
  requireOneOf(value, path, ["removeWhen", "removalCondition"], issues);
  if (value.consumers !== undefined) stringList(value.consumers, `${path}.consumers`, issues);
  return issues;
}

export function renderDeprecationPlan(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  return [partTable([
    [l.what, value.what], [l.replacement, value.replacement], [l.announce, value.announce],
    [l.warning, value.warning], [l.usageMetric, value.usageMetric],
    [l.removeWhen, pick(value, ["removeWhen", "removalCondition"])],
  ], l), bullets(l.consumers, value.consumers, l)].filter(Boolean).join("\n\n");
}

// --- infraPlan ------------------------------------------------------------

export function validateInfraPlan(value, path = "infraPlan") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  requireFields(value, path, ["planDiff", "blastRadius"], issues);
  for (const field of REQUIRED_ANSWERS.infraPlan) requireAnswer(value, path, field, issues);
  stringList(value.environments, `${path}.environments`, issues, { required: true });
  if (value.provisioningOrder !== undefined) stringList(value.provisioningOrder, `${path}.provisioningOrder`, issues);
  return issues;
}

export function renderInfraPlan(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  return [partTable([
    [l.iac, value.iac], [l.planDiff, value.planDiff], [l.capacity, value.capacity],
    [l.costDelta, value.costDelta], [l.blastRadius, value.blastRadius], [l.secrets, value.secrets],
    [l.drift, value.drift], [l.externalOperations, value.externalOperations],
  ], l), bullets(l.environments, value.environments, l),
  bullets(l.provisioningOrder, value.provisioningOrder, l)].filter(Boolean).join("\n\n");
}

// --- privacyAssessment ----------------------------------------------------

// LINDDUN categories, compared without case, spaces, or hyphens.
const LINDDUN = Object.freeze([
  "linking", "identifying", "nonrepudiation", "detecting", "datadisclosure", "unawareness", "noncompliance",
  "linkability", "identifiability", "detectability", "disclosureofinformation", "unawarenessandunintervenability",
]);

function personalDataKey(value) {
  return value.personalData !== undefined ? "personalData" : value.data !== undefined ? "data" : "personalData";
}

export function validatePrivacyAssessment(value, path = "privacyAssessment") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  const key = personalDataKey(value);
  if (!present(value[key])) issues.push(`${path}.personalData is required`);
  for (const [row, rowPath] of objectList(value[key], `${path}.${key}`, issues)) {
    requireOneOf(row, rowPath, ["data", "field"], issues);
    requireFields(row, rowPath, ["class"], issues);
  }
  requireFields(value, path, ["purpose", "retention"], issues);
  for (const [row, rowPath] of objectList(value.threats, `${path}.threats`, issues)) {
    requireFields(row, rowPath, ["linddun", "threat", "control"], issues);
    const category = String(row.linddun ?? "").toLowerCase().replace(/[\s_-]+/g, "");
    if (category && !LINDDUN.includes(category))
      issues.push(`${rowPath}.linddun must be a LINDDUN category (linking, identifying, non-repudiation, ` +
        "detecting, data disclosure, unawareness, non-compliance)");
  }
  return issues;
}

export function renderPrivacyAssessment(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const blocks = [];
  const data = (Array.isArray(value[personalDataKey(value)]) ? value[personalDataKey(value)] : []).filter(isObject);
  if (data.length) blocks.push(`### ${l.personalData}\n\n` + table([l.data, l.dataClass],
    data.map((row) => [cell(pick(row, ["data", "field"]), l), cell(row.class, l)])));
  blocks.push(partTable([
    [l.purpose, value.purpose], [l.lawfulBasis, value.lawfulBasis], [l.minimization, value.minimization],
    [l.retention, value.retention], [l.deletion, value.deletion], [l.subjectRequests, value.subjectRequests],
    [l.crossBorder, pick(value, ["crossBorder", "transfers"])], [l.telemetryPii, value.telemetryPii],
  ], l));
  const threats = (Array.isArray(value.threats) ? value.threats : []).filter(isObject);
  if (threats.length) blocks.push(`### ${l.privacyThreats}\n\n` + table([l.linddun, l.threat, l.control],
    threats.map((row) => [cell(row.linddun, l), cell(row.threat, l), cell(row.control, l)])));
  return blocks.filter(Boolean).join("\n\n");
}

// --- experimentDesign -----------------------------------------------------

export function validateExperimentDesign(value, path = "experimentDesign") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  requireFields(value, path, ["hypothesis", "primaryMetric", "allocation", "decisionRule"], issues);
  for (const field of REQUIRED_ANSWERS.experimentDesign) requireAnswerList(value, path, field, issues);
  return issues;
}

export function renderExperimentDesign(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  return [partTable([
    [l.hypothesis, value.hypothesis], [l.primaryMetric, value.primaryMetric], [l.unit, value.unit],
    [l.allocation, value.allocation], [l.sampleOrDuration, pick(value, ["sampleOrDuration", "sampleSize", "duration"])],
    [l.exposureEvent, pick(value, ["exposureEvent", "exposureLogging"])], [l.decisionRule, value.decisionRule],
    [l.cleanupTask, pick(value, ["cleanupTask", "cleanup"])],
  ], l), bullets(l.guardrails, value.guardrails, l), bullets(l.stopRules, value.stopRules, l)]
    .filter(Boolean).join("\n\n");
}

// --- releasePlan ----------------------------------------------------------

export function validateReleasePlan(value, path = "releasePlan") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  requireFields(value, path, ["minimumVersion"], issues);
  listOf(value, path, ["stages", "stagedRollout"], issues, { required: true });
  requireOneOf(value, path, ["gate", "crashGate"], issues);
  return issues;
}

export function renderReleasePlan(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  return [partTable([
    [l.minimumVersion, value.minimumVersion], [l.coexistence, value.coexistence],
    [l.serverWindow, value.serverWindow], [l.storeReview, value.storeReview],
    [l.forcedUpgrade, value.forcedUpgrade], [l.gate, pick(value, ["gate", "crashGate"])],
  ], l), bullets(l.stages, pick(value, ["stages", "stagedRollout"]), l)].filter(Boolean).join("\n\n");
}

// --- modelCard ------------------------------------------------------------

function modelPin(value) {
  return present(value.versionPin) ? value.versionPin : isObject(value.model) ? value.model.version : undefined;
}

function thresholdRow(row) {
  if (isObject(row)) return [pick(row, ["metric", "name", "kind"]), pick(row, ["threshold", "target", "min", "value"])];
  const raw = String(row ?? "");
  const index = raw.indexOf(":");
  return index > 0 ? [raw.slice(0, index).trim(), raw.slice(index + 1).trim()] : [raw, undefined];
}

export function validateModelCard(value, path = "modelCard") {
  const issues = [];
  if (!startValidation(value, path, issues)) return issues;
  requireFields(value, path, ["intendedUse", "model", "fallback"], issues);
  const pin = modelPin(value);
  if (!present(pin)) issues.push(`${path}.versionPin is required`);
  else if (FLOATING_VERSION.test(String(pin).trim())) issues.push(`${path}.versionPin must identify a fixed version`);
  // The evaluation is an object with thresholds, or one string saying none or
  // unknown and why; absent is not an answer.
  if (typeof value.evaluation === "string") {
    if (absenceKind(value.evaluation) !== "reasoned")
      issues.push(bareAbsenceIssue(value.evaluation, `${path}.evaluation`) ||
        `${path}.evaluation must be an object with a set and thresholds, or 'unknown: <reason>'`);
  } else if (value.evaluation === undefined || value.evaluation === null) {
    issues.push(`${path}.evaluation is required`);
  } else if (requireObject(value.evaluation, `${path}.evaluation`, issues)) {
    requireFields(value.evaluation, `${path}.evaluation`, ["set"], issues);
    const thresholds = value.evaluation.thresholds;
    if (!Array.isArray(thresholds) || !thresholds.length)
      issues.push(`${path}.evaluation.thresholds must name at least one threshold`);
    else thresholds.forEach((row, index) => {
      const [metric, limit] = thresholdRow(row);
      if (!present(metric) || !present(limit))
        issues.push(`${path}.evaluation.thresholds[${index}] must name a metric and its threshold`);
    });
  }
  return issues;
}

export function renderModelCard(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const model = isObject(value.model) ? pick(value.model, ["provider", "name", "id"]) : value.model;
  const blocks = [partTable([
    [l.intendedUse, value.intendedUse], [l.outOfScope, value.outOfScope], [l.model, model],
    [l.versionPin, modelPin(value)], [l.dataSource, pick(value, ["data", "dataSource"])], [l.license, value.license],
    [l.oversight, value.oversight], [l.costLatency, pick(value, ["costLatency", "cost"])],
    [l.monitoring, value.monitoring], [l.fallback, value.fallback],
    [l.evaluation, typeof value.evaluation === "string" ? value.evaluation : undefined],
  ], l)];
  const evaluation = isObject(value.evaluation) ? value.evaluation : null;
  if (evaluation && present(evaluation)) {
    const thresholds = (Array.isArray(evaluation.thresholds) ? evaluation.thresholds : []).filter(present);
    blocks.push([`### ${l.evaluation}`, present(evaluation.set) ? `**${l.evaluationSet}:** ${cell(evaluation.set, l)}` : "",
      thresholds.length ? table([l.metric, l.threshold], thresholds.map((row) => thresholdRow(row).map((part) => cell(part, l)))) : "",
    ].filter(Boolean).join("\n\n"));
  }
  blocks.push(bullets(l.limitations, value.limitations, l));
  return blocks.filter(Boolean).join("\n\n");
}

export const WORK_TYPE_FIELDS = Object.freeze({
  bugfix: Object.freeze({ validate: validateBugfix, render: renderBugfix }),
  refactor: Object.freeze({ validate: validateRefactor, render: renderRefactor }),
  libraryContract: Object.freeze({ validate: validateLibraryContract, render: renderLibraryContract }),
  migrationPlan: Object.freeze({ validate: validateMigrationPlan, render: renderMigrationPlan }),
  integrations: Object.freeze({ validate: validateIntegrations, render: renderIntegrations }),
  performanceAnalysis: Object.freeze({ validate: validatePerformanceAnalysis, render: renderPerformanceAnalysis }),
  dependencyChange: Object.freeze({ validate: validateDependencyChange, render: renderDependencyChange }),
  deprecationPlan: Object.freeze({ validate: validateDeprecationPlan, render: renderDeprecationPlan }),
  infraPlan: Object.freeze({ validate: validateInfraPlan, render: renderInfraPlan }),
  privacyAssessment: Object.freeze({ validate: validatePrivacyAssessment, render: renderPrivacyAssessment }),
  experimentDesign: Object.freeze({ validate: validateExperimentDesign, render: renderExperimentDesign }),
  releasePlan: Object.freeze({ validate: validateReleasePlan, render: renderReleasePlan }),
  modelCard: Object.freeze({ validate: validateModelCard, render: renderModelCard }),
  dataFix: Object.freeze({ validate: validateDataFix, render: renderDataFix }),
  hardening: Object.freeze({ validate: validateHardening, render: renderHardening }),
  pipelinePlan: Object.freeze({ validate: validatePipelinePlan, render: renderPipelinePlan }),
});
