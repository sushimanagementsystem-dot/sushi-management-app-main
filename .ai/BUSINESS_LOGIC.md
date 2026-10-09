# BUSINESS_LOGIC.md

## Production engine (`src/production-engine/`)

- `production-engine.service.ts` — computes production plans from stock/demand data (par levels,
  recipes, components — see `ProductionPar`/`RecipeComponent`/`Component` models).
- `secondary-allocation.service.ts` — secondary-item allocation (e.g. rice), ported from the
  legacy `engine/EngineSecondaryAllocation.js`.
- `production-email.service.ts` — emails the computed plan (via `mailer/`).
- `invoice-ai.service.ts` + `anthropic-config.service.ts` — AI-assisted invoice line-item
  extraction, see `INTEGRATIONS.md`.

## Purchasing automation (`src/purchasing/`)

`purchasing-scan.service.ts` triggers itself automatically after a stocktake is confirmed
(confirmed from `final_changes_plan.md`'s description: "triggers itself after stocktake
confirmation, emails the owner only, builds its own clean order-sheet `.xlsx`"). Shortfall math
compares current stock balance against par levels; `purchasing-order-email.ts` sends the result.

- **Ambient duplicate counting** (`StockItem.ambient_duplicate_of`, per `final_changes_plan.md`
  item 2): an item physically counted in two places (kiosk + another area) has its current
  balance computed as its own `stockBalanceAsOf` **plus** every duplicate's — handled in
  `purchasing-trigger.util.ts`, no special-casing needed in Stocktake/Food Waste forms.
- **Per-supplier fixed-order-quantity override** (`SupplierItemMap.fixed_order_qty`): generalized
  off a prior hardcoded `castlebayPacksOverride(supplierName)` function — now a per-mapping
  field, blank = normal shortfall math (per `final_changes_plan.md` item 3).
- **Measurement-type split** (`StockItem.measurement_type`: `WEIGHT_G` | `COUNT`): Food Waste
  branches on this — `WEIGHT_G` costs by grams × `cost_per_100g`, `COUNT` costs by whole units ×
  `current_unit_cost` (`pipeline/processors/food-waste.processor.ts`, per
  `final_changes_plan.md` item 1). Confirmed live bug fixed by this work: `cost_per_100g` was
  blank on all 136 stock items at the time, meaning every Food Waste submission had been
  silently uncosted until the import/reconciliation script ran.

## Generic Data Tables engine (`dashboard/data-tables/`)

Not one hand-built table/page per entity — `TableSchema`/`FieldSchema` rows describe every other
table's columns, types (`text | integer | decimal | money | boolean | date | enum | reference |
sub_table`), and enum sources at runtime. `bootstrap_data_table`/`bootstrap_tables_page`-style
calls return schema + rows + every referenced table/enum in one call (per root `CLAUDE.md`,
confirmed structurally by the `TableSchema`/`FieldSchema` models existing). Extending an entity
usually means adding `FieldSchema` rows, not a new hand-rolled page — confirmed as the intended
pattern from the root doc and the schema's own shape.

## Audit workflow

`AuditSection`/`AuditQuestion` (reference/config) → `AuditResponse`/`AuditAnswer` (a filled-out
audit) → `CorrectiveAction`/`AuditCorrection` (follow-up when an audit finds a problem) →
`dashboard/audit-review`-equivalent (`action-inbox/audit-review.service.ts`) for owner review,
`dashboard/audit-result/audit-report-email.service.ts` for the report email.
