# Hexagonal backend — TypeScript / Node examples

Runnable companions to `SKILL.md`. Read this when implementing the patterns in TypeScript; the concepts, the dependency rule, pitfalls, and the workflow live in `SKILL.md`. The Go equivalents are in [`go.md`](./go.md). These TypeScript examples **call the concrete use case** (no driving port); the Go set uses a driving port — both are correct (`SKILL.md > Two kinds of ports`).

## Folder structure

```
src/
  domain/
    order/
      order.ts                 # entity
      order-status.ts          # value object
      order-id.ts              # value object
      order-errors.ts          # domain errors
  application/
    ports/
      order-repository.ts      # driven port (interface)
      payment-gateway.ts       # driven port (interface)
      clock.ts                 # driven port — even time is a port
    use-cases/
      place-order.ts
      cancel-order.ts
  adapters/
    driving/                   # call INTO the application
      http/
        order-controller.ts          # HTTP driving adapter
    driven/                    # called BY the application through ports
      persistence/
        postgres-order-adapter.ts    # implements OrderRepository
      payment/
        stripe-payment-adapter.ts    # implements PaymentGateway
      clock/
        system-clock-adapter.ts      # implements Clock
  config/
    composition-root.ts        # wires concrete adapters into use cases
```

## Port definition (driven)

```ts
// application/ports/order-repository.ts
import type { Order, OrderId } from '../../domain/order/order'

export interface OrderRepository {
  save(order: Order): Promise<void>
  findById(id: OrderId): Promise<Order | null>
  findByCustomer(customerId: CustomerId): Promise<Order[]>
}
```

## Driven adapter — repository

Mapping lives in the adapter; the domain entity never carries storage tags.

```ts
// adapters/driven/persistence/postgres-order-adapter.ts
import type { Pool } from 'pg'
import type { OrderRepository } from '../../../application/ports/order-repository'
import { Order } from '../../../domain/order/order'

export class PostgresOrderAdapter implements OrderRepository {
  constructor(private readonly db: Pool) {}

  async save(order: Order): Promise<void> {
    await this.db.query(
      'INSERT INTO orders (id, status, total) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (id) DO UPDATE SET status = $2, total = $3',
      [order.id.value, order.status, order.total.amount],
    )
  }

  async findById(id: OrderId): Promise<Order | null> {
    const result = await this.db.query('SELECT * FROM orders WHERE id = $1', [id.value])
    if (result.rows.length === 0) return null
    return this.toDomain(result.rows[0])
  }

  private toDomain(row: OrderRow): Order {
    // Mapping lives in the adapter. `rehydrate` is a static factory that skips invariant checks (row is already valid).
    return Order.rehydrate({
      id: new OrderId(row.id),
      customerId: new CustomerId(row.customer_id),
      status: row.status as OrderStatus,
      total: new Money(row.total_amount, row.total_currency),
      placedAt: new Date(row.placed_at),
    })
  }
}
```

## Use case

```ts
// application/use-cases/place-order.ts
import { Order } from '../../domain/order/order'
import type { OrderRepository } from '../ports/order-repository'
import type { PaymentGateway } from '../ports/payment-gateway'

export interface PlaceOrderCommand {
  customerId: string
  items: Array<{ sku: string; qty: number }>
  paymentMethodId: string
}

export class PlaceOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly payments: PaymentGateway,
  ) {}

  async execute(cmd: PlaceOrderCommand): Promise<OrderId> {
    const order = Order.create(cmd)                              // domain logic
    await this.payments.charge(order.total, cmd.paymentMethodId) // driven port
    order.markPaid()
    await this.orders.save(order)                               // driven port
    return order.id
  }
}
```

## Driving adapter (HTTP controller)

```ts
// adapters/driving/http/order-controller.ts
export function orderRoutes(placeOrder: PlaceOrder) {
  return async (req: Request, res: Response) => {
    try {
      const id = await placeOrder.execute({
        customerId: req.body.customerId,
        items: req.body.items,
        paymentMethodId: req.body.paymentMethodId,
      })
      res.status(201).json({ orderId: id.value })
    } catch (e) {
      // translate domain errors → HTTP status. Translation lives here, not in use case.
      res.status(400).json({ error: e.message })
    }
  }
}
```

## Composition root

One place wires concrete adapters into use cases. Everywhere else, code receives ports through constructors.

```ts
// config/composition-root.ts
const db = new Pool({ /* ... */ })
const orderRepo = new PostgresOrderAdapter(db)
const payments = new StripePaymentAdapter(stripeClient)
const placeOrder = new PlaceOrder(orderRepo, payments)

app.post('/orders', orderRoutes(placeOrder))
```

## Transactions — Unit of Work port

Expose a transaction port; the use case hands it a function; the adapter runs that function in a transaction. The use case knows transactions exist; it doesn't know Postgres, Mongo sessions, or savepoints. (Isolation/locking mechanics: [[database-fundamentals]].)

```ts
// application/ports/unit-of-work.ts
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>
}

// application/use-cases/transfer-funds.ts
export class TransferFunds {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(cmd: TransferCommand): Promise<void> {
    await this.uow.run(async () => {
      const from = await this.accounts.findById(cmd.fromId)
      const to   = await this.accounts.findById(cmd.toId)
      from.debit(cmd.amount)        // domain logic
      to.credit(cmd.amount)
      await this.accounts.save(from)
      await this.accounts.save(to)
    })
  }
}
```

## Error translation at the driving edge

Keep this map in the driving adapter, not in the use case. The use case throws; HTTP decides the status.

```ts
// adapters/driving/http/error-handler.ts
export function toHttp(e: unknown): { status: number; body: object } {
  if (e instanceof InsufficientFundsError) return { status: 422, body: { code: 'INSUFFICIENT_FUNDS' } }
  if (e instanceof OrderNotFound)          return { status: 404, body: { code: 'NOT_FOUND' } }
  if (e instanceof Unauthorized)           return { status: 401, body: { code: 'UNAUTHORIZED' } }
  return { status: 500, body: { code: 'INTERNAL' } }
}
```

## Query port (CQRS read seam)

When the read path needs pagination, projections, joins, or aggregate stats, add a separate query port returning plain DTOs — don't bloat the write-shaped repository.

```ts
// application/ports/order-queries.ts
export interface OrderQueries {
  listByCustomer(customerId: CustomerId, page: Page): Promise<OrderSummaryDTO[]>
  searchAdminGrid(filter: AdminFilter): Promise<AdminOrderRow[]>
}
```

## Testing — in-memory fake

Replace ports with in-memory fakes for use-case tests (preferred over mocks).

```ts
// test/fakes/in-memory-order-repository.ts
export class InMemoryOrderRepository implements OrderRepository {
  private store = new Map<string, Order>()
  async save(o: Order) { this.store.set(o.id.value, o) }
  async findById(id: OrderId) { return this.store.get(id.value) ?? null }
}
```
