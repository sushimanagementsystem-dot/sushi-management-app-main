# INTEGRATIONS.md

Third-party services the **new stack** talks to. For the legacy stack's integrations (same
Google/SMTP shape, per `CLAUDE.md`), see `CLAUDE.md`.

## Google (Sign-In)
- `google-auth-library`'s `OAuth2Client`, constructed with `GOOGLE_CLIENT_ID`
  (`src/auth/auth.service.ts`). `login` verifies a Google ID token
  (`googleClient.verifyIdToken()`) and mints a session JWT on success. This is the only Google
  integration confirmed in the new stack's code — no Google Sheets/Drive API usage found here
  (that's the legacy stack's datastore, not this one's).

## Anthropic Claude API
- `@anthropic-ai/sdk`, used in exactly one place: `src/production-engine/invoice-ai.service.ts`
  — extracts and matches delivery-invoice line items to stock items from an uploaded invoice
  image/PDF (mirrors the legacy `forms/InvoiceAI.js`'s `callClaudeMessages_`, per `CLAUDE.md`).
  Model/API key read via `claude()` method — model is configurable (`INVOICE_AI_MODEL` setting),
  API key via `ANTHROPIC_API_KEY`. `POST /test_anthropic_connection` (dashboard settings)
  verifies connectivity without a real invoice.
- API key can be entered by the owner on the Settings page; stored encrypted (see `SECURITY.md`'s
  `SecretsService`) rather than only via environment variable, with env-var `ANTHROPIC_API_KEY`
  as a fallback if a saved one can't be decrypted (observed live this session: "Saved Anthropic
  key could not be decrypted — falling back to the environment key" warning, meaning this
  fallback path is exercised in practice, not just theoretical).

## SMTP (outbound email)
- `nodemailer`, generic SMTP — **not tied to a specific provider**. Fully owner-configurable via
  the Site Configuration dashboard page (`category: "SMTP"`), not environment variables; the
  owner can use Gmail, Office365, or any SMTP relay and change it without a redeploy.
  `MailerService` (`src/mailer/mailer.service.ts`) builds the transporter lazily and caches it,
  invalidated on any write to the SMTP `site_config` row. `POST /test_mail_connection` verifies
  connectivity.
- Used for: purchasing-scan supplier order emails, production plan email (Sushi Circle),
  stocktake-confirmation follow-up order drafts, audit report emails.

## Postgres / Neon
- Not a third-party "integration" in the API-call sense, but worth flagging: Neon's
  **serverless compute-suspend** behavior is the reason `PrismaService` hand-builds a long-lived
  `pg.Pool` (`idleTimeoutMillis: 0`) instead of a bare connection string — see `ARCHITECTURE.md`.
  A fresh connection after idle-suspend was measured at ~3s to wake vs. ~275ms once warm.

## No N8N integration
Confirmed via repo-wide search (`grep -ri n8n`, excluding build caches) — every match was inside
`frontend-next/.next/` Turbopack build cache filenames (coincidental `n8n`-looking strings in
cache file hashes), not actual code or configuration. See `N8N.md`.

## Secrets storage
See `SECURITY.md` for `SecretsService` (AES-256-GCM encryption of API keys/passwords before
they're written to the database).
