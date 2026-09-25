-- Data Tables review. Every statement is idempotent and touches configuration only: no operational row (products,
-- submissions, stock movements, campaigns, staff) is deleted or rewritten.

-- 1. Ordering: record when each drafted order was emailed to the owner, or why it was not.
ALTER TABLE "purchasing_batch" ADD COLUMN IF NOT EXISTS "emailed_at" TIMESTAMP(3);
ALTER TABLE "purchasing_batch" ADD COLUMN IF NOT EXISTS "emailed_to" TEXT;
ALTER TABLE "purchasing_batch" ADD COLUMN IF NOT EXISTS "email_error" TEXT;

-- 2. Supplier "Order output method": what the weekly order looks like when it lands in the owner's inbox.
--    The two old email-ish values stay in the table (turned off, still understood by the code) so nothing that
--    stored them breaks.
INSERT INTO "enum_option" ("enum_type", "value", "label", "sort_order", "active") VALUES
    ('order_output_method', 'ORDER_SHEET', 'Order sheet (Excel, emailed to me)', 1, true),
    ('order_output_method', 'EMAIL_ORDER', 'Email message (list emailed to me)', 2, true)
ON CONFLICT ("enum_type", "value") DO NOTHING;
UPDATE "enum_option" SET "label" = 'Manual (never auto-ordered)', "sort_order" = 3 WHERE "enum_type" = 'order_output_method' AND "value" = 'MANUAL';
UPDATE "enum_option" SET "sort_order" = 4, "active" = false WHERE "enum_type" = 'order_output_method' AND "value" = 'GMAIL_DRAFT';
UPDATE "enum_option" SET "sort_order" = 5, "active" = false WHERE "enum_type" = 'order_output_method' AND "value" = 'ONLINE_ORDER_LIST';

-- The owner's own description of how each supplier is ordered: Tazaki / Asia Market / Castlebay have an order sheet,
-- VSD / Bunzl / Sysco are just an email message of what to order. Only moves a supplier off the old placeholder values.
UPDATE "supplier" SET "order_output_method" = 'ORDER_SHEET'
 WHERE lower("name") IN ('tazaki', 'asia market', 'castlebay') AND "order_output_method" IN ('MANUAL', 'GMAIL_DRAFT', 'ONLINE_ORDER_LIST');
UPDATE "supplier" SET "order_output_method" = 'EMAIL_ORDER'
 WHERE lower("name") IN ('vsd', 'bunzl', 'sysco') AND "order_output_method" IN ('MANUAL', 'GMAIL_DRAFT', 'ONLINE_ORDER_LIST');

-- 3. Product Category order (drives Production Par and Product): Snacks first, then Ready Meals. Only when still in the
--    original order, so a later edit by the owner is never overwritten.
UPDATE "enum_option" SET "sort_order" = CASE "value" WHEN 'PC03' THEN 1 WHEN 'PC01' THEN 2 WHEN 'PC02' THEN 3 END
 WHERE "enum_type" = 'product_category' AND "value" IN ('PC01', 'PC02', 'PC03')
   AND (SELECT "sort_order" FROM "enum_option" WHERE "enum_type" = 'product_category' AND "value" = 'PC01') = 1
   AND (SELECT "sort_order" FROM "enum_option" WHERE "enum_type" = 'product_category' AND "value" = 'PC02') = 2
   AND (SELECT "sort_order" FROM "enum_option" WHERE "enum_type" = 'product_category' AND "value" = 'PC03') = 3;

-- 4. Staff: allow deleting a person. The app itself refuses when they have any history (see staff-removal.ts).
UPDATE "table_schema" SET "hard_delete" = true WHERE "table_name" = 'user';

-- 5. Campaign: taken off the Data Tables screen (the table, its fields and the Campaign column on Product). The
--    campaign table and product.campaign_id keep their data; nothing reads them except a dormant karaage note in the
--    production email that no product can trigger (none of the 2 products still tagged has a recipe).
DELETE FROM "field_schema" WHERE "table_name" = 'campaign' OR ("table_name" = 'product' AND "column_name" = 'campaign_id');
DELETE FROM "table_schema" WHERE "table_name" = 'campaign';

-- 6. Plain-language descriptions shown under each table's title.
UPDATE "table_schema" SET "description" = 'The Weekly Stocktake list: exactly the items staff count on the Stock Take. Par levels, prices, invoices and ordering all read this one list. The Food Waste (per 100g) tracking items are kept separately and are not shown here.' WHERE "table_name" = 'stock_item';
UPDATE "table_schema" SET "description" = 'Delivery suppliers. "Order output method" decides how the order drafted after each stocktake reaches you: an Excel order sheet, an email message listing what to order, or Manual (never auto-ordered). Orders are emailed to you, never to the supplier.' WHERE "table_name" = 'supplier';
UPDATE "table_schema" SET "description" = 'What appears under "Defrost tomorrow" in the production email. Most items are worked out automatically from tomorrow''s Production Par and the product recipes (see Planning mode). Manual items use the Defrost Par table.' WHERE "table_name" = 'defrost_item';
UPDATE "table_schema" SET "description" = 'Manual defrost quantities per kiosk, item and weekday. Only used for items with no automatic calculation (Planning mode "Manual Par", plus Edamame, Wakame and Curry Sauce). While this is empty those items never appear in the email.' WHERE "table_name" = 'defrost_par';
UPDATE "table_schema" SET "description" = 'Everyone allowed to sign in, and their role. Set Active off for people who have left: they can no longer sign in, their history is kept and they move to the bottom of the list. Delete only works for someone with no history.' WHERE "table_name" = 'user';
