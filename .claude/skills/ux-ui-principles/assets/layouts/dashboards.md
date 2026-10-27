# Dashboards and analysis

Original illustrative layouts for adaptation, not validated production designs.
Read [the selection guide](index.md) before choosing a pattern. Boxes indicate
content groups and priority, not fixed pixel geometry or implementation components.
Use [the shared specification](specification.md) for accessibility, states and tokens.

## D01: Operational overview

**Task:** Spot conditions needing action now.

**Wide layout:**

```text
Scope + time window + freshness | Filters
Critical indicators | Trend/context
Exceptions queue | Investigation links
```

**Compact behavior:** Stack urgent exceptions before supporting charts.

**Applicable states:** Loading; stale data; missing metrics; zero; service error.

**Avoid / adapt:** Avoid a wall of metrics unrelated to operational decisions.

**Acceptance example:** Check users identify a real exception and reach its relevant investigation.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## D02: Analytical exploration

**Task:** Explore trends and compare dimensions.

**Wide layout:**

```text
Question + dataset | Global filters
Main chart | Breakdown table
Comparison controls | Export/context
```

**Compact behavior:** Stack chart and table; use bounded scrolling for true 2D comparison.

**Applicable states:** No data; partial dataset; changed filters; export pending/failure.

**Avoid / adapt:** Avoid automatic causal interpretations from correlations.

**Acceptance example:** Check units, denominators, date range and filter scope remain explicit.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## D03: Finance reporting

**Task:** Inspect totals, reconciliations and discrepancies.

**Wide layout:**

```text
Period + currency + reconciliation status
Summary | Trend
Ledger table | Discrepancies + drilldown
```

**Compact behavior:** Preserve exact values and ledger access; prioritize discrepancies.

**Applicable states:** Unreconciled; provisional totals; missing transactions; export error.

**Avoid / adapt:** Avoid obscuring provisional or mixed-currency amounts.

**Acceptance example:** Check totals can be traced to source entries and status is understood.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## D04: Monitoring incidents

**Task:** Triage alerts and follow incident state.

**Wide layout:**

```text
Environment + current system status
Active incident queue | Severity and ownership
Timeline | Acknowledge/escalate controls
```

**Compact behavior:** Show status and queue first; provide a focused incident detail.

**Applicable states:** No incidents; alert flood; acknowledged; resolved; stale feed.

**Avoid / adapt:** Avoid identical urgency for every alert or silent acknowledgment failure.

**Acceptance example:** Check incident assignment, safe acknowledgments and retained time context.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## D05: Comparison workspace

**Task:** Compare selected records with aligned meanings.

**Wide layout:**

```text
Selected entities + add/remove
Shared dimensions and time controls
Aligned comparison table/chart | Notes and sources
```

**Compact behavior:** Offer deliberate horizontal comparison in a bounded region.

**Applicable states:** Selection empty; incompatible units; missing values; stale entity.

**Avoid / adapt:** Avoid comparing differently defined metrics as equivalent.

**Acceptance example:** Check selected objects, definitions and comparable time/units before conclusions.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.
