import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSemanticDraft } from "./semantic-draft.mjs";

const stringList = (value) => Array.isArray(value)
  ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
const unique = (values) => [...new Set(values)];

export function semanticTaskKey(line) {
  return String(line).match(/\[key:([^\]]+)\]/i)?.[1]?.trim() || null;
}

function taskId(line) {
  return String(line).match(/^\s*-\s*\[[ xX]\]\s*\*{0,2}(T\d{3,})\*{0,2}\b/i)?.[1]
    ?.toUpperCase() || null;
}

function taskClaims(line) {
  return stringList(String(line).match(/\[claims:([^\]]*)\]/i)?.[1]?.split(","));
}

function taskVerify(line) {
  return String(line).match(/—\s*verify:\s*`([^`]+)`/i)?.[1]?.trim() || "";
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

function renderRequirement(spec) {
  const scenarios = (spec.scenarios || []).map((scenario) =>
    `#### Scenario: ${scenario.name}\n\n- **WHEN** ${scenario.when}\n` +
    `- **THEN** ${scenario.then}`).join("\n\n");
  const migration = String(spec.operation || "added").toLowerCase() === "removed"
    ? `\n\n**Migration:** ${spec.migration}` : "";
  return `### Requirement: ${spec.requirement}\n\n${spec.description}${migration}` +
    (scenarios ? `\n\n${scenarios}` : "");
}

export function appendRequirementToSpec(content, spec) {
  const operation = String(spec.operation || "added").toUpperCase();
  const heading = `## ${operation} Requirements`;
  const rendered = renderRequirement(spec);
  const source = String(content || "").replace(/\s+$/, "");
  const start = source.indexOf(heading);
  if (start < 0) return `${source}\n\n${heading}\n\n${rendered}\n`;
  const afterHeading = start + heading.length;
  const next = source.slice(afterHeading).search(/\n##\s+/);
  if (next < 0) return `${source}\n\n${rendered}\n`;
  const insertion = afterHeading + next;
  return `${source.slice(0, insertion).replace(/\s+$/, "")}\n\n${rendered}\n\n` +
    `${source.slice(insertion).replace(/^\s+/, "")}\n`;
}

function combinedCommand(tasksContent) {
  const commands = unique(String(tasksContent).split("\n").map(taskVerify).filter(Boolean));
  return commands.length === 1
    ? ["sh", "-lc", commands[0]]
    : ["sh", "-lc", commands.map((command) => `(${command})`).join(" && ")];
}

function amendmentIssues(amendment) {
  const issues = [];
  if (amendment?.version !== 1) issues.push("semantic amendment requires version 1");
  if (!Array.isArray(amendment?.addRequirements) || !amendment.addRequirements.length)
    issues.push("semantic amendment requires a non-empty addRequirements array");
  if (!amendment?.evidence || typeof amendment.evidence !== "object" ||
      Array.isArray(amendment.evidence))
    issues.push("semantic amendment requires evidence keyed by each added requirement");
  if (amendment?.updateTasks !== undefined && !Array.isArray(amendment.updateTasks))
    issues.push("semantic amendment updateTasks must be an array");
  for (const [index, task] of (amendment?.updateTasks || []).entries()) {
    const unsupported = ["outcome", "verify"].filter((field) =>
      Object.prototype.hasOwnProperty.call(task || {}, field));
    if (unsupported.length)
      issues.push(`semantic amendment updateTasks[${index}] cannot replace ${
        unsupported.join(" or ")}; add a new task so completed work keeps its meaning`);
  }
  if (amendment?.addTasks !== undefined && !Array.isArray(amendment.addTasks))
    issues.push("semantic amendment addTasks must be an array");
  return issues;
}

export function compileSemanticAmendment({
  amendment, contract, tasksContent, slugify, renderTask
}) {
  const issues = amendmentIssues(amendment);
  const existingClaims = contract.claims || [];
  const claimsByRequirement = new Map();
  for (const claim of existingClaims) {
    if (!claim.requirementKey) continue;
    claimsByRequirement.set(claim.requirementKey, [
      ...(claimsByRequirement.get(claim.requirementKey) || []), claim.id
    ]);
  }
  const taskLines = String(tasksContent).split("\n");
  const tasksByKey = new Map();
  let maxTask = 0;
  for (const [index, line] of taskLines.entries()) {
    const id = taskId(line);
    if (id) maxTask = Math.max(maxTask, Number(id.slice(1)) || 0);
    const key = semanticTaskKey(line);
    if (key) tasksByKey.set(key, { index, line, id });
  }

  const addRequirements = amendment.addRequirements || [];
  const addedKeys = new Set(addRequirements.map((row) => String(row?.key || "").trim()));
  for (const key of addedKeys)
    if (claimsByRequirement.has(key)) issues.push(`amendment requirement '${key}' already exists`);

  const coverageTasks = [
    ...(amendment.updateTasks || []).map((task) => ({
      key: task.key,
      outcome: `Extend ${task.key}`,
      verify: taskVerify(tasksByKey.get(task.key)?.line),
      covers: stringList(task.covers).filter((key) => addedKeys.has(key))
    })),
    ...(amendment.addTasks || []).map((task) => ({ ...task, dependsOn: [] }))
  ].filter((task) => stringList(task.covers).some((key) => addedKeys.has(key)));
  const normalized = normalizeSemanticDraft({
    version: 3,
    intent: amendment.reason || "Amend the active agreement",
    requirements: addRequirements,
    tasks: coverageTasks,
    evidence: amendment.evidence,
    integrations: amendment.integrations || []
  }, slugify);
  issues.push(...normalized.issues.map((issue) => `amendment ${issue}`));
  const duplicateClaims = normalized.draft.claims
    .map((claim) => claim.id).filter((id) => existingClaims.some((claim) => claim.id === id));
  if (duplicateClaims.length)
    issues.push(`amendment derives existing claim ID(s): ${unique(duplicateClaims).join(", ")}`);

  for (const update of amendment.updateTasks || []) {
    const key = String(update?.key || "").trim();
    if (!tasksByKey.has(key)) issues.push(`amendment updateTasks references unknown task '${key}'`);
    for (const covered of stringList(update?.covers))
      if (!addedKeys.has(covered) && !claimsByRequirement.has(covered))
        issues.push(`amendment task '${key}' covers unknown requirement '${covered}'`);
  }
  for (const task of amendment.addTasks || []) {
    const key = String(task?.key || "").trim();
    if (tasksByKey.has(key)) issues.push(`amendment addTasks key '${key}' already exists`);
    for (const dependency of stringList(task?.dependsOn))
      if (!tasksByKey.has(dependency) &&
          !(amendment.addTasks || []).some((candidate) => candidate.key === dependency))
        issues.push(`amendment task '${key}' depends on unknown task '${dependency}'`);
  }
  if (issues.length) return { issues };

  const addedClaimsByRequirement = new Map();
  for (const claim of normalized.draft.claims)
    addedClaimsByRequirement.set(claim.requirementKey, [
      ...(addedClaimsByRequirement.get(claim.requirementKey) || []), claim.id
    ]);
  const allClaimsFor = (keys) => unique(stringList(keys).flatMap((key) =>
    claimsByRequirement.get(key) || addedClaimsByRequirement.get(key) || []));

  for (const update of amendment.updateTasks || []) {
    const current = tasksByKey.get(update.key);
    const claims = unique([...taskClaims(current.line), ...allClaimsFor(update.covers)]);
    taskLines[current.index] = updateTaskClaimAnnotation(current.line, claims);
  }
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
  const renderedNewTasks = newTasks.map((task, index) => renderTask(task, maxTask + index));
  let nextTasks = taskLines.join("\n").replace(/\s+$/, "");
  if (renderedNewTasks.length) nextTasks += `\n${renderedNewTasks.join("\n")}`;
  nextTasks += "\n";

  const providers = { ...(contract.providers || {}) };
  const allCommand = combinedCommand(nextTasks);
  for (const [name, config] of Object.entries(normalized.draft.execution.providers || {})) {
    if (!providers[name]) providers[name] = { ...config, command: config.command ? allCommand : undefined };
    else if (providers[name].command && ["command", "test-discovery"].includes(providers[name].adapter))
      providers[name] = { ...providers[name], command: allCommand };
  }
  return {
    issues: [],
    tasksContent: nextTasks,
    claims: [...existingClaims, ...normalized.draft.claims],
    providers,
    specs: normalized.draft.specs,
    invalidatedClaims: normalized.draft.claims.map((claim) => claim.id),
    addedRequirementKeys: [...addedKeys]
  };
}

export function writeSemanticAmendment(dir, compiled, slugify) {
  writeFileSync(join(dir, "tasks.md"), compiled.tasksContent);
  const evidencePath = join(dir, "evidence.yaml");
  const contract = JSON.parse(readFileSync(evidencePath, "utf8"));
  contract.claims = compiled.claims;
  contract.providers = compiled.providers;
  writeFileSync(evidencePath, `${JSON.stringify(contract, null, 2)}\n`);
  for (const spec of compiled.specs) {
    const capability = slugify(spec.name);
    const specDir = join(dir, "specs", capability);
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "spec.md");
    const current = existsSync(specPath)
      ? readFileSync(specPath, "utf8") : `# ${spec.name}\n`;
    writeFileSync(specPath, appendRequirementToSpec(current, spec));
  }
}
