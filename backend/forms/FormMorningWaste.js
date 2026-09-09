/**
 * FormMorningWaste.js — Morning Waste form: bootstrap data + processor.
 *
 * Spec §3.1: expired finished products removed before the Morning Fridge Count.
 * "No waste" is a valid completed submission (distinct from no submission).
 * Writes product_movement EXPIRED_WASTE OUT rows; never posts stock, never emails.
 */

/**
 * Data the form page needs: selectable products and today's already-submitted
 * lines (the form preloads them so a resubmission edits rather than erases).
 * Called from the browser; must never include costs (M-10).
 */
function getMorningWasteData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };
    const bizDate = today();

    const catNames = {};
    getEnumOptions("product_category").forEach((r) => (catNames[r.value] = r.label));
    const products = productsForKiosk_(kiosk).map((r) => ({
        id: r.product_id,
        name: r.name,
        cat: catNames[r.product_category_id] || "Other",
    }));

    const existing = getRows(
        TABLES.PRODUCT_MOVEMENT,
        (r) =>
            r.kiosk_id === kiosk.kiosk_id &&
            r.movement_type === "EXPIRED_WASTE" &&
            asDateStr(r.movement_date) === bizDate,
    ).map((r) => ({ product_id: r.product_id, qty: Number(r.qty) }));

    const submittedToday = getRow(
        TABLES.SUBMISSION,
        (r) =>
            r.processing_key === `MORNING_WASTE|${kiosk.kiosk_id}|${bizDate}` &&
            r.processing_status === "PROCESSED",
    );

    return {
        ok: true,
        businessDate: bizDate,
        products: products,
        existingLines: existing,
        alreadySubmitted: !!submittedToday,
        wasNoWaste: !!submittedToday && existing.length === 0,
    };
}

function buildMorningWasteKey(ctx) {
    return `MORNING_WASTE|${ctx.kiosk.kiosk_id}|${ctx.businessDate}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateMorningWaste(p) {
    const lines = p.lines || [];
    if (p.no_waste && lines.length)
        throw new Error("No-waste submission must not contain waste lines.");
    if (!p.no_waste && !lines.length)
        throw new Error("Add at least one waste line, or use No Waste Today.");
    lines.forEach((ln, i) => {
        const qty = Number(ln.qty);
        if (!ln.product_id || !Number.isInteger(qty) || qty < 1)
            throw new Error(
                `Line ${i + 1}: quantity must be a whole number of at least 1.`,
            );
    });
}

function processMorningWaste(ctx) {
    const p = ctx.payload;
    const lines = p.lines || [];

    if (p.no_waste) return "PROCESSED";

    ctx.stage = "resolve products";
    const products = {};
    getRows(TABLES.PRODUCT).forEach((r) => (products[r.product_id] = r));
    const defaultDays = Number(
        getSetting("WASTE_ATTRIBUTION_DAYS_DEFAULT", "2"),
    );

    lines.forEach((ln, i) => {
        if (!products[ln.product_id])
            throw new Error(
                `Line ${i + 1}: unknown product "${ln.product_id}".`,
            );
    });

    ctx.stage = "write movements";
    lines.forEach((ln) => {
        const prod = products[ln.product_id];
        const qty = Number(ln.qty);
        const unitCost =
            prod.current_unit_cost === "" ? "" : Number(prod.current_unit_cost);
        const shelfDays =
            prod.shelf_life_days === "" ? null : Number(prod.shelf_life_days);
        const attributed =
            shelfDays !== null
                ? addDays(ctx.businessDate, -shelfDays)
                : prod.production_role === "RETAIL"
                  ? ""
                  : addDays(ctx.businessDate, -defaultDays);

        insertRow(TABLES.PRODUCT_MOVEMENT, {
            product_movement_id: newId(),
            submission_id: ctx.submissionId,
            kiosk_id: ctx.kiosk.kiosk_id,
            product_id: prod.product_id,
            movement_type: "EXPIRED_WASTE",
            direction: "OUT",
            movement_date: ctx.businessDate,
            qty: qty,
            unit_cost: unitCost,
            cost: unitCost === "" ? "" : Math.round(qty * unitCost * 100) / 100,
            attributed_production_date: attributed,
            status: unitCost === "" ? "UNCOSTED" : "VALID",
        });
        ctx.written = true;
    });
}
