# AUTH.md

Covers the **new stack**. For the legacy stack's auth model (kiosk token + Google ID token
exchange + session token, `isOwnerRole_()` per-action gating), see `CLAUDE.md` — the new stack's
model is directly descended from it but restructured as global guards; both are described here
for comparison.

## Two separate credentials, same as legacy

1. **Kiosk identity** — a secret `token` baked into a kiosk's share link (`?token=` on
   `/enter`), never staff input, no session required. Verified via `KioskTokenGuard`
   (`src/common/guards/kiosk-token.guard.ts`) on `bootstrap_*` and `submit` routes. Resolved
   kiosk is available via `@CurrentKiosk()`.
2. **User identity (owner/dashboard)** — `POST /login` exchanges a Google ID token (verified
   against Google via `google-auth-library`) for a session JWT (`SESSION_JWT_SECRET`-signed,
   minted/verified in `src/auth/auth.service.ts`). Every other non-`@Public()` route re-verifies
   this JWT **and** re-checks the user is still active on every single call, not just at login.

## Guard chain — global by default (inverse of the legacy backend)

Legacy: each action individually calls `isOwnerRole_()`. New stack: **every route is guarded by
default**, and opts out. Registered as `APP_GUARD`s in `app.module.ts`, in this order:

1. **`SessionAuthGuard`** (`src/common/guards/session-auth.guard.ts`) — reads
   `request.body?.sessionToken`. Missing/invalid → `401 Missing session token.` (or whatever
   `AuthService.verifySession()` throws). Sets `request.user` and
   `request.refreshedSessionToken` (the sliding-expiry refresh, re-sent on every successful
   response — see `API.md`). Skipped entirely if the handler/class has `@Public()`
   (`src/common/decorators/public.decorator.ts`).
2. **`RolesGuard`** (`src/common/guards/roles.guard.ts`) — checks `@Roles(...)`
   (`src/common/decorators/roles.decorator.ts`) against `request.user.role`. Seen values:
   `"ADMIN"`, `"DEVELOPER"` (the entire `ActionInboxController` is `@Roles("ADMIN", "DEVELOPER")`
   at the class level — every action-inbox route requires owner role).

Kiosk-facing routes additionally run `KioskTokenGuard` (resolves `@CurrentKiosk()`), separate
from the two guards above — session auth and kiosk-token auth are independent, a route uses
whichever credential fits its actor (staff vs. owner).

## Decorators (`src/common/decorators/`)

- `@Public()` — opts a route out of `SessionAuthGuard` entirely (login, kiosk-token-only routes).
- `@Roles(...roles: string[])` — declares required role(s) for `RolesGuard`.
- `@CurrentUser()` — param decorator, pulls the resolved user off `request.user`.
- `@CurrentKiosk()` — param decorator, pulls the resolved kiosk off the request (set by
  `KioskTokenGuard`).

**Rule for new owner-only routes**: add `@Roles("ADMIN", "DEVELOPER")` (or whatever the handler
actually needs) — there is no fallback safety net; an un-annotated route is session-gated (any
logged-in user, any role) but not role-gated.

## Frontend auth state (`frontend-next`)

- `lib/store/useAuthStore.js` — Zustand store, persisted to `localStorage`:
  - `sessionToken` — the owner/dashboard session (device-wide, covers every kiosk).
  - `kiosks: { [slug]: { token, name } }` — per-kiosk-slug kiosk tokens, keyed by **lowercased**
    `kiosk_id` (see `proxy.js`'s slug-lowercasing — a mismatch here was a real bug, see
    `KNOWN_ISSUES.md`/`DECISIONS.md`).
  - `allowedSlugs` — a UX-only cache of "this device already passed a role check for this
    slug"; **never trusted as real authorization** — every data-bearing call still re-verifies
    server-side regardless (mirrors the legacy frontend's `requireRole()` being UX-only per
    `CLAUDE.md`).
- `lib/api.js`'s `apiCall()` auto-attaches `sessionToken` on every call and auto-re-stores
  whatever refreshed token comes back — no page manages this itself.
- Components that need to re-render on auth changes use the `useAuthStore()` hook; imperative
  call sites (e.g. a mount-effect redirect check) use `useAuthStore.getState()/.setState()`
  directly.

## Kiosk slug → token resolution gotcha

Kiosk links are shared with the kiosk's real casing (e.g. `K01`), but `/enter` always stores the
token under `kiosk_id.toLowerCase()`, and every kiosk page reads the slug straight from the URL
with no normalization of its own. `frontend-next/proxy.js` (Next's middleware-equivalent)
lowercases the URL itself before routing so every downstream reader sees a consistent slug —
this was added specifically because the mismatch produced an unrecoverable "Access denied" for
real staff on a real link. `RESERVED_SEGMENTS` in `proxy.js` (`api`, `dashboard`, `enter`,
`forbidden`, `login`) must get any new top-level route name added, or that route name is
misread as a kiosk slug.

## Verifying auth live without the browser

Mint a session JWT directly — see `API.md`'s "Verifying a route live" section. Requires
`SESSION_JWT_SECRET` from `nest-backend/.env` and a real `User.user_id`.
