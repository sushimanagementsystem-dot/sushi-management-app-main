-- The "Purchasing: setup needed" batch lists items that have no par level or supplier yet, so it belongs to no supplier.
-- The scan stored an empty string for it, which the supplier foreign key rejects, so the weekly scan failed whenever any
-- item needed setup. A missing supplier is now NULL. Existing rows are unchanged.
ALTER TABLE "purchasing_batch" ALTER COLUMN "supplier_id" DROP NOT NULL;
