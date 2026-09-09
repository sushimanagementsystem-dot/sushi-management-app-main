-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "brand" (
    "brand_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "brand_pkey" PRIMARY KEY ("brand_id")
);

-- CreateTable
CREATE TABLE "kiosk" (
    "kiosk_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "production_email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "kiosk_pkey" PRIMARY KEY ("kiosk_id")
);

-- CreateTable
CREATE TABLE "user" (
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "supplier_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_email" TEXT,
    "order_output_method" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("supplier_id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "brand_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("campaign_id")
);

-- CreateTable
CREATE TABLE "stock_item" (
    "stock_item_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stock_category_id" TEXT NOT NULL,
    "count_unit" TEXT NOT NULL,
    "current_unit_cost" DECIMAL(12,4),
    "cost_per_100g" DECIMAL(12,4),
    "food_waste_eligible" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "stock_item_pkey" PRIMARY KEY ("stock_item_id")
);

-- CreateTable
CREATE TABLE "stock_item_par" (
    "stock_item_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "target_par" DECIMAL(12,3),
    "minimum_stock" DECIMAL(12,3),
    "safety_stock" DECIMAL(12,3),

    CONSTRAINT "stock_item_par_pkey" PRIMARY KEY ("stock_item_id","kiosk_id")
);

-- CreateTable
CREATE TABLE "product" (
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product_category_id" TEXT NOT NULL,
    "production_role" TEXT,
    "brand_id" TEXT,
    "campaign_id" TEXT,
    "shelf_life_days" INTEGER,
    "current_unit_cost" DECIMAL(12,4),
    "plan_group" TEXT,
    "staff_food_eligible" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "recipe_component" (
    "recipe_component_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "recipe_component_pkey" PRIMARY KEY ("recipe_component_id")
);

-- CreateTable
CREATE TABLE "audit_section" (
    "audit_section_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "audit_section_pkey" PRIMARY KEY ("audit_section_id")
);

-- CreateTable
CREATE TABLE "audit_question" (
    "audit_question_id" TEXT NOT NULL,
    "audit_section_id" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "pass_answer" TEXT NOT NULL,
    "na_allowed" BOOLEAN NOT NULL DEFAULT false,
    "evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(6,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "audit_question_pkey" PRIMARY KEY ("audit_question_id")
);

-- CreateTable
CREATE TABLE "enum_option" (
    "enum_type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "enum_option_pkey" PRIMARY KEY ("enum_type","value")
);

-- CreateTable
CREATE TABLE "production_par" (
    "kiosk_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "MONDAY" INTEGER NOT NULL DEFAULT 0,
    "TUESDAY" INTEGER NOT NULL DEFAULT 0,
    "WEDNESDAY" INTEGER NOT NULL DEFAULT 0,
    "THURSDAY" INTEGER NOT NULL DEFAULT 0,
    "FRIDAY" INTEGER NOT NULL DEFAULT 0,
    "SATURDAY" INTEGER NOT NULL DEFAULT 0,
    "SUNDAY" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "production_par_pkey" PRIMARY KEY ("kiosk_id","product_id")
);

-- CreateTable
CREATE TABLE "component" (
    "component_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "component_type" TEXT,
    "recipe_unit" TEXT,
    "prep_unit" TEXT,
    "units_per_prep_unit" DECIMAL(10,3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "component_pkey" PRIMARY KEY ("component_id")
);

-- CreateTable
CREATE TABLE "defrost_item" (
    "defrost_item_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stock_item_id" TEXT,
    "planning_mode" TEXT,
    "defrost_unit" TEXT,
    "min_increment" DECIMAL(10,3),
    "yield_a" DECIMAL(10,3),
    "yield_b" DECIMAL(10,3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "defrost_item_pkey" PRIMARY KEY ("defrost_item_id")
);

-- CreateTable
CREATE TABLE "defrost_par" (
    "kiosk_id" TEXT NOT NULL,
    "defrost_item_id" TEXT NOT NULL,
    "MONDAY" DECIMAL(10,3),
    "TUESDAY" DECIMAL(10,3),
    "WEDNESDAY" DECIMAL(10,3),
    "THURSDAY" DECIMAL(10,3),
    "FRIDAY" DECIMAL(10,3),
    "SATURDAY" DECIMAL(10,3),
    "SUNDAY" DECIMAL(10,3),

    CONSTRAINT "defrost_par_pkey" PRIMARY KEY ("kiosk_id","defrost_item_id")
);

-- CreateTable
CREATE TABLE "supplier_item_map" (
    "supplier_item_map_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_code" TEXT,
    "supplier_description" TEXT,
    "stock_item_id" TEXT NOT NULL,
    "selling_unit" TEXT,
    "case_unit" TEXT,
    "case_multiple" INTEGER,
    "order_multiple" DECIMAL(10,3),
    "current_price" DECIMAL(12,4),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "supplier_item_map_pkey" PRIMARY KEY ("supplier_item_map_id")
);

-- CreateTable
CREATE TABLE "table_schema" (
    "table_name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT,
    "hard_delete" BOOLEAN,
    "has_detail_view" BOOLEAN,

    CONSTRAINT "table_schema_pkey" PRIMARY KEY ("table_name")
);

-- CreateTable
CREATE TABLE "field_schema" (
    "table_name" TEXT NOT NULL,
    "column_name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sub_table" TEXT,
    "ref_table" TEXT,
    "ref_label_field" TEXT,
    "sub_table_join_column" TEXT,
    "is_title_column" BOOLEAN,
    "enum_source" TEXT,
    "manage_options" BOOLEAN,
    "min" DECIMAL(12,4),
    "max" DECIMAL(12,4),
    "primary_key" BOOLEAN,
    "required" BOOLEAN,
    "searchable" BOOLEAN,
    "hidden" BOOLEAN,
    "editable_on_update" BOOLEAN,
    "editable_on_create" BOOLEAN,

    CONSTRAINT "field_schema_pkey" PRIMARY KEY ("table_name","column_name")
);

-- CreateTable
CREATE TABLE "setting" (
    "setting_key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "label" TEXT,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("setting_key")
);

-- CreateTable
CREATE TABLE "submission" (
    "submission_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "form_type" TEXT NOT NULL,
    "user_id" TEXT,
    "submitted_by_email" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_date" TIMESTAMP(3),
    "raw_payload" JSONB NOT NULL,
    "processing_key" TEXT,
    "processing_status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "submission_pkey" PRIMARY KEY ("submission_id")
);

-- CreateTable
CREATE TABLE "processing_error_log" (
    "error_id" TEXT NOT NULL,
    "error_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kiosk_id" TEXT,
    "form_type" TEXT,
    "submission_id" TEXT,
    "processing_key" TEXT,
    "stage" TEXT,
    "error_message" TEXT NOT NULL,
    "records_written_before_error" BOOLEAN NOT NULL DEFAULT false,
    "recommended_action" TEXT,
    "retry_status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "processing_error_log_pkey" PRIMARY KEY ("error_id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "stock_movement_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "kiosk_id" TEXT NOT NULL,
    "stock_item_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "movement_date" TIMESTAMP(3) NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(12,4),
    "cost" DECIMAL(12,2),
    "transfer_id" TEXT,
    "reference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("stock_movement_id")
);

-- CreateTable
CREATE TABLE "product_movement" (
    "product_movement_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "kiosk_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "movement_date" TIMESTAMP(3) NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(12,4),
    "cost" DECIMAL(12,2),
    "attributed_production_date" TIMESTAMP(3),
    "damage_cause" TEXT,
    "photo_reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNCOSTED',

    CONSTRAINT "product_movement_pkey" PRIMARY KEY ("product_movement_id")
);

-- CreateTable
CREATE TABLE "stock_transfer" (
    "transfer_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "source_kiosk_id" TEXT,
    "destination_kiosk_id" TEXT,
    "stock_item_id" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "count_unit" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "stock_transfer_pkey" PRIMARY KEY ("transfer_id")
);

-- CreateTable
CREATE TABLE "fridge_count" (
    "fridge_count_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "kiosk_id" TEXT NOT NULL,
    "business_date" TIMESTAMP(3) NOT NULL,
    "product_id" TEXT NOT NULL,
    "counted_qty" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "fridge_count_pkey" PRIMARY KEY ("fridge_count_id")
);

-- CreateTable
CREATE TABLE "production_plan" (
    "production_plan_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "business_date" TIMESTAMP(3) NOT NULL,
    "product_id" TEXT NOT NULL,
    "planned_qty" DECIMAL(12,3) NOT NULL,
    "submission_id" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_plan_pkey" PRIMARY KEY ("production_plan_id")
);

-- CreateTable
CREATE TABLE "staff_food" (
    "staff_food_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "kiosk_id" TEXT NOT NULL,
    "food_date" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,
    "product_id" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL DEFAULT 1,

    CONSTRAINT "staff_food_pkey" PRIMARY KEY ("staff_food_id")
);

-- CreateTable
CREATE TABLE "delivery_header" (
    "delivery_header_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "kiosk_id" TEXT NOT NULL,
    "delivery_date" TIMESTAMP(3) NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "delivery_route" TEXT,
    "as_expected" BOOLEAN,
    "staff_invoice_number" TEXT,
    "delivery_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_REVIEW',

    CONSTRAINT "delivery_header_pkey" PRIMARY KEY ("delivery_header_id")
);

-- CreateTable
CREATE TABLE "delivery_file" (
    "delivery_file_id" TEXT NOT NULL,
    "delivery_header_id" TEXT NOT NULL,
    "drive_file_id" TEXT,
    "file_name" TEXT,
    "file_url" TEXT,
    "page_sequence" INTEGER,
    "ai_status" TEXT,
    "ai_error" TEXT,

    CONSTRAINT "delivery_file_pkey" PRIMARY KEY ("delivery_file_id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "invoice_line_id" TEXT NOT NULL,
    "delivery_header_id" TEXT NOT NULL,
    "stock_item_id" TEXT,
    "supplier_item_code" TEXT,
    "description_raw" TEXT,
    "qty" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(12,4),
    "line_total" DECIMAL(12,2),
    "source" TEXT NOT NULL DEFAULT 'AI_EXTRACTED',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("invoice_line_id")
);

-- CreateTable
CREATE TABLE "request" (
    "request_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "kiosk_id" TEXT NOT NULL,
    "user_id" TEXT,
    "request_type" TEXT,
    "category" TEXT,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "photo_reference" TEXT,
    "initial_priority" TEXT,
    "owner_priority" TEXT,
    "assigned_to" TEXT,
    "owner_status" TEXT NOT NULL DEFAULT 'OPEN',
    "due_date" TIMESTAMP(3),
    "owner_note" TEXT,
    "resolution_note" TEXT,

    CONSTRAINT "request_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stocktake_header" (
    "stocktake_header_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "kiosk_id" TEXT NOT NULL,
    "stocktake_date" TIMESTAMP(3) NOT NULL,
    "expected_item_count" INTEGER,
    "received_item_count" INTEGER,
    "completion_status" TEXT,
    "reconciliation_status" TEXT,

    CONSTRAINT "stocktake_header_pkey" PRIMARY KEY ("stocktake_header_id")
);

-- CreateTable
CREATE TABLE "stocktake_line" (
    "stocktake_line_id" TEXT NOT NULL,
    "stocktake_header_id" TEXT NOT NULL,
    "stock_item_id" TEXT NOT NULL,
    "counted_qty" DECIMAL(12,3) NOT NULL,
    "count_unit" TEXT,

    CONSTRAINT "stocktake_line_pkey" PRIMARY KEY ("stocktake_line_id")
);

-- CreateTable
CREATE TABLE "purchasing_batch" (
    "purchasing_batch_id" TEXT NOT NULL,
    "owner_action_id" TEXT,
    "supplier_id" TEXT NOT NULL,
    "order_output_method" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchasing_batch_pkey" PRIMARY KEY ("purchasing_batch_id")
);

-- CreateTable
CREATE TABLE "purchasing_batch_line" (
    "purchasing_batch_line_id" TEXT NOT NULL,
    "purchasing_batch_id" TEXT NOT NULL,
    "stock_item_id" TEXT NOT NULL,
    "total_shortfall" DECIMAL(12,3),
    "pack_size" DECIMAL(12,3),
    "order_multiple" DECIMAL(12,3),
    "recommended_packs" INTEGER,
    "recommended_qty" DECIMAL(12,3),
    "flags" TEXT,

    CONSTRAINT "purchasing_batch_line_pkey" PRIMARY KEY ("purchasing_batch_line_id")
);

-- CreateTable
CREATE TABLE "audit_response" (
    "audit_response_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "kiosk_id" TEXT NOT NULL,
    "audit_date" TIMESTAMP(3) NOT NULL,
    "review_status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "final_score" DECIMAL(6,2),
    "final_rating" TEXT,

    CONSTRAINT "audit_response_pkey" PRIMARY KEY ("audit_response_id")
);

-- CreateTable
CREATE TABLE "audit_answer" (
    "audit_answer_id" TEXT NOT NULL,
    "audit_response_id" TEXT NOT NULL,
    "audit_question_id" TEXT NOT NULL,
    "staff_answer" TEXT NOT NULL,
    "evidence_photo_reference" TEXT,
    "owner_decision" TEXT,
    "owner_note" TEXT,

    CONSTRAINT "audit_answer_pkey" PRIMARY KEY ("audit_answer_id")
);

-- CreateTable
CREATE TABLE "corrective_action" (
    "corrective_action_id" TEXT NOT NULL,
    "audit_response_id" TEXT NOT NULL,
    "audit_question_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "corrective_action_pkey" PRIMARY KEY ("corrective_action_id")
);

-- CreateTable
CREATE TABLE "audit_correction" (
    "audit_correction_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "corrective_action_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "staff_member_id" TEXT,
    "correction_cycle" INTEGER NOT NULL DEFAULT 1,
    "correction_note" TEXT,
    "replacement_photo_reference" TEXT,
    "validation_status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "audit_correction_pkey" PRIMARY KEY ("audit_correction_id")
);

-- CreateTable
CREATE TABLE "owner_action" (
    "owner_action_id" TEXT NOT NULL,
    "source_submission_id" TEXT,
    "kiosk_id" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assigned_to" TEXT,
    "due_date" TIMESTAMP(3),
    "owner_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "owner_action_pkey" PRIMARY KEY ("owner_action_id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "activity_log_id" TEXT NOT NULL,
    "owner_action_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" TEXT,
    "field_changed" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "note" TEXT,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("activity_log_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_token_key" ON "kiosk"("token");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "submission_processing_status_idx" ON "submission"("processing_status");

-- CreateIndex
CREATE INDEX "stock_movement_kiosk_id_movement_date_idx" ON "stock_movement"("kiosk_id", "movement_date");

-- CreateIndex
CREATE INDEX "product_movement_kiosk_id_movement_date_idx" ON "product_movement"("kiosk_id", "movement_date");

-- CreateIndex
CREATE INDEX "fridge_count_kiosk_id_business_date_idx" ON "fridge_count"("kiosk_id", "business_date");

-- CreateIndex
CREATE INDEX "production_plan_kiosk_id_business_date_idx" ON "production_plan"("kiosk_id", "business_date");

-- CreateIndex
CREATE INDEX "owner_action_status_idx" ON "owner_action"("status");

-- AddForeignKey
ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("brand_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_item_par" ADD CONSTRAINT "stock_item_par_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("stock_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_item_par" ADD CONSTRAINT "stock_item_par_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("brand_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("campaign_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_component" ADD CONSTRAINT "recipe_component_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_component" ADD CONSTRAINT "recipe_component_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "component"("component_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_question" ADD CONSTRAINT "audit_question_audit_section_id_fkey" FOREIGN KEY ("audit_section_id") REFERENCES "audit_section"("audit_section_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_par" ADD CONSTRAINT "production_par_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_par" ADD CONSTRAINT "production_par_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defrost_item" ADD CONSTRAINT "defrost_item_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("stock_item_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defrost_par" ADD CONSTRAINT "defrost_par_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defrost_par" ADD CONSTRAINT "defrost_par_defrost_item_id_fkey" FOREIGN KEY ("defrost_item_id") REFERENCES "defrost_item"("defrost_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_item_map" ADD CONSTRAINT "supplier_item_map_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("supplier_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_item_map" ADD CONSTRAINT "supplier_item_map_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("stock_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_error_log" ADD CONSTRAINT "processing_error_log_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_error_log" ADD CONSTRAINT "processing_error_log_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("stock_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfer"("transfer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_movement" ADD CONSTRAINT "product_movement_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_movement" ADD CONSTRAINT "product_movement_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_movement" ADD CONSTRAINT "product_movement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_source_kiosk_id_fkey" FOREIGN KEY ("source_kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_destination_kiosk_id_fkey" FOREIGN KEY ("destination_kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("stock_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_count" ADD CONSTRAINT "fridge_count_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_count" ADD CONSTRAINT "fridge_count_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_count" ADD CONSTRAINT "fridge_count_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan" ADD CONSTRAINT "production_plan_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan" ADD CONSTRAINT "production_plan_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan" ADD CONSTRAINT "production_plan_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_food" ADD CONSTRAINT "staff_food_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_food" ADD CONSTRAINT "staff_food_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_food" ADD CONSTRAINT "staff_food_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_food" ADD CONSTRAINT "staff_food_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_header" ADD CONSTRAINT "delivery_header_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_header" ADD CONSTRAINT "delivery_header_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_header" ADD CONSTRAINT "delivery_header_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("supplier_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_file" ADD CONSTRAINT "delivery_file_delivery_header_id_fkey" FOREIGN KEY ("delivery_header_id") REFERENCES "delivery_header"("delivery_header_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_delivery_header_id_fkey" FOREIGN KEY ("delivery_header_id") REFERENCES "delivery_header"("delivery_header_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("stock_item_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request" ADD CONSTRAINT "request_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request" ADD CONSTRAINT "request_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request" ADD CONSTRAINT "request_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_header" ADD CONSTRAINT "stocktake_header_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_header" ADD CONSTRAINT "stocktake_header_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_line" ADD CONSTRAINT "stocktake_line_stocktake_header_id_fkey" FOREIGN KEY ("stocktake_header_id") REFERENCES "stocktake_header"("stocktake_header_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_line" ADD CONSTRAINT "stocktake_line_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("stock_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing_batch" ADD CONSTRAINT "purchasing_batch_owner_action_id_fkey" FOREIGN KEY ("owner_action_id") REFERENCES "owner_action"("owner_action_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing_batch" ADD CONSTRAINT "purchasing_batch_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("supplier_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing_batch_line" ADD CONSTRAINT "purchasing_batch_line_purchasing_batch_id_fkey" FOREIGN KEY ("purchasing_batch_id") REFERENCES "purchasing_batch"("purchasing_batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing_batch_line" ADD CONSTRAINT "purchasing_batch_line_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("stock_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_response" ADD CONSTRAINT "audit_response_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_response" ADD CONSTRAINT "audit_response_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_answer" ADD CONSTRAINT "audit_answer_audit_response_id_fkey" FOREIGN KEY ("audit_response_id") REFERENCES "audit_response"("audit_response_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_answer" ADD CONSTRAINT "audit_answer_audit_question_id_fkey" FOREIGN KEY ("audit_question_id") REFERENCES "audit_question"("audit_question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_audit_response_id_fkey" FOREIGN KEY ("audit_response_id") REFERENCES "audit_response"("audit_response_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_audit_question_id_fkey" FOREIGN KEY ("audit_question_id") REFERENCES "audit_question"("audit_question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_correction" ADD CONSTRAINT "audit_correction_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_correction" ADD CONSTRAINT "audit_correction_corrective_action_id_fkey" FOREIGN KEY ("corrective_action_id") REFERENCES "corrective_action"("corrective_action_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_correction" ADD CONSTRAINT "audit_correction_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_correction" ADD CONSTRAINT "audit_correction_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_action" ADD CONSTRAINT "owner_action_source_submission_id_fkey" FOREIGN KEY ("source_submission_id") REFERENCES "submission"("submission_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_action" ADD CONSTRAINT "owner_action_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "kiosk"("kiosk_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_owner_action_id_fkey" FOREIGN KEY ("owner_action_id") REFERENCES "owner_action"("owner_action_id") ON DELETE RESTRICT ON UPDATE CASCADE;

