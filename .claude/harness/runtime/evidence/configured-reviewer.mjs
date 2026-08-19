import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

// No `uniqueItems` anywhere in this schema: OpenAI structured output rejects
// the keyword, failing every dispatch as an infrastructure error. `validReview`
// enforces uniqueness of all ID lists after parse.
export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "findings", "verifiedFindingIds"],
  properties: {
    status: { type: "string", enum: ["pass", "fail", "inconclusive"] },
    summary: { type: "string", minLength: 1 },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "severity", "path", "line", "message",
          "claimIds", "verificationCaseIds"
        ],
        properties: {
          id: { type: "string", minLength: 1 },
          severity: { type: "string", enum: ["blocker", "major", "minor"] },
          path: { type: "string" },
          line: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          message: { type: "string", minLength: 1 },
          claimIds: {
            type: "array", items: { type: "string", minLength: 1 }
          },
          verificationCaseIds: {
            type: "array", items: { type: "string", minLength: 1 }
          }
        }
      }
    },
    verifiedFindingIds: {
      type: "array", items: { type: "string", minLength: 1 }
    }
  }
};

const ADAPTERS = new Set(["codex-cli", "claude-cli"]);
const CLAUDE_READ_ONLY_TOOLS = "Read,Glob,Grep";

function text(value) {
  return String(value || "").trim();
}

export function claudeResultEnvelope(stdout) {
  const source = String(stdout || "").trim();
  if (!source) return null;
  const parsed = parseJson(source);
  const events = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" ? [parsed]
      : source.split(/\r?\n/).filter(Boolean).map(parseJson);
  if (!events.length || events.some((event) => !event || typeof event !== "object"))
    return null;
  const result = [...events].reverse().find((event) => event.type === "result") || null;
  if (!result) return { envelopeError: "missing-result" };
  const sessions = [...new Set(events.map((event) => text(event.session_id)).filter(Boolean))];
  if (sessions.length > 1)
    return { ...result, session_id: text(result.session_id) || null,
      envelopeError: "conflicting-session-ids" };
  return { ...result, session_id: sessions[0] || null };
}

function diagnostic(result) {
  return text(result?.stderr || result?.error?.message) ||
    `process exited with status ${result?.status ?? "unknown"}`;
}

function validStringList(value) {
  // Uniqueness over trimmed values: the attempt store trims IDs before its
  // own duplicate check, so "F1" and " F1" passing here as distinct would
  // throw after dispatch and leave the request indeterminate.
  if (!Array.isArray(value)) return false;
  const trimmed = value.map((item) => typeof item === "string" ? item.trim() : "");
  return trimmed.every((item) => item.length > 0) &&
    new Set(trimmed).size === trimmed.length;
}

function validReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review) ||
      !["pass", "fail", "inconclusive"].includes(review.status) ||
      !text(review.summary) || !Array.isArray(review.findings) ||
      !validStringList(review.verifiedFindingIds)) return false;
  const ids = new Set();
  for (const finding of review.findings) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding) ||
        !text(finding.id) || ids.has(text(finding.id)) ||
        !["blocker", "major", "minor"].includes(finding.severity) ||
        typeof finding.path !== "string" ||
        !(finding.line === null || Number.isInteger(finding.line) && finding.line >= 1) ||
        !text(finding.message) || !validStringList(finding.claimIds) ||
        !validStringList(finding.verificationCaseIds)) return false;
    ids.add(text(finding.id));
  }
  return true;
}

function parseJson(value) {
  try { return JSON.parse(String(value)); }
  catch { return null; }
}

function reviewPrompt(packet) {
  return "You are the independent code reviewer. Inspect the exact workspace in read-only mode. " +
    "Treat the supplied Foundation packet as the complete authority for scope and claims. " +
    "For a delta packet, review only reviewScope.paths, return verifiedFindingIds exactly for " +
    "closureFindings.ids, and never report findings outside that scope or reopen unchanged " +
    "surface. Bind every blocker/major finding to non-empty claimIds and " +
    "verificationCaseIds from the supplied packet so a final bounded repair can be " +
    "closed by current deterministic evidence without a third AI. Report findings " +
    "precisely, keep minor findings non-blocking, and return only the required JSON object.\n\n" +
    "FOUNDATION REVIEW PACKET\n" + JSON.stringify(packet);
}

export function createConfiguredReviewerRuntime({
  root, foundationPolicy, commandExists, now, fail, uuid = randomUUID,
  spawn = spawnSync
}) {
  function reviewerConfig(name = null) {
    const review = foundationPolicy().review || {};
    const identity = name || review.defaultReviewer;
    const config = review.reviewers?.[identity] || null;
    if (!identity || !config) fail(`unknown configured reviewer '${identity || ""}'`);
    if (!ADAPTERS.has(config.adapter) || !text(config.executable) ||
        !text(config.modelId) || !text(config.providerFamily) ||
        !text(config.modelFamily) || config.reasoningEffort !== "high" ||
        config.sandbox !== "read-only" || config.ephemeral !== true)
      fail(`configured reviewer '${identity}' must pin codex-cli|claude-cli, executable, provider/model identity, high reasoning, read-only sandbox, and ephemeral sessions`);
    return { identity, ...config };
  }

  function codexStatus(config) {
    const login = spawn(config.executable, ["login", "status"], {
      cwd: root, encoding: "utf8", timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024
    });
    if (login.error || login.status !== 0)
      return {
        ok: false, reviewer: config.identity, check: "authentication",
        detail: `Codex CLI is not authenticated; run 'codex login' (${diagnostic(login)})`
      };
    const doctor = spawn(config.executable, ["doctor"], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024
    });
    if (doctor.error || doctor.status !== 0)
      return {
        ok: false, reviewer: config.identity, check: "runtime",
        detail: `Codex CLI doctor failed; repair or reinstall Codex (${diagnostic(doctor)})`
      };
    const surface = spawn(config.executable, ["exec", "--help"], {
      cwd: root, encoding: "utf8", timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024
    });
    const help = `${surface.stdout || ""}\n${surface.stderr || ""}`;
    if (surface.error || surface.status !== 0 ||
        !["--output-schema", "--ephemeral", "--sandbox", "--model", "--cd"]
          .every((flag) => help.includes(flag)))
      return {
        ok: false, reviewer: config.identity, check: "cli-contract",
        detail: "Codex CLI lacks the exec flags required by Foundation; upgrade @openai/codex"
      };
    return null;
  }

  function claudeStatus(config) {
    const auth = spawn(config.executable, ["auth", "status", "--json"], {
      cwd: root, encoding: "utf8", timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024
    });
    const authValue = parseJson(auth.stdout);
    if (auth.error || auth.status !== 0 || authValue?.loggedIn !== true)
      return {
        ok: false, reviewer: config.identity, check: "authentication",
        detail: "Claude Code is not authenticated; run 'claude auth login'"
      };
    const surface = spawn(config.executable, ["--help"], {
      cwd: root, encoding: "utf8", timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024
    });
    const help = `${surface.stdout || ""}\n${surface.stderr || ""}`;
    if (surface.error || surface.status !== 0 || ![
      "--print", "--output-format", "--json-schema", "--model", "--effort",
      "--permission-mode", "--tools", "--safe-mode", "--session-id",
      "--no-session-persistence"
    ].every((flag) => help.includes(flag)))
      return {
        ok: false, reviewer: config.identity, check: "cli-contract",
        detail: "Claude Code lacks the headless/read-only/schema/session flags required by Foundation; run 'claude update'"
      };
    return null;
  }

  function reviewerStatus(name = null) {
    const config = reviewerConfig(name);
    if (!commandExists(config.executable, root)) {
      const install = config.adapter === "codex-cli"
        ? "npm install -g @openai/codex && codex login"
        : "npm install -g @anthropic-ai/claude-code && claude auth login";
      return {
        ok: false, reviewer: config.identity, check: "executable",
        detail: `${config.executable} is not installed; run '${install}'`
      };
    }
    const failure = config.adapter === "codex-cli"
      ? codexStatus(config) : claudeStatus(config);
    if (failure) return failure;
    return {
      ok: true, reviewer: config.identity, check: "ready",
      detail: `${config.executable}; ${config.adapter}; model ${config.modelId} ` +
        `(remote entitlement checked on dispatch); read-only; ephemeral; ` +
        "diversity checked from required implementation provenance"
    };
  }

  function persist(config, changeId, workspace, {
    status, summary, findings = [], verifiedFindingIds = [], sessionId = null
  }) {
    const reportDir = join(root, ".foundation", "reviews", changeId);
    mkdirSync(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${Date.now()}-${config.identity}.json`);
    const durable = {
      version: 1, changeId, reviewer: {
        identity: config.identity,
        providerFamily: config.providerFamily,
        modelFamily: config.modelFamily,
        modelId: config.modelId,
        sessionId: sessionId || null
      },
      status,
      summary: text(summary || "Configured reviewer infrastructure failure").slice(0, 8000),
      findings,
      verifiedFindingIds,
      command: {
        adapter: config.adapter,
        executable: config.executable,
        cwd: workspace || null,
        model: config.modelId,
        reasoningEffort: config.reasoningEffort,
        sandbox: config.sandbox,
        ephemeral: config.ephemeral
      },
      recordedAt: now()
    };
    writeFileSync(reportPath, `${JSON.stringify(durable, null, 2)}\n`);
    return { ...durable, reportPath, reportReference: relative(root, reportPath) };
  }

  function normalizeReview(config, changeId, workspace, review, sessionId,
    forbiddenSessionIds = []) {
    if (sessionId && forbiddenSessionIds.some((value) =>
      text(value).toLowerCase() === sessionId.toLowerCase()))
      return persist(config, changeId, workspace, {
        status: "error", sessionId,
        summary: "Configured reviewer reused an implementation session; independence requires a fresh session"
      });
    if (!validReview(review))
      return persist(config, changeId, workspace, {
        status: "error", sessionId,
        summary: `${config.adapter} reviewer returned a result outside the required schema`
      });
    const blockers = review.findings.filter((finding) =>
      ["blocker", "major"].includes(finding.severity));
    if (review.status === "fail" && review.findings.length === 0)
      return persist(config, changeId, workspace, {
        status: "error", sessionId,
        summary: `${config.adapter} reviewer returned fail without a blocker or major finding`
      });
    return persist(config, changeId, workspace, {
      status: blockers.length ? "fail"
        : review.status === "inconclusive" ? "inconclusive" : "pass",
      summary: review.summary,
      findings: review.findings,
      verifiedFindingIds: review.verifiedFindingIds,
      sessionId
    });
  }

  function runCodex(config, changeId, workspace, packet, forbiddenSessionIds) {
    const scratch = mkdtempSync(join(tmpdir(), "foundation-codex-review-"));
    try {
      const schemaPath = join(scratch, "review.schema.json");
      const outputPath = join(scratch, "review.json");
      writeFileSync(schemaPath, `${JSON.stringify(REVIEW_SCHEMA, null, 2)}\n`);
      const args = [
        "exec", "-C", workspace, "-m", config.modelId,
        "-s", config.sandbox, "--ephemeral",
        "-c", `model_reasoning_effort="${config.reasoningEffort}"`,
        "--output-schema", schemaPath, "--json", "-o", outputPath, "-"
      ];
      const result = spawn(config.executable, args, {
        cwd: workspace, encoding: "utf8", input: reviewPrompt(packet),
        timeout: Number(config.timeoutMs || 45 * 60 * 1000),
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, FOUNDATION_CHANGE_ID: changeId }
      });
      const events = String(result.stdout || "").split(/\r?\n/).filter(Boolean)
        .map(parseJson).filter(Boolean);
      const sessionId = text(events.find((event) =>
        event.type === "thread.started")?.thread_id);
      if (result.error || result.status !== 0)
        return persist(config, changeId, workspace, {
          status: "error", sessionId: sessionId || null,
          summary: `Codex reviewer failed: ${diagnostic(result)}`
        });
      if (!existsSync(outputPath))
        return persist(config, changeId, workspace, {
          status: "error", sessionId: sessionId || null,
          summary: "Codex reviewer returned no structured result"
        });
      const review = parseJson(readFileSync(outputPath, "utf8"));
      return normalizeReview(config, changeId, workspace, review,
        sessionId || null, forbiddenSessionIds);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  function runClaude(config, changeId, workspace, packet, forbiddenSessionIds) {
    const environment = {
      ...process.env, FOUNDATION_CHANGE_ID: changeId
    };
    // Claude Code rejects nested launches when its host marker is inherited.
    // The reviewer is an intentionally separate headless process/session.
    delete environment.CLAUDECODE;
    const requestedSession = uuid();
    const args = [
      "-p", "--output-format", "json",
      "--json-schema", JSON.stringify(REVIEW_SCHEMA),
      "--model", config.modelId,
      "--effort", config.reasoningEffort,
      "--permission-mode", "plan",
      "--tools", CLAUDE_READ_ONLY_TOOLS,
      "--safe-mode", "--no-session-persistence",
      "--session-id", requestedSession,
      reviewPrompt(packet)
    ];
    const result = spawn(config.executable, args, {
      cwd: workspace, encoding: "utf8",
      timeout: Number(config.timeoutMs || 45 * 60 * 1000),
      maxBuffer: 64 * 1024 * 1024,
      env: environment
    });
    const envelope = claudeResultEnvelope(result.stdout);
    const sessionId = text(envelope?.session_id);
    if (envelope?.envelopeError)
      return persist(config, changeId, workspace, {
        status: "error", sessionId: sessionId || null,
        summary: `Claude Code reviewer returned an invalid event envelope (${envelope.envelopeError})`
      });
    if (result.error || result.status !== 0 || envelope?.is_error === true ||
        envelope?.subtype && envelope.subtype !== "success")
      return persist(config, changeId, workspace, {
        status: "error", sessionId: sessionId || null,
        summary: `Claude Code reviewer failed: ${diagnostic(result)}`
      });
    if (sessionId && forbiddenSessionIds.some((value) =>
      text(value).toLowerCase() === sessionId.toLowerCase()))
      return persist(config, changeId, workspace, {
        status: "error", sessionId,
        summary: "Configured reviewer reused an implementation session; independence requires a fresh session"
      });
    if (!sessionId || sessionId !== requestedSession)
      return persist(config, changeId, workspace, {
        status: "error", sessionId: sessionId || null,
        summary: "Claude Code reviewer did not return the exact fresh session ID assigned to the dispatch"
      });
    const review = envelope?.structured_output ||
      (typeof envelope?.result === "object" ? envelope.result : parseJson(envelope?.result));
    return normalizeReview(config, changeId, workspace, review, sessionId,
      forbiddenSessionIds);
  }

  function runReview({
    changeId, reviewer = null, workspace, packet, forbiddenSessionIds = []
  }) {
    const config = reviewerConfig(reviewer);
    const status = reviewerStatus(config.identity);
    // Authority reserves the attempt before this call. Every later failure is
    // therefore a durable infrastructure result, never a thrown orphan.
    if (!status.ok)
      return persist(config, changeId, workspace, {
        status: "error", summary: status.detail
      });
    if (!workspace || !existsSync(workspace))
      return persist(config, changeId, workspace, {
        status: "error",
        summary: `review workspace does not exist: ${workspace || "<missing>"}`
      });
    return config.adapter === "codex-cli"
      ? runCodex(config, changeId, workspace, packet, forbiddenSessionIds)
      : runClaude(config, changeId, workspace, packet, forbiddenSessionIds);
  }

  return { reviewerConfig, reviewerStatus, runReview };
}
