// Finds one concrete dependency cycle in a stuck graph so the error can name
// it. `edges` maps a node id to its dependency ids; ids without an entry are
// treated as satisfiable and never part of a cycle. Returns the cycle as a
// path whose first and last element are the same node (`[a, b, a]`), or null.
export function findCyclePath(edges) {
  const settled = new Set();
  const stack = [];
  const onStack = new Set();
  function walk(node) {
    if (onStack.has(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (settled.has(node) || !edges.has(node)) return null;
    stack.push(node);
    onStack.add(node);
    for (const dependency of edges.get(node)) {
      const cycle = walk(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    onStack.delete(node);
    settled.add(node);
    return null;
  }
  for (const node of edges.keys()) {
    const cycle = walk(node);
    if (cycle) return cycle;
  }
  return null;
}
