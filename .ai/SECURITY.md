# SECURITY.md

Observations from this pass — not a formal audit. Items under "Open items" are genuinely
unresolved; don't treat their presence here as "already handled."

## Auth model
See `AUTH.md` for full detail. Two independent credentials (kiosk token, session JWT), global
guards applied by default (deny-unless-opted-out, not opt-in) — a safer default than the legacy
backend's per-action `isOwnerRole_()` calls, which rely on every new handler remembering to add
the check.

## Secrets at rest — encrypted, not plaintext

`SecretsService` (`src/secrets/secrets.service.ts`) encrypts saved secrets (API keys, SMTP
passwords entered via the dashboard) with AES-256-GCM before writing them to the database —
explicitly so a database dump or read-only SQL access never exposes the plaintext credential.
Authenticated encryption (GCM), so a tampered ciphertext fails to decrypt rather than silently
decrypting to garbage.

**Key management caveat, stated directly in the code's own comment**: the encryption key is
`SECRETS_ENCRYPTION_KEY` if set, otherwise **derived from `SESSION_JWT_SECRET`** via HKDF.
Consequence: rotating `SESSION_JWT_SECRET` (e.g. in response to a suspected session-token leak)
silently makes every previously saved secret undecryptable until re-entered, unless
`SECRETS_ENCRYPTION_KEY` was set independently. **Recommendation surfaced during this project's
own "is the database proper" review and not yet acted on**: set `SECRETS_ENCRYPTION_KEY`
explicitly in production so the two concerns (session signing, secret encryption) can be rotated
independently. See `KNOWN_ISSUES.md`.

## Response error handling

No raw database error ever reaches the client — see `BACKEND.md`'s `explainWriteError()`/
`friendlyDbError()`. This is a deliberate, actively-maintained property (a real leak of a raw
`fridge_count_product_id_fkey` constraint name to a non-technical owner is the documented reason
it was hardened further this project).

## Destructive actions require explicit, separate confirmation

Hard-delete, when it's reference-blocked, requires a deliberately separate "Force delete"
action with its own strong confirmation UI — never a silent retry. See `DECISIONS.md`.

## Open items (verified, unresolved — do not assume fixed)

1. **DB credential rotation** — recommended during a database-quality review this project,
   not performed. Confirm current rotation status with the project owner before assuming
   current credentials are fresh.
2. **`SECRETS_ENCRYPTION_KEY` not confirmed set** — see above; if unset, secret encryption is
   silently coupled to session-signing key rotation.
3. **Schema/DB drift**: `purchasing_batch_supplier_id_fkey`'s live `ON DELETE` behavior doesn't
   match what a fresh `prisma migrate dev` wants to generate — not itself a security issue, but
   an unresolved integrity-constraint discrepancy that could mask a real referential-integrity
   gap. See `KNOWN_ISSUES.md`.
4. **Legacy stack's source absent from working tree** (`backend/`, `frontend/` — 60 files,
   uncommitted deletion) — not investigated further this pass. If this turns out to be
   unintentional, it has no direct security implication by itself, but any assumption about
   "what the legacy backend currently does" should be re-verified against `git show
   HEAD:backend/...` rather than the (currently absent) working-tree files. See
   `KNOWN_ISSUES.md`.

## Not evaluated this pass

Rate limiting, CSRF posture (session token travels in JSON body, not a cookie, which sidesteps
classic CSRF but wasn't independently verified as the actual mitigating reasoning in the code),
dependency vulnerability scanning, input sanitization beyond `class-validator` DTO validation,
upload file-type/size enforcement beyond the 25MB body limit. Mark each UNKNOWN until explicitly
reviewed.
