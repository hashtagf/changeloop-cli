// Coverage checks references, never claims to establish semantic equivalence.
// Compiled artifacts retain meaning and provenance rather than a raw JSON dump.

export function amendmentInvestigationSource(prior, amendment) {
  const binding = amendment.investigation || prior?.investigation;
  if (binding?.version !== 2) return null;
  const changed = new Map(rows(amendment.reviseRequirements).map((r) => [r.key, r]));
  const removed = new Set(rows(amendment.removeRequirements).map((r) => r.key));
  return {
    language: amendment.language || prior?.language || "en",
    investigation: binding,
    investigationCoverage: amendment.investigationCoverage ?? prior?.investigationCoverage,
    requirements: [
      ...rows(prior?.requirements).filter((r) => !removed.has(r.key))
        .map((r) => changed.get(r.key) || r),
      ...rows(amendment.addRequirements)
    ],
    nonGoals: amendment.nonGoals ?? prior?.nonGoals ?? [],
    constraints: amendment.constraints ?? prior?.constraints ?? [],
    decisions: amendment.decisions ?? prior?.decisions ?? [],
    discovery: { decisions: amendment.discovery?.decisions ?? prior?.discovery?.decisions ?? [] }
  };
}
const rows = (v) => Array.isArray(v) ? v : [];
const text = (v) => typeof v === "string" ? v.trim() : "";
const sourceId = (r) => `${r?.key}@${r?.revision}`;

export function investigationCoverageIssues(source) {
  if (source?.investigation?.version !== 2) return [];
  const issues = [];
  const intake = source.investigation.intake;
  if (!intake || typeof intake !== "object") return ["investigation coverage needs bound intake"];
  const retained = new Map(rows(intake.requirements).map((r) => [sourceId(r), r]));
  const required = rows(intake.requirements).filter((r) => r?.material &&
    ["stated", "confirmed"].includes(r.status));
  const coverage = rows(source.investigationCoverage);
  const requirements = new Map(rows(source.requirements).map((r) => [r?.key, r]));
  const decisions = new Map([
    ...rows(source.decisions), ...rows(source.discovery?.decisions)
  ].map((r) => [r?.key, r]));
  const seen = new Set();
  for (const row of coverage) {
    const id = `${row?.sourceKey}@${row?.sourceRevision}`;
    const origin = retained.get(id);
    if (!origin) issues.push(`investigation coverage references unknown source '${id}'`);
    if (seen.has(id)) issues.push(`investigation coverage repeats source '${id}'; combine targets`);
    seen.add(id);
    if (!rows(row?.targets).length) issues.push(`investigation coverage '${id}' needs targets`);
    for (const target of rows(row?.targets)) {
      let valid = false;
      if (target?.kind === "requirement") valid = requirements.has(target.key);
      else if (target?.kind === "scenario") {
        const requirement = requirements.get(target.key);
        const scenarios = rows(requirement?.scenarios);
        valid = scenarios.some((r) => target.scenario === r?.key || target.scenario === r?.name);
      } else if (target?.kind === "non-goal")
        valid = rows(source.nonGoals).includes(target.key);
      else if (target?.kind === "constraint")
        valid = rows(source.constraints).includes(target.key);
      else if (target?.kind === "design")
        valid = decisions.has(target.key) && !!text(decisions.get(target.key)?.choice);
      if (!valid) issues.push(`investigation coverage '${id}' has missing or invalid ${target?.kind || "typed"} target '${target?.key || ""}'`);
    }
    if (origin && ["proposed", "unresolved", "superseded", "cancelled"].includes(origin.status))
      issues.push(`investigation coverage '${id}' is not current user intent`);
  }
  for (const requirement of required)
    if (!seen.has(sourceId(requirement)))
      issues.push(`investigation requirement '${sourceId(requirement)}' is uncovered; map to requirement, scenario, non-goal, constraint or design`);
  return issues;
}

export function renderRetainedInvestigation(binding, language = "en") {
  if (binding?.version !== 2) return "";
  const intake = binding.intake || {};
  const th = String(language).startsWith("th");
  const esc = (v) => String(v ?? "").replace(/[\\`*_[\]<>]/g, "\\$&");
  const section = (title, values) => values.length
    ? `\n### ${title}\n\n${values.map((v) => `- ${v}`).join("\n")}\n` : "";
  let result = `\n## ${th ? "บริบทที่รับจาก Investigate" : "Retained investigation context"}\n\n`;
  if (intake.intent?.goal) result += `${th ? "เป้าหมาย" : "Goal"}: ${esc(intake.intent.goal)}\n\n`;
  if (intake.intent?.outcome) result += `${th ? "ผลลัพธ์ที่ต้องการ" : "Desired outcome"}: ${esc(intake.intent.outcome)}\n\n`;
  result += section(th ? "ขอบเขตและผู้เกี่ยวข้อง" : "Scope and actors",
    [...rows(intake.intent?.scope), ...rows(intake.intent?.actors)].map(esc));
  result += section(th ? "ข้อกำหนดและประวัติการแก้ไข" : "Requirements and revision history",
    rows(intake.requirements).filter(Boolean).map((r) =>
      `**${esc(sourceId(r))}** [${esc(r.kind)} / ${esc(r.status)} / ${esc(r.origin)}]: ${esc(r.statement)}` +
      (rows(r.examples).length ? `; examples: ${rows(r.examples).map(esc).join(" / ")}` : "") +
      (rows(r.criteria).length ? `; criteria: ${rows(r.criteria).map(esc).join(" / ")}` : "") +
      (r.reason ? `; ${esc(r.reason)}` : "") +
      (r.supersededBy ? `; → ${esc(sourceId(r.supersededBy))}` : "")));
  result += section(th ? "คำถามและการตัดสินใจ" : "Questions and decisions",
    rows(intake.questions).filter(Boolean).map((q) =>
      `${esc(q.key)} [${esc(q.status)}]: ${esc(q.question)}${q.answer ? " → " + esc(q.answer) : ""}${q.reason ? "; " + esc(q.reason) : ""}`));
  result += section(th ? "ผลทดลองและข้อจำกัด (ไม่ใช่ proof)" : "Experiments and limitations (not proof)",
    rows(intake.experiments).filter(Boolean).map((e) =>
      `${esc(e.key)} [${esc(e.status)}]: ${esc(e.question)}; criteria: ${rows(e.criteria).map(esc).join(" / ")}; findings: ${rows(e.findings).map(esc).join(" / ")}; limitations: ${rows(e.limitations).map(esc).join(" / ")}; refs: ${rows(e.requirementRefs).map((r) => esc(sourceId(r))).join(", ")}${e.supersededBy ? "; → " + esc(e.supersededBy) : ""}`));
  result += section(th ? "สาระจากบทสนทนา" : "Conversation provenance",
    rows(intake.conversation).filter(Boolean).map((e) =>
      `${esc(e.key)} [${esc(e.speaker)}]: ${esc(e.statement)} (${esc(e.source)})`));
  result += section(th ? "ช่องว่างของประวัติ" : "Unavailable history gaps", rows(intake.historyGaps).map(esc));
  return result;
}

export function renderInvestigationCoverage(source) {
  if (source?.investigation?.version !== 2) return "";
  const esc = (v) => String(v ?? "").replace(/[\\|\n\r]/g, " ");
  const intake = source.investigation.intake || {};
  const current = rows(intake.requirements).filter((r) => ["stated", "confirmed"].includes(r?.status));
  const mappings = new Map(rows(source.investigationCoverage).map((r) => [
    `${r.sourceKey}@${r.sourceRevision}`, rows(r.targets).map((t) =>
      `${t.kind}: ${t.key}${t.scenario ? " / " + t.scenario : ""}`).join("; ")
  ]));
  const th = String(source.language || "").startsWith("th");
  if (!current.length) return "";
  return `## ${th ? "ความครบของ requirement จาก Investigate" : "Investigation requirement coverage"}\n\n` +
    `| Source | Requirement | Targets |\n|---|---|---|\n` +
    current.map((r) => `| ${esc(sourceId(r))} | ${esc(r.statement)} | ${esc(mappings.get(sourceId(r)) || (th ? "สมมติฐานที่ไม่กระทบข้อตกลง" : "Nonmaterial retained context"))} |`).join("\n") +
    `\n\n${th ? "ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec" : "These links establish structural coverage; the agent must compare meaning with the source before presenting spec approval."}`;
}

// The proposal's single investigation appendix body (no top heading): every
// retained requirement appears once, in the coverage table with its status,
// targets, examples, and criteria; answers, experiment limits, conversation
// provenance, and history gaps follow. Nothing is repeated in a second block.
export function renderInvestigationContext(source) {
  const binding = source?.investigation;
  if (binding?.version !== 2) return "";
  const intake = binding.intake || {};
  const th = String(source.language || "").startsWith("th");
  const esc = (v) => String(v ?? "").replace(/[\\`*_[\]<>]/g, "\\$&").replace(/\r?\n/g, " ");
  const tableCell = (v) => esc(v).replaceAll("|", "\\|") || "—";
  const section = (title, values) => values.length
    ? `### ${title}\n\n${values.map((v) => `- ${v}`).join("\n")}` : "";
  const parts = [];
  const intent = [
    intake.intent?.goal ? `${th ? "เป้าหมาย" : "Goal"}: ${esc(intake.intent.goal)}` : "",
    intake.intent?.outcome ? `${th ? "ผลลัพธ์ที่ต้องการ" : "Desired outcome"}: ${esc(intake.intent.outcome)}` : ""
  ].filter(Boolean);
  if (intent.length) parts.push(intent.join("\n\n"));
  parts.push(section(th ? "ขอบเขตและผู้เกี่ยวข้อง" : "Scope and actors",
    [...rows(intake.intent?.scope), ...rows(intake.intent?.actors)].map(esc)));
  const mappings = new Map(rows(source.investigationCoverage).map((r) => [
    `${r.sourceKey}@${r.sourceRevision}`, rows(r.targets).map((t) =>
      `${t.kind}: ${t.key}${t.scenario ? " / " + t.scenario : ""}`).join("; ")
  ]));
  const requirements = rows(intake.requirements).filter(Boolean);
  if (requirements.length) {
    const current = (r) => ["stated", "confirmed"].includes(r?.status);
    const details = (r) => [
      rows(r.examples).length ? `${th ? "ตัวอย่าง" : "examples"}: ${rows(r.examples).join(" / ")}` : "",
      rows(r.criteria).length ? `${th ? "เกณฑ์" : "criteria"}: ${rows(r.criteria).join(" / ")}` : "",
      r.reason || "",
      r.supersededBy ? `→ ${sourceId(r.supersededBy)}` : ""
    ].filter(Boolean).join("; ");
    parts.push(`### ${th ? "ความครบของ requirement" : "Requirement coverage"}\n\n` +
      `| Source | Requirement | ${th ? "สถานะ" : "Status"} | Targets | ${th ? "รายละเอียด" : "Details"} |\n` +
      "|---|---|---|---|---|\n" +
      requirements.map((r) => `| ${tableCell(sourceId(r))} | ${tableCell(r.statement)} | ` +
        `${tableCell([r.kind, r.status, r.origin].filter(Boolean).join(" / "))} | ` +
        `${tableCell(mappings.get(sourceId(r)) ||
          (current(r) ? (th ? "สมมติฐานที่ไม่กระทบข้อตกลง" : "Nonmaterial retained context") : ""))} | ` +
        `${tableCell(details(r))} |`).join("\n") +
      `\n\n${th ? "ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec" : "These links establish structural coverage; the agent must compare meaning with the source before presenting spec approval."}`);
  }
  parts.push(section(th ? "คำถามและคำตอบ" : "Questions and answers",
    rows(intake.questions).filter(Boolean).map((q) =>
      `${esc(q.key)} [${esc(q.status)}]: ${esc(q.question)}${q.answer ? " → " + esc(q.answer) : ""}${q.reason ? "; " + esc(q.reason) : ""}`)));
  parts.push(section(th ? "ผลทดลองและข้อจำกัด (ไม่ใช่ proof)" : "Experiments and limitations (not proof)",
    rows(intake.experiments).filter(Boolean).map((e) =>
      `${esc(e.key)} [${esc(e.status)}]: ${esc(e.question)}; criteria: ${rows(e.criteria).map(esc).join(" / ")}; findings: ${rows(e.findings).map(esc).join(" / ")}; limitations: ${rows(e.limitations).map(esc).join(" / ")}; refs: ${rows(e.requirementRefs).map((r) => esc(sourceId(r))).join(", ")}${e.supersededBy ? "; → " + esc(e.supersededBy) : ""}`)));
  parts.push(section(th ? "สาระจากบทสนทนา" : "Conversation provenance",
    rows(intake.conversation).filter(Boolean).map((e) =>
      `${esc(e.key)} [${esc(e.speaker)}]: ${esc(e.statement)} (${esc(e.source)})`)));
  parts.push(section(th ? "ช่องว่างของประวัติ" : "Unavailable history gaps", rows(intake.historyGaps).map(esc)));
  return parts.filter(Boolean).join("\n\n");
}
