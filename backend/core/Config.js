/**
 * Config.js — constants and Script Property accessors.
 */

const TABLES = {
    BRAND: "brand",
    KIOSK: "kiosk",
    USER: "user",
    SUPPLIER: "supplier",
    CAMPAIGN: "campaign",
    STOCK_ITEM: "stock_item",
    PRODUCT: "product",
    AUDIT_SECTION: "audit_section",
    AUDIT_QUESTION: "audit_question",
    ENUM_OPTION: "enum_option",
    PRODUCTION_PAR: "production_par",
    COMPONENT: "component",
    RECIPE_COMPONENT: "recipe_component",
    DEFROST_ITEM: "defrost_item",
    DEFROST_PAR: "defrost_par",
    SUPPLIER_ITEM_MAP: "supplier_item_map",
    STOCK_ITEM_PAR: "stock_item_par",
    SETTING: "setting",
    FIELD_SCHEMA: "field_schema",
    TABLE_SCHEMA: "table_schema",

    SUBMISSION: "submission",
    PROCESSING_ERROR_LOG: "processing_error_log",
    OWNER_ACTION: "owner_action",
    ACTIVITY_LOG: "activity_log",

    STOCK_MOVEMENT: "stock_movement",
    PRODUCT_MOVEMENT: "product_movement",

    FRIDGE_COUNT: "fridge_count",
    PRODUCTION_PLAN: "production_plan",
    STAFF_FOOD: "staff_food",
    DELIVERY_HEADER: "delivery_header",
    DELIVERY_FILE: "delivery_file",
    INVOICE_LINE: "invoice_line",
    REQUEST: "request",
    STOCKTAKE_HEADER: "stocktake_header",
    STOCKTAKE_LINE: "stocktake_line",
    AUDIT_RESPONSE: "audit_response",
    AUDIT_ANSWER: "audit_answer",
    CORRECTIVE_ACTION: "corrective_action",
    AUDIT_CORRECTION: "audit_correction",
    STOCK_TRANSFER: "stock_transfer",
    PURCHASING_BATCH: "purchasing_batch",
    PURCHASING_BATCH_LINE: "purchasing_batch_line",
};

const FORM_TYPES = {
    MORNING_WASTE: "MORNING_WASTE",
    MORNING_FRIDGE_COUNT: "MORNING_FRIDGE_COUNT",
    STAFF_FOOD: "STAFF_FOOD",
    FOOD_WASTE: "FOOD_WASTE",
    DAMAGED_PRODUCT: "DAMAGED_PRODUCT",
    DELIVERY_INVOICE: "DELIVERY_INVOICE",
    HELP_ISSUE: "HELP_ISSUE",
    WEEKLY_STOCKTAKE: "WEEKLY_STOCKTAKE",
    MONTHLY_AUDIT: "MONTHLY_AUDIT",
    AUDIT_CORRECTION: "AUDIT_CORRECTION",
    MOVE_STOCK: "MOVE_STOCK",
};

function getSheetId() {
    const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
    if (!id) throw new Error("Script property SHEET_ID is not set.");
    return id;
}

let _spreadsheet = null;
function getSpreadsheet() {
    if (!_spreadsheet) _spreadsheet = SpreadsheetApp.openById(getSheetId());
    return _spreadsheet;
}
