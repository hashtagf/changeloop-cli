import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  belongsToProjectOperation,
  belongsToProjectValue,
  bindClaudeSessionOperation,
  claudeCursorIdentity,
  claudeCursorIdentityOperation,
  collectClaudeSourcesOperation,
  importTelemetryOperation,
  parseTelemetryImportRows,
  readCompleteJsonLinesOperation,
  syncClaudeTelemetryOperation,
  syncClaudeTelemetrySource,
  validateTelemetryImportRows
} from "../runtime/observability/telemetry-runtime.mjs";

const fail = (message) => { throw new Error(message); };

test("telemetry import parser accepts JSON objects, arrays, and partial JSONL", () => {
  assert.deepEqual(parseTelemetryImportRows({ fail }, "rows.json", '{"id":1}'), [{ id: 1 }]);
  assert.deepEqual(parseTelemetryImportRows({ fail }, "rows.json", '[{"id":1}]'), [{ id: 1 }]);
  const warnings = [];
  assert.deepEqual(parseTelemetryImportRows({
    fail,
    output: { error: (message) => warnings.push(message) }
  }, "rows.jsonl", '{"id":1}\nbroken\n{"id":2}\n'), [{ id: 1 }, { id: 2 }]);
  assert.match(warnings[0], /skipped 1 unparseable telemetry line/);
  assert.throws(() => parseTelemetryImportRows({ fail }, "bad.jsonl", "broken\nstill-broken"),
    /neither JSON nor JSONL/);
});

test("Claude import validation requires a measured assistant usage row", () => {
  assert.throws(() => validateTelemetryImportRows({ fail }, "claude", [{ type: "user" }]),
    /no assistant\.message\.usage records/);
  assert.doesNotThrow(() => validateTelemetryImportRows({ fail }, "claude", [{
    type: "assistant",
    message: { role: "assistant", usage: { input_tokens: 2 } }
  }]));
  assert.doesNotThrow(() => validateTelemetryImportRows({ fail }, "generic", []));
});

function importContext(overrides = {}) {
  return {
    parseFlags: () => ({ flags: {}, rest: ["events.json"] }),
    fail,
    resolvePath: (_cwd, source) => `/project/${source}`,
    cwd: () => "/project",
    pathExists: () => true,
    readFile: () => '[{"requestId":"r1","usage":{"input_tokens":2}},{"requestId":"r2","usage":{"output_tokens":1}}]',
    readJson: () => ({ workspaceHash: "hash" }),
    loadRuntime: () => ({ createdAt: "2026-09-03T00:00:00.000Z" }),
    snapshotPath: () => "/snapshot.json",
    appendTelemetryRows: () => 1,
    runtimeSessionId: () => "runtime-session",
    output: { log: () => {}, error: () => {} },
    ...overrides
  };
}

test("telemetry import validates CLI input before reading the source", () => {
  assert.throws(() => importTelemetryOperation(importContext({
    parseFlags: () => ({ flags: {}, rest: [] })
  }), "change", []), /requires a JSON or JSONL file/);
  assert.throws(() => importTelemetryOperation(importContext({
    parseFlags: () => ({ flags: { format: "unknown" }, rest: ["events.json"] })
  }), "change", []), /generic\|codex\|cursor\|otel\|claude/);
  assert.throws(() => importTelemetryOperation(importContext({
    pathExists: () => false
  }), "change", []), /source not found: events.json/);
});

test("Codex import binds snapshot and runtime session and reports skipped rows", () => {
  const calls = [];
  const logs = [];
  importTelemetryOperation(importContext({
    parseFlags: () => ({ flags: { format: "codex" }, rest: ["events.json"] }),
    appendTelemetryRows: (...args) => { calls.push(args); return 1; },
    output: { log: (message) => logs.push(message), error: assert.fail }
  }), "change", []);
  assert.equal(calls[0][0], "change");
  assert.equal(calls[0][1].length, 2);
  assert.equal(calls[0][2], "codex");
  assert.deepEqual(calls[0][3], {
    snapshot: { workspaceHash: "hash" },
    sessionId: "runtime-session",
    sourcePath: "/project/events.json",
    since: "2026-09-03T00:00:00.000Z",
    replaceSource: true
  });
  assert.equal(logs[0], "TELEMETRY change: imported 1; skipped 1");
});

function syncContext(overrides = {}) {
  const session = { operationId: "prove", sources: {} };
  return {
    loadRuntime: () => ({}),
    claudeHostContext: () => ({ sessionId: "session", transcriptPath: "/main.jsonl" }),
    bindClaudeSession: () => ({ cursors: { sessions: {} }, session }),
    readJson: () => ({ workspaceHash: "hash" }),
    snapshotPath: () => "/snapshot.json",
    collectClaudeSources: () => ["/main.jsonl", "/agent-worker.jsonl"],
    sourceKey: (path) => path,
    sourceReadOffset: (_path, source) => source.offset,
    readCompleteJsonLines: () => ({ rows: [{ keep: true }, { keep: false }], nextOffset: 12 }),
    sourceCursor: (path, offset) => ({ path, offset, identity: true }),
    belongsToThisProject: (row) => row.keep,
    appendTelemetryRows: () => 1,
    saveClaudeCursors: () => {},
    now: () => "2026-08-26T00:00:00.000Z",
    fail,
    basename: (path) => path.split("/").at(-1),
    output: { log: () => {}, error: () => {} },
    ...overrides
  };
}

test("Claude sync handles unavailable and quiet hosts without binding", () => {
  const logs = [];
  const context = syncContext({
    claudeHostContext: () => null,
    bindClaudeSession: assert.fail,
    output: { log: (message) => logs.push(message), error: assert.fail }
  });
  assert.deepEqual(syncClaudeTelemetryOperation(context, "change"), { imported: 0, scanned: 0 });
  assert.match(logs[0], /transcript unavailable; imported 0/);
  logs.length = 0;
  assert.deepEqual(syncClaudeTelemetryOperation(context, "change", { quiet: true }),
    { imported: 0, scanned: 0 });
  assert.deepEqual(logs, []);
});

test("Claude sync imports orchestrator and subagent rows and advances cursors", () => {
  const appends = [];
  const saves = [];
  const logs = [];
  const context = syncContext({
    appendTelemetryRows: (...args) => { appends.push(args); return 1; },
    saveClaudeCursors: (...args) => saves.push(args),
    output: { log: (message) => logs.push(message), error: assert.fail }
  });
  assert.deepEqual(syncClaudeTelemetryOperation(context, "change", { operationId: "build" }),
    { imported: 2, scanned: 4 });
  assert.equal(appends[0][3].agentId, "orchestrator");
  assert.equal(appends[1][3].agentId, "worker");
  assert.deepEqual(appends[0][1], [{ keep: true }]);
  assert.equal(saves.length, 1);
  assert.match(logs[0], /imported 2; scanned 4; source claude-transcript/);
});

test("quiet Claude sync skips an unreadable source while normal sync fails", () => {
  const warnings = [];
  const context = syncContext({
    readCompleteJsonLines: () => { throw new Error("truncated cursor"); },
    output: { log: () => {}, error: (message) => warnings.push(message) }
  });
  const input = {
    id: "change",
    path: "/agent-worker.jsonl",
    host: { sessionId: "session", transcriptPath: "/main.jsonl" },
    session: { sources: {} },
    snapshot: {},
    options: { quiet: true }
  };
  assert.deepEqual(syncClaudeTelemetrySource(context, input), { imported: 0, scanned: 0 });
  assert.match(warnings[0], /skipped unreadable Claude transcript agent-worker\.jsonl/);
  assert.throws(() => syncClaudeTelemetrySource(context, {
    ...input,
    options: { quiet: false }
  }), /truncated cursor/);
});

test("project ownership accepts unscoped and contained rows but rejects sibling paths", () => {
  const canonical = (path) => resolve(path);
  assert.equal(belongsToProjectValue("/project", {}, canonical), true);
  assert.equal(belongsToProjectValue("/project", { cwd: 42 }, canonical), true);
  assert.equal(belongsToProjectValue("/project", { cwd: "/project" }, canonical), true);
  assert.equal(belongsToProjectValue("/project", {
    workingDirectory: "/project/packages/api"
  }, canonical), true);
  assert.equal(belongsToProjectValue("/project", {
    projectPath: "/sibling/project"
  }, canonical), false);
  assert.equal(belongsToProjectOperation({
    rootPath: () => "/project",
    canonicalPath: canonical
  }, { cwd: "/project/src" }), true);
});

test("Claude cursor identity clamps offsets and hashes only the bounded anchor", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-cursor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "session.jsonl");
  writeFileSync(path, "x".repeat(5000));

  const empty = claudeCursorIdentity(path, -10);
  assert.equal(empty.anchorStart, 0);
  const bounded = claudeCursorIdentity(path, 99999);
  assert.equal(bounded.anchorStart, 904);
  assert.notEqual(bounded.anchorHash, empty.anchorHash);
  assert.equal(bounded.device.length > 0, true);
  assert.equal(bounded.inode.length > 0, true);
});

test("Claude cursor identity fails closed when an anchored read becomes short", () => {
  let closed = false;
  const context = {
    stat: () => ({ size: 10, dev: 1, ino: 2 }),
    open: () => 7,
    read: () => 0,
    close: (descriptor) => { assert.equal(descriptor, 7); closed = true; },
    hash: () => "hash",
    anchorBytes: 4
  };
  assert.throws(() => claudeCursorIdentityOperation(context, "/session.jsonl", 10),
    /transcript changed while its cursor was inspected/);
  assert.equal(closed, true);
  assert.deepEqual(claudeCursorIdentityOperation(context, "/session.jsonl", undefined), {
    device: "1", inode: "2", anchorStart: 0, anchorHash: "hash"
  });
});

test("Claude source discovery walks nested subagents and ignores non-JSONL files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-sources-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const transcript = join(root, "session.jsonl");
  const agents = join(root, "session", "subagents");
  mkdirSync(join(agents, "nested"), { recursive: true });
  writeFileSync(transcript, "");
  writeFileSync(join(agents, "agent-a.jsonl"), "");
  writeFileSync(join(agents, "notes.txt"), "");
  writeFileSync(join(agents, "nested", "agent-b.jsonl"), "");

  const sources = collectClaudeSourcesOperation({}, transcript);
  assert.equal(sources[0], transcript);
  assert.equal(sources[1].endsWith("/session/subagents/agent-a.jsonl"), true);
  assert.equal(sources[2].endsWith("/session/subagents/nested/agent-b.jsonl"), true);
  assert.deepEqual(collectClaudeSourcesOperation({}, join(root, "missing.jsonl")),
    [join(root, "missing.jsonl")]);
});

test("Claude session binding initializes cursors and refreshes existing sessions", () => {
  const saved = [];
  const cursors = { version: 1, sessions: {} };
  const context = {
    claudeHostContext: () => ({ sessionId: "session", transcriptPath: "/main.jsonl" }),
    loadClaudeCursors: () => cursors,
    collectClaudeSources: () => ["/main.jsonl", "/agent.jsonl"],
    sourceKey: (path) => path,
    sourceCursor: (path, offset) => ({ path, offset }),
    stat: (path) => ({ size: path === "/main.jsonl" ? 10 : 20 }),
    now: () => "2026-08-27T00:00:00.000Z",
    saveClaudeCursors: (...args) => saved.push(args)
  };

  const created = bindClaudeSessionOperation(context, "change", null);
  assert.equal(created.session.operationId, "unknown");
  assert.deepEqual(created.session.sources["/agent.jsonl"], {
    path: "/agent.jsonl", offset: 20
  });
  assert.equal(saved.length, 1);

  context.claudeHostContext = () => ({
    sessionId: "session", transcriptPath: "/moved/main.jsonl"
  });
  const refreshed = bindClaudeSessionOperation(context, "change", "prove", {
    fromStart: true
  });
  assert.equal(refreshed.session.transcriptPath, "/moved/main.jsonl");
  assert.equal(refreshed.session.operationId, "prove");
  assert.equal(saved.length, 2);

  context.claudeHostContext = () => null;
  assert.equal(bindClaudeSessionOperation(context, "change", "prove"), null);
});

test("complete JSONL reader preserves partial tails, offsets, and parse errors", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-jsonl-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "session.jsonl");
  const complete = '{"id":1}\n{"id":2}\n';
  writeFileSync(path, `${complete}{"partial":`);

  assert.deepEqual(readCompleteJsonLinesOperation({}, path, 0), {
    rows: [{ id: 1 }, { id: 2 }],
    nextOffset: Buffer.byteLength(complete)
  });
  assert.deepEqual(readCompleteJsonLinesOperation({}, path, complete.length), {
    rows: [],
    nextOffset: complete.length
  });
  const size = Buffer.byteLength(`${complete}{"partial":`);
  assert.deepEqual(readCompleteJsonLinesOperation({}, path, size), {
    rows: [], nextOffset: size
  });

  const broken = join(root, "broken.jsonl");
  writeFileSync(broken, "not-json\n");
  assert.throws(() => readCompleteJsonLinesOperation({}, broken, -1),
    /invalid Claude transcript record in broken\.jsonl/);
});
