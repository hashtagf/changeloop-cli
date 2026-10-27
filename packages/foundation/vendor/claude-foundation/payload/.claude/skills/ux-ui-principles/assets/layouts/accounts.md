# Accounts, onboarding and settings

Original illustrative layouts for adaptation, not validated production designs.
Read [the selection guide](index.md) before choosing a pattern. Boxes indicate
content groups and priority, not fixed pixel geometry or implementation components.
Use [the shared specification](specification.md) for accessibility, states and tokens.

## U01: Sign-in and recovery

**Task:** Access an account and recover from failure.

**Wide layout:**

```text
Identity + sign-in method
Credentials or provider action | Recovery route
Security/status feedback | Alternative method
```

**Compact behavior:** Single-column form; keep labels and recovery visible.

**Applicable states:** Wrong credentials; pending; locked/rate-limited; recovery sent.

**Avoid / adapt:** Avoid disabling password-manager or paste workflows.

**Acceptance example:** Check authentication and recovery with assistive tools and preserved safe input.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## U02: Setup onboarding

**Task:** Reach a first useful result with necessary preparation.

**Wide layout:**

```text
Purpose + prerequisites | Progress
Current setup task | Example/help
Back/continue | Skip where meaningful
```

**Compact behavior:** One focused stage at a time; preserve answers when going back.

**Applicable states:** Not started; partial; validation; save failure; completed.

**Avoid / adapt:** Avoid mandatory tours unrelated to the user's goal.

**Acceptance example:** Check resumption, optional-task handling and an actual useful completion.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## U03: Profile settings

**Task:** Review and edit personal account information.

**Wide layout:**

```text
Settings sections | Profile summary
Grouped editable fields | Save/cancel
Change confirmation | Related security settings
```

**Compact behavior:** Use labeled sections and a focused form.

**Applicable states:** Unchanged; unsaved; saving; validation; verified/unverified.

**Avoid / adapt:** Avoid silently applying edits with unclear persistence.

**Acceptance example:** Check saved values, error recovery and consequences of identity changes.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## U04: Security settings

**Task:** Understand sessions and strengthen account access.

**Wide layout:**

```text
Security overview | Authentication methods
Active sessions | Revoke/change controls
Recovery readiness | Activity
```

**Compact behavior:** Stack methods and sessions; confirm consequential revocation.

**Applicable states:** Pending verification; expired challenge; revoked; unavailable method.

**Avoid / adapt:** Avoid presenting security changes without explaining access consequences.

**Acceptance example:** Check allowed changes, session revocation and safe recovery paths.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## U05: Subscription management

**Task:** Understand billing and change or cancel a subscription.

**Wide layout:**

```text
Current plan + renewal + cost
Usage/limits | Billing history
Change plan | Cancel + consequence review
```

**Compact behavior:** Put current commitment and management actions near each other.

**Applicable states:** Active; trial; past due; scheduled cancellation; change failed.

**Avoid / adapt:** Avoid hidden cancellation or unclear end-of-access dates.

**Acceptance example:** Check recurring amounts, change timing and accurate cancellation result.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.
