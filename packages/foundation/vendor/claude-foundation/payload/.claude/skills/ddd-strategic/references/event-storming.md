# Event Storming and domain discovery

## Principle 2 (from SKILL.md): Discover boundaries from events, not entities

**Rule:** When bounded contexts aren't yet known, find them by walking the domain's *events* — what happens, in what order, with what consequences — not by listing nouns. Run an Event Storming or Domain Storytelling workshop with domain experts present; contexts reveal themselves at seams where language and actors change.

**Why:** Entity-first design ("we have User, Order, Product, Invoice — draw boxes around each") produces god-objects because the same noun means different things to different parts of the business. Event-first design ("someone places an order → payment captured → inventory reserved → invoice issued") makes seams visible: the team that talks about "placing an order" is not the team that talks about "recognizing revenue."

**How to apply:**
- **Don't skip the workshop just because it sounds heavy.** A 3-hour Event Storming session with five domain experts and four engineers can save quarters of refactoring. Events become domain events, commands become use-case methods, policies become event handlers, read models become projections — the output is an executable plan.
- **Three flavors of Event Storming:** *Big Picture* (whole business line, find contexts), *Process Modelling* (one process end-to-end with commands, policies, and reactions), *Software Design* (zoom into one process, identify aggregates and contexts). Pick the flavor matching the question.
- **Domain Storytelling** is the lighter alternative — pictographic actor/work-object/activity diagrams via facilitator interview. Better for narrative cooperation flows; weaker for event-driven systems.
- **Boundary signals:** language changes ("order" until it ships, then "shipment"); actors change (sales hands off to operations); clock changes (real-time vs. nightly batch); hotspot pink stickies cluster.
- The output is a *list of candidate bounded contexts* plus events that cross them. Validate against principles 3–4 before cementing in code.
- See [[event-storming]] for the workshop format, sticky-color grammar, facilitation tips, and artifact-to-code mapping.

**Example:**
```
Wrong: team lists nouns: User, Order, Product, Invoice. Draws boxes, calls them services.
       Six months later, every feature touches User and Order because each noun means four
       things. The "model" is the source of friction.

Right: 3-hour Event Storming reveals: cart-built → payment-captured → order-confirmed →
       inventory-reserved → shipment-scheduled → invoice-issued → revenue-recognized.
       Natural seams: Checkout owns cart-to-confirmed; Fulfillment owns reserved-through-
       delivered; Finance owns invoice-and-revenue. Each has its own "order" concept. No god-object.
```

## Why event-first discovery

The temptation when modeling a new domain is to start with the nouns: "we have users, orders, products, invoices — let's draw boxes around each and call them services." This is the canonical path to god-objects, because the same noun means different things to different parts of the business. The `User` in Identity is not the `User` in Marketing is not the `User` in Support. A model trying to satisfy all three satisfies none, and every feature that touches `User` becomes a coordination problem across the whole company.

Event-first discovery inverts this. Instead of asking "what *are* the things?", you ask "what *happens*?" — and then "in what order?" and "who cares?". The verbs surface the seams: the team that talks about "placing an order" is not the team that talks about "recognizing revenue," and forcing them to share a model is forcing two teams to coordinate forever. The seams are the bounded contexts. The boundary goes exactly where the language and the actors change.

Event-first discovery also makes implicit knowledge **visible to everyone in the room** in a way pure noun-listing cannot. Domain experts who can't articulate "what the model should be" can absolutely list "what happens, in order, when a customer buys something" — and once that timeline is on the wall, the patterns and the seams become legible even to people who weren't in the original conversations.

## Event Storming: the three flavors

[Alberto Brandolini's Event Storming](https://www.eventstorming.com/) is the dominant discovery technique. It comes in three flavors, each answering a different question.

### Big Picture Event Storming

**Question it answers:** What does the whole business actually do? Where are the bounded contexts?

**Format:** 15–30 people, 3–4 hours minimum, ideally a full day. Multiple business lines or subdomains represented. The output is the **timeline of events** the business cares about — a single horizontal sequence from start of customer journey to end (and any parallel branches).

**Output:** A wall covered in orange domain-event stickies, in rough chronological order, with hotspots, actors, and external systems annotated. This is the artifact the team takes away — a photograph of the wall, transcribed into a digital tool if needed (Miro, Mural, draw.io, Figma).

**Use it when:** Designing a new system, splitting an existing system, onboarding new senior engineers, recovering from "we've lost the plot" symptoms, or whenever the org no longer agrees on what the system *does*.

### Process Modelling Event Storming

**Question it answers:** How does *this specific* business process actually work, end-to-end, with all the branches and edge cases?

**Format:** 5–10 people, 2–3 hours. One process (e.g., "from cart-built to payment-captured to order-confirmed"). Adds the full grammar: events, commands, policies, read models, external systems, actors.

**Output:** A detailed timeline of one process with the commands that drive events, the policies that fire reactions, and the read models actors consult.

**Use it when:** Designing or redesigning one specific business process, especially one that crosses multiple bounded contexts or has complex branching.

### Software Design Event Storming

**Question it answers:** How does this process map into aggregates and code?

**Format:** 3–6 people (mostly engineers + 1–2 domain experts). 1–2 hours. Zooms into one process or one part of one process. Adds aggregate boundaries and bounded contexts.

**Output:** Annotated process timeline with aggregate groupings — "these events + these commands + these state changes belong to one aggregate" — and bounded-context boundaries.

**Use it when:** About to write code for a process you've already modeled (or that's already understood). The output maps almost line-for-line to code (see "Mapping workshop output to code" below).

## The sticky-color grammar

Brandolini's color convention is unusual but well-defended: each color is a different kind of thing, and the visual contrast makes the grammar legible at a glance, across the room.

| Color | Element | Meaning |
|---|---|---|
| **Orange** | Domain event | A thing that *happened* in the past tense. `OrderPlaced`, `PaymentCaptured`, `ShipmentDispatched`. The events drive the timeline. |
| **Blue** | Command | A user or system intent that *causes* an event. `PlaceOrder`, `CapturePayment`, `DispatchShipment`. Present tense, imperative. |
| **Yellow (small)** | Actor / role | Who issues a command or reads a model. `Customer`, `Underwriter`, `Fulfillment Operator`. |
| **Pink** | Hot spot | An area of disagreement, ambiguity, or unsolved problem. "We've never actually agreed how returns work." Hotspots are gold — they reveal the parts of the domain that need attention. |
| **Lilac / Light purple** | Policy / reaction | "Whenever X event happens, Y command fires." `OrderPlaced → ReservedInventory`. Captures automation and business rules. |
| **Green** | Read model / view | The information an actor needs to make a decision. `OrderSummary` shown to `Customer`. `RiskDashboard` shown to `Underwriter`. |
| **Yellow (large) or other** | External system | Third-party services, legacy systems, vendor APIs. Marked at the edge of the wall. |
| **Aggregate** | (drawn around events + commands) | A cluster of events + commands that share a consistency boundary. Drawn at the Software Design stage. |
| **Bounded context** | (drawn around aggregates + read models) | A region of the wall with shared language. Drawn at the Software Design or Big Picture stage. |

The colors aren't arbitrary; the assignment is designed so that orange (events) dominate the visual field — they're the heartbeat of the domain. Other colors annotate around them.

## Facilitation: how a session actually runs

A first-time Event Storming participant often asks "what do I write?" The answer: nothing, initially — you write *down what already happens*, you don't *design* it. Run order:

### 1. Set up the space

- A long wall, ideally 6+ meters. (A digital wall in Miro / Mural is workable but loses some of the visceral energy of physical stickies. Use physical for first-time sessions if at all possible.)
- Orange stickies in abundance — far more than seems reasonable. (Brandolini's heuristic: bring 10x what you think you need.)
- Other colors available but not handed out yet — the first phase is events-only.

### 2. Chaotic exploration

The facilitator gives one instruction: "write down everything that happens in the business, one event per orange sticky, past tense. Don't worry about order or duplicates. Put them on the wall as you go."

For 30–60 minutes, the room writes events. Quiet at first, then accelerating. Duplicates are *encouraged* at this stage — duplicates reveal which events the team thinks about most.

### 3. Enforce the timeline

The facilitator says: "OK, now arrange these in chronological order, left to right. If two events happen in parallel, stack them vertically. If the same event appears multiple times, consolidate."

The wall reorganises. Conversations break out at the boundaries — "wait, does payment happen before or after inventory reservation?" These conversations are the *entire point* of the workshop. The facilitator's job is to keep them productive, not to answer them — usually a domain expert will answer, and if no one can, that's a pink hot spot.

### 4. Add hotspots

Pink stickies go up wherever the room had a disagreement, an unknown, or a "we've never decided" moment. Don't try to resolve hotspots in the workshop — *capture them*. Resolving them is a follow-up activity, often with subject-matter experts not in the room.

### 5. Add actors, commands, policies, read models (Process Modelling stage)

Once the event timeline is stable, the additional grammar comes in. Blue commands go *next to* the events they cause. Yellow small actors go next to the commands. Lilac policies go between events ("whenever X, then Y is commanded"). Green read models go next to the actors that consult them.

The grammar reveals two things: *automation* (the policies) and *user experience* (the read models + actors). Both are first-class.

### 6. Add aggregates and bounded contexts (Software Design stage)

Draw boundaries around clusters that share a consistency rule (aggregate) or share a language (bounded context). The boundaries are tentative — they're a starting point for code, not a final design.

### 7. Take a photograph

The artifact is the wall. Photograph it from multiple angles. Transcribe to a digital tool if needed for future reference. The wall *will* come down; the digital version is the durable artifact.

### Facilitation tips

- **No laptops** during chaotic exploration. The energy is the point; people typing kills the energy.
- **No hierarchy.** The most senior person in the room writes the same number of stickies as the most junior. Senior people often have outdated views of how things actually work; juniors and operations people often have current views.
- **Disagreement is a feature, not a bug.** If everyone agrees, you're probably listing what people *think* happens, not what *does* happen. Pink stickies are gold.
- **Don't argue about wording.** "Was it `OrderPlaced` or `OrderSubmitted`?" — pick one, write both on the sticky if needed, move on. Resolve naming during glossary-building (principle 3), not during Event Storming.

## Reading the wall: how to interpret what you see

After a good Event Storming session, the wall has structure you can read:

- **Dense clusters of events** are the heart of a bounded context. Those areas have rich domain logic; they deserve careful design.
- **Sparse stretches** between clusters are often the seams *between* bounded contexts — places where events fire but few do, often crossing a context boundary.
- **Policies that fan out widely** (one event triggering many reactions across the wall) often indicate cross-context integration points and are candidates for *integration events* (principle 6) rather than internal domain events.
- **Hotspots clustered in one area** indicate the team doesn't yet know how that part of the domain works. Resolve hotspots before writing code for that area.
- **Read models that span multiple actor types** ("the dashboard shown to both customers and operators") often indicate either a missing context split or a deliberate published-language read model.
- **Events that no actor reads** are suspect — either the event doesn't matter (delete it), or the actor exists but wasn't represented in the room (find them and invite them).

## Mapping workshop output to code

The mapping from a Software Design Event Storming wall to code is almost mechanical. This is where the workshop pays back its investment.

| Workshop element | Code element |
|---|---|
| **Domain event** (orange) | A class/record in the domain layer: `OrderPlaced { orderId, customerId, items, total, occurredAt }`. Emitted by an aggregate. |
| **Command** (blue) | A method on an aggregate or a use case in the application layer: `Order.place(items, customer)` or `PlaceOrderUseCase.execute(input)`. |
| **Policy** (lilac) | An event handler in the application layer: `OnOrderPlaced.handle(event)` that issues the next command. |
| **Read model** (green) | A projection (a denormalised view, often in a separate table or cache): `OrderSummary` populated by listening to relevant events. |
| **Actor** (yellow small) | A role used in authorization and routing, not usually a class — a `Role` enum or RBAC concept. |
| **Aggregate** (boundary drawn around events + commands) | An aggregate class with its root entity, value-typed properties, and command methods that emit the events. Sized per Vernon's four rules ([[aggregate-design]]). |
| **Bounded context** (boundary drawn around aggregates + read models) | A module, package, or service — see [[bounded-contexts]] on the distinction. |
| **Hot spot** (pink) | A TODO for follow-up — *do not* code your way around it. Resolve the ambiguity first. |
| **External system** | An anticorruption layer or adapter at the edge of your bounded context. |

This mapping is one of the most useful properties of Event Storming: the workshop output is *executable plan*, not abstract whiteboard art. The engineer leaves the workshop with a concrete list of classes, methods, events, and handlers to write — already aligned with the domain experts in the room.

## Domain Storytelling as alternative

[Domain Storytelling](https://domainstorytelling.org/) (Stefan Hofer and Henning Schwentner) is a lighter, narrative-driven discovery technique. Instead of events on a timeline, it uses **pictographs** — actors, work objects, and activities drawn in sequence, narrating a specific scenario from start to finish.

```
            does
[Customer] ──────▶ (looks at) ──▶ [Product]
   │
   │ adds
   ▼
[Cart] ─── shows ──▶ [Order Summary]
   │
   │ pays
   ▼
[Payment Processor] ─── confirms ──▶ [Order Confirmation]
```

Format: 1 facilitator + 1–3 domain experts + 1–3 engineers. 1–2 hours. The facilitator interviews the domain expert about a specific scenario; the engineers translate the narrative into the pictographic notation in real time, projected for everyone to see.

**Use Domain Storytelling instead of Event Storming when:**

- The domain is **narrative and cooperation-heavy**, not event-driven. ("How does our team actually take a customer from inquiry to onboarding?" — lots of human handoffs, not so many discrete events.)
- The team is **small** and a full Event Storming session would be overkill.
- The domain experts are **not comfortable with the stickies-and-walls format** (some senior domain experts find it too informal; the more structured interview format of Domain Storytelling is more accessible).
- You need to **capture variations** — Domain Storytelling makes it easy to walk through "the normal case" and then "the case where the credit check fails" and then "the case where it's a returning customer" as separate but related stories.

**Use Event Storming instead of Domain Storytelling when:**

- The domain is **event-driven** (anything with state machines, async flows, scheduled events, regulatory deadlines).
- You need to discover **bounded contexts** across a complex multi-team system. Event Storming's wall-of-events surfaces seams better than narrative storytelling does.
- You have **many domain experts** in the room and want to surface disagreements (Event Storming's hotspots are great for this; Domain Storytelling's narrative format tends to follow one story at a time).

The two techniques are complementary, not exclusive. Many teams use Big Picture Event Storming first (to find contexts) and Domain Storytelling later (to walk through specific scenarios within a context).

## Pitfalls and when to skip the workshop

**Pitfalls:**

- **Skipping domain experts.** Event Storming with only engineers in the room produces *engineers' guesses* about what happens, not what actually happens. The whole technique depends on domain experts. If you can't get them in the room, you cannot do Event Storming — fall back to reading the existing code and tickets, and accept you're working with a model of unknown accuracy.
- **Confusing "events we'd like to happen" with "events that happen now."** Big Picture Event Storming maps the *current* state of the business. Mixing in aspirational future events confuses the wall. (Plan future-state in a follow-up session, explicitly marked.)
- **Treating the output as final.** The workshop output is a *starting point*. The aggregate boundaries, the bounded contexts, the events themselves — all of these will refine as you implement. Don't promote the wall to specification.
- **Death by sticky.** A wall with 800 stickies is a wall no one will read. Consolidate aggressively at the end of the session; aim for under 200 events on the final wall.
- **Resolving hotspots in the workshop.** Pink stickies are *captured* in the session, not resolved. Trying to resolve them in real time turns the workshop into a debate club. Capture, move on, resolve later with the right people.

**When to skip the workshop entirely:**

- **Generic subdomains.** No workshop needed — buy the off-the-shelf solution.
- **Trivial supporting subdomains.** A 5-table admin tool doesn't earn the workshop cost.
- **Domains you already understand well.** A 10-year veteran of insurance underwriting building yet another insurance system probably doesn't need the discovery; they need the domain experts to ratify the model they already have in their head.
- **Throwaway prototypes.** Same as above — the workshop investment is for production systems.

For **anything else** with real domain complexity and accessible domain experts, a half-day Event Storming session is one of the highest ROI activities available. The wall hangs there for the rest of the project, photographable, referenceable, and the team that built it shares a vocabulary that no amount of documentation could otherwise produce.
