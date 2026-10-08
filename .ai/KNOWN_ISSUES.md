# KNOWN_ISSUES.md

Genuine, verified-live findings — not speculation. Each entry states how it was confirmed and
its current status. Update status here as items are resolved; don't let this file silently go
stale (per `README.md`'s freshness rule).

---

### 1. Legacy stack's source files are absent from the working directory (uncommitted deletion)
**Status: open, unexplained, NOT fixed.**
`git ls-tree HEAD` shows `backend/` and `frontend/` as tracked directories (git history has
them). `git status` in this working copy shows all ~60 files under `backend/` (and presumably a
similar set under `frontend/` — not individually counted) as locally deleted, **uncommitted**.
Confirmed via direct `git status --short` / `git ls-tree HEAD` inspection on 2026-10-08.
**Do not** stage or commit this deletion, and do not assume it means the legacy stack is being
retired — nothing else in the repo (commit messages, planning docs) corroborates an intentional
decommission. Ask the project owner before touching this. If you need to read a legacy-stack
file, use `git show HEAD:backend/path/to/file.js` rather than assuming the working-tree copy
exists.

---

### 2. `purchasing_batch_supplier_id_fkey` schema/DB drift
**Status: flagged, NOT fixed, open.**
A `prisma migrate dev --create-only` run (while building an unrelated hand-written migration)
auto-generated an additional migration changing this constraint's `ON DELETE` behavior —
discovered by inspecting the generated SQL (`DropForeignKey`/`AddForeignKey`) before it was
applied. Confirmed via `pg_constraint.confdeltype::text` that the live database's actual
constraint still has the *old* behavior (`RESTRICT`) — i.e. Prisma's schema and the live DB have
drifted apart for this one constraint, for reasons not investigated further. The stray generated
migration file was deleted rather than left to be silently applied by a future `prisma migrate
deploy`. **Before running `prisma migrate dev` again**, check whether it tries to touch this
constraint and resolve the drift deliberately (update `schema.prisma` to match the live DB, or
decide the live DB should change) rather than letting migrate "fix" it as a side effect.

---

### 3. `AuditLog` (hard-delete undo) has no browse/restore UI beyond the 20-second toast
**Status: open, feature gap, not yet built — explicitly proposed, not yet approved to build.**
Every tracked delete (plain or Force) gets a floating "N row(s) deleted — Undo" toast that times
out after 20 seconds. After that, the `AuditLog` snapshot row still exists (it never expires on
its own) and is still restorable via `POST /undo_delete`, but there is **no dashboard page** to
find its `auditLogId` after the toast is gone — restoring it requires a direct backend call. A
"Deleted Rows" browse/restore page was proposed (reusing the existing backend endpoint, frontend
list-view work only) but not built as of this writing.

---

### 4. DB credential rotation recommended, not performed
**Status: open, recommendation only.**
Surfaced during a general "is this database proper" assessment. Out of scope for an agent to
perform unilaterally (credential handling) — raise with the project owner if it becomes
relevant to a task.

---

### 5. `SECRETS_ENCRYPTION_KEY` not confirmed set in any environment
**Status: UNKNOWN — needs inspection.**
If unset, `SecretsService` derives its encryption key from `SESSION_JWT_SECRET`, coupling secret
encryption to session-signing key rotation (see `SECURITY.md`). Confirm with the project owner
whether this variable is set in the real deployment before assuming either way.

---

### 6. `KpiService.computeStockUsageLedger`'s bucket logic keys off `movement_type`, not `direction`, for most types
**Status: not a bug today, but a sharp edge — documented so a future change doesn't reintroduce
a mismatch.** See `CONVENTIONS.md`/`ARCHITECTURE.md`. Already handled correctly for
`DELIVERY_CORRECTION`; any future new movement type that can post either `IN` or `OUT` needs the
same explicit treatment.
