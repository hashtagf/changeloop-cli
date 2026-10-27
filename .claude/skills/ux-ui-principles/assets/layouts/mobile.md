# Mobile-first tasks and services

Original illustrative layouts for adaptation, not validated production designs.
Read [the selection guide](index.md) before choosing a pattern. Boxes indicate
content groups and priority, not fixed pixel geometry or implementation components.
Use [the shared specification](specification.md) for accessibility, states and tokens.

## B01: Mobile task home

**Task:** Start common tasks from a small-screen entry point.

**Wide layout:**

```text
Identity/context | Important status
Primary tasks | Recent activity
Navigation | Help
```

**Compact behavior:** This is the small-screen base; widen into task grid with readable grouping.

**Applicable states:** First use; no history; offline; restricted task.

**Avoid / adapt:** Avoid a fixed number of navigation items unrelated to task structure.

**Acceptance example:** Check discoverability, touch/keyboard access and label clarity.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## B02: Mobile detail and action

**Task:** Inspect one object and perform its main action.

**Wide layout:**

```text
Back + object identity
Essential details | Supporting content
Action area | Result context
```

**Compact behavior:** Base single-column; desktop may split detail and supporting content.

**Applicable states:** Loading; unavailable object; action pending; failed; completed.

**Avoid / adapt:** Avoid a sticky action covering focused controls or error text.

**Acceptance example:** Check focus visibility, zoom, opened keyboard and action recovery.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## B03: Appointment self-service

**Task:** Manage an existing booking and its next steps.

**Wide layout:**

```text
Appointment + date/time/timezone
Preparation + location | Change/cancel
Confirmation | Support route
```

**Compact behavior:** Base stacked layout; desktop may use appointment summary alongside actions.

**Applicable states:** Upcoming; changed; canceled; action blocked; conflict.

**Avoid / adapt:** Avoid presenting stale appointments as confirmed current details.

**Acceptance example:** Check consequence review and synchronized confirmed booking changes.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## B04: Location search

**Task:** Find a suitable place using map and list information.

**Wide layout:**

```text
Search/location permission | Filters
Map | Accessible result list
Selected place + details | Directions
```

**Compact behavior:** Make list and map switchable; keep search and selected place context.

**Applicable states:** Permission denied; no results; location unavailable; stale hours.

**Avoid / adapt:** Avoid map-only discovery or a required location permission without fallback.

**Acceptance example:** Check manual search, list equivalent and meaning of distance/availability.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## B05: Upload or capture

**Task:** Provide files or photos with clear requirements.

**Wide layout:**

```text
Purpose + file requirements
Choose/capture | Selected file preview
Upload status | Review/submit
```

**Compact behavior:** Base stacked capture/preview; desktop may support drop plus choose.

**Applicable states:** Permission denied; unsupported/oversize file; upload retry; success.

**Avoid / adapt:** Avoid drag-only upload or clearing the selection after recoverable failure.

**Acceptance example:** Check choose-file path, error correction and confirmed upload status.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.
