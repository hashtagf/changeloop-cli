# Build and maintain real-surface verification drivers

Choose the user-visible claim and its real surface: command, service endpoint,
browser interaction, storage boundary, or installed consumer. Identify the
assertion that distinguishes working behavior from the reported failure.
Exercise that surface instead of reimplementing the product logic in the test.

Give the driver explicit fixture inputs and a reproducible invocation. Own
startup, readiness detection, ports, temporary resources, and cleanup, including
failure exits. Use disposable scopes; do not depend on another developer's
running service or silently modify a live account. Preserve source revision,
commands, observed assertions, diagnostics, and artifacts needed to reproduce
the result. Missing tools or credentials produce an unavailable outcome.

Prove the driver's discrimination with a controlled broken fixture or the
relevant pre-fix version: it must fail for the intended product reason. Then
verify repaired behavior and at least the important negative path. A driver
that always exits successfully, checks only startup, or accepts a timeout as
success cannot establish the claim.

Register the invocation with the project's existing test/provider contract.
Let the harness collect and bind evidence; never manufacture or edit its proof
JSON. A helper's local pass does not replace a required provider or override
its gate policy. Reuse existing driver infrastructure before adding a new skill
or a parallel test framework.

When the surface changes, inspect actual behavior and fixture assumptions before
updating selectors, expected output, or protocol assertions. Retain a failing
example that detects the original regression. Run affected supported consumers
when interfaces change. Explain intentional expectation changes through the
agreement rather than adapting every assertion to whatever the product emits.
