---
name: observability-fundamentals
description: "Design or review runtime logs, metrics, traces, SLIs/SLOs, alerts, and failure visibility. Use for changed operated boundaries and production blind spots. Use performance-investigation to explain measurements; skip offline code and unnecessary telemetry."
---

# Observability fundamentals

Missing counters remain unavailable, never zero. Use `performance-investigation`
to validate comparative numbers.

This is cross-cutting. Load it with one primary skill only when the change adds
or materially alters runtime failure behavior.

## Rules

1. Start from operator questions and user-visible failure, then choose logs,
   metrics, and traces that answer them.
2. Emit structured, leveled events at ownership boundaries. Include stable
   operation/request identity and actionable context; never secrets or
   unbounded payloads.
3. Propagate correlation and trace context across process, service, and async
   boundaries.
4. Measure RED for services and USE for resources. Use distributions and
   percentiles for latency, not averages alone.
5. Define SLIs from user-observable success and latency, then set SLOs and error
   budgets that drive decisions.
6. Alert on symptoms that require action. Attach owner, runbook, severity,
   dedupe, and recovery signal.
7. Bound metric labels, log volume, trace sampling, retention, and cost. User
   IDs, request IDs, URLs, and error text are usually not metric labels.

## Check before finishing

- Can an operator identify who is affected, where, since when, and why?
- Can one request/job be followed across every hop?
- Are retry storms, queues, saturation, and partial failure visible?
- Does each alert map to a user symptom and an action?

Record the changed failure surface, SLI, ownership, and required telemetry
evidence in OpenSpec. Let project providers verify emitted signals where
practical; configuration presence alone does not prove an observable path.

Reference: `references/logs-metrics-traces.md`. Read only the section matching
the current concern.
