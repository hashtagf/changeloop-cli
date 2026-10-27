// Foundation guard plugin for OpenCode.
//
// OpenCode does not run Claude Code hooks, but its plugin API intercepts every
// tool call. This plugin translates OpenCode tool events into the Foundation
// hook contract — the {tool_name, tool_input} JSON the shipped hooks read on
// stdin (.claude/hooks/README.md) — and runs the same guard scripts Claude
// Code wires in .claude/settings.json. One contract, two envelopes.
//
// The OpenCode adapter install copies this file to
// .opencode/plugins/foundation.js.
// Blocking works by throwing: OpenCode cancels the tool call and surfaces the
// message to the model, which is the same feedback path Claude Code's
// {"decision":"block"} produces.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// OpenCode tool name → Claude Code tool name the shipped hooks match on.
const TOOL_NAMES = {
  write: "Write",
  edit: "Edit",
  patch: "Edit",
  read: "Read",
  grep: "Grep",
  bash: "Bash",
};

const MUTATING = new Set(["Write", "Edit"]);

function toolInput(tool, args) {
  if (tool === "Bash") return { command: String(args.command ?? args.cmd ?? "") };
  if (tool === "Grep") {
    return {
      pattern: String(args.pattern ?? ""),
      path: String(args.path ?? ""),
      glob: String(args.include ?? args.glob ?? ""),
      output_mode: String(args.output_mode ?? args.outputMode ?? ""),
    };
  }
  const path = args.filePath ?? args.file_path ?? args.path ?? "";
  return { file_path: String(path) };
}

export const FoundationGuard = async ({ directory, worktree }) => {
  const root = worktree || directory || process.cwd();
  const hooksDir = join(root, ".claude", "hooks");

  const runHook = (script, event, timeout) => {
    const path = join(hooksDir, script);
    // Fail open like the hooks themselves do when a toolchain is missing: a
    // partially installed target must not brick every tool call.
    if (!existsSync(path)) return null;
    return spawnSync("bash", [path], {
      input: JSON.stringify(event),
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      encoding: "utf8",
      timeout,
    });
  };

  const decision = (result) => {
    if (!result || result.error) return null;
    const stdout = String(result.stdout || "").trim();
    const start = stdout.indexOf("{");
    if (start === -1) return null;
    try {
      const parsed = JSON.parse(stdout.slice(start));
      return parsed && parsed.decision === "block" ? parsed : null;
    } catch {
      return null;
    }
  };

  // The after hook receives no args, so remember which file each mutating
  // call touched. Entries are deleted on use; a call that never completes
  // leaks one small string, bounded by the session.
  const touched = new Map();

  return {
    "tool.execute.before": async (input, output) => {
      const tool = TOOL_NAMES[String(input.tool || "").toLowerCase()];
      if (!tool) return;
      const event = { tool_name: tool, tool_input: toolInput(tool, output.args || {}) };

      if (tool === "Read" || tool === "Grep" || tool === "Bash") {
        const blocked = decision(runHook("protect-secrets.sh", event, 10000));
        if (blocked) throw new Error(blocked.reason);
      }
      if (MUTATING.has(tool) || tool === "Bash") {
        const blocked = decision(runHook("phase-mutation-guard.sh", event, 10000));
        if (blocked) throw new Error(blocked.reason);
        if (MUTATING.has(tool) && input.callID) {
          touched.set(input.callID, event.tool_input.file_path);
        }
      }
    },

    "tool.execute.after": async (input) => {
      const filePath = touched.get(input.callID);
      if (!filePath) return;
      touched.delete(input.callID);
      const result = runHook("lint.sh", {
        tool_name: "Write",
        tool_input: { file_path: filePath },
      }, 30000);
      // Exit 2 is the lint contract's "feed diagnostics back to the model".
      if (result && result.status === 2) {
        throw new Error(String(result.stderr || "lint failed").trim());
      }
    },
  };
};
