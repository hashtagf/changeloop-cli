import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function deliveryProjectionEntry(root, path, pathIdentity) {
  const absolute = join(root, path);
  const identity = pathIdentity(absolute);
  if (identity === null) return { path, identity };
  const stat = lstatSync(absolute);
  const mode = stat.isSymbolicLink() ? "120000"
    : stat.isFile() ? (stat.mode & 0o111 ? "100755" : "100644") : null;
  return { path, identity, ...(mode ? { mode } : {}) };
}

export function deliveryTreeEntries(root, paths, pathIdentity) {
  const entries = new Map();
  const visit = (path) => {
    const entry = deliveryProjectionEntry(root, path, pathIdentity);
    entries.set(path, entry);
    if (entry.identity?.startsWith("directory:"))
      for (const child of readdirSync(join(root, path))) visit(`${path}/${child}`);
  };
  for (const path of paths) visit(path);
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function assertLandEntryMode(root, entry, pathIdentity) {
  if (entry.after === null || entry.after?.startsWith("symlink:")) return;
  if (entry.after?.startsWith("directory:")) {
    if (!Array.isArray(entry.afterEntries))
      drift(`Land mode evidence is unavailable for directory '${entry.path}'; automatic Deliver cannot reconstruct historical modes. Preserve the archived work and review the current diff for separately authorized Git publication`, "DELIVERY_MODE_EVIDENCE_UNAVAILABLE");
    assertDeliveryEntries(root, entry.afterEntries, pathIdentity);
    return;
  }
  if (!Number.isInteger(entry.afterMode))
    drift(`Land mode evidence is unavailable for '${entry.path}'; automatic Deliver cannot reconstruct historical modes. Preserve the archived work and review the current diff for separately authorized Git publication`, "DELIVERY_MODE_EVIDENCE_UNAVAILABLE");
  const expected = entry.afterMode & 0o111 ? "100755" : "100644";
  if (deliveryProjectionEntry(root, entry.path, pathIdentity).mode !== expected)
    drift(`proven file mode changed after Land: ${entry.path}`);
}

export function assertDeliveryEntries(root, entries, pathIdentity) {
  for (const entry of entries) {
    const observed = deliveryProjectionEntry(root, entry.path, pathIdentity);
    if (observed.identity !== entry.identity || observed.mode !== entry.mode)
      drift(`archived delivery input changed after Land: ${entry.path}`);
  }
}

function drift(message, code = "DELIVERY_PROJECTION_DRIFT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function createDeliveryIntegrity({ git, run, runChecked, gitOutput }) {
  function conversionInputs(workspace, path) {
    const attributes = gitOutput(git, ["check-attr", "-z", "--all", "--", path], workspace,
      "cannot inspect delivery Git attributes").split("\0");
    const pairs = [];
    for (let index = 0; index + 2 < attributes.length; index += 3) {
      const name = attributes[index + 1], value = attributes[index + 2];
      // check-attr renders both an unset attribute and a driver literally named
      // "unset" as the same string. Do not let that ambiguity execute a driver.
      const ambiguousFilter = name === "filter" && ["unset", "unspecified"].includes(value) &&
        git(["config", "--get-regexp", `^filter\\.${value}\\.(clean|process)$`], workspace).status === 0;
      if (["filter", "working-tree-encoding"].includes(name) &&
          (!["unset", "unspecified"].includes(value) || ambiguousFilter))
        drift(`Deliver cannot safely verify '${path}' with Git attribute '${name}=${value}'; retain the archived work and its conversion settings. Review the transformed Git content for separately authorized publication, or leave the work archived`, "DELIVERY_CONVERSION_UNSUPPORTED");
      pairs.push([name, value]);
    }
    const configured = git(["config", "--get-regexp", "^core\\.(autocrlf|eol|safecrlf)$"], workspace);
    if (![0, 1].includes(configured.status))
      throw new Error("cannot inspect delivery Git conversion configuration");
    return { attributes: pairs.sort((a, b) => a[0].localeCompare(b[0])),
      config: String(configured.stdout || "").trim().split("\n").filter(Boolean).sort() };
  }

  function bindProjection(workspace, projection) {
    if (projection.gitRepresentation === 1) return projection;
    const entries = projection.entries.map((entry) => {
      if (!entry.identity || !["100644", "100755"].includes(entry.mode)) return entry;
      const conversion = conversionInputs(workspace, entry.path);
      const bytes = readFileSync(join(workspace, entry.path));
      if (createHash("sha256").update(bytes).digest("hex") !== entry.identity)
        drift(`proven path changed before Git conversion: ${entry.path}`);
      // Ask Git to apply its built-in text/binary rules to the proven bytes.
      // No object is written, and external clean filters were rejected above.
      const result = runChecked(run, "git", ["hash-object", `--path=${entry.path}`, "--stdin"],
        { cwd: workspace, input: bytes, encoding: "utf8", maxBuffer: 1024 * 1024 },
        "cannot bind delivery Git representation");
      return { ...entry, conversion, gitOid: String(result.stdout).trim() };
    });
    return { ...projection, gitRepresentation: 1, entries };
  }

  function assertConversion(workspace, projection) {
    for (const entry of projection.entries) {
      if (!entry.conversion) continue;
      if (JSON.stringify(conversionInputs(workspace, entry.path)) !== JSON.stringify(entry.conversion))
        drift(`Git conversion changed for '${entry.path}'; restore the bound attributes/configuration and retry Deliver`, "DELIVERY_CONVERSION_CHANGED");
    }
  }

  // Drift found here is in the harness-built delivery workspace, not in the
  // user's target checkout, so Deliver can rebuild the workspace in place.
  function assertTree(workspace, projection, tree, gitlinks = []) {
    try { assertWorkspaceTree(workspace, projection, tree, gitlinks); }
    catch (error) {
      if (error.code === "DELIVERY_PROJECTION_DRIFT") error.stage = "delivery-workspace";
      throw error;
    }
  }

  function assertWorkspaceTree(workspace, projection, tree, gitlinks) {
    assertConversion(workspace, projection);
    const links = new Map(gitlinks.map((row) => [row.path, row.commit]));
    const underLink = (path) => [...links.keys()].some((link) =>
      path === link || path.startsWith(`${link}/`));
    const expected = new Map(projection.entries.filter((row) => !underLink(row.path))
      .map((row) => [row.path, row]));
    const changed = gitOutput(git,
      ["diff", "--no-renames", "--name-only", "-z", projection.baseHead, tree, "--"],
      workspace, "cannot inspect delivery tree").split("\0").filter(Boolean);
    if (changed.some((path) => !links.has(path) && !projection.roots.some((root) =>
      path === root || path.startsWith(`${root}/`))))
      drift("delivery tree contains changes outside the proven projection");

    const source = gitOutput(git,
      ["ls-tree", "-r", "-z", tree, "--", ...projection.roots, ...links.keys()],
      workspace, "cannot read delivery tree");
    const observed = new Map(source.split("\0").filter(Boolean).map((line) => {
      const tab = line.indexOf("\t");
      const [mode, type, oid] = line.slice(0, tab).split(" ");
      return [line.slice(tab + 1), { mode, type, oid }];
    }));
    for (const [path, row] of observed) {
      if (links.has(path)) {
        if (row.mode !== "160000" || row.oid !== links.get(path))
          drift(`delivery gitlink differs from its verified child commit: ${path}`);
        continue;
      }
      const entry = expected.get(path);
      if (!entry?.identity || row.type !== "blob" || (entry.mode && entry.mode !== row.mode))
        drift(`delivery tree has an unexpected path or mode: ${path}`);
      // Read the Git object, not the worktree: hooks and interrupted attempts
      // can leave those bytes different. Buffer output preserves binary files.
      const blob = runChecked(run, "git", ["cat-file", "blob", row.oid],
        { cwd: workspace, encoding: null, maxBuffer: 64 * 1024 * 1024 },
        `cannot verify delivery blob '${path}'`).stdout;
      const identity = row.mode === "120000" ? `symlink:${blob.toString("utf8")}`
        : createHash("sha256").update(blob).digest("hex");
      if (entry.gitOid ? row.oid !== entry.gitOid : identity !== entry.identity)
        drift(`delivery tree differs from the proven content: ${path}`);
    }
    for (const [path, entry] of expected) {
      // Git does not represent empty directories. Nonempty directory roots
      // were expanded into their individual entries when the projection bound.
      if (entry.identity && !entry.identity.startsWith("directory:") && !observed.has(path))
        drift(`delivery tree is missing a proven path: ${path}`);
    }
    for (const path of links.keys())
      if (!observed.has(path)) drift(`delivery tree is missing a child gitlink: ${path}`);
  }

  function assertPullRequestBase(workspace, provider, projection) {
    // Local branches and remote-tracking refs can be stale. Fetch only the
    // proposed PR base, without changing the target checkout's HEAD or index.
    runChecked(run, "git", ["fetch", "--no-tags", provider.remoteName,
      `refs/heads/${provider.baseBranch}`],
    { cwd: workspace, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 },
    "cannot fetch pull request base");
    const base = gitOutput(git, ["rev-parse", "FETCH_HEAD^{commit}"], workspace,
      "cannot resolve fetched pull request base");
    if (git(["merge-base", "--is-ancestor", projection.baseHead, base], workspace).status !== 0)
      drift("The remote PR base does not contain the proven Land base; delivery would include unapproved branch history. Restore the remote base so it contains the proven Land base, then retry Deliver.",
        "DELIVERY_PR_BASE_DRIFT");
  }

  return { assertTree, assertPullRequestBase, bindProjection, assertConversion };
}
