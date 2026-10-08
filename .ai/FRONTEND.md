# FRONTEND.md

Covers `frontend-next` (Next.js App Router) — the active-development frontend. For the legacy
static-HTML frontend, see `CLAUDE.md`.

## Routing model — URL-is-identity, same as legacy

`app/[slug]/` is the dynamic kiosk-slug segment — same "the URL itself carries kiosk identity,
not a lookup" model as the legacy `vercel.json` catch-all. `app/dashboard/` mirrors the legacy
dashboard pages. `app/enter`, `app/login`, `app/forbidden` mirror legacy auth pages.
`app/api/process-now/` is the Next.js route-handler equivalent of the legacy
`frontend/api/process-now.js` serverless function. See `AUTH.md` for the slug-lowercasing
middleware (`proxy.js`) and its `RESERVED_SEGMENTS` list — **any new top-level route name must be
added there**, or it gets misread as a kiosk slug.

## Data fetching — two hooks, use them instead of hand-rolling

`lib/queries.js`:
- `useBootstrap(action, params, options)` — TanStack Query read wrapper. Auto-disabled when
  `params` is `null`/`undefined` (the standard "don't fetch until we have a token" pattern).
- `useApiMutation(action, { onSuccess, onError })` — TanStack Query write wrapper.

Both call `apiCall()` (`lib/api.js`) under the hood — see `API.md`.

## Auth state

`lib/store/useAuthStore.js` (Zustand, persisted) — see `AUTH.md` for the full shape. Use the
`useAuthStore()` hook in components that need to re-render on auth changes; use
`useAuthStore.getState()/.setState()` for imperative, non-rendering call sites.

## Kiosk form building blocks (`components/kiosk/`)

Shared primitives every staff-facing form composes: `Wrap` (page container, `max-w-[30rem]` by
default — forms override with e.g. `sm:max-w-2xl md:max-w-3xl`), `KioskTopbar`, `LineCard` +
`FieldLabel` (a bordered card for one repeatable line-item row — category/item/qty style forms:
Morning Waste, Food Waste, Move Stock, Stocktake), `PhotoBox`, `StickyActionBar`, `FormBits`
(`FormActions`, `FormNote`, `ResultError`, `Spinner`, `SuccessPanel`).

**`LineCard`'s internal layout is `flex flex-col gap-2 sm:flex-row`** (mobile: stacked
full-width fields; `sm:`+: side-by-side) — this is a *shared* component used by at least Move
Stock and Food Waste, so a width/layout change here affects both. Field width classes on a
caller's wrapper `<div>` (e.g. `w-[9.5rem] flex-none`) must themselves be written responsively
(`w-full sm:w-[9.5rem] sm:flex-none`) or they override the stacking on mobile — see
`UI_RULES.md` and `DECISIONS.md` for a real bug this exact pattern caused.

## Dashboard — mostly React, one major exception

Most dashboard pages (`app/dashboard/*/page.js`) are ordinary React components using
`useBootstrap`/`useApiMutation`. **`components/dashboard/tables/DataTablesController.js`
(~2,660 lines) is vanilla DOM + Tabulator, not a React component** — it directly manipulates the
DOM and calls `apiCall()` itself rather than going through the React Query hooks. This backs
`pages/dashboard/tables` — the generic, schema-driven CRUD grid (see `DATABASE.md`'s
`TableSchema`/`FieldSchema`). Prefer extending the schema/DAL side over hand-rolling a new table
page, per `CLAUDE.md`.

Dashboard shared building blocks: `DashboardShell`, `PageHeader`, `SectionCard`, `RefreshButton`,
`DashSelect`, `ConfirmModal`/`noticeModal` (promise-based modal helpers, not native `confirm()`),
`EvidencePreview`.

## Styling

Tailwind CSS (`tailwind.config.js`/`postcss.config.js` present under `frontend-next/`). **Every
UI change must be verified at both desktop and mobile breakpoints** — this is a hard project
rule, see root `UI_RULES.md` (not duplicated here, read it directly) and
`feedback_ui_responsive_rules` in the maintainer's session memory.

## No test runner configured

Confirmed — `frontend-next/package.json` has no `test` script and no testing library in
`devDependencies`. UI changes are verified by compiling (`npm run dev` + checking the page
renders without a Next.js error overlay) and, where available, live browser automation — not by
an automated test suite. See `TESTING.md`.
