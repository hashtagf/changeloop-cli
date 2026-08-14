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
    text: value.replace(/\s+/g, " ").trim().slice(0, 1000)
  };
}

export function parseSpecRequirements(text) {
  const requirements = [];
  let section = null;
  let current = null;
  for (const line of text.split("\n")) {
    const requirement = line.match(/^###\s+Requirement:\s*(.+?)\s*$/);
    const scenario = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (requirement) {
      current = { section, name: requirement[1].trim(), scenarios: [] };
      requirements.push(current);
    } else if (scenario) {
      if (current) current.scenarios.push(scenario[1].trim());
    } else if (heading) {
      section = heading[1].trim();
      current = null;
    }
  }
  return requirements;
}
