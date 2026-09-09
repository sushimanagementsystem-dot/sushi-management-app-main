-- CreateTable
CREATE TABLE "site_config" (
    "config_key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "site_config_pkey" PRIMARY KEY ("config_key")
);
