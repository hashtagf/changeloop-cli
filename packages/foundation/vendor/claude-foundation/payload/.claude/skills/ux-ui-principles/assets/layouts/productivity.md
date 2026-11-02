# Productivity and collaboration

Original illustrative layouts for adaptation, not validated production designs.
Read [the selection guide](index.md) before choosing a pattern. Boxes indicate
content groups and priority, not fixed pixel geometry or implementation components.
Use [the shared specification](specification.md) for accessibility, states and tokens.

## P01: Inbox master-detail

**Task:** Triage many messages without losing queue context.

**Wide layout:**

```text
Folder/filter rail | Message list | Active message
Selection + status | Reply/actions
Composer | Delivery status
```

**Compact behavior:** Switch list→detail with a clear Back route and retained position.

**Applicable states:** Unread; selected; empty folder; sending; failed delivery.

**Avoid / adapt:** Avoid hiding active filters or claiming sent before confirmation.

**Acceptance example:** Check keyboard progression, list return and recovery of unsent drafts.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## P02: Kanban board

**Task:** Track work by stage and move items safely.

**Wide layout:**

```text
Board scope + filters | Add
Stage columns with counts and cards
Selected task detail | Activity
```

**Compact behavior:** Offer a list/grouped view plus non-drag move controls.

**Applicable states:** Empty stage; moving; move denied; conflict; stale board.

**Avoid / adapt:** Avoid drag-only operation or confusing visual position with saved status.

**Acceptance example:** Check keyboard/single-pointer moves and confirmed state after sync.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## P03: Calendar workspace

**Task:** Schedule and inspect time-bound events.

**Wide layout:**

```text
Date + timezone + view controls
Calendar grid | Agenda + event detail
Create/edit | Conflict context
```

**Compact behavior:** Prefer agenda/date navigation on small screens with calendar optional.

**Applicable states:** No events; overlap; timezone change; save conflict.

**Avoid / adapt:** Avoid relying on color alone for calendars or availability.

**Acceptance example:** Check event timing, locale display and accessible event selection.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## P04: Document editor

**Task:** Create content with understandable save and sharing state.

**Wide layout:**

```text
Document title + save state | Share
Contextual toolbar | Editing canvas
Outline/comments | Version history
```

**Compact behavior:** Prioritize editing; place optional panels behind discoverable controls.

**Applicable states:** Unsaved; saving; offline; conflict; read-only.

**Avoid / adapt:** Avoid treating local pending changes as saved remotely.

**Acceptance example:** Check retained work, undo, sync conflict and permission effects.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## P05: Collaboration workspace

**Task:** Coordinate a project through tasks and discussion.

**Wide layout:**

```text
Project identity + members | Search
Task/activity views | Contextual discussion
Files/decisions | Next actions
```

**Compact behavior:** Expose one primary view and clear routes to supporting context.

**Applicable states:** No tasks; restricted item; sync delay; mention/send failure.

**Avoid / adapt:** Avoid duplicating authoritative status across disconnected views.

**Acceptance example:** Check assignment, context retention and clear visibility rules.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.
