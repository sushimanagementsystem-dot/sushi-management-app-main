/**
 * FormStaffFood.js — Staff Food (spec §3.4): authorised staff consumption,
 * kept separate from waste/damage/expenses. One product per staff member per
 * shift (owner rule): processing key = form|kiosk|date|staff, so submitting
 * again for the same person on the same day EDITS their entry (form preloads
 * it), while other staff members' entries are untouched.
 *
 * Who "staff" is comes from the signed-in Google identity (verified
 * server-side, see Api.js's route_), never a client-picked dropdown — one
 * account, one shift, one entry. Quantity is always 1 (owner rule: staff
 * cannot take more than one product), so it's not even a field on the form.
 */

function getStaffFoodData(token, callingUserId) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };
    const bizDate = today();

    const catNames = {};
    getEnumOptions("product_category").forEach((r) => (catNames[r.value] = r.label));
    const products = productsForKiosk_(
        kiosk,
        (r) => r.staff_food_eligible !== false,
    ).map((r) => ({
        id: r.product_id,
        name: r.name,
        cat: catNames[r.product_category_id] || "Other",
    }));

    const existingRow = getRow(
        TABLES.STAFF_FOOD,
        (r) =>
            r.kiosk_id === kiosk.kiosk_id &&
            asDateStr(r.food_date) === bizDate &&
            r.user_id === callingUserId,
    );

    return {
        ok: true,
        businessDate: bizDate,
        products: products,
        existing: existingRow
            ? { product_id: existingRow.product_id }
            : null,
    };
}

function buildStaffFoodKey(ctx) {
    return `STAFF_FOOD|${ctx.kiosk.kiosk_id}|${ctx.businessDate}|${ctx.userId || "unknown"}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateStaffFood(p) {
    if (!p.product_id) throw new Error("Select a product.");
}

function processStaffFood(ctx) {
    const p = ctx.payload;

    ctx.stage = "resolve staff/product";
    const staff = getRow(TABLES.USER, {
        user_id: String(ctx.userId || ""),
        active: true,
    });
    const prod = getRow(TABLES.PRODUCT, { product_id: String(p.product_id) });

    ctx.stage = "write staff_food";
    const qty = 1;
    insertRow(TABLES.STAFF_FOOD, {
        staff_food_id: newId(),
        submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        food_date: ctx.businessDate,
        user_id: staff ? staff.user_id : "",
        product_id: prod ? prod.product_id : "",
        qty: qty,
    });
    ctx.written = true;

    if (prod) {
        ctx.stage = "write product_movement";
        const unitCost =
            prod.current_unit_cost !== "" ? Number(prod.current_unit_cost) : "";
        insertRow(TABLES.PRODUCT_MOVEMENT, {
            product_movement_id: newId(),
            submission_id: ctx.submissionId,
            kiosk_id: ctx.kiosk.kiosk_id,
            product_id: prod.product_id,
            movement_type: "STAFF_FOOD",
            direction: "OUT",
            movement_date: ctx.businessDate,
            qty: qty,
            unit_cost: unitCost,
            cost: unitCost === "" ? "" : Math.round(qty * unitCost * 100) / 100,
            status: unitCost === "" ? "UNCOSTED" : "VALID",
        });
    }

    return staff && prod ? "PROCESSED" : "UNMATCHED";
}
