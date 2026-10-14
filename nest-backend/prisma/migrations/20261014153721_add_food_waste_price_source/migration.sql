-- AlterTable
ALTER TABLE "stock_item" ADD COLUMN     "food_waste_price_source_id" TEXT;

-- AddForeignKey
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_food_waste_price_source_id_fkey" FOREIGN KEY ("food_waste_price_source_id") REFERENCES "stock_item"("stock_item_id") ON DELETE SET NULL ON UPDATE CASCADE;
