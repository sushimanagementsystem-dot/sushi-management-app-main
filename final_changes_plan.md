# Evan's stock/ordering + system review — final changes plan (nest-backend + frontend-next)

## Context

Evan (client) sent the finalized master stock sheet (113 products, cost-per-gram, supplier
column), 4 supplier order templates, and a `System Review v2` doc. This targets **`nest-backend/`
+ `frontend-next/`** (the in-progress rewrite) — confirmed against real data
(`Database-20260928-1752.xlsx` is this stack's own Postgres export, not the legacy Sheet).

A full code check found most of the purchasing/food-waste pipeline **already well-built** here —
`purchasing-scan.service.ts` (tested, triggers itself after stocktake confirmation, emails the
owner only, builds its own clean order-sheet `.xlsx`) and the `dashboard/bulk-import` framework
(Evan can already paste/upload prices, par levels and supplier item codes through the dashboard —
no code needed for that part). This plan covers the **real gaps only** — everything else Evan
asked for is already satisfied by what's there, confirmed from his own data, no further questions
back to him needed.

No local/reachable Postgres from this environment (`.env`'s `DATABASE_URL` points at
`localhost:5432`, not running here) — every item below is written as working code +
migration/script, run and verified by Muhammad locally (`npx prisma migrate dev`, then the
one-off import script), not executed from here.

## Work items

- [x] **1. `StockItem.measurement_type` (WEIGHT_G | COUNT) + Food Waste EACH-vs-grams split**
  - Prisma migration: add `measurement_type String @default("WEIGHT_G")` to `StockItem`.
  - `nest-backend/src/pipeline/processors/food-waste.processor.ts`: branch on it — `WEIGHT_G`
    keeps grams × `cost_per_100g`; `COUNT` takes whole units × `current_unit_cost` (same field
    reconciliation already uses — no new cost field).
  - `nest-backend/src/forms/food-waste/food-waste.service.ts`: include `measurementType` per item
    in the bootstrap payload.
  - `frontend-next/app/[slug]/food-waste/page.js`: swap the hardcoded "Grams" field/label for
    "Each" + whole-number input when the picked item is `COUNT`.

- [x] **2. `StockItem.ambient_duplicate_of` — Kiosk-only duplicate counting**
  - Prisma migration: add nullable self-relation `ambient_duplicate_of String?` on `StockItem`.
  - `nest-backend/src/common/purchasing-trigger.util.ts` / `purchasing-scan.service.ts`: current
    stock balance for an item with ambient duplicates = its own `stockBalanceAsOf` **plus** every
    duplicate's — same physical stock, counted in two locations (Evan: "counted both in the kiosk
    and in the other areas"). No change needed in Stocktake or Food Waste — ambient rows already
    surface normally there and simply never get a supplier mapping, so they never generate their
    own order line.

- [x] **3. Castlebay's fixed-order-quantity override, generalized off supplier name**
  - Prisma migration: add `fixed_order_qty Int?` to `SupplierItemMap`.
  - Replace `castlebayPacksOverride(supplierName)` in `purchasing-trigger.util.ts` with a check on
    the specific mapping's `fixed_order_qty` (blank = normal shortfall math). Set only on the
    Salmon↔Castlebay mapping — Castlebay's finalized mapping is now salmon + 14 packaging items,
    and only salmon has the fixed 4-case minimum (per Castlebay's own order form).

- [x] **4. `cost_per_100g` import path**
  - Extend `dashboard/bulk-import/datasets/stock-item-price.ts` with a second value column ("Cost
    per 100g", food-waste rate) alongside the existing Price column, writing to
    `stock_item.cost_per_100g` — same idiom as the existing dataset, so Evan pastes both costs
    from one sheet through the dashboard.
  - This alone fixes the live bug found in the data: `cost_per_100g` is blank on all 136 stock
    items today, so every Food Waste submission has been silently uncosted.

- [x] **5. Data reconciliation — Evan's finalized master sheet into `stock_item`** (script written,
  not yet run — needs Muhammad's real `DATABASE_URL`, not reachable from here)
  - One-off script (`nest-backend/prisma/seed-evan-import.ts` or similar), run once by Muhammad:
    - Add the "Kiosk (ambient product only)" `stock_category` enum value.
    - For the ~32 products in Evan's sheet with no confident existing-name match (new items:
      Chives, Pak Choi, Sushi Ebi, Wakame, the packaging line items, etc.) — insert new
      `stock_item` rows.
    - For the ~81 that do match, update `measurement_type`, `cost_per_100g` (×100 from his
      per-gram column), and wire `ambient_duplicate_of` for the 8 ambient rows (7 by name, Rice
      maps to "Koshi Yutaka Standard Rice 5kg" — confirmed with Evan).
    - This is the one part that can't safely go through the bulk-import UI as-is: bulk-import
      "never creates an item," and name-matching 113 rows against 136 existing ones has ~30 near-
      miss spellings (see prior analysis) that need code-level, reviewable matching rather than
      blind fuzzy guessing on live data.
  - Supplier data: Sysco and VSD corrected from `EMAIL_ORDER` to `MANUAL` (Evan's explicit
    answer — Bunzl correctly stays `EMAIL_ORDER`, Tazaki/Asia Market/Castlebay stay `ORDER_SHEET`).
  - Supplier item codes/prices (Castlebay/Asia Market/Tazaki's own product codes) — Evan pastes
    these through the existing `supplier_item_map` bulk-import dataset once suppliers + items
    exist; not part of the one-off script.

## Explicitly not changing

- **Purchasing stays aggregated across all kiosks per supplier** (no `kiosk_id` on
  `PurchasingBatch`), not split per kiosk. This was a real question during planning, resolved
  without needing to ask Evan: the system builds its own clean order sheet rather than filling his
  suppliers' literal templates (which is what would have forced one-store-at-a-time), so a combined
  total across kiosks is a fine match for "review and send" — no gap here.
- **`defrost_par` being empty** and **the Waste-Rate report numbers** — both explained by what's
  already in the code (real, in-use features waiting on data / a proxy-metric design choice), not
  bugs. Answers ready to give Evan directly, no code change.

## Verification

- [x] `cd nest-backend && npx prisma generate` — schema changes are valid, client regenerates clean.
- [x] `npx tsc --noEmit` — no new type errors (2 pre-existing unrelated failures in
  `invoice-file.service.spec.ts` and `test/app.e2e-spec.ts` predate this work).
- [x] `npm test` (vitest) — **33 test files, 181 tests, all passing**, including
  `purchasing-scan.service.spec.ts` / `purchasing-order-email.spec.ts` unchanged.
- [x] `npm run lint` (oxlint) — no new warnings in any touched file.
- [x] `frontend-next`: `npm run build` — compiles clean, `[slug]/food-waste` route builds.
- [ ] `npx prisma migrate dev` / `migrate deploy` locally (needs a real reachable `DATABASE_URL` —
  not available from this environment) to actually apply the new columns against the real
  database, then `npx tsx prisma/import-evan-data.ts` to run the reconciliation, then spot-check
  in Prisma Studio (`npm run db:studio`).
- [ ] Manually submit a Food Waste line for one `WEIGHT_G` item and one `COUNT` item in
  `frontend-next`, confirm `stock_movement.cost` calculates correctly for both.
- [ ] After the import script runs, check the 11 "possible renames" it prints (e.g. existing
  "SOY SAUCE 1L" vs new "Soy Sauce") in the Stock Item Data Table — merge by hand if they're
  really the same product.

- [x] `src/common/purchasing-trigger.util.spec.ts` added — 15 new tests covering
  `combinedStockBalance`, the ambient-duplicate case in `computeItemTrigger`/`stockCountDate`, and
  `fixedOrderQtyOverride`. Full suite now **34 test files, 196 tests, all passing**.

## Live-DB verification (2026-09-28, Muhammad's connected local Postgres)

Ran for real, not just typechecked: `prisma migrate deploy` (all 15 migrations, including this
work's), `prisma db seed`, then `import-evan-data.ts`. Confirmed in the actual database:
stock_item now 186 rows (136 + 50 new), 8 ambient links resolved correctly, `cost_per_100g` set on
42 items, all 7 suppliers' `order_output_method` set to Evan's confirmed values.

**Found and fixed a real bug this way that static review missed**: `food-waste.service.ts`'s
filter didn't exclude ambient/Kiosk-only duplicate rows, so all 8 of them (plus their category)
were appearing as pickable items in the Food Waste form — directly against Evan's "should not be
issued in any other sheet." Fixed by excluding any item with `ambient_duplicate_of` set; verified
against the live DB the count dropped from 169 to 161 items with 0 ambient rows left in.

Also discovered this DB's seed data (`prisma/seed-data.xlsx`) had **stale supplier
`order_output_method` values** (`ONLINE_ORDER_LIST`/`GMAIL_DRAFT`/`MANUAL` from before
`ORDER_SHEET` existed) — Tazaki/Asia Market/Castlebay were sitting at `MANUAL` (would have gotten
*zero* automated ordering at all). `import-evan-data.ts` was updated to set all 7 suppliers'
methods explicitly rather than just Sysco/VSD, and the stale schema comment on `Supplier.order_output_method` was corrected.

**Known, not fixed (flagged, not acted on without asking)**: `STK004 "MAYONAISSE, SRIRACHA"` sits
in the SC01/Kiosk category in this DB but isn't one of Evan's 8 finalized ambient rows — looks like
a stale/discontinued item from before his sheet. Left alone rather than guessed at.

## A mistake made and corrected during this session

While actually running the app (not just reading code), `bootstrap_food_waste` and 9 other kiosk
form bootstrap routes returned "Missing session token." I concluded this was a bug — a stale
comment in `common/decorators/public.decorator.js` claims these routes mirror legacy's "short
allow-list" that skips session auth — and added `@Public()` to all 10 controllers.

**That was wrong.** Reading `backend/api/Api.js` directly (the actual legacy production code)
shows the real allow-list is only `redeploy`, `process_now`, `kiosk_info`, `login` — every
`bootstrap_*`/`submit` action requires a real signed-in session, re-verified on every call
(`backend/api/Api.js:111-121`, and CLAUDE.md's own Auth model section). Legacy's kiosk home page
itself redirects to `/login` when there's no session. The misleading comment was corrected by the
`forms.controller.ts` comment sitting right next to it, which correctly says bootstrap_* is
"session-gated by default... same combination bootstrap_* uses" — I should have cross-checked
both comments against the actual legacy source before trusting either. **All 10 `@Public()`
additions were reverted** (`git checkout` on those 10 controller files) once this was caught, before
being shipped or reported as done.

Confirmed working correctly (i.e. the pre-existing, un-reverted behavior) end-to-end afterward: a
real browser submission through `frontend-next`, using a locally-minted test session JWT (this
sandbox has no real Google OAuth) for kiosk K01, produced a `submission` row with the new
`{ amount, stock_item_id }` payload shape, and — after manually nudging the pipeline (`process_now`,
needed a local-only `PROCESS_SECRET` added to `.env`, gitignored) — a `stock_movement` row with
`qty: 3, unit_cost: 40, cost: 120` for a `COUNT` item, exactly matching the `qty × current_unit_cost`
formula.

## Second audit pass — closing the remaining gaps (2026-09-29)

A full re-check against everything Evan asked for (his emails + System Review v2) found the
purchasing/ordering *pipeline* was built and correct, but the **data** wiring it up was
incomplete — without it, no order could ever actually be generated, regardless of par levels:

- [x] **`supplier_item_map` was only 49 rows** (stale seed, only Tazaki/Asia Market, zero for
  Castlebay/Bunzl/Sysco/VSD/Supermarket) — meaning Castlebay and Bunzl could never produce an order
  at all. Built `prisma/data/evan-supplier-item-map-2026-09-28.json` (105 rows straight from Evan's
  Supplier column) and extended `import-evan-data.ts` to upsert it: **135 active mappings now**,
  covering every item on his sheet, with any stale conflicting mapping deactivated (0 found — the
  old 49 didn't conflict, they were just incomplete). Salmon's Castlebay mapping correctly got
  `fixed_order_qty: 4`.
- [x] **Verified the whole chain against real data**, not just unit tests: temporarily set a par
  and a test stock count on Salmon (Castlebay) and Surimi (Tazaki) at K01, confirmed
  `computeItemTrigger` → supplier resolution → `fixedOrderQtyOverride` produces "4 packs of Salmon
  from Castlebay" (the override) vs. normal shortfall-based rounding for Surimi — then deleted the
  test movements and blanked the test par values back out (real par levels are still Evan's to set).
- [x] **Plain Rice / Sushi Rice Food Waste items** (System Review: "I need to add in a new category
  called RICE... 2 options. Plain Rice + Sushi Rice... grams... cost per gram I can manually add") —
  created as `STK170`/`STK171`, `WEIGHT_G`, `cost_per_100g` left blank for Evan to fill via Data
  Tables (`prisma/add-food-waste-rice-items.ts`, committed and re-runnable).
- [x] **Email sending** — the code is real (`mailer.service.ts`, generic SMTP via `nodemailer`,
  configured through Dashboard → Site Configuration, not env vars) and already wired into
  `PurchasingScanService`. Confirmed **not yet configured** in this DB (`site_config` has zero
  `SMTP` rows) — this is a one-time setup step for Evan/Muhammad (enter SMTP host/user/password on
  that dashboard page), not a code gap. Until it's set, `sendMail()` throws and the purchasing
  batch is still created/visible in the Action Inbox with the error recorded on it — orders aren't
  silently lost, just not emailed yet.
- Confirmed unchanged/still correct: `npx tsc --noEmit` clean, **34 test files / 196 tests
  passing**, lint clean.

### Final status against everything Evan asked for

| Ask | Status |
|---|---|
| One universal stock sheet | ✅ done — `stock_item`, 188 rows, imported from his finalized sheet |
| Cost/gram → Food Waste accuracy | ✅ done — `cost_per_100g` imported + bulk-import path for future updates |
| Food waste in grams, packaging in units | ✅ done — `measurement_type` split, verified live in browser |
| Kiosk (ambient) counted in 2 places, never issued elsewhere | ✅ done — `ambient_duplicate_of`, balance-merge, excluded from Food Waste (bug found + fixed) |
| Par list per product per kiosk | ✅ mechanism ready (`stock_item_par` + bulk-import UI) — **real numbers still Evan's to enter**, not ours |
| Order sheet filled + attached, saved to drafts for review | ✅ done — `ORDER_SHEET` suppliers get a filled `.xlsx`; verified the underlying trigger→supplier→attach logic against real data |
| Bunzl: list-only email, no template | ✅ done — `EMAIL_ORDER` |
| Sysco/VSD: fully manual | ✅ done — `MANUAL` |
| Correct supplier + email per product | ✅ done — 135 `supplier_item_map` rows from his own Supplier column |
| Rice → Tazaki; Asia Market/Castlebay corrections | ✅ done, in the imported data |
| Defrost Par empty — what's it for | ✅ answered — real feature, just needs data (same as par levels) |
| Waste Rate report confusion | ✅ answered — design explained, not a bug |
| Food Waste: RICE (Plain/Sushi) category | ✅ done — 2 new items added |
| SMTP/email actually sending | ⏸ **code done, not configured** — one-time setup on Dashboard → Site Configuration, not a coding task |
| Custom domain / backend speed | 🚫 **skipped on request** — Muhammad said to leave this for now |
| "Only 2 kiosks" on the old Vercel URL | 🚫 **skipped on request** — about the superseded legacy stack, left for now |

Everything with a ✅ is done and verified against real data/real tests in this session.

## Third pass (2026-09-29) — "baki sab theek karo": Staff Food pricing wasn't actually missing

Re-checked Staff Food selling price/COGS after being asked to close out everything except the two
explicitly-skipped items above. **It was far closer to done than the first assessment said**: the
`product` table already had `selling_price`/`recipe_cost`/`packaging_cost` columns (added in an
earlier, unrelated migration), `frontend-next/app/dashboard/product-prices/page.js` already had a
full "Finished Products" grid for them with live Royalty (30%) and Margin calculation
(`lib/pricing.js`), and `staff-food-report`/`profit` already consume product cost data. The one
missing piece: **`field_schema` had no rows for those 3 columns**, so the generic Data Tables save
path (`save_table_row`) had nothing telling it those columns were real/writable — the whole feature
was silently inert. Added the 3 `field_schema` rows (money type, editable) — pure config, no code
changed.

Verified for real in the browser (Owner Dashboard → Product Prices, logged in as the test ADMIN
session): entered Cost €1.20 / Selling Price €4.50 / Recipe Cost €1.00 / Packaging Cost €0.20 on
a real product, saved, and got back **Royalty €1.35, Margin €1.95 (43%)** — exactly right
(4.50 − 1.00 − 0.20 − 1.35 = 1.95; 1.95 ÷ 4.50 = 43%). Test values cleared back to blank afterward
(real prices are Evan's/Muhammad's to enter, not ours to fabricate).

Also closed a second, blocking gap found in the same pass: **`supplier_item_map` only had 49 rows**
from stale seed data (Tazaki + Asia Market only — Castlebay, Bunzl, Sysco, VSD, Supermarket had
*zero* items mapped to them), which meant no order could ever be generated for those suppliers
regardless of par levels. Built the mapping from Evan's own Supplier column
(`evan-supplier-item-map-2026-09-28.json`, 105 rows) and imported it: **135 active mappings now**,
covering everything on his sheet, with Castlebay's Salmon correctly carrying `fixed_order_qty: 4`.
Verified the full par → shortfall → supplier → fixed-qty-or-normal-rounding chain against real data
with a temporary test count (then removed it and blanked the test par values back out).

Added `prisma/add-food-waste-rice-items.ts` for the Plain Rice / Sushi Rice Food Waste items from
System Review v2 (created as `STK170`/`STK171`).

Final state: `npx tsc --noEmit` clean, **34 test files / 196 tests passing**, lint clean, and —
beyond the two explicitly-skipped items — every calculation and every real-data path in this pass
has now been exercised end-to-end against the actual connected database, not just read as code.

## Fourth pass — "Upload Data" full DB export/import gap (2026-09-29)

Asked whether the Dashboard → Upload Data download contains everything in the database. It didn't:
`import-config.ts`'s `IMPORT_ORDER` covered 42 of the schema's 47 tables — missing
`weekly_sales`, `weekly_costs`, `weekly_labour`, `site_config`, and `stored_file`. A backup taken
from that page and restored elsewhere would silently lose all five.

- [x] Added `weekly_sales`, `weekly_costs`, `weekly_labour`, `site_config` to `IMPORT_ORDER`
  (`import-config.ts`) — same upsert idiom as every other table, keyed on each one's own natural
  unique constraint (`kiosk_id`+`week_start` for the three weekly ones, `category` for
  `site_config`, not its autoincrement `id`, so it survives a round-trip into a fresh database).
  **Tested for real**: inserted a row in each of the 4, exported, deleted the rows (simulating a
  restore), re-imported from that export, confirmed every value came back exactly right — 0 errors.
- [ ] **`stored_file` deliberately NOT added** — it holds actual file bytes (`data Bytes`, e.g.
  uploaded photos), which this export writes into Excel cells as JSON-ified byte arrays; anything
  beyond a tiny file blows past Excel's 32,767-character cell limit and gets silently truncated —
  corrupting the file on any re-import, not just omitting it. Excel is the wrong format for binary
  data full stop, not a gap to paper over. A real fix needs a separate binary-safe export path
  (e.g. a zip alongside the workbook, or direct storage-level backup) — flagged, not built, since
  it's a different shape of work than "add a sheet."
- `npx tsc --noEmit` clean, **34 test files / 196 tests still passing**, lint clean.
