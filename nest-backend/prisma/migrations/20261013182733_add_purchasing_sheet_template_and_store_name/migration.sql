-- DropForeignKey
ALTER TABLE "purchasing_batch" DROP CONSTRAINT "purchasing_batch_supplier_id_fkey";

-- AlterTable
ALTER TABLE "kiosk" ADD COLUMN     "supplier_store_name" TEXT;

-- AlterTable
ALTER TABLE "supplier" ADD COLUMN     "order_sheet_template" TEXT;

-- AddForeignKey
ALTER TABLE "purchasing_batch" ADD CONSTRAINT "purchasing_batch_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("supplier_id") ON DELETE SET NULL ON UPDATE CASCADE;
