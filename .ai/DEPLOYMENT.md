# DEPLOYMENT.md

## Current state: no deploy tooling exists for the active stack

`nest-backend/package.json` has a `"deploy": "nest deploy"` script backed by `@nestjs/mau`
(Nest's own hosted-deploy CLI, present in `devDependencies`), but nothing in the repo configures
it (no `mau.config` or equivalent found) — UNKNOWN whether this has ever been run or is just the
Nest CLI scaffold default. `frontend-next` has no deploy script beyond the standard
`next build && next start`; no Vercel project config (`vercel.json`) exists for it.

No CI config exists anywhere in the repo (no `.github/workflows/`, no other CI directory found).

## `deploy.sh` (repo root) is dead code against the current tree

`deploy.sh` is written entirely for the **deleted** legacy stack: it checks
`git status --porcelain -- backend` and runs `clasp push` from a `backend/` directory that no
longer exists (deleted in commit `4b483ed`, see `.ai/README.md` and `KNOWN_ISSUES.md`). Running
it today would not error loudly — `git status --porcelain -- backend` on a nonexistent path just
returns empty, so `BACKEND_CHANGED` stays false and the clasp step is silently skipped — but it
also does nothing useful for `nest-backend/`/`frontend-next/`. Root `CLAUDE.md`'s "Commands"
section still documents `deploy.sh` as *the* deploy workflow without noting this.

## How the active stack is actually deployed today

UNKNOWN — not evidenced in the repo. `final_changes_plan.md` implies real production data exists
(client "Evan" has live stock data via `nest-backend`'s own Postgres), so *some* deployment
exists, but how `nest-backend`/`frontend-next` get to production (hosting provider, env var
management, migration-run step) is not documented anywhere in-repo. This is worth asking the
user/Muhammad directly rather than guessing — do not assume Vercel/Railway/Render/etc. without
confirmation.
