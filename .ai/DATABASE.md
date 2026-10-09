# DATABASE.md

Postgres (Neon), accessed via Prisma 7 with a driver adapter (`@prisma/adapter-pg`, Prisma 7 no
longer reads a `url` in `datasource db` — the connection URL lives in `prisma.config.ts` for the
CLI and is passed to `new PrismaClient({ adapter })` at runtime). `src/prisma/prisma.service.ts`
wraps a long-lived `pg.Pool` (`idleTimeoutMillis: 0`) deliberately, to avoid paying Neon's
compute-suspend wake latency between dashboard page loads — this is a confirmed, intentional
choice called out in the code's own comments, not an oversight to "simplify."

Schema is a **1:1 port of a Google Sheet** (confirmed in `schema.prisma`'s header comment and in
`Submission.form_type`'s inline comment pointing at the legacy `FORM_TYPES` constant): field
names are `snake_case` (not Prisma's usual camelCase) so the API returns rows in the shape the
frontend and the old DAL contract already expect, with no translation layer. Enum-like columns
(`role`, `movement_type`, `status`, etc.) are plain `String`, not Prisma enums, because most are
backed by the owner-editable `enum_option` table at runtime — a compile-time enum would be wrong
for the ones an owner can add options to.

## Model count

49 models (`grep -c "^model " prisma/schema.prisma`). Grouped by purpose:

- **Reference/config** (owner-editable via the generic Data Tables engine): `Brand`, `Kiosk`,
  `User`, `Supplier`, `Campaign`, `StockItem`, `StockItemPar`, `Product`, `RecipeComponent`,
  `AuditSection`, `AuditQuestion`, `EnumOption`, `ProductionPar`, `Component`, `DefrostItem`,
  `DefrostPar`, `SupplierItemMap`, `Setting`, `SiteConfig`.
- **Schema-driving the generic CRUD grid** (`dashboard/data-tables/`): `TableSchema`,
  `FieldSchema` — these describe every other table's columns/types/enum sources so
  `tables.html`'s Next.js equivalent is config-driven, not one hand-built page per table.
- **Submission intake/pipeline**: `Submission` (the async queue — `processing_status`:
  PENDING/PROCESSED/RETRY_REQUIRED/ERROR), `ProcessingErrorLog`.
- **Domain data written by form processors**: `StockMovement`, `ProductMovement`,
  `StockTransfer`, `FridgeCount`, `ProductionPlan`, `StaffFood`, `WeeklySales`,
  `DeliveryHeader`, `DeliveryFile`, `InvoiceLine`, `Request`, `StocktakeHeader`,
  `StocktakeLine`, `StockVarianceDismissal`.
- **Purchasing automation**: `PurchasingBatch`, `PurchasingBatchLine`.
- **Audits**: `AuditResponse`, `AuditAnswer`, `CorrectiveAction`, `AuditCorrection`.
- **Dashboard/ops**: `OwnerAction`, `ActivityLog`, `AuditLog`, `StoredFile`, `WeeklyCosts`,
  `WeeklyLabour`.

## Migrations

20 migrations as of this audit (`prisma/migrations/`), most recent:
`20260929000000_product_sort_last_in_group`, `20261003000000_stock_item_sort_order`,
`20261004000000_stock_variance_dismissal`, `20261005000000_audit_log`. Run with
`npm run db:migrate` (`prisma migrate dev`).

## One-off scripts (`nest-backend/prisma/`, not migrations)

`seed.ts`, `import-evan-data.ts`, `add-food-waste-rice-items.ts`,
`deactivate-non-sheet-stock-items.ts`, `remove-broken-invoices.ts`, `restore-plain-rice.ts`,
`set-stock-item-sort-order.ts`, `update-menu-layout-and-rice.ts`. These are real-data
reconciliation/cleanup scripts, run manually against production by whoever holds `DATABASE_URL`
(per project memory: that's an "admin-side" action, run by the user/Muhammad, not executed from
an AI session against the live DB). `schema.prisma.before-indexes` is a backup snapshot, not an
active schema file.

## Secrets at rest

API keys/credentials saved into the DB (e.g. via the Site Configuration dashboard page) are
encrypted before being written — see `AUTH.md`'s `SecretsService` note. A DB dump or read-only
SQL access sees ciphertext (`enc:v1:...` prefix, AES-256-GCM), never the plaintext key.
