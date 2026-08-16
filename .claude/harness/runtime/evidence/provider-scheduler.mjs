import { findCyclePath } from "../core/graph.mjs";

export function createProviderScheduler({
  requiredProviders,
  receiptValidity,
  providerConfig,
  commandExists,
  providerWorkspace,
  playwrightAvailability,
  evidence,
  providerCapability,
  adapterResources,
  resourcesConflict,
  executeAdapter,
  fail,
  log = console.log,
  logError = console.error
}) {
  function executionNodes(id, hash) {
    const needed = requiredProviders(id)
      .filter((provider) => receiptValidity(id, provider, hash).validity !== "valid");
    const nodes = [];
    const unconfigured = [];
    const unavailable = [];
    const claimed = new Set();
    for (const provider of needed) {
      if (claimed.has(provider)) continue;
      const config = providerConfig(id, provider);
      if (!config || config.adapter === "external") {
        unconfigured.push(provider);
        continue;
      }
      // contract-digest runs no command: its work is reading and hashing the
      // declared artifact on each side.
      if (config.adapter !== "contract-digest" &&
          !commandExists(config.command?.[0], providerWorkspace(id, provider, config))) {
        unavailable.push(`${provider}:command`);
        continue;
      }
      if (config.adapter === "playwright") {
        const availability = playwrightAvailability(providerWorkspace(id, provider, config));
        if (!availability.packageOwned || !availability.binaryAvailable) {
          unavailable.push(`${provider}:project-owned-playwright`);
          continue;
        }
      }
      // A discovery provider is written by the test provider that names it, in
      // the same execution — it is never a node of its own. Which one owns it
      // used to be inferred from an identical config hash, and that can only
      // ever match the single provider literally named `discovery`: a
      // repository-scoped pair differs in `capability` by construction, so
      // `discovery-api` was scheduled standalone and no adapter can produce a
      // discovered count alone. Follow the `discoveryProvider` reference
      // instead, which states the ownership directly and works whichever of the
      // pair `needed` happens to reach first.
      const producer = providerCapability(provider, config) === "discovery"
        ? Object.entries(evidence(id).providers || {}).find(([candidate, value]) =>
          value?.adapter === "test-discovery" &&
          providerCapability(candidate, value) === "test" &&
          (value.discoveryProvider || "discovery") === provider)
        : null;
      const nodeProvider = producer ? producer[0] : provider;
      // The node runs the producer's command, so it must carry the producer's
      // config; using the discovery entry's would execute the wrong thing and
      // record the receipt against the wrong workspace.
      const nodeConfig = producer ? producer[1] : config;
      const covers = nodeConfig.adapter === "test-discovery"
        ? [nodeProvider, nodeConfig.discoveryProvider || "discovery"]
          .filter((output) => needed.includes(output))
        : [...new Set([provider, ...(nodeConfig.outputs || [])])]
          .filter((output) => needed.includes(output));
      covers.forEach((item) => claimed.add(item));
      nodes.push({
        provider: nodeProvider,
        covers,
        config: nodeConfig,
        resources: adapterResources(nodeProvider, nodeConfig),
        dependsOn: nodeConfig.dependsOn || []
      });
    }
    return { nodes, unconfigured, unavailable };
  }

  async function runExecutionDag(id, nodes, proofRunId) {
    const pending = new Map(nodes.map((node) => [node.provider, node]));
    const completed = new Set();
    const failedOutputs = new Set();
    const commandCache = new Map();
    const outcomes = [];
    // A dependency may name a covered output of another pending node, not the
    // node's own provider id; resolve those to the owning node for cycle edges.
    const owner = new Map(nodes.flatMap((node) =>
      [node.provider, ...node.covers].map((output) => [output, node.provider])));
    while (pending.size) {
      const ready = [...pending.values()].filter((node) =>
        node.dependsOn.every((dependency) =>
          completed.has(dependency) ||
          receiptValidity(id, dependency).validity === "valid"));
      // Throw rather than fail(): fail is process.exit, which skips the
      // caller's catch — the thing that stops services and clears
      // activeProofRun — so the next `evidence record` bound a dead run's
      // workspace hash.
      if (!ready.length) {
        const blocked = [...pending.values()]
          .map((node) => ({
            node,
            failed: node.dependsOn.filter((dependency) => failedOutputs.has(dependency))
          }))
          .filter((entry) => entry.failed.length);
        if (blocked.length)
          throw new Error(`provider(s) blocked by failed dependency: ${blocked
            .map((entry) => `${entry.node.provider} (needs ${entry.failed.join(", ")})`)
            .join("; ")}`);
        const cycle = findCyclePath(new Map([...pending.values()].map((node) =>
          [node.provider, node.dependsOn
            .map((dependency) => owner.get(dependency))
            .filter((dependency) => dependency !== undefined && pending.has(dependency))])));
        if (cycle)
          throw new Error(`provider dependency cycle: ${cycle.join(" -> ")}`);
        throw new Error(`provider dependency unresolvable: ${[...pending.keys()].join(", ")}`);
      }
      const batch = [];
      for (const node of ready)
        if (batch.every((selected) => !resourcesConflict(selected.resources, node.resources)))
          batch.push(node);
      log(`EXECUTION ${proofRunId}: ${batch.map((node) => node.provider).join(", ")}`);
      const results = await Promise.all(batch.map((node) =>
        executeAdapter(id, node.provider, node.config, proofRunId, commandCache)));
      for (let index = 0; index < batch.length; index += 1) {
        pending.delete(batch[index].provider);
        outcomes.push({ provider: batch[index].provider, status: results[index].status });
        if (results[index].status === "pass") {
          for (const covered of batch[index].covers) completed.add(covered);
        } else {
          failedOutputs.add(batch[index].provider);
          for (const covered of batch[index].covers) failedOutputs.add(covered);
          logError(`PROVIDER ${batch[index].provider}: ${results[index].status}`);
        }
      }
    }
    return outcomes;
  }

  function collectableExecutionNodes(id, nodes, workspaceHash) {
    let selected = [...nodes];
    let changed = true;
    while (changed) {
      changed = false;
      const providers = new Set(selected.flatMap((node) => [node.provider, ...node.covers]));
      const next = selected.filter((node) => node.dependsOn.every((dependency) =>
        providers.has(dependency) ||
        receiptValidity(id, dependency, workspaceHash).validity === "valid"));
      if (next.length !== selected.length) {
        selected = next;
        changed = true;
      }
    }
    const selectedProviders = new Set(selected.map((node) => node.provider));
    return {
      nodes: selected,
      blocked: nodes.filter((node) => !selectedProviders.has(node.provider))
        .map((node) => node.provider)
    };
  }

  return { executionNodes, runExecutionDag, collectableExecutionNodes };
}
