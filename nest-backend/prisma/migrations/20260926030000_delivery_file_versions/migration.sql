-- Invoice image re-upload: a replaced page is kept, not deleted or overwritten. The old delivery_file row is switched to
-- is_active = false (with when/who), and the new page is a new row pointing back at it via replaces_file_id. Every existing
-- row is the current version, so is_active defaults to true. Additive only — no existing value changes.
ALTER TABLE "delivery_file" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "delivery_file" ADD COLUMN "replaces_file_id" TEXT;
ALTER TABLE "delivery_file" ADD COLUMN "superseded_at" TIMESTAMP(3);
ALTER TABLE "delivery_file" ADD COLUMN "superseded_by" TEXT;
