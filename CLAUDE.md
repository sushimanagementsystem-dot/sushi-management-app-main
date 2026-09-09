# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Sushi kiosk management system (monorepo, merged from two separate repos 2026-07-28). Staff at
each kiosk submit forms (waste, stocktake, deliveries, audits, etc.); an owner dashboard reviews
and manages that data. No package.json, no build step, no test framework anywhere in this repo —
it's plain JS deployed as-is.

```text
backend/            Google Apps Script — clasp's rootDir. doPost-only, no page-serving code.
  appsscript.json      manifest (webapp access/executeAs, oauth scopes, timezone)
  core/                shared infrastructure: Config, DAL, Util, Auth, Upload
  api/                 Api (doPost router), Deploy (self-redeploy), Pipeline (async inbox)
  forms/               the 11 staff-facing forms
  engine/              production plan computation (incl. secondary-item rice allocation) + email
  dashboard/           DataTables.js, the owner dashboard's generic grid engine

frontend/            Static site — Vercel's Root Directory. Plain HTML/CSS/JS, no framework.
  vercel.json          routing — see below for the scheme (JSON has no comment syntax)
  api/                 one Vercel serverless function (process-now.js), Node/CommonJS
  assets/              shared JS/CSS, referenced root-relative (/assets/...) from every page
  pages/
    auth/                index, login, enter, forbidden
    kiosk/               home + the 11 staff forms (kiosk identity via URL slug, not a file)
    dashboard/           dashboard (shell) + tables (Data Tables), inbox, kpi, settings, etc.
```

The data store is a Google Sheet, accessed only through `backend/core/DAL.js` — there is no
database beyond that spreadsheet.

## Commands

There's no build/lint/test tooling — this repo has no `package.json`. The only workflow is
edit → deploy:

```bash
./deploy.sh [patch|minor|major] ["commit message"]
```

- Single commit for the whole repo (`git add -A && git commit && git push`).
- Only pushes to Apps Script (`clasp push -f` from `backend/`) and calls the `redeploy` API
  action if `backend/` has tracked changes in that run — a frontend-only change skips both.
- Vercel deploys the frontend on push automatically; no script step needed for that.
- Version is tracked in `.version` (gitignored) and stamped into the commit message as
  `Deploy V<version>`.
- Requires an untracked `.deploy.env` with `BACKEND_URL` (the GAS `/exec` URL) and
  `API_SECRET`.

`backend/.clasp.json` (gitignored) must exist locally for `clasp push` to know which Apps
Script project to target — it's not something Claude can regenerate from repo contents.

There is no local dev server for the backend (Apps Script only runs deployed) or automated way
to preview the frontend other than opening the HTML files directly or pushing to Vercel — treat
edits as review-then-deploy, not run-then-verify.

## Backend architecture (`backend/`, Google Apps Script)

**Single entry point.** Everything goes through `doPost` in `api/Api.js`, which parses
`{ action, token, sessionToken, ... }` and dispatches in `route_()`. There is no page-serving
code in Apps Script at all — the frontend is 100% static, hosted separately on Vercel, and talks
to this `/exec` URL directly via CORS-readable `fetch`.

**Auth model (`core/Auth.js`):**
- **Kiosk identity** comes from a secret `token` baked into the kiosk's URL link — never staff
  input. `kiosk_info` and the `bootstrap_*` form actions accept this token with no session
  required (staff haven't signed in yet at that point).
- **User identity**: `login` exchanges a short-lived Google ID token (verified against Google)
  for a 30-day-sliding session token (`Auth.js` mint/verify). Every other action requiring a
  user re-verifies that session token *and* re-checks the user is still active — not just at
  login. `apiCall()` in `assets/common.js` attaches the stored session token automatically and
  re-stores whatever refreshed token comes back on every response, so pages never manage this
  themselves.
- **Role gating is enforced server-side, per action**, via `isOwnerRole_()` (ADMIN/DEVELOPER) in
  `route_()` — not a systemic middleware. The frontend's own `requireRole()` check is UX only;
  a signed-in STAFF session token is otherwise indistinguishable from an owner's, so **every new
  dashboard-only action must call `isOwnerRole_()` itself**, following the existing pattern in
  `Api.js`.
- Two actions bypass session auth entirely and use separate one-off secrets instead:
  `redeploy` (`API_SECRET`, called only by `deploy.sh`) and `process_now` (`PROCESS_SECRET`,
  called only server-side by the Vercel relay, never the browser — see below).

**Data access (`core/DAL.js`).** All reads/writes go through `getRows`/`getRow`/etc., which map
sheet rows to plain objects **by header name**, never column index. Table names are the sheet
tab names, centralized in `core/Config.js`'s `TABLES` map — add new tables there, not as string
literals. Row objects carry a hidden `_row` (1-based sheet row) used internally for updates;
never persist it as a column. Writes take the script lock; reads don't.

**Async submission pipeline (`api/Pipeline.js`).** Form submits (`submit` action) land in a
`submission` queue table rather than being processed inline; `api/Deploy.js` and a time-driven
trigger sweep it periodically. `kickProcessing()` (see below) nudges this to happen immediately
after a real submit instead of waiting for the sweep — the sweep is always the fallback if that
nudge fails.

**Forms (`forms/`)** — one file per staff-facing form (`FormMorningWaste.js`,
`FormStocktake.js`, etc.), each exposing a `bootstrap_*` (load kiosk-scoped reference data) and
feeding into the shared `submit` action in `Api.js`. `engine/` computes production plans from
that data and sends related email (`EngineEmail.js`/`EngineEmailRender.js`).

`FormDeliveryInvoice.js` calls out to `forms/InvoiceAI.js`, which sends uploaded invoice files
to the Claude API (`callClaudeMessages_`) to extract and match line items to stock items before
returning draft `invoice_line` rows — the one place in the backend that calls an external LLM.


**Dashboard backend (`dashboard/`)** mirrors the frontend dashboard's needs one file per area:
`DataTables.js` (generic CRUD grid engine backing `tables.html`), `ActionInbox.js`, `Kpi.js`,
`Purchasing.js`, `Settings.js`.

## Frontend architecture (`frontend/`)

Plain static HTML/CSS/JS — no framework, no bundler, no npm dependencies. Every page includes
`/assets/common.js` (root-relative, works from any route depth) for `apiCall()`, session token
storage, file-upload compression, and kiosk-slug resolution; dashboard pages additionally
include `dashboard-common.js`.

**Routing (`vercel.json`)** rewrites URLs to physical files; `cleanUrls: true` strips `.html`.
Order matters — **literal routes are listed before the generic `/:slug` ones on purpose**, so a
real page name (`login`, `dashboard`, etc.) is never misread as a kiosk slug. When adding a new
top-level route, add its literal rule *above* the catch-all slug rules.

**Kiosk identity is purely a URL artifact**, not a filename: visiting `/k01/home` serves
`pages/kiosk/home.html` but the browser keeps `/k01/home` in its address bar, and
`getSlugFromPath()` in `common.js` reads that path client-side to know which kiosk it is. The
slug itself (lowercased `kiosk_id`) is just a label with no authority — the real credential is
the kiosk `token` from the `?token=` link on `enter.html`, then persisted in `localStorage` per
slug. A page can render its shell without that token, but nothing that calls the API for real
data works without it.

**`frontend/api/process-now.js`** is the one Vercel serverless function in the repo (Node,
CommonJS — no `"type": "module"` anywhere to create ESM/CJS ambiguity). It's a fire-and-forget
relay: the browser calls `/api/process-now` right after a successful form submit
(`kickProcessing()` in `common.js`), and this function makes the actual GAS call *server-side*
so it completes even if the tab closes immediately. It requires its own env vars in the Vercel
project (`GAS_BACKEND_URL`, `GAS_PROCESS_SECRET`) distinct from the frontend's hardcoded
`BACKEND_URL` in `common.js`.

**`pages/dashboard/tables.html`** is a generic Data Tables grid driven by backend schema
(`bootstrap_data_table`/`bootstrap_tables_page` return schema + rows + every referenced
table/enum in one call) — it's config-driven, not one hand-built table per entity. Prefer
extending the schema/DAL side over hand-rolling a new table page.

## Adding a new kiosk form

Following the existing 11 (`forms/Form*.js` + matching `pages/kiosk/*.html`) is the fastest path
to correctness: add a `FORM_TYPES` entry (`core/Config.js`), a `bootstrap_*` + handling in the
`submit` path in `forms/`, wire the two new actions into `route_()` in `api/Api.js`, and add the
page under `pages/kiosk/` referencing `/assets/common.js`.
