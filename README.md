# sushi-management-app

Sushi kiosk management system — monorepo (merged from two separate repos 2026-07-28).

```text
backend/            Google Apps Script — clasp's rootDir. doPost-only, no page-serving code.
  appsscript.json      manifest (webapp access/executeAs, oauth scopes, timezone)
  core/                shared infrastructure: Config, DAL, Util, Auth, Upload
  api/                 Api (doPost router), Deploy (self-redeploy), Pipeline (async inbox)
  forms/               the 11 staff-facing forms
  engine/              production plan computation + email
  dashboard/           DataTables.js, the owner dashboard's generic grid engine

frontend/            Static site — Vercel's Root Directory. Plain HTML/CSS/JS, no framework.
  vercel.json          routing — see below for the scheme (JSON has no comment syntax)
  assets/              shared JS/CSS, referenced root-relative (/assets/...) from every page
  pages/
    auth/                index, login, enter, forbidden
    kiosk/               home + the 11 staff forms (kiosk identity via URL slug, not a file)
    dashboard/           dashboard (shell) + tables (Data Tables)
```

`vercel.json` routing: `/` → `pages/auth/index`, `/login` `/enter` `/forbidden` → their
`pages/auth/*` file, `/dashboard` → `pages/dashboard/dashboard`, `/dashboard/<page>` →
`pages/dashboard/<page>` (so `/dashboard/tables` and the deep-linkable
`/dashboard/tables/<table>` both resolve to `pages/dashboard/tables.html`), and any other
`/<slug>` or `/<slug>/<page>` is treated as a kiosk URL → `pages/kiosk/home` or
`pages/kiosk/<page>` — kiosk identity comes from the slug in the URL path (read client-side
in `assets/common.js`), never from which file got served. Literal routes are listed before
the generic `/:slug` ones in `vercel.json` on purpose — first match wins, so a real page
name (like `login`) never gets misread as a kiosk slug.

Deploy both (or just whichever changed) from the repo root:

```bash
./deploy.sh [patch|minor|major] ["commit message"]
```

One commit for the whole repo; the Apps Script `clasp push` + redeploy step only runs if
`backend/` actually has tracked changes. Vercel deploys the frontend on push by itself.
