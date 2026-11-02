import {
  accessSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync,
  statSync, writeFileSync
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { verifySignedPayload } from "../core/trust.mjs";

function canonicalOrSelf(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

function isWithinPath(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function writableControlSocket(path, options = {}) {
  const {
    exists = existsSync, realpath = realpathSync, stat = statSync, access = accessSync
  } = options;
  if (!path || !exists(path)) return false;
  try {
    const resolved = realpath(path);
    const metadata = stat(resolved);
    if (!metadata.isSocket() && !metadata.isFile()) return false;
    access(resolved, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function inspectContainerBoundary(options = {}) {
  const { exists = existsSync, read = readFileSync, env = process.env } = options;
  const evidence = [];
  let kind = "unknown";
  let status = "not-detected";
  if (exists("/.dockerenv")) {
    kind = "container";
    status = "detected";
    evidence.push({ source: "filesystem", value: "/.dockerenv" });
  } else if (exists("/run/.containerenv")) {
    kind = "container";
    status = "detected";
    evidence.push({ source: "filesystem", value: "/run/.containerenv" });
  } else {
    try {
      const cgroup = read("/proc/1/cgroup", "utf8").toLowerCase();
      const token = ["docker", "containerd", "kubepods", "lxc", "podman"]
        .find((candidate) => cgroup.includes(candidate));
      if (token) {
        kind = "container";
        status = "detected";
        evidence.push({ source: "cgroup", value: token });
      }
    } catch {
      // Platforms without procfs remain unknown unless another strong signal exists.
    }
  }
  if (kind === "unknown" && env.CODESPACES === "true" && exists("/workspaces")) {
    kind = "container";
    status = "detected";
    evidence.push({ source: "codespaces", value: "/workspaces" });
  }
  return { kind, status, evidence };
}

export function controlSocketCandidates(hostRoot = "", env = process.env) {
  const hostPath = (path) => (hostRoot ? join(hostRoot, path) : path);
  const candidates = [
    "/var/run/docker.sock", "/run/docker.sock", "/run/podman/podman.sock",
    "/run/containerd/containerd.sock", "/var/run/crio/crio.sock"
  ].map(hostPath);
  const runtimeDir = env.XDG_RUNTIME_DIR || "";
  if (runtimeDir) {
    candidates.push(join(runtimeDir, "docker.sock"));
    candidates.push(join(runtimeDir, "podman", "podman.sock"));
  }
  const dockerHost = env.DOCKER_HOST || "";
  if (dockerHost.startsWith("unix://")) candidates.push(dockerHost.slice("unix://".length));
  const containerHost = env.CONTAINER_HOST || "";
  if (containerHost.startsWith("unix://"))
    candidates.push(containerHost.slice("unix://".length));
  return candidates;
}

export function securityBoundaryHazards(options = {}) {
  const {
    hostRoot = "", env = process.env, exists = existsSync,
    writable = writableControlSocket
  } = options;
  const hostPath = (path) => (hostRoot ? join(hostRoot, path) : path);
  const dockerHost = env.DOCKER_HOST || "";
  const containerHost = env.CONTAINER_HOST || "";
  const hazards = [...new Set(controlSocketCandidates(hostRoot, env).filter(writable))]
    .sort().map((path) => `writable host-control socket: ${path}`);
  if (dockerHost && !dockerHost.startsWith("unix://"))
    hazards.push(`remote Docker control endpoint configured (${dockerHost.split(":", 1)[0] || "unknown"})`);
  if (containerHost && !containerHost.startsWith("unix://"))
    hazards.push(`remote container control endpoint configured (${containerHost.split(":", 1)[0] || "unknown"})`);
  if (exists(hostPath("/var/run/secrets/kubernetes.io/serviceaccount/token")))
    hazards.push("mounted Kubernetes service-account credential");
  if (env.SSH_AUTH_SOCK && exists(env.SSH_AUTH_SOCK))
    hazards.push("mounted SSH agent socket");
  return hazards;
}

export function securityBoundaryInspection(options = {}) {
  const {
    env = process.env, exists = existsSync, read = readFileSync,
    writable = writableControlSocket
  } = options;
  const boundary = inspectContainerBoundary({ exists, read, env });
  // These probes are absolute host paths, which makes the scan depend on the
  // machine running it: a CI runner with Docker installed owns a writable
  // /var/run/docker.sock, so no attestation could ever authorize unattended
  // work there. Under FOUNDATION_TESTING the probes re-root into a fixture
  // tree — the same gating the trust root uses below — so a suite exercises the
  // contract instead of its host. Production never sets it and keeps the real
  // absolute paths.
  const hostRoot =
    env.FOUNDATION_TESTING === "1" && env.FOUNDATION_TEST_HOST_ROOT
      ? resolve(env.FOUNDATION_TEST_HOST_ROOT)
      : "";
  const hazards = securityBoundaryHazards({ hostRoot, env, exists, writable });
  return { ...boundary, hazards };
}

export function createHostAttestationRuntime(options) {
  const {
    root, attestations, protocolVersion, loadRuntime, changePath, directoryHash,
    stableHash, readJson, writeJson, now, writeFileExclusive
  } = Object.assign({ writeFileExclusive: writeFileSync }, options);
  const challengePath = (id) => join(attestations, "challenges", `${id}.json`);

  function createChallenge(id) {
    loadRuntime(id);
    const challenge = {
      version: Number(protocolVersion), changeId: id, projectRoot: root,
      agreementHash: directoryHash(changePath(id)),
      nonce: randomBytes(24).toString("base64url"),
      requiredPermissions: {
        filesystem: "sandbox-only", process: "contained", secrets: "none",
        network: "restricted", devices: "none"
      },
      issuedAt: now(), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };
    writeJson(challengePath(id), challenge);
    return challenge;
  }

  function trustedHostRoots() {
    const roots = (process.platform === "darwin"
      ? ["/Library/Application Support/Claude Foundation/trusted-hosts.json",
        "/etc/claude-foundation/trusted-hosts.json"]
      : ["/etc/claude-foundation/trusted-hosts.json"])
      .map((path) => ({ path, administered: true }));
    // The trust root decides who may authorize unattended work, so the party
    // being gated must not be able to point it at a file they wrote. A fixture
    // root is accepted only from inside the system temp directory — where a
    // suite puts one and an installed project does not — and it is announced,
    // so it cannot be in force without anyone noticing.
    const fixture = process.env.FOUNDATION_TESTING === "1" &&
      process.env.FOUNDATION_TEST_TRUST_ROOT
      ? resolve(process.env.FOUNDATION_TEST_TRUST_ROOT) : "";
    if (fixture) {
      if (!isWithinPath(canonicalOrSelf(tmpdir()), canonicalOrSelf(fixture)))
        console.error(
          `WARNING: ignoring FOUNDATION_TEST_TRUST_ROOT '${fixture}': a fixture trust root must live under ${tmpdir()}`);
      else {
        console.error(`WARNING: using the fixture attestation trust root '${fixture}'`);
        roots.unshift({ path: fixture, administered: false });
      }
    }
    return roots;
  }

  function loadTrustedHostRoot(path, administered) {
    if (!existsSync(path)) return null;
    let stat;
    try { stat = lstatSync(path); } catch { return null; }
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0) return null;
    // `chmod 600` on a self-authored file satisfies the mode check, so mode
    // alone does not establish that an administrator installed this. The
    // real roots live in root-owned system directories; require that.
    if (administered && stat.uid !== 0) {
      console.error(
        `WARNING: ignoring trust root '${path}': it is not owned by root, so it does not establish administered trust`);
      return null;
    }
    const value = readJson(path, {});
    if (value.version !== 1 || !value.issuers || typeof value.issuers !== "object") return null;
    return value;
  }

  function trustedIssuer(config, trustRoot) {
    if (config?.algorithm !== "ed25519" ||
        !String(config.publicKey || "").includes("PUBLIC KEY")) return null;
    return { ...config, trustRoot };
  }

  function trustedHostIssuers() {
    const issuers = {};
    for (const { path, administered } of trustedHostRoots()) {
      const value = loadTrustedHostRoot(path, administered);
      if (!value) continue;
      for (const [issuer, config] of Object.entries(value.issuers)) {
        const trusted = trustedIssuer(config, path);
        if (trusted) issuers[issuer] = trusted;
      }
    }
    return issuers;
  }

  const invalidAttestation = (reason) => ({ valid: false, reason });

  function attestationInput(id, path) {
    if (!path)
      return { result: invalidAttestation("trusted host attestation was not supplied") };
    const absolute = resolve(path);
    if (!existsSync(absolute))
      return { result: invalidAttestation("attestation file is missing") };
    const envelope = readJson(absolute, {});
    return {
      envelope, payload: envelope.payload,
      challenge: readJson(challengePath(id), {})
    };
  }

  function envelopeValidity(context) {
    const { envelope, payload } = context;
    if (String(envelope.version) !== protocolVersion || !payload ||
        typeof envelope.signature !== "string")
      return invalidAttestation("attestation envelope is malformed");
    return null;
  }

  function issuerValidity(context) {
    const { envelope, payload } = context;
    const issuer = trustedHostIssuers()[payload.issuer];
    if (!issuer)
      return { result: invalidAttestation(
        `issuer '${payload.issuer || "unknown"}' is not trusted`) };
    if (!verifySignedPayload(payload, envelope.signature, issuer.publicKey))
      return { result: invalidAttestation("attestation signature is invalid") };
    return { issuer };
  }

  function challengeValidity(id, payload, challenge) {
    if (String(challenge.version) !== protocolVersion ||
        String(payload.version) !== protocolVersion ||
        payload.nonce !== challenge.nonce || payload.changeId !== id ||
        payload.projectRoot !== root ||
        payload.agreementHash !== directoryHash(changePath(id)) ||
        payload.agreementHash !== challenge.agreementHash)
      return invalidAttestation(
        "attestation does not match the current challenge, project, or agreement");
    return null;
  }

  function lifetimeValidity(payload, challenge) {
    const issuedAt = Date.parse(payload.issuedAt || "");
    const expiresAt = Date.parse(payload.expiresAt || "");
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
        issuedAt > Date.now() + 60_000 || expiresAt <= Date.now() ||
        expiresAt - issuedAt > 15 * 60 * 1000 ||
        expiresAt > Date.parse(challenge.expiresAt || ""))
      return invalidAttestation("attestation lifetime is invalid or expired");
    return null;
  }

  function permissionValidity(payload, challenge) {
    const permissions = payload.permissions || {};
    const required = challenge.requiredPermissions || {};
    const mismatched = Object.entries(required)
      .filter(([key, value]) => permissions[key] !== value);
    if (mismatched.length)
      return invalidAttestation(
        `attestation permission mismatch: ${mismatched.map(([key]) => key).join(", ")}`);
    return { permissions };
  }

  function consumeAttestation(id, payload, issuer, consume) {
    const usedPath = join(attestations, "used", `${stableHash(payload.nonce)}.json`);
    if (existsSync(usedPath))
      return invalidAttestation("attestation nonce was already consumed");
    if (!consume) return null;
    mkdirSync(dirname(usedPath), { recursive: true });
    try {
      writeFileExclusive(usedPath, `${JSON.stringify({
        version: 1, changeId: id, issuer: payload.issuer,
        nonceDigest: stableHash(payload.nonce), agreementHash: payload.agreementHash,
        consumedAt: now(), trustRoot: issuer.trustRoot
      }, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      if (error.code === "EEXIST")
        return invalidAttestation("attestation nonce was already consumed");
      throw error;
    }
    return null;
  }

  function validate(id, path, consume = false) {
    const input = attestationInput(id, path);
    if (input.result) return input.result;
    const envelopeIssue = envelopeValidity(input);
    if (envelopeIssue) return envelopeIssue;
    const trust = issuerValidity(input);
    if (trust.result) return trust.result;
    const challengeIssue = challengeValidity(id, input.payload, input.challenge);
    if (challengeIssue) return challengeIssue;
    const lifetimeIssue = lifetimeValidity(input.payload, input.challenge);
    if (lifetimeIssue) return lifetimeIssue;
    const permission = permissionValidity(input.payload, input.challenge);
    if (permission.valid === false) return permission;
    const consumptionIssue = consumeAttestation(id, input.payload, trust.issuer, consume);
    if (consumptionIssue) return consumptionIssue;
    return {
      valid: true, reason: "signed host attestation is valid", issuer: input.payload.issuer,
      expiresAt: input.payload.expiresAt, permissions: permission.permissions,
      trustRoot: trust.issuer.trustRoot
    };
  }

  function preflight(id, flags = {}, consume = false) {
    const securityBoundary = securityBoundaryInspection();
    const attestation = validate(id, flags.attestation, consume);
    const reasons = [];
    if (!attestation.valid) reasons.push(attestation.reason);
    reasons.push(...securityBoundary.hazards);
    const safeForUnattended = attestation.valid && securityBoundary.hazards.length === 0;
    return {
      securityBoundary,
      boundaryDetected: securityBoundary.status === "detected",
      attestation,
      safeForUnattended,
      reasons: safeForUnattended ? [attestation.reason] : reasons
    };
  }

  return { createChallenge, validate, preflight };
}
