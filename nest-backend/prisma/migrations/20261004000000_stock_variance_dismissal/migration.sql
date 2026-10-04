-- One row per Stock Variances report line the owner has reviewed and
-- dismissed — "Stock Variances" is a computed report (not a stored list),
-- so this is the one piece of state an owner's "I've seen this" click
-- needs. Keyed on stocktake_line_id, the real id of the count that
-- produced the variance.
CREATE TABLE "stock_variance_dismissal" (
    "stocktake_line_id" TEXT NOT NULL,
    "dismissed_by" TEXT,
    "dismissed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_variance_dismissal_pkey" PRIMARY KEY ("stocktake_line_id")
);

ALTER TABLE "stock_variance_dismissal" ADD CONSTRAINT "stock_variance_dismissal_stocktake_line_id_fkey" FOREIGN KEY ("stocktake_line_id") REFERENCES "stocktake_line"("stocktake_line_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_variance_dismissal" ADD CONSTRAINT "stock_variance_dismissal_dismissed_by_fkey" FOREIGN KEY ("dismissed_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
