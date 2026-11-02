# Commerce and transactions

Original illustrative layouts for adaptation, not validated production designs.
Read [the selection guide](index.md) before choosing a pattern. Boxes indicate
content groups and priority, not fixed pixel geometry or implementation components.
Use [the shared specification](specification.md) for accessibility, states and tokens.

## C01: Product listing

**Task:** Find and compare products within a category.

**Wide layout:**

```text
Category + result count | Sort
Filters | Product grid/list
Applied filters | Pagination
```

**Compact behavior:** Move filters into a labeled panel; keep applied filters visible.

**Applicable states:** Loading; no matches; unavailable item; stale availability.

**Avoid / adapt:** Avoid removing meaningful comparison attributes in compact cards.

**Acceptance example:** Check findability, filter recovery and consistent sort across pages.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## C02: Product detail

**Task:** Evaluate one item before adding it to a basket.

**Wide layout:**

```text
Media | Name, price, availability
Specifications | Variant + quantity + Add
Delivery, returns | Related alternatives
```

**Compact behavior:** Put identity, price and selection near the main action; details follow.

**Applicable states:** No variant selected; unavailable variant; adding; added; failure.

**Avoid / adapt:** Avoid hiding shipping costs or requirements behind the purchase action.

**Acceptance example:** Check a correct variant is added once and important conditions are understood.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## C03: Cart review

**Task:** Review items and revise the intended purchase.

**Wide layout:**

```text
Items + edit quantities | Cost summary
Delivery estimate | Checkout action
Promotions | Continue shopping
```

**Compact behavior:** Stack editable items and a readable full summary.

**Applicable states:** Empty; price changed; stock changed; update error.

**Avoid / adapt:** Avoid treating displayed totals as final when required costs are unknown.

**Acceptance example:** Check edits update totals and changed prices/availability are explicit.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## C04: Checkout

**Task:** Collect necessary information and confirm a transaction.

**Wide layout:**

```text
Contact + delivery | Order summary
Payment selection | Review consequences
Submit | Status + receipt
```

**Compact behavior:** Use grouped sections or steps; prevent sticky actions covering errors.

**Applicable states:** Validation; submitting; uncertain payment result; failure; confirmed success.

**Avoid / adapt:** Avoid clearing permitted inputs or inviting another payment while outcome is unknown.

**Acceptance example:** Check retained inputs, duplicate prevention and safe result reconciliation.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## C05: Booking

**Task:** Choose a service, time and relevant attendee details.

**Wide layout:**

```text
Service/location | Calendar + availability
Selected slot | Attendee details
Policy + cost | Review + confirm
```

**Compact behavior:** Use an accessible date/slot list; keep chosen slot visible.

**Applicable states:** No slots; timezone change; slot lost; hold expiry; confirmed booking.

**Avoid / adapt:** Avoid a calendar-only interaction when a simpler list works better.

**Acceptance example:** Check timezone comprehension, conflict recovery and confirmed appointment details.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.
