-- CreateTable
CREATE TABLE "weekly_costs" (
    "weekly_costs_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "fixed_costs" DECIMAL(12,2),
    "misc_costs" DECIMAL(12,2),
    "note" TEXT,
    "entered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_costs_pkey" PRIMARY KEY ("weekly_costs_id")
);

-- CreateTable
CREATE TABLE "weekly_labour" (
    "weekly_labour_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "hourly_rate" DECIMAL(8,2),
    "labour_cost" DECIMAL(12,2),
    "source_file" TEXT,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_labour_pkey" PRIMARY KEY ("weekly_labour_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_costs_kiosk_id_week_start_key" ON "weekly_costs"("kiosk_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_labour_kiosk_id_week_start_key" ON "weekly_labour"("kiosk_id", "week_start");

-- AddForeignKey
ALTER TABLE "weekly_costs" ADD CONSTRAINT "weekly_costs_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_labour" ADD CONSTRAINT "weekly_labour_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;
