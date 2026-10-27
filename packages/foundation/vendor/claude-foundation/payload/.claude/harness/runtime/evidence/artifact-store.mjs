import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function artifactSourceCandidates(root, workspace, artifact) {
  const projectCandidate = resolve(root, artifact.path);
  const workspaceCandidate = resolve(workspace, artifact.path);
  const controlPlaneArtifact = ["command-log", "service-log"].includes(artifact.type) ||
    String(artifact.path).replaceAll("\\", "/").startsWith(".foundation/");
  return controlPlaneArtifact
    ? [projectCandidate, workspaceCandidate]
    : [workspaceCandidate, projectCandidate];
}

export function durableArtifactOperation({
  root,
  providerWorkspace,
  proofRunRoot,
  canonicalPath,
  pathInside,
  fileDigest,
  fail
}, id, provider, proofRunId, artifact) {
  if (!artifact?.path || typeof artifact.path !== "string")
    fail(`provider '${provider}' artifact requires a path`);
  const workspace = canonicalPath(providerWorkspace(id, provider));
  const candidates = artifactSourceCandidates(root, workspace, artifact);
  const source = candidates.find((candidate) => existsSync(candidate)) || candidates[0];
  if (!existsSync(source)) {
    if (artifact.required === false) return { ...artifact, missing: true };
    fail(`required artifact is missing: ${artifact.path}`);
  }
  const realSource = realpathSync(source);
  if (!pathInside(root, realSource) && !pathInside(workspace, realSource))
    fail(`artifact escapes the project workspace: ${artifact.path}`);
  if (!statSync(realSource).isFile())
    fail(`artifact is not a regular file: ${artifact.path}`);
  const sha256 = fileDigest(realSource);
  const safeName = basename(realSource).replace(/[^a-zA-Z0-9._-]+/g, "-") || "artifact";
  const destination = join(
    proofRunRoot(id, proofRunId), "artifacts", provider,
    `${sha256.slice(0, 12)}-${safeName}`
  );
  mkdirSync(dirname(destination), { recursive: true });
  if (!existsSync(destination)) cpSync(realSource, destination);
  return {
    path: relative(root, destination).replaceAll("\\", "/"),
    sourcePath: pathInside(root, realSource)
      ? relative(root, realSource).replaceAll("\\", "/")
      : relative(workspace, realSource).replaceAll("\\", "/"),
    type: artifact.type || "artifact",
    required: artifact.required !== false,
    sha256,
    size: statSync(destination).size
  };
}

export function createArtifactStore({
  root,
  prototypesRoot,
  evidenceVault,
  canonicalPath,
  providerWorkspace,
  proofRunRoot,
  pathInside,
  fileDigest,
  fail
}) {
  function decodedEvidencePath(value) {
    const text = String(value || "").trim();
    try { return decodeURIComponent(text); }
    catch { return text; }
  }

  function evidenceInputTargetsPrototype(value, workspace) {
    let decoded = decodedEvidencePath(value);
    if (!decoded) return false;
    const slashPath = decoded.replaceAll("\\", "/").toLowerCase();
    if (/(^|\/)\.foundation\/prototypes(?:\/|$)/.test(slashPath)) return true;
    if (/^file:/i.test(decoded)) {
      try { decoded = fileURLToPath(decoded); }
      catch { return false; }
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(decoded)) {
      return false;
    }
    const roots = [...new Set([
      prototypesRoot,
      join(workspace, ".foundation", "prototypes")
    ].map((path) => resolve(path)))];
    const candidates = isAbsolute(decoded)
      ? [resolve(decoded)]
      : [resolve(root, decoded), resolve(workspace, decoded)];
    return candidates.some((candidate) => {
      if (roots.some((prototypeRoot) => pathInside(prototypeRoot, candidate))) return true;
      if (!existsSync(candidate)) return false;
      const realCandidate = realpathSync(candidate);
      return roots.some((prototypeRoot) => pathInside(prototypeRoot, realCandidate));
    });
  }

  function rejectPrototypeEvidenceInputs(id, provider, artifacts, references) {
    const workspace = canonicalPath(providerWorkspace(id, provider));
    const values = [
      ...artifacts.map((artifact) => artifact?.path),
      ...references
    ].filter(Boolean);
    const rejected = values.find((value) =>
      evidenceInputTargetsPrototype(value, workspace));
    if (rejected)
      fail(`prototype artifacts and references are non-authoritative and cannot satisfy evidence: ${rejected}`);
  }

  function receiptPrototypeEvidence(id, provider, receipt) {
    const workspace = canonicalPath(providerWorkspace(id, provider));
    const values = [
      ...(receipt.references || []),
      ...(receipt.artifacts || []).flatMap((artifact) => [
        artifact?.path, artifact?.sourcePath
      ]),
      receipt.provenance?.source
    ].filter(Boolean);
    return values.find((value) => evidenceInputTargetsPrototype(value, workspace)) || null;
  }

  const durableArtifact = durableArtifactOperation.bind(null, {
    root,
    providerWorkspace,
    proofRunRoot,
    canonicalPath,
    pathInside,
    fileDigest,
    fail
  });

  function validateArtifact(artifact) {
    if (artifact.required === false && artifact.missing) return true;
    if (!artifact.path || !pathInside(evidenceVault, resolve(root, artifact.path)))
      return false;
    const artifactPath = resolve(root, artifact.path);
    if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) return false;
    return artifact.sha256 === fileDigest(artifactPath) &&
      Number(artifact.size) === statSync(artifactPath).size;
  }

  return {
    decodedEvidencePath,
    evidenceInputTargetsPrototype,
    rejectPrototypeEvidenceInputs,
    receiptPrototypeEvidence,
    durableArtifact,
    validateArtifact
  };
}
