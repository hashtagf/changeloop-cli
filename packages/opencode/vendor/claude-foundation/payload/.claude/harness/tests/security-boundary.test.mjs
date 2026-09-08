import assert from "node:assert/strict";
import test from "node:test";
import {
  controlSocketCandidates,
  inspectContainerBoundary,
  securityBoundaryHazards,
  securityBoundaryInspection,
  writableControlSocket
} from "../runtime/evidence/attestation.mjs";

const noPaths = () => false;

test("writableControlSocket accepts writable sockets and files only", () => {
  const base = {
    exists: () => true,
    realpath: (path) => `/real${path}`,
    access: () => {}
  };
  assert.equal(writableControlSocket(""), false);
  assert.equal(writableControlSocket("/missing", { exists: noPaths }), false);
  assert.equal(writableControlSocket("/socket", {
    ...base, stat: () => ({ isSocket: () => true, isFile: () => false })
  }), true);
  assert.equal(writableControlSocket("/file", {
    ...base, stat: () => ({ isSocket: () => false, isFile: () => true })
  }), true);
  assert.equal(writableControlSocket("/directory", {
    ...base, stat: () => ({ isSocket: () => false, isFile: () => false })
  }), false);
  assert.equal(writableControlSocket("/denied", {
    ...base,
    stat: () => ({ isSocket: () => true, isFile: () => false }),
    access: () => { throw new Error("denied"); }
  }), false);
});

test("inspectContainerBoundary recognizes every supported strong signal", () => {
  const existsOnly = (expected) => (path) => path === expected;
  assert.deepEqual(inspectContainerBoundary({
    exists: existsOnly("/.dockerenv"), read: () => { throw new Error("unused"); }, env: {}
  }), {
    kind: "container", status: "detected",
    evidence: [{ source: "filesystem", value: "/.dockerenv" }]
  });
  assert.equal(inspectContainerBoundary({
    exists: existsOnly("/run/.containerenv"), read: () => "", env: {}
  }).evidence[0].value, "/run/.containerenv");
  for (const token of ["docker", "containerd", "kubepods", "lxc", "podman"])
    assert.deepEqual(inspectContainerBoundary({
      exists: noPaths, read: () => `0::/${token}/scope`, env: {}
    }).evidence, [{ source: "cgroup", value: token }]);
  assert.deepEqual(inspectContainerBoundary({
    exists: existsOnly("/workspaces"), read: () => "host", env: { CODESPACES: "true" }
  }).evidence, [{ source: "codespaces", value: "/workspaces" }]);
  assert.deepEqual(inspectContainerBoundary({
    exists: noPaths, read: () => { throw new Error("no procfs"); }, env: {}
  }), { kind: "unknown", status: "not-detected", evidence: [] });
});

test("controlSocketCandidates combines host, runtime and explicit unix sockets", () => {
  const candidates = controlSocketCandidates("/fixture-host", {
    XDG_RUNTIME_DIR: "/runtime/user",
    DOCKER_HOST: "unix:///custom/docker.sock",
    CONTAINER_HOST: "unix:///custom/podman.sock"
  });
  assert.equal(candidates.length, 9);
  assert.ok(candidates.some((path) => path.endsWith("/var/run/docker.sock")));
  assert.ok(candidates.includes("/runtime/user/docker.sock"));
  assert.ok(candidates.includes("/runtime/user/podman/podman.sock"));
  assert.ok(candidates.includes("/custom/docker.sock"));
  assert.ok(candidates.includes("/custom/podman.sock"));
  assert.equal(controlSocketCandidates("", {
    DOCKER_HOST: "tcp://docker.example:2375",
    CONTAINER_HOST: "https://container.example"
  }).length, 5);
});

test("securityBoundaryHazards reports unique local and configured host controls", () => {
  const env = {
    DOCKER_HOST: "tcp://docker.example:2375",
    CONTAINER_HOST: "https://container.example",
    SSH_AUTH_SOCK: "/agent/socket"
  };
  const hazards = securityBoundaryHazards({
    hostRoot: "/fixture-host", env,
    writable: (path) => path.endsWith("/var/run/docker.sock"),
    exists: (path) => path.endsWith("/serviceaccount/token") || path === env.SSH_AUTH_SOCK
  });
  assert.deepEqual(hazards, [
    "writable host-control socket: /fixture-host/var/run/docker.sock",
    "remote Docker control endpoint configured (tcp)",
    "remote container control endpoint configured (https)",
    "mounted Kubernetes service-account credential",
    "mounted SSH agent socket"
  ]);
  assert.deepEqual(securityBoundaryHazards({ env: {}, exists: noPaths, writable: noPaths }), []);
});

test("securityBoundaryInspection composes boundary evidence with fixture-root hazards", () => {
  const visited = [];
  const result = securityBoundaryInspection({
    env: {
      FOUNDATION_TESTING: "1", FOUNDATION_TEST_HOST_ROOT: "/fixture-host",
      DOCKER_HOST: "unix:///fixture-host/custom.sock"
    },
    exists: (path) => path === "/.dockerenv",
    read: () => "",
    writable: (path) => { visited.push(path); return path.endsWith("custom.sock"); }
  });
  assert.equal(result.kind, "container");
  assert.equal(result.status, "detected");
  assert.deepEqual(result.hazards,
    ["writable host-control socket: /fixture-host/custom.sock"]);
  assert.ok(visited.some((path) => path.startsWith("/fixture-host/")));
  const actualHost = securityBoundaryInspection();
  assert.ok(["container", "unknown"].includes(actualHost.kind));
  assert.ok(Array.isArray(actualHost.hazards));
});
