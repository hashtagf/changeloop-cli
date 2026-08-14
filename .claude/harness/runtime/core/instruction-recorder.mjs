import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInstructionManifest } from "./instruction-manifest.mjs";

export function createInstructionRecorder({
  root, foundationVersion, instructionManifests, writeJson
}) {
  function recordInstructionManifest(id, phase, options = {}) {
    const command = phase === "review" ? "prove" : phase;
    if (!["change", "build", "prove", "land"].includes(command)) return null;
    const instructionPaths = [
      `.claude/commands/${command}.md`,
      ".claude/orchestrator.md",
      ".claude/rules/fundamentals.md"
    ];
    if (instructionPaths.some((path) => !existsSync(join(root, path)))) return null;
    const manifest = createInstructionManifest({
      root,
      foundationVersion,
      command,
      commandPath: instructionPaths[0],
      orchestratorPath: ".claude/orchestrator.md",
      rulePaths: [".claude/rules/fundamentals.md"],
      skills: [],
      requestedModel: options.requestedModel || null
    });
    const scope = String(options.scope || "global").replace(/[^A-Za-z0-9._-]/g, "-");
    writeJson(join(instructionManifests, id, `${command}-${scope}.json`), manifest);
    return manifest;
  }

  return { recordInstructionManifest };
}
