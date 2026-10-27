---
name: hexagonal-backend
description: Structure one backend service with ports and adapters when business logic must remain independent of frameworks, storage, brokers, or external APIs. Use for dependency direction, use-case ownership, driving/driven ports, boundary mapping, and layer-focused tests. Skip trivial CRUD with no domain policy or replacement/test-isolation pressure.
---

# Hexagonal backend

Use this as the primary skill when the difficult decision is dependency
direction or use-case ownership.

## Boundary

```text
driving adapter → application port/use case → domain
                                      ↓
                                driven port
                                      ↓
                                driven adapter
```

- Domain contains business state, rules, and domain errors. It imports no
  framework, transport, ORM, or vendor client.
- Application coordinates one use case, transaction boundary, authorization
  decision, and driven ports.
- Infrastructure translates HTTP/messages/storage/vendors to and from ports.
- Driving ports describe what the application offers. Driven ports describe
  what it needs.

## Rules

1. Dependencies point inward; adapters depend on ports, never the reverse.
2. Define a port at the consumer boundary and keep it as small as the use case.
3. Do not leak ORM, HTTP, broker, or vendor types through ports.
4. Map persistence and transport models explicitly when their lifecycle or
   constraints differ from the domain.
5. Test domain rules directly, application behavior with fake driven ports, and
   adapters with focused integration tests.
6. Keep cross-cutting concerns at the correct boundary: authentication in the
   adapter, authorization/policy in the application/domain, observability around
   use-case and adapter calls.

Use a simpler vertical slice for truly trivial CRUD; introduce ports where
policy, replacement risk, or test isolation justifies them.

Record only consequential dependency or transaction-boundary decisions in the
active OpenSpec design. Do not create a parallel architecture document or add
ports solely to satisfy a diagram; executable tests at domain/use-case/adapter
seams provide the evidence.

References: `references/typescript.md`, `go.md`, and
`patterns-and-pitfalls.md`. Read only the language/pattern needed.
