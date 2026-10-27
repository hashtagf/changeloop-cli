# Semantic intelligence

Before every v4 inspection, the harness ranks repository specifications, tests,
callers, dependencies, integrations, persistence, and permission boundaries,
then hashes a bounded read-set. Declared sources are seeds. Git-tracked and
non-ignored files define the scan when available. Oversized undeclared files are
reported and skipped; an oversized seed or hard-limit failure returns agent-owned
investigation. Unsupported graph languages report partial coverage.
Enumeration uses fixed hard safety limits; the adaptive tier controls only the
selected read-set and question frontier.

Intake depth adapts from typed size, impact, coupling, risk, and repository
signals. The tier changes source and question-frontier budgets; it never removes
a required discovery dimension. Before exposing `ASK_USER`, the harness rejects
duplicate alternatives, a recommendation outside its alternatives, an
unsupported recommendation, and a question already answered by a keyed source
fact. The harness records the inventory digest; `discovery.sourceDigest` is
optional. Every source fact carries `sourcePath` and
`sourceDigest`; recommendation evidence names a selected path or carries the same
binding. Keep `riskSignals` and `discovery.sourceFacts` language-neutral; Thai,
English, and mixed prose must produce the same result from the same typed facts.

The snapshot records coverage, grounding, eligible/rejected/resolved questions,
depth, and cumulative actions. Unobserved user acceptance and other missing
measurements stay `null`. It stores no transcript; completed initial and amendment
summaries survive in change runtime and `metrics`.
