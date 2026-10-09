# API.md

## Routing model

One HTTP route per action (e.g. `POST /submit`, `POST /login`), **not** a single dispatch
endpoint — this is the opposite of the legacy Apps Script backend's single `doPost` + `action`
field in the body. `frontend-next/lib/api.js`'s `apiCall(action, data)` posts to
`${BACKEND_URL}/${action}`, confirming the convention from the caller side.

Default base URL in dev: `http://localhost:3000` (`NEXT_PUBLIC_BACKEND_URL` overrides it).

## Controllers (33, under `nest-backend/src/`)

- `app.controller.ts` — root/health.
- `auth/auth.controller.ts` — login, session handling.
- `kiosk/kiosk.controller.ts` — kiosk-token-gated bootstrap.
- `upload/upload.controller.ts` — file uploads.
- `pipeline/pipeline.controller.ts` — submission queue status/retry.
- `forms/forms.controller.ts` — the shared `submit` route (confirmed: single `@Post("submit")`
  handler in a `@Controller()` with no prefix).
- Per-form controllers under `forms/`: `food-waste`, `fridge-count`, `weekly-stocktake`,
  `monthly-audit`, `morning-waste`, `move-stock`, `staff-food`, `help-issue`, `damaged-product`,
  `delivery-invoice`, `audit-correction` — each exposes its own bootstrap route (loading
  kiosk-scoped reference data for that form), feeding into the shared `submit` route above.
- `import/import.controller.ts`, `import/import-database.controller.ts` — one-off import
  tooling, not normal runtime traffic.
- `dashboard/*/,*.controller.ts` — one per dashboard area: `action-inbox`, `audit-log`,
  `audit-result`, `bulk-import`, `data-tables`, `invoices-list`, `issues`,
  `kiosk-task-status`, `kpi`, `product-prices`, `profit`, `reports`,
  `settings` (`dashboard-settings.controller.ts`), `site-config`, `staff-food-report`,
  `stock-variances`, `submissions-monitor`.

A full per-route enumeration (every `@Post`/`@Get` path and DTO) was **not** produced here —
with 33 controllers this would duplicate the source and drift immediately on the next change.
To find a specific route: `grep -rn "@Post\|@Get" nest-backend/src/<module>/*.controller.ts`.

## Auth gating (see `AUTH.md` for the mechanism)

- Default: every route requires a valid session token (global `SessionAuthGuard`).
- `@Public()` opts a route out (used for `login`, kiosk-token-gated bootstrap/`submit` routes,
  and the one-off `redeploy`/`process_now`-equivalent secrets-based routes if present — confirm
  per-route with `grep -rn "@Public" nest-backend/src` before relying on this).
- `@Roles(...)` opts a route into role restriction; routes without it are open to any
  authenticated user regardless of role.
- Kiosk-token-gated routes additionally use `KioskTokenGuard` and read the resolved kiosk via
  `@CurrentKiosk()`.

## Response shape

Every response is normalized by the globally-registered `ResponseEnvelopeInterceptor`; errors go
through the globally-registered `HttpExceptionFilter`. Individual handlers do not shape their
own JSON — check those two files (`src/common/interceptors/`, `src/common/filters/`) rather than
guessing a response shape from one controller.
