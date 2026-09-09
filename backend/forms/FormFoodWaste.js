/**
 * FormFoodWaste.js — Food Waste (spec §3.5): ingredients or prepared food
 * placed in the bin, weighed in grams. Cost = grams / 100 x stock_item's
 * cost_per_100g (separate from current_unit_cost — that's the purchasing
 * price, this is a per-gram waste rate; blank = UNCOSTED, never guessed).
 * Zero weight is flagged for review, not treated as real waste (spec).
 * Kept separate from Morning Waste/Damage/Staff Food (M-11) — this is the
 * only workflow that posts to `stock_movement` (raw stock), not products.
 */

/** stock_category values grouped into Food Waste's own simplified FOOD/
 * PACKAGING buckets — Stocktake/Move Stock keep the full granular
 * stock_category list untouched; this mapping only affects what Food Waste
 * shows. A stock_category not listed in either setting simply doesn't
 * appear in Food Waste at all (matches the categories Evan actually named:
 * Walk-in Fridge + Drystore Food -> FOOD, Drystore Packaging -> PACKAGING;
 * Freezer/Cleaning/Campaign etc. are out of scope for this workflow). */
function foodWasteGroupFor_(stockCategoryId) {
    const foodCats = getSetting("FOOD_WASTE_FOOD_CATEGORIES", "")
        .split(",")
        .map((s) => s.trim());
    const packagingCats = getSetting("FOOD_WASTE_PACKAGING_CATEGORIES", "")
        .split(",")
        .map((s) => s.trim());
    if (foodCats.indexOf(stockCategoryId) !== -1) return "FOOD";
    if (packagingCats.indexOf(stockCategoryId) !== -1) return "PACKAGING";
    return "";
}

function getFoodWasteData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };

    const items = getRows(
        TABLES.STOCK_ITEM,
        (r) => r.active === true && r.food_waste_eligible !== false,
    )
        .map((r) => ({
            id: r.stock_item_id,
            name: r.name,
            unit: r.count_unit,
            cat: foodWasteGroupFor_(r.stock_category_id),
        }))
        .filter((r) => r.cat !== "");

    return {
        ok: true,
        businessDate: today(),
        items: items,
    };
}

function buildFoodWasteKey(ctx) {
    return `FOOD_WASTE|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateFoodWaste(p) {
    if (!p.client_key) throw new Error("Missing form key — reload the page and try again.");
    const lines = p.lines || [];
    if (!lines.length) throw new Error("Add at least one item.");
    lines.forEach((ln, i) => {
        const g = Number(ln.grams);
        if (!ln.stock_item_id || !Number.isFinite(g) || g <= 0)
            throw new Error(`Line ${i + 1}: weight must be a number greater than 0.`);
        if (ln.stock_item_id === "OTHER" && !String(ln.description || "").trim())
            throw new Error(`Line ${i + 1}: "Other" needs a description.`);
    });
}

function processFoodWaste(ctx) {
    const lines = ctx.payload.lines || [];

    ctx.stage = "resolve items";
    const items = {};
    getRows(TABLES.STOCK_ITEM).forEach((r) => (items[r.stock_item_id] = r));

    ctx.stage = "write stock_movement";
    lines.forEach((ln) => {
        const grams = Number(ln.grams);
        const isOther = ln.stock_item_id === "OTHER";
        const item = !isOther ? items[ln.stock_item_id] : null;
        const rate = item && item.cost_per_100g !== "" ? Number(item.cost_per_100g) : "";
        const cost = rate === "" ? "" : Math.round((grams / 100) * rate * 100) / 100;

        insertRow(TABLES.STOCK_MOVEMENT, {
            stock_movement_id: newId(),
            submission_id: ctx.submissionId,
            kiosk_id: ctx.kiosk.kiosk_id,
            stock_item_id: item ? item.stock_item_id : "",
            movement_type: "FOOD_WASTE",
            direction: "OUT",
            movement_date: ctx.businessDate,
            qty: grams,
            unit_cost: rate,
            cost: cost,
            reference_id: isOther ? String(ln.description || "").trim() : "",
        });
        ctx.written = true;
    });
    return "PROCESSED";
}
