import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export const INSTRUCTION_MANIFEST_SCHEMA_VERSION = 1;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalValue(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizedRelativePath(root, path) {
  const absolute = resolve(root, path);
  const result = relative(resolve(root), absolute).replaceAll("\\", "/");
  if (!result || result === ".." || result.startsWith("../"))
    throw new Error(`instruction path escapes root: ${path}`);
  return { absolute, relative: result };
}

function instructionEntry(root, path, kind, name = null) {
  const resolved = normalizedRelativePath(root, path);
  if (!existsSync(resolved.absolute))
    throw new Error(`missing ${kind} instruction: ${resolved.relative}`);
  // Git may check text files out with CRLF on Windows. Instruction identity is
  // semantic text identity, so line endings are canonicalized before hashing.
  const content = readFileSync(resolved.absolute, "utf8").replaceAll("\r\n", "\n");
  return {
    kind,
    ...(name ? { name } : {}),
    path: resolved.relative,
    digest: sha256(content)
  };
}

function skillInstructionEntry(root, skill) {
  const resolved = normalizedRelativePath(root, skill.path);
  if (!existsSync(resolved.absolute))
    throw new Error(`missing skill instruction: ${resolved.relative}`);
  const content = readFileSync(resolved.absolute, "utf8").replaceAll("\r\n", "\n");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const declaredName = frontmatter?.[1].match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  if (!declaredName)
    throw new Error(`invalid skill frontmatter: ${resolved.relative} requires name`);
  if (declaredName !== skill.name)
    throw new Error(`skill name mismatch: expected '${skill.name}', found '${declaredName}'`);
  return {
    kind: "skill",
    name: skill.name,
    path: resolved.relative,
    digest: sha256(content)
  };
}

/**
 * Build a content-addressed instruction manifest. Raw instruction content is
 * deliberately never returned, which makes this object safe to attach to
 * packets, receipts, and telemetry.
 */
export function createInstructionManifest({
  root,
  foundationVersion,
  command,
  commandPath,
  orchestratorPath = ".claude/orchestrator.md",
  rulePaths = [],
  skills = [],
  requestedModel = null,
  actualModel = null
}) {
  if (!root) throw new Error("instruction manifest requires root");
  if (!command || !commandPath)
    throw new Error("instruction manifest requires command and commandPath");

  const normalizedSkills = skills.map((skill) => {
    if (!skill || !skill.name || !skill.path)
      throw new Error("skill instructions require name and path");
    return skillInstructionEntry(root, skill);
  }).sort((left, right) => left.name.localeCompare(right.name));
  const duplicate = normalizedSkills.find((skill, index) =>
    index > 0 && normalizedSkills[index - 1].name === skill.name);
  if (duplicate) throw new Error(`duplicate skill instruction: ${duplicate.name}`);

  const dispatch = {
    command,
    commandInstruction: instructionEntry(root, commandPath, "command", command),
    orchestratorInstruction: instructionEntry(root, orchestratorPath, "orchestrator"),
    rules: [...new Set(rulePaths)].sort()
      .map((path) => instructionEntry(root, path, "rule"))
  };
  const execution = {
    skills: normalizedSkills,
    requestedModel: requestedModel || null,
    actualModel: actualModel || null
  };
  const manifest = {
    schemaVersion: INSTRUCTION_MANIFEST_SCHEMA_VERSION,
    foundationVersion: foundationVersion || null,
    dispatch,
    execution
  };
  return { ...manifest, manifestDigest: sha256(canonicalJson(manifest)) };
}

export function verifyInstructionManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== INSTRUCTION_MANIFEST_SCHEMA_VERSION)
    return { valid: false, reason: "unsupported-schema" };
  if (!manifest.dispatch?.command || !manifest.dispatch?.commandInstruction?.digest)
    return { valid: false, reason: "missing-dispatch-instruction" };
  if (!Array.isArray(manifest.dispatch.rules) || !Array.isArray(manifest.execution?.skills))
    return { valid: false, reason: "invalid-instruction-collections" };
  const { manifestDigest, ...unsigned } = manifest;
  const expected = sha256(canonicalJson(unsigned));
  return manifestDigest === expected
    ? { valid: true, reason: null, digest: expected }
    : { valid: false, reason: "digest-mismatch", digest: expected };
}

/** Legacy runs intentionally remain readable; absence is not corruption. */
export function instructionProvenance(manifest) {
  if (!manifest) return { available: false, schemaVersion: null, manifestDigest: null };
  const verification = verifyInstructionManifest(manifest);
  return {
    available: true,
    schemaVersion: manifest.schemaVersion ?? null,
    manifestDigest: manifest.manifestDigest || null,
    valid: verification.valid,
    reason: verification.reason
  };
}
