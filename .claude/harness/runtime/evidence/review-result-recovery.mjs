import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { normalizeReviewFindingPaths, validReview } from "./configured-reviewer.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

function readReport(root, changeId, reference) {
  const directory = realpathSync(resolve(root, ".foundation/reviews", changeId));
  const path = realpathSync(resolve(root, reference));
  const rel = relative(directory, path);
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw new Error("configured review result escapes its change report directory");
  const content = readFileSync(path, "utf8");
  return { path, content, report: JSON.parse(content) };
}

export function checkpointReviewResult(root, request, subject, report) {
  if (report.status === "error" || !report.reportPath) return null;
  const saved = readReport(root, request.changeId, report.reportReference);
  return {
    version: 1, reportReference: report.reportReference,
    reportDigest: digest(saved.content), packetDigest: request.packetDigest,
    workspaceHash: request.workspaceHash, subject
  };
}

export function recoverReviewResult(root, request, subject, configured, workspaceHash) {
  const checkpoint = request.configuredResult;
  if (!checkpoint) return null;
  if (checkpoint.version !== 1 || checkpoint.packetDigest !== request.packetDigest ||
      checkpoint.workspaceHash !== request.workspaceHash ||
      workspaceHash !== request.workspaceHash ||
      JSON.stringify(checkpoint.subject) !== JSON.stringify(subject))
    throw new Error("configured review result binding changed; preserve the report and request a current review");
  const { path, content, report } = readReport(root, request.changeId, checkpoint.reportReference);
  if (digest(content) !== checkpoint.reportDigest || report.changeId !== request.changeId ||
      !validReview(report) || !report.reviewer?.sessionId ||
      ["identity", "providerFamily", "modelFamily", "modelId"].some((field) =>
        report.reviewer[field] !== configured[field]))
    throw new Error("configured review result integrity or reviewer provenance does not match");
  return { ...normalizeReviewFindingPaths(report, request.packet),
    reportPath: path, reportReference: checkpoint.reportReference };
}
