# DEPLOYMENT.md

## New stack — no deploy tooling exists yet

Confirmed this pass: no CI workflow files anywhere in the repo (`find . -iname "*.yml" -o -iname
"*.yaml"` under the repo, excluding `node_modules`/`.next`, returned nothing), no `vercel.json`
found under `frontend-next/`, no deploy script referencing `nest-backend` or `frontend-next`.
Each half has its own `package.json` with standard build/start scripts
(`nest-backend`: `npm run build` → `nest build`, `npm run start:prod` → `node dist/main`;
`frontend-next`: `npm run build` → `next build`, `npm run start` → `next start`) but no
documented hosting target, no Dockerfile found, no deploy pipeline. **Treat any claim about
"how the new stack deploys to production" as UNKNOWN until Muhammad/the project owner confirms
it** — do not assume it mirrors the legacy Vercel+Apps-Script setup.

## Legacy stack — fully documented, see `CLAUDE.md`

Summary only (CLAUDE.md is the authoritative source):
```bash
./deploy.sh [patch|minor|major] ["commit message"]
```
- Single commit for the whole repo.
- `clasp push -f` from `backend/` + a `redeploy` API call, only if `backend/` has tracked
  changes in that run.
- Vercel auto-deploys `frontend/` on push — no script step for that half.
- Version tracked in a gitignored `.version` file, stamped into the commit message as
  `Deploy V<version>`.
- Requires an untracked `.deploy.env` (`BACKEND_URL`, `API_SECRET`) and a gitignored
  `backend/.clasp.json` — neither can be regenerated from repo contents; ask the project owner
  for them if a legacy deploy is ever actually needed.

**Caveat**: `backend/`'s source files are currently absent from this working directory (see
`KNOWN_ISSUES.md`) — `deploy.sh` as written would have nothing to push for that half until
that's resolved.

## No local dev server for the legacy backend

Apps Script only runs deployed — there is no way to run/preview it locally. Treat legacy-stack
edits as review-then-deploy, never run-then-verify (per `CLAUDE.md`).

## New stack local dev

```bash
cd nest-backend && npm install && npm run start:dev    # needs DATABASE_URL
cd frontend-next && npm install && npm run dev          # needs NEXT_PUBLIC_BACKEND_URL (optional, defaults localhost:3000)
```
See `ENVIRONMENT.md` for required variables.
