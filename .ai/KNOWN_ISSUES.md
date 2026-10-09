# KNOWN_ISSUES.md

Confirmed drift/risks found during this audit (2026-10-09), not assumptions.

## 1. Root `CLAUDE.md` and `README.md` describe a stack that no longer exists in the tree

Commit `4b483ed` ("new review 5 has done", 2026-10-08) deleted every file under `backend/` and
`frontend/` (83 files, -18191/+1818 lines) — the entire legacy Google-Apps-Script + static-site
stack. Both root `CLAUDE.md` and root `README.md` still describe `backend/`/`frontend/` in full
detail as if present (file trees, routing rules, `deploy.sh` usage, etc.), with no note that
they were removed. Anyone reading those two files cold would believe the legacy stack still
exists on disk. This `.ai/` knowledge base documents the active stack only — see `.ai/README.md`.

**Action for a human:** update root `CLAUDE.md`/`README.md` to either (a) drop the legacy-stack
sections and `deploy.sh` instructions entirely, or (b) explicitly mark them "historical — removed
from the working tree in `4b483ed`, see git history to recover" if the team still wants that
narrative preserved for context.

## 2. `deploy.sh` is dead code against the current tree

See `DEPLOYMENT.md`. It references `backend/` paths that no longer exist; running it today
silently no-ops the clasp/redeploy half rather than erroring, which could mislead someone into
thinking a deploy happened.

## 3. A previous `.ai/` knowledge base was created and deleted on the same day

Commit `4b483ed` (same commit that deleted the legacy stack) *also* added a full `.ai/`
directory (README, PROJECT, ARCHITECTURE, API, AUTH, BACKEND, DATABASE, DECISIONS, DEPLOYMENT,
ENDPOINTS, ENVIRONMENT, FILE_STRUCTURE, FRONTEND, INTEGRATIONS, KNOWN_ISSUES, N8N, SECURITY,
TASK_PROTOCOL, TESTING, CONVENTIONS, CHANGELOG — 22 files). The very next commit, `bade7e8`
(HEAD), deleted all 22 of those files and added nothing else. Notably that prior attempt
included an `N8N.md` despite no n8n integration existing anywhere in this repo — exactly the
speculative-file anti-pattern this kind of audit is supposed to avoid, which may be *why* it was
deleted. This pass does not recreate `N8N.md`, `CHANGELOG.md` (git log already serves that), or
`ENDPOINTS.md`/`FILE_STRUCTURE.md` as separate files (folded into `API.md`/`ARCHITECTURE.md`
instead, to avoid re-fragmenting thin content) — see `.ai/README.md` for the current file list
and rationale.

## 4. Root `CLAUDE.md`'s test-coverage claim for `nest-backend/` is stale

States coverage is "currently thin (one `.spec.ts`, one `.e2e-spec.ts`)". Actual count as of this
audit: 45 unit spec files across nearly every module, still only 1 e2e spec. See `TESTING.md`.

## 5. No `.env.example` in `nest-backend/`

The required env vars (`DATABASE_URL`, `SESSION_JWT_SECRET`, `GOOGLE_CLIENT_ID`,
`ANTHROPIC_API_KEY`, `PROCESS_SECRET`, optional `PORT`/`SECRETS_ENCRYPTION_KEY`) are only
discoverable by reading `ConfigService.get(...)`/`getOrThrow(...)` call sites or the local,
gitignored `.env`. A new environment setup has no template to start from.

## 6. No deploy or CI tooling exists for the active stack

No `.github/workflows/`, no other CI config, no confirmed deploy mechanism for
`nest-backend`/`frontend-next` found in-repo — yet `final_changes_plan.md` confirms real
production data already flows through this stack for a live client. How it actually reaches
production is undocumented. See `DEPLOYMENT.md`.

## 7. Mailer (SMTP) configuration source is unconfirmed

`nodemailer` is used for several email features (production plan, purchasing orders, audit
reports) but this audit did not find SMTP credentials in the local `.env`, and didn't trace
`mailer.service.ts` far enough to confirm whether they come from a different env, from
`SiteConfig` (like the Anthropic key), or elsewhere. Flagged as `UNKNOWN` in `INTEGRATIONS.md`
rather than guessed.
