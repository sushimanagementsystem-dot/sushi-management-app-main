-- CreateTable
CREATE TABLE "weekly_sales" (
    "weekly_sales_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "sales_amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "entered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_sales_pkey" PRIMARY KEY ("weekly_sales_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_sales_kiosk_id_week_start_key" ON "weekly_sales"("kiosk_id", "week_start");

-- AddForeignKey
ALTER TABLE "weekly_sales" ADD CONSTRAINT "weekly_sales_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_sales" ADD CONSTRAINT "weekly_sales_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
