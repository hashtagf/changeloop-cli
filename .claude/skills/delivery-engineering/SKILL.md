---
name: delivery-engineering
description: "Design or repair CI/CD, builds, artifacts, configuration, deploy, rollout, and rollback. Use for reproducible delivery pipelines and failing checks. Project tools produce evidence; Change Loop owns proof/Land, and external effects require separate authority."
---

# Delivery engineering

Aggregate independent CI findings and repair in dependency order. Never push,
weaken protection, or change expectations merely to make checks green.

Use this for the path from source to a running or published artifact. Foundation
controls change/evidence/Land; the project pipeline remains the delivery system
and an evidence producer.

## Rules

1. Define what a green merge gate guarantees. Run the required build, tests,
   lint, typecheck, and security checks on the actual merge candidate.
2. Build one immutable, identifiable artifact and promote that exact artifact
   through environments; never rebuild per environment.
3. Inject environment configuration at runtime and retrieve secrets from a
   managed boundary. Keep both out of source, images, logs, and receipts.
4. Pin lockfiles, toolchains, actions, and base images sufficiently for a fresh
   machine to reproduce the build.
5. Limit rollout blast radius with rolling, blue-green, canary, or flags. Name
   health gates, abort thresholds, rollback trigger, and data compatibility.
6. Automate repeatable release steps; require explicit authority for production
   effects and preserve auditable provenance.
7. Observe delivery with artifact identity, deployment events, health signals,
   ownership, and DORA-style outcome metrics.

## Check before finishing

- Does green mean the artifact is eligible to ship?
- Is production running the digest that passed the gate?
- Can old/new versions and schemas overlap during rollback?
- Do missing configuration or failed health checks stop safely?
- Can the operator identify, halt, and reverse a bad rollout?

Record delivery decisions, rollout, rollback, and required providers in the
active OpenSpec design/evidence contract. Do not duplicate Foundation state or
weaken Land authority in pipeline code.

Reference: read `references/pipeline-and-deploy.md` for pipeline structure,
caching, artifact promotion, configuration, deploy strategies, flags, and
delivery metrics. Use `git-workflow` for branch/commit/PR operations.

For failed CI or review findings, read [repair procedure](references/ci-and-review-repair.md).
