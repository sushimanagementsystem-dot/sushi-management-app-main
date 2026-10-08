# ENVIRONMENT.md

## `nest-backend`

Loaded via `dotenv` (both by the Prisma CLI, through `prisma.config.ts`, and at runtime via
`ConfigModule.forRoot({ isGlobal: true })` + `ConfigService`). A real `.env` file exists at
`nest-backend/.env` (gitignored — not inspected for values, only confirmed to exist and contain
`DATABASE_URL`). **No `.env.example` file exists in the repo** — a new environment must be set
up by asking the project owner for real values, not by copying a template.

Confirmed-required variables (via `getOrThrow<string>(...)` call sites — app fails to start
without these):
| Variable | Used by |
|---|---|
| `DATABASE_URL` | `PrismaService` — Postgres/Neon connection string |
| `GOOGLE_CLIENT_ID` | `AuthService` — Google ID token verification |
| `IMPORT_SECRET` | Bulk/database import endpoints (one-off secret, not session auth) |
| `PROCESS_SECRET` | `/process_now` relay (server-side only, matches legacy `PROCESS_SECRET`) |
| `SESSION_JWT_SECRET` | Session JWT signing/verification; also the fallback key-derivation source for `SecretsService` if `SECRETS_ENCRYPTION_KEY` isn't set |

Confirmed-optional (via `get<string>(...)`, no throw if missing):
| Variable | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | Invoice AI — fallback if no encrypted key saved via Settings |
| `INVOICE_AI_MODEL` | Which Claude model the invoice extractor uses |
| `SECRETS_ENCRYPTION_KEY` | Decouples secret-encryption key from `SESSION_JWT_SECRET` — recommended in production, see `SECURITY.md` |

| `PORT` | `main.ts` — defaults to `3000` if unset |

UNKNOWN — needs inspection: SMTP credentials are stored as an owner-configurable `site_config`
row (category `"SMTP"`), not environment variables (see `INTEGRATIONS.md`) — confirm there isn't
also an env-var fallback for SMTP before assuming none exists.

## `frontend-next`

| Variable | Used by | Default if unset |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `lib/api.js`'s `BACKEND_URL` | `http://localhost:3000` |

No other environment variables found referenced in `frontend-next` source this pass.

## Legacy stack

Per `CLAUDE.md`: an untracked `.deploy.env` (`BACKEND_URL`, `API_SECRET`) at the repo root for
`deploy.sh`, and `backend/.clasp.json` (gitignored, not regeneratable from repo contents) for
`clasp push` to know its Apps Script project target. Apps Script's own config
(`backend/appsscript.json` — manifest, webapp access/executeAs, oauth scopes, timezone) is
tracked in git but, per `KNOWN_ISSUES.md`, currently absent from this working directory.

## Secrets in the database vs. in the environment

Not every credential lives in an env var — see `SECURITY.md`'s `SecretsService`: some
(Anthropic API key, SMTP) are owner-entered through the dashboard and stored **encrypted in the
database**, with env vars as a fallback/bootstrap path only. Don't assume "it's not in `.env`"
means "it's not configured."
