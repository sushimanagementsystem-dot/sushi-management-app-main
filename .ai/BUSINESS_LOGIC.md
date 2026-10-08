# BUSINESS_LOGIC.md

Domain rules that are easy to get backwards because they aren't derivable from the schema alone
— each one here is either client-confirmed or found live in production data, not guessed.

## "Retired" means different things on different forms

A `Product` with `production_role: "RETIRED"` (see `DATABASE.md`'s enum-staleness note — this
value exists in live `EnumOption` data even though the schema comment doesn't list it):

- **Must NEVER appear** on the production plan or the Sushi Circle production email —
  `isProductInProduction()` (`src/common/product.util.ts`) = `active && production_role !==
  "RETIRED"`, used by `production-engine.service.ts`/`production-email.service.ts`.
- **Must still appear** on Morning Fridge Count, Morning Waste, Staff Food, and Damaged Product —
  these forms use a plain `.active` check, deliberately *not* `isProductInProduction()`. A
  retired product can still physically exist in the fridge and needs to keep being counted/
  logged for waste even though it's no longer being made.

This is a client-clarified rule, verbatim: *"If a product is retired it should not appear on
the production email no. retired should mean it doesnt appear any day [on production]. However
it should still appear on morning fridge count/morning waste etc."* An earlier version of the
code wrongly applied the production exclusion to Fridge Count too; it was reverted specifically
because of this clarification. **Do not consolidate these into one shared "is this product
still a thing" check** — that was tried, confirmed wrong, and undone. See `DECISIONS.md`.

## Invoice review approval flow

`DeliveryHeader.status`: `IN_REVIEW -> REVIEWED` (via Confirm or Decline).
Confirm posts real `DELIVERY_IN` `stock_movement` rows — this is the one durable, real-world
effect of approving an invoice. Decline posts nothing.

**Undo is refused** if a stocktake has since been confirmed covering any of the same stock items
at the same kiosk — because that stocktake's variance/adjustment was computed against a stock
ledger that already includes this delivery's movements; silently removing them would make the
stocktake's recorded numbers wrong with no trace of why. The owner-facing fix in that case is
either "leave it as is" or correct the line in place (see `correctLine` in `DECISIONS.md`), not
force an undo.

## Stock transfer (move-stock) approval flow

`StockTransfer.status`: `PENDING -> APPROVED -> APPLIED` (or `REJECTED` at either of the first
two stages). Only `apply()` posts real stock movements (`TRANSFER_OUT` at source,
`TRANSFER_IN` at destination) — `APPROVED` alone has no physical-stock effect yet. This is why
editing is safe up through `APPROVED` but refused once `APPLIED`. See `DECISIONS.md`.

## Food waste categorization

Stock items bucket into `FOOD` / `PACKAGING` / `RICE` for the Food Waste form's dropdown, driven
by two comma-separated-id `Setting` rows (`FOOD_WASTE_PACKAGING_CATEGORIES`,
`FOOD_WASTE_RICE_CATEGORIES`), checked in priority order RICE → PACKAGING → fallback FOOD
(`src/forms/food-waste/food-waste.service.ts`). Not derived from `StockItem.stock_category_id`
alone — these settings are an independent, owner-editable override layer on top of it.

## Purchasing / par levels

Driven by `StockItemPar` (`target_par`, `minimum_stock`, `safety_stock`, per kiosk) and current
stock-on-hand (`stockBalanceAsOf`). The Stock Item Data Table's "View" sub-table (gated by
`TableSchema.has_detail_view`, see `DECISIONS.md`) is where an owner sets these per-kiosk par
levels — if that flag is unset for a table, the feature is invisible even though the underlying
data/logic works correctly, which happened live for `stock_item`.

## Production email grouping

`Product.plan_group` groups items on the Sushi Circle production email;
`Product.sort_last_in_group` (boolean) sorts certain sharer/platter/combo products to the bottom
of their ingredient group rather than their own former section — **deliberately not driven by
`product_category_id`**, because that field is independently reused for unrelated legacy reasons
on some unrelated products (see in-schema comment, `DATABASE.md`).
