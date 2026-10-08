# CONVENTIONS.md

Patterns this codebase actually follows, confirmed from real files — not generic
NestJS/Next.js/Prisma best-practice assumptions.

## Naming

- Database columns and Prisma model fields: `snake_case` (deliberately, to mirror the legacy
  Google Sheet headers 1:1 — see `DATABASE.md`), **not** Prisma's usual camelCase convention.
- Prisma model names: `PascalCase` (`StockItem`, `DeliveryHeader`), mapped to `snake_case` table
  names via `@@map("stock_item")`.
- HTTP route names: `snake_case`, verb-first-ish action names matching the legacy backend's
  action vocabulary (`bootstrap_move_stock`, `confirm_invoice_review`) — not REST resource
  paths. See `API.md`/`ENDPOINTS.md`.
- Frontend API call sites: `apiCall("action_name", data)` — the string must match a real backend
  route exactly (`POST /action_name`).

## Comments — documentation of *why*, not *what*

Every file inspected this pass follows a consistent heavy-but-purposeful comment style: a
doc-comment above a class/function explaining the non-obvious reason it exists or was built a
particular way (often referencing a real incident: "found live: ...", "a 13-line invoice
overran it", "the exact outcome this check exists to prevent"). This is a real, consistently
followed project convention — match it when adding non-obvious logic. Do not add comments that
restate what a line of code visibly does.

## Error handling

- Backend: never let a raw Postgres/Prisma error reach the client. Use `explainWriteError()`/
  `friendlyDbError()` (see `BACKEND.md`). A raw constraint-name error reaching a non-technical
  owner is treated as a real bug, not a cosmetic issue.
- A blocked destructive action (e.g. a delete blocked by FK references) offers a named,
  explicit, separately-confirmed escalation path (Force delete) rather than silently retrying or
  looping — see `DECISIONS.md`.

## Stock movement conventions (worth re-reading before adding a new `movement_type`)

- `direction` (`IN`/`OUT`) is the one field every *stock-on-hand* calculation
  (`stockBalanceAsOf`) trusts.
- Several *display/reporting* aggregations (`KpiService.computeStockUsageLedger`'s "Deliveries
  In"/"Transfers In"/"Transfers Out" buckets) instead key off `movement_type` string match, by
  convention assuming each named type always posts with one fixed direction. **If you introduce
  a new `movement_type` that can legitimately go either direction** (as `DELIVERY_CORRECTION`
  does), you must explicitly teach every such bucket about it, or that report will silently
  miscount while the real stock-on-hand math stays correct. See `ARCHITECTURE.md`.

## "Don't rewrite posted history" boundary

A recurring, deliberate pattern across at least two different features
(`InvoiceReviewService.undo`/`.correctLine`, `StockTransferReviewService.update`/`.apply`): once
an action has posted a **real** `stock_movement` that other data (a later stocktake's
reconciliation, etc.) may already depend on, that action becomes un-undoable/uneditable in
place. The fix for "I need to change this after the fact" is never "force the undo through" —
it's either (a) edit is still safe because nothing real has posted yet (e.g. `StockTransfer` at
`APPROVED`-not-yet-`APPLIED`), or (b) post a new, separate correcting movement that fixes the
number going forward without touching history (e.g. `InvoiceLine.correctLine`'s
`DELIVERY_CORRECTION`). When asked to "let me edit X after it's been applied/confirmed/posted,"
look for which of these two shapes fits before building anything — see `DECISIONS.md` for two
worked examples.

## Owner-facing message tone

User-visible error/confirmation strings are plain language, written for a non-technical kiosk
owner, not a developer — e.g. "Cannot permanently delete: 4 rows in "Fridge Count" still
reference this. Use Force delete to remove those along with it — this cannot be undone." Match
this register for any new user-facing string; avoid exposing table/column names unless a
human-readable label (`TableSchema.label`/`prettyTableName()` fallback) is used instead.

## Responsive UI — mandatory, not optional

See root `UI_RULES.md` in full. In short: every UI change must be verified at both desktop and
mobile breakpoints before being called done; a side-by-side desktop layout needs a deliberate
mobile stacking decision, not a shrink. This is an explicit, standing project rule, not a
style preference to weigh against other considerations.

## Deletion safety

Soft-delete (an `active` boolean) is the default pattern across catalog tables (`Product`,
`StockItem`, etc.) — confirmed via `active: Boolean @default(true)` on multiple models. Hard
delete exists only where `TableSchema.hard_delete` is explicitly set, and even then is gated by
the real-FK-reference check described in `BACKEND.md`/`DECISIONS.md`. Prefer deactivating over
deleting when in doubt about whether a row has history.
