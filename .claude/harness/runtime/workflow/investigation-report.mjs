import {
  lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

const MARKER = "<!-- change-loop:generated-investigation-report:v1 -->";
const rows = (value) => Array.isArray(value) ? value : [];
const escape = (value) => String(value ?? "").replace(/[\\`*_[\]<>]/g, "\\$&");
export const isInvestigationReport = (path) =>
  /^openspec\/investigations\/[^/]+\.report\.md$/.test(path);

// Everything under openspec/investigations/ is investigation output, not a
// discoverable project source: records, generated reports, and notes authored
// after DONE. Only paths a record explicitly acknowledges as sources stay
// discoverable, so a later note cannot make a completed handoff look stale.
// Generated reports are never sources, acknowledged or not.
export function investigationDiscoveryExclusions(root, acknowledged = []) {
  const keep = new Set(acknowledged.filter((path) => !isInvestigationReport(path)));
  const paths = [];
  const walk = (absolute, relativePath) => {
    let entries;
    try { entries = readdirSync(absolute, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const path = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) walk(join(absolute, entry.name), path);
      else if (!keep.has(path)) paths.push(path);
    }
  };
  walk(join(root, "openspec", "investigations"), "openspec/investigations");
  return paths.sort();
}

const labels = {
  en: {
    title: "Investigation report", status: "Status", current: "Current conclusion",
    incomplete: "Incomplete — review the next action before using this conclusion",
    problem: "Problem", recommendation: "Recommendation and reasons", none: "Not recorded",
    facts: "Source-grounded facts", unverified: "Recorded facts — validation is incomplete",
    hypotheses: "Hypotheses and evidence", options: "Options and tradeoffs",
    decisions: "Decisions", unknowns: "Unknowns and remaining work", sources: "Sources",
    next: "Next action", ready: "Ready to propose a Change; user intent is still required",
    noChange: "Investigation complete; no Change recommended", resume: "Agent resume command",
    updated: "Updated", evidence: "Evidence", rejected: "Not selected", choice: "Choice",
    open: "Open", supported: "Supported", falsified: "Falsified", resolved: "Resolved",
    research: "Continue investigating", user: "User decision required", findings: "Findings",
    tradeoffs: "Tradeoffs", prototype: "Prototype (not proof)",
    unread: "Discovered sources not cited by a fact (hashed, not yet read)",
    nextCheck: "Next check", noNextCheck: "No next check yet"
  },
  th: {
    title: "รายงานการสำรวจปัญหา", status: "สถานะ", current: "ข้อสรุปปัจจุบัน",
    incomplete: "ยังไม่สมบูรณ์ — ตรวจขั้นตอนถัดไปก่อนใช้ข้อสรุปนี้",
    problem: "ปัญหา", recommendation: "ข้อเสนอแนะและเหตุผล", none: "ยังไม่ได้บันทึก",
    facts: "ข้อเท็จจริงที่มีแหล่งอ้างอิง", unverified: "ข้อเท็จจริงที่บันทึกไว้ — ยังตรวจสอบไม่ครบ",
    hypotheses: "สมมติฐานและหลักฐาน", options: "ทางเลือกและข้อแลกเปลี่ยน",
    decisions: "การตัดสินใจ", unknowns: "สิ่งที่ยังไม่รู้และงานที่เหลือ", sources: "แหล่งอ้างอิง",
    next: "ขั้นตอนถัดไป", ready: "พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้",
    noChange: "สำรวจเสร็จแล้วและไม่แนะนำให้ทำ Change", resume: "คำสั่งที่ agent ใช้ทำต่อ",
    updated: "อัปเดต", evidence: "หลักฐาน", rejected: "ไม่เลือก", choice: "ตัวเลือก",
    open: "ยังไม่สรุป", supported: "มีหลักฐานสนับสนุน", falsified: "มีหลักฐานหักล้าง", resolved: "ตัดสินใจแล้ว",
    research: "ต้องสำรวจต่อ", user: "ต้องการการตัดสินใจจากผู้ใช้", findings: "ข้อค้นพบ",
    tradeoffs: "ข้อแลกเปลี่ยน", prototype: "ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์)",
    unread: "แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)",
    nextCheck: "ตรวจต่อ", noNextCheck: "ยังไม่มีการตรวจต่อ"
  }
};


function renderIntake(record, state, language) {
  if (record.version !== 2) return "";
  const th = language.toLowerCase().startsWith("th");
  const l = th ? {
    title: "ความต้องการและบริบทที่บันทึกไว้", goal: "เป้าหมาย", outcome: "ผลลัพธ์ที่ต้องการ",
    requirements: "ข้อกำหนดล่าสุด", history: "ประวัติข้อกำหนด", conversation: "สาระจากบทสนทนา",
    questions: "คำถามและคำตอบ", experiments: "ผลทดลองและข้อจำกัด (ไม่ใช่ proof)",
    work: "งานอิสระที่ทำต่อได้", gaps: "ช่องว่างของประวัติที่เข้าถึงไม่ได้",
    source: "ที่มา", reason: "เหตุผล", criteria: "เกณฑ์ตัดสิน", findings: "ผลที่พบ",
    limitations: "ข้อจำกัด", review: "ต้องทบทวนตาม requirement รุ่นล่าสุด", scope: "ขอบเขต", actors: "ผู้เกี่ยวข้อง"
  } : {
    title: "Retained requirements and context", goal: "Goal", outcome: "Desired outcome",
    requirements: "Current requirements", history: "Requirement history", conversation: "Conversation context",
    questions: "Questions and answers", experiments: "Experiments and limitations (not proof)",
    work: "Independent work that may continue", gaps: "Unavailable history gaps",
    source: "Origin", reason: "Reason", criteria: "Criteria", findings: "Findings",
    limitations: "Limitations", review: "Needs review against current requirements", scope: "Scope", actors: "Actors"
  };
  const section = (title, values) => values.length
    ? `\n### ${title}\n\n${values.map((v) => `- ${v}`).join("\n")}\n` : "";
  const intake = state.intake || record;
  let result = `\n## ${l.title}\n\n`;
  if (intake.intent?.goal) result += `**${l.goal}:** ${escape(intake.intent.goal)}\n\n`;
  if (intake.intent?.outcome) result += `**${l.outcome}:** ${escape(intake.intent.outcome)}\n\n`;
  result += section(l.actors, rows(intake.intent?.actors).map(escape));
  result += section(l.scope, rows(intake.intent?.scope).map(escape));
  const requirement = (r) => `**${escape(r.key)}@${escape(r.revision)}** [${escape(r.kind)} / ${escape(r.status)}] ${escape(r.statement)}; ${l.source}: ${escape(r.origin)} (${rows(r.conversationKeys).map(escape).join(", ")})` +
    (r.reason ? `; ${l.reason}: ${escape(r.reason)}` : "") +
    (r.supersededBy ? `; → ${escape(r.supersededBy.key)}@${escape(r.supersededBy.revision)}` : "") +
    (rows(r.examples).length ? `; examples: ${rows(r.examples).map(escape).join(" / ")}` : "") +
    (rows(r.criteria).length ? `; ${l.criteria}: ${rows(r.criteria).map(escape).join(" / ")}` : "");
  const retained = rows(intake.requirements).filter((r) => r && typeof r === "object");
  result += section(l.requirements, retained.filter((r) => !["superseded", "cancelled"].includes(r.status)).map(requirement));
  result += section(l.history, retained.filter((r) => ["superseded", "cancelled"].includes(r.status)).map(requirement));
  result += section(l.questions, rows(intake.questions).filter(Boolean).map((q) =>
    `**${escape(q.key)}** [${escape(q.status)}]: ${escape(q.question)}` +
    (q.answer ? ` → ${escape(q.answer)} (${rows(q.conversationKeys).map(escape).join(", ")})` : "") +
    (q.reason ? `; ${l.reason}: ${escape(q.reason)}` : "")));
  const stale = new Set(rows(state.action?.staleExperiments));
  result += section(l.experiments, rows(intake.experiments).filter(Boolean).map((e) =>
    `**${escape(e.key)}** [${stale.has(e.key) ? l.review : escape(e.status)}]: ${escape(e.question)}; ${l.criteria}: ${rows(e.criteria).map(escape).join(" / ")}; ${l.findings}: ${rows(e.findings).map(escape).join(" / ")}; ${l.limitations}: ${rows(e.limitations).map(escape).join(" / ")}; refs: ${rows(e.requirementRefs).map((r) => `${escape(r?.key)}@${escape(r?.revision)}`).join(", ")}` +
    (e.supersededBy ? `; → ${escape(e.supersededBy)} (${escape(e.reason)})` : "")));
  result += section(l.work, rows(state.action?.independentWork).map((w) => `${escape(w.key)}: ${escape(w.outcome)}`));
  result += section(l.conversation, rows(intake.conversation).filter(Boolean).map((e) =>
    `**${escape(e.key)}** [${escape(e.speaker)}]: ${escape(e.statement)} (${escape(e.source)})`));
  result += section(l.gaps, rows(intake.historyGaps).map(escape));
  return result;
}

export function renderInvestigationReport({ record, state, projectRoot, sourceRoot, path,
  validationIssues = [] }) {
  const language = String(record.language || (/\p{Script=Thai}/u.test(record.problem || "") ? "th" : "en"));
  const l = labels[language.toLowerCase().startsWith("th") ? "th" : "en"];
  const complete = state.action.action === "DONE";
  const link = (source) => {
    const target = relative(dirname(join(projectRoot, path)), resolve(sourceRoot || projectRoot, source))
      .replaceAll("\\", "/");
    return `[${escape(source)}](<${encodeURI(target).replace(/[<>]/g, (c) => encodeURIComponent(c))}>)`;
  };
  const list = (items) => rows(items).length ? rows(items).map((item) => `- ${item}`).join("\n") : l.none;
  const section = (title, body) => `\n## ${title}\n\n${body}\n`;
  const factsValid = !validationIssues.length && state.action.boundary !== "investigation-record" &&
    state.sourceInventory?.sources?.length > 0;
  let output = `${MARKER}\n# ${l.title}: ${escape(record.id)}\n\n` +
    `**${l.status}:** ${complete ? l.current : l.incomplete}\n\n` +
    `${l.updated}: ${escape(state.updatedAt)} · ${escape(state.stateDigest)}\n`;
  output += section(l.problem, escape(record.problem));
  output += renderIntake(record, state, language);
  output += section(l.current, escape(state.conclusion?.summary || l.none));
  output += section(l.recommendation, state.selection
    ? `${escape(state.selection.optionKey)} — ${escape(state.selection.reason)}\n\n` +
      list(rows(state.selection.rejected).map((row) => `${l.rejected}: ${escape(row.optionKey)} — ${escape(row.reason)}`))
    : escape(state.changeIntent || state.conclusion?.summary || l.none));
  output += section(factsValid ? l.facts : l.unverified, list(rows(state.facts).map((fact) =>
    `**${escape(fact.key)}:** ${escape(fact.statement)} (${rows(fact.sources).map(link).join(", ")})`)));
  output += section(l.hypotheses, list(rows(state.hypotheses).map((row) =>
    `**${escape(row.key)} — ${l[row.status] || escape(row.status)}:** ${escape(row.statement)}; ` +
    `${l.evidence}: ${rows(row.factKeys).map(escape).join(", ") || l.none}`)));
  if (rows(state.options).length) output += section(l.options, rows(state.options).map((option) =>
    `### ${escape(option.key)}\n\n${escape(option.summary)}\n\n` +
    `${l.findings}:\n\n${list(rows(option.findings).map(escape))}\n\n` +
    `${l.tradeoffs}:\n\n${list(rows(option.tradeoffs).map(escape))}\n\n` +
    `${l.sources}: ${rows(option.sources).map(link).join(", ")}\n\n` +
    `${l.prototype}: ${rows(option.prototypePaths).map(escape).join(", ") || l.none}`
  ).join("\n\n"));
  output += section(l.decisions, list(rows(state.decisions).map((row) =>
    `**${escape(row.key)} — ${l[row.status] || escape(row.status)}:** ${escape(row.question || row.choice)}\n` +
    `  ${l.choice}: ${rows(row.alternatives).map(escape).join(" / ") || escape(row.choice)}; ` +
    `${l.recommendation}: ${escape(row.recommended || row.reason)}; ` +
    `${l.evidence}: ${rows(row.recommendationFactKeys).map(escape).join(", ") || l.none}`)));
  const experiments = new Map(rows((state.intake || record).experiments)
    .filter(Boolean).map((row) => [row.key, row]));
  const nextChecks = (row) => rows(row.experimentKeys).length
    ? rows(row.experimentKeys).map((key) => `${l.nextCheck}: **${escape(key)}** ` +
      `[${escape(experiments.get(key)?.status || l.none)}] ${escape(experiments.get(key)?.question || l.none)}`).join("; ")
    : l.noNextCheck;
  output += section(l.unknowns, list([
    ...rows(state.hypotheses).filter((row) => row.status === "open").map((row) =>
      `**${escape(row.key)}:** ${escape(row.statement)} — ${nextChecks(row)}`),
    ...rows(state.action.investigation?.issues).map(escape),
    ...rows(validationIssues).filter((issue) => !rows(state.action.investigation?.issues).includes(issue)).map(escape),
    ...rows(state.decisions).filter((row) => row.status === "open").map((row) => escape(row.question))
  ]));
  output += section(l.sources, list(rows(state.sourceInventory?.sources).map((row) => link(row.path))));
  if (rows(state.repository?.unreadSources).length)
    output += section(l.unread, list(rows(state.repository.unreadSources).map(link)));
  const next = complete ? state.conclusion?.status === "ready-for-change" ? l.ready
    : state.conclusion?.status === "not-worth-changing" ? l.noChange : l.user
    : state.action.action === "ASK_USER" ? l.user : l.research;
  output += section(l.next, `${next}\n\n${escape(state.action.reason)}\n\n` +
    `${l.resume}:\n\n\`\`\`text\n${state.action.resume}\n\`\`\`\n`);
  return output;
}

export function writeInvestigationReport({ projectRoot, sourceRoot, record, state, validationIssues = [] }) {
  const path = `openspec/investigations/${record.id}.report.md`;
  let target, temporary, owned = false;
  try {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(record.id)) throw new Error("unsafe report id");
    let current = projectRoot;
    for (const part of path.split("/")) {
      current = join(current, part);
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) throw new Error(`report path is a symlink: ${current}`);
    }
    target = join(projectRoot, path);
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (stat) {
      owned = stat.isFile() && readFileSync(target, "utf8").startsWith(MARKER);
      if (!owned) throw new Error("report path is user-owned; preserve it and choose a different investigation id");
    }
    mkdirSync(dirname(target), { recursive: true });
    temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, renderInvestigationReport({ record, state, projectRoot, sourceRoot, path, validationIssues }),
      { encoding: "utf8", flag: "wx" });
    renameSync(temporary, target);
    return { status: "current", path, stateDigest: state.stateDigest };
  } catch (error) {
    if (temporary) try { rmSync(temporary, { force: true }); } catch { /* report remains unavailable */ }
    if (owned) try { rmSync(target); } catch { /* never advertise the old report as current */ }
    return { status: "unavailable", path: null, intendedPath: path,
      reason: error.message, resume: state.action.resume };
  }
}
