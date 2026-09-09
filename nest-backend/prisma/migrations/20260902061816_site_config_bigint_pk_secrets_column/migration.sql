-- Redesign site_config again: bigint auto-increment PK, `category`
-- (renamed from config_type), config/secrets split into two JSONB
-- columns (secrets never leaves the server, so no field-name-pattern
-- masking is needed), first-class last_tested_at/last_test_result/
-- last_test_error columns, and created_at/created_by/deleted_at/
-- deleted_by (soft delete) columns. Existing rows are disposable
-- test/config values entered this session — truncated here; the admin
-- re-enters values via the Site Configuration page afterward.
TRUNCATE TABLE "site_config";

ALTER TABLE "site_config" DROP CONSTRAINT "site_config_pkey";
DROP INDEX IF EXISTS "site_config_config_type_key";

ALTER TABLE "site_config" DROP COLUMN "site_config_id";
ALTER TABLE "site_config" DROP COLUMN "config_type";
ALTER TABLE "site_config" DROP COLUMN "status";
ALTER TABLE "site_config" DROP COLUMN "data";

ALTER TABLE "site_config" ADD COLUMN "id" BIGSERIAL;
ALTER TABLE "site_config" ADD COLUMN "category" TEXT NOT NULL;
ALTER TABLE "site_config" ADD COLUMN "config" JSONB NOT NULL;
ALTER TABLE "site_config" ADD COLUMN "secrets" JSONB;
ALTER TABLE "site_config" ADD COLUMN "last_tested_at" TIMESTAMP(3);
ALTER TABLE "site_config" ADD COLUMN "last_test_result" TEXT;
ALTER TABLE "site_config" ADD COLUMN "last_test_error" TEXT;
ALTER TABLE "site_config" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "site_config" ADD COLUMN "created_by" TEXT;
ALTER TABLE "site_config" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "site_config" ADD COLUMN "deleted_by" TEXT;

ALTER TABLE "site_config" ADD CONSTRAINT "site_config_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "site_config_category_key" ON "site_config"("category");
