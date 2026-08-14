# Module design: deep abstractions and information hiding

Use this reference when deciding how code inside one process should be grouped,
what a module should expose, or whether another layer improves the design.

## Core rule

Design a module so its interface is substantially simpler than the complexity
it contains. Judge depth by the ratio between capability hidden and knowledge
required from callers—not by file size, method count, or nesting depth.

A deep module:

- owns one coherent body of policy or mechanism;
- exposes the smallest useful vocabulary for that responsibility;
- keeps representation, sequencing, defaults, and dependency details private;
- prevents its decisions from being repeated by callers; and
- can change internally without forcing unrelated callers to change.

A shallow module adds a name or layer but leaves callers responsible for most
of the underlying complexity.

## Design procedure

1. **Name the hidden complexity.** State the policy, mechanism, invariant, or
   workflow that the module will own. Do not introduce a module merely to move
   lines into another file.
2. **Design from the caller inward.** List what callers need to accomplish, then
   expose operations in domain language. Avoid mirroring an internal library,
   table, protocol, or multi-step algorithm.
3. **Pull decisions behind the boundary.** Keep ordering, retries, caching,
   parsing, validation, representation, and sensible defaults inside when they
   belong to the module's responsibility.
4. **Concentrate shared knowledge.** If several modules know the same format,
   invariant, or sequencing rule, move that knowledge to one owner instead of
   synchronizing copies.
5. **Test the abstraction.** Change an internal decision mentally. If callers
   must change despite requesting the same behavior, the interface leaks that
   decision.
6. **Remove layers that add no leverage.** Collapse wrappers whose methods only
   forward arguments, rename calls, or expose the wrapped dependency unchanged.

## Cohesion over smallness

Treat “one responsibility” as one coherent reason to change, not one operation
per class or a fixed line-count limit. Keep related behavior together when
splitting it would make callers coordinate pieces or understand an internal
sequence. Split a module when it contains independent policies that change for
different reasons or serves unrelated caller groups.

Do not use deep modules to justify god objects. A large module with an unrelated
grab bag of capabilities has a broad interface and low cohesion even if its
implementation is complicated.

## Warning signs

- Callers must invoke several methods in a precise order for one outcome.
- Many callers pass the same configuration or dependency details through.
- A wrapper repeats nearly every method of the object it wraps.
- The same invariant, encoding, or policy appears in several modules.
- Public types expose storage, framework, vendor, or wire representations.
- A feature change requires edits across many otherwise unrelated files.
- Modules are divided by execution time (`load`, `process`, `save`) although the
  stages jointly implement one responsibility.
- Generic names such as `Manager`, `Helper`, `Context`, or `Utils` conceal a
  collection of unrelated responsibilities.

## Example

```ts
// Shallow: callers still know storage keys, serialization, TTL, and sequencing.
class CacheWrapper {
  get(key: string) { return redis.get(key) }
  set(key: string, value: string, ttl: number) {
    return redis.set(key, value, { EX: ttl })
  }
}

// Deeper: the module owns the caching policy and representation.
class ProductCatalog {
  async product(productId: ProductId): Promise<Product> {
    // key format, serialization, TTL, miss handling, and storage stay private
  }
}
```

The second interface asks for the caller's outcome and hides decisions that
would otherwise spread through the codebase.

## Boundary with adjacent skills

- Use `hexagonal-backend` when the decision is dependency direction between
  domain, application, ports, and adapters.
- Use `architecture-fundamentals` when the boundary crosses a process, service,
  deployment, or runtime failure domain.
- Use `ddd-strategic` when the uncertainty is business language, ownership, or
  bounded contexts.
- Use `refactoring-fundamentals` when moving existing behavior toward a deeper
  module while preserving behavior.

## Review checklist

- Can a caller explain the interface without explaining the implementation?
- Does the module own a coherent decision rather than a lifecycle stage?
- Are defaults and common-case policy inside the module?
- Are representation and third-party types kept behind the boundary?
- Does the interface prevent invalid call ordering where practical?
- Would an internal implementation change leave most callers untouched?
- Does every extra layer hide complexity, enforce policy, or isolate volatility?
