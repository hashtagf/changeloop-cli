import { randomBytes } from "node:crypto";
import {
  closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";

function safeReadJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

// Acquire one process-owned filesystem lock without stealing from a live
// holder. A sidecar serializes recovery so two contenders cannot both delete a
// dead descriptor and enter the critical section. Empty/corrupt descriptors
// are recoverable only after the create-before-write window has elapsed.
export function acquireProcessLock(path, {
  now = () => new Date().toISOString(),
  residueMs = 10_000,
  reaperStaleMs = 60_000
} = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const token = randomBytes(16).toString("hex");
  const owner = { version: 1, pid: process.pid, token, acquiredAt: now() };

  const reapDeadLock = () => {
    const reaper = `${path}.reap`;
    try {
      if (Date.now() - lstatSync(reaper).mtimeMs > reaperStaleMs) {
        const tombstone = `${reaper}.${process.pid}.stale`;
        renameSync(reaper, tombstone);
        rmSync(tombstone, { force: true });
      }
    } catch {}
    let handle;
    try { handle = openSync(reaper, "wx", 0o600); }
    catch { return false; }
    try {
      const current = safeReadJson(path);
      let residue = false;
      try {
        residue = !current?.token &&
          Date.now() - lstatSync(path).mtimeMs > residueMs;
      } catch {
        return true;
      }
      if (residue || (current?.token && !processAlive(Number(current.pid)))) {
        rmSync(path, { force: true });
        return true;
      }
      return false;
    } finally {
      closeSync(handle);
      rmSync(reaper, { force: true });
    }
  };

  const observedOwner = () => {
    const current = safeReadJson(path);
    if (current?.token) return current;
    try {
      const recoverAtMs = lstatSync(path).mtimeMs + residueMs;
      return {
        version: 1,
        state: "initializing",
        pid: null,
        recoverableAfter: new Date(recoverAtMs).toISOString(),
        retryAfterMs: Math.max(1, recoverAtMs - Date.now())
      };
    } catch { return null; }
  };

  const acquire = (allowRecovery = true) => {
    let descriptor;
    try {
      descriptor = openSync(path, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify(owner, null, 2)}\n`);
      closeSync(descriptor);
      return true;
    } catch (error) {
      if (descriptor !== undefined) try { closeSync(descriptor); } catch {}
      if (error?.code !== "EEXIST") throw error;
      if (allowRecovery && reapDeadLock()) return acquire(false);
      return false;
    }
  };

  const acquired = acquire();
  return {
    acquired,
    owner: acquired ? owner : observedOwner(),
    release() {
      if (acquired && safeReadJson(path)?.token === token)
        rmSync(path, { force: true });
    }
  };
}
