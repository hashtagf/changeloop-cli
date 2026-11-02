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
// The guards rewrite more than they refuse: a hook's `updatedInput` (a
// redirected path, a routed command, a redacted secret copy) is written back
// into OpenCode's mutable `output.args`, so the call runs as the guard meant.
// A strict-mode refusal works by throwing: OpenCode cancels the tool call and
// surfaces the message to the model, the same feedback path Claude Code's
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

  const answer = (result) => {
    if (!result || result.error) return {};
    const stdout = String(result.stdout || "").trim();
    const start = stdout.indexOf("{");
    if (start === -1) return {};
    try {
      const parsed = JSON.parse(stdout.slice(start));
      return {
        blocked: parsed?.decision === "block" ? parsed : null,
        updated: parsed?.hookSpecificOutput?.updatedInput || null,
        context: parsed?.hookSpecificOutput?.additionalContext || null,
      };
    } catch {
      return {};
    }
  };

  // Write a hook's rewritten Claude-shaped input back into OpenCode's args,
  // keeping whichever argument spelling the call used. A rewrite OpenCode
  // cannot express (it has no grep output mode) cancels the call with the
  // guard's explanation rather than letting secret lines print.
  const apply = (tool, args, { updated, context }) => {
    if (!updated) return;
    const spelled = (names, fallback) => names.find((name) => name in args) || fallback;
    if (updated.command !== undefined) args[spelled(["command", "cmd"], "command")] = updated.command;
    if (updated.file_path !== undefined)
      args[spelled(["filePath", "file_path", "path"], "filePath")] = updated.file_path;
    if (tool !== "Grep") return;
    if (updated.path !== undefined) args.path = updated.path;
    if (updated.glob !== undefined) args[spelled(["include", "glob"], "include")] = updated.glob;
    if (updated.output_mode !== undefined && updated.output_mode !== "content") {
      const mode = ["output_mode", "outputMode"].find((name) => name in args);
      if (!mode) throw new Error(context || "secrets guard: this search could print secret lines");
      args[mode] = updated.output_mode;
    }
  };

  // The after hook receives no args, so remember which file each mutating
  // call touched. Entries are deleted on use; a call that never completes
  // leaks one small string, bounded by the session.
  const touched = new Map();

  // The OpenCode session id, exported as FOUNDATION_SESSION_ID so the harness
  // binds the main session (.claude/harness/EVIDENCE.md, Main-session
  // identity). Provider and model identity are not exposed to these hooks, so
  // they stay with the operator (FOUNDATION_MAIN_PROVIDER_FAMILY etc.).
  let sessionId = "";

  return {
    // Shell commands inherit the session id; hooks that run it get it too.
    "shell.env": async (input, output) => {
      const id = String(input?.sessionID || sessionId || "").trim();
      if (id) output.env = { ...output.env, FOUNDATION_SESSION_ID: id };
    },

    "tool.execute.before": async (input, output) => {
      if (input.sessionID) sessionId = String(input.sessionID);
      const tool = TOOL_NAMES[String(input.tool || "").toLowerCase()];
      if (!tool) return;
      const event = { tool_name: tool, tool_input: toolInput(tool, output.args || {}) };

      const args = output.args || {};
      if (tool === "Read" || tool === "Grep" || tool === "Bash") {
        const secrets = answer(runHook("protect-secrets.sh", event, 10000));
        if (secrets.blocked) throw new Error(secrets.blocked.reason);
        apply(tool, args, secrets);
        if (secrets.updated) event.tool_input = toolInput(tool, args);
      }
      if (MUTATING.has(tool) || tool === "Bash") {
        const phase = answer(runHook("phase-mutation-guard.sh", event, 10000));
        if (phase.blocked) throw new Error(phase.blocked.reason);
        apply(tool, args, phase);
        if (phase.updated) event.tool_input = toolInput(tool, args);
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
