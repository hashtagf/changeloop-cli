// Pure parsers for the portable change packet. These live with contracts so
// core state hashing and workflow orchestration can share the grammar without
// creating a reverse core -> workflow dependency.
export function taskBlocks(content) {
  const blocks = [];
  let current = null;
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
    if (match) {
      if (current) blocks.push(current);
      const id = match[2].match(/^\*{0,2}(T\d{3,})\*{0,2}\b/i)?.[1]?.toUpperCase() || null;
      current = {
        done: match[1].toLowerCase() === "x",
        lines: [line],
        text: match[2],
        id
      };
    } else if (current && (/^\s+/.test(line) || line.trim() === "")) {
      current.lines.push(line);
      current.text += ` ${line.trim()}`;
    } else if (current) {
      blocks.push(current);
      current = null;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

export function taskMetadata(task) {
  const value = task.text;
  const list = (name) => {
    const match = value.match(new RegExp(`\\[${name}:([^\\]]+)\\]`, "i"));
    return match
      ? match[1].split(",").map((item) => item.trim()).filter(Boolean)
      : [];
  };
  return {
    id: task.id,
    done: task.done,
    repository: list("repo")[0] || "root",
    kind: list("kind")[0] || "implementation",
    requestedModel: list("model")[0] || null,
    dependsOn: list("depends").map((item) => item.toUpperCase()),
    paths: list("paths"),
    resources: list("resources"),
    claims: list("claims"),
    inputSchema: list("input-schema")[0] || null,
    outputSchema: list("output-schema")[0] || null,
    text: value.replace(/\s+/g, " ").trim().slice(0, 1000)
  };
}

const SPEC_HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const DELTA_SECTION = /^(ADDED|MODIFIED|REMOVED|RENAMED)\b/i;

export function specDeltaOperation(section) {
  return DELTA_SECTION.exec(section || "")?.[1]?.toUpperCase() || null;
}

// Parses both canonical specifications and change deltas. Keeping section,
// scenarios, and the complete body together lets pre-Build validation and the
// post-archive oracle apply exactly the same grammar.
export function parseSpecDocument(text) {
  const requirements = [];
  let section = null;
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    const heading = line.match(SPEC_HEADING);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2];
      if (level <= 3) {
        const name = level === 3
          ? title.match(/^Requirement:\s*(.+?)$/)?.[1]?.trim()
          : null;
        if (level === 2) section = title.trim();
        current = name
          ? { section, name, scenarios: [], lines: [line] }
          : null;
        if (current) requirements.push(current);
        continue;
      }
      const scenario = level === 4
        ? title.match(/^Scenario:\s*(.+?)$/)?.[1]?.trim()
        : null;
      if (scenario && current) current.scenarios.push(scenario);
    }
    if (current) current.lines.push(line);
  }
  return requirements.map(({ lines, ...requirement }) => ({
    ...requirement,
    body: lines.join("\n").replace(/\s+$/, "")
  }));
}

export function parseSpecRequirements(text) {
  return parseSpecDocument(text).map(({ body, ...requirement }) => requirement);
}
