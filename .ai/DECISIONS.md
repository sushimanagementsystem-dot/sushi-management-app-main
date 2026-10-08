# DECISIONS.md

A log of *why* something was built a particular way, for decisions that aren't obvious from
reading the code alone. Newest first. `deploy.sh`'s own header comment already references this
file by name ("see DECISIONS.md" for a Vercel-flakiness note) — this file did not exist until
this documentation pass created it; that comment was presumably aspirational or referred to
context that lived elsewhere. If you find the source of that specific claim, record it here.

---

## Real-FK reference checking for hard-delete, instead of `FieldSchema.ref_table`
**Why:** `FieldSchema.ref_table` only exists to drive the Data Tables UI's own reference
pickers — it's owner-editable metadata, and no one had ever made internal tables like
`fridge_count`, `product_movement`, or `staff_food` owner-editable, so they had no row there and
were invisible to the old reference check. Found live: deleting a product named "Benchwarmer"
passed the old check clean, then failed with a raw `fridge_count_product_id_fkey` Postgres error
shown verbatim to the (non-technical) owner.
**Decision:** query Postgres's own `information_schema` for every real FK pointing at a table,
per-row (not per-table — see below), so the check can never drift out of date with the schema.

## Per-row, not per-table, reference checking
**Why:** a per-table check ("does this table have ANY row anywhere that references it") used to
block hard-delete on `product`/`stock_item` permanently, even for a completely unused test row
with zero real history — found live.
**Decision:** check whether *this specific row's primary key* has any real referencing rows.

## Force delete — a separate, explicitly-confirmed escalation, never a silent retry
**Why:** an owner legitimately does sometimes want to remove a row along with its (often
no-longer-wanted) history — e.g. a retired/junk product with old fridge-count entries.
**Decision:** `cascadeDeleteRow()` is reachable only after the owner sees the reference
breakdown and explicitly clicks "Force delete anyway" (separate button, its own strong
confirmation, never a retry of the same delete request). Every row it touches (target +
cascaded) is snapshotted into `AuditLog` *before* deletion, in the same transaction.

## Audit log + undo for every hard-delete
**Why:** explicit project requirement — "jo bhi delete wala action kare wo undo kar paye" (every
delete action should be undoable).
**Decision:** `AuditLogService.record()` snapshots `{target, cascaded}` as JSON before every
delete (plain or Force); a 20-second frontend toast offers one-click undo; the snapshot itself
never expires, only the toast does (see `KNOWN_ISSUES.md` #3 for the resulting gap). No FK
constraints on `performed_by`/`undone_by` — deliberate, so the audit trail survives even if the
referenced user is later removed.

## `InvoiceLine.correctLine()` — fix an approved line without reopening the invoice
**Why:** `undo()` on a confirmed invoice is correctly refused once a later stocktake has
reconciled against its stock movements (see `BUSINESS_LOGIC.md`) — but an owner still
legitimately needs to fix a wrong qty/cost after the fact (real example: an invoice line said
"1 BTL" when it should have said "1 box = 2 BTL").
**Decision:** add a narrower action that updates the `InvoiceLine`'s own `qty`/`unit_cost`/
`line_total` (so Invoices List/KPI/Profit, which read the line directly, show the corrected
number) and posts a **separate** `stock_movement` for just the delta, dated today, under a new
`movement_type: "DELIVERY_CORRECTION"` — never touching or deleting the original `DELIVERY_IN`
movement or the stocktake math that already ran against it.
**Follow-on decision:** `DELIVERY_CORRECTION` needed `direction` (`IN` for a positive delta,
`OUT` for a negative one) rather than reusing `DELIVERY_IN` with direction `OUT`, because
`KpiService.computeStockUsageLedger`'s "Deliveries In" bucket keyed off `movement_type ===
"DELIVERY_IN"` alone (ignoring `direction`) — reusing `DELIVERY_IN` for a downward correction
would have silently inflated that report. The bucket logic was then explicitly taught to handle
`DELIVERY_CORRECTION` respecting `direction`. `undo()`'s cleanup query was also widened to delete
both movement types for a line, so a future undo (when not blocked) removes a correction
alongside its original in one consistent action.

## Stock transfer editing allowed through `APPROVED`, not just `PENDING`
**Why:** an owner reviewing the Action Inbox found a wrong qty ("1 BTL" vs. the intended "1 box
= 2 BTL") on a transfer that had already been Approved, and had no way to fix it — the only edit
UI (`TransferEditor`) only showed for `PENDING` transfers, and even then had no qty field at all,
only source/destination kiosk pickers.
**Decision:** `StockTransferReviewService.update()`'s allowed-status check was widened from
`status === "PENDING"` to `status === "PENDING" || status === "APPROVED"`. Confirmed safe because
`apply()` (the only place that posts a real `TRANSFER_OUT`/`TRANSFER_IN` `stock_movement`) hard-
requires `status === "APPROVED"` and always runs strictly *after* any edit — so nothing real has
been posted yet at the point an edit happens, there's no history to go stale. Editing remains
refused once `APPLIED`, matching the same "don't rewrite posted history" boundary as invoice
review. The frontend `TransferEditor` also gained an actual qty input field (previously missing
entirely) and now renders for `PENDING` or `APPROVED` transfers, not just `PENDING`.

## `TableSchema.has_detail_view` must be explicitly `true`, not just non-`false`
**Why:** `stock_item`'s "View" button (exposing its Par Levels sub-table) was completely
invisible in the dashboard — the underlying data and logic worked, the flag was simply `null`
instead of `true`. Found while investigating an owner's "I don't know how to set up par-level
ordering" report.
**Decision:** no code change needed — fixed via a direct data correction
(`has_detail_view: true`) — but worth recording as a reminder that this flag is a tri-state
(`null`/`false`/`true`) where only `true` enables the feature, and a new owner-editable table
with a detail/sub-table relationship must have this explicitly set.

## RETIRED-product exclusion reverted on Fridge Count
**Why:** an earlier change applied `isProductInProduction()` (excludes `RETIRED` products)
uniformly across `production-engine`/`production-email` AND `fridge-count.service.ts`. The
client clarified retired products must still appear on Fridge Count/Morning Waste — only the
production plan/email should exclude them.
**Decision:** reverted `fridge-count.service.ts` to a plain `.active` check, matching the
convention already used (correctly) in Morning Waste/Damaged Product/Staff Food. See
`BUSINESS_LOGIC.md`.

## `frontend-next`'s `proxy.js` lowercases kiosk slugs
**Why:** kiosk links are shared with real casing (e.g. `K01`), but `/enter` always stores the
token under `kiosk_id.toLowerCase()`, and kiosk pages read the raw URL slug with no
normalization — producing an unrecoverable "Access denied" for a real staff member on a real
link, with no client-side fix (clearing storage/re-signing-in reproduces the same mismatch on
the next visit).
**Decision:** normalize the slug once, centrally, in `proxy.js` (Next's middleware-equivalent)
before routing, so every downstream reader sees the same lowercase value the token was stored
under.
