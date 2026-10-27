// Outline contract: the one place that names every section of a change
// packet (proposal, design, spec, tasks), its reader order, the draft fields
// that feed it, who writes it, and when it is included. Renderers and
// validators read this table instead of keeping their own section lists.
//
// Source: openspec/investigations/change-doc-outline.md, adjusted by the
// change's decisions: data that changes after approval (status, approvers,
// evidence freshness, review results) never renders before Land, so the
// header carries only stable facts and the review and compliance records are
// archive-only appendices after Definition of done.
//
// Row: { key, document, heading: { en, th }, owner, fields, when, appendix?, archiveOnly? }
//   owner: "author" (written by the change author), "derived" (built by the
//          harness from other fields), or "machine" (harness metadata).
//   fields: draft fields that feed the section. A field feeds at most one
//          author row per packet (one home); "field:selector" names one part
//          of a field that is split across rows (spec requirements by operation).
//   when(draft, context): context is { workTypes: string[], lane, language,
//          archived?: boolean }.

export const OUTLINE_VERSION = 1;

export const VOLATILE_FIELDS = Object.freeze(["status", "approvers", "evidenceFreshness", "reviewRecord"]);

export const OUTLINE_DOCUMENTS = Object.freeze(["proposal", "design", "spec", "tasks"]);

function present(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(present);
  if (typeof value === "object") return Object.values(value).some(present);
  return true;
}

function has(draft, ...fields) {
  return fields.some((field) => present(draft?.[field]));
}

function typed(context, type) {
  return context.workTypes.includes(type);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function operationOf(requirement) {
  return String(requirement?.operation || "added").trim().toLowerCase();
}

function hasOperation(draft, operation) {
  return list(draft?.requirements).some((requirement) => operationOf(requirement) === operation);
}

function capabilityCount(draft) {
  const overviews = draft?.capabilityOverviews;
  const named = new Set(Array.isArray(overviews)
    ? overviews.map((row) => row?.capability ?? row?.name ?? row)
    : Object.keys(overviews && typeof overviews === "object" ? overviews : {}));
  for (const requirement of list(draft?.requirements))
    if (requirement?.capability) named.add(requirement.capability);
  return named.size;
}

function hasFailureScenario(draft) {
  return list(draft?.requirements).some((requirement) =>
    list(requirement?.scenarios).some((scenario) => String(scenario?.kind || "").toLowerCase() === "failure"));
}

function hasProposedDecision(draft) {
  return list(draft?.decisions).some((decision) => String(decision?.status || "").toLowerCase() === "proposed");
}

const always = () => true;

function row(document, key, en, th, fields, when, extra = {}) {
  const owner = extra.owner || "author";
  return Object.freeze({
    key,
    document,
    heading: Object.freeze({ en, th }),
    owner,
    fields: Object.freeze([...fields]),
    when,
    ...(extra.appendix ? { appendix: true } : {}),
    ...(extra.archiveOnly ? { archiveOnly: true } : {})
  });
}

// Work-type detail sections render only for their declared type and only
// when the field is supplied; a missing required field is an EDIT raised by
// the required-sections check, never an empty heading.
const WORK_TYPE_DETAIL = [
  ["libraryContract", "library", "Public interface contract", "สัญญา public interface"],
  ["migrationPlan", "migration", "Migration plan", "แผนการย้ายระบบ"],
  ["performanceAnalysis", "performance", "Performance analysis", "การวิเคราะห์ประสิทธิภาพ"],
  ["dependencyChange", "dependency", "Dependency change", "การเปลี่ยน dependency"],
  ["deprecationPlan", "deprecation", "Deprecation plan", "แผนการเลิกใช้"],
  ["infraPlan", "infra", "Infrastructure plan", "แผนโครงสร้างพื้นฐาน"],
  ["privacyAssessment", "privacy", "Privacy assessment", "การประเมินความเป็นส่วนตัว"],
  ["experimentDesign", "experiment", "Experiment design", "การออกแบบการทดลอง"],
  ["releasePlan", "client-release", "Client release plan", "แผนปล่อยแอปฝั่งผู้ใช้"],
  ["modelCard", "ml", "Model card and evaluation plan", "Model card และแผนประเมินผล"],
  ["dataFix", "data-fix", "Data fix plan", "แผนแก้ข้อมูล"],
  ["hardening", "security", "Security hardening", "การเสริมความปลอดภัย"],
  ["pipelinePlan", "cicd", "Pipeline plan", "แผน pipeline"]
];

const P = "proposal";
const D = "design";

const PROPOSAL = [
  row(P, "header", "Change", "ข้อมูล change", ["id", "lane", "reviewTier", "owner", "created"], always,
    { owner: "machine" }),
  row(P, "summary", "Summary", "สรุป", ["intent", "summary"], always),
  row(P, "why", "Why", "เหตุผล", ["why"], always),
  row(P, "userStories", "User stories", "User story", ["userStories"], (draft) => has(draft, "userStories")),
  row(P, "successCriteria", "Success criteria", "เกณฑ์ความสำเร็จ", ["successCriteria", "successMeasure"], always),
  row(P, "scope", "Scope", "ขอบเขต", ["surfaces", "nonGoals", "constraints"], always),
  row(P, "capabilities", "Capabilities", "Capability ที่เปลี่ยน", ["capabilityOverviews"],
    (draft) => capabilityCount(draft) > 1, { owner: "derived" }),
  row(P, "impact", "Impact and risk", "ผลกระทบและความเสี่ยง",
    ["impact", "coupling", "riskSignals", "securityTriggers", "consumers"], always),
  row(P, "decisionsToRatify", "Decisions to ratify and open questions", "สิ่งที่ต้องตัดสินใจและคำถามที่ยังเปิด",
    ["openQuestions"], (draft) => has(draft, "openQuestions") || hasProposedDecision(draft)),
  row(P, "decisionLog", "Decision log", "บันทึกการตัดสินใจของผู้ใช้", ["decisionLog"],
    (draft) => has(draft, "decisionLog")),
  row(P, "communication", "Communication, support, and release note", "การสื่อสาร การดูแลหลังปล่อย และ release note",
    ["communication", "releaseNote"], (draft) => has(draft, "communication", "releaseNote")),
  row(P, "demo", "How to verify", "วิธีตรวจด้วยตัวเอง", ["demo"], (draft) => has(draft, "demo")),
  row(P, "acceptance", "Acceptance traceability", "เกณฑ์ผ่าน", ["requirements", "tasks", "claims"], always,
    { owner: "derived" }),
  row(P, "definitionOfDone", "Definition of done", "นิยามของงานเสร็จ", [], always, { owner: "derived" }),
  row(P, "investigation", "Appendix: Investigation", "ภาคผนวก: การสืบค้น", ["investigation"],
    (draft) => has(draft, "investigation"), { owner: "derived", appendix: true }),
  row(P, "discovery", "Appendix: Discovery coverage", "ภาคผนวก: ความครอบคลุมของการสำรวจ", ["discovery"],
    (draft) => has(draft, "discovery"), { appendix: true }),
  row(P, "derived", "Appendix: Derived by the harness", "ภาคผนวก: ข้อมูลที่ harness สร้าง", [], always,
    { owner: "derived", appendix: true }),
  row(P, "provenance", "Appendix: Provenance", "ภาคผนวก: ที่มา", ["provenance"], always,
    { owner: "machine", appendix: true }),
  row(P, "amendments", "Appendix: Amendment history", "ภาคผนวก: ประวัติการแก้ไข", ["amendments"],
    (draft, context) => has(draft, "amendments") || present(context.amendments), { owner: "machine", appendix: true }),
  row(P, "reviewRecord", "Appendix: Review record", "ภาคผนวก: ผล review", ["reviewRecord"],
    (draft, context) => context.archived === true, { owner: "derived", appendix: true, archiveOnly: true }),
  row(P, "complianceRecord", "Appendix: Compliance change record", "ภาคผนวก: บันทึกการเปลี่ยนแปลงตาม compliance",
    ["compliance"], (draft, context) => context.archived === true && (has(draft, "compliance") || present(context.compliance)),
    { owner: "derived", appendix: true, archiveOnly: true })
];

const DESIGN = [
  row(D, "overview", "Overview", "ภาพรวม", ["overview"], always),
  row(D, "currentState", "Current state", "สถานะปัจจุบัน", ["currentState"], (draft) => has(draft, "currentState")),
  row(D, "domainLanguage", "Domain language", "ภาษาของโดเมน", ["domainLanguage"],
    (draft) => has(draft, "domainLanguage")),
  row(D, "assumptions", "Assumptions", "สมมติฐาน", ["assumptions"], (draft) => has(draft, "assumptions")),
  row(D, "workType", "Work type", "ประเภทงาน", ["workType"], always, { owner: "derived" }),
  row(D, "architecture", "Architecture", "สถาปัตยกรรม", ["diagram", "boundaries"],
    (draft) => has(draft, "diagram", "boundaries")),
  row(D, "tenancy", "Tenancy", "การแยก tenant", ["tenancy"], (draft) => has(draft, "tenancy")),
  row(D, "userFlow", "User flow", "เส้นทางผู้ใช้", ["userFlow"], (draft) => has(draft, "userFlow")),
  row(D, "runtime", "Runtime behavior", "พฤติกรรมขณะทำงาน", ["diagrams"], (draft) => has(draft, "diagrams")),
  row(D, "domainModel", "Domain model and modules", "โมเดลโดเมนและโมดูล", ["domain", "componentMap"],
    (draft) => has(draft, "domain", "componentMap")),
  row(D, "apiContracts", "API contract", "สัญญา API", ["apiContracts"], (draft) => has(draft, "apiContracts")),
  row(D, "eventContracts", "Event and job contract", "สัญญา event และ job", ["eventContracts", "jobContract"],
    (draft) => has(draft, "eventContracts", "jobContract")),
  row(D, "dataModel", "Data model and migration", "โมเดลข้อมูลและ migration", ["dataModel"],
    (draft) => has(draft, "dataModel")),
  row(D, "uiContract", "UI contract", "สัญญา UI", ["ui", "uiStates"], (draft) => has(draft, "ui", "uiStates")),
  row(D, "configContract", "Config contract", "สัญญา config", ["configContract"],
    (draft) => has(draft, "configContract")),
  row(D, "integrations", "Integration contract", "สัญญาการเชื่อมต่อระบบภายนอก", ["integrations"],
    (draft) => has(draft, "integrations")),
  ...WORK_TYPE_DETAIL.map(([field, type, en, th]) =>
    row(D, field, en, th, [field], (draft, context) => typed(context, type) && has(draft, field))),
  row(D, "bugfix", "Bugfix analysis", "การวิเคราะห์ bug", ["bugfix"], (draft) => has(draft, "bugfix")),
  row(D, "refactor", "Refactor invariants", "สิ่งที่ต้องคงเดิมใน refactor", ["refactor"],
    (draft) => has(draft, "refactor")),
  row(D, "decisions", "Decisions", "การตัดสินใจ", ["decisions"], (draft) => has(draft, "decisions")),
  row(D, "nfr", "Quality attributes", "คุณภาพที่ต้องการ (NFR)", ["nfr"], (draft) => has(draft, "nfr")),
  row(D, "threatModel", "Threat model", "Threat model", ["threatModel"], (draft) => has(draft, "threatModel")),
  row(D, "failureMatrix", "Failure matrix", "ตารางความล้มเหลว", ["failureMatrix"],
    (draft) => has(draft, "failureMatrix") || hasFailureScenario(draft)),
  row(D, "observability", "Observability and usage", "การสังเกตระบบและการใช้งาน", ["observability", "trackingPlan"],
    (draft) => has(draft, "observability", "trackingPlan")),
  row(D, "rollout", "Compatibility and rollout", "ความเข้ากันได้และการปล่อย", ["compatibility", "rollout"],
    (draft) => has(draft, "compatibility", "rollout")),
  row(D, "capacity", "Capacity and cost", "ความจุและค่าใช้จ่าย", ["capacity"], (draft) => has(draft, "capacity")),
  row(D, "recovery", "Backup and recovery", "การสำรองและกู้คืนข้อมูล", ["recovery"],
    (draft) => has(draft, "recovery") || present(draft?.dataModel?.recovery)),
  row(D, "testStrategy", "Test strategy", "กลยุทธ์การทดสอบ", ["testStrategy"], (draft) => has(draft, "testStrategy")),
  row(D, "dependencies", "Dependencies", "สิ่งที่ต้องพึ่งพา", ["dependencies"], (draft) => has(draft, "dependencies")),
  row(D, "risks", "Risks", "ความเสี่ยง", ["risks"], (draft) => has(draft, "risks")),
  row(D, "fileMap", "File map", "แผนที่ไฟล์", ["fileMap"], always, { owner: "derived", appendix: true }),
  row(D, "testMap", "Test map", "แผนที่ test", ["testMap"], (draft) => has(draft, "testMap", "requirements"),
    { owner: "derived", appendix: true }),
  row(D, "prototype", "Selected prototype", "Prototype ที่เลือก", ["prototypeSelection"],
    (draft) => has(draft, "prototypeSelection"))
];

const SPEC = [
  row("spec", "purpose", "Purpose", "Purpose", ["capabilityOverviews"], always),
  row("spec", "added", "ADDED Requirements", "ADDED Requirements", ["requirements:added"],
    (draft) => hasOperation(draft, "added")),
  row("spec", "modified", "MODIFIED Requirements", "MODIFIED Requirements", ["requirements:modified"],
    (draft) => hasOperation(draft, "modified")),
  row("spec", "removed", "REMOVED Requirements", "REMOVED Requirements", ["requirements:removed"],
    (draft) => hasOperation(draft, "removed")),
  row("spec", "rationale", "Rationale", "Rationale", ["decisions"],
    (draft) => list(draft?.decisions).some((decision) => decision?.durable === true), { owner: "derived" })
];

// tasks.md is one dependency-ordered ledger without sections.
const TASKS = [
  row("tasks", "ledger", "Tasks", "Tasks", ["tasks"], always)
];

export const OUTLINE = Object.freeze({
  proposal: Object.freeze(PROPOSAL),
  design: Object.freeze(DESIGN),
  spec: Object.freeze(SPEC),
  tasks: Object.freeze(TASKS)
});

function rowsOf(document) {
  const rows = OUTLINE[document];
  if (!rows) throw new TypeError(`unknown outline document '${document}'; expected ${OUTLINE_DOCUMENTS.join("|")}`);
  return rows;
}

function normalizeContext(draft, context = {}) {
  const declared = context.workTypes ?? draft?.workTypes ?? draft?.workType;
  const workTypes = (Array.isArray(declared) ? declared : [declared])
    .filter((type) => typeof type === "string" && type.trim())
    .map((type) => type.trim().toLowerCase());
  return { ...context, workTypes, lane: context.lane ?? draft?.lane, language: context.language ?? draft?.language };
}

// Ordered rows of one document whose condition holds for this draft.
export function outlineSections(document, draft = {}, context = {}) {
  const rows = rowsOf(document);
  const resolved = normalizeContext(draft, context);
  return rows.filter((section) => section.when(draft || {}, resolved));
}

export function sectionHeading(section, language) {
  return String(language || "").toLowerCase() === "th" ? section.heading.th : section.heading.en;
}

export function outlineRow(document, key) {
  return rowsOf(document).find((section) => section.key === key) || null;
}

export function derivedSectionKeys(document) {
  return rowsOf(document).filter((section) => section.owner !== "author").map((section) => section.key);
}
