-- Row position on the client's master stock sheet, so Weekly Stocktake and
-- the Stock Item Data Table can list items in that exact order. Nullable,
-- additive: every existing row is unaffected until a value is set.
ALTER TABLE "stock_item" ADD COLUMN "sort_order" INTEGER;
