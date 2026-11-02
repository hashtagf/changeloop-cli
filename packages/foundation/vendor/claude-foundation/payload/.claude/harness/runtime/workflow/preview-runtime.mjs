import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

// Preview: an optional pre-Build run of one declared provider in a disposable
// copy of the target. Its receipt carries `kind: "preview"` and lives under
// `.foundation/previews/<id>/`, outside the receipt store, so Prove and Land
// never read it; receipt validity also refuses the kind wherever it appears.
// A provider marked `external: true` reaches outside the machine and runs only
// with the user's decision reference for that run.

export const PREVIEW_RECEIPT_VERSION = 1;
const OUTPUT_TAIL_BYTES = 4096;
// Build owns the workspace once it starts; a preview after that would race it.
const PREVIEW_STATUSES = new Set(["change"]);

export function previewReceiptPath(previewsDir, id, provider) {
  return join(previewsDir, id, "receipts", `${provider}.json`);
}

export function createPreviewRuntime({
  root, runtimeDir, previewsDir, loadRuntime, evidence, providerCapability,
  copyWorkspace, now, fail, spawn = spawnSync
}) {
  function runPreview(id, { provider, decisionRef = null } = {}) {
    if (!existsSync(join(runtimeDir, `${id}.json`))) fail(`preview: unknown change '${id}'`);
    if (!provider) fail("preview requires --provider <name>");
    // The name is used in receipt and artifact paths; never let it leave them.
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(String(provider)) || String(provider).includes(".."))
      fail(`preview: invalid provider name '${provider}'`);
    const state = loadRuntime(id);
    // Change start records the target itself as the workspace (mode "current");
    // only a Build sandbox elsewhere means Build owns the workspace.
    const workspacePath = state.workspace?.path;
    const sandboxed = Boolean(workspacePath) && state.workspace.mode !== "current" &&
      resolve(workspacePath) !== resolve(root);
    if (sandboxed || !PREVIEW_STATUSES.has(String(state.status || "change")))
      fail(`preview runs only before Build; '${id}' is already ${state.status || "building"}`);
    const contract = evidence(id);
    const config = (contract.providers || {})[provider] ?? (contract.previewProviders || {})[provider];
    if (!config) fail(`preview: provider '${provider}' is not declared in openspec/changes/${id}/evidence.yaml or execution.yaml`);
    const external = config.external === true;
    if (external && !String(decisionRef || "").trim())
      fail(`preview: provider '${provider}' is external and needs the user's decision for this run; ` +
        `ask the user, then rerun with --decision-ref <user-decision>`, 1,
      { code: "PREVIEW_AUTHORITY_REQUIRED", boundary: "external-authority", owner: "user" });
    const command = Array.isArray(config.command) ? config.command.map(String) : null;
    if (!command?.length) fail(`preview: provider '${provider}' has no command a preview can run`);

    const base = join(previewsDir, id);
    const workspace = join(base, "workspace");
    // A declared preview artifact (a prototype or screenshot) must stay inside
    // the preview workspace; it is checked before anything runs.
    const artifactPath = config.previewArtifact ? resolve(workspace, String(config.previewArtifact)) : null;
    if (artifactPath && (relative(workspace, artifactPath).startsWith("..") || isAbsolute(relative(workspace, artifactPath))))
      fail(`preview: provider '${provider}' previewArtifact '${config.previewArtifact}' is outside the preview workspace`);
    rmSync(workspace, { recursive: true, force: true });
    mkdirSync(workspace, { recursive: true });
    copyWorkspace(root, workspace);
    const startedAt = now();
    const result = spawn(command[0], command.slice(1), {
      cwd: workspace, encoding: "utf8",
      env: { ...process.env, ...(config.env || {}), FOUNDATION_PREVIEW: "1" },
      timeout: Number(config.timeoutSeconds || config.timeout || 600) * 1000
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    let artifact = null;
    if (artifactPath && existsSync(artifactPath)) {
      const kept = join(base, "artifacts", `${provider}-${basename(artifactPath)}`);
      mkdirSync(dirname(kept), { recursive: true });
      copyFileSync(artifactPath, kept);
      artifact = relative(base, kept);
    }
    const receipt = {
      kind: "preview",
      version: PREVIEW_RECEIPT_VERSION,
      changeId: id,
      provider,
      capability: providerCapability(provider, config),
      contractRevision: Number(state.contractRevision || 0),
      status: result.status === 0 ? "pass" : "fail",
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      external,
      decisionRef: external ? String(decisionRef) : null,
      environment: config.environment ?? null,
      startedAt,
      finishedAt: now(),
      outputTail: output.slice(-OUTPUT_TAIL_BYTES),
      artifact
    };
    const path = previewReceiptPath(previewsDir, id, provider);
    mkdirSync(join(base, "receipts"), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
    renameSync(temporary, path);
    return { receipt, path: relative(root, path), workspace: relative(root, workspace) };
  }

  function showPreview(id, flags = {}) {
    const result = runPreview(id, { provider: flags.provider, decisionRef: flags["decision-ref"] });
    if (flags.pretty) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`PREVIEW ${id} ${result.receipt.provider}: ${result.receipt.status}`);
      console.log(`  receipt: ${result.path} (preview only; never proof)`);
      console.log(`  workspace: ${result.workspace}`);
      console.log(`  next: claude-foundation package ${id}`);
    }
    return result;
  }

  return { runPreview, showPreview };
}
