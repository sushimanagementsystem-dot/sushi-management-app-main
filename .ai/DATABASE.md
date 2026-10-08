# DATABASE.md

Covers the **new stack's** database: Postgres (Neon), accessed via Prisma
(`nest-backend/prisma/schema.prisma`). For the legacy stack's Google Sheet "database," see
`CLAUDE.md` — it is accessed only through `backend/core/DAL.js` (currently absent from the
working tree, see `KNOWN_ISSUES.md`).

Verified: **49 models, 0 `enum` blocks** in `schema.prisma` as of 2026-10-08.

## Why no Prisma enums

Deliberate, documented in `CLAUDE.md` and in-schema comments: enum-like columns stay plain
`String` with an `// enum_source: <name>` comment, because their valid values are owner-editable
at runtime via the `EnumOption` table, not fixed at compile time. **The comment next to a field
lists known values at the time that comment was written — it is not necessarily complete.**
Example found this pass: `Product.production_role`'s comment says `(PRIMARY | SECONDARY)`, but
live code (`src/common/product.util.ts`'s `isProductInProduction()`) also checks for a `RETIRED`
value — the comment is stale, the `enum_option` table (filtered by `category = "production_role"`
at runtime) is the real source of truth. **Always check `EnumOption` rows for current valid
values, never just the schema comment.**

## Model inventory (by rough area)

**Reference/config:** `Brand`, `Kiosk`, `User`, `Supplier`, `Campaign`, `EnumOption`,
`TableSchema`, `FieldSchema`, `Setting`, `SiteConfig`.

**Catalog:** `StockItem`, `StockItemPar`, `Product`, `RecipeComponent`, `Component`,
`DefrostItem`, `DefrostPar`, `SupplierItemMap`.

**Audits:** `AuditSection`, `AuditQuestion`, `AuditResponse`, `AuditAnswer`,
`CorrectiveAction`, `AuditCorrection`.

**Production/ops:** `ProductionPar`, `ProductionPlan`, `WeeklySales`, `WeeklyCosts`,
`WeeklyLabour`.

**Submission/workflow plumbing:** `Submission`, `ProcessingErrorLog`, `Request`, `OwnerAction`,
`ActivityLog`, `AuditLog` (hard-delete undo system, see `DECISIONS.md`).

**Stock/money ledger:** `StockMovement`, `ProductMovement`, `StockTransfer`, `FridgeCount`,
`StaffFood`, `DeliveryHeader`, `DeliveryFile`, `InvoiceLine`, `StocktakeHeader`, `StocktakeLine`,
`StockVarianceDismissal`, `PurchasingBatch`, `PurchasingBatchLine`.

**Files:** `StoredFile`.

## Central tables worth understanding before touching money/stock code

### `StockItem` / `StockItemPar`
- `StockItem.measurement_type` (`WEIGHT_G` default | `COUNT`) drives Food Waste's input mode
  (grams vs. whole units) and which cost field applies (`cost_per_100g` vs.
  `current_unit_cost`).
- `StockItem.ambient_duplicate_of` — a self-referential FK used ONLY for a
  "stock-take-only duplicate" row representing the same physical stock counted in two locations;
  purchasing sums both items' `stock_movement` balances, but the duplicate never gets its own
  supplier mapping or par row.
- `StockItemPar` is keyed `(stock_item_id, kiosk_id)` — per-kiosk par/minimum/safety stock
  levels, surfaced in the dashboard as the Stock Item's "Par Levels" sub-table (gated by
  `TableSchema.has_detail_view` — see `DECISIONS.md` for a bug that hid this).

### `Product`
- `production_role` (via `EnumOption`, includes at least `PRIMARY`, `SECONDARY`, `RETIRED`) —
  **a `RETIRED` product must never appear on the production plan/email, but MUST still appear on
  Morning Fridge Count / Morning Waste / Staff Food / Damaged Product.** See `BUSINESS_LOGIC.md`
  — this is a client-confirmed rule, two different "is this product still a thing" checks exist
  in code on purpose and must not be merged into one.
- `plan_group` / `sort_last_in_group` — drive the Sushi Circle production email's grouping and
  ordering; `sort_last_in_group` is deliberately NOT derived from `product_category_id` (see
  in-schema comment) because that field is reused for unrelated legacy reasons on some products.

### `StockMovement` — the ledger
```
movement_type: String  // EXPIRED_WASTE | DAMAGE | TRANSFER_IN | TRANSFER_OUT | DELIVERY_IN |
                        // STOCKTAKE_ADJUSTMENT | DELIVERY_CORRECTION | ...
direction:     String  // IN | OUT — the canonical sign, see ARCHITECTURE.md
qty:           Decimal(12,3)
unit_cost:     Decimal(12,4)?
cost:          Decimal(12,2)?
reference_id:  String?  // links back to the row that caused this movement
                        // (e.g. an invoice_line_id, a stocktake_line_id)
```
`movement_type` is a free-form string, **not** validated against `EnumOption` in the schema
itself (comment lists known values but the column accepts any string) — see `DATABASE.md`'s
earlier note on enum staleness; this is exactly the kind of field where a typo'd `movement_type`
would silently fail to match any downstream bucket logic.

### `DeliveryHeader` / `InvoiceLine` — delivery invoice review
`InvoiceLine.status`: `DRAFT -> APPROVED/REJECTED` (via Confirm/Decline), with an `APPROVED` line
further correctable in place (`correctLine`, see `DECISIONS.md`) without reopening the whole
invoice. `DeliveryHeader.status`: `IN_REVIEW -> REVIEWED`.

### `StockTransfer` — move-stock requests
`status`: `PENDING -> APPROVED -> APPLIED` (or `REJECTED`). Only `apply()` (status must be
`APPROVED`) posts the real `TRANSFER_OUT`/`TRANSFER_IN` `stock_movement` pair. Editing
(`update()`) is allowed at `PENDING` or `APPROVED`, refused once `APPLIED` — see `DECISIONS.md`.

### `TableSchema` / `FieldSchema` — the Data Tables grid engine's own metadata
Drives `nest-backend/src/dashboard/data-tables/` and
`frontend-next/components/dashboard/tables/DataTablesController.js` — a config-driven generic
CRUD grid, not one hand-built page per entity (mirrors the legacy `dashboard/DataTables.js`
pattern per `CLAUDE.md`). `TableSchema.hard_delete` gates whether a table supports permanent
delete at all; `TableSchema.has_detail_view` gates whether a row's "View" button (sub-table
drill-down, e.g. Stock Item → Par Levels) appears — this flag being unset (`null` instead of
`true`) was a real bug found and fixed this session for `stock_item` (see `DECISIONS.md`).
`FieldSchema.ref_table` is **owner-editable UI metadata only** — real foreign-key reference
checking for safe deletes reads Postgres's own `information_schema` instead (see
`DECISIONS.md`'s Force Delete entry), because `FieldSchema` never covers internal tables like
`fridge_count` that nobody made owner-editable.

### `AuditLog` — hard-delete undo
`{ table_name, action: DELETE|FORCE_DELETE, snapshot: Json, performed_by, undone_at?,
undone_by? }`. No FK constraints on `performed_by`/`undone_by` (by design — see `DECISIONS.md`).
Rows never expire/get cleaned up automatically.

## Migrations

`nest-backend/prisma/migrations/` — mix of Prisma-generated and at least one hand-written
migration (the `audit_log` table). **Known live drift**: a `purchasing_batch_supplier_id_fkey`
constraint's actual `ON DELETE` behavior in the live DB does not match what a fresh
`prisma migrate dev` run wants to generate — flagged, not fixed. See `KNOWN_ISSUES.md`. Do not
run `prisma migrate dev` without first diffing what it proposes to generate against this known
drift, or it will try to "fix" (i.e. silently change) that constraint as a side effect of an
unrelated migration.

## Seeding

`npm run db:seed` → `prisma db seed` is defined in `package.json`. UNKNOWN — needs inspection:
the actual seed script/content was not located or read this pass; check `prisma/` for a `seed.ts`
or equivalent before assuming what it does.
