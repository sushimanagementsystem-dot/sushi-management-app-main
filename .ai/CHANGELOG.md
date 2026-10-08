# CHANGELOG.md

A running log of notable changes to the **new stack**, kept by whoever (human or agent) makes
them. Not a replacement for `git log` — this is for *why something changed*, in plain language,
findable without digging through commit messages (which in this repo are not very descriptive —
recent history is mostly generic "new review 5 has done"-style messages; see
`KNOWN_ISSUES.md`/note below). For full technical rationale behind any entry, see `DECISIONS.md`.

**Note on git history quality**: `git log --oneline -15` at the time this file was created shows
a long run of non-descriptive commit messages ("new review 5 has done" repeated, and some
entries that look like they belong to an unrelated project — "Fix onboarding exam reorder, New
Exam modal slow load, and Truecaller Firefox detection"). **Do not rely on `git log`/`git blame`
alone to understand recent intent in this repo** — this `CHANGELOG.md` and `DECISIONS.md` are
more reliable for that than the commit history is.

---

## 2026-10-08 (session, dated by git log context)
- Created `.ai/` knowledge base (this directory) — first pass, no application code touched.

## 2026-10-07 (session)
- Move Stock kiosk form: fixed half-width/broken-looking line-item layout on desktop (removed a
  `sm:grid-cols-2` wrapper that only looked right with exactly 2+ lines present); fixed a
  horizontal-scroll bug on mobile caused by the FROM/TO `<select>`s not having `w-full`/
  `min-w-0`; FROM/TO now stacks vertically on mobile instead of staying side-by-side.
- `LineCard` (shared kiosk-form component) made responsive: `flex-col` on mobile, `sm:flex-row`
  at `sm:`+ — affects both Move Stock and Food Waste. Field-width wrapper classes on both pages
  updated to match (`w-full sm:w-[Nrem] sm:flex-none`).
- Move Stock Qty field label made unit-aware (shows "Qty (box)"/"Qty (each)" etc. instead of a
  bare "Qty") so staff can tell what a quantity number means.
- Root `UI_RULES.md` created — mandatory desktop + mobile verification for every UI task from
  now on.
- Invoice Review: real-FK-based delete-reference checking, Force Delete cascade, and an
  `AuditLog`-backed undo system built (see `DECISIONS.md` for the full rationale chain).
- `InvoiceReviewService.correctLine()` added — fix an approved invoice line's qty/cost without
  reopening/undoing the invoice (see `DECISIONS.md`).
- `StockTransferReviewService.update()` widened to allow editing at `APPROVED` (not just
  `PENDING`); `TransferEditor` (frontend) gained a qty input field it previously lacked entirely
  (see `DECISIONS.md`).
- Food Waste category dropdown fixed to show all 3 categories (FOOD/PACKAGING/RICE) — a
  previously-missing `FOOD_WASTE_RICE_CATEGORIES` setting was added.
- `TableSchema.has_detail_view` fixed for `stock_item` (was `null`, should have been `true`) —
  restored visibility of the Par Levels "View" button.
- Fridge Count's RETIRED-product exclusion reverted (see `BUSINESS_LOGIC.md`/`DECISIONS.md`).
- Sushi Circle product plan-group bulk update from a client-provided Excel file (102 products);
  a missing retired product added; mistaken "Benchwarmer" title rows deactivated.

## Earlier
Not reconstructed this pass — see `git log` (with the caveat above about message quality) and
`final_changes_plan.md` (repo root) for a dated snapshot of an earlier round of planned/
completed work on the purchasing/food-waste pipeline.

---

**Maintenance note:** add a dated entry here whenever you ship a change to the new stack that a
future agent would benefit from knowing *happened*, even briefly — the detailed "why" belongs in
`DECISIONS.md`/`KNOWN_ISSUES.md`; this file is the short, scannable timeline.
