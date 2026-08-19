// Land shells out to `openspec archive`, which merges a change's spec deltas
// into openspec/specs/. Nothing downstream re-reads the result, so a wrong
// merge corrupts durable specs silently. This module is the oracle: given the
// spec text before archive, after archive, and the delta that declared the
// intent, it checks the invariants the merge must have preserved.
//
// It is an invariant checker, not a reimplementation of the merge. Pure by
// construction: strings in, findings out, no fs and no child_process.
//
// The parser is shared with pre-Build change validation so both gates interpret
// requirement identity, section context, and complete scenario lists equally.

import {
  parseSpecDocument, specDeltaOperation
} from "../contracts/change-artifacts.mjs";

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const RENAME_TARGET = /^\s*-\s*(?:FROM|TO):\s*`?#{0,6}\s*Requirement:\s*(.+?)`?\s*$/i;

// Parses either a current spec.md or a delta spec.md. `section` carries the
// enclosing `## ` heading, which is what makes a delta requirement ADDED,
// MODIFIED, or REMOVED; `body` is the verbatim block used for the
// byte-identical comparison of untouched requirements.
export { parseSpecDocument };

// `## RENAMED Requirements` names its requirements in FROM/TO list items
// rather than `### Requirement:` headings, so they are invisible to the parser
// above. They still count as mentioned by the delta and must not be treated as
// untouched. No further invariant is asserted for renames.
export function renamedRequirementNames(text) {
  const names = [];
  let inSection = false;
  for (const line of String(text ?? "").split("\n")) {
    const heading = line.match(HEADING);
    if (heading && heading[1].length <= 2) {
      inSection = /^RENAMED\b/i.test(heading[2].trim());
      continue;
    }
    if (!inSection) continue;
    const name = line.match(RENAME_TARGET)?.[1]?.trim();
    if (name) names.push(name);
  }
  return names;
}

function byName(requirements) {
  return new Map(requirements.map((requirement) => [requirement.name, requirement]));
}

function listDetail(names) {
  return names.map((name) => `'${name}'`).join(", ");
}

/**
 * @param {{ before?: string|null, after?: string|null, delta?: string|null }} input
 *   `before` is the capability's openspec/specs/<capability>/spec.md content
 *   captured before `openspec archive` ran (null or empty for a brand-new
 *   capability), `after` is the same file after archive, and `delta` is the
 *   change's openspec/changes/<id>/specs/<capability>/spec.md.
 * @returns {{ valid: boolean, violations: Array<{kind: string, requirement: string|null, detail: string}> }}
 */
export function verifySpecSync({ before, after, delta } = {}) {
  const violations = [];
  const report = (kind, requirement, detail) =>
    violations.push({ kind, requirement, detail });

  const beforeIndex = byName(parseSpecDocument(before));
  const afterIndex = byName(parseSpecDocument(after));
  const deltaRequirements = parseSpecDocument(delta);

  // 5. One requirement name may not carry two intents. OpenSpec rejects a name
  // reused across REMOVED and ADDED, so guessing which section wins would be
  // guessing at a spec the change never actually declared.
  const sectionsByName = new Map();
  for (const requirement of deltaRequirements) {
    const operation = specDeltaOperation(requirement.section);
    const seen = sectionsByName.get(requirement.name) || [];
    sectionsByName.set(requirement.name, [...seen, operation || requirement.section || "(no section)"]);
    if (!operation)
      report("delta-section-unrecognized", requirement.name,
        `delta requirement sits under '${requirement.section || "(no section)"}'; OpenSpec only merges requirements under '## ADDED Requirements', '## MODIFIED Requirements', '## REMOVED Requirements', or '## RENAMED Requirements'`);
  }
  const ambiguous = new Set();
  for (const [name, sections] of sectionsByName) {
    if (sections.length < 2) continue;
    ambiguous.add(name);
    report("delta-name-ambiguous", name,
      `declared ${sections.length} times in the delta (${listDetail(sections)}); OpenSpec rejects one requirement name in two sections, so rename the requirement instead of reusing the name`);
  }

  const mentioned = new Set([
    ...deltaRequirements.map((requirement) => requirement.name),
    ...renamedRequirementNames(delta)
  ]);

  for (const requirement of deltaRequirements) {
    const { name, scenarios } = requirement;
    if (ambiguous.has(name)) continue;
    const operation = specDeltaOperation(requirement.section);
    const merged = afterIndex.get(name);

    // 1. ADDED introduces behavior that did not exist yet.
    if (operation === "ADDED") {
      if (!merged)
        report("added-requirement-missing", name,
          "declared under '## ADDED Requirements' but absent from the archived spec; the merge dropped it");
      if (beforeIndex.has(name))
        report("added-requirement-preexisting", name,
          "declared under '## ADDED Requirements' but the spec already declared it before archive; use '## MODIFIED Requirements' or rename the requirement");
      continue;
    }

    // 2. REMOVED retires behavior that existed.
    if (operation === "REMOVED") {
      if (merged)
        report("removed-requirement-present", name,
          "declared under '## REMOVED Requirements' but still present in the archived spec; the merge did not apply the removal");
      if (!beforeIndex.has(name))
        report("removed-requirement-absent", name,
          "declared under '## REMOVED Requirements' but the spec did not declare it before archive; the removal targets a requirement that never existed");
      continue;
    }

    if (operation !== "MODIFIED") continue;

    // 3. MODIFIED replaces the scenario list wholesale. The archived list must
    // equal the delta's list exactly, and any scenario the delta stopped
    // naming is a deletion rather than a rename.
    if (!merged) {
      report("modified-requirement-missing", name,
        "declared under '## MODIFIED Requirements' but absent from the archived spec; the merge dropped it");
      continue;
    }
    const declared = new Set(scenarios);
    const archived = new Set(merged.scenarios);
    const missing = scenarios.filter((scenario) => !archived.has(scenario));
    const extra = merged.scenarios.filter((scenario) => !declared.has(scenario));
    if (missing.length)
      report("modified-scenario-missing", name,
        `the delta declares scenario(s) ${listDetail(missing)} that the archived spec does not; OpenSpec reads a MODIFIED block as the complete scenario list, so the archived requirement no longer matches the change`);
    if (extra.length)
      report("modified-scenario-extra", name,
        `the archived spec declares scenario(s) ${listDetail(extra)} that the delta does not; the merge kept scenarios the MODIFIED block replaced`);
    if (!missing.length && !extra.length &&
        scenarios.join("\0") !== merged.scenarios.join("\0"))
      report("modified-scenario-order", name,
        `scenario order differs: delta declares ${listDetail(scenarios)} but the archived spec declares ${listDetail(merged.scenarios)}`);
    const deleted = (beforeIndex.get(name)?.scenarios || [])
      .filter((scenario) => !declared.has(scenario));
    if (deleted.length)
      report("modified-scenario-deleted", name,
        `the MODIFIED block stopped naming scenario(s) ${listDetail(deleted)} that the spec declared before archive, so they archived as deletions. Either keep the original scenario name, or rename the whole requirement: declare the old name under '## REMOVED Requirements' and the new name under '## ADDED Requirements' with its full scenario list`);
  }

  // 4. Anything the delta never mentioned must survive archive verbatim.
  for (const [name, requirement] of beforeIndex) {
    if (mentioned.has(name)) continue;
    const merged = afterIndex.get(name);
    if (!merged) {
      report("untouched-requirement-missing", name,
        "present before archive and not mentioned by the delta, but absent from the archived spec; the merge deleted a requirement the change never declared");
      continue;
    }
    if (merged.body !== requirement.body)
      report("untouched-requirement-modified", name,
        "present before archive and not mentioned by the delta, but its text changed during archive; the merge rewrote a requirement the change never declared");
  }

  return { valid: violations.length === 0, violations };
}
