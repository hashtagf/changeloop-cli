# Remove residue without erasing intent

Start with the requested diff and its actual consumers. Identify duplicated
logic, unused imports, speculative abstractions, generated prose, redundant
guards, and comments that merely restate syntax. Each removal needs a reason
grounded in behavior, reachability, or an existing convention; verbosity alone
does not prove dead code.

Before deleting comments or defensive checks, identify the invariant they
protect: compatibility, ordering, concurrency, trust boundaries, or historical
failure. Preserve non-obvious rationale. Replace a comment with a type, contract,
or discriminating regression only when that replacement expresses the same
constraint. A happy-path test cannot justify deleting failure-path protection.

Check dynamic consumers, public imports, configuration, scripts, and generated
interfaces before declaring a symbol unused. Remove one coherent dependency
slice, then run the checks invalidated by that slice. Use the repository's real
formatter and lint configuration; avoid unrelated formatting or cosmetic churn.

Review the resulting behavior and diff size against the request. Record any
intentional behavior change in the active agreement through its normal revision
route. Cleanup does not authorize a redesign, blanket comment deletion, history
rewriting, or a separate cleanup commit.
