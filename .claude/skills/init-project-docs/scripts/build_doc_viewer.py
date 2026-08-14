#!/usr/bin/env python3
"""Build a single self-contained document.html that renders a project's docs suite.

Reads the Markdown files in a docs directory, embeds their content into one HTML
file (no server needed — open it by double-clicking), and renders them client-side
with marked.js + mermaid.js loaded from a CDN. A left sidebar switches between docs.

Because the Markdown is embedded at build time, document.html is a *snapshot*:
re-run this script after you edit any .md file to refresh it.

Usage:
    python3 build_doc_viewer.py [--docs-dir docs] [--output docs/document.html]
                                [--title "My Project"]

The known suite files (OVERVIEW, ARCHITECTURE, TECHSTACK, DATAMODEL, COREFEATURE,
BUSINESSRULE, API, DESIGN) are ordered first with friendly titles; any other *.md in the directory
is appended (alphabetically) so the viewer stays useful for extra docs too.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Canonical reading order + display titles for the suite.
KNOWN = [
    ("OVERVIEW.md", "Overview"),
    ("ARCHITECTURE.md", "Architecture"),
    ("TECHSTACK.md", "Tech Stack"),
    ("DATAMODEL.md", "Data Model"),
    ("COREFEATURE.md", "Core Features"),
    ("BUSINESSRULE.md", "Business Rules"),
    ("API.md", "API"),
    ("DESIGN.md", "Design (UX/UI)"),
]
OUTPUT_NAME = "document.html"


def title_from_filename(name: str) -> str:
    stem = Path(name).stem.replace("_", " ").replace("-", " ")
    return stem.title()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", Path(name).stem.lower()).strip("-")


def collect_docs(docs_dir: Path, output: Path) -> list[dict]:
    """Return [{id, title, file, content}] in canonical order, extras appended."""
    known_lower = {k.lower(): t for k, t in KNOWN}
    present = {p.name.lower(): p for p in docs_dir.glob("*.md")}
    docs: list[dict] = []
    seen: set[str] = set()

    for fname, title in KNOWN:
        p = present.get(fname.lower())
        if p:
            docs.append(_read_doc(p, title))
            seen.add(p.name.lower())

    extras = sorted(
        p for key, p in present.items()
        if key not in seen and key not in known_lower and p.resolve() != output.resolve()
    )
    for p in extras:
        docs.append(_read_doc(p, title_from_filename(p.name)))

    return docs


def _read_doc(path: Path, title: str) -> dict:
    return {
        "id": slugify(path.name),
        "title": title,
        "file": path.name,
        "content": path.read_text(encoding="utf-8"),
    }


def render_html(title: str, docs: list[dict]) -> str:
    # Embed as JSON inside a <script type="application/json"> block. Escaping "</"
    # prevents the doc content from prematurely closing the script tag; JSON.parse
    # turns "<\/" back into "</".
    payload = json.dumps(docs, ensure_ascii=False).replace("</", "<\\/")
    safe_title = (
        title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    return _TEMPLATE.replace("__TITLE__", safe_title).replace("__DOCS_JSON__", payload)


_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__ — Documentation</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --border: #d1d9e0;
    --sidebar-bg: #f6f8fa; --accent: #0969da; --accent-bg: #ddf4ff;
    --code-bg: #f6f8fa; --max: 860px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --border: #30363d;
      --sidebar-bg: #161b22; --accent: #4493f8; --accent-bg: #11304f;
      --code-bg: #161b22;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; display: flex; min-height: 100vh; color: var(--fg);
    background: var(--bg);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  #sidebar {
    width: 260px; flex: 0 0 260px; background: var(--sidebar-bg);
    border-right: 1px solid var(--border); padding: 20px 14px;
    position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }
  #sidebar h1 { font-size: 15px; margin: 0 0 4px; padding: 0 10px; }
  #sidebar .sub { font-size: 12px; color: var(--muted); margin: 0 0 16px; padding: 0 10px; }
  #sidebar nav a {
    display: block; padding: 7px 10px; margin: 1px 0; border-radius: 6px;
    color: var(--fg); text-decoration: none; font-size: 14px;
  }
  #sidebar nav a:hover { background: var(--border); }
  #sidebar nav a.active { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
  #content { flex: 1; padding: 40px 48px; max-width: calc(var(--max) + 96px); overflow-x: auto; }
  #content > * { max-width: var(--max); }
  #content h1, #content h2, #content h3 { line-height: 1.25; margin-top: 1.6em; }
  #content h1 { font-size: 1.9em; margin-top: 0; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
  #content h2 { font-size: 1.4em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
  #content code { background: var(--code-bg); padding: .2em .4em; border-radius: 6px; font-size: 85%;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
  #content pre { background: var(--code-bg); padding: 16px; border-radius: 8px; overflow-x: auto; }
  #content pre code { background: none; padding: 0; font-size: 90%; }
  #content table { border-collapse: collapse; display: block; overflow-x: auto; }
  #content th, #content td { border: 1px solid var(--border); padding: 6px 13px; }
  #content th { background: var(--sidebar-bg); }
  #content blockquote { color: var(--muted); border-left: 4px solid var(--border); margin: 0; padding: 0 1em; }
  #content a { color: var(--accent); }
  #content .mermaid { background: var(--bg); text-align: center; margin: 1.2em 0; }
  #menu-toggle { display: none; }
  @media (max-width: 800px) {
    body { flex-direction: column; }
    #sidebar { width: 100%; flex: none; height: auto; position: static; }
    #content { padding: 24px 20px; }
  }
</style>
</head>
<body>
<aside id="sidebar">
  <h1 id="proj-title">__TITLE__</h1>
  <p class="sub">Project documentation</p>
  <nav id="nav"></nav>
</aside>
<main id="content"></main>

<script id="docs-data" type="application/json">__DOCS_JSON__</script>
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({ startOnLoad: false, theme: prefersDark ? 'dark' : 'default', securityLevel: 'loose' });

const docs = JSON.parse(document.getElementById('docs-data').textContent);
const nav = document.getElementById('nav');
const content = document.getElementById('content');
const byId = {};

docs.forEach((doc, i) => {
  byId[doc.id] = doc;
  const a = document.createElement('a');
  a.href = '#' + doc.id;
  a.textContent = doc.title;
  a.dataset.id = doc.id;
  nav.appendChild(a);
});

async function render(id) {
  const doc = byId[id] || docs[0];
  if (!doc) { content.innerHTML = '<p>No documentation files found.</p>'; return; }
  content.innerHTML = marked.parse(doc.content);
  // Promote ```mermaid fenced code blocks into mermaid containers, then render.
  const blocks = content.querySelectorAll('code.language-mermaid');
  blocks.forEach(code => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = code.textContent;
    (code.closest('pre') || code).replaceWith(div);
  });
  if (blocks.length) {
    try { await mermaid.run({ querySelector: '#content .mermaid' }); }
    catch (e) { console.error('mermaid render error', e); }
  }
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.id === doc.id));
  content.scrollTo ? content.scrollTo(0, 0) : window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => render(location.hash.slice(1)));
render(location.hash.slice(1) || (docs[0] && docs[0].id));
</script>
</body>
</html>
"""


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Build a self-contained document.html from a docs suite.")
    parser.add_argument("--docs-dir", default="docs", help="Directory holding the .md files (default: docs)")
    parser.add_argument("--output", default=None, help="Output path (default: <docs-dir>/document.html)")
    parser.add_argument("--title", default=None, help="Project title shown in the viewer")
    args = parser.parse_args(argv)

    docs_dir = Path(args.docs_dir)
    if not docs_dir.is_dir():
        print(f"error: docs dir not found: {docs_dir}", file=sys.stderr)
        return 1

    output = Path(args.output) if args.output else docs_dir / OUTPUT_NAME
    title = args.title or docs_dir.resolve().parent.name

    docs = collect_docs(docs_dir, output)
    if not docs:
        print(f"error: no .md files found in {docs_dir}", file=sys.stderr)
        return 1

    output.write_text(render_html(title, docs), encoding="utf-8")
    print(f"Wrote {output} ({len(docs)} docs: {', '.join(d['file'] for d in docs)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
