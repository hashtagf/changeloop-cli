// Base bytes of an isolated copy. A copy's baseline records only identities
// (`file:<regular|executable>:<sha256>`), and without the bytes behind them no
// merge can be proven: a changed sandbox copy is not evidence that a target
// edit was merged into it. This content-addressed store under `.foundation/`
// keeps those bytes, keyed by the baseline's own sha256 and shared by every
// change. Capture is lazy — the first time sync or apply sees a path diverge
// while a source still hashes to the baseline row — plus an eager pass over a
// confined declared surface when the copy is made. Large and binary files are
// never stored: they stay unprovable, which keeps every check fail-closed.
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { join } from "node:path";
import { targetEditCarried } from "./target-edits.mjs";

export const COPY_BASE_MAX_BYTES = 8 * 1024 * 1024;
const ROW = /^file:(regular|executable):([a-f0-9]{64})$/;
// The same NUL-in-the-first-8000-bytes heuristic Git uses for binary content.
const BINARY_PROBE = 8000;
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7})(?: |$)/m;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function copyBaseStore(root) {
  return join(root, ".foundation", "copy-base");
}

function baseRow(baseline, path) {
  const match = ROW.exec(String(baseline?.[path] ?? ""));
  return match ? { executable: match[1] === "executable", sha: match[2] } : null;
}

// A capture source: the bytes of a regular file within the size cap, else null.
export function fileSource(path) {
  return () => {
    const stats = lstatSync(path, { throwIfNoEntry: false });
    return stats?.isFile() && stats.size <= COPY_BASE_MAX_BYTES ? readFileSync(path) : null;
  };
}

function storable(bytes) {
  return bytes.length <= COPY_BASE_MAX_BYTES && !bytes.subarray(0, BINARY_PROBE).includes(0);
}

// Stores the base bytes of `path` from the first source that still hashes to
// its baseline row. True when the store holds them afterwards.
export function captureCopyBase({ root, baseline, path, sources = [] }) {
  const row = baseRow(baseline, path);
  if (!row) return false;
  const store = copyBaseStore(root);
  const stored = join(store, row.sha);
  if (existsSync(stored)) return true;
  for (const source of sources) {
    let bytes = null;
    try { bytes = source(); } catch { bytes = null; }
    if (!bytes || !storable(bytes) || sha256(bytes) !== row.sha) continue;
    mkdirSync(store, { recursive: true });
    const temporary = `${stored}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, bytes);
      renameSync(temporary, stored);
    } finally {
      rmSync(temporary, { force: true });
    }
    return true;
  }
  return false;
}

// The eager pass when a copy is made: every baseline path `matches` admits,
// from the target as it is at that moment. Returns how many are stored.
export function captureCopyBaseSurface({ root, baseline = {}, matches }) {
  let stored = 0;
  for (const path of Object.keys(baseline || {}).filter((candidate) => matches(candidate)))
    if (captureCopyBase({ root, baseline, path, sources: [fileSource(join(root, path))] }))
      stored += 1;
  return stored;
}

// The base of `path`: verified bytes, null when the baseline records no such
// path (absent at base), or undefined when the base cannot be proven (no
// baseline, a symlink or unsupported row, or bytes never captured).
export function copyBaseBytes({ root, baseline, path }) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) return undefined;
  if (!Object.hasOwn(baseline, path)) return null;
  const row = baseRow(baseline, path);
  if (!row) return undefined;
  const stored = join(copyBaseStore(root), row.sha);
  if (!existsSync(stored)) return undefined;
  const bytes = readFileSync(stored);
  return sha256(bytes) === row.sha ? bytes : undefined;
}

// The base executable bit of `path`, or null when the baseline does not say.
export function copyBaseExecutable(baseline, path) {
  return baseRow(baseline, path)?.executable ?? null;
}

// Whether the sandbox copy provably carries the target's edit of `path`:
// merging base→target into it is a clean no-op, it holds no conflict markers,
// and the target's executable bit is the sandbox's or the base's. Without
// captured base bytes nothing is carried.
export function copyEditCarried({ root, sandboxPath, path, baseline }) {
  const baseBytes = copyBaseBytes({ root, baseline, path });
  if (baseBytes === undefined) return false;
  const executable = (file) => {
    const stats = lstatSync(file, { throwIfNoEntry: false });
    return stats?.isFile() ? Boolean(stats.mode & 0o111) : null;
  };
  const target = executable(join(root, path));
  const sandbox = executable(join(sandboxPath, path));
  if (target !== sandbox && target !== copyBaseExecutable(baseline, path)) return false;
  if (sandbox !== null && CONFLICT_MARKER.test(readFileSync(join(sandboxPath, path), "latin1")))
    return false;
  return targetEditCarried({ root, sandboxPath, path, baseBytes });
}
