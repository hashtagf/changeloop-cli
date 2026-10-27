# Environment capabilities and packaging

Inspect the actual host tools and current policy; product names do not prove
CLI, browser, independent-worker, or model-runner availability.

- A supported model runner may execute matched baseline/candidate cases within
  an approved isolated scope. No runner means behavioral evaluation not-run.
- Lack of workers does not justify skipping baseline and claiming a comparison.
  Use sequential independent runs when supported, or report the limitation.
- Lack of a browser permits inline feedback or a static HTML artifact. Do not
  invent a viewer launch or require a human export to finish static checks.
- Packaging is optional. Use bundled package_skill tooling only when requested
  and supported; place its output within the authorized artifact scope and
  validate it before presentation. Packaging is not installation or publication.
- Preserve existing directory names and metadata identifiers unless their change
  is explicitly in scope. In Change Loop revise only the returned sandbox,
  never stage changes elsewhere and copy them into a live managed directory.

[skill-evaluation](../../skill-evaluation/SKILL.md) owns experimental boundaries.
Resume Change Loop after shipped changes; its Land leaves an uncommitted diff.
Git, installation into another catalog, upload, paid runs, and publication need
their corresponding authority.
