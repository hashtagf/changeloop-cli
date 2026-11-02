import { NFR_CATEGORY_CAPABILITIES } from "../change-validation.mjs";

// Typed design fields for quality, security, and operability: NFR scenarios,
// the threat model, observability, the analytics tracking plan, and capacity.
// Each field exposes validate (path-prefixed issues) and render (markdown
// body without the section heading, "" when empty). groundingFromQuality
// derives the grounding v2 nfrAssessment and observability sections.

const LABELS = Object.freeze({
  en: {
    id: "ID", characteristic: "Characteristic", stimulus: "Stimulus", response: "Response",
    measure: "Measure", source: "Source", environment: "Environment", claim: "Claim",
    assets: "Assets and data classes", trustBoundaries: "Trust boundaries", stride: "STRIDE",
    threat: "Threat", risk: "Likelihood × impact", control: "Control", scenario: "Scenario",
    residual: "Residual risk", correlation: "Correlation", failure: "Failure mode",
    signal: "Signal", sli: "SLI", slo: "SLO", alert: "Alert", runbook: "Runbook action",
    owner: "Owner", usage: "Usage and health signals", piiCheck: "PII-in-telemetry check",
    successMeasure: "Success measure", event: "Event", properties: "Properties",
    trigger: "Trigger", dashboard: "Dashboard", load: "Expected load", growth: "Growth",
    exhaustsAt: "Exhausts at", storage: "Storage", cost: "Cost", costOwner: "Cost owner",
    item: "Item", value: "Value",
  },
  th: {
    id: "ID", characteristic: "คุณลักษณะ", stimulus: "เหตุกระตุ้น", response: "การตอบสนอง",
    measure: "เกณฑ์วัด", source: "ที่มา", environment: "สภาพแวดล้อม", claim: "Claim",
    assets: "ทรัพย์สินและประเภทข้อมูล", trustBoundaries: "ขอบเขตความเชื่อถือ", stride: "STRIDE",
    threat: "ภัยคุกคาม", risk: "โอกาส × ผลกระทบ", control: "มาตรการควบคุม", scenario: "Scenario",
    residual: "ความเสี่ยงคงเหลือ", correlation: "Correlation", failure: "รูปแบบความล้มเหลว",
    signal: "สัญญาณ", sli: "SLI", slo: "SLO", alert: "การแจ้งเตือน", runbook: "การรับมือใน runbook",
    owner: "เจ้าของ", usage: "สัญญาณการใช้งานและสุขภาพ", piiCheck: "การตรวจ PII ใน telemetry",
    successMeasure: "ตัววัดความสำเร็จ", event: "Event", properties: "Properties",
    trigger: "จุดที่ส่ง", dashboard: "Dashboard", load: "โหลดที่คาดไว้", growth: "การเติบโต",
    exhaustsAt: "ทรัพยากรหมดเมื่อ", storage: "พื้นที่จัดเก็บ", cost: "ต้นทุน", costOwner: "เจ้าของต้นทุน",
    item: "รายการ", value: "ค่า",
  },
});

// ISO/IEC 25010:2023 characteristics and sub-characteristics, mapped to the
// grounding nfrAssessment category they evidence (null: no grounding category).
const ISO_25010 = Object.freeze({
  "functional suitability": null, "functional completeness": null,
  "functional correctness": null, "functional appropriateness": null,
  "performance efficiency": "performance", "time behaviour": "performance",
  "time behavior": "performance", "resource utilization": "performance",
  capacity: "capacity",
  compatibility: "compatibility", "co existence": "compatibility",
  interoperability: "compatibility",
  "interaction capability": "accessibility", usability: "accessibility",
  "appropriateness recognizability": null, learnability: null,
  operability: "operability", "user error protection": null,
  "user engagement": null, inclusivity: "accessibility", accessibility: "accessibility",
  "user assistance": "accessibility", "self descriptiveness": null,
  reliability: "availability", faultlessness: "availability", maturity: "availability",
  availability: "availability", "fault tolerance": "availability",
  recoverability: "recoverability",
  security: "securityPrivacy", confidentiality: "securityPrivacy",
  integrity: "securityPrivacy", "non repudiation": "securityPrivacy",
  accountability: "securityPrivacy", authenticity: "securityPrivacy",
  resistance: "securityPrivacy",
  maintainability: null, modularity: null, reusability: null, analysability: "operability",
  analyzability: "operability", modifiability: null, testability: null,
  flexibility: null, portability: null, adaptability: null, scalability: "capacity",
  installability: null, replaceability: null,
  safety: null, "operational constraint": null, "risk identification": null,
  "fail safe": "availability", "hazard warning": null, "safe integration": null,
});

const STRIDE = Object.freeze({
  s: "spoofing", spoofing: "spoofing",
  t: "tampering", tampering: "tampering",
  r: "repudiation", repudiation: "repudiation",
  i: "information-disclosure", "information disclosure": "information-disclosure",
  d: "denial-of-service", "denial of service": "denial-of-service",
  e: "elevation-of-privilege", "elevation of privilege": "elevation-of-privilege",
});
const LEVELS = Object.freeze(["low", "medium", "high"]);

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

function cell(value) {
  return text(value).replace(/\r?\n/g, " ").replaceAll("|", "\\|") || "—";
}

function table(headers, rows) {
  return `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n` +
    rows.map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
}

function requireFields(row, path, fields, issues) {
  for (const field of fields) {
    if (!present(row[field])) issues.push(`${path}.${field} is required`);
  }
}

function stringList(value, path, issues, { nonEmpty = false } = {}) {
  if (value === undefined || value === null) {
    if (nonEmpty) issues.push(`${path} is required`);
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list of strings`);
    return;
  }
  if (nonEmpty && value.length === 0) issues.push(`${path} must not be empty`);
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      issues.push(`${path}[${index}] must be a non-empty string`);
    }
  });
}

function rowList(value, path, issues) {
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

function uniqueKeys(rows, issues) {
  const seen = new Set();
  for (const [row, path] of rows) {
    if (!present(row.key)) continue;
    if (seen.has(row.key)) issues.push(`${path}.key '${row.key}' is duplicated`);
    seen.add(row.key);
  }
}

function claimIds(claim) {
  return (Array.isArray(claim) ? claim : [claim])
    .map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

export function nfrCategory(characteristic) {
  const name = normalize(characteristic);
  return Object.hasOwn(ISO_25010, name) ? ISO_25010[name] : undefined;
}

// --- nfr ---------------------------------------------------------------

export function validateNfr(value, path = "nfr") {
  const issues = [];
  const rows = rowList(value, path, issues);
  for (const [row, rowPath] of rows) {
    requireFields(row, rowPath, ["key", "characteristic", "stimulus", "response", "measure"], issues);
    if (present(row.characteristic) && nfrCategory(row.characteristic) === undefined)
      issues.push(`${rowPath}.characteristic '${text(row.characteristic)}' must be an ISO 25010 characteristic or sub-characteristic`);
    if (row.claim !== undefined && claimIds(row.claim).length === 0)
      issues.push(`${rowPath}.claim must name a claim id when present`);
  }
  uniqueKeys(rows, issues);
  return issues;
}

export function renderNfr(value, { language } = {}) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const l = labels(language);
  return table(
    [l.id, l.characteristic, l.stimulus, l.response, l.measure, l.source, l.environment, l.claim],
    value.filter(isObject).map((row) => [
      row.key, row.characteristic, row.stimulus, row.response, row.measure,
      row.source, row.environment, claimIds(row.claim ?? []).join(", "),
    ]));
}

// --- threatModel -------------------------------------------------------

export function validateThreatModel(value, path = "threatModel") {
  if (value === undefined || value === null) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  stringList(value.assets, `${path}.assets`, issues, { nonEmpty: true });
  stringList(value.trustBoundaries, `${path}.trustBoundaries`, issues, { nonEmpty: true });
  if (!present(value.threats)) issues.push(`${path}.threats is required`);
  const rows = rowList(value.threats, `${path}.threats`, issues);
  for (const [row, rowPath] of rows) {
    requireFields(row, rowPath,
      ["key", "stride", "threat", "likelihood", "impact", "control", "residual"], issues);
    if (present(row.stride) && !STRIDE[normalize(row.stride)])
      issues.push(`${rowPath}.stride must be one of: ${[...new Set(Object.values(STRIDE))].join("|")}`);
    for (const field of ["likelihood", "impact"]) {
      if (present(row[field]) && !LEVELS.includes(normalize(row[field])))
        issues.push(`${rowPath}.${field} must be low|medium|high`);
    }
  }
  uniqueKeys(rows, issues);
  return issues;
}

export function renderThreatModel(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const parts = [];
  if (present(value.assets)) parts.push(`**${l.assets}:** ${text(value.assets)}`);
  if (present(value.trustBoundaries))
    parts.push(`**${l.trustBoundaries}:** ${text(value.trustBoundaries)}`);
  const threats = Array.isArray(value.threats) ? value.threats.filter(isObject) : [];
  if (threats.length) {
    parts.push(table(
      [l.id, l.stride, l.threat, l.risk, l.control, l.scenario, l.residual],
      threats.map((row) => [
        row.key, STRIDE[normalize(row.stride)] || row.stride, row.threat,
        `${text(row.likelihood) || "—"} × ${text(row.impact) || "—"}`,
        row.control, row.scenario, row.residual,
      ])));
  }
  return parts.join("\n\n");
}

// --- observability -----------------------------------------------------

export function validateObservability(value, path = "observability") {
  if (value === undefined || value === null) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  if (!present(value.rows)) issues.push(`${path}.rows is required`);
  for (const [row, rowPath] of rowList(value.rows, `${path}.rows`, issues))
    requireFields(row, rowPath, ["failure", "signal", "sli", "slo", "alert", "runbook", "owner"], issues);
  stringList(value.usage, `${path}.usage`, issues);
  for (const field of ["correlation", "piiCheck"]) {
    if (value[field] !== undefined && !present(value[field]))
      issues.push(`${path}.${field} must not be empty when present`);
  }
  return issues;
}

export function renderObservability(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const parts = [];
  if (present(value.correlation)) parts.push(`**${l.correlation}:** ${text(value.correlation)}`);
  const rows = Array.isArray(value.rows) ? value.rows.filter(isObject) : [];
  if (rows.length) {
    parts.push(table(
      [l.failure, l.signal, l.sli, l.slo, l.alert, l.runbook, l.owner],
      rows.map((row) => [row.failure, row.signal, row.sli, row.slo, row.alert, row.runbook, row.owner])));
  }
  if (present(value.usage))
    parts.push(`**${l.usage}:**\n${value.usage.map((item) => `- ${text(item)}`).join("\n")}`);
  if (present(value.piiCheck)) parts.push(`**${l.piiCheck}:** ${text(value.piiCheck)}`);
  return parts.join("\n\n");
}

// --- trackingPlan ------------------------------------------------------

export function validateTrackingPlan(value, path = "trackingPlan") {
  const issues = [];
  for (const [row, rowPath] of rowList(value, path, issues)) {
    requireFields(row, rowPath, ["measure", "event", "owner"], issues);
    stringList(row.properties, `${rowPath}.properties`, issues, { nonEmpty: true });
  }
  return issues;
}

export function renderTrackingPlan(value, { language } = {}) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const l = labels(language);
  return table(
    [l.successMeasure, l.event, l.properties, l.trigger, l.owner, l.dashboard],
    value.filter(isObject).map((row) => [
      row.measure, row.event, Array.isArray(row.properties) ? row.properties.join(", ") : row.properties,
      row.trigger, row.owner, row.dashboard,
    ]));
}

// --- capacity ----------------------------------------------------------

const CAPACITY_FIELDS = Object.freeze(["load", "growth", "exhaustsAt", "storage", "cost", "costOwner"]);

export function validateCapacity(value, path = "capacity") {
  if (value === undefined || value === null) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  requireFields(value, path, ["load", "exhaustsAt", "cost"], issues);
  return issues;
}

export function renderCapacity(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const rows = CAPACITY_FIELDS.filter((field) => present(value[field]))
    .map((field) => [l[field], value[field]]);
  return rows.length ? table([l.item, l.value], rows) : "";
}

// --- grounding derivation ----------------------------------------------

function nfrAssessmentFromRows(rows) {
  const byCategory = new Map();
  for (const row of rows) {
    const category = nfrCategory(row.characteristic);
    if (!category) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(row);
  }
  return Object.fromEntries(Object.keys(NFR_CATEGORY_CAPABILITIES).map((category) => {
    const matched = byCategory.get(category) || [];
    if (!matched.length) {
      return [category, {
        status: "not-applicable",
        sourceReason: `design nfr declares no ${category} scenario`,
        target: "none", claimIds: [],
      }];
    }
    return [category, {
      status: "applicable",
      sourceReason: `design nfr ${matched.map((row) => text(row.key)).join(", ")}: ` +
        matched.map((row) => text(row.stimulus)).join("; "),
      target: matched.map((row) => `${text(row.response)}; ${text(row.measure)}`).join(" | "),
      claimIds: [...new Set(matched.flatMap((row) => claimIds(row.claim ?? [])))],
    }];
  }));
}

function observabilityGrounding(value) {
  const rows = isObject(value) && Array.isArray(value.rows) ? value.rows.filter(isObject) : [];
  if (!rows.length) {
    return { status: "not-applicable", sourceReason: "design declares no observability rows", rows: [] };
  }
  const correlation = text(value.correlation) || "none declared (single process)";
  return {
    status: "applicable",
    sourceReason: `design observability declares ${rows.length} failure signal(s)`,
    rows: rows.map((row) => ({
      interactionId: text(row.interactionId) || "local",
      correlation,
      structuredEvents: text(row.signal),
      sli: present(row.slo) ? `${text(row.sli)} (SLO: ${text(row.slo)})` : text(row.sli),
      alert: text(row.alert),
      runbook: text(row.runbook),
      operatorQuestion: `Is '${text(row.failure)}' happening, and who acts? Owner: ${text(row.owner)}`,
    })),
  };
}

// Returns the grounding v2 nfrAssessment and observability sections derived
// from a draft's nfr and observability fields; merge them into grounding v2.
export function groundingFromQuality(draft) {
  const rows = Array.isArray(draft?.nfr) ? draft.nfr.filter(isObject) : [];
  return {
    nfrAssessment: nfrAssessmentFromRows(rows),
    observability: observabilityGrounding(draft?.observability),
  };
}

export const QUALITY_FIELDS = Object.freeze({
  nfr: Object.freeze({ validate: validateNfr, render: renderNfr }),
  threatModel: Object.freeze({ validate: validateThreatModel, render: renderThreatModel }),
  observability: Object.freeze({ validate: validateObservability, render: renderObservability }),
  trackingPlan: Object.freeze({ validate: validateTrackingPlan, render: renderTrackingPlan }),
  capacity: Object.freeze({ validate: validateCapacity, render: renderCapacity }),
});
