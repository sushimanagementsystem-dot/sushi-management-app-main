// Table-by-table import configuration for the Excel → Postgres seed/sync
// pipeline. One entry per sheet in Database-test.xlsx, in the exact order
// they must be upserted so foreign keys always resolve (parents before
// children). Shared by prisma/seed.ts (dev seeding, reads a local file)
// and the future POST /import/excel endpoint (client hands over their
// own workbook at go-live) — see src/import/import.service.ts.
//
// `pk` builds the Prisma `where` clause for upsert from a row; `decimal`/
// `json`/`stringify` list fields that need explicit coercion beyond what
// the xlsx reader gives us for free (numbers/booleans/Dates already come
// through as the right JS type since we read with `cellDates: true`).
// `stringify` is for a Prisma `String` column whose sheet values are
// sometimes numeric-looking (e.g. a setting value of 500) — xlsx reads
// those as a JS number, which Prisma's client rejects outright for a
// String field ("Expected String, provided Int") rather than coercing it.

export type ImportTable = {
    sheet: string;
    model: string; // Prisma Client delegate name, e.g. "kiosk"
    pk: (row: any) => Record<string, any>;
    decimal?: string[];
    json?: string[];
    stringify?: string[];
};

export const IMPORT_ORDER: ImportTable[] = [
    // --- Level 0: no foreign keys ---
    { sheet: "brand", model: "brand", pk: (r) => ({ brand_id: r.brand_id }) },
    { sheet: "user", model: "user", pk: (r) => ({ user_id: r.user_id }) },
    { sheet: "supplier", model: "supplier", pk: (r) => ({ supplier_id: r.supplier_id }) },
    {
        sheet: "stock_item",
        model: "stockItem",
        pk: (r) => ({ stock_item_id: r.stock_item_id }),
        decimal: ["current_unit_cost", "cost_per_100g"],
    },
    { sheet: "component", model: "component", pk: (r) => ({ component_id: r.component_id }), decimal: ["units_per_prep_unit"] },
    { sheet: "audit_section", model: "auditSection", pk: (r) => ({ audit_section_id: r.audit_section_id }) },
    {
        sheet: "enum_option",
        model: "enumOption",
        pk: (r) => ({ enum_type_value: { enum_type: r.enum_type, value: r.value } }),
    },
    { sheet: "table_schema", model: "tableSchema", pk: (r) => ({ table_name: r.table_name }) },
    {
        sheet: "field_schema",
        model: "fieldSchema",
        pk: (r) => ({ table_name_column_name: { table_name: r.table_name, column_name: r.column_name } }),
        decimal: ["min", "max"],
    },
    { sheet: "setting", model: "setting", pk: (r) => ({ setting_key: r.setting_key }), stringify: ["value"] },

    // --- Level 1: depend only on level 0 ---
    { sheet: "kiosk", model: "kiosk", pk: (r) => ({ kiosk_id: r.kiosk_id }) },
    { sheet: "campaign", model: "campaign", pk: (r) => ({ campaign_id: r.campaign_id }) },
    {
        sheet: "product",
        model: "product",
        pk: (r) => ({ product_id: r.product_id }),
        decimal: ["current_unit_cost"],
    },
    {
        sheet: "defrost_item",
        model: "defrostItem",
        pk: (r) => ({ defrost_item_id: r.defrost_item_id }),
        decimal: ["min_increment", "yield_a", "yield_b"],
    },
    { sheet: "audit_question", model: "auditQuestion", pk: (r) => ({ audit_question_id: r.audit_question_id }), decimal: ["weight"] },

    // --- Level 2: composite-key children of level 0/1 ---
    {
        sheet: "stock_item_par",
        model: "stockItemPar",
        pk: (r) => ({ stock_item_id_kiosk_id: { stock_item_id: r.stock_item_id, kiosk_id: r.kiosk_id } }),
        decimal: ["target_par", "minimum_stock", "safety_stock"],
    },
    {
        sheet: "recipe_component",
        model: "recipeComponent",
        pk: (r) => ({ recipe_component_id: r.recipe_component_id }),
    },
    {
        sheet: "production_par",
        model: "productionPar",
        pk: (r) => ({ kiosk_id_product_id: { kiosk_id: r.kiosk_id, product_id: r.product_id } }),
    },
    {
        sheet: "defrost_par",
        model: "defrostPar",
        pk: (r) => ({ kiosk_id_defrost_item_id: { kiosk_id: r.kiosk_id, defrost_item_id: r.defrost_item_id } }),
        decimal: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    },
    {
        sheet: "supplier_item_map",
        model: "supplierItemMap",
        pk: (r) => ({ supplier_item_map_id: r.supplier_item_map_id }),
        decimal: ["order_multiple", "current_price"],
    },

    // --- Level 3: submission queue (needs kiosk + user) ---
    {
        sheet: "submission",
        model: "submission",
        pk: (r) => ({ submission_id: r.submission_id }),
        json: ["raw_payload"],
    },

    // --- Level 4: operational tables depending on submission/kiosk/product/stock_item ---
    // stock_transfer BEFORE stock_movement — movement rows reference transfer_id.
    {
        sheet: "stock_transfer",
        model: "stockTransfer",
        pk: (r) => ({ transfer_id: r.transfer_id }),
        decimal: ["qty"],
    },
    {
        sheet: "stock_movement",
        model: "stockMovement",
        pk: (r) => ({ stock_movement_id: r.stock_movement_id }),
        decimal: ["qty", "unit_cost", "cost"],
    },
    {
        sheet: "product_movement",
        model: "productMovement",
        pk: (r) => ({ product_movement_id: r.product_movement_id }),
        decimal: ["qty", "unit_cost", "cost"],
    },
    {
        sheet: "fridge_count",
        model: "fridgeCount",
        pk: (r) => ({ fridge_count_id: r.fridge_count_id }),
        decimal: ["counted_qty"],
    },
    {
        sheet: "production_plan",
        model: "productionPlan",
        pk: (r) => ({ production_plan_id: r.production_plan_id }),
        decimal: ["planned_qty"],
    },
    { sheet: "staff_food", model: "staffFood", pk: (r) => ({ staff_food_id: r.staff_food_id }), decimal: ["qty"] },
    { sheet: "delivery_header", model: "deliveryHeader", pk: (r) => ({ delivery_header_id: r.delivery_header_id }) },
    { sheet: "request", model: "request", pk: (r) => ({ request_id: r.request_id }) },
    { sheet: "stocktake_header", model: "stocktakeHeader", pk: (r) => ({ stocktake_header_id: r.stocktake_header_id }) },
    {
        sheet: "audit_response",
        model: "auditResponse",
        pk: (r) => ({ audit_response_id: r.audit_response_id }),
        decimal: ["final_score"],
    },

    // --- Level 5: children of level 4 ---
    { sheet: "delivery_file", model: "deliveryFile", pk: (r) => ({ delivery_file_id: r.delivery_file_id }) },
    {
        sheet: "invoice_line",
        model: "invoiceLine",
        pk: (r) => ({ invoice_line_id: r.invoice_line_id }),
        decimal: ["qty", "unit_cost", "line_total"],
        stringify: ["supplier_item_code"],
    },
    {
        sheet: "stocktake_line",
        model: "stocktakeLine",
        pk: (r) => ({ stocktake_line_id: r.stocktake_line_id }),
        decimal: ["counted_qty"],
    },
    { sheet: "audit_answer", model: "auditAnswer", pk: (r) => ({ audit_answer_id: r.audit_answer_id }) },
    { sheet: "corrective_action", model: "correctiveAction", pk: (r) => ({ corrective_action_id: r.corrective_action_id }) },

    // --- Level 6: Action Inbox (needs submission + kiosk) ---
    { sheet: "owner_action", model: "ownerAction", pk: (r) => ({ owner_action_id: r.owner_action_id }) },

    // --- Level 7: depend on owner_action / corrective_action ---
    { sheet: "purchasing_batch", model: "purchasingBatch", pk: (r) => ({ purchasing_batch_id: r.purchasing_batch_id }) },
    { sheet: "audit_correction", model: "auditCorrection", pk: (r) => ({ audit_correction_id: r.audit_correction_id }) },

    // --- Level 8: leaf tables ---
    {
        sheet: "purchasing_batch_line",
        model: "purchasingBatchLine",
        pk: (r) => ({ purchasing_batch_line_id: r.purchasing_batch_line_id }),
        decimal: ["total_shortfall", "pack_size", "order_multiple", "recommended_qty"],
    },
    { sheet: "activity_log", model: "activityLog", pk: (r) => ({ activity_log_id: r.activity_log_id }) },

    // --- Level 9: error log references submission (kept last, non-critical) ---
    { sheet: "processing_error_log", model: "processingErrorLog", pk: (r) => ({ error_id: r.error_id }) },
];
