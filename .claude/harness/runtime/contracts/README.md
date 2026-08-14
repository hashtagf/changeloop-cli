# Runtime contracts

These versioned contracts describe provenance and execution metadata exchanged
with an agent host. They intentionally exclude prompt text, messages, model
output, tool arguments, and tool results.

## Instruction manifest

Use `createInstructionManifest` from `../core/instruction-manifest.mjs` when a
command is dispatched. Persist the returned manifest with the run and attach
only `manifestDigest` where a compact packet, receipt, proof, or telemetry event
needs lineage. Use `verifyInstructionManifest` before trusting a stored
manifest. `instructionProvenance(null)` makes pre-manifest runs explicitly
unavailable rather than invalid, preserving legacy compatibility.

Important invariants:

- instruction paths must remain inside the Foundation root;
- missing files, duplicate skill names, and invalid/mismatched skill
  frontmatter are rejected;
- instruction content is hashed after CRLF normalization but never returned;
- arrays with identity semantics are sorted before the manifest is hashed;
- changing any selected instruction changes `manifestDigest`.

## Host execution result

Use `normalizeHostExecution` from
`../observability/host-execution-contract.mjs` at the host boundary. To retain a
normalized result idempotently, call
`createHostExecutionStore({ root }).importExecution(changeId, input)`. Convert
attempt summaries to existing telemetry rows with
`hostExecutionTelemetryRows(execution)`.

Important invariants:

- missing usage remains `null`, never an inferred zero;
- requested and actual models remain separate;
- attempt numbers are positive, unique, and sorted;
- the dispatch ID is the idempotency key for stored execution results;
- persisted objects are allowlisted, so prompt, message, output, and tool
  payload fields from a host are discarded by construction;
- planned fallback is not treated as actual fallback; actual attempts and their
  `fallbackReason` provide execution evidence;
- unknown input fields are ignored for forward-compatible ingestion.

The JSON schemas in this directory describe the persisted normalized shapes.
