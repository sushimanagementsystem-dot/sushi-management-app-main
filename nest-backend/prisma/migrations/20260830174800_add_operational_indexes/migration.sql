-- CreateIndex
CREATE INDEX "stock_item_par_kiosk_id_idx" ON "stock_item_par"("kiosk_id");

-- CreateIndex
CREATE INDEX "recipe_component_product_id_idx" ON "recipe_component"("product_id");

-- CreateIndex
CREATE INDEX "production_par_product_id_idx" ON "production_par"("product_id");

-- CreateIndex
CREATE INDEX "defrost_par_defrost_item_id_idx" ON "defrost_par"("defrost_item_id");

-- CreateIndex
CREATE INDEX "supplier_item_map_stock_item_id_idx" ON "supplier_item_map"("stock_item_id");

-- CreateIndex
CREATE INDEX "supplier_item_map_supplier_id_idx" ON "supplier_item_map"("supplier_id");

-- CreateIndex
CREATE INDEX "submission_kiosk_id_submitted_at_idx" ON "submission"("kiosk_id", "submitted_at");

-- CreateIndex
CREATE INDEX "submission_form_type_idx" ON "submission"("form_type");

-- CreateIndex
CREATE INDEX "submission_processing_key_idx" ON "submission"("processing_key");

-- CreateIndex
CREATE INDEX "processing_error_log_retry_status_idx" ON "processing_error_log"("retry_status");

-- CreateIndex
CREATE INDEX "processing_error_log_kiosk_id_idx" ON "processing_error_log"("kiosk_id");

-- CreateIndex
CREATE INDEX "stock_movement_stock_item_id_movement_date_idx" ON "stock_movement"("stock_item_id", "movement_date");

-- CreateIndex
CREATE INDEX "stock_movement_movement_type_idx" ON "stock_movement"("movement_type");

-- CreateIndex
CREATE INDEX "stock_movement_transfer_id_idx" ON "stock_movement"("transfer_id");

-- CreateIndex
CREATE INDEX "product_movement_product_id_movement_date_idx" ON "product_movement"("product_id", "movement_date");

-- CreateIndex
CREATE INDEX "product_movement_status_idx" ON "product_movement"("status");

-- CreateIndex
CREATE INDEX "stock_transfer_status_idx" ON "stock_transfer"("status");

-- CreateIndex
CREATE INDEX "stock_transfer_destination_kiosk_id_idx" ON "stock_transfer"("destination_kiosk_id");

-- CreateIndex
CREATE INDEX "stock_transfer_source_kiosk_id_idx" ON "stock_transfer"("source_kiosk_id");

-- CreateIndex
CREATE INDEX "staff_food_kiosk_id_food_date_idx" ON "staff_food"("kiosk_id", "food_date");

-- CreateIndex
CREATE INDEX "delivery_header_status_idx" ON "delivery_header"("status");

-- CreateIndex
CREATE INDEX "delivery_header_kiosk_id_idx" ON "delivery_header"("kiosk_id");

-- CreateIndex
CREATE INDEX "delivery_file_delivery_header_id_idx" ON "delivery_file"("delivery_header_id");

-- CreateIndex
CREATE INDEX "invoice_line_delivery_header_id_idx" ON "invoice_line"("delivery_header_id");

-- CreateIndex
CREATE INDEX "invoice_line_status_idx" ON "invoice_line"("status");

-- CreateIndex
CREATE INDEX "request_owner_status_idx" ON "request"("owner_status");

-- CreateIndex
CREATE INDEX "request_kiosk_id_idx" ON "request"("kiosk_id");

-- CreateIndex
CREATE INDEX "stocktake_header_kiosk_id_stocktake_date_idx" ON "stocktake_header"("kiosk_id", "stocktake_date");

-- CreateIndex
CREATE INDEX "stocktake_header_reconciliation_status_idx" ON "stocktake_header"("reconciliation_status");

-- CreateIndex
CREATE INDEX "stocktake_line_stocktake_header_id_idx" ON "stocktake_line"("stocktake_header_id");

-- CreateIndex
CREATE INDEX "purchasing_batch_line_purchasing_batch_id_idx" ON "purchasing_batch_line"("purchasing_batch_id");

-- CreateIndex
CREATE INDEX "audit_response_kiosk_id_audit_date_idx" ON "audit_response"("kiosk_id", "audit_date");

-- CreateIndex
CREATE INDEX "audit_answer_audit_response_id_idx" ON "audit_answer"("audit_response_id");

-- CreateIndex
CREATE INDEX "corrective_action_status_idx" ON "corrective_action"("status");

-- CreateIndex
CREATE INDEX "audit_correction_validation_status_idx" ON "audit_correction"("validation_status");

-- CreateIndex
CREATE INDEX "owner_action_category_idx" ON "owner_action"("category");

-- CreateIndex
CREATE INDEX "owner_action_kiosk_id_idx" ON "owner_action"("kiosk_id");

-- CreateIndex
CREATE INDEX "activity_log_owner_action_id_idx" ON "activity_log"("owner_action_id");

