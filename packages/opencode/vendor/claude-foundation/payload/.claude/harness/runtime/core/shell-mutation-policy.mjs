import { isAbsolute, relative, resolve } from "node:path";

// One shell-word grammar for every operand the policy reads: a double-quoted
// word with backslash escapes, a single-quoted word with POSIX `'\''` joins,
// or a bare word. The anchor screen and the escape screen must judge the same
// literal the same way, so there is exactly one unquoter.
const QUOTED_WORD = String.raw`"(?:\\.|[^"\\])*"|'(?:'\\''|[^'])*'`;
const SAFE_ARGUMENT = /^[A-Za-z0-9_./:@%+=,-]+$/;

function shellUnquote(value) {
  const text = String(value || "");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"'))
    return text.slice(1, -1).replace(/\\(.)/g, "$1");
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'"))
    return text.slice(1, -1).replaceAll("'\\''", "'");
  return text;
}

// Quote a path the way a shell must receive it. Shared with `exec` so a
// refusal's suggested prefix is exactly what the runtime itself would emit.
export function shellDisplayArgument(value) {
  const text = String(value);
  return SAFE_ARGUMENT.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function hintPath(workspace, suffix) {
  const text = `${workspace}${suffix}`;
  return SAFE_ARGUMENT.test(workspace) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function within(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function sameDirectory(left, right) {
  return resolve(left) === resolve(right);
}

// The command's first word must change directory. `;` is accepted only for
// the workspace root, which the harness guarantees exists: below the root the
// directory may be missing, and `;` would then run the mutation in whatever
// cwd the shell inherited, so those anchors require `&&`.
const ANCHOR = new RegExp(`^\\s*((?:cd|pushd)\\s+(?:${QUOTED_WORD}|[^\\s;&|]+))\\s*(&&|;)`);

function shellAnchor(command) {
  const match = ANCHOR.exec(command);
  if (!match) return null;
  const word = match[1];
  const target = shellUnquote(word.replace(/^(?:cd|pushd)\s+/, ""));
  return { word, target, separator: match[2] };
}

function shellWords(value) {
  return String(value).match(new RegExp(`${QUOTED_WORD}|[^\\s]+`, "g")) || [];
}

function unquote(value) {
  return shellUnquote(String(value || "").replace(/^[({]+|[)},]+$/g, ""));
}

function absoluteExecutableRanges(command) {
  const ranges = [];
  const executable = /(?:^|[;&|()]|\b(?:then|do)\b)\s*(?:(?:sudo|command)\s+)?(?:env(?:\s+-\S+|\s+[A-Za-z_][A-Za-z0-9_]*=\S+)*\s+)?(\/[^\s;&|()]+)/gmi;
  for (const match of command.matchAll(executable)) {
    const offset = match[0].lastIndexOf(match[1]);
    ranges.push([match.index + offset, match.index + offset + match[1].length]);
  }
  return ranges;
}

const DIRECTORY_CHANGE = new RegExp(`(?:^|[;&|()]|\\b(?:then|do)\\b)\\s*(?:cd|pushd)\\s+(${QUOTED_WORD}|[^\\s;&|]+)`, "gmi");
const REDIRECT_TARGET = new RegExp(`(?:>>?|\\btee\\b(?:\\s+-\\S+)*)\\s+(${QUOTED_WORD}|[^\\s;&|]+)`, "gmi");
// A quoted absolute path is one operand, spaces included; reading only its
// first segment reported `/my` for `"/my ws"` and refused the workspace itself.
const LITERAL_ABSOLUTE = new RegExp(String.raw`"(\/(?:\\.|[^"\\])*)"|'(\/(?:'\\''|[^'])*)'|(?:^|[\s'"(=,])((?:\/(?!\/))[^\s'";&|,)\]]+)`, "gm");

// A heredoc body behind a quoted delimiter and the inside of a single-quoted
// word are literal to the shell: nothing in them expands or runs. Scans that
// look for shell expansion or shell operands must not read them, or a template
// literal in a TypeScript heredoc, a backtick in a Python docstring, or
// `"/status: {` inside a sed script refuses a command that writes exactly
// where its redirect says. Code the command hands on is the exception: an
// inner shell (`sh -c`, `eval`) reads its script as a command line again, and
// an interpreter that writes resolves the paths its code names.
const HEREDOC_MARKER = /<<(-?)\s*(?:'([^']+)'|"([^"]+)"|\\(\S+)|([A-Za-z_][A-Za-z0-9_]*))/g;
const SHELL_CODE_CARRIER = /\b(?:sh|bash|zsh|ksh|dash)\s+(?:-\S+\s+)*-c\b|\beval\b/;
const QUOTED_REGION = new RegExp(QUOTED_WORD, "g");

function insideQuotes(text) {
  let single = 0;
  let double = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "'" && double % 2 === 0) single++;
    else if (ch === '"' && single % 2 === 0) double++;
  }
  return single % 2 === 1 || double % 2 === 1;
}

// Every heredoc body as a character range. A marker inside quotes is text,
// not a heredoc; an unterminated body runs to the end of the command; a body
// is never searched for further markers.
function heredocBodies(command) {
  const lines = command.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  const bodies = [];
  let next = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i < next) continue;
    for (const match of lines[i].matchAll(HEREDOC_MARKER)) {
      if (insideQuotes(lines[i].slice(0, match.index))) continue;
      const word = match[2] ?? match[3] ?? match[4] ?? match[5];
      const strip = match[1] === "-";
      const first = Math.max(i + 1, next);
      let j = first;
      while (j < lines.length && (strip ? lines[j].replace(/^\t+/, "") : lines[j]) !== word) j++;
      bodies.push({
        start: first < lines.length ? starts[first] : command.length,
        end: j < lines.length ? starts[j] : command.length,
        literal: match[5] === undefined
      });
      next = j + 1;
    }
  }
  return bodies;
}

function withoutHeredocBodies(command, keep = () => false) {
  let text = "";
  let cursor = 0;
  for (const body of heredocBodies(command)) {
    if (keep(body) || body.start < cursor) continue;
    text += command.slice(cursor, body.start);
    cursor = body.end;
  }
  return text + command.slice(cursor);
}

function maskSingleQuoted(text) {
  return text.replace(QUOTED_REGION, (word) => (word.startsWith("'") ? "'_'" : word));
}

// What the shell may expand: unquoted words, double quotes, and bodies behind
// an unquoted delimiter. An inner shell expands its single-quoted script too.
function expansionText(command) {
  const text = withoutHeredocBodies(command, (body) => !body.literal);
  return SHELL_CODE_CARRIER.test(command) ? text : maskSingleQuoted(text);
}

// Where an operand may be named: the command line, never data the command
// carries — unless that data is code an inner shell or a writing interpreter
// will resolve paths from.
function operandText(command) {
  if (SHELL_CODE_CARRIER.test(command) ||
      (INTERPRETER.test(command) && INTERPRETER_WRITE.test(command))) return command;
  return maskSingleQuoted(withoutHeredocBodies(command));
}

// Return every path that a recognized filesystem command may mutate. Reading
// an extra source path is harmless to containment, while omitting a destination
// is not, so multi-path commands deliberately inspect all operands.
function filesystemMutationTargets(command) {
  const targets = [];
  const commandLine = withoutHeredocBodies(command);
  const operations = /(?:^|[;&|()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:[^\s;&|()]+\/)*(rm|mv|cp|ln|install|mkdir|rmdir|touch|truncate|tee|chmod|chown)\b([^;&|\n]*)/gmi;
  for (const match of commandLine.matchAll(operations)) {
    const words = shellWords(match[2]).map(unquote);
    for (const word of words) {
      if (!word || word.startsWith("-") || /^\d+$/.test(word)) continue;
      targets.push(word.includes("=") ? word.slice(word.indexOf("=") + 1) : word);
    }
  }
  for (const match of commandLine.matchAll(DIRECTORY_CHANGE)) targets.push(unquote(match[1]));
  for (const match of commandLine.matchAll(REDIRECT_TARGET)) targets.push(unquote(match[1]));
  // Interpreter and option-value writes do not necessarily expose a standalone
  // shell operand (`writeFile('/tmp/x')`, `--output=/tmp/x`). Once the command
  // is already known to mutate, every literal absolute reference is safer to
  // treat as scoped input than to let a destination disappear from analysis.
  // A fully single-quoted absolute word is still an operand; the rest of a
  // single-quoted word and literal heredoc bodies are data, read only when
  // the command carries code that resolves paths itself.
  const scoped = operandText(command);
  const executableRanges = absoluteExecutableRanges(scoped);
  for (const match of scoped.matchAll(LITERAL_ABSOLUTE)) {
    const raw = match[1] ?? match[2] ?? match[3];
    const start = match.index + match[0].indexOf(raw);
    if (executableRanges.some(([from, to]) => start >= from && start < to)) continue;
    targets.push(match[1] !== undefined ? shellUnquote(`"${raw}"`)
      : match[2] !== undefined ? shellUnquote(`'${raw}'`) : raw);
  }
  if (scoped !== command)
    for (const match of commandLine.matchAll(QUOTED_REGION))
      if (match[0].startsWith("'/")) targets.push(shellUnquote(match[0]));
  return [...new Set(targets)].filter((target) => target && target !== "/dev/null");
}

// The operands a copy or link only reads: every `cp`/`ln`/`install` word
// before the destination. Containment still refuses them outside the
// workspace — a workspace never borrows the checkout's files — but the refusal
// has to say so and name the sanctioned route. Three consumer Builds retried
// relative, absolute, and unanchored links to the checkout's node_modules
// against a reason that spoke only of mutation targets.
const COPY_LIKE = /(?:^|[;&|()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:[^\s;&|()]+\/)*(?:cp|ln|install)\b([^;&|\n]*)/gmi;

function copySourceOperands(command) {
  const sources = [];
  for (const match of command.matchAll(COPY_LIKE)) {
    const words = shellWords(match[1]).map(unquote);
    // `-t DIR` / `--target-directory` name the destination first; every
    // operand is then a possible target and none is classified as a source.
    if (words.some((word) => /^(?:-t|--target-directory)/.test(word))) continue;
    const operands = words.filter((word) => word && !word.startsWith("-"));
    sources.push(...operands.slice(0, -1));
  }
  return sources;
}

function targetEscapes(target, workspace, inspection) {
  const absolute = isAbsolute(target) ? resolve(target) : resolve(workspace, target);
  if (!within(workspace, absolute)) return true;
  if (!inspection?.canonicalTarget || !inspection?.contains) return false;
  const canonical = inspection.canonicalTarget(absolute);
  return !canonical || !inspection.contains(canonical, workspace);
}

// Returns the first fragment that leaves the workspace, or null. Naming it is
// what lets an agent repair the command instead of retrying it unchanged.
function obviousWorkspaceEscape(command, workspace, inspection = null) {
  const parent = /(?:^|[\s'"=])(\.\.(?:\/[^\s'";&|]*|$))/.exec(operandText(command));
  if (parent) return parent[1];
  // A second popd can return to the checkout that preceded the required
  // workspace anchor. Its resulting cwd cannot be proven from the command.
  if (/\bpopd\b/.test(command)) return "popd";
  return filesystemMutationTargets(command)
    .find((target) => targetEscapes(target, workspace, inspection)) ?? null;
}

// A `$name` after `/` is a path segment (`/workspace/$X`), not a quoted argument
// such as `-m "$MSG"`; only the former can move a mutation target.
const DYNAMIC_TOKEN = /\$\(|`|\$\{[^}\s]*\}?|(?<=^|[\s=/])\$[A-Za-z_][A-Za-z0-9_]*|(?<=^|[\s=])~(?=\/|\s|$)/g;
// Exit-status expansions produce integers, never paths. A Build check that
// reports `${PIPESTATUS[0]}` after a piped test run is the ordinary shape of
// verification and must not read as an unprovable mutation target. The
// subscript is limited to literal forms because bash evaluates it, so
// `${PIPESTATUS[$(…)]}` would run the substitution.
const STATUS_EXPANSION = /^\$(?:\{(?:PIPESTATUS|pipestatus)(?:\[(?:\d+|@|\*)\])?\}|(?:PIPESTATUS|pipestatus))$/;

function dynamicPathToken(command) {
  for (const match of command.matchAll(DYNAMIC_TOKEN)) {
    const token = match[0];
    if (STATUS_EXPANSION.test(token)) continue;
    if (token === "$(") return "$(…)";
    if (token === "`") return "`…`";
    return token;
  }
  return null;
}

const INTERPRETER = /\b(?:python(?:3(?:\.\d+)?)?|node|ruby|perl)\b/i;
const INTERPRETER_WRITE = /(?:\bopen\s*\([^\n)]*,\s*['"][wax+]|\.write(?:_text|_bytes)?\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|renameSync|rmSync|unlinkSync|mkdirSync|copyFileSync)\s*\()/i;
const FORMATTER_WRITE = /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:(?:npx|pnpm\s+(?:exec|dlx)|yarn\s+dlx|bunx)\s+)?(?:prettier\b[^\n;&|]*\s--write\b|eslint\b[^\n;&|]*\s--fix\b|ruff\b[^\n;&|]*\s(?:format|check\b[^\n;&|]*\s--fix\b)|black\b|gofmt\b[^\n;&|]*\s-w\b|cargo\s+fmt\b)/m;
const MUTATING_WORD = /(?:^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:[^\s;&|()]+\/)*(rm|mv|cp|ln|install|mkdir|rmdir|touch|truncate|tee|chmod|chown|patch|git\s+(?:add|tag|commit|push|merge|rebase|checkout|switch|restore|reset|clean|apply|rm|mv|cherry-pick|revert|stash|am|pull|worktree|submodule)|npm\s+(?:install|publish|run|exec)|npx|pnpm\s+(?:install|publish|run|exec|dlx)|yarn\s+(?:add|install|publish|run|dlx)|bun\s+(?:install|run)|bunx|sh\s+\S+|bash\s+\S+|zsh\s+\S+)\b/gm;
const IN_PLACE_EDIT = /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:sed|perl|ruby)\s+(?:-\S+\s+)*-\S*i/m;
const REDIRECT = /(?:^|[^<])(?:>>?|2>>?)\s*(?!&)(?!\/dev\/null(?:[\s;&|)]|$))\S/m;

// The matched command words, not merely whether one exists: a phase rule that
// permits some operations and refuses others has to name the ones it refused.
export function mutatingShellOperations(command) {
  const value = String(command || "");
  // Quoted text is opaque to the word screens, but it is still an operand:
  // erasing it entirely made `> "/etc/x"` read as a redirect with no target.
  const stripped = value.replace(/(['"])(?:\\.|(?!\1).)*\1/g, " _ ");
  const operations = [];
  if (INTERPRETER.test(value) && INTERPRETER_WRITE.test(value))
    operations.push("interpreter write");
  if (FORMATTER_WRITE.test(stripped)) operations.push("formatter write");
  // A script runner is named by the runner, not by whichever script it ran.
  for (const match of stripped.matchAll(MUTATING_WORD))
    operations.push(match[1].replace(/\s+/g, " ").toLowerCase().replace(/^(sh|bash|zsh) .*$/, "$1"));
  if (IN_PLACE_EDIT.test(stripped)) operations.push("in-place edit");
  if (REDIRECT.test(stripped)) operations.push("redirect");
  return [...new Set(operations)];
}

export function looksMutatingShellCommand(command) {
  return mutatingShellOperations(command).length > 0;
}

// The host reports the shell's working directory with every event. It is
// never authority: a stale or wrong report must not let a mutation run in the
// main checkout. It is a claim the hook can pin — prefixing the literal
// directory turns "the shell is probably in the workspace" into a command the
// same policy proves — so an unanchored write an agent meant for its sandbox
// runs there instead of costing a refused turn. Directories are tried in
// order (as reported, then canonical) so the anchor matches the workspace
// spelling the policy was given.
export function pinShellAnchor(command, ...directories) {
  const text = String(command || "");
  if (!text.trim() || shellAnchor(text)) return null;
  for (const directory of directories) {
    if (typeof directory !== "string" || !isAbsolute(directory)) continue;
    const pinned = `cd ${shellDisplayArgument(resolve(directory))} && ${text}`;
    const anchor = shellAnchor(pinned);
    if (anchor && dynamicPathToken(anchor.target) === null) return pinned;
  }
  return null;
}

export function shellMutationViolation(phase, environment, command = null, inspection = null) {
  const operations = command === null ? null : mutatingShellOperations(command);
  if (operations !== null && operations.length === 0) return null;
  if (phase === "prove" || phase === "change")
    return `${phase === "prove" ? "Prove" : "Change"} cannot run mutating shell commands`;
  if (phase === "land" && environment.FOUNDATION_LAND_TRANSACTION !== "1")
    return "Land shell mutations require the runtime transaction marker";
  if (phase === "build") {
    const workspace = environment.FOUNDATION_WORKSPACE_ROOT;
    if (!workspace) return "Build shell mutations require an isolated workspace";
    if (command === null) return null;
    // Every refusal below carries its own repair: the refused operation, the
    // exact workspace, and the shape the command must take. A bare rule name
    // sent agents into unchanged retries.
    const text = String(command);
    const root = shellDisplayArgument(workspace);
    const anchor = shellAnchor(text);
    const dynamic = anchor ? dynamicPathToken(anchor.target) : null;
    if (dynamic === null && (!anchor || !isAbsolute(anchor.target) ||
        !within(workspace, anchor.target)))
      return "Build shell mutations must start inside the isolated workspace " +
        `(refused: ${operations.join(", ")}); ` +
        `start the command with \`cd ${root} && \` or \`cd ${hintPath(workspace, "/<subdir>")} && \``;
    if (dynamic === null && anchor.separator === ";" && !sameDirectory(workspace, anchor.target))
      return "Build shell mutations must start inside the isolated workspace " +
        `(\`${anchor.word};\` continues even when the directory change fails); ` +
        `start the command with \`cd ${shellDisplayArgument(anchor.target)} && \``;
    // A quoted operand hides its expansion from the text screen (`> "$OUT"`
    // reads as a literal word) but not from the shell; every mutation target
    // is judged after unquoting as well.
    const dynamicToken = dynamic ?? dynamicPathToken(expansionText(text)) ??
      filesystemMutationTargets(text).map(dynamicPathToken).find((token) => token !== null) ?? null;
    if (dynamicToken !== null)
      return "Build shell mutation contains a dynamic path that cannot be proven isolated " +
        `(\`${dynamicToken}\`); use literal paths inside ${root}`;
    const escape = obviousWorkspaceEscape(text, workspace, inspection);
    if (escape !== null && copySourceOperands(text).includes(escape))
      return "Build shell mutation copies or links from outside the isolated workspace " +
        `(\`${escape}\`); a workspace never borrows the checkout's files or dependencies. ` +
        "Declare sandbox.setupCommand in foundation.json (for example \"npm ci\") so the " +
        `harness prepares every workspace, or run that install once after \`cd ${root} && \``;
    if (escape !== null)
      return "Build shell mutation contains an obvious path outside the isolated workspace " +
        `(\`${escape}\`); keep every mutation target inside ${root}`;
  }
  return null;
}
