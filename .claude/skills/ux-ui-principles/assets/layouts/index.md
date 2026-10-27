# Layout example library

40 original, task-based blueprints. These are this skill's project examples, not
research findings, finished visual designs, or evidence that a layout increases
conversion. Choose by task and context; adapt to actual users, content and constraints.

External inspiration: [OpenDesign reference catalogue](opendesign.md) maps
16 site references and 8 prototype/template references to these layout IDs.
It records inspection depth and source limitations; external references are
not counted as additional original blueprints.

## Select and adapt

1. Identify the primary task: learn, choose, transact, monitor, manage, create or recover.
2. Read one relevant category, then select one base layout. Consult a second layout
   only if the user task actually combines them; avoid assembling every pattern together.
3. Explain the match and important tradeoff. Prefer a simpler variant when complexity
   does not serve the task; reuse the project's established shell and design system.
4. Replace placeholder nouns with real content. Specify wide/compact behavior,
   applicable states, focus/keyboard contracts and one recovery path.
5. Review against [the shared specification](specification.md), then verify the
   rendered task if implementation is requested. A blueprint is not a tested screen.

For paired usage and misuse checks, read [Do / Don't examples](../../references/do-and-dont.md).
Reuse relevant examples when adapting these layouts; their presence does not certify a screen.

## Browse by task

| Category | Examples | Guide |
|---|---|---|
| Marketing and public services | Product landing; Service overview; Pricing comparison; Campaign landing; Help or contact hub | [M01–M05](marketing.md) |
| Commerce and transactions | Product listing; Product detail; Cart review; Checkout; Booking | [C01–C05](commerce.md) |
| Dashboards and analysis | Operational overview; Analytical exploration; Finance reporting; Monitoring incidents; Comparison workspace | [D01–D05](dashboards.md) |
| Administration and back office | Record management; Record detail; Approval workbench; Access management; Import wizard | [A01–A05](admin.md) |
| Content, learning and discovery | Article or documentation; Knowledge base; Search results; Course learning; Community discussion | [E01–E05](content.md) |
| Productivity and collaboration | Inbox master-detail; Kanban board; Calendar workspace; Document editor; Collaboration workspace | [P01–P05](productivity.md) |
| Accounts, onboarding and settings | Sign-in and recovery; Setup onboarding; Profile settings; Security settings; Subscription management | [U01–U05](accounts.md) |
| Mobile-first tasks and services | Mobile task home; Mobile detail and action; Appointment self-service; Location search; Upload or capture | [B01–B05](mobile.md) |

## Choose between close alternatives

| User need | Start here | Adaptation |
|---|---|---|
| Learn about one offering | M01 / M02 | Commercial proposition vs eligibility/preparation |
| Compare alternatives | M03 / C01 / D05 | Plans vs products vs aligned record/metric comparison |
| Complete a transaction | C04 / C05 | Payment outcome vs scarce appointment availability |
| Monitor exceptions | D01 / D04 | Operating decisions vs incident ownership/timeline |
| Act on records | A01 / A03 | General management vs consequential approval |
| Find content | E02 / E03 | Topic entry point vs query results |
| Continue frequent work | P01 / P02 | Queue triage vs stage-based workflow |
| Prepare or recover access | U01 / U02 | Authentication/recovery vs initial setup |
| Perform a short mobile action | B02 / B05 | Object action vs file capture/upload |

## Worked examples

[Three Thai worked specifications](worked-examples.md) show how to turn a template
into an implementation-ready proposal: checkout, record management, and service booking.
Read them for deliverable depth, not as mandatory domain assumptions.

## Add another example

Use the structure in each category file: ID, task, wide wireframe, compact behavior,
states, avoidance/tradeoff, acceptance example and customization. Add the entry here.
Mark new material as a project example; cite research separately if making an external
claim. Add a unique ID and prefer a meaningfully different user task over cosmetic variants.
