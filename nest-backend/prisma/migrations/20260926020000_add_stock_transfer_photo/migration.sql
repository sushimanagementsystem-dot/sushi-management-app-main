-- A stock transfer request now requires a mandatory evidence photo (same UploadService "/uploads/<id>" pattern
-- as product_movement.photo_reference). Every line from one submission shares the one photo taken for that
-- transfer request, so this lives on stock_transfer itself, not a separate table. Existing rows get NULL —
-- they predate the requirement and have no photo to backfill.
ALTER TABLE "stock_transfer" ADD COLUMN "photo_reference" TEXT;
