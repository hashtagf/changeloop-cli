// Typed design fields for published contracts: API operations, event
// contracts, data model, UI contract, and config contract. Each field exposes validate (path-prefixed issues) and render
// (markdown body without the section heading, "" when empty). The older
// apiContracts shape {method, path, auth, request, response, errors} stays
// valid; only the new optional subfields add checks.

const LABELS = Object.freeze({
  en: {
    part: "Part", contract: "Contract", value: "Value",
    resource: "Resource", source: "Source of truth", breakingCheck: "Breaking-change check",
    auth: "Auth", request: "Request", response: "Response", idempotency: "Idempotency",
    pagination: "Pagination", rateLimit: "Rate limit", versioning: "Versioning",
    compatibility: "Compatibility", consumers: "Consumers",
    errors: "Errors", status: "Status", code: "Code", when: "When", retryable: "Retryable",
    yes: "yes", no: "no", envelope: "Error envelope", deprecation: "Deprecation",
    announce: "Announce", sunset: "Sunset", headers: "Headers", usageMetric: "Usage metric",
    removeWhen: "Remove when",
    header: "header", required: "required", optional: "optional", scope: "scope",
    retention: "retention", replay: "replay", inFlight: "in-flight", mismatch: "payload mismatch",
    style: "style", order: "order", defaultLimit: "default limit", maxLimit: "max limit",
    filters: "filters", sorts: "sorts",
    channel: "Channel", action: "Action", payload: "Payload", delivery: "Delivery",
    dedupKey: "Dedup key", orderingKey: "Ordering key", correlation: "Correlation",
    retry: "Retry/DLQ", consumerHandling: "Consumer handling",
    duplicates: "duplicates", late: "late", outOfOrder: "out-of-order",
    store: "Store", owner: "Owner", field: "Field", type: "Type", constraints: "Constraints",
    column: "Column", nullable: "Nullable", default: "Default", constraint: "Constraint",
    dataClass: "Data class", change: "Change", index: "Index", columns: "Columns", unique: "Unique",
    where: "Where", online: "Online", reason: "Reason", invariants: "Invariants", volume: "Volume",
    migration: "Migration", rollback: "Rollback", phase: "Phase", reversible: "Reversible", task: "Task",
    migrationPhases: "Migration phases", recovery: "Recovery", backup: "Backup", rpo: "RPO", rto: "RTO",
    restoreTest: "Restore test", dataContract: "Data contract", freshness: "Freshness",
    frequency: "Update frequency", qualityRules: "Quality rules", endOfLife: "End of life",
    surface: "Surface", users: "Users", platforms: "Platforms", languages: "Languages",
    designRef: "Design reference", entryInfo: "Entry information", flow: "Flow", states: "States",
    state: "State", shows: "User sees", next: "Can do next", scenario: "Scenario",
    preserveInput: "Input preserved on error", i18n: "i18n", formats: "Locale formats",
    timezone: "Time zone", bidi: "Bidi text", collation: "Collation and search",
    expansion: "Text expansion", translationSource: "Translation source", accessibility: "Accessibility",
    standard: "Standard", criterion: "Criterion", kind: "Kind", how: "How", check: "Check",
    untested: "Untested assistive technology", acr: "Accessibility conformance report",
    responsive: "Responsive behavior", components: "Components", component: "Component",
    validationPlan: "Validation plan", method: "method", participants: "participants",
    pass: "pass", severity: "severity", key: "Key", validation: "Validation", secret: "Secret",
    perEnvironment: "Per-environment", reload: "Reload", removalTask: "Removal task",
    on: "yes", off: "no", keepFor: "Retention",
    kinds: { standard: "standard", convention: "convention", heuristic: "heuristic" },
  },
  th: {
    part: "ส่วน", contract: "สัญญา", value: "ค่า",
    resource: "Resource", source: "แหล่งความจริง", breakingCheck: "การตรวจ breaking change",
    auth: "การยืนยันสิทธิ์", request: "Request", response: "Response", idempotency: "Idempotency",
    pagination: "การแบ่งหน้า", rateLimit: "Rate limit", versioning: "การกำหนดเวอร์ชัน",
    compatibility: "ความเข้ากันได้", consumers: "ผู้ใช้สัญญา",
    errors: "Error", status: "Status", code: "Code", when: "เมื่อ", retryable: "ลองใหม่ได้",
    yes: "ได้", no: "ไม่ได้", envelope: "รูปแบบ error", deprecation: "การเลิกใช้",
    announce: "ประกาศ", sunset: "วันสิ้นสุด", headers: "Header", usageMetric: "ตัววัดการใช้งาน",
    removeWhen: "ลบเมื่อ",
    header: "header", required: "บังคับ", optional: "ไม่บังคับ", scope: "ขอบเขต",
    retention: "เก็บไว้", replay: "ตอบซ้ำ", inFlight: "ระหว่างทำงาน", mismatch: "payload ไม่ตรง",
    style: "รูปแบบ", order: "ลำดับ", defaultLimit: "ค่าเริ่มต้น", maxLimit: "สูงสุด",
    filters: "ตัวกรอง", sorts: "การเรียง",
    channel: "Channel", action: "Action", payload: "Payload", delivery: "การส่ง",
    dedupKey: "คีย์กันซ้ำ", orderingKey: "คีย์ลำดับ", correlation: "Correlation",
    retry: "ลองใหม่/DLQ", consumerHandling: "การจัดการฝั่งผู้รับ",
    duplicates: "ซ้ำ", late: "มาช้า", outOfOrder: "ผิดลำดับ",
    store: "ที่เก็บข้อมูล", owner: "เจ้าของ", field: "Field", type: "ชนิด", constraints: "ข้อจำกัด",
    column: "คอลัมน์", nullable: "ว่างได้", default: "ค่าเริ่มต้น", constraint: "ข้อจำกัด",
    dataClass: "ระดับข้อมูล", change: "การเปลี่ยนแปลง", index: "Index", columns: "คอลัมน์", unique: "ไม่ซ้ำ",
    where: "เงื่อนไข", online: "สร้างแบบ online", reason: "เหตุผล", invariants: "เงื่อนไขที่ต้องจริงเสมอ",
    volume: "ปริมาณข้อมูล", migration: "Migration", rollback: "Rollback", phase: "ระยะ",
    reversible: "ย้อนกลับได้", task: "Task", migrationPhases: "ระยะของ migration", recovery: "การกู้คืน",
    backup: "การสำรอง", rpo: "RPO", rto: "RTO", restoreTest: "การทดสอบกู้คืน",
    dataContract: "สัญญาข้อมูล", freshness: "ความสดของข้อมูล", frequency: "ความถี่การอัปเดต",
    qualityRules: "กฎคุณภาพข้อมูล", endOfLife: "วันสิ้นอายุ",
    surface: "หน้าจอ", users: "ผู้ใช้", platforms: "แพลตฟอร์ม", languages: "ภาษา",
    designRef: "อ้างอิงดีไซน์", entryInfo: "ข้อมูลที่ผู้ใช้ต้องรู้ก่อนเริ่ม", flow: "ลำดับขั้น", states: "สถานะ",
    state: "สถานะ", shows: "ผู้ใช้เห็น", next: "ทำต่อได้", scenario: "Scenario",
    preserveInput: "เก็บข้อมูลที่กรอกไว้เมื่อเกิด error", i18n: "i18n", formats: "รูปแบบตาม locale",
    timezone: "เขตเวลา", bidi: "ข้อความสองทิศทาง", collation: "การเรียงและค้นหา",
    expansion: "ความยาวข้อความที่ขยาย", translationSource: "แหล่งคำแปล", accessibility: "การเข้าถึง",
    standard: "มาตรฐาน", criterion: "เกณฑ์", kind: "ประเภท", how: "วิธีทำ", check: "วิธีตรวจ",
    untested: "เทคโนโลยีช่วยเหลือที่ยังไม่ได้ทดสอบ", acr: "รายงานความสอดคล้องด้านการเข้าถึง",
    responsive: "การปรับตามขนาดจอ", components: "Component", component: "Component",
    validationPlan: "แผนทดสอบกับผู้ใช้", method: "วิธี", participants: "ผู้เข้าร่วม",
    pass: "เกณฑ์ผ่าน", severity: "ระดับความรุนแรง", key: "Key", validation: "การตรวจค่า", secret: "ความลับ",
    perEnvironment: "ค่าต่อ environment", reload: "การโหลดใหม่", removalTask: "Task ที่ลบ",
    on: "ใช่", off: "ไม่ใช่", keepFor: "ระยะเก็บข้อมูล",
    kinds: { standard: "มาตรฐาน", convention: "ธรรมเนียมแพลตฟอร์ม", heuristic: "heuristic" },
  },
});

const REPLAY = Object.freeze(["verbatim"]);

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

function partTable(l, rows) {
  const shown = rows.filter(([, value]) => present(value));
  return shown.length ? table([l.part, l.contract], shown) : "";
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

function optionalString(row, field, path, issues) {
  if (row[field] !== undefined && row[field] !== null && typeof row[field] !== "string") {
    issues.push(`${path}.${field} must be a string`);
  }
}

function optionalObject(row, field, path, issues) {
  if (row[field] === undefined || row[field] === null) return null;
  if (!isObject(row[field])) {
    issues.push(`${path}.${field} must be an object`);
    return null;
  }
  return row[field];
}

function isStatus(value) {
  return /^[1-5]\d\d$/.test(String(value ?? "").trim());
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

// --- apiContracts ---------------------------------------------------------

function validateIdempotency(value, path, issues) {
  // The older shape described idempotency as free text; keep it valid.
  if (value === undefined || value === null || typeof value === "string") return;
  if (!isObject(value)) {
    issues.push(`${path} must be an object or text`);
    return;
  }
  optionalString(value, "header", path, issues);
  if (value.required !== undefined && typeof value.required !== "boolean") {
    issues.push(`${path}.required must be true or false`);
  }
  stringList(value.scope, `${path}.scope`, issues, { nonEmpty: true });
  if (!present(value.retention)) issues.push(`${path}.retention is required`);
  if (present(value.replay) && !REPLAY.includes(value.replay)) {
    issues.push(`${path}.replay must be one of ${REPLAY.join(", ")}`);
  }
  if (present(value.inFlight) && !isStatus(value.inFlight)) {
    issues.push(`${path}.inFlight must be an HTTP status`);
  }
  if (present(value.mismatch) && !isStatus(value.mismatch)) {
    issues.push(`${path}.mismatch must be an HTTP status`);
  }
}

function validatePagination(value, path, issues) {
  if (value === undefined || value === null || typeof value === "string") return;
  if (!isObject(value)) {
    issues.push(`${path} must be an object or text`);
    return;
  }
  requireFields(value, path, ["style", "order", "defaultLimit", "maxLimit"], issues);
  for (const field of ["defaultLimit", "maxLimit"]) {
    if (present(value[field]) && !positiveInteger(value[field])) {
      issues.push(`${path}.${field} must be a positive integer`);
    }
  }
  if (positiveInteger(value.defaultLimit) && positiveInteger(value.maxLimit) &&
      value.defaultLimit > value.maxLimit) {
    issues.push(`${path}.defaultLimit must not exceed maxLimit`);
  }
  stringList(value.filters, `${path}.filters`, issues);
  stringList(value.sorts, `${path}.sorts`, issues);
}

function validateErrors(value, path, issues) {
  // Status/code presence is checked at change start (apiContractErrorIssues);
  // here only the new optional subfields are typed.
  if (!Array.isArray(value)) return;
  value.forEach((row, index) => {
    if (!isObject(row)) return;
    if (row.retryable !== undefined && typeof row.retryable !== "boolean") {
      issues.push(`${path}[${index}].retryable must be true or false`);
    }
  });
}

export function validateApiContracts(value, path = "apiContracts") {
  if (!present(value)) return [];
  const issues = [];
  for (const [row, rowPath] of objectList(value, path, issues)) {
    for (const field of ["resource", "source", "breakingCheck"]) optionalString(row, field, rowPath, issues);
    validateErrors(row.errors, `${rowPath}.errors`, issues);
    const envelope = optionalObject(row, "errorEnvelope", rowPath, issues);
    if (envelope) requireFields(envelope, `${rowPath}.errorEnvelope`, ["code", "message", "errors", "requestId"], issues);
    validateIdempotency(row.idempotency, `${rowPath}.idempotency`, issues);
    validatePagination(row.pagination, `${rowPath}.pagination`, issues);
    const deprecation = optionalObject(row, "deprecation", rowPath, issues);
    if (deprecation) {
      requireFields(deprecation, `${rowPath}.deprecation`,
        ["announce", "sunset", "headers", "usageMetric", "removeWhen"], issues);
    }
    stringList(row.consumers, `${rowPath}.consumers`, issues);
  }
  return issues;
}

function idempotencyText(value, l) {
  if (!isObject(value)) return text(value);
  return [
    present(value.header) ? `${l.header}: ${value.header}` : "",
    value.required === true ? l.required : value.required === false ? l.optional : "",
    present(value.scope) ? `${l.scope}: ${text(value.scope)}` : "",
    present(value.retention) ? `${l.retention}: ${text(value.retention)}` : "",
    present(value.replay) ? `${l.replay}: ${text(value.replay)}` : "",
    present(value.inFlight) ? `${l.inFlight}: ${text(value.inFlight)}` : "",
    present(value.mismatch) ? `${l.mismatch}: ${text(value.mismatch)}` : "",
  ].filter(Boolean).join("; ");
}

function paginationText(value, l) {
  if (!isObject(value)) return text(value);
  return [
    ["style", value.style], ["order", value.order], ["defaultLimit", value.defaultLimit],
    ["maxLimit", value.maxLimit], ["filters", value.filters], ["sorts", value.sorts],
  ].filter(([, item]) => present(item)).map(([key, item]) => `${l[key]}: ${text(item)}`).join("; ");
}

function errorRows(errors, l) {
  const items = Array.isArray(errors) ? errors : present(errors) ? [errors] : [];
  return items.map((item) => {
    if (!isObject(item)) return ["", "", item, ""];
    const retryable = item.retryable === true ? l.yes : item.retryable === false ? l.no : "";
    const known = new Set(["status", "code", "when", "meaning", "retryable"]);
    const extra = Object.fromEntries(Object.entries(item).filter(([key]) => !known.has(key)));
    const when = [item.when ?? item.meaning, present(extra) ? text(extra) : ""].filter(present).join("; ");
    return [item.status, item.code, when, retryable];
  });
}

function envelopeExample(envelope) {
  return `\`\`\`json\n${JSON.stringify(envelope, null, 2)}\n\`\`\``;
}

function apiOperation(row, l) {
  const heading = `### ${cell(row.method)} ${cell(row.path)}`;
  const parts = [heading];
  if (present(row.purpose)) parts.push(text(row.purpose));
  const contract = partTable(l, [
    [l.resource, row.resource], [l.source, row.source], [l.breakingCheck, row.breakingCheck],
    [l.auth, row.auth], [l.request, row.request], [l.response, row.response],
    [l.idempotency, idempotencyText(row.idempotency, l)],
    [l.pagination, paginationText(row.pagination, l)], [l.rateLimit, row.rateLimit],
    [l.versioning, row.versioning], [l.compatibility, row.compatibility], [l.consumers, row.consumers],
  ]);
  if (contract) parts.push(contract);
  const errors = errorRows(row.errors, l);
  if (errors.length) parts.push(`**${l.errors}:**\n\n${table([l.status, l.code, l.when, l.retryable], errors)}`);
  if (isObject(row.errorEnvelope) && present(row.errorEnvelope)) {
    parts.push(`**${l.envelope}:**\n\n${envelopeExample(row.errorEnvelope)}`);
  }
  if (isObject(row.deprecation) && present(row.deprecation)) {
    const deprecation = partTable(l, [
      [l.announce, row.deprecation.announce], [l.sunset, row.deprecation.sunset],
      [l.headers, row.deprecation.headers], [l.usageMetric, row.deprecation.usageMetric],
      [l.removeWhen, row.deprecation.removeWhen],
    ]);
    if (deprecation) parts.push(`**${l.deprecation}:**\n\n${deprecation}`);
  } else if (present(row.deprecation)) {
    parts.push(`**${l.deprecation}:** ${cell(row.deprecation)}`);
  }
  return parts.join("\n\n");
}

export function renderApiContracts(value, { language } = {}) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const l = labels(language);
  return value.filter(isObject).map((row) => apiOperation(row, l)).join("\n\n");
}

// --- eventContracts -------------------------------------------------------

export function validateEventContracts(value, path = "eventContracts") {
  if (!present(value)) return [];
  const issues = [];
  for (const [row, rowPath] of objectList(value, path, issues)) {
    requireFields(row, rowPath,
      ["name", "version", "channel", "delivery", "dedupKey", "retry", "compatibility"], issues);
    stringList(row.consumers, `${rowPath}.consumers`, issues, { nonEmpty: true });
    if (row.consumerHandling !== undefined && row.consumerHandling !== null &&
        typeof row.consumerHandling !== "string" && !isObject(row.consumerHandling)) {
      issues.push(`${rowPath}.consumerHandling must be an object or text`);
    }
  }
  return issues;
}

function handlingText(value, l) {
  if (!isObject(value)) return text(value);
  const known = [["duplicates", "duplicates"], ["late", "late"], ["outOfOrder", "outOfOrder"]];
  const rows = known.filter(([field]) => present(value[field]))
    .map(([field, label]) => `${l[label]}: ${text(value[field])}`);
  const rest = Object.fromEntries(Object.entries(value).filter(([key]) => !known.some(([field]) => field === key)));
  if (present(rest)) rows.push(text(rest));
  return rows.join("; ");
}

function eventContract(row, l) {
  const heading = `### ${cell(row.name)}${present(row.version) ? ` v${text(row.version).replace(/^v/i, "")}` : ""}`;
  const body = partTable(l, [
    [l.channel, row.channel], [l.action, row.action], [l.payload, row.payload],
    [l.headers, row.headers], [l.delivery, row.delivery], [l.dedupKey, row.dedupKey],
    [l.orderingKey, row.orderingKey], [l.correlation, row.correlation], [l.retry, row.retry],
    [l.compatibility, row.compatibility], [l.consumers, row.consumers],
    [l.consumerHandling, handlingText(row.consumerHandling, l)],
  ]);
  return body ? `${heading}\n\n${body}` : heading;
}

export function renderEventContracts(value, { language } = {}) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const l = labels(language);
  return value.filter(isObject).map((row) => eventContract(row, l)).join("\n\n");
}

// --- shared helpers for data/ui/config -------------------------------------

function yesNo(value, l) {
  return value === true ? l.on : value === false ? l.off : value;
}

function boolField(row, field, path, issues) {
  if (row[field] !== undefined && row[field] !== null && typeof row[field] !== "boolean") {
    issues.push(`${path}.${field} must be true or false`);
  }
}

function textOrObject(row, field, path, issues) {
  const value = row[field];
  if (value === undefined || value === null || typeof value === "string" || isObject(value)) return;
  issues.push(`${path}.${field} must be an object or text`);
}

function facts(rows) {
  return rows.filter(([, value]) => present(value))
    .map(([label, value]) => `- **${label}:** ${cell(value)}`).join("\n");
}

// A column marked optional renders only when some row supplies it.
function fieldTable(columns, rows) {
  const shown = columns.filter(([, field, optional]) => !optional || rows.some((row) => present(row?.[field])));
  return table(shown.map(([label]) => label), rows.map((row) => shown.map(([, field, , format]) =>
    (format ? format(row?.[field]) : row?.[field]))));
}

function join(parts) {
  return parts.filter(Boolean).join("\n\n");
}

// --- dataModel ------------------------------------------------------------

const PHASES = Object.freeze(["expand", "migrate", "contract"]);
const CARDINALITY = Object.freeze({
  "one-to-one": "||--||", "one-to-many": "||--o{", "many-to-one": "}o--||", "many-to-many": "}o--o{",
});

function entityName(row) {
  return row?.name ?? row?.entity;
}

// The older array shape lists entities directly; the object form wraps them
// with the store, owner, migration phases, recovery, and data contract.
function dataModelParts(value) {
  if (Array.isArray(value)) return { entities: value, model: {} };
  if (isObject(value)) return { entities: Array.isArray(value.entities) ? value.entities : [], model: value };
  return { entities: [], model: {} };
}

function validateRelations(value, path, issues) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list`);
    return;
  }
  value.forEach((relation, index) => {
    const at = `${path}[${index}]`;
    if (typeof relation === "string") {
      if (!/(--|\.\.)/.test(relation)) issues.push(`${at} must be a Mermaid ER relationship or an object`);
      return;
    }
    if (!isObject(relation)) {
      issues.push(`${at} must be an object or text`);
      return;
    }
    requireFields(relation, at, ["to", "cardinality"], issues);
    if (present(relation.cardinality) && !CARDINALITY[relation.cardinality]) {
      issues.push(`${at}.cardinality must be one of ${Object.keys(CARDINALITY).join(", ")}`);
    }
  });
}

function validateMigrationPhases(value, path, issues) {
  // The older shape described migration per entity as text; keep it valid.
  if (value === undefined || value === null || typeof value === "string") return;
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list of phases or text`);
    return;
  }
  for (const [row, at] of objectList(value, path, issues)) {
    requireFields(row, at, ["phase", "action", "reversible"], issues);
    if (present(row.phase) && !PHASES.includes(row.phase)) issues.push(`${at}.phase must be one of ${PHASES.join(", ")}`);
    boolField(row, "reversible", at, issues);
  }
}

function validateEntity(row, path, issues, { named }) {
  if (named && !present(entityName(row))) issues.push(`${path}.name is required`);
  validateRelations(row.relations, `${path}.relations`, issues);
  for (const [column, at] of objectList(row.columns, `${path}.columns`, issues)) {
    requireFields(column, at, ["name", "type", "nullable", "change"], issues);
    boolField(column, "nullable", at, issues);
  }
  for (const [index, at] of objectList(row.indexes, `${path}.indexes`, issues)) {
    requireFields(index, at, ["name"], issues);
    stringList(index.columns, `${at}.columns`, issues, { nonEmpty: true });
    boolField(index, "unique", at, issues);
    boolField(index, "online", at, issues);
  }
  stringList(row.invariants, `${path}.invariants`, issues);
  validateMigrationPhases(row.migration, `${path}.migration`, issues);
}

export function validateDataModel(value, path = "dataModel") {
  if (!present(value)) return [];
  const issues = [];
  if (!Array.isArray(value) && !isObject(value)) return [`${path} must be a list or an object`];
  if (Array.isArray(value)) {
    for (const [row, at] of objectList(value, path, issues)) validateEntity(row, at, issues, { named: false });
    return issues;
  }
  for (const field of ["store", "owner"]) optionalString(value, field, path, issues);
  if (value.entities !== undefined && !Array.isArray(value.entities)) issues.push(`${path}.entities must be a list`);
  for (const [row, at] of objectList(Array.isArray(value.entities) ? value.entities : [], `${path}.entities`, issues)) {
    validateEntity(row, at, issues, { named: true });
  }
  validateMigrationPhases(value.migration, `${path}.migration`, issues);
  textOrObject(value, "recovery", path, issues);
  const contract = optionalObject(value, "dataContract", path, issues);
  if (contract) {
    requireFields(contract, `${path}.dataContract`, ["freshness", "frequency", "retention"], issues);
    stringList(contract.qualityRules, `${path}.dataContract.qualityRules`, issues);
  }
  return issues;
}

function erName(name) {
  return text(name).replace(/[^\w-]+/g, "_") || "entity";
}

function erDiagram(entities) {
  const lines = entities.flatMap((row) => (Array.isArray(row.relations) ? row.relations : []).map((relation) => {
    if (typeof relation === "string") return relation.trim();
    if (!isObject(relation) || !CARDINALITY[relation.cardinality]) return "";
    const label = text(relation.label ?? relation.via ?? "relates").replaceAll('"', "'");
    return `${erName(entityName(row))} ${CARDINALITY[relation.cardinality]} ${erName(relation.to)} : "${label}"`;
  })).filter(Boolean);
  return lines.length ? `\`\`\`mermaid\nerDiagram\n${lines.map((line) => `  ${line}`).join("\n")}\n\`\`\`` : "";
}

function phaseTable(phases, l) {
  return fieldTable([[l.phase, "phase"], [l.action, "action"], [l.reversible, "reversible", false,
    (value) => yesNo(value, l)], [l.task, "task", true]], phases.filter(isObject));
}

function dataEntity(row, l) {
  const parts = [`### ${cell(entityName(row))}`];
  if (Array.isArray(row.columns) && row.columns.length) {
    parts.push(fieldTable([
      [l.column, "name"], [l.type, "type"], [l.nullable, "nullable", false, (value) => yesNo(value, l)],
      [l.default, "default", true], [l.constraint, "constraint", true], [l.dataClass, "dataClass", true],
      [l.change, "change"],
    ], row.columns.filter(isObject)));
  }
  if (Array.isArray(row.fields) && row.fields.some(isObject)) {
    parts.push(table([l.field, l.type, l.constraints],
      row.fields.map((field) => (isObject(field) ? [field.name, field.type, field.constraints] : [field, "", ""]))));
  } else if (Array.isArray(row.fields)) {
    parts.push(row.fields.map((field) => `- ${cell(field)}`).join("\n"));
  } else if (present(row.fields)) {
    parts.push(`- ${cell(row.fields)}`);
  }
  if (Array.isArray(row.indexes) && row.indexes.length) {
    parts.push(fieldTable([
      [l.index, "name"], [l.columns, "columns"], [l.unique, "unique", true, (value) => yesNo(value, l)],
      [l.where, "where", true], [l.online, "online", true, (value) => yesNo(value, l)], [l.reason, "reason", true],
    ], row.indexes.filter(isObject)));
  }
  const phases = Array.isArray(row.migration) ? row.migration : [];
  parts.push(facts([
    [l.invariants, row.invariants], [l.volume, row.volume], [l.keepFor, row.retention],
    [l.migration, phases.length ? "" : row.migration], [l.rollback, row.rollback],
  ]));
  if (phases.length) parts.push(`**${l.migrationPhases}:**\n\n${phaseTable(phases, l)}`);
  return join(parts);
}

function recoveryText(value, l) {
  if (!isObject(value)) return `**${l.recovery}:** ${cell(value)}`;
  const known = [["backup", value.backup], ["rpo", value.rpo], ["rto", value.rto], ["restoreTest", value.restoreTest]];
  const rest = Object.fromEntries(Object.entries(value).filter(([key]) => !known.some(([field]) => field === key)));
  const lines = facts([...known.map(([field, item]) => [l[field], item]), [l.recovery, present(rest) ? rest : ""]]);
  return lines ? `**${l.recovery}:**\n\n${lines}` : "";
}

export function renderDataModel(value, { language } = {}) {
  if (!present(value)) return "";
  const l = labels(language);
  const { entities, model } = dataModelParts(value);
  const rows = entities.filter(isObject);
  const phases = Array.isArray(model.migration) ? model.migration : [];
  const contract = isObject(model.dataContract) ? model.dataContract : null;
  return join([
    facts([[l.store, model.store], [l.owner, model.owner]]),
    erDiagram(rows),
    ...rows.map((row) => dataEntity(row, l)),
    phases.length ? `**${l.migrationPhases}:**\n\n${phaseTable(phases, l)}` : "",
    present(model.recovery) ? recoveryText(model.recovery, l) : "",
    contract && present(contract) ? `**${l.dataContract}:**\n\n${facts([
      [l.freshness, contract.freshness], [l.frequency, contract.frequency],
      [l.qualityRules, contract.qualityRules], [l.keepFor, contract.retention], [l.endOfLife, contract.endOfLife],
    ])}` : "",
  ]);
}

// --- ui -------------------------------------------------------------------

const A11Y_KINDS = Object.freeze(["standard", "convention", "heuristic"]);

export function validateUi(value, path = "ui") {
  if (!present(value)) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  for (const field of ["surface", "designRef"]) optionalString(value, field, path, issues);
  for (const field of ["users", "platforms", "languages", "entryInfo"]) stringList(value[field], `${path}.${field}`, issues);
  if (value.flow !== undefined && typeof value.flow !== "string") stringList(value.flow, `${path}.flow`, issues);
  for (const [state, at] of objectList(value.states, `${path}.states`, issues)) {
    requireFields(state, at, ["key", "shows", "next"], issues);
    optionalString(state, "scenario", at, issues);
  }
  if (value.preserveInput !== undefined && value.preserveInput !== null &&
      typeof value.preserveInput !== "boolean" && typeof value.preserveInput !== "string") {
    issues.push(`${path}.preserveInput must be true, false, or text`);
  }
  const i18n = optionalObject(value, "i18n", path, issues);
  if (i18n) requireFields(i18n, `${path}.i18n`, ["formats", "timezone", "bidi"], issues);
  const a11y = optionalObject(value, "accessibility", path, issues);
  if (a11y) {
    const rows = objectList(a11y.rows, `${path}.accessibility.rows`, issues);
    if (!present(a11y.rows)) issues.push(`${path}.accessibility.rows is required`);
    for (const [row, at] of rows) {
      requireFields(row, at, ["criterion", "kind", "how", "check"], issues);
      if (present(row.kind) && !A11Y_KINDS.includes(row.kind)) issues.push(`${at}.kind must be one of ${A11Y_KINDS.join(", ")}`);
    }
    if (rows.some(([row]) => row.kind === "standard") && !present(a11y.standard)) {
      issues.push(`${path}.accessibility.standard is required when a row is kind standard`);
    }
    stringList(a11y.untested, `${path}.accessibility.untested`, issues);
  }
  for (const [component, at] of objectList(value.components, `${path}.components`, issues)) {
    requireFields(component, at, ["name", "change"], issues);
  }
  const plan = optionalObject(value, "validation", path, issues);
  if (plan) requireFields(plan, `${path}.validation`, ["method", "participants", "task", "pass", "severity"], issues);
  return issues;
}

function i18nText(value, l) {
  if (!isObject(value)) return `**${l.i18n}:** ${cell(value)}`;
  return `**${l.i18n}:**\n\n${facts([
    [l.formats, value.formats], [l.timezone, value.timezone], [l.bidi, yesNo(value.bidi, l)],
    [l.collation, value.collation], [l.expansion, value.expansion], [l.translationSource, value.source],
  ])}`;
}

function accessibilityText(value, l) {
  if (!isObject(value)) return `**${l.accessibility}:** ${cell(value)}`;
  const rows = Array.isArray(value.rows) ? value.rows.filter(isObject) : [];
  return join([
    `**${l.accessibility}:**${present(value.standard) ? ` ${cell(value.standard)}` : ""}`,
    rows.length ? table([l.criterion, l.kind, l.how, l.check],
      rows.map((row) => [row.criterion, l.kinds[row.kind] ?? row.kind, row.how, row.check])) : "",
    present(value.untested) ? `- **${l.untested}:** ${cell(value.untested)}` : "",
  ]);
}

function validationPlanText(value, l) {
  if (!isObject(value)) return `**${l.validationPlan}:** ${cell(value)}`;
  const line = [["method", value.method], ["participants", value.participants], ["task", value.task],
    ["pass", value.pass], ["severity", value.severity]].filter(([, item]) => present(item))
    .map(([key, item]) => `${key === "task" ? l.task.toLowerCase() : l[key]}: ${cell(item)}`).join("; ");
  return `**${l.validationPlan}:** ${line}`;
}

export function renderUi(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const states = Array.isArray(value.states) ? value.states.filter(isObject) : [];
  const components = Array.isArray(value.components) ? value.components.filter(isObject) : [];
  return join([
    facts([
      [l.surface, value.surface], [l.users, value.users], [l.platforms, value.platforms],
      [l.languages, value.languages], [l.designRef, value.designRef], [l.entryInfo, value.entryInfo],
      [l.flow, Array.isArray(value.flow) ? value.flow.join(" → ") : value.flow],
    ]),
    states.length ? `**${l.states}:**\n\n${fieldTable([[l.state, "key"], [l.shows, "shows"], [l.next, "next"],
      [l.scenario, "scenario", true]], states)}` : "",
    present(value.preserveInput) ? `- **${l.preserveInput}:** ${cell(yesNo(value.preserveInput, l))}` : "",
    present(value.i18n) ? i18nText(value.i18n, l) : "",
    present(value.accessibility) ? accessibilityText(value.accessibility, l) : "",
    facts([[l.acr, value.acr], [l.responsive, value.responsive]]),
    components.length ? `**${l.components}:**\n\n${table([l.component, l.change],
      components.map((row) => [row.name, row.change]))}` : "",
    present(value.validation) ? validationPlanText(value.validation, l) : "",
  ]);
}

// --- configContract -------------------------------------------------------

export function validateConfigContract(value, path = "configContract") {
  if (!present(value)) return [];
  const issues = [];
  for (const [row, at] of objectList(value, path, issues)) {
    for (const field of ["type", "reload", "owner", "removalTask"]) optionalString(row, field, at, issues);
    boolField(row, "secret", at, issues);
    textOrObject(row, "perEnvironment", at, issues);
  }
  return issues;
}

export function renderConfigContract(value, { language } = {}) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const l = labels(language);
  return table(
    [l.key, l.type, l.default, l.validation, l.secret, l.perEnvironment, l.reload, l.owner, l.removalTask],
    value.filter(isObject).map((row) => [row.key, row.type, row.default, row.validation, yesNo(row.secret, l),
      row.perEnvironment ?? row.scope, row.reload, row.owner, row.removalTask]),
  );
}

export const CONTRACT_FIELDS = Object.freeze({
  apiContracts: Object.freeze({ validate: validateApiContracts, render: renderApiContracts }),
  eventContracts: Object.freeze({ validate: validateEventContracts, render: renderEventContracts }),
  dataModel: Object.freeze({ validate: validateDataModel, render: renderDataModel }),
  ui: Object.freeze({ validate: validateUi, render: renderUi }),
  configContract: Object.freeze({ validate: validateConfigContract, render: renderConfigContract }),
});
