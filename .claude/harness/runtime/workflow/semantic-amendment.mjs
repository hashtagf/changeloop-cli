import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join } from "node:path";
import {
  deriveRepositoryTaskDependencies, normalizeSemanticDraft, renderRequirementMarkdown,
  renderSpecHeading, verifyChain
} from "./semantic-draft.mjs";
import {
  coverageRationale, coverageStatus, investigationAppendixBody
} from "./validation/reader-guide.mjs";
import { scopeAllowsPath } from "../core/graph-execution.mjs";
import { providerCapability } from "../evidence/provider-catalog.mjs";
import {
  amendmentInvestigationSource, investigationCoverageIssues
} from "./validation/investigation-coverage.mjs";
import { OUTLINE, outlineRow, sectionHeading } from "./validation/outline-contract.mjs";
import { isSemanticVersion } from "./validation/draft-version.mjs";
import { DESIGN_FIELDS } from "./validation/design-blueprints.mjs";
import { PROCESS_FIELDS } from "./validation/process-fields.mjs";

const stringList = (value) => Array.isArray(value)
  ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
const unique = (values) => [...new Set(values)];
const markdownCell = (value) => String(value ?? "")
  .replace(/\r?\n/g, " ").replaceAll("|", "\\|");
const keyOf = (row) => String(row?.key || "").trim();

export function semanticTaskKey(line) {
  return String(line).match(/\[key:([^\]]+)\]/i)?.[1]?.trim() || null;
}

function taskId(line) {
  return String(line).match(/^\s*-\s*\[[ xX]\]\s*\*{0,2}(T\d{3,})\*{0,2}\b/i)?.[1]
    ?.toUpperCase() || null;
}

function taskCompleted(line) {
  return /^\s*-\s*\[[xX]\]/.test(String(line));
}

function taskClaims(line) {
  return stringList(String(line).match(/\[claims:([^\]]*)\]/i)?.[1]?.split(","));
}

function taskVerify(line) {
  return String(line).match(/—\s*verify:\s*`([^`]+)`/i)?.[1]?.trim() || "";
}

function taskPaths(line) {
  return stringList(String(line).match(/\[paths:([^\]]*)\]/i)?.[1]?.split(","));
}

function replaceTaskVerify(line, verify) {
  return /—\s*verify:\s*`[^`]+`/i.test(line)
    ? line.replace(/—\s*verify:\s*`[^`]+`/i, `— verify: \`${verify}\``)
    : `${line.trimEnd()} — verify: \`${verify}\``;
}

function replaceTaskPaths(line, paths) {
  const annotation = paths.length ? `[paths:${paths.join(",")}]` : "";
  if (/\[paths:[^\]]*\]/i.test(line))
    return line.replace(/ ?\[paths:[^\]]*\]/i, annotation ? ` ${annotation}` : "");
  if (!annotation) return line;
  const marker = line.indexOf(" — verify:");
  return marker < 0
    ? `${line.trimEnd()} ${annotation}`
    : `${line.slice(0, marker).trimEnd()} ${annotation}${line.slice(marker)}`;
}

function taskDepends(line) {
  return stringList(String(line).match(/\[depends:([^\]]*)\]/i)?.[1]?.split(","))
    .map((id) => id.toUpperCase());
}

function replaceTaskDepends(line, ids) {
  const annotation = ids.length ? `[depends:${ids.join(",")}]` : "";
  if (/\[depends:[^\]]*\]/i.test(line))
    return line.replace(/ ?\[depends:[^\]]*\]/i, annotation ? ` ${annotation}` : "");
  if (!annotation) return line;
  const marker = line.indexOf(" — verify:");
  return marker < 0
    ? `${line.trimEnd()} ${annotation}`
    : `${line.slice(0, marker).trimEnd()} ${annotation}${line.slice(marker)}`;
}

// Re-opening unticks a completed task, so the harness must verify it again.
function reopenTask(line) {
  return String(line).replace(/^(\s*-\s*\[)[xX](\])/, "$1 $2");
}

// The fields an update may change in place. On a completed task they change
// only with `reopen: true`, which unticks it so its claims are proven again.
const TASK_CONTRACT_FIELDS = ["verify", "paths", "dependsOn"];
const TASK_ROW_FIELDS = ["key", ...TASK_CONTRACT_FIELDS, "reopen"];
const hasField = (row, field) => Object.prototype.hasOwnProperty.call(row || {}, field);
const removalRef = (row) => String(typeof row === "string" ? row : row?.key || "").trim();

/**
 * A task-contract amendment corrects the verify command (and optionally the
 * paths or dependencies) of existing tasks, or withdraws unfinished tasks
 * (`removeTasks`, which may move their coverage with `updateTasks` covers).
 * It carries no requirement change, so it needs no requirement, evidence, or
 * semantic-intake input.
 */
export function taskContractOnlyAmendment(amendment) {
  const updates = amendment?.updateTasks;
  const removals = amendment?.removeTasks;
  if (!["addRequirements", "reviseRequirements", "removeRequirements"]
    .every((field) => !amendmentList(amendment, field).length)) return false;
  if ((updates !== undefined && !Array.isArray(updates)) ||
      (removals !== undefined && !Array.isArray(removals))) return false;
  // A task added for a requirement the agreement already has changes no
  // requirement either; its covers are checked against the agreement later.
  const adding = amendmentList(amendment, "addTasks").length > 0;
  const rows = updates || [];
  const removing = (removals || []).length > 0;
  const fields = removing ? [...TASK_ROW_FIELDS, "covers"] : TASK_ROW_FIELDS;
  return (rows.length > 0 || removing || adding) &&
    rows.every((row) => row && typeof row === "object" && !Array.isArray(row) &&
      (hasField(row, "verify") || hasField(row, "dependsOn") ||
        (removing && hasField(row, "covers"))) &&
      Object.keys(row).every((field) => fields.includes(field)));
}

/**
 * The shape `change amend --template` prints; the verify-only form leads.
 * `save` comes first: the host refuses a shell-written JSON file, while the
 * file tool falls under the seeded `Edit(/.foundation/drafts/**)` rule.
 */
export function semanticAmendmentTemplate() {
  return {
    save: "Write one form below (its value, without the form name) with the Write tool to " +
      ".foundation/drafts/<change>-amendment.json; that path is pre-allowed and the tool " +
      "creates the folder. Do not save it through the shell (heredoc, cat >, echo >): the " +
      "host refuses those. Then run claude-foundation change amend <change> " +
      ".foundation/drafts/<change>-amendment.json.",
    verifyOnly: {
      version: 1,
      reason: "Correct the verify command of an unfinished task",
      updateTasks: [{ key: "<existing-task-key>", verify: "<command>" }]
    },
    // A completed task's verify changes only by re-opening it, and only an
    // unfinished task can be withdrawn; neither changes a requirement.
    reopenCompleted: {
      version: 1,
      reason: "Correct the verify command of a completed task and verify it again",
      updateTasks: [{ key: "<completed-task-key>", verify: "<command>", reopen: true }]
    },
    removeUnfinished: {
      version: 1,
      reason: "<why the task is no longer needed>",
      removeTasks: ["<unfinished-task-key-or-id>"]
    },
    requirementChange: {
      version: 1,
      reason: "<what Build discovered>",
      addRequirements: [{
        key: "<new-requirement-key>", capability: "<capability>", operation: "added",
        scenarios: [{ name: "<scenario>", when: "<condition>", then: "<outcome>" }],
        outcome: "<observable outcome>"
      }],
      reviseRequirements: [],
      removeRequirements: [{ key: "<requirement-key>", migration: "<why and what replaces it>" }],
      updateTasks: [{ key: "<existing-task-key>", covers: ["<requirement-key>"] }],
      addTasks: [{
        key: "<new-task-key>", outcome: "<task outcome>", covers: ["<new-requirement-key>"],
        paths: ["<path/glob>"], verify: "<command>"
      }],
      evidence: { "<new-requirement-key>": { capabilities: ["test"] } }
    }
  };
}

export function updateTaskClaimAnnotation(line, claimIds) {
  const claims = `[claims:${unique(claimIds).join(",")}]`;
  if (/\[claims:[^\]]*\]/i.test(line))
    return line.replace(/\[claims:[^\]]*\]/i, claims);
  const marker = line.indexOf(" — verify:");
  return marker < 0
    ? `${line.trimEnd()} ${claims}`
    : `${line.slice(0, marker).trimEnd()} ${claims}${line.slice(marker)}`;
}

const renderRequirement = (spec) => renderRequirementMarkdown(spec);

export function appendRequirementToSpec(content, spec) {
  const operation = String(spec.operation || "added").toUpperCase();
  const heading = `## ${operation} Requirements`;
  const rendered = renderRequirement(spec);
  const existing = String(content || "").replace(/\s+$/, "");
  // A new capability file starts with its human heading, as start renders it.
  const source = existing || renderSpecHeading(spec);
  const start = source.indexOf(heading);
  if (start < 0) return `${source}\n\n${heading}\n\n${rendered}\n`;
  const afterHeading = start + heading.length;
  const next = source.slice(afterHeading).search(/\n##\s+/);
  if (next < 0) return `${source}\n\n${rendered}\n`;
  const insertion = afterHeading + next;
  return `${source.slice(0, insertion).replace(/\s+$/, "")}\n\n${rendered}\n\n` +
    `${source.slice(insertion).replace(/^\s+/, "")}\n`;
}

/**
 * Locate the requirement blocks whose scenario set equals the named set. A
 * block runs from its `### Requirement:` heading to the next `##`/`###`
 * heading. Scenario names are unique only within a requirement, so a partial
 * overlap never identifies a block.
 */
export function requirementBlocks(content, scenarios) {
  const names = [...new Set(stringList(scenarios))].sort();
  const lines = String(content || "").split("\n");
  const matches = [];
  if (!names.length) return { lines, matches };
  let operation = null;
  for (let index = 0; index < lines.length; index += 1) {
    const section = lines[index].match(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i);
    if (section) { operation = section[1].toLowerCase(); continue; }
    if (/^##\s/.test(lines[index])) { operation = null; continue; }
    if (!/^###\s+Requirement:/.test(lines[index])) continue;
    let end = index + 1;
    while (end < lines.length && !/^##{1,2}\s/.test(lines[end])) end += 1;
    const own = [...new Set(lines.slice(index, end)
      .map((line) => line.match(/^####\s+Scenario:\s*(.+?)\s*$/)?.[1]).filter(Boolean))].sort();
    if (own.length === names.length && own.every((name, position) => name === names[position]))
      matches.push({ start: index, end, operation });
  }
  return { lines, matches };
}

/**
 * Replace (or, with a null replacement, delete) the one requirement block
 * whose scenario set equals the named set, preserving manual sections and
 * sibling requirements byte-for-byte.
 */
export function replaceRequirementBlock(content, scenarios, replacement) {
  const { lines, matches } = requirementBlocks(content, scenarios);
  if (matches.length !== 1) return { found: false, matches: matches.length, content: String(content || "") };
  const [{ start, end }] = matches;
  const inserted = replacement === null ? [] : String(replacement).split("\n");
  const rest = lines.slice(end);
  const next = [...lines.slice(0, start), ...inserted,
    ...(inserted.length && rest.length ? [""] : []), ...rest];
  let text = next.join("\n").replace(/\n{3,}/g, "\n\n");
  if (!text.endsWith("\n")) text += "\n";
  return { found: true, matches: 1, content: text };
}

function combinedChain(tasksContent) {
  return verifyChain(unique(String(tasksContent).split("\n").map(taskVerify).filter(Boolean)));
}

function combinedCommand(tasksContent) {
  return combinedChain(tasksContent).command;
}

// A rebuilt test provider carries the matching segments; a single verify has none.
function withChain(config, chain) {
  const { segments: _prior, ...rest } = config;
  return { ...rest, command: chain.command,
    ...(chain.segments && config.adapter === "test-discovery" ? { segments: chain.segments } : {}) };
}

function amendmentList(amendment, field) {
  return Array.isArray(amendment?.[field]) ? amendment[field] : [];
}

// An amendment may replace one author-written outline section of design.md or
// proposal.md in place: `sections: [{ document, key, body? | value?, field? }]`.
// `body` is markdown; `value` is a typed field value rendered by the field's
// own module (`field` names it when the row is fed by several typed fields).
const SECTION_DOCUMENTS = ["design", "proposal"];
const TYPED_SECTION_FIELDS = Object.freeze({ ...DESIGN_FIELDS, ...PROCESS_FIELDS });
const SECTION_ROW_FIELDS = ["document", "key", "body", "value", "field"];

function sectionTypedField(row, section) {
  if (hasField(section, "field")) return String(section.field || "").trim();
  return row.fields.find((field) => TYPED_SECTION_FIELDS[field]) || "";
}

export function amendmentSectionIssues(amendment) {
  if (amendment?.sections === undefined) return [];
  if (!Array.isArray(amendment.sections)) return ["semantic amendment sections must be an array"];
  const issues = [];
  const seen = new Set();
  for (const [index, section] of amendment.sections.entries()) {
    const path = `semantic amendment sections[${index}]`;
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      issues.push(`${path} must be an object {document, key, body | value}`);
      continue;
    }
    for (const field of Object.keys(section))
      if (!SECTION_ROW_FIELDS.includes(field)) issues.push(`${path}.${field} is not a section field`);
    const document = String(section.document || "").trim();
    const key = String(section.key || "").trim();
    if (!SECTION_DOCUMENTS.includes(document)) {
      issues.push(`${path}.document must be one of ${SECTION_DOCUMENTS.join(", ")}`);
      continue;
    }
    const row = key ? outlineRow(document, key) : null;
    if (!row) {
      issues.push(`${path}.key '${key}' is not a ${document} outline section`);
      continue;
    }
    if (row.owner !== "author") {
      issues.push(`${path}.key '${key}' is a ${row.owner} ${document} section the harness ` +
        "builds; only author sections can be replaced");
      continue;
    }
    if (seen.has(`${document}:${key}`)) issues.push(`${path} replaces ${document} '${key}' twice`);
    seen.add(`${document}:${key}`);
    const hasBody = hasField(section, "body");
    const hasValue = hasField(section, "value");
    if (hasBody === hasValue) {
      issues.push(`${path} needs exactly one of body or value`);
      continue;
    }
    if (hasBody && (typeof section.body !== "string" || !section.body.trim()))
      issues.push(`${path}.body must be non-empty markdown`);
    if (hasValue) {
      const field = sectionTypedField(row, section);
      if (!field || !row.fields.includes(field) || !TYPED_SECTION_FIELDS[field])
        issues.push(`${path}.value needs a typed field of ${document} '${key}'` +
          (field ? ` ('${field}' is not one)` : "; use body instead"));
      else {
        const fieldIssues = TYPED_SECTION_FIELDS[field].validate(section.value, field)
          .map((issue) => `${path}.value: ${issue}`);
        issues.push(...fieldIssues);
        let rendered = "";
        try { rendered = TYPED_SECTION_FIELDS[field].render(section.value, { language: "en" }); }
        catch { rendered = ""; }
        if (!fieldIssues.length && !String(rendered || "").trim())
          issues.push(`${path}.value renders an empty ${field} section`);
      }
    }
  }
  return issues;
}

// --- Markdown section editing (## level, code fences respected) -----------

function markdownBlocks(content) {
  const blocks = [{ heading: null, lines: [] }];
  let fence = null;
  for (const line of String(content).split("\n")) {
    const current = blocks[blocks.length - 1];
    if (fence) {
      if (line.trimStart().startsWith(fence)) fence = null;
      current.lines.push(line);
      continue;
    }
    const opening = line.match(/^\s*(```|~~~)/);
    if (opening) {
      fence = opening[1];
      current.lines.push(line);
      continue;
    }
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) blocks.push({ heading: heading[1], lines: [line] });
    else current.lines.push(line);
  }
  return blocks;
}

// Untouched blocks keep their exact text; a new block is separated from its
// neighbours by one blank line.
function joinBlocks(blocks) {
  const kept = blocks.filter((block) => block.lines.length);
  for (const [index, block] of kept.entries())
    if (index < kept.length - 1 && block.lines[block.lines.length - 1].trim() !== "")
      block.lines = [...block.lines, ""];
  return `${kept.map((block) => block.lines.join("\n")).join("\n").replace(/\s+$/, "")}\n`;
}

function sectionBlock(heading, body) {
  return { heading, lines: `## ${heading}\n\n${String(body).trim()}\n`.split("\n") };
}

function sectionLanguage(language) {
  return /^th\b/i.test(String(language || "")) ? "th" : "en";
}

const rowHeadings = (row) => [row.heading.en, row.heading.th];

// Replace every block whose heading is in `headings` with `block` (placed where
// the first one stood), or insert `block` before the first section the outline
// orders after `orderKey`, or at the end. `null` removes the matched blocks.
function upsertBlock(content, document, orderKey, headings, block) {
  const blocks = markdownBlocks(content);
  const matches = new Set(headings);
  const first = blocks.findIndex((entry) => matches.has(entry.heading));
  if (first >= 0) {
    const next = blocks.flatMap((entry, index) =>
      index === first ? (block ? [block] : []) : matches.has(entry.heading) ? [] : [entry]);
    return joinBlocks(next);
  }
  if (!block) return joinBlocks(blocks);
  const rows = OUTLINE[document];
  const position = rows.findIndex((row) => row.key === orderKey);
  const later = new Set(rows.slice(position + 1).flatMap(rowHeadings));
  const before = blocks.findIndex((entry) => entry.heading && later.has(entry.heading));
  if (before < 0) blocks.push(block);
  else blocks.splice(before, 0, block);
  return joinBlocks(blocks);
}

function blockOf(content, headings) {
  const matches = new Set(headings);
  return markdownBlocks(content).find((entry) => matches.has(entry.heading)) || null;
}

// Headings every earlier layout used for the investigation agreement: older
// amendments appended a fresh "Latest amended" copy each time.
const LEGACY_INVESTIGATION_HEADINGS = [
  "Latest amended investigation agreement", "Appendix: investigation provenance",
  "Investigation requirement coverage", "ความครบของ requirement จาก Investigate",
  "Retained investigation context", "บริบทที่รับจาก Investigate"
];
const DISCOVERY_DELTA_HEADING = "Amendment discovery coverage";
const REMOVED_REQUIREMENTS_HEADING = "Amendment removed requirements";

function proposalTitle(content) {
  return String(content).match(/^#\s+(?:Change:\s*)?(.+?)\s*$/m)?.[1] || "";
}

function replaceInvestigation(content, agreement) {
  const row = outlineRow("proposal", "investigation");
  const body = investigationAppendixBody(agreement, proposalTitle(content));
  const block = body
    ? sectionBlock(sectionHeading(row, sectionLanguage(agreement.language)), body) : null;
  return upsertBlock(content, "proposal", "investigation",
    [...rowHeadings(row), ...LEGACY_INVESTIGATION_HEADINGS], block);
}

function replaceDiscoveryDelta(content, compiled) {
  const rows = compiled.discovery.coverage.map((row) =>
    `| ${markdownCell(row.dimension)} | ${markdownCell(coverageStatus(row))} | ` +
    `${markdownCell((row.covers || []).join(", ") || "none")} | ` +
    `${markdownCell((row.sources || []).join(", ") || "none")} | ` +
    `${markdownCell(coverageRationale(row) || "none")} |`
  ).join("\n");
  return upsertBlock(content, "proposal", "discovery", [DISCOVERY_DELTA_HEADING],
    sectionBlock(DISCOVERY_DELTA_HEADING, `Reason: ${markdownCell(compiled.amendmentReason)}\n\n` +
      `| Dimension | Status | Requirements | Sources | Rationale |\n|---|---|---|---|---|\n${rows}`));
}

// Removed requirements accumulate across amendments in one table; a key
// removed again keeps only its latest migration.
function replaceRemovedRequirements(content, compiled) {
  const prior = blockOf(content, [REMOVED_REQUIREMENTS_HEADING]);
  const rows = new Map();
  for (const line of prior?.lines || []) {
    const cells = line.match(/^\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*$/);
    if (!cells || /^-+$/.test(cells[1]) || cells[1] === "Requirement") continue;
    rows.set(cells[1], line.trim());
  }
  for (const row of compiled.removedRequirements)
    rows.set(markdownCell(row.key), `| ${markdownCell(row.key)} | ${markdownCell(row.migration)} |`);
  return upsertBlock(content, "proposal", "discovery", [REMOVED_REQUIREMENTS_HEADING],
    sectionBlock(REMOVED_REQUIREMENTS_HEADING, `Reason: ${markdownCell(compiled.amendmentReason)}\n\n` +
      `| Requirement | Migration |\n|---|---|\n${[...rows.values()].join("\n")}`));
}

// One history line per amendment: revision, date, and reason.
function appendAmendmentHistory(content, compiled, { revision, date } = {}) {
  const row = outlineRow("proposal", "amendments");
  const headings = rowHeadings(row);
  const prior = blockOf(content, headings);
  const lines = (prior?.lines.slice(1) || []).filter((line) => /^\s*-\s+\S/.test(line));
  const number = Number.isInteger(revision) && revision > 0 ? revision : lines.length + 1;
  const day = String(date || new Date().toISOString()).slice(0, 10);
  lines.push(`- Revision ${number} (${day}): ${String(compiled.amendmentReason || "")
    .replace(/\s*\r?\n\s*/g, " ").trim()}`);
  const heading = prior?.heading ||
    sectionHeading(row, sectionLanguage(compiled.investigationAgreement?.language));
  return upsertBlock(content, "proposal", "amendments", headings,
    sectionBlock(heading, lines.join("\n")));
}

function renderSectionBody(section, language) {
  if (hasField(section, "body")) return section.body;
  const row = outlineRow(section.document, section.key);
  const field = sectionTypedField(row, section);
  return TYPED_SECTION_FIELDS[field].render(section.value, { language });
}

// design.md renders the marker rows with their English heading whatever the
// language; any heading of the row matches, so the section is replaced in place.
const ENGLISH_DESIGN_HEADINGS = new Set(["workType", "decisions", "bugfix", "refactor"]);

function replaceOutlineSection(content, section, language) {
  const row = outlineRow(section.document, section.key);
  const body = String(renderSectionBody(section, language) || "").trim();
  if (!body) throw new Error(`amendment section ${section.document} '${section.key}' renders empty`);
  const existing = blockOf(content, rowHeadings(row));
  const heading = existing?.heading || (section.document === "design" &&
    ENGLISH_DESIGN_HEADINGS.has(row.key) ? row.heading.en : sectionHeading(row, language));
  return upsertBlock(content, section.document, row.key, rowHeadings(row),
    sectionBlock(heading, body));
}

function packetLanguage(content, fallback) {
  if (fallback) return sectionLanguage(fallback);
  return /[฀-๿]/.test(String(content).split("\n").filter((line) => /^##\s/.test(line))
    .join("\n")) ? "th" : "en";
}

// A corrected verify command replaces a failing check, so it must still be a
// check: a command that cannot fail would turn the task's acceptance (and any
// provider command derived from it) into a pass with no evidence behind it.
// A text screen, so best-effort: it catches a no-op as the whole command or as
// the last command after `;`, `||`, `|`, `&`, or a newline (`&&` still fails).
export function verifyCannotFail(command) {
  const text = String(command || "").trim().replace(/\s+#[^'"\n]*$/, "").trim();
  return /^\(?\s*(?:true|:|exit(?:\s+0)?|echo(?:\s.*)?|printf(?:\s.*)?)\s*\)?$/i.test(text) ||
    /(?:;|\n|\|\|?|(?<!&)&(?!&))\s*\(?\s*(?:true|:|exit(?:\s+0)?|echo(?:\s[^;&|\n]*)?|printf(?:\s[^;&|\n]*)?)\s*\)?\s*$/i
      .test(text);
}

// A test source file named in a verify command. Build used to discover a
// mistyped or never-created test path only when the check ran; the draft
// already says which files exist and which files its tasks create.
const TEST_SOURCE = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kts?|scala|php|cs|fs|swift|exs?|sh|bash|lua|dart|c|cc|cpp|clj)$/i;
const TEST_NAME = /(?:^|[/._-])(?:tests?|specs?|__tests__|e2e)(?:[/._-]|$)/i;
// A command that changes its working directory resolves paths elsewhere.
const WORKING_DIRECTORY_CHANGE =
  /(?:^|[;&|(]\s*)(?:cd|pushd)\s|--prefix\b|--cwd\b|--dir(?:ectory)?\b|--workspace\b|--filter\b|--root-dir\b|--rootDir\b|(?:^|\s)-C\s/;

export function verifyTestFileReferences(command) {
  const text = String(command || "");
  if (!text.trim() || WORKING_DIRECTORY_CHANGE.test(text)) return [];
  return unique(text.split(/\s+/).map((token) => token
    .replace(/^['"(]+|['");,]+$/g, "")
    .replace(/^--?[\w-]+=/, "")
    .replace(/::.*$/, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/^\.\//, ""))
    .filter((token) => token && !token.startsWith("-") && !token.startsWith("/") &&
      !token.includes("..") && !/[*?{}[\]$<>`~]/.test(token) && !/^[a-z]+:\/\//i.test(token) &&
      TEST_SOURCE.test(token) && TEST_NAME.test(token)));
}

/**
 * Agent repairs for task verify commands that name a test file which neither
 * exists nor falls inside any task's paths (the files Build may create).
 * `tasks` rows carry { key|semanticKey|id, verify, paths, repository? };
 * `scopes` adds paths owned by tasks outside this batch.
 */
export function verifyPathIssues(tasks, { exists, scopes = [], label = "task" } = {}) {
  const rows = Array.isArray(tasks) ? tasks.filter((task) => task && typeof task === "object") : [];
  const owned = [...stringList(scopes), ...rows.flatMap((task) => stringList(task.paths))];
  const issues = [];
  rows.forEach((task, index) => {
    const repository = String(task.repository || "").trim();
    if (repository && repository !== "root") return;
    const name = String(task.semanticKey || task.key || task.id || "").trim() || `#${index + 1}`;
    for (const path of verifyTestFileReferences(task.verify)) {
      if (exists(path) || owned.some((scope) => scopeAllowsPath(scope, path))) continue;
      issues.push(`${label} '${name}' verify references '${path}', which does not exist and ` +
        "no task's paths create it; correct the path in verify or add it to that task's paths");
    }
  });
  return issues;
}

/** The same check for an amendment's added and updated tasks. */
export function amendmentVerifyPathIssues(amendment, tasksContent, { exists }) {
  const lines = String(tasksContent || "").split("\n").filter((line) => taskId(line));
  const existing = new Map(lines.map((line) => [semanticTaskKey(line) || taskId(line), line]));
  const updated = amendmentList(amendment, "updateTasks").filter((task) =>
    task && hasField(task, "verify")).map((task) => {
    const line = existing.get(keyOf(task)) || existing.get(String(task.key || "").toUpperCase());
    return { key: keyOf(task), verify: task.verify,
      paths: hasField(task, "paths") ? task.paths : line ? taskPaths(line) : [] };
  });
  const added = amendmentList(amendment, "addTasks");
  return verifyPathIssues([...added, ...updated], {
    exists, label: "amendment task",
    scopes: lines.flatMap((line) => taskPaths(line))
  });
}

// ---- Task repository binding --------------------------------------------------
// A task runs, and its verify command runs, from the root of its repository.
// A project that keeps code in declared repositories (submodules, siblings)
// must bind each task to the repository that owns its files; otherwise Build
// dispatches the work to the control root, where the code is not.

const GLOB = /[*?{}[\]]/;
const DYNAMIC_PATH = /[$`]/;

function literalPrefix(path) {
  const text = String(path || "").trim().replace(/^\.\//, "").replace(/\/+$/, "");
  const parts = text.split("/");
  const index = parts.findIndex((part) => GLOB.test(part));
  return (index < 0 ? parts : parts.slice(0, index)).join("/");
}

const atOrUnder = (path, directory) =>
  Boolean(directory) && (path === directory || path.startsWith(`${directory}/`));

function normalizedRelative(base, target) {
  const parts = [];
  for (const part of `${base ? `${base}/` : ""}${target}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length || parts.at(-1) === "..") parts.push("..");
      else parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

const unquote = (value) => String(value || "").replace(/^(['"])(.*)\1$/, "$2");

/**
 * Working-directory changes a verify command makes, resolved against the
 * directory it starts in: `cd`/`pushd` targets (which accumulate), and
 * `-C`, `--prefix`, `--cwd`, `--dir`, or `--directory` arguments (which apply
 * to one tool). Dynamic targets (`$VAR`, command substitution) are unknown and
 * omitted. A text screen, so best-effort like `verifyCannotFail`.
 */
export function verifyDirectoryTargets(command) {
  const text = String(command || "");
  const targets = [];
  let current = "";
  const pattern = new RegExp(String.raw`(?:^|[;&|(]|&&|\|\|)\s*(cd|pushd)(?=$|[\s;&|)])(?:[ \t]+("[^"]*"|'[^']*'|[^\s;&|)]+))?` +
    String.raw`|(?:^|\s)(?:-C|--prefix|--cwd|--dir|--directory)(?:=|\s+)("[^"]*"|'[^']*'|[^\s;&|)]+)`, "g");
  for (const match of text.matchAll(pattern)) {
    const raw = unquote(match[2] ?? match[3] ?? "");
    const shell = Boolean(match[1]);
    if (shell && (!raw || raw === "-")) {
      if (!raw) targets.push({ raw: "~", outside: true, path: null });
      continue;
    }
    if (DYNAMIC_PATH.test(raw)) continue;
    if (raw.startsWith("/") || raw.startsWith("~")) {
      targets.push({ raw, outside: true, path: null });
      continue;
    }
    const path = normalizedRelative(current, raw);
    const outside = path === ".." || path.startsWith("../");
    targets.push({ raw, outside, path: outside ? null : path });
    if (shell && !outside) current = path;
  }
  return targets;
}

// Declared repositories other than root: nested ones and trusted siblings
// (`../sdk`, admitted by the catalog only with allowOutsideRoot).
function catalogRepositories(repositories) {
  return (Array.isArray(repositories) ? repositories : [])
    .filter((row) => row && row.id && row.id !== "root")
    .map((row) => ({
      id: String(row.id),
      path: String(row.relativePath || "").replace(/^\.\//, "").replace(/\/+$/, ""),
      absolutePath: row.path || null,
      mode: row.mode === "read" ? "read" : "write"
    }))
    .filter((row) => row.path && row.path !== "." && row.path !== "..");
}

function selectionEntries(selection) {
  return new Map((Array.isArray(selection) ? selection : [])
    .map((entry) => typeof entry === "string" ? { id: entry } : entry)
    .filter((entry) => entry?.id).map((entry) => [String(entry.id).trim(), entry]));
}

function selectionIds(selection) {
  return (Array.isArray(selection) ? selection : [])
    .map((entry) => String(typeof entry === "string" ? entry : entry?.id || "").trim())
    .filter(Boolean);
}

/**
 * Agent repairs for tasks bound to the wrong repository: a root task whose
 * paths or verify reach into a declared repository, a repository task whose
 * paths are written from the control root, a task naming a repository the
 * draft does not select, and a verify command that changes into a directory
 * outside its task repository. `repositories` are catalog rows
 * ({id, relativePath, path}); `selection` is the draft's `repositories`.
 */
export function taskRepositoryIssues(tasks, {
  repositories = [], selection, exists = () => false, label = "task", selectionSource = "draft"
} = {}) {
  const rows = Array.isArray(tasks) ? tasks.filter((task) => task && typeof task === "object") : [];
  const declared = catalogRepositories(repositories);
  const byId = new Map(declared.map((row) => [row.id, row]));
  const selected = selectionIds(selection);
  const selectedSet = new Set(selected);
  const selectedEntries = selectionEntries(selection);
  const selectsOtherRepository = selected.some((id) => id !== "root");
  const declaredList = declared.map((row) => `${row.id} (${row.path})`).join(", ");
  const owner = (path) => declared.find((row) => atOrUnder(path, row.path)) || null;
  const issues = [];
  rows.forEach((task, index) => {
    const name = String(task.semanticKey || task.key || task.id || "").trim() || `#${index + 1}`;
    const repository = String(task.repository || "").trim() || "root";
    const repositoryRow = byId.get(repository) || null;
    const subject = `${label} '${name}'`;
    if (repository !== "root" && declared.length && !repositoryRow)
      issues.push(`${subject} names repository '${repository}', which ` +
        `openspec/repositories.yaml does not declare; use one of: ${declaredList}`);
    if (repository !== "root" && !selectedSet.has(repository))
      issues.push(selectionSource === "change"
        ? `${subject} runs in repository '${repository}', which this change does not select; ` +
          "bind it to a selected repository (a new repository needs 'change revise' before Build)"
        : `${subject} runs in repository '${repository}', which the draft's 'repositories' ` +
          `does not list; add { "id": "${repository}", "mode": "write" } to 'repositories'`);
    const mode = selectedEntries.get(repository)?.mode || repositoryRow?.mode;
    if (repositoryRow && mode === "read" && stringList(task.paths).length)
      issues.push(`${subject} edits files in repository '${repository}', which is read-only ` +
        "in this change; bind the task to a writable repository");
    if (!String(task.repository || "").trim() && selectsOtherRepository)
      issues.push(`${subject} names no 'repository' while the draft selects ` +
        `${selected.join(", ")}; set 'repository' to the one that owns its files`);
    for (const path of stringList(task.paths)) {
      const prefix = literalPrefix(path);
      if (repository === "root") {
        const inside = prefix && owner(prefix);
        if (inside)
          issues.push(`${subject} path '${path}' is inside repository '${inside.id}' ` +
            `(${inside.path}) but the task runs in root; set "repository": "${inside.id}", write ` +
            `its paths and verify relative to ${inside.path}, and list ${inside.id} in 'repositories'`);
      } else if (repositoryRow && atOrUnder(prefix, repositoryRow.path)) {
        const relativePath = path.replace(/^\.\//, "").slice(repositoryRow.path.length + 1) || "**";
        issues.push(`${subject} path '${path}' is written from the control root; task ` +
          `paths are relative to repository '${repository}', so write '${relativePath}'`);
      }
    }
    for (const target of verifyDirectoryTargets(task.verify)) {
      if (target.outside) {
        issues.push(`${subject} verify changes into '${target.raw}', outside repository ` +
          `'${repository}'; verify runs from that repository's root, so name a path inside it`);
        continue;
      }
      if (repository === "root") {
        const inside = owner(target.path);
        if (inside)
          issues.push(`${subject} verify changes into '${target.raw}', which is repository ` +
            `'${inside.id}'; set "repository": "${inside.id}" and write verify to run from its root`);
        continue;
      }
      const reached = owner(target.path);
      if (!reached) continue;
      const local = repositoryRow?.absolutePath &&
        exists(`${repositoryRow.absolutePath}/${target.path}`);
      if (local) continue;
      issues.push(reached.id === repository
        ? `${subject} verify changes into '${target.raw}', but verify already runs from ` +
          `repository '${repository}' (${reached.path}); remove that directory change`
        : `${subject} verify changes into '${target.raw}', which is repository ` +
          `'${reached.id}'; verify runs from repository '${repository}', so split the check ` +
          `into a task bound to '${reached.id}'`);
    }
  });
  return unique(issues);
}

/**
 * Repository-derived order for an amendment's added tasks, exactly as start
 * derives it: an added task follows the ledger's and the amendment's tasks in
 * repositories nested inside its own (or that its repository `dependsOn`).
 * Existing ledger lines keep their edges. `newTasks` are {id, semanticKey,
 * repository, dependsOn} rows whose dependsOn already holds task ids.
 */
export function deriveAmendmentTaskDependencies(newTasks, tasksContent, options = {}) {
  const existing = String(tasksContent || "").split("\n").filter((line) => taskId(line))
    .map((line) => ({
      id: taskId(line), semanticKey: semanticTaskKey(line),
      repository: String(line).match(/\[repo:([^\]\s]+)\]/i)?.[1] || "root",
      dependsOn: taskDepends(line)
    }));
  const derived = deriveRepositoryTaskDependencies([...existing, ...newTasks], {
    ...options, consumers: new Set(newTasks.map((task) => task.id))
  });
  return {
    tasks: derived.tasks.slice(existing.length),
    issues: derived.issues.map((issue) => `amendment ${issue}`)
  };
}

/** The repository-order issues `change amend --inspect` reports in one EDIT. */
export function amendmentRepositoryOrderIssues(amendment, tasksContent, options = {}) {
  const added = amendmentList(amendment, "addTasks").filter((task) => keyOf(task));
  if (!added.length) return [];
  const existingIds = new Map(String(tasksContent || "").split("\n")
    .filter((line) => taskId(line))
    .flatMap((line) => [[semanticTaskKey(line), taskId(line)], [taskId(line), taskId(line)]]));
  const addedKeys = new Set(added.map(keyOf));
  const resolve = (value) => addedKeys.has(value) ? value
    : existingIds.get(value) || existingIds.get(String(value).toUpperCase()) || value;
  return deriveAmendmentTaskDependencies(added.map((task) => ({
    id: keyOf(task), semanticKey: keyOf(task),
    repository: String(task.repository || "").trim() || "root",
    dependsOn: stringList(task.dependsOn).map(resolve)
  })), tasksContent, options).issues;
}

/** The same repository checks for an amendment's added and updated tasks. */
export function amendmentTaskRepositoryIssues(amendment, tasksContent, options = {}) {
  const lines = String(tasksContent || "").split("\n").filter((line) => taskId(line));
  const existing = new Map(lines.flatMap((line) => [
    [semanticTaskKey(line) || taskId(line), line], [taskId(line), line]]));
  const repositoryOf = (line) => String(line).match(/\[repo:([^\]\s]+)\]/)?.[1] || "";
  const updated = amendmentList(amendment, "updateTasks").filter((task) =>
    task && (hasField(task, "verify") || hasField(task, "paths"))).map((task) => {
    const line = existing.get(keyOf(task)) || existing.get(keyOf(task).toUpperCase()) || "";
    return { key: keyOf(task), repository: repositoryOf(line),
      verify: hasField(task, "verify") ? task.verify : "",
      paths: hasField(task, "paths") ? task.paths : [] };
  });
  return taskRepositoryIssues([...amendmentList(amendment, "addTasks"), ...updated], {
    ...options, selection: options.selection ?? ["root"], label: "amendment task",
    selectionSource: "change"
  });
}

/**
 * The verify-only amendment `change amend <change> --task <key> --verify
 * <command>` submits: an unfinished task's check corrected in place, with the
 * spec approval, requirements, claims, and capabilities untouched.
 */
export function taskVerifyAmendment({ task, verify, reason = "", reopen = false }) {
  return {
    version: 1,
    reason: String(reason || "").trim() ||
      `Correct the verify command of task '${String(task || "").trim()}'`,
    updateTasks: [{ key: String(task || "").trim(), verify: String(verify || "").trim(),
      ...(reopen === true ? { reopen: true } : {}) }]
  };
}

// Runs the verify-only amendment through the same transactional `change
// amend` path (validation, invalidation, rollback, approval carry) without the
// agent authoring a JSON file. The staged file lives in machine state and is
// removed on success, failure, or exit.
export function amendTaskVerifyOperation({ root, amendChange, pid = process.pid,
  now = Date.now, onExit = (cleanup) => process.once("exit", cleanup) }, id, options) {
  const directory = join(root, ".foundation", "amendments");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${id}-verify-${now()}-${pid}.json`);
  writeFileSync(path, `${JSON.stringify(taskVerifyAmendment(options), null, 2)}\n`);
  const cleanup = () => rmSync(path, { force: true });
  onExit(cleanup);
  try { return amendChange(id, path, { consumeAmendment: true }); }
  finally { cleanup(); }
}

function amendmentIssues(amendment) {
  const issues = [];
  if (amendment?.version !== 1) issues.push("semantic amendment requires version 1");
  for (const field of ["addRequirements", "reviseRequirements", "removeRequirements"])
    if (amendment?.[field] !== undefined && !Array.isArray(amendment[field]))
      issues.push(`semantic amendment ${field} must be an array`);
  const added = amendmentList(amendment, "addRequirements");
  const revised = amendmentList(amendment, "reviseRequirements");
  const removed = amendmentList(amendment, "removeRequirements");
  const sectionIssues = amendmentSectionIssues(amendment);
  issues.push(...sectionIssues);
  const sectionsOnly = !sectionIssues.length && amendmentList(amendment, "sections").length > 0 &&
    ["updateTasks", "addTasks", "removeTasks"].every((field) => !amendmentList(amendment, field).length);
  if (!added.length && !revised.length && !removed.length &&
      !taskContractOnlyAmendment(amendment) && !sectionsOnly)
    issues.push("semantic amendment requires a non-empty addRequirements, " +
      "reviseRequirements, or removeRequirements array, or only updateTasks " +
      "{key, verify, paths?, dependsOn?, reopen?} rows, removeTasks, and addTasks " +
      "that cover existing requirements, or only sections");
  if ((added.length || revised.length) && (!amendment?.evidence ||
      typeof amendment.evidence !== "object" || Array.isArray(amendment.evidence)))
    issues.push("semantic amendment requires evidence keyed by each added or revised requirement");
  for (const [index, row] of removed.entries()) {
    if (!keyOf(row)) issues.push(`semantic amendment removeRequirements[${index}].key is required`);
    if (!String(row?.migration || "").trim())
      issues.push(`semantic amendment removeRequirements[${index}].migration is required`);
  }
  if (amendment?.updateTasks !== undefined && !Array.isArray(amendment.updateTasks))
    issues.push("semantic amendment updateTasks must be an array");
  for (const [index, task] of (Array.isArray(amendment?.updateTasks)
    ? amendment.updateTasks : []).entries()) {
    if (hasField(task, "verify") && (typeof task.verify !== "string" ||
        !task.verify.trim() || /[`\r\n]/.test(task.verify)))
      issues.push(`semantic amendment updateTasks[${index}].verify must be a ` +
        "non-empty one-line command without backticks");
    else if (hasField(task, "verify") && verifyCannotFail(task.verify))
      issues.push(`semantic amendment updateTasks[${index}].verify cannot be a command ` +
        "that always passes; name the focused check that proves the task");
    if (hasField(task, "paths") && (!Array.isArray(task.paths) ||
        task.paths.some((path) => typeof path !== "string" || !path.trim() || /[,\]\s]/.test(path))))
      issues.push(`semantic amendment updateTasks[${index}].paths must be an array of ` +
        "path globs without commas, brackets, or spaces");
    if (hasField(task, "dependsOn") && (!Array.isArray(task.dependsOn) ||
        task.dependsOn.some((value) => typeof value !== "string" || !value.trim())))
      issues.push(`semantic amendment updateTasks[${index}].dependsOn must be an array of task keys or ids`);
    if (hasField(task, "reopen") && typeof task.reopen !== "boolean")
      issues.push(`semantic amendment updateTasks[${index}].reopen must be true or false`);
  }
  if (amendment?.addTasks !== undefined && !Array.isArray(amendment.addTasks))
    issues.push("semantic amendment addTasks must be an array");
  if (amendment?.removeTasks !== undefined && !Array.isArray(amendment.removeTasks))
    issues.push("semantic amendment removeTasks must be an array");
  for (const [index, row] of amendmentList(amendment, "removeTasks").entries())
    if (!removalRef(row))
      issues.push(`semantic amendment removeTasks[${index}] must name a task key or id`);
  return issues;
}

// The merged ledger (updated, kept, and added tasks) must stay acyclic, so a
// cycle is an amendment repair rather than a Build-time planning failure.
function amendedTaskCycleIssues(taskLines, addTasks, resolveTaskId) {
  const graph = new Map();
  for (const line of taskLines) {
    const id = line === null ? null : taskId(line);
    if (id) graph.set(id, taskDepends(line));
  }
  const addedKeys = new Set(addTasks.map(keyOf).filter(Boolean));
  for (const task of addTasks) {
    if (!keyOf(task)) continue;
    graph.set(`key:${keyOf(task)}`, stringList(task?.dependsOn).map((dependency) =>
      addedKeys.has(dependency) ? `key:${dependency}` : resolveTaskId(dependency))
      .filter(Boolean));
  }
  const label = (node) => node.startsWith("key:") ? `'${node.slice(4)}'` : node;
  const visiting = [];
  const visited = new Set();
  const cycles = [];
  const visit = (node) => {
    const at = visiting.indexOf(node);
    if (at >= 0) { cycles.push([...visiting.slice(at), node]); return; }
    if (visited.has(node) || !graph.has(node)) return;
    visiting.push(node);
    for (const dependency of graph.get(node)) visit(dependency);
    visiting.pop();
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return cycles.map((cycle) => `amendment task dependencies contain a cycle: ` +
    `${cycle.map(label).join(" -> ")}; update dependsOn so the tasks form an order`);
}

export function compileSemanticAmendment({
  amendment, contract, tasksContent, slugify, renderTask, semanticDraftVersion = 3,
  loadCanonicalSpec = null, provenClaimIds = [], retiredTaskIds = [],
  repositories = null, repositorySelection = null, investigationSource = null
}) {
  const issues = amendmentIssues(amendment);
  const investigationAgreement = amendmentInvestigationSource(investigationSource, amendment);
  if (investigationAgreement) issues.push(...investigationCoverageIssues(investigationAgreement));
  if (!isSemanticVersion(semanticDraftVersion))
    issues.push("semantic amendment requires semanticDraftVersion 3, 4, or 5");
  const existingClaims = contract.claims || [];
  const priorClaimById = new Map(existingClaims.map((claim) => [claim.id, claim]));
  const claimsByRequirement = new Map();
  for (const claim of existingClaims) {
    if (!claim.requirementKey) continue;
    claimsByRequirement.set(claim.requirementKey, [
      ...(claimsByRequirement.get(claim.requirementKey) || []), claim.id
    ]);
  }
  const taskLines = String(tasksContent).split("\n");
  const tasksByKey = new Map();
  const tasksById = new Map();
  // A withdrawn task's id is never reused, so its old leases, receipts, and
  // audit rows cannot be mistaken for a new task's.
  let maxTask = Math.max(0, ...stringList(retiredTaskIds)
    .map((id) => Number(id.replace(/^T/i, "")) || 0));
  for (const [index, line] of taskLines.entries()) {
    const id = taskId(line);
    if (id) maxTask = Math.max(maxTask, Number(id.slice(1)) || 0);
    if (id) tasksById.set(id, { index, line, id, key: semanticTaskKey(line) });
    const key = semanticTaskKey(line);
    if (key) tasksByKey.set(key, { index, line, id });
  }
  const resolveTaskId = (reference) => {
    const value = String(reference || "").trim();
    return tasksByKey.get(value)?.id || tasksById.get(value.toUpperCase())?.id || null;
  };
  // The agent sees task ids in every Build action; a task-contract row may
  // name one (`T002`) in place of the semantic key it resolves to.
  if (Array.isArray(amendment?.updateTasks)) {
    const keyById = new Map([...tasksByKey].filter(([, row]) => row.id)
      .map(([key, row]) => [row.id, key]));
    amendment = { ...amendment, updateTasks: amendment.updateTasks.map((row) => {
      const named = keyOf(row);
      const resolved = !tasksByKey.has(named) && keyById.get(named.toUpperCase());
      return resolved ? { ...row, key: resolved } : row;
    }) };
  }

  // Outcome never changes in place. Verify, paths, and dependencies change in
  // place only on an unfinished task (unchecked and without a passing command
  // receipt), or on a completed one that `reopen: true` unticks so the
  // harness verifies it again: a changed check never keeps a completed status.
  const proven = new Set(stringList(provenClaimIds));
  const completedTask = (line) => taskCompleted(line) ||
    taskClaims(line).some((id) => proven.has(id));
  const taskContractChanges = [];
  for (const [index, update] of (Array.isArray(amendment?.updateTasks)
    ? amendment.updateTasks : []).entries()) {
    const row = tasksByKey.get(keyOf(update));
    const completed = row && completedTask(row.line);
    const changes = {};
    if (row && typeof update?.verify === "string" && update.verify.trim() !== taskVerify(row.line)) {
      changes.verify = update.verify.trim();
      changes.priorVerify = taskVerify(row.line) || null;
    }
    if (row && Array.isArray(update?.paths) &&
        JSON.stringify(stringList(update.paths)) !== JSON.stringify(taskPaths(row.line)))
      changes.paths = stringList(update.paths);
    if (row && Array.isArray(update?.dependsOn)) {
      const references = stringList(update.dependsOn);
      const unknown = references.filter((reference) => !resolveTaskId(reference));
      const dependsOn = unique(references.map(resolveTaskId).filter(Boolean));
      if (unknown.length)
        issues.push(`semantic amendment updateTasks[${index}].dependsOn references unknown ` +
          `task(s): ${unknown.join(", ")}`);
      else if (dependsOn.includes(row.id))
        issues.push(`semantic amendment updateTasks[${index}].dependsOn cannot name the task itself`);
      else if (JSON.stringify(dependsOn) !== JSON.stringify(taskDepends(row.line)))
        changes.dependsOn = dependsOn;
    }
    const reopening = Boolean(completed && update?.reopen === true &&
      TASK_CONTRACT_FIELDS.some((field) => hasField(changes, field)));
    const unsupported = [
      ...(hasField(update, "outcome") ? ["outcome"] : []),
      ...(completed && !reopening
        ? TASK_CONTRACT_FIELDS.filter((field) => hasField(changes, field)) : [])
    ];
    // Name the state that made the task complete: a sandbox copy can be ticked
    // while the main tree is not, and a receipt can complete an unticked task.
    const completedBecause = !completed ? "" : taskCompleted(row.line)
      ? ` (task '${keyOf(update)}' (${row.id}) counts as completed because it is ticked in ` +
        "the agreement's tasks.md)"
      : ` (task '${keyOf(update)}' (${row.id}) counts as completed because its claims ` +
        "already have a passing command receipt)";
    if (unsupported.length)
      issues.push(`semantic amendment updateTasks[${index}] cannot replace ${
        unsupported.join(" or ")}; add a new task so completed work keeps its meaning` +
        (unsupported.includes("outcome") ? "" : ", or set \"reopen\": true to re-open the " +
          `task so the harness verifies it again${completedBecause}`));
    else if (row && Object.keys(changes).length)
      taskContractChanges.push({ key: keyOf(update), index: row.index, ...changes,
        ...(reopening ? { reopened: true } : {}) });
  }

  // Only unfinished work can be withdrawn. A task another task depends on
  // stays unless that dependent is withdrawn too or its dependsOn is updated.
  const removalRefs = amendmentList(amendment, "removeTasks").map(removalRef).filter(Boolean);
  const removedTaskRows = [];
  for (const reference of unique(removalRefs)) {
    const id = resolveTaskId(reference);
    const row = id ? tasksById.get(id) : null;
    if (!row) {
      issues.push(`amendment removeTasks references unknown task '${reference}'`);
      continue;
    }
    if (removedTaskRows.some((removed) => removed.id === row.id)) continue;
    if (completedTask(row.line)) {
      issues.push(`amendment cannot remove completed task '${row.key || row.id}' (${row.id}); ` +
        "completed work keeps its meaning, so remove its requirement or start a successor change");
      continue;
    }
    if ((amendment.updateTasks || []).some((update) => resolveTaskId(keyOf(update)) === row.id))
      issues.push(`amendment cannot both update and remove task '${row.key || row.id}'`);
    removedTaskRows.push({ ...row, claims: taskClaims(row.line), verify: taskVerify(row.line) });
  }
  const removedTaskIds = new Set(removedTaskRows.map((row) => row.id));
  if (taskContractOnlyAmendment(amendment) && !taskContractChanges.length &&
      !removalRefs.length && !amendmentList(amendment, "addTasks").length &&
      (amendment.updateTasks || []).every((update) => tasksByKey.has(keyOf(update))) &&
      !issues.some((issue) => issue.startsWith("semantic amendment updateTasks[")))
    issues.push("semantic amendment updateTasks changes no verify command or paths (or dependencies)");
  for (const change of taskContractChanges) {
    let line = taskLines[change.index];
    if (change.verify !== undefined) line = replaceTaskVerify(line, change.verify);
    if (change.paths !== undefined) line = replaceTaskPaths(line, change.paths);
    if (change.dependsOn !== undefined) line = replaceTaskDepends(line, change.dependsOn);
    if (change.reopened) line = reopenTask(line);
    taskLines[change.index] = line;
    tasksByKey.set(change.key, { ...tasksByKey.get(change.key), line });
  }
  for (const line of taskLines) {
    const id = taskId(line);
    if (!id || removedTaskIds.has(id)) continue;
    const blocked = taskDepends(line).filter((dependency) => removedTaskIds.has(dependency));
    if (blocked.length)
      issues.push(`amendment cannot remove ${blocked.join(", ")}: task ${id} depends on it; ` +
        `remove ${id} too or update its dependsOn`);
  }
  for (const task of amendmentList(amendment, "addTasks"))
    for (const dependency of stringList(task?.dependsOn))
      if (removedTaskIds.has(resolveTaskId(dependency)))
        issues.push(`amendment task '${keyOf(task)}' depends on removed task '${dependency}'`);
  // Removed lines (and their indented detail lines) leave the ledger last, so
  // every index above stays valid while the amendment is checked.
  for (const row of removedTaskRows) {
    taskLines[row.index] = null;
    for (let next = row.index + 1; next < taskLines.length; next += 1) {
      const line = taskLines[next];
      if (line === null || taskId(line) || !/^\s+\S/.test(line)) break;
      taskLines[next] = null;
    }
    if (row.key) tasksByKey.delete(row.key);
  }

  const addRequirements = amendmentList(amendment, "addRequirements");
  const reviseRequirements = amendmentList(amendment, "reviseRequirements");
  const removeRequirements = amendmentList(amendment, "removeRequirements");
  const addedKeys = new Set(addRequirements.map(keyOf));
  const revisedKeys = new Set(reviseRequirements.map(keyOf).filter(Boolean));
  const removedKeys = new Set(removeRequirements.map(keyOf).filter(Boolean));
  const changedKeys = new Set([...addedKeys, ...revisedKeys]);
  const named = [...addRequirements, ...reviseRequirements, ...removeRequirements]
    .map(keyOf).filter(Boolean);
  for (const key of unique(named.filter((key, index) => named.indexOf(key) !== index)))
    issues.push(`amendment requirement '${key}' is named more than once across ` +
      "add, revise, and remove");
  for (const key of addedKeys)
    if (claimsByRequirement.has(key)) issues.push(`amendment requirement '${key}' already exists`);
  for (const key of [...revisedKeys, ...removedKeys])
    if (!claimsByRequirement.has(key))
      issues.push(`amendment requirement '${key}' does not exist; only existing ` +
        "requirements can be revised or removed");
  const retiredClaimIds = new Set([...revisedKeys, ...removedKeys]
    .flatMap((key) => claimsByRequirement.get(key) || []));

  const updateKeys = new Set((amendment.updateTasks || []).map(keyOf));
  const coverageTasks = [
    ...(amendment.updateTasks || []).map((task) => ({
      key: task.key,
      outcome: `Extend ${task.key}`,
      verify: taskVerify(tasksByKey.get(task.key)?.line),
      covers: stringList(task.covers).filter((key) => changedKeys.has(key))
    })),
    ...(amendment.addTasks || []).map((task) => ({ ...task, dependsOn: [] })),
    // Existing tasks bound to a revised requirement keep covering it.
    ...[...tasksByKey].filter(([key]) => !updateKeys.has(key)).map(([key, row]) => ({
      key,
      outcome: `Keep ${key}`,
      verify: taskVerify(row.line) || "existing",
      covers: [...revisedKeys].filter((requirement) =>
        (claimsByRequirement.get(requirement) || [])
          .some((id) => taskClaims(row.line).includes(id)))
    }))
  ].filter((task) => stringList(task.covers).some((key) => changedKeys.has(key)));
  // A removal-only amendment adds no semantic rows, so there is nothing to
  // normalize; the prior discovery coverage stays in the proposal.
  const normalized = !changedKeys.size ? {
    issues: [], draft: { claims: [], specs: [], execution: { providers: {} } }
  } : normalizeSemanticDraft({
    version: semanticDraftVersion,
    intent: amendment.reason || "Amend the active agreement",
    impact: amendment.impact || "low",
    requirements: [...addRequirements,
      ...reviseRequirements.map((row) => ({ ...row, _revision: true }))],
    tasks: coverageTasks,
    evidence: amendment.evidence,
    integrations: amendment.integrations || [],
    securityTriggers: amendment.securityTriggers || [],
    riskSignals: amendment.riskSignals || [],
    externalOperations: amendment.externalOperations || [],
    ...(amendment.capabilityOverviews && typeof amendment.capabilityOverviews === "object"
      ? { capabilityOverviews: amendment.capabilityOverviews } : {}),
    discovery: amendment.discovery
  }, slugify, {
    ...(loadCanonicalSpec ? { loadCanonicalSpec } : {}),
    // Derived IDs for new scenarios step around the claims this change keeps.
    reservedClaimIds: [...priorClaimById.keys()].filter((id) => !retiredClaimIds.has(id))
  });
  issues.push(...normalized.issues.map((issue) => `amendment ${issue}`));
  const duplicateClaims = normalized.draft.claims
    .map((claim) => claim.id).filter((id) => priorClaimById.has(id) && !retiredClaimIds.has(id));
  if (duplicateClaims.length)
    issues.push(`amendment derives existing claim ID(s): ${unique(duplicateClaims).join(", ")}`);

  for (const update of amendment.updateTasks || []) {
    const key = String(update?.key || "").trim();
    if (!tasksByKey.has(key)) issues.push(`amendment updateTasks references unknown task '${key}'`);
    for (const covered of stringList(update?.covers)) {
      if (removedKeys.has(covered))
        issues.push(`amendment task '${key}' covers removed requirement '${covered}'`);
      else if (!changedKeys.has(covered) && !claimsByRequirement.has(covered))
        issues.push(`amendment task '${key}' covers unknown requirement '${covered}'`);
    }
  }
  for (const task of amendment.addTasks || []) {
    const key = String(task?.key || "").trim();
    if (tasksByKey.has(key)) issues.push(`amendment addTasks key '${key}' already exists`);
    if (!stringList(task?.covers).length)
      issues.push(`amendment task '${key}' must cover at least one requirement`);
    for (const covered of stringList(task?.covers)) {
      if (removedKeys.has(covered))
        issues.push(`amendment task '${key}' covers removed requirement '${covered}'`);
      else if (!changedKeys.has(covered) && !claimsByRequirement.has(covered))
        issues.push(`amendment task '${key}' covers unknown requirement '${covered}'`);
    }
    for (const dependency of stringList(task?.dependsOn))
      if (!tasksByKey.has(dependency) &&
          !(amendment.addTasks || []).some((candidate) => candidate.key === dependency))
        issues.push(`amendment task '${key}' depends on unknown task '${dependency}'`);
  }

  // A revised requirement changes behavior that completed work did not build,
  // so it needs at least one open task rather than a silently reopened one.
  const openCoverage = new Set();
  for (const task of amendment.addTasks || []) stringList(task.covers).forEach((key) => openCoverage.add(key));
  for (const update of amendment.updateTasks || []) {
    const row = tasksByKey.get(keyOf(update));
    if (row && !taskCompleted(row.line)) stringList(update.covers).forEach((key) => openCoverage.add(key));
  }
  for (const line of taskLines) {
    if (!taskId(line) || taskCompleted(line)) continue;
    for (const key of revisedKeys)
      if ((claimsByRequirement.get(key) || []).some((id) => taskClaims(line).includes(id)))
        openCoverage.add(key);
  }
  for (const key of revisedKeys)
    if (!openCoverage.has(key))
      issues.push(`amendment revises '${key}' but no open task covers it; add a task ` +
        "with addTasks so completed tasks keep their meaning");

  const addedClaimsByRequirement = new Map();
  for (const claim of normalized.draft.claims)
    addedClaimsByRequirement.set(claim.requirementKey, [
      ...(addedClaimsByRequirement.get(claim.requirementKey) || []), claim.id
    ]);
  const claimsFor = (key) => addedClaimsByRequirement.get(key) ||
    (removedKeys.has(key) ? [] : claimsByRequirement.get(key)) || [];
  const allClaimsFor = (keys) => unique(stringList(keys).flatMap(claimsFor));
  const replaceClaimIds = (ids) => unique(ids.flatMap((id) => {
    if (!retiredClaimIds.has(id)) return [id];
    const key = priorClaimById.get(id)?.requirementKey;
    return revisedKeys.has(key) ? claimsFor(key) : [];
  }));

  const updates = new Map((amendment.updateTasks || []).map((task) => [keyOf(task), task]));
  const orphaned = [];
  for (const [index, line] of taskLines.entries()) {
    if (!taskId(line)) continue;
    const current = taskClaims(line);
    const update = updates.get(semanticTaskKey(line));
    if (!update && !current.some((id) => retiredClaimIds.has(id))) continue;
    const next = unique([...replaceClaimIds(current),
      ...(update ? allClaimsFor(update.covers) : [])]);
    if (current.length && !next.length) orphaned.push(taskId(line));
    taskLines[index] = updateTaskClaimAnnotation(line, next);
  }
  if (orphaned.length)
    issues.push(`amendment would leave task(s) ${orphaned.join(", ")} without requirement ` +
      "coverage; move their coverage with updateTasks");
  // A withdrawn task must not take the last implementation of a claim with it.
  if (removedTaskRows.length) {
    const remaining = new Set([
      ...taskLines.filter((line) => line !== null && taskId(line)).flatMap(taskClaims),
      ...amendmentList(amendment, "addTasks").flatMap((task) => allClaimsFor(task?.covers))
    ]);
    for (const row of removedTaskRows) {
      const uncovered = replaceClaimIds(row.claims).filter((id) => !remaining.has(id));
      if (uncovered.length)
        issues.push(`amendment cannot remove task '${row.key || row.id}' (${row.id}): claim(s) ` +
          `${uncovered.join(", ")} would have no task; move them with updateTasks covers, ` +
          "add a task, or remove the requirement with removeRequirements");
    }
  }
  issues.push(...amendedTaskCycleIssues(taskLines, amendmentList(amendment, "addTasks"),
    resolveTaskId));
  if (issues.length) return { issues };

  const newTasks = [];
  const allocated = new Map(tasksByKey);
  for (const task of amendment.addTasks || []) {
    maxTask += 1;
    const id = `T${String(maxTask).padStart(3, "0")}`;
    allocated.set(task.key, { id });
    newTasks.push({ ...task, id, semanticKey: task.key, claims: allClaimsFor(task.covers) });
  }
  for (const task of newTasks)
    task.dependsOn = stringList(task.dependsOn).map((key) => allocated.get(key)?.id);
  if (newTasks.length && (Array.isArray(repositories) || Array.isArray(repositorySelection))) {
    const ordered = deriveAmendmentTaskDependencies(newTasks.map((task) => ({
      id: task.id, semanticKey: task.semanticKey,
      repository: String(task.repository || "").trim() || "root", dependsOn: task.dependsOn
    })), tasksContent, { repositories: repositories || [], selection: repositorySelection });
    if (ordered.issues.length) return { issues: ordered.issues };
    ordered.tasks.forEach((row, index) => { newTasks[index].dependsOn = row.dependsOn; });
  }
  const renderedNewTasks = newTasks.map((task, index) => renderTask(task, maxTask + index));
  let nextTasks = taskLines.filter((line) => line !== null).join("\n").replace(/\s+$/, "");
  if (renderedNewTasks.length) nextTasks += `\n${renderedNewTasks.join("\n")}`;
  nextTasks += "\n";

  const providers = {};
  for (const [name, config] of Object.entries(contract.providers || {}))
    providers[name] = Array.isArray(config?.claims)
      ? { ...config, claims: replaceClaimIds(config.claims) } : config;
  const allChain = combinedChain(nextTasks);
  const allCommand = allChain.command;
  for (const [name, config] of Object.entries(normalized.draft.execution.providers || {})) {
    if (providers[name]) {
      if (providers[name].command && ["command", "test-discovery"].includes(providers[name].adapter))
        providers[name] = withChain(providers[name], allChain);
      continue;
    }
    // The agreement already names who proves this capability, and where; a
    // second provider derived here would run the same verifies somewhere else.
    const capability = providerCapability(name, config);
    const serving = Object.keys(providers).filter((other) =>
      providerCapability(other, providers[other]) === capability);
    const sameRepository = serving.filter((other) =>
      (providers[other].repository || null) === (config.repository || null));
    const reused = serving.length === 1 ? serving[0]
      : sameRepository.length === 1 ? sameRepository[0] : null;
    if (reused) {
      if (Array.isArray(providers[reused].claims))
        providers[reused] = { ...providers[reused], claims: unique([
          ...providers[reused].claims,
          ...normalized.draft.claims.filter((claim) => (claim.capabilities || []).includes(capability))
            .map((claim) => claim.id)
        ]) };
      continue;
    }
    if (serving.length) {
      issues.push(`amendment cannot choose which provider proves capability '${capability}': ` +
        `${serving.join(", ")} all serve it; declare the provider for these claims in the ` +
        "change's execution providers, then amend again");
      continue;
    }
    providers[name] = { ...config, command: config.command ? allCommand : undefined };
  }
  if (issues.length) return { issues };
  // A provider command derived from the task verify commands follows them;
  // an explicitly configured command stays as the author wrote it.
  if (taskContractChanges.some((change) => change.verify !== undefined) ||
      removedTaskRows.length) {
    const priorCommand = JSON.stringify(combinedCommand(tasksContent));
    for (const [name, config] of Object.entries(providers))
      if (["command", "test-discovery"].includes(config?.adapter) &&
          JSON.stringify(config.command) === priorCommand)
        providers[name] = withChain(config, allChain);
  }
  const taskContractTasks = taskContractChanges.map((change) => {
    const line = taskLines[change.index];
    return {
      key: change.key, id: taskId(line), claims: taskClaims(line),
      // The prior command stays in the amendment audit, so a corrected check
      // is reviewable against the one it replaced.
      ...(change.verify !== undefined
        ? { verify: change.verify, priorVerify: change.priorVerify } : {}),
      ...(change.paths !== undefined ? { paths: change.paths } : {}),
      ...(change.dependsOn !== undefined ? { dependsOn: change.dependsOn } : {}),
      ...(change.reopened ? { reopened: true } : {})
    };
  });
  const taskContractClaimIds = unique(taskContractTasks.flatMap((task) => task.claims));
  // The audit keeps what a withdrawn task promised; its claims are proven
  // again by the tasks that now carry them.
  const removedTasks = removedTaskRows.map((row) => ({
    key: row.key || null, id: row.id, claims: row.claims, verify: row.verify || null
  }));
  const removedTaskClaimIds = unique(removedTaskRows.flatMap((row) => replaceClaimIds(row.claims)));
  const priorScenarios = (key) => (claimsByRequirement.get(key) || [])
    .map((id) => priorClaimById.get(id)?.scenario).filter(Boolean);
  const specs = normalized.draft.specs;
  const nextClaims = [
    ...existingClaims.filter((claim) => !retiredClaimIds.has(claim.id)),
    ...normalized.draft.claims
  ];
  const nextClaimIds = new Set(nextClaims.map((claim) => claim.id));
  const addedClaimIds = [...addedKeys].flatMap((key) => addedClaimsByRequirement.get(key) || []);
  const changedClaimIds = [...revisedKeys].flatMap((key) => addedClaimsByRequirement.get(key) || []);
  const addedTaskClaimIds = unique(newTasks.flatMap((task) => task.claims));
  return {
    issues: [],
    tasksContent: nextTasks,
    claims: nextClaims,
    providers,
    specs: specs.slice(0, addRequirements.length),
    revisedSpecs: specs.slice(addRequirements.length).map((spec, index) => ({
      key: keyOf(reviseRequirements[index]),
      spec,
      explicitTitle: Boolean(String(reviseRequirements[index]?.requirement ||
        reviseRequirements[index]?.title || "").trim()),
      priorScenarios: priorScenarios(keyOf(reviseRequirements[index]))
    })),
    removedRequirements: removeRequirements.map((row) => ({
      key: keyOf(row),
      migration: String(row.migration).trim(),
      priorScenarios: priorScenarios(keyOf(row))
    })),
    discovery: normalized.draft.discovery,
    investigationAgreement,
    amendmentReason: amendment.reason || "Agreement expanded during Build",
    // Outline sections this amendment replaces in place (design.md, proposal.md).
    sections: amendmentList(amendment, "sections").map((section) => ({
      ...section, document: String(section.document).trim(), key: String(section.key).trim()
    })),
    // A new task's claims are proven again with it, even for a requirement the
    // agreement already had.
    invalidatedClaims: unique([...addedClaimIds, ...changedClaimIds, ...taskContractClaimIds,
      ...removedTaskClaimIds, ...addedTaskClaimIds]),
    addedTaskClaimIds,
    addedClaimIds,
    changedClaimIds,
    taskContractChanges: taskContractTasks,
    taskContractClaimIds,
    removedTasks,
    removedTaskClaimIds,
    removedClaimIds: [...retiredClaimIds].filter((id) => !nextClaimIds.has(id)),
    priorClaims: existingClaims,
    addedRequirementKeys: [...addedKeys],
    revisedRequirementKeys: [...revisedKeys],
    removedRequirementKeys: [...removedKeys]
  };
}

function specFiles(dir) {
  const root = join(dir, "specs");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "spec.md"))
    .filter((path) => existsSync(path)).sort();
}

// Exactly one block across the change's spec files must carry the key's prior
// scenario set; zero or several matches fail the amendment rather than
// rewriting a sibling requirement.
function rewriteRequirementBlock(dir, key, scenarios, replacement, target = null) {
  const candidates = specFiles(dir).flatMap((path) => {
    const content = readFileSync(path, "utf8");
    const lines = content.split("\n");
    return requirementBlocks(content, scenarios).matches.map((match) => ({
      path, content, operation: match.operation,
      name: lines[match.start].match(/^###\s+Requirement:\s*(.+?)\s*$/)?.[1] || ""
    }));
  });
  if (candidates.length !== 1)
    throw new Error(`amendment cannot identify the requirement block for '${key}': ` +
      `${candidates.length} blocks carry its scenarios (${stringList(scenarios).join(", ") || "none"})`);
  const [{ path, content, operation, name }] = candidates;
  // A revision replaces the block in place, so it must stay in the same
  // capability delta and operation section; moving it is a remove plus an add.
  if (target) {
    const capability = join(path, "..").split(/[\\/]/).pop();
    const nextOperation = String(target.operation || "added").toLowerCase();
    if (capability !== target.capability || operation !== nextOperation)
      throw new Error(`amendment cannot revise '${key}' from ${capability}/${operation || "unknown"} ` +
        `to ${target.capability}/${nextOperation}; remove it and add a new requirement instead`);
  }
  const result = replaceRequirementBlock(content, scenarios,
    typeof replacement === "function" ? replacement(name) : replacement);
  if (/^###\s+Requirement:/m.test(result.content)) writeFileSync(path, result.content);
  else {
    // A delta file with no requirement left is not a valid OpenSpec delta.
    rmSync(path, { force: true });
    const capabilityDir = join(path, "..");
    if (!readdirSync(capabilityDir).length) rmSync(capabilityDir, { recursive: true, force: true });
  }
}

// Every proposal and design edit is computed before any file is written, so a
// section that cannot be placed leaves the packet unchanged; the caller stages
// the packet and rolls back if a later spec rewrite fails.
export function writeSemanticAmendment(dir, compiled, slugify, {
  schema, revision = null, date = null
} = {}) {
  const proposalPath = join(dir, "proposal.md");
  const designPath = join(dir, "design.md");
  const writes = new Map();
  const read = (path) => writes.has(path) ? writes.get(path) : readFileSync(path, "utf8");
  const sections = Array.isArray(compiled.sections) ? compiled.sections : [];
  const sectionIssues = amendmentSectionIssues({ sections });
  if (sectionIssues.length) throw new Error(sectionIssues.join("; "));
  for (const section of sections) {
    const path = section.document === "design" ? designPath : proposalPath;
    if (!existsSync(path))
      throw new Error(`amendment section ${section.document} '${section.key}' needs ` +
        `${section.document}.md, which this change does not have`);
    const content = read(path);
    writes.set(path, replaceOutlineSection(content, section,
      packetLanguage(content, compiled.investigationAgreement?.language)));
  }
  if (existsSync(proposalPath)) {
    let proposal = read(proposalPath);
    if (compiled.investigationAgreement)
      proposal = replaceInvestigation(proposal, compiled.investigationAgreement);
    if (compiled.discovery?.coverage?.length) proposal = replaceDiscoveryDelta(proposal, compiled);
    if (compiled.removedRequirements?.length) proposal = replaceRemovedRequirements(proposal, compiled);
    writes.set(proposalPath, appendAmendmentHistory(proposal, compiled, { revision, date }));
  }
  for (const [path, content] of writes) writeFileSync(path, content);
  writeFileSync(join(dir, "tasks.md"), compiled.tasksContent);
  const evidencePath = join(dir, "evidence.yaml");
  const contract = JSON.parse(readFileSync(evidencePath, "utf8"));
  contract.claims = compiled.claims;
  contract.providers = compiled.providers;
  writeFileSync(evidencePath, `${JSON.stringify(contract, null, 2)}\n`);
  // A legacy rapid agreement (skip_specs) carries its scenarios in
  // evidence.yaml only; writing a delta beside skip_specs creates an
  // unmergeable packet. A compiled rapid packet has deltas and amends them.
  const marker = existsSync(join(dir, ".openspec.yaml"))
    ? readFileSync(join(dir, ".openspec.yaml"), "utf8") : "skip_specs: true";
  if (schema === "foundation-rapid" && /^\s*skip_specs:\s*true\s*$/m.test(marker)) return;
  const appendSpec = (spec) => {
    const capability = slugify(spec.name);
    const specDir = join(dir, "specs", capability);
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "spec.md");
    // A capability with no living spec states its Purpose, as start does.
    const current = existsSync(specPath) ? readFileSync(specPath, "utf8")
      : `${renderSpecHeading({ name: spec.name, purpose: spec.purpose }, {
        newCapability: !existsSync(join(dir, "..", "..", "specs", capability, "spec.md"))
      })}\n`;
    writeFileSync(specPath, appendRequirementToSpec(current, spec));
  };
  for (const spec of compiled.specs) appendSpec(spec);
  for (const row of compiled.revisedSpecs || [])
    // A revision without its own title keeps the requirement's heading, so a
    // derived title is not replaced by the key.
    rewriteRequirementBlock(dir, row.key, row.priorScenarios, (priorName) => renderRequirement(
      row.explicitTitle || !priorName ? row.spec : { ...row.spec, requirement: priorName }), {
      capability: slugify(row.spec.name), operation: row.spec.operation
    });
  for (const row of compiled.removedRequirements || [])
    rewriteRequirementBlock(dir, row.key, row.priorScenarios, null);
}
