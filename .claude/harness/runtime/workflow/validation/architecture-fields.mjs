// Typed design fields for architecture and domain: boundary decisions,
// tenancy isolation, and the domain model with its modules. Each field
// exposes validate (path-prefixed issues) and render (markdown body without
// the section heading, "" when empty).

const LABELS = Object.freeze({
  en: {
    boundary: "Boundary", mode: "Mode", why: "Why", timeoutRetry: "Timeout/retry",
    consistency: "Consistency", owner: "Owner", correlation: "Correlation",
    tenantKey: "Tenant key", tenantSource: "Tenant context source", layer: "Layer",
    isolation: "Isolation", noisyNeighbor: "Noisy-neighbor limits", metering: "Metering and cost",
    crossTenantTest: "Cross-tenant test", type: "Type", rule: "Rule", constructedAt: "Constructed at",
    illegalStates: "Illegal states", module: "Module", interface: "Interface", hides: "Hides",
    pure: "pure", injected: "Injected", expected: "Expected errors",
    infrastructure: "Infrastructure errors", bug: "Bug errors",
    stale: "staleness", via: "via", retry: "retry",
  },
  th: {
    boundary: "ขอบเขต", mode: "รูปแบบ", why: "เหตุผล", timeoutRetry: "Timeout/การลองใหม่",
    consistency: "ความสอดคล้อง", owner: "เจ้าของ", correlation: "Correlation",
    tenantKey: "คีย์ tenant", tenantSource: "ที่มาของ tenant context", layer: "ชั้น",
    isolation: "การแยก", noisyNeighbor: "ขีดจำกัด noisy-neighbor", metering: "การวัดและต้นทุน",
    crossTenantTest: "การทดสอบข้าม tenant", type: "Type", rule: "กฎ", constructedAt: "สร้างที่",
    illegalStates: "สถานะที่ห้ามเกิด", module: "Module", interface: "Interface", hides: "สิ่งที่ซ่อน",
    pure: "pure", injected: "สิ่งที่ฉีดเข้า", expected: "Error ที่คาดไว้",
    infrastructure: "Error ของโครงสร้างพื้นฐาน", bug: "Error ที่เป็น bug",
    stale: "ความล่าช้าที่ยอมรับ", via: "ผ่าน", retry: "ลองใหม่",
  },
});

const MODES = Object.freeze(["sync", "async"]);
const ERROR_GROUPS = Object.freeze(["expected", "infrastructure", "bug"]);

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

// --- boundaries -----------------------------------------------------------

export function validateBoundaries(value, path = "boundaries") {
  if (!present(value)) return [];
  const issues = [];
  for (const [row, rowPath] of objectList(value, path, issues)) {
    requireFields(row, rowPath, ["from", "to", "mode", "why", "retry", "consistency", "owner"], issues);
    if (present(row.mode) && !MODES.includes(row.mode)) {
      issues.push(`${rowPath}.mode must be one of ${MODES.join(", ")}`);
    }
    if (row.mode === "sync" && !present(row.timeout)) {
      issues.push(`${rowPath}.timeout is required for a sync boundary`);
    }
    if (String(row.consistency ?? "").trim().toLowerCase() === "eventual" && !present(row.staleness)) {
      issues.push(`${rowPath}.staleness is required for eventual consistency`);
    }
  }
  return issues;
}

export function renderBoundaries(value, { language } = {}) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const l = labels(language);
  const rows = value.filter(isObject).map((row) => {
    const boundary = `${text(row.from)} → ${text(row.to)}${present(row.via) ? ` (${l.via} ${text(row.via)})` : ""}`;
    const timeoutRetry = [present(row.timeout) ? text(row.timeout) : "",
      present(row.retry) ? `${l.retry}: ${text(row.retry)}` : ""].filter(Boolean).join("; ");
    const consistency = [text(row.consistency),
      present(row.staleness) ? `${l.stale}: ${text(row.staleness)}` : ""].filter(Boolean).join("; ");
    return [boundary, row.mode, row.why, timeoutRetry, consistency, row.owner];
  });
  if (rows.length === 0) return "";
  const body = table([l.boundary, l.mode, l.why, l.timeoutRetry, l.consistency, l.owner], rows);
  const correlations = [...new Set(value.filter((row) => isObject(row) && present(row.correlation))
    .map((row) => text(row.correlation)))];
  return correlations.length > 0 ? `${body}\n\n${l.correlation}: ${correlations.join(", ")}` : body;
}

// --- tenancy --------------------------------------------------------------

function layerParts(layer) {
  if (isObject(layer)) return [layer.layer ?? layer.name, layer.isolation ?? layer.mechanism];
  const raw = String(layer ?? "");
  const split = raw.indexOf(":");
  return split > 0 ? [raw.slice(0, split).trim(), raw.slice(split + 1).trim()] : [raw.trim(), ""];
}

export function validateTenancy(value, path = "tenancy") {
  if (!present(value)) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  requireFields(value, path, ["key", "source", "noisyNeighbor", "metering"], issues);
  if (!Array.isArray(value.layers) || value.layers.length === 0) {
    issues.push(`${path}.layers must list at least one layer`);
  } else {
    value.layers.forEach((layer, index) => {
      if (!present(layerParts(layer)[0])) issues.push(`${path}.layers[${index}] must name a layer`);
    });
  }
  return issues;
}

export function renderTenancy(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const lines = [];
  if (present(value.key)) lines.push(`- ${l.tenantKey}: ${cell(value.key)}`);
  if (present(value.source)) lines.push(`- ${l.tenantSource}: ${cell(value.source)}`);
  const parts = [];
  if (lines.length > 0) parts.push(lines.join("\n"));
  if (Array.isArray(value.layers) && value.layers.length > 0) {
    parts.push(table([l.layer, l.isolation], value.layers.map(layerParts)));
  }
  const tail = [];
  if (present(value.noisyNeighbor)) tail.push(`- ${l.noisyNeighbor}: ${cell(value.noisyNeighbor)}`);
  if (present(value.metering)) tail.push(`- ${l.metering}: ${cell(value.metering)}`);
  if (present(value.crossTenantTest)) tail.push(`- ${l.crossTenantTest}: ${cell(value.crossTenantTest)}`);
  if (tail.length > 0) parts.push(tail.join("\n"));
  return parts.join("\n\n");
}

// --- domain ---------------------------------------------------------------

export function validateDomain(value, path = "domain") {
  if (!present(value)) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  for (const [row, rowPath] of objectList(value.types, `${path}.types`, issues)) {
    requireFields(row, rowPath, ["name", "rule"], issues);
  }
  stringList(value.illegalStates, `${path}.illegalStates`, issues);
  for (const [row, rowPath] of objectList(value.modules, `${path}.modules`, issues)) {
    requireFields(row, rowPath, ["name", "exposes"], issues);
    stringList(row.hides, `${rowPath}.hides`, issues);
    if (row.pure !== undefined && typeof row.pure !== "boolean") {
      issues.push(`${rowPath}.pure must be true or false`);
    }
  }
  stringList(value.injected, `${path}.injected`, issues);
  if (value.errors !== undefined && value.errors !== null) {
    if (!isObject(value.errors)) {
      issues.push(`${path}.errors must be an object with expected, infrastructure, and bug`);
    } else {
      for (const group of ERROR_GROUPS) stringList(value.errors[group], `${path}.errors.${group}`, issues);
    }
  }
  return issues;
}

export function renderDomain(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const parts = [];
  const types = Array.isArray(value.types) ? value.types.filter(isObject) : [];
  if (types.length > 0) {
    const withConstructed = types.some((row) => present(row.constructedAt));
    const headers = withConstructed ? [l.type, l.rule, l.constructedAt] : [l.type, l.rule];
    parts.push(table(headers, types.map((row) =>
      withConstructed ? [row.name, row.rule, row.constructedAt] : [row.name, row.rule])));
  }
  if (present(value.illegalStates)) parts.push(`${l.illegalStates}: ${cell(value.illegalStates)}`);
  const modules = Array.isArray(value.modules) ? value.modules.filter(isObject) : [];
  if (modules.length > 0) {
    parts.push(table([l.module, l.interface, l.hides], modules.map((row) =>
      [`${text(row.name)}${row.pure === true ? ` (${l.pure})` : ""}`, row.exposes, row.hides])));
  }
  if (present(value.injected)) parts.push(`${l.injected}: ${cell(value.injected)}`);
  if (isObject(value.errors)) {
    const groups = ERROR_GROUPS.filter((group) => present(value.errors[group]))
      .map((group) => `- ${l[group]}: ${cell(value.errors[group])}`);
    if (groups.length > 0) parts.push(groups.join("\n"));
  }
  return parts.join("\n\n");
}

export const ARCHITECTURE_FIELDS = Object.freeze({
  boundaries: Object.freeze({ validate: validateBoundaries, render: renderBoundaries }),
  tenancy: Object.freeze({ validate: validateTenancy, render: renderTenancy }),
  domain: Object.freeze({ validate: validateDomain, render: renderDomain }),
});
