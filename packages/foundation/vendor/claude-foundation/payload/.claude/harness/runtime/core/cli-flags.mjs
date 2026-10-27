const REPEATABLE_FLAGS = new Set([
  "artifact", "artifacts", "reference", "criterion", "scope-path",
  "subject-actor", "subject-session", "subject-provider-family",
  "subject-model-family", "subject-model", "subject-provenance"
]);

export function createFlagParser({ fail }) {
  function parseFlags(values) {
    const flags = {};
    const rest = [];
    const setFlag = (key, value) => {
      if (REPEATABLE_FLAGS.has(key)) {
        const prior = flags[key];
        flags[key] = prior === undefined ? [value] :
          Array.isArray(prior) ? [...prior, value] : [prior, value];
        return;
      }
      flags[key] = value;
    };
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (!value.startsWith("--")) { rest.push(value); continue; }
      const body = value.slice(2);
      if (body.includes("=")) {
        const [key, ...tail] = body.split("=");
        setFlag(key, tail.join("="));
      } else if (values[i + 1] && !values[i + 1].startsWith("--")) {
        setFlag(body, values[i + 1]);
        i += 1;
      } else setFlag(body, true);
    }
    return { flags, rest };
  }

  function parseStrictCommandFlags(values, context, schema = {}) {
    const booleanFlags = new Set(schema.boolean || []);
    const valueFlags = new Set(schema.value || []);
    // A rejection that does not name the alternatives leaves source-reading as
    // the only way forward. Every refusal here spells out the whole surface.
    const supported = () => {
      const all = [...[...booleanFlags].map((flag) => `--${flag}`),
        ...[...valueFlags].map((flag) => `--${flag} <value>`)].sort();
      return all.length ? `\n  supported: ${all.join(", ")}` : "\n  supported: (no flags)";
    };
    const flags = {};
    const rest = [];
    for (let i = 0; i < values.length; i += 1) {
      const token = values[i];
      if (!token.startsWith("--")) {
        rest.push(token);
        continue;
      }
      const body = token.slice(2);
      const separator = body.indexOf("=");
      const key = separator === -1 ? body : body.slice(0, separator);
      if (!booleanFlags.has(key) && !valueFlags.has(key))
        fail(`${context} does not support --${key || "<empty>"}${supported()}`);
      if (Object.hasOwn(flags, key)) fail(`${context} does not allow duplicate --${key}`);
      if (booleanFlags.has(key)) {
        if (separator !== -1) fail(`${context} flag --${key} does not accept a value`);
        flags[key] = true;
        continue;
      }
      const inline = separator === -1 ? null : body.slice(separator + 1);
      const next = inline === null ? values[i + 1] : inline;
      if (!next || (inline === null && next.startsWith("--")))
        fail(`${context} flag --${key} requires a value`);
      flags[key] = next;
      if (inline === null) i += 1;
    }
    return { flags, rest };
  }

  return { parseFlags, parseStrictCommandFlags };
}
