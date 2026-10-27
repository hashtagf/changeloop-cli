// Builds the concrete `authority run` command for a review request from the
// stored request and the calling host's environment. A value is left as a named
// `<placeholder>` only when neither the request nor the environment knows it.

const shellValue = (value) => /^[\w.:@/+=-]+$/.test(value)
  ? value : `'${value.replace(/'/g, "'\\''")}'`;

const text = (value) => String(value || "").trim();

function hostSession(env) {
  const claude = text(env.FOUNDATION_CLAUDE_SESSION_ID);
  const codex = text(env.CODEX_THREAD_ID);
  const session = claude || text(env.FOUNDATION_SESSION_ID) || codex ||
    text(env.FOUNDATION_MAIN_SESSION_ID);
  if (session && session === claude)
    return { session, provider: "anthropic", identity: "claude-main-session" };
  if (session && session === codex)
    return { session, provider: "openai", identity: "codex-main-session" };
  return { session, provider: "", identity: "" };
}

export function authorityStatusCommand(id, requestId) {
  return `claude-foundation authority status ${id} --request ${requestId} --template`;
}

// Returns { command, placeholders, unresolved }: placeholders names every
// `<value>` the caller must still supply; unresolved names AI subject fields
// the host did not expose (the command then runs as a non-AI subject).
export function authorityRunCommand(id, request, env = process.env) {
  const flags = [];
  const placeholders = [];
  const unresolved = [];
  const add = (flag, value, placeholder) => {
    if (value) flags.push(`--${flag} ${shellValue(value)}`);
    else if (placeholder) {
      flags.push(`--${flag} <${placeholder}>`);
      placeholders.push(placeholder);
    }
  };
  const host = hostSession(env);
  const fallback = request.mainSessionFallback || null;
  const stored = fallback?.subject?.identity ? fallback.subject : null;
  const declared = {
    identity: text(env.FOUNDATION_MAIN_IDENTITY) || host.identity,
    provider: (text(env.FOUNDATION_MAIN_PROVIDER_FAMILY) || host.provider).toLowerCase(),
    family: text(env.FOUNDATION_MAIN_MODEL_FAMILY).toLowerCase(),
    model: text(env.FOUNDATION_MODEL_ID)
  };
  if (stored) {
    add("subject-actor", stored.identity);
    if (stored.sessionId) {
      add("subject-session", stored.sessionId);
      add("subject-provider-family", stored.providerFamily, "subject-provider-family");
      add("subject-model-family", stored.modelFamily, "subject-model-family");
      add("subject-model", stored.modelId, "subject-model");
    }
  } else if (host.session && declared.identity && declared.provider &&
             declared.family && declared.model) {
    // An AI implementer needs complete provenance; the calling host is the
    // implementer unless the request recorded otherwise.
    add("subject-actor", declared.identity);
    add("subject-session", host.session);
    add("subject-provider-family", declared.provider);
    add("subject-model-family", declared.family);
    add("subject-model", declared.model);
  } else {
    // Partial provenance is never sent: the run stays executable as a
    // non-AI subject, and the gap is named so it can be exported.
    add("subject-actor", "implementation-agent");
    if (host.session) {
      for (const [name, value] of [["identity", declared.identity],
        ["provider-family", declared.provider], ["model-family", declared.family],
        ["model", declared.model]])
        if (!value) unresolved.push(`subject-${name === "identity" ? "actor" : name}`);
    }
  }
  if (fallback) {
    const missing = fallback.missingProvenance?.length ? fallback.missingProvenance
      : ["identity", "providerFamily", "modelFamily", "modelId"];
    const fields = {
      identity: ["main-session-identity", declared.identity],
      providerFamily: ["main-session-provider-family", declared.provider],
      modelFamily: ["main-session-model-family", declared.family],
      modelId: ["main-session-model", declared.model]
    };
    for (const name of missing) {
      if (!fields[name]) continue;
      const [flag, value] = fields[name];
      add(flag, value, flag);
    }
    // The session id cannot be supplied by flag: it must be the host's own.
    if (missing.includes("sessionId") && !host.session)
      placeholders.push("host-session (export FOUNDATION_SESSION_ID or run inside the host session)");
  }
  return {
    command: `claude-foundation authority run ${id} --request ${request.requestId} ${flags.join(" ")}`,
    placeholders,
    unresolved
  };
}
