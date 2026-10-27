import { join, resolve } from "node:path";

export const LAND_GRANT_VERSION = 1;

function sessionId(env = process.env) {
  return env.FOUNDATION_CLAUDE_SESSION_ID || env.FOUNDATION_SESSION_ID ||
    env.CODEX_THREAD_ID || env.CLAUDE_SESSION_ID || null;
}

export function landGrantBinding({ state, proof, repositories, stableHash }) {
  const targets = repositories.filter((repository) => repository.mode === "write")
    .map((repository) => ({
      id: repository.id,
      type: repository.type || "git",
      targetPath: resolve(repository.path),
      baseHead: (repository.id === "root"
        ? state.repositories?.root || state.workspace
        : state.repositories?.[repository.id])?.baseHead || null
    })).sort((left, right) => left.id.localeCompare(right.id));
  return {
    changeId: state.id || state.changeId,
    revision: Number(state.revision || 0),
    contractRevision: Number(state.contractRevision || 0),
    executionRevision: Number(state.executionRevision || 0),
    proofRunId: proof.proofRunId || null,
    proofWorkspaceHash: proof.workspaceHash || null,
    repositoryGraph: stableHash(repositories.map((repository) => ({
      id: repository.id,
      type: repository.type || "git",
      mode: repository.mode,
      dependsOn: [...(repository.dependsOn || [])].sort(),
      targetPath: resolve(repository.path)
    })).sort((left, right) => left.id.localeCompare(right.id))),
    targets
  };
}

export function createLandGrantRuntime({
  transactions, loadRuntime, selectedRepositories, proofPath, readJson, writeJson,
  stableHash, now, landCheck, env = process.env
}) {
  const grantPath = (id) => join(transactions, id, "land-grant.json");

  function currentBinding(id) {
    const state = loadRuntime(id);
    const proof = readJson(proofPath(id), {});
    return landGrantBinding({
      state,
      proof,
      repositories: selectedRepositories(id, state),
      stableHash
    });
  }

  function issue(id) {
    // Archive recovery validates its own durable state before cleanup and does
    // not mutate product files. Avoid asking landCheck to announce an archived
    // success before that recovery has rejected a corrupt spec-sync result.
    if (loadRuntime(id).status === "archived") return null;
    landCheck(id);
    const binding = currentBinding(id);
    const body = {
      version: LAND_GRANT_VERSION,
      status: "active",
      sessionId: sessionId(env),
      binding,
      forbidden: ["stage", "commit", "push", "publish", "deploy", "open-pr"],
      issuedAt: now()
    };
    const grant = { ...body, digest: stableHash(body) };
    writeJson(grantPath(id), grant);
    return grant;
  }

  function read(id) {
    return readJson(grantPath(id), null);
  }

  function valid(id) {
    const grant = read(id);
    if (!grant || grant.version !== LAND_GRANT_VERSION || grant.status !== "active")
      return { valid: false, reason: "missing-land-grant" };
    const { digest, ...body } = grant;
    if (digest !== stableHash(body)) return { valid: false, reason: "invalid-land-grant" };
    const currentSession = sessionId(env);
    if ((grant.sessionId || null) !== currentSession)
      return { valid: false, reason: "land-grant-session-mismatch" };
    const binding = currentBinding(id);
    if (stableHash(binding) !== stableHash(grant.binding))
      return { valid: false, reason: "stale-land-grant", expected: binding };
    return { valid: true, grant };
  }

  function assert(id) {
    const result = valid(id);
    if (!result.valid) {
      const error = new Error(
        `Land authority is unavailable for '${id}' (${result.reason})`);
      error.code = "LAND_GRANT_REQUIRED";
      error.owner = "user";
      error.boundary = "land-authority";
      throw error;
    }
    return result.grant;
  }

  function consume(id) {
    const grant = read(id);
    if (!grant || grant.status !== "active") return grant;
    const body = {
      ...grant,
      status: "consumed",
      consumedAt: now()
    };
    delete body.digest;
    const consumed = { ...body, digest: stableHash(body) };
    writeJson(grantPath(id), consumed);
    return consumed;
  }

  return { grantPath, issue, read, valid, assert, consume };
}
