#!/usr/bin/env node

// Redacted views of secret files for the secrets guard. Refusing a read cost
// the agent a turn and taught it nothing; a redacted copy keeps the shape the
// agent needs (which keys exist, which sections, how the file is laid out)
// while no secret value ever enters the model's context.
//
//   node secret-redaction.mjs <path> [cwd]  ->  prints the redacted copy's path
//
// A missing or unreadable source prints nothing, so the caller leaves the tool
// call untouched and the tool reports the ordinary error.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REDACTED = "<redacted>";
const KEY_MATERIAL = /\.(?:pem|key|pfx|p12|jks|keystore|kdbx|ppk|gpg)$|^id_(?:rsa|dsa|ecdsa|ed25519)$/i;
// `KEY=value`, `key: value`, `key = value`, `export KEY=value`.
const ASSIGNMENT = /^(\s*(?:export\s+)?[^\s#;=:][^=:]*?\s*[=:]\s*)(\S.*)$/;
const NETRC_SECRET = /\b(password|login|account)\s+\S+/gi;

function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  return value === null || typeof value === "boolean" ? value : REDACTED;
}

export function redactText(name, text) {
  if (KEY_MATERIAL.test(name) || text.includes("\0") || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))
    return `${REDACTED} key material (${Buffer.byteLength(text)} bytes); contents withheld\n`;
  if (/\.json$/i.test(name)) {
    try { return `${JSON.stringify(redactValue(JSON.parse(text)), null, 2)}\n`; }
    catch { /* not JSON after all: fall through to line redaction */ }
  }
  return text.split("\n").map((line) => {
    const trimmed = line.trim();
    // Blank lines, section headers, and value-less YAML keys carry structure,
    // never a secret. A comment may hold a retired key, so only its marker stays.
    if (!trimmed || /^\[[^\]]*\]$/.test(trimmed) || trimmed === "---" || /^[\w.-]+:$/.test(trimmed))
      return line;
    if (/^[#;!]/.test(trimmed)) return `${line.slice(0, line.indexOf(trimmed[0]) + 1)} ${REDACTED}`;
    if (/^(?:machine|default)\b/i.test(trimmed))
      return line.replace(NETRC_SECRET, (_match, word) => `${word} ${REDACTED}`);
    const assignment = ASSIGNMENT.exec(line);
    return assignment ? `${assignment[1]}${REDACTED}` : REDACTED;
  }).join("\n");
}

export function redactedCopy(path, cwd = process.cwd()) {
  const source = resolve(cwd, path);
  if (!existsSync(source) || !statSync(source).isFile()) return null;
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const directory = join(tmpdir(), "claude-foundation-redacted", digest);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const copy = join(directory, basename(source));
  writeFileSync(copy, redactText(basename(source), readFileSync(source).toString("utf8")),
    { mode: 0o600 });
  return copy;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const copy = redactedCopy(process.argv[2] || "", process.argv[3] || process.cwd());
    if (copy) process.stdout.write(copy);
  } catch { /* the caller falls back to an untouched call */ }
}
