---
name: observability-fundamentals
description: Add or review operability when runtime code changes a failure mode, log, metric, trace, SLI/SLO, alert, queue, dependency, or production blind spot. Covers structured events, correlation, RED/USE metrics, percentiles, symptom alerts, ownership, and telemetry cost/cardinality. Skip offline or throwaway code with no operated runtime.
---

# Observability fundamentals

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
