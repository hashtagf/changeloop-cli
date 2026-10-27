#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function scalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { return null; }
  }
  if (value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replace(/''/g, "'");
  return value && !/[\[\]{}]/.test(value) ? value : null;
}

function contained(root, target) {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(".." + sep) && !path.startsWith(sep));
}

export function auditCatalog(directory) {
  const root = realpathSync(resolve(directory));
  const findings = [];
  const skills = [];
  const names = new Map();
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = resolve(root, entry.name, "SKILL.md");
    let source;
    try { source = readFileSync(file, "utf8"); }
    catch { findings.push({ code: "missing-skill", path: entry.name + "/SKILL.md" }); continue; }
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const path = relative(root, file);
    if (!frontmatter) { findings.push({ code: "missing-frontmatter", path }); continue; }
    const fields = new Map();
    const lines = frontmatter[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const pair = line.match(/^([a-z][a-z-]*):\s*(.*)$/);
      if (!pair) continue;
      if (fields.has(pair[1])) findings.push({ code: "duplicate-field", path, field: pair[1] });
      let value = scalar(pair[2]);
      if (/^[>|][-+]?$/.test(pair[2].trim())) {
        const block = [];
        while (index + 1 < lines.length && /^(?:\s+\S|\s*$)/.test(lines[index + 1]))
          block.push(lines[++index].trim());
        value = block.join(pair[2].trim().startsWith(">") ? " " : "\n").trim();
      }
      fields.set(pair[1], value);
    }
    const name = fields.get("name");
    const description = fields.get("description");
    if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      findings.push({ code: "invalid-name", path });
    else {
      if (names.has(name)) findings.push({ code: "duplicate-name", path, other: names.get(name) });
      names.set(name, path);
      if (name !== entry.name) findings.push({ code: "directory-name-mismatch", path });
    }
    if (typeof description !== "string" || !description.trim())
      findings.push({ code: "invalid-description", path });
    skills.push({ name, path, description });
    const pending = [file], seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      const markdown = readFileSync(current, "utf8");
      const targets = [
        ...[...markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)].map(match => match[1]),
        ...[...markdown.matchAll(/`(references\/[A-Za-z0-9._/-]+\.md)`/g)].map(match => match[1])
      ];
      for (const href of new Set(targets)) {
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue;
        let target;
        try {
          // A linked skill owns its local references, even when another skill led here.
          target = resolve(dirname(current), decodeURIComponent(href.split("#")[0]));
        }
        catch { findings.push({ code: "invalid-reference", path: relative(root, current), target: href }); continue; }
        const owner = relative(root, current);
        const dependency = relative(root, target).split(sep);
        if (dependency.includes(".foundation") || dependency.includes("tests") ||
            dependency.some((part, index) => part === "docs" && dependency[index + 1] === "reports")) {
          findings.push({ code: "unshipped-dependency", path: owner, target: href });
          continue;
        }
        try {
          const real = realpathSync(target);
          const realDependency = relative(root, real).split(sep);
          if (realDependency.includes(".foundation") || realDependency.includes("tests") ||
              realDependency.some((part, index) => part === "docs" && realDependency[index + 1] === "reports")) {
            findings.push({ code: "unshipped-dependency", path: owner, target: href });
            continue;
          }
          if (!statSync(real).isFile()) {
            findings.push({ code: "non-file-reference", path: owner, target: href });
            continue;
          }
          if (contained(root, real) && real.endsWith(".md")) pending.push(real);
        } catch { findings.push({ code: "missing-reference", path: owner, target: href }); }
      }
    }
  }
  if (!skills.length) findings.push({ code: "empty-catalog", path: "." });
  return {
    version: 1, status: findings.length ? "findings" : "clean",
    coverage: ["metadata", "explicit-local-references"],
    behavioralEvaluation: "not-run", skillCount: skills.length, skills, findings
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const root = process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const result = auditCatalog(root);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) {
    process.stderr.write("Skill audit unavailable: " + error.message + "\n");
    process.exitCode = 2;
  }
}
