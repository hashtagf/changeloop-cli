// Typed proposal fields for the change process: the user decision log,
// communication and support, the release note, the demo steps, and the
// opt-in compliance change record (rendered as an archive appendix). Each
// field exposes validate (path-prefixed issues) and render (markdown body
// without the section heading, "" when empty).

const LABELS = Object.freeze({
  en: {
    date: "Date", question: "Question", options: "Options", answer: "Answer", by: "By",
    recommended: "recommended", audience: "Audience", channel: "Channel", when: "When",
    owner: "Support owner", supportRunbook: "Support runbook", userDocs: "User docs",
    added: "Added", changed: "Changed", deprecated: "Deprecated", removed: "Removed",
    fixed: "Fixed", security: "Security", item: "Item", value: "Value",
    requester: "Requester", approver: "Approver", implementer: "Implementer",
    approvedBefore: "Approved before", window: "Change window", emergency: "Emergency",
    retrospectiveApproval: "Retrospective approval", yes: "yes", no: "no",
  },
  th: {
    date: "วันที่", question: "คำถาม", options: "ตัวเลือก", answer: "คำตอบ", by: "ผู้ตอบ",
    recommended: "แนะนำ", audience: "ผู้รับสาร", channel: "ช่องทาง", when: "เวลา",
    owner: "เจ้าของงานซัพพอร์ต", supportRunbook: "Runbook ซัพพอร์ต", userDocs: "เอกสารผู้ใช้",
    added: "เพิ่ม", changed: "เปลี่ยน", deprecated: "เลิกแนะนำ", removed: "นำออก",
    fixed: "แก้ไข", security: "ความปลอดภัย", item: "รายการ", value: "ค่า",
    requester: "ผู้ขอ", approver: "ผู้อนุมัติ", implementer: "ผู้ทำ",
    approvedBefore: "อนุมัติก่อน", window: "ช่วงเวลาเปลี่ยนแปลง", emergency: "เร่งด่วน",
    retrospectiveApproval: "อนุมัติย้อนหลัง", yes: "ใช่", no: "ไม่",
  },
});

const RELEASE_CATEGORIES = Object.freeze(["added", "changed", "deprecated", "removed", "fixed", "security"]);
const COMPLIANCE_KEYS = Object.freeze([
  "requester", "approver", "implementer", "approvedBefore", "window", "emergency", "retrospectiveApproval",
]);

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

function optionalString(row, path, field, issues) {
  if (row[field] !== undefined && (typeof row[field] !== "string" || row[field].trim() === ""))
    issues.push(`${path}.${field} must be a non-empty string when present`);
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
    if (typeof item !== "string" || item.trim() === "") issues.push(`${path}[${index}] must be a non-empty string`);
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

function bullets(items) {
  return items.map((item) => `- ${text(item).replace(/\r?\n/g, " ")}`).join("\n");
}

// --- decisionLog -------------------------------------------------------

export function validateDecisionLog(value, path = "decisionLog") {
  const issues = [];
  for (const [row, rowPath] of rowList(value, path, issues)) {
    requireFields(row, rowPath, ["date", "question", "answer", "by"], issues);
    stringList(row.options, `${rowPath}.options`, issues, { nonEmpty: true });
    optionalString(row, rowPath, "recommendation", issues);
  }
  return issues;
}

export function renderDecisionLog(value, { language } = {}) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const l = labels(language);
  return table([l.date, l.question, l.options, l.answer, l.by], value.filter(isObject).map((row) => {
    const recommendation = present(row.recommendation) ? text(row.recommendation) : null;
    const options = (Array.isArray(row.options) ? row.options : [row.options]).filter(present).map(text);
    if (recommendation && !options.includes(recommendation)) options.push(recommendation);
    const shown = options.map((option) => (option === recommendation ? `${option} (${l.recommended})` : option));
    return [row.date, row.question, shown.join("; "), row.answer, row.by];
  }));
}

// --- communication -----------------------------------------------------

function communicationParts(value) {
  if (Array.isArray(value)) return { rows: value };
  return isObject(value) ? value : {};
}

export function validateCommunication(value, path = "communication") {
  if (value === undefined || value === null) return [];
  const issues = [];
  if (!Array.isArray(value) && !isObject(value)) return [`${path} must be a list or an object`];
  const parts = communicationParts(value);
  const rowsPath = Array.isArray(value) ? path : `${path}.rows`;
  for (const [row, rowPath] of rowList(parts.rows, rowsPath, issues))
    requireFields(row, rowPath, ["audience", "channel", "when"], issues);
  if (!Array.isArray(value)) {
    if (!present(parts.rows) && !present(parts.owner) && !present(parts.supportRunbook) && !present(parts.userDocs))
      issues.push(`${path} must name rows, owner, supportRunbook, or userDocs`);
    optionalString(parts, path, "owner", issues);
    optionalString(parts, path, "supportRunbook", issues);
    stringList(parts.userDocs, `${path}.userDocs`, issues);
  }
  return issues;
}

export function renderCommunication(value, { language } = {}) {
  const parts = communicationParts(value);
  const l = labels(language);
  const blocks = [];
  const rows = Array.isArray(parts.rows) ? parts.rows.filter(isObject) : [];
  if (rows.length > 0)
    blocks.push(table([l.audience, l.channel, l.when], rows.map((row) => [row.audience, row.channel, row.when])));
  const notes = [];
  if (present(parts.owner)) notes.push(`${l.owner}: ${text(parts.owner)}`);
  if (present(parts.supportRunbook)) notes.push(`${l.supportRunbook}: ${text(parts.supportRunbook)}`);
  if (present(parts.userDocs)) notes.push(`${l.userDocs}: ${text(parts.userDocs)}`);
  if (notes.length > 0) blocks.push(bullets(notes));
  return blocks.join("\n\n");
}

// --- releaseNote -------------------------------------------------------

export function validateReleaseNote(value, path = "releaseNote") {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value.trim() === "" ? [`${path} must not be empty`] : [];
  if (!isObject(value)) return [`${path} must be text or an object of Keep a Changelog categories`];
  const issues = [];
  for (const key of Object.keys(value)) {
    if (!RELEASE_CATEGORIES.includes(key)) {
      issues.push(`${path}.${key} is not a release-note category (${RELEASE_CATEGORIES.join(", ")})`);
      continue;
    }
    const entry = value[key];
    if (typeof entry === "string") {
      if (entry.trim() === "") issues.push(`${path}.${key} must not be empty`);
    } else stringList(entry, `${path}.${key}`, issues, { nonEmpty: true });
  }
  if (!RELEASE_CATEGORIES.some((key) => present(value[key])))
    issues.push(`${path} must name at least one category (${RELEASE_CATEGORIES.join(", ")})`);
  return issues;
}

export function renderReleaseNote(value, { language } = {}) {
  if (typeof value === "string") return value.trim();
  if (!isObject(value)) return "";
  const l = labels(language);
  return RELEASE_CATEGORIES.filter((key) => present(value[key])).map((key) => {
    const entries = (Array.isArray(value[key]) ? value[key] : [value[key]]).filter(present);
    return `**${l[key]}**\n\n${bullets(entries)}`;
  }).join("\n\n");
}

// --- demo --------------------------------------------------------------

export function validateDemo(value, path = "demo") {
  if (value === undefined || value === null) return [];
  const issues = [];
  stringList(value, path, issues, { nonEmpty: true });
  return issues;
}

export function renderDemo(value) {
  if (!Array.isArray(value)) return "";
  return value.filter(present).map((step, index) => `${index + 1}. ${text(step).replace(/\r?\n/g, " ")}`).join("\n");
}

// --- compliance --------------------------------------------------------

function sameParty(left, right) {
  return present(left) && present(right) && text(left).toLowerCase() === text(right).toLowerCase();
}

export function validateCompliance(value, path = "compliance", { enabled = false } = {}) {
  if (value === undefined || value === null) return enabled ? [`${path} is required when compliance is enabled`] : [];
  if (!isObject(value)) return [`${path} must be an object`];
  const issues = [];
  if (enabled) requireFields(value, path, ["requester", "approver"], issues);
  for (const field of ["requester", "approver", "implementer", "window", "retrospectiveApproval"])
    optionalString(value, path, field, issues);
  if (value.emergency !== undefined && typeof value.emergency !== "boolean")
    issues.push(`${path}.emergency must be true or false`);
  if (sameParty(value.approver, value.implementer))
    issues.push(`${path}.approver must differ from ${path}.implementer`);
  if (value.emergency === true) {
    if (!present(value.retrospectiveApproval))
      issues.push(`${path}.retrospectiveApproval is required for an emergency change`);
  } else if (value.approvedBefore !== "build" && (enabled || value.approvedBefore !== undefined)) {
    issues.push(`${path}.approvedBefore must be "build" unless ${path}.emergency is true`);
  }
  for (const key of Object.keys(value)) {
    if (!COMPLIANCE_KEYS.includes(key)) issues.push(`${path}.${key} is not a compliance field`);
  }
  return issues;
}

// The one routed action for a compliance problem: a missing approver is a real
// user decision (asked once); every other repair is agent work. Never ownerless.
export function complianceAction(value, { enabled = false, path = "compliance" } = {}) {
  const issues = validateCompliance(value, path, { enabled });
  if (issues.length === 0) return null;
  const approver = isObject(value) ? value.approver : undefined;
  if (enabled && !present(approver)) {
    return {
      owner: "user",
      kind: "ask",
      field: `${path}.approver`,
      question: "Compliance is enabled for this repository. Who approves this change before Build? The approver must not be the implementer.",
    };
  }
  return { owner: "agent", kind: "edit", issues };
}

export function renderComplianceRecord(value, { language } = {}) {
  if (!isObject(value) || !present(value)) return "";
  const l = labels(language);
  const rows = COMPLIANCE_KEYS.filter((key) => key === "emergency" ? typeof value.emergency === "boolean" : present(value[key]))
    .map((key) => [l[key], key === "emergency" ? (value.emergency ? l.yes : l.no) : value[key]]);
  return rows.length === 0 ? "" : table([l.item, l.value], rows);
}

export const renderCompliance = renderComplianceRecord;

// openspec/config.yaml opts into the compliance change record with a top-level
// `compliance: change-record` (or `true`/`enabled`). Any other value, or no
// key, leaves it off.
export function complianceEnabledFromConfig(configText) {
  const match = String(configText || "").match(/^compliance:[ \t]*([^\s#]+)[ \t]*(?:#.*)?$/m);
  return Boolean(match) && ["change-record", "true", "enabled"]
    .includes(match[1].replace(/^["']|["']$/g, "").toLowerCase());
}

// --- archive-only appendices ------------------------------------------------

const ARCHIVE_LABELS = Object.freeze({
  en: {
    round: "Round", finding: "Finding", severity: "Severity", fix: "Fix", reviewer: "Reviewer",
    none: "No findings", open: "open", verified: "verified in round", resolved: "resolved by round",
    provider: "Provider", capability: "Capability", status: "Status", phase: "Phase",
    deferred: "deferred: post-release evidence gates the rollout, not proof or Land",
    approval: "Spec approval decision",
  },
  th: {
    round: "รอบ", finding: "ข้อค้นพบ", severity: "ความรุนแรง", fix: "การแก้ไข", reviewer: "ผู้ review",
    none: "ไม่มีข้อค้นพบ", open: "ยังเปิดอยู่", verified: "ยืนยันการแก้ในรอบ", resolved: "แก้แล้วในรอบ",
    provider: "Provider", capability: "Capability", status: "สถานะ", phase: "ช่วง",
    deferred: "deferred: หลักฐานหลังปล่อยเป็น gate ของ rollout ไม่ใช่ของ proof หรือ Land",
    approval: "การอนุมัติ spec",
  },
});

function archiveLabels(language) {
  return language === "th" ? ARCHIVE_LABELS.th : ARCHIVE_LABELS.en;
}

function findingText(finding) {
  const where = finding.path ? ` (${finding.path}${finding.line ? `:${finding.line}` : ""})` : "";
  return `${finding.id ? `${finding.id}: ` : ""}${text(finding.message)}${where}`;
}

// The review record: one row per finding of every completed review attempt,
// with the round that fixed it (a later attempt that verified its id, or the
// first later attempt that no longer reports it). "" when no review ran.
export function renderReviewRecord(attempts, { language } = {}) {
  const l = archiveLabels(language);
  const completed = (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => isObject(attempt) && attempt.status === "completed")
    .sort((a, b) => Number(a.attempt || 0) - Number(b.attempt || 0));
  if (completed.length === 0) return "";
  const reviewer = (attempt) => attempt.reviewerIdentity || attempt.reviewerModelId || attempt.reviewerType;
  const rows = [];
  completed.forEach((attempt, index) => {
    for (const finding of Array.isArray(attempt.findings) ? attempt.findings : []) {
      const later = completed.slice(index + 1);
      const verified = later.find((next) => (next.verifiedFindingIds || []).includes(finding.id));
      const resolved = verified ? null : later.find((next) =>
        !(next.findings || []).some((other) => other.id === finding.id));
      const fix = verified ? `${l.verified} ${verified.attempt}`
        : resolved ? `${l.resolved} ${resolved.attempt}` : l.open;
      rows.push([attempt.attempt, findingText(finding), finding.severity, fix, reviewer(attempt)]);
    }
  });
  if (rows.length === 0) {
    const last = completed.at(-1);
    rows.push([last.attempt, l.none, "", "", reviewer(last)]);
  }
  return table([l.round, l.finding, l.severity, l.fix, l.reviewer], rows);
}

// Deferred post-release provider gates (release health, experiment
// guardrails): visible after Land without ever blocking proof or Land.
export function renderRolloutGates(gates, { language } = {}) {
  const rows = (Array.isArray(gates) ? gates : []).filter(isObject);
  if (rows.length === 0) return "";
  const l = archiveLabels(language);
  return `${table([l.provider, l.capability, l.phase, l.status],
    rows.map((gate) => [gate.provider, gate.capability, gate.phase || "post-release", gate.status || "deferred"]))}` +
    `\n\n${l.deferred}`;
}

// The compliance change record plus the recorded spec-approval decision.
export function renderComplianceChangeRecord(value, { language, approvalRef } = {}) {
  const record = renderComplianceRecord(value, { language });
  const approval = present(approvalRef) ? `${archiveLabels(language).approval}: \`${text(approvalRef)}\`` : "";
  return [record, approval].filter(Boolean).join("\n\n");
}

export const PROCESS_FIELDS = Object.freeze({
  decisionLog: Object.freeze({ validate: validateDecisionLog, render: renderDecisionLog }),
  communication: Object.freeze({ validate: validateCommunication, render: renderCommunication }),
  releaseNote: Object.freeze({ validate: validateReleaseNote, render: renderReleaseNote }),
  demo: Object.freeze({ validate: validateDemo, render: renderDemo }),
  compliance: Object.freeze({ validate: validateCompliance, render: renderComplianceRecord }),
});
