import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSpecRequirements } from "../../contracts/change-artifacts.mjs";

export function createSpecDeltaValidator({ root, activeChangePath, walk, fail }) {
  function changeSpecScenarios(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const scenarios = [];
    if (!existsSync(specsRoot)) return scenarios;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const text = readFileSync(path, "utf8");
      const requirementAt = (index) => {
        const prefix = text.slice(0, index);
        return [...prefix.matchAll(/^### Requirement:\s*(.+?)\s*$/gm)]
          .at(-1)?.[1]?.trim() || null;
      };
      for (const match of text.matchAll(/^#### Scenario:\s*(.+?)\s*$/gm))
        scenarios.push({
          name: match[1].trim(),
          requirement: requirementAt(match.index),
          path: relative(root, path).replaceAll("\\", "/"),
          key: match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
        });
    });
    return scenarios.sort((left, right) =>
      `${left.path}:${left.name}`.localeCompare(`${right.path}:${right.name}`));
  }

  function droppedScenarioFindings(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const findings = [];
    if (!existsSync(specsRoot)) return findings;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const capability = relative(specsRoot, path).replaceAll("\\", "/").split("/")[0];
      const currentPath = join(root, "openspec", "specs", capability, "spec.md");
      if (!existsSync(currentPath)) return;
      const current = new Map(parseSpecRequirements(readFileSync(currentPath, "utf8"))
        .map((requirement) => [requirement.name, requirement.scenarios]));
      for (const requirement of parseSpecRequirements(readFileSync(path, "utf8"))) {
        if (!/^MODIFIED\b/i.test(requirement.section || "")) continue;
        const declared = new Set(requirement.scenarios);
        for (const scenario of current.get(requirement.name) || [])
          if (!declared.has(scenario))
            findings.push({
              capability,
              requirement: requirement.name,
              scenario,
              path: relative(root, path).replaceAll("\\", "/")
            });
      }
    });
    return findings;
  }

  function newCapabilityOperationFindings(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const findings = [];
    if (!existsSync(specsRoot)) return findings;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const capability = relative(specsRoot, path).replaceAll("\\", "/").split("/")[0];
      const currentPath = join(root, "openspec", "specs", capability, "spec.md");
      if (existsSync(currentPath)) return;
      for (const requirement of parseSpecRequirements(readFileSync(path, "utf8"))) {
        if (/^ADDED\b/i.test(requirement.section || "")) continue;
        findings.push({
          capability,
          operation: requirement.section || "an ungrouped requirement",
          requirement: requirement.name,
          path: relative(root, path).replaceAll("\\", "/")
        });
      }
    });
    return findings;
  }

  function assertNewCapabilitiesAreAdditive(id, dir = activeChangePath(id)) {
    const findings = newCapabilityOperationFindings(id, dir);
    if (!findings.length) return;
    const detail = findings.map((finding) =>
      `'${finding.operation}' for requirement '${finding.requirement}' in ${finding.capability}`
    ).join("; ");
    fail(`new capability spec delta uses a non-additive operation: ${detail}. ` +
      "A capability absent from openspec/specs/ has nothing to modify or remove; " +
      "declare every new requirement under '## ADDED Requirements'.");
  }

  function assertNoDroppedScenarios(id, dir = activeChangePath(id)) {
    const findings = droppedScenarioFindings(id, dir);
    if (!findings.length) return;
    const detail = findings.map((finding) =>
      `'${finding.scenario}' under requirement '${finding.requirement}' in ${finding.capability}`
    ).join("; ");
    fail(`spec delta drops ${findings.length} scenario(s) the current spec still declares: ${
      detail}. OpenSpec reads a MODIFIED block as the complete scenario list, so a renamed scenario archives as a deletion. Either keep the original scenario name, or rename the whole requirement: declare the old name under '## REMOVED Requirements' and the new name under '## ADDED Requirements' with its full scenario list. Reusing one requirement name in both sections is rejected.`);
  }

  return {
    assertNewCapabilitiesAreAdditive, assertNoDroppedScenarios,
    changeSpecScenarios, droppedScenarioFindings, newCapabilityOperationFindings
  };
}
