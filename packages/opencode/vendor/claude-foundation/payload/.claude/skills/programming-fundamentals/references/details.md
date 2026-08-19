# Details: data modeling, illegal states, purity, read-first

Rule/why/example for `programming-fundamentals` principles without their own
topical reference file, plus the cross-cutting read-first practice.

## 1. Model the data first

**Rule:** Decide the shape of the data before you decide the operations. Operations follow from data; if the data is wrong, the operations will be ugly forever.

**Why:** Most "complex logic" is an awkward data shape in disguise — the right structure makes the operation trivial, the wrong one invites bugs forever.

**How to apply:**
- Before writing the function, sketch the input type and the output type. If you can't write them down, you don't yet understand the problem.
- Prefer the most constrained shape that holds the data you actually have. Don't use a `List` if there are no duplicates — use a `Set`. Don't use a `Map<String, Any>` if the keys are known — use a struct/record.
- Group fields that travel together into one type. If three parameters always appear together, they're really one thing.

**Example:**
```ts
// Awkward — caller juggles three parallel arrays, easy to misalign
function chargeAll(userIds: string[], amounts: number[], currencies: string[]) { ... }

// Better — the shape mirrors the domain; misalignment is impossible
type Charge = { userId: UserId; amount: Money }
function chargeAll(charges: Charge[]) { ... }
```

## 2. Make illegal states unrepresentable

**Rule:** Use types, enums, sum types, smart constructors, and structure to ensure that wrong states can't even be written down.

**Why:** An application check gets forgotten or written five different ways. A type constraint or smart constructor enforces it once, everywhere, forever.

**How to apply:**
- Replace `String` with a typed wrapper when the string has rules (`Email`, `UserId`, `IsoCountryCode`). The constructor validates once; everyone downstream trusts it.
- Replace `boolean` flags that combine with other flags. If you have `isLoading`, `isError`, `data`, and only certain combinations are valid, model it as a sum type: `Loading | Error(e) | Ready(data)`.
- Replace nullable fields whose nullability is conditional. Instead of `User { email?: string; emailVerifiedAt?: Date }` with the rule "verified implies email is set", model two states: `Unverified(email?) | Verified(email, at)`.

**Example:**
```ts
// Bad — four boolean combinations, only some legal
type RequestState = { isLoading: boolean; error: Error | null; data: T | null }

// Good — three legal states, nothing else compiles
type RequestState<T> =
  | { tag: 'loading' }
  | { tag: 'error'; error: Error }
  | { tag: 'ready'; data: T }
```

## 4. Pure core, effectful shell

**Rule:** Push side effects (I/O, time, randomness, network, DB) to the edges. Keep the logic in the middle pure.

**Why:** Pure functions are testable and composable; I/O kills both. Concentrate effects at the edge and the inner 80% stays cheap to test and change.

**How to apply:**
- A function that takes inputs and returns outputs, with no hidden reads or writes, is pure. Aim for this whenever the logic doesn't *need* I/O.
- Pass time, randomness, and other "ambient" effects as arguments (or via injected ports — see [[hexagonal-backend]]). `priceFor(order, now)` is testable; `priceFor(order)` that secretly calls `Date.now()` is not.
- Sequence: load the data → compute → write the result. Don't interleave reads and computation, or your pure logic becomes infected with retries and timeouts.

**Example:**
```ts
// Bad — logic and I/O tangled; can't test the math without a DB
async function applyDiscount(orderId: string) {
  const order = await db.findOrder(orderId)
  const discount = order.total > 100 ? order.total * 0.1 : 0
  await db.update(orderId, { discount })
}

// Good — pure rule, separate I/O
function discountFor(total: Money): Money {
  return total.cents > 10_000 ? total.scale(0.1) : Money.zero(total.currency)
}
// shell calls: load → discountFor → save
```

## Practice: Read before you write

**Rule:** Read the surrounding code, the error message, and the actual failing function before writing or guessing.

**Why:** Most fixes that fail address an imagined problem. Reading first is free; rework is expensive.

**How to apply:**
- When debugging, read the evidence first — the full error message and stack trace; most bugs name themselves in the first line. (Unknown-cause failures have their own procedure: `debug-fundamentals`.)
- Before adding a new utility, search for existing ones doing the same thing (LSP-first when available — `CLAUDE.md`). Adopt the project's conventions even if they aren't your favorite — consistency is a feature.
- Before changing a function, read its callers. The function's contract is what callers depend on, not what its docstring claims.
