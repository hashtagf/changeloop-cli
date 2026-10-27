# Hexagonal backend — Go examples (`core` / `port` / `adapter` idiom)

Runnable companions to `SKILL.md`. Read this when implementing the patterns in Go; the concepts, the dependency rule, pitfalls, and the workflow live in `SKILL.md`. The TypeScript equivalents are in [`typescript.md`](./typescript.md).

Go uses the community `core/ port/ adapter/` idiom (all ports in one `core/port` package). Same logical rule as the TS layout, different names — the physical layout is a style choice (`SKILL.md > Relation to Vertical Slice Architecture`). These Go examples **use a driving port** (`port.OrderService`); the TS set calls the concrete use case — both are correct (`SKILL.md > Two kinds of ports`).

## Folder structure

```
_cmd/
  main.go                      # entrypoint = composition root (wires everything)
internal/
  core/                        # the hexagon — never imports anything under adapter/
    domain/
      order.go                 # rich entity + value objects + domain errors (no tags, no infra)
    port/
      order.go                 # driving port (OrderService) + driven ports (OrderRepository, PaymentGateway)
      mock/                    # generated test doubles (optional — see Testing strategy)
    service/
      order.go                 # use case — implements the driving port
      order_test.go
  adapter/
    config/
      config.go                # env → typed config container
    handler/                   # DRIVING adapters (call INTO the application)
      http/order.go            #   depends on port.OrderService
      amqp/order.go            #   queue subscriber — also a driving adapter
    storage/                   # DRIVEN adapters (called BY the application via ports)
      postgres/
        order_repository.go    #   implements port.OrderRepository, maps model ↔ domain
    payment/
      stripe.go                #   implements port.PaymentGateway
  util/                        # cross-cutting helpers (errors, mapping)
```

## Domain entity

The hexagonal point: the domain entity carries **no** `json`/`bson` tags or infra imports — it hides its fields and changes state only through invariant-protecting methods, while the adapter's model carries the storage shape. (Aggregate boundaries and how rich the entity should be: [[ddd-strategic]].)

```go
// internal/core/domain/order.go
package domain

import "errors"

// Domain errors live next to the entity, in business language — no HTTP status, no SQL codes.
var (
    ErrEmptyOrder        = errors.New("order has no line items")
    ErrInsufficientFunds = errors.New("insufficient funds")
    ErrOrderNotFound     = errors.New("order not found")
)

type (
    OrderID     string
    CustomerID  string
    OrderStatus string
)

const (
    StatusPending OrderStatus = "pending"
    StatusPaid    OrderStatus = "paid"
)

// Order is a RICH entity: unexported fields, state changes only via invariant-
// enforcing methods. No json/bson tags or infra imports (the adapter's model carries those).
type Order struct {
    id         OrderID
    customerID CustomerID
    status     OrderStatus
    total      Money
}

// NewOrder is the only way to build a valid new order; it enforces invariants.
func NewOrder(customerID string, items []LineItem) (*Order, error) {
    if len(items) == 0 {
        return nil, ErrEmptyOrder
    }
    return &Order{OrderID(newID()), CustomerID(customerID), StatusPending, sum(items)}, nil
}

func (o *Order) MarkPaid()              { o.status = StatusPaid } // behavior, not a setter
func (o *Order) ID() OrderID            { return o.id }
func (o *Order) CustomerID() CustomerID { return o.customerID }
func (o *Order) Status() OrderStatus    { return o.status }
func (o *Order) Total() Money           { return o.total }

// RehydrateOrder rebuilds from already-valid storage state, skipping invariant
// checks. Adapters use this; application code always goes through NewOrder.
func RehydrateOrder(id OrderID, c CustomerID, s OrderStatus, total Money) *Order {
    return &Order{id, c, s, total}
}

// Money/LineItem value objects, newID(), and sum() elided for brevity.
```

## Port definition

All ports — driving and driven — live in one `core/port` package, so the dependency arrows are visible in one place.

```go
// internal/core/port/order.go
package port

import (
    "context"

    "myapp/internal/core/domain"
)

// PlaceOrderCommand is part of the driving-port contract — lives here, not in service (avoids an import cycle).
type PlaceOrderCommand struct {
    CustomerID      string
    Items           []domain.LineItem
    PaymentMethodID string
}

// Driving (primary) port — the use-case surface. Driving adapters depend on THIS, not the concrete service.
type OrderService interface {
    PlaceOrder(ctx context.Context, cmd PlaceOrderCommand) (domain.OrderID, error)
}

// Driven (secondary) ports — what the app needs; driven adapters implement them. Keep narrow (ISP).
type OrderRepository interface {
    Save(ctx context.Context, o *domain.Order) error
    FindByID(ctx context.Context, id domain.OrderID) (*domain.Order, error)
}

type PaymentGateway interface {
    Charge(ctx context.Context, amount domain.Money, methodID string) error
}
```

## Driven adapter — repository

The repository implements a driven port and owns the **persistence model** plus mapping to/from the domain — so storage tags and column types never leak into `core/domain`.

```go
// internal/adapter/storage/postgres/order_repository.go
package postgres

import (
    "context"
    "database/sql"
    "errors"

    "myapp/internal/core/domain"
    "myapp/internal/core/port"
)

// Compile-time check we satisfy the driven port — breaks at build, not runtime.
var _ port.OrderRepository = (*OrderRepository)(nil)

type OrderRepository struct {
    db *sql.DB
}

func NewOrderRepository(db *sql.DB) *OrderRepository {
    return &OrderRepository{db: db}
}

func (r *OrderRepository) Save(ctx context.Context, o *domain.Order) error {
    _, err := r.db.ExecContext(ctx, `
        INSERT INTO orders (id, customer_id, status, total_amount, total_currency)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
          SET status = EXCLUDED.status,
              total_amount = EXCLUDED.total_amount`,
        o.ID().String(), o.CustomerID().String(), o.Status(),
        o.Total().Amount(), o.Total().Currency(),
    )
    return err
}

func (r *OrderRepository) FindByID(ctx context.Context, id domain.OrderID) (*domain.Order, error) {
    var m orderModel
    err := r.db.QueryRowContext(ctx,
        `SELECT id, customer_id, status, total_amount, total_currency
         FROM orders WHERE id = $1`, id.String(),
    ).Scan(&m.id, &m.customerID, &m.status, &m.amount, &m.currency)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }
    return m.toDomain(), nil
}

// orderModel is the PERSISTENCE model — shape follows the table, stays in the adapter.
// Bigger projects give it its own `model/` sub-package.
type orderModel struct {
    id, customerID, status, currency string
    amount                           int64
}

func (m orderModel) toDomain() *domain.Order {
    // RehydrateOrder skips invariant checks — storage holds already-valid state.
    return domain.RehydrateOrder(
        domain.OrderID(m.id),
        domain.CustomerID(m.customerID),
        domain.OrderStatus(m.status),
        domain.NewMoney(m.amount, m.currency),
    )
}
```

## Use case / service

The service implements the **driving** port and depends only on **driven** ports, never on a concrete adapter.

```go
// internal/core/service/order.go
package service

import (
    "context"

    "myapp/internal/core/domain"
    "myapp/internal/core/port"
)

// Compile-time proof the service satisfies the driving port.
var _ port.OrderService = (*OrderService)(nil)

type OrderService struct {
    orders   port.OrderRepository
    payments port.PaymentGateway
}

func NewOrderService(o port.OrderRepository, p port.PaymentGateway) *OrderService {
    return &OrderService{orders: o, payments: p}
}

func (s *OrderService) PlaceOrder(ctx context.Context, cmd port.PlaceOrderCommand) (domain.OrderID, error) {
    o, err := domain.NewOrder(cmd.CustomerID, cmd.Items)   // domain logic + invariants
    if err != nil {
        return "", err
    }
    if err := s.payments.Charge(ctx, o.Total(), cmd.PaymentMethodID); err != nil {
        return "", err                                     // driven port
    }
    o.MarkPaid()                                           // domain logic
    if err := s.orders.Save(ctx, o); err != nil {
        return "", err                                     // driven port
    }
    return o.ID(), nil
}
```

## Driving adapter (HTTP handler)

The handler depends on `port.OrderService`, so HTTP, a queue subscriber, or a cron job can drive the same use case.

```go
// internal/adapter/handler/http/order.go
package http

import (
    "encoding/json"
    "errors"
    "net/http"

    "myapp/internal/core/domain"
    "myapp/internal/core/port"
)

type OrderHandler struct {
    orders port.OrderService // the DRIVING port, not the concrete service
}

func NewOrderHandler(orders port.OrderService) *OrderHandler {
    return &OrderHandler{orders: orders}
}

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
    // Decode into a wire-shape struct, NOT into domain types — JSON tags and the
    // request format stay in the adapter (see the persistence/wire-model pitfall).
    var body struct {
        CustomerID string `json:"customerId"`
        Items      []struct {
            SKU string `json:"sku"`
            Qty int    `json:"qty"`
        } `json:"items"`
        PaymentMethodID string `json:"paymentMethodId"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }
    items := make([]domain.LineItem, len(body.Items)) // map wire shape → domain
    for i, it := range body.Items {
        items[i] = domain.NewLineItem(it.SKU, it.Qty)
    }
    id, err := h.orders.PlaceOrder(r.Context(), port.PlaceOrderCommand{
        CustomerID:      body.CustomerID,
        Items:           items,
        PaymentMethodID: body.PaymentMethodID,
    })
    if err != nil {
        writeError(w, err) // domain/app error → HTTP status, mapping lives here
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    _ = json.NewEncoder(w).Encode(map[string]string{"orderId": id.String()})
}

func writeError(w http.ResponseWriter, err error) {
    switch {
    case errors.Is(err, domain.ErrOrderNotFound):
        http.Error(w, "not found", http.StatusNotFound)
    case errors.Is(err, domain.ErrInsufficientFunds):
        http.Error(w, "insufficient funds", http.StatusUnprocessableEntity)
    default:
        http.Error(w, "internal error", http.StatusInternalServerError)
    }
}
```

## Composition root

```go
// _cmd/main.go — entrypoint = composition root
package main

import (
    "database/sql"
    "log"
    "net/http"

    _ "github.com/lib/pq"
    "myapp/internal/adapter/handler/amqp"
    httpadapter "myapp/internal/adapter/handler/http"
    "myapp/internal/adapter/payment/stripe"
    "myapp/internal/adapter/storage/postgres"
    "myapp/internal/core/service"
)

func main() {
    db, err := sql.Open("postgres", "...")
    if err != nil {
        log.Fatal(err)
    }

    // ## driven adapters — implement driven ports ##
    orderRepo := postgres.NewOrderRepository(db)
    payments := stripe.NewPaymentGateway( /* stripe client */ )

    // ## application — one service satisfies port.OrderService ##
    orders := service.NewOrderService(orderRepo, payments)

    // ## driving adapters — both depend on the SAME driving port ##
    go amqp.NewOrderSubscriber(orders).Start() // async: consume "order.requested"
    h := httpadapter.NewOrderHandler(orders)    // sync:  POST /orders
    http.HandleFunc("/orders", h.Create)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

## Testing — fakes vs generated mocks

In Go, the in-memory fake (the TS example in [`typescript.md`](./typescript.md)) is a struct backed by a `map` — no codegen. Generated mocks (`go.uber.org/mock`/gomock under `core/port/mock/`) with table-driven tests give the same isolation but treat them as a **secondary** style; a hand-written fake stays reusable without a generator step.
