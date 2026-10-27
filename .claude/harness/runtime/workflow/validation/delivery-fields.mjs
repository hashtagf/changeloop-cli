// Typed design fields for delivery: rollout and rollback (with KEP-style
// enablement answers, rollback proof, version skew, upgrade steps, maturity,
// and change window), test strategy, external dependencies, and data
// recovery. Each field exposes validate (path-prefixed issues) and render
// (markdown body without the section heading, "" when empty).

const LABELS = Object.freeze({
  en: {
    strategy: "Strategy", deployOrder: "Deploy order", gates: "Gates", rollbackTrigger: "Rollback trigger",
    rollback: "Rollback", rollbackProof: "Rollback proof", compatibilityWindow: "Compatibility window",
    changeWindow: "Change window", maturity: "Maturity", alpha: "Alpha", beta: "Beta", ga: "GA",
    enablement: "Enablement", question: "Question", answer: "Answer",
    qMechanism: "How is it enabled?", qDefaultChanges: "Does enabling change default behavior?",
    qCanDisable: "Can it be disabled once enabled?", qReenable: "What happens when re-enabled after rollback?",
    qDowntime: "Is downtime needed?", qTest: "Enable/disable test",
    versionSkew: "Version skew", combination: "Combination", works: "Works", note: "Note",
    upgradeSteps: "Upgrade steps", yes: "yes", no: "no",
    level: "Level", proves: "Proves", why: "Why", doubles: "Test doubles", replaces: "replaces",
    with: "with", gap: "gap", data: "Test data", environment: "Environment",
    realSurface: "Real-surface check", regression: "Failing-before regression", untested: "Not tested",
    name: "Dependency", type: "Type", need: "Need", before: "Needed before",
    backup: "Backup", rpo: "RPO", rto: "RTO", restoreTest: "Restore test", regionFailure: "Region failure",
  },
  th: {
    strategy: "กลยุทธ์", deployOrder: "ลำดับการ deploy", gates: "ด่านตรวจ", rollbackTrigger: "เงื่อนไขที่ต้อง rollback",
    rollback: "Rollback", rollbackProof: "หลักฐาน rollback", compatibilityWindow: "ช่วงที่เวอร์ชันเก่าและใหม่อยู่ร่วมกัน",
    changeWindow: "ช่วงเวลาเปลี่ยนแปลง", maturity: "ระดับความพร้อม", alpha: "Alpha", beta: "Beta", ga: "GA",
    enablement: "การเปิดปิด", question: "คำถาม", answer: "คำตอบ",
    qMechanism: "เปิดใช้งานอย่างไร", qDefaultChanges: "การเปิดใช้เปลี่ยนพฤติกรรมตั้งต้นหรือไม่",
    qCanDisable: "ปิดได้หลังเปิดแล้วหรือไม่", qReenable: "เกิดอะไรขึ้นเมื่อเปิดอีกครั้งหลัง rollback",
    qDowntime: "ต้องมี downtime หรือไม่", qTest: "การทดสอบเปิด/ปิด",
    versionSkew: "Version skew", combination: "ชุดเวอร์ชัน", works: "ใช้งานได้", note: "หมายเหตุ",
    upgradeSteps: "ขั้นตอน upgrade", yes: "ใช่", no: "ไม่",
    level: "ระดับ", proves: "พิสูจน์อะไร", why: "เหตุผล", doubles: "Test double", replaces: "แทน",
    with: "ด้วย", gap: "ช่องว่าง", data: "ข้อมูลทดสอบ", environment: "สภาพแวดล้อม",
    realSurface: "ตรวจบนพื้นผิวจริง", regression: "Regression ที่ล้มก่อนแก้", untested: "สิ่งที่ไม่ทดสอบ",
    name: "Dependency", type: "ประเภท", need: "สิ่งที่ต้องการ", before: "ต้องได้ก่อน",
    backup: "การสำรองข้อมูล", rpo: "RPO", rto: "RTO", restoreTest: "การทดสอบกู้คืน", regionFailure: "เมื่อ region ล่ม",
  },
});

const ENABLEMENT = Object.freeze([
  ["mechanism", "qMechanism", "text"],
  ["defaultChanges", "qDefaultChanges", "boolean"],
  ["canDisable", "qCanDisable", "boolean"],
  ["reenable", "qReenable", "text"],
  ["downtime", "qDowntime", "boolean"],
  ["test", "qTest", "text"],
]);
const SKEW_META = Object.freeze(["works", "note", "combination"]);

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

function yesNo(value, l) {
  return value === true ? l.yes : value === false ? l.no : cell(value);
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

function stringList(value, path, issues) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list of strings`);
    return;
  }
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

function bullet(label, value) {
  return present(value) ? `- ${label}: ${cell(value)}` : "";
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(present);
  return present(value) ? [value] : [];
}

// --- rollout --------------------------------------------------------------

function validateEnablement(value, path, issues) {
  if (value === undefined || value === null) return;
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  for (const [key, , kind] of ENABLEMENT) {
    if (kind === "boolean") {
      if (value[key] === undefined || value[key] === null) issues.push(`${path}.${key} is required`);
      else if (typeof value[key] !== "boolean") issues.push(`${path}.${key} must be true or false`);
    } else if (!present(value[key])) {
      issues.push(`${path}.${key} is required`);
    }
  }
}

function validateVersionSkew(value, path, issues) {
  for (const [row, rowPath] of objectList(value, path, issues)) {
    if (typeof row.works !== "boolean") issues.push(`${rowPath}.works must be true or false`);
    const components = Object.keys(row).filter((key) => !SKEW_META.includes(key));
    if (!present(row.combination) && components.length === 0) {
      issues.push(`${rowPath} must name a combination or component versions`);
    }
  }
}

export function validateRollout(value, path = "rollout", { impact } = {}) {
  if (!present(value)) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  requireFields(value, path, ["strategy", "rollback"], issues);
  stringList(value.deployOrder, `${path}.deployOrder`, issues);
  stringList(value.gates, `${path}.gates`, issues);
  validateEnablement(value.enablement, `${path}.enablement`, issues);
  validateVersionSkew(value.versionSkew, `${path}.versionSkew`, issues);
  if (value.upgradeSteps !== undefined && typeof value.upgradeSteps !== "string") {
    stringList(value.upgradeSteps, `${path}.upgradeSteps`, issues);
  }
  if (value.maturity !== undefined && value.maturity !== null) {
    if (!isObject(value.maturity)) issues.push(`${path}.maturity must be an object`);
    else {
      const unknown = Object.keys(value.maturity).filter((key) => !["alpha", "beta", "ga"].includes(key));
      for (const key of unknown) issues.push(`${path}.maturity.${key} is not a maturity stage (alpha, beta, ga)`);
    }
  }
  if (String(impact ?? "").toLowerCase() === "high" && !present(value.rollbackProof)) {
    issues.push(`${path}.rollbackProof is required for a high-impact change`);
  }
  return issues;
}

function renderSkew(rows, l) {
  const valid = rows.filter(isObject);
  if (valid.length === 0) return "";
  if (valid.every((row) => present(row.combination))) {
    const withNote = valid.some((row) => present(row.note));
    const headers = [l.combination, l.works, ...(withNote ? [l.note] : [])];
    return table(headers, valid.map((row) =>
      [row.combination, yesNo(row.works, l), ...(withNote ? [row.note] : [])]));
  }
  const components = [...new Set(valid.flatMap((row) => Object.keys(row).filter((key) => !SKEW_META.includes(key))))];
  const withNote = valid.some((row) => present(row.note));
  const headers = [...components, l.works, ...(withNote ? [l.note] : [])];
  return table(headers, valid.map((row) => [
    ...components.map((key) => row[key]), yesNo(row.works, l), ...(withNote ? [row.note] : []),
  ]));
}

export function renderRollout(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const parts = [];
  const lines = [
    bullet(l.strategy, value.strategy),
    present(value.deployOrder) ? `- ${l.deployOrder}: ${asList(value.deployOrder).map(cell).join(" → ")}` : "",
    bullet(l.gates, value.gates),
    bullet(l.rollbackTrigger, value.rollbackTrigger),
    bullet(l.rollback, value.rollback),
    bullet(l.rollbackProof, value.rollbackProof),
    bullet(l.compatibilityWindow, value.compatibilityWindow),
    isObject(value.maturity) && present(value.maturity)
      ? `- ${l.maturity}: ${["alpha", "beta", "ga"].filter((key) => present(value.maturity[key]))
        .map((key) => `${l[key]}: ${cell(value.maturity[key])}`).join("; ")}`
      : "",
    bullet(l.changeWindow, value.changeWindow),
  ].filter(Boolean);
  if (lines.length > 0) parts.push(lines.join("\n"));
  if (isObject(value.enablement) && present(value.enablement)) {
    parts.push(`**${l.enablement}**\n\n${table([l.question, l.answer], ENABLEMENT.map(([key, question, kind]) =>
      [l[question], kind === "boolean" ? yesNo(value.enablement[key], l) : value.enablement[key]]))}`);
  }
  if (Array.isArray(value.versionSkew)) {
    const skew = renderSkew(value.versionSkew, l);
    if (skew) parts.push(`**${l.versionSkew}**\n\n${skew}`);
  }
  const steps = asList(value.upgradeSteps);
  if (steps.length > 0) {
    parts.push(`**${l.upgradeSteps}**\n\n${steps.map((step, index) => `${index + 1}. ${cell(step)}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

// --- testStrategy ---------------------------------------------------------

export function validateTestStrategy(value, path = "testStrategy") {
  if (!present(value)) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  if (!Array.isArray(value.levels) || value.levels.length === 0) {
    issues.push(`${path}.levels must list at least one level`);
  } else {
    for (const [row, rowPath] of objectList(value.levels, `${path}.levels`, issues)) {
      requireFields(row, rowPath, ["level", "proves", "why"], issues);
    }
  }
  for (const [row, rowPath] of objectList(value.doubles, `${path}.doubles`, issues)) {
    requireFields(row, rowPath, ["replaces", "with", "gap"], issues);
  }
  stringList(value.untested, `${path}.untested`, issues);
  return issues;
}

export function renderTestStrategy(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const parts = [];
  const levels = Array.isArray(value.levels) ? value.levels.filter(isObject) : [];
  if (levels.length > 0) {
    parts.push(table([l.level, l.proves, l.why], levels.map((row) => [row.level, row.proves, row.why])));
  }
  const doubles = Array.isArray(value.doubles) ? value.doubles.filter(isObject) : [];
  const lines = [
    doubles.length > 0
      ? `- ${l.doubles}: ${doubles.map((row) =>
        `${l.replaces} ${cell(row.replaces)} ${l.with} ${cell(row.with)} (${l.gap}: ${cell(row.gap)})`).join("; ")}`
      : "",
    bullet(l.data, value.data),
    bullet(l.environment, value.environment),
    bullet(l.realSurface, value.realSurface),
    bullet(l.regression, value.regression),
    bullet(l.untested, value.untested),
  ].filter(Boolean);
  if (lines.length > 0) parts.push(lines.join("\n"));
  return parts.join("\n\n");
}

// --- dependencies ---------------------------------------------------------

export function validateDependencies(value, path = "dependencies") {
  if (!present(value)) return [];
  const issues = [];
  for (const [row, rowPath] of objectList(value, path, issues)) {
    requireFields(row, rowPath, ["name", "need"], issues);
  }
  return issues;
}

export function renderDependencies(value, { language } = {}) {
  if (!Array.isArray(value)) return "";
  const rows = value.filter(isObject);
  if (rows.length === 0) return "";
  const l = labels(language);
  return table([l.name, l.type, l.need, l.before], rows.map((row) => [row.name, row.type, row.need, row.before]));
}

// --- recovery -------------------------------------------------------------

export function validateRecovery(value, path = "recovery") {
  if (!present(value)) return [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  requireFields(value, path, ["backup", "rpo", "rto", "restoreTest"], issues);
  return issues;
}

export function renderRecovery(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  return ["backup", "rpo", "rto", "restoreTest", "regionFailure"]
    .map((key) => bullet(l[key], value[key])).filter(Boolean).join("\n");
}

export const DELIVERY_FIELDS = Object.freeze({
  rollout: Object.freeze({ validate: validateRollout, render: renderRollout }),
  testStrategy: Object.freeze({ validate: validateTestStrategy, render: renderTestStrategy }),
  dependencies: Object.freeze({ validate: validateDependencies, render: renderDependencies }),
  recovery: Object.freeze({ validate: validateRecovery, render: renderRecovery }),
});
