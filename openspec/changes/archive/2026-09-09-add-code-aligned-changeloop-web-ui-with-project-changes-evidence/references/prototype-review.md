# Investigation and document reader prototype — selected for Change update

The user requested updating the active Change to this revision on 2026-09-09. This artifact records prototype behavior; the compiled Change documents own the implementation agreement. The previously selected view is preserved in before-investigations.html; selection.md records that earlier selection.

## What to try

1. Changes → Investigations: five saved repository notes; open ChangeLoop ใน Web UI and browse its actual sections.
2. Follow the explicit reference to the active Change; inspect Overview, Documents, Tasks, Evidence and Usage.
3. Tasks → Read planned test cases in Design opens the existing 34-case matrix.
4. Data sources shows field-to-source mapping and labels the proposed investigation/document API additions.
5. Continue investigation / Draft change opens an editable session draft with the existing Changeloop logo. Send is simulated only.
6. Archived shows all 12 captured historical records, including independent recorded proof and freshness values.

## Data and limits

Captured local Foundation schema-3 projection: snapshot.json (owner/email/remote identity removed). data.js combines that capture with five investigation Markdown files and 66 documents across thirteen matching changes. UI has a captured timestamp and does not refresh server state. Home session examples remain illustrative. Investigation note modification time is filesystem time, not a workflow timestamp; prose remains historical as written. No inferred investigate running/completed status or conversion state is shown. Only exact document links associate a note with a Change. Missing explicit references do not prove no related work exists.

Current snapshot provides lifecycle, evidence, budgets and run metadata. Investigation indexing and bounded document reading require new Web UI API work; this prototype is not evidence those endpoints exist. The simple local Markdown reader displays references as text, with direct navigation provided for captured documents and explicitly linked notes; it is not a production Markdown renderer. No lifecycle operation executes.

Source layout remains grounded in the existing Home grid (1080px / 280px / 32px gap), V2 tokens/components and original session composer geometry. New reader and task views are proposed additions.
