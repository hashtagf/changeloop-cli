import assert from "node:assert/strict";
import test from "node:test";
import {
  providerDependencyIssues,
  providerReportIssues,
  serviceResourceIssues,
  topologyIssuesOperation,
  visitProviderTopology
} from "../runtime/evidence/proof-readiness.mjs";

test("provider dependency analysis names cycles and ignores unknown dependencies", () => {
  const providers = {
    build: { dependsOn: ["test"] },
    test: { dependsOn: ["review"] },
    review: { dependsOn: ["build"] },
    external: { dependsOn: ["missing"] }
  };
  assert.deepEqual(providerDependencyIssues(providers), [
    "provider dependency cycle: build -> test -> review -> build"
  ]);
  assert.deepEqual(providerDependencyIssues({
    build: { dependsOn: [] }, test: { dependsOn: ["build"] }
  }), []);
  assert.deepEqual(providerDependencyIssues({ self: { dependsOn: ["self"] } }), [
    "provider dependency cycle: self -> self"
  ]);
});

test("provider traversal preserves shared acyclic dependencies", () => {
  const state = { issues: [], visiting: new Set(), visited: new Set() };
  const providers = {
    base: {}, left: { dependsOn: ["base"] }, right: { dependsOn: ["base"] }
  };
  visitProviderTopology(providers, "left", [], state);
  visitProviderTopology(providers, "right", [], state);
  assert.deepEqual(state.issues, []);
  assert.deepEqual([...state.visited].sort(), ["base", "left", "right"]);
});

test("report analysis normalizes separators and distinguishes command owners", () => {
  assert.deepEqual(providerReportIssues({
    first: { report: "reports\\result.json", command: ["npm", "test"] },
    alias: { report: "reports/result.json", command: ["npm", "test"] },
    collision: { report: "reports/result.json", command: ["pnpm", "test"] },
    ready: {
      readiness: { url: "https://service.test/ready", expectBody: "ok" }
    },
    ambiguous: { readiness: { url: "https://service.test/ready" } }
  }), [
    "structured report collision: reports/result.json (alias, collision)",
    "provider 'ambiguous' readiness lacks an identity body/header"
  ]);
});

test("service analysis detects explicit resource and derived port collisions", () => {
  assert.deepEqual(serviceResourceIssues({
    api: {
      readiness: { url: "http://127.0.0.1:4100/ready" },
      resources: ["database:test"]
    },
    worker: {
      readiness: { url: "http://127.0.0.1:4200/ready" },
      resources: ["database:test"]
    },
    web: {
      readiness: { url: "http://127.0.0.1:4100/health" },
      resources: []
    }
  }), [
    "service resource collision: database:test (api, worker)",
    "service resource collision: port:4100 (api, web)"
  ]);
  assert.deepEqual(serviceResourceIssues({
    invalid: { readiness: { url: "not a url" }, resources: [] },
    defaultPort: { readiness: { url: "https://service.test/ready" } }
  }), []);
  assert.deepEqual(serviceResourceIssues(), []);
});

test("topology operation aggregates issue classes in established order", () => {
  const contract = {
    providers: {
      alpha: {
        dependsOn: ["beta"], report: "report.json", command: ["a"]
      },
      beta: {
        dependsOn: ["alpha"], report: "report.json", command: ["b"],
        readiness: { url: "http://127.0.0.1:4300/ready" }
      }
    },
    execution: { services: {
      one: { readiness: { url: "http://127.0.0.1:4400/ready" } },
      two: { readiness: { url: "http://127.0.0.1:4400/health" } }
    } }
  };
  assert.deepEqual(topologyIssuesOperation({
    evidence: (id) => { assert.equal(id, "change"); return contract; }
  }, "change"), [
    "provider dependency cycle: alpha -> beta -> alpha",
    "structured report collision: report.json (alpha, beta)",
    "provider 'beta' readiness lacks an identity body/header",
    "service resource collision: port:4400 (one, two)"
  ]);
  assert.deepEqual(topologyIssuesOperation({ evidence: () => ({}) }, "empty"), []);
});
