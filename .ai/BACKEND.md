# BACKEND.md

Covers `nest-backend` — the active-development backend. For the legacy Apps Script backend, see
`CLAUDE.md`.

## Module map (`src/app.module.ts`'s `imports`)

`PrismaModule`, `SecretsModule`, `ReferenceDataModule`, `MailerModule`, `UploadModule`,
`ProductionEngineModule`, `AuthModule`, `KioskModule`, `PipelineModule`, `FormsModule`,
`PurchasingModule`, `DashboardModule`, `ImportModule`. Order in the array is import order, not
necessarily load-bearing, but `ConfigModule.forRoot({ isGlobal: true })` and
`ScheduleModule.forRoot()` are registered first.

## Layering convention — one service class per concern, injected, not inherited

Each dashboard area / form has its own `*.service.ts` + `*.controller.ts` + (where needed)
`dto/*.dto.ts`, composed via Nest's DI rather than shared base classes. Shared cross-cutting
logic (e.g. `OwnerActionStateService`'s `logActivity`/`advanceOwnerActionOnAction`/
`findOwnerAction`) is injected into multiple services rather than inherited — see
`src/dashboard/action-inbox/owner-action-state.service.ts`'s own doc comment for this explicitly
stated design choice.

## Prisma access patterns worth knowing

- `PrismaService` (`src/prisma/prisma.service.ts`) extends `PrismaClient`, wired with
  `@prisma/adapter-pg` over a hand-built `pg.Pool` — see `ARCHITECTURE.md`.
- `delegateFor(db, tableName)` (`src/common/prisma-delegate.util.ts`) — a generic helper that
  resolves the right Prisma model delegate from a snake_case table name string, works against
  either the real client or a `$transaction` client. Used anywhere a table name is only known at
  runtime (the generic Data Tables grid, cascade-delete logic).
- Multi-statement writes that must be atomic use `prisma.$transaction(async (tx) => {...})`,
  with an explicit `timeout` override (`TX_TIMEOUT_MS = 30_000` in `invoice-review.service.ts`,
  for example) where Prisma's default 5s interactive-transaction timeout has been hit in
  practice by a real multi-line write (see in-code comment: a 13-line invoice overran it before
  batching).

## Write-error translation — never show a raw DB error to an owner

`src/common/write-error.ts`'s `explainWriteError()` (and the lower-level `friendlyDbError()` in
`src/common/filters/prisma-error.ts`) convert raw Prisma/Postgres errors (P2002 unique
violation, P2003 FK violation, etc.) into plain-language messages. Used both as the global
`HttpExceptionFilter` fallback (see `API.md`) and explicitly wrapped around delete paths as a
second safety net — a real raw `fridge_count_product_id_fkey` error reaching a non-technical
owner is the documented reason this exists (see `DECISIONS.md`).

## The generic Data Tables engine (`src/dashboard/data-tables/`)

Config-driven CRUD backed by `TableSchema`/`FieldSchema` (see `DATABASE.md`). Key methods in
`data-tables.service.ts`:
- `checkRowReferences()` / `findRowBlockers()` — queries Postgres's real
  `information_schema.table_constraints`/`key_column_usage`/`constraint_column_usage` for every
  FK actually pointing at a row's table, **not** `FieldSchema.ref_table` (which only covers
  tables an owner was given a reference picker for — internal tables like `fridge_count` were
  invisible to the old check). A per-row check (does *this* row's PK have real referencing rows),
  not a per-table check (does this table have any FK pointing at it at all) — the latter used to
  make hard-delete permanently unusable for central tables like `product`/`stock_item`.
- `cascadeDeleteRow()` — the "Force delete" path: snapshots the target row + every referencing
  row (via `findMany`/`findFirst`, before any delete) into an `AuditLog` row, then deletes
  cascaded rows, then the target, all in one `$transaction`.
- `deleteRowTracked()` — the plain (non-cascading) delete path, also snapshotted into
  `AuditLog` for undo, not just Force delete.

## Audit log / undo (`src/dashboard/audit-log/`)

`AuditLogService.record()`/`.undo()`. Snapshot shape: `{ target: {table, row}, cascaded:
[{table, rows}] }` stored as Prisma `Json`. `undo()` recreates the target row and every cascaded
row verbatim from the snapshot. No automatic expiry on an `AuditLog` row — only the frontend's
20-second toast UI times out; the underlying data is recoverable indefinitely via `POST
/undo_delete` given the `auditLogId`, there's just no UI to browse past ones (see
`KNOWN_ISSUES.md`).

## Scheduled jobs

`ScheduleModule.forRoot()` is registered globally; specific `@Cron`/`@Interval` usage sites were
not enumerated this pass. UNKNOWN — needs inspection: `grep -rn "@Cron\|@Interval" src` to find
every scheduled job (known at least: a submission-pipeline sweep, a weekly purchasing scan — see
`src/pipeline/` and `src/purchasing/`).

## Testing conventions in practice

See `TESTING.md` for the full picture. Short version: Vitest unit specs
(`src/**/*.spec.ts`) use hand-constructed mock `prisma`/`tableCache`/service objects (no real DI
container, no test database) — see any `*.spec.ts` file's `build()` helper pattern for the
convention to follow when adding a new one.
