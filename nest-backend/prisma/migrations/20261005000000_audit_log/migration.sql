-- One row per Data Tables hard delete (plain or Force delete), written in the same transaction as the delete
-- itself. `snapshot` is everything undo() needs to recreate the rows exactly:
-- { target: { table, row }, cascaded: [{ table, rows }] } — cascaded is only non-empty for a Force delete.
-- No foreign keys on performed_by/undone_by on purpose: this table must still be able to log (and later explain)
-- the deletion of a user row itself without being blocked by its own audit trail.
CREATE TABLE "audit_log" (
    "audit_log_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "performed_by" TEXT,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMP(3),
    "undone_by" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("audit_log_id")
);

CREATE INDEX "audit_log_table_name_performed_at_idx" ON "audit_log"("table_name", "performed_at");
