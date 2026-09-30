-- AlterTable
ALTER TABLE "stock_item" ADD COLUMN     "measurement_type" TEXT NOT NULL DEFAULT 'WEIGHT_G',
ADD COLUMN     "ambient_duplicate_of" TEXT;

-- AlterTable
ALTER TABLE "supplier_item_map" ADD COLUMN     "fixed_order_qty" INTEGER;

-- AddForeignKey
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_ambient_duplicate_of_fkey" FOREIGN KEY ("ambient_duplicate_of") REFERENCES "stock_item"("stock_item_id") ON DELETE SET NULL ON UPDATE CASCADE;
