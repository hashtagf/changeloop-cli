# Naming

## The one rule

**A name should let the reader skip reading the body.** If a reader has to open the function to find out what it does, the name has failed.

## Variables

- Name for **what the value represents**, not how it's computed. `activeUsers`, not `filteredUserList`. `totalCents`, not `sumResult`.
- Encode units when ambiguous. `timeoutMs`, `priceCents`, `weightKg`. Future-you will thank present-you.
- Boolean names read like questions. `isReady`, `hasErrors`, `canRetry`. Avoid `flag`, `status` for booleans.
- Loop counters can be `i`, `j`, `k` when scope is tiny. Past three lines, name them: `for (const user of users)`.
- Don't abbreviate domain words. `req`, `res`, `usr`, `cfg` save four characters and cost a mental hop. Editor autocomplete is free.

## Functions

- **Functions that return a value** are named for the value: `activeUsers()`, `totalCents()`, `findUserById()`.
- **Functions that act** are named for the action with a verb: `sendInvoice()`, `markPaid()`, `retryUntilSuccess()`.
- A function whose name needs "and" is doing too much. `getUserAndUpdateAccess` → `getUser` + `recordAccess`.
- Avoid `handle`, `process`, `manage`, `do` — these are placeholders that hide what the function actually does.
- Symmetric pairs should be symmetric: `open`/`close`, `acquire`/`release`, `start`/`stop`. Not `open`/`finish`.

## Types

- Types named for **what they represent in the domain**, not their shape. `Money` not `IntegerWithCurrency`. `Email` not `ValidatedString`.
- Generic-sounding names (`Data`, `Info`, `Manager`, `Handler`, `Helper`, `Util`) are usually a sign the type doesn't have a clear identity yet. Push back: what *is* this thing?
- Singular for one, plural for collections — but the collection is usually a `List<User>`, `Set<User>`, `Map<Id, User>` rather than a custom `Users` type.

## Files and modules

- File name matches the primary exported thing: `order.ts` exports `Order`. One conceptual thing per file when reasonable.
- Folder names describe the **role** of what's inside, not the technology: `payments/` not `stripe/`, `persistence/` not `postgres/`. Tech can be swapped; the role usually can't.

## Bad smells

- `data`, `info`, `value`, `temp`, `result` as final variable names. (Fine inside a 3-line function; never on a return value or struct field.)
- `getXxx` that does I/O. `get` implies cheap retrieval; if it's a network call, use `fetch`/`load`/`request`.
- `helper`, `utils`, `common` modules that accumulate everything. These become graveyards. If a function has a home, give it one.
- Hungarian notation in modern typed languages (`strName`, `iCount`). The type system already tells you.

## When to break the rules

- Mathematical / well-known short names are fine in context: `x`, `y`, `dx`, `n`, `i`, `acc`.
- A name from a published spec or formula should match the spec, even if it's cryptic. Cite the spec in a one-line comment.

## A quick test

Read the line out loud. If a teammate would have to ask "what's `proc_data`?" — rename. If they'd nod and move on — keep it.
