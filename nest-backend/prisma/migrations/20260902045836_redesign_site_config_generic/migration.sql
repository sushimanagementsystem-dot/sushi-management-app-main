-- Redesign site_config: from one row per individual key (config_key) to
-- one row per config group (config_type: ADMIN, SMTP), with is_active and
-- status pulled out as real columns and everything else inside `data`
-- JSONB. Existing rows are disposable test/config values entered this
-- session (individual ADMIN_EMAIL / MAIL_SMTP_* keys) — truncated here;
-- the admin re-enters values via the Site Configuration page afterward.
TRUNCATE TABLE "site_config";

ALTER TABLE "site_config" DROP CONSTRAINT "site_config_pkey";
ALTER TABLE "site_config" DROP COLUMN "config_key";
ALTER TABLE "site_config" DROP COLUMN "value";
ALTER TABLE "site_config" DROP COLUMN "description";

ALTER TABLE "site_config" ADD COLUMN "site_config_id" TEXT NOT NULL;
ALTER TABLE "site_config" ADD COLUMN "config_type" TEXT NOT NULL;
ALTER TABLE "site_config" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "site_config" ADD COLUMN "status" TEXT;
ALTER TABLE "site_config" ADD COLUMN "data" JSONB NOT NULL;

ALTER TABLE "site_config" ADD CONSTRAINT "site_config_pkey" PRIMARY KEY ("site_config_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_config_config_type_key" ON "site_config"("config_type");
