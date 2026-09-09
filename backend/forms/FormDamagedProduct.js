/**
 * FormDamagedProduct.js — Damaged Product Log (spec §3.6): finished sellable
 * products accidentally made unsellable. Expired products use Morning Waste,
 * not this. One product per response, multiple units of the same product
 * allowed, qty >=1, photo required. Cost = qty x unit_cost, uncosted if
 * missing. Writes product_movement (movement_type DAMAGE) — same ledger as
 * Morning Waste/Staff Food, per M-11 separate-dataset rule enforced by the
 * movement_type discriminator, not a separate table. The movement itself
 * posts unconditionally, same as always — no owner approval needed for the
 * ledger entry, only the review flag below is conditional.
 *
 * Review prompts (damaged/100 produced per kiosk-week, units per
 * product-week, submissions by one submitter/week — thresholds default
 * 3/5/5 per spec Sushi_Kiosk_Simplified_Developer_Rules.docx §6 / Project
 * Rules.docx §13.6, but are tunable via the DAMAGE_REVIEW_UNITS_PER_100/
 * DAMAGE_REVIEW_PRODUCT_WEEK_UNITS/DAMAGE_REVIEW_SUBMITTER_WEEK settings)
 * are computed inline here, per submission, as a trailing 7-day
 * window ending on this submission's business_date (no calendar-week
 * boundary defined in spec, so a rolling window was chosen — simpler, no
 * new date-math helper needed). "Produced" uses production_plan.planned_qty
 * as the denominator, not actual production — the Confirm Production step
 * that would have tracked actual output was dropped from this system
 * (2026-07-26), so planned_qty is the best available proxy, not a literal
 * reading of the spec's "Actual Production" wording. Flagging this as a
 * known approximation, not a guess made silently.
 */

function getDamagedProductData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };

    const catNames = {};
    getEnumOptions("product_category").forEach((r) => (catNames[r.value] = r.label));
    const products = productsForKiosk_(kiosk).map((r) => ({
        id: r.product_id,
        name: r.name,
        cat: catNames[r.product_category_id] || "Other",
    }));

    return {
        ok: true,
        businessDate: today(),
        products: products,
    };
}

function buildDamagedProductKey(ctx) {
    return `DAMAGED_PRODUCT|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateDamagedProduct(p) {
    if (!p.client_key)
        throw new Error("Missing form key — reload the page and try again.");
    if (!p.product_id) throw new Error("Select the product.");
    const qty = Number(p.qty);
    if (!Number.isInteger(qty) || qty < 1)
        throw new Error("Quantity must be a whole number of at least 1.");
    if (!p.photo || !p.photo.base64) throw new Error("A photo is required.");
}

/** Runs at intake, synchronously — uploads the photo, swaps it for a URL. */
function prepareDamagedProductIntake(payload, kiosk) {
    payload.photo_reference = saveUpload_(
        payload.photo,
        kiosk.kiosk_id,
        "DAMAGED_PRODUCT",
    ).url;
    delete payload.photo;
    return payload;
}

function processDamagedProduct(ctx) {
    const p = ctx.payload;

    ctx.stage = "resolve product";
    const prod = getRow(TABLES.PRODUCT, { product_id: String(p.product_id) });

    ctx.stage = "write product_movement";
    const qty = Number(p.qty);
    const unitCost =
        prod && prod.current_unit_cost !== ""
            ? Number(prod.current_unit_cost)
            : "";
    insertRow(TABLES.PRODUCT_MOVEMENT, {
        product_movement_id: newId(),
        submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        product_id: prod ? prod.product_id : "",
        movement_type: "DAMAGE",
        direction: "OUT",
        movement_date: ctx.businessDate,
        qty: qty,
        unit_cost: unitCost,
        cost: unitCost === "" ? "" : Math.round(qty * unitCost * 100) / 100,
        damage_cause: p.damage_cause || "",
        photo_reference: p.photo_reference || "",
        status: unitCost === "" ? "UNCOSTED" : "VALID",
    });
    ctx.written = true;

    ctx.stage = "check damage-rate thresholds";
    if (prod) checkDamageThresholds_(ctx, prod, qty);

    return prod ? "PROCESSED" : "UNMATCHED";
}

/** 7-day trailing window ending on this submission's business_date —
 * see the file header comment for why a rolling window, not a calendar
 * week. Creates at most one owner_action per submission, only if a
 * threshold is actually crossed. */
function checkDamageThresholds_(ctx, prod, qty) {
    const weekStart = addDays(ctx.businessDate, -6);
    const inWeek = (d) => d >= weekStart && d <= ctx.businessDate;
    const kioskId = ctx.kiosk.kiosk_id;

    const kioskWeekDamage = getRows(
        TABLES.PRODUCT_MOVEMENT,
        (r) => r.kiosk_id === kioskId && r.movement_type === "DAMAGE" && inWeek(asDateStr(r.movement_date)),
    ).reduce((sum, r) => sum + Number(r.qty), 0);
    const kioskWeekPlanned = getRows(
        TABLES.PRODUCTION_PLAN,
        (r) => r.kiosk_id === kioskId && inWeek(asDateStr(r.business_date)),
    ).reduce((sum, r) => sum + Number(r.planned_qty), 0);
    const kioskRate = kioskWeekPlanned > 0 ? (kioskWeekDamage / kioskWeekPlanned) * 100 : 0;

    const productWeekDamage = getRows(
        TABLES.PRODUCT_MOVEMENT,
        (r) =>
            r.kiosk_id === kioskId &&
            r.product_id === prod.product_id &&
            r.movement_type === "DAMAGE" &&
            inWeek(asDateStr(r.movement_date)),
    ).reduce((sum, r) => sum + Number(r.qty), 0);

    const submitterKey = ctx.userId || ctx.email;
    const submitterWeekCount = getRows(
        TABLES.SUBMISSION,
        (r) =>
            r.kiosk_id === kioskId &&
            r.form_type === FORM_TYPES.DAMAGED_PRODUCT &&
            (r.user_id || r.submitted_by_email) === submitterKey &&
            inWeek(asDateStr(r.business_date)),
    ).length;

    const rateThreshold = getSettingNum("DAMAGE_REVIEW_UNITS_PER_100", 3);
    const productWeekThreshold = getSettingNum("DAMAGE_REVIEW_PRODUCT_WEEK_UNITS", 5);
    const submitterWeekThreshold = getSettingNum("DAMAGE_REVIEW_SUBMITTER_WEEK", 5);

    const fired = [];
    if (kioskRate > rateThreshold) fired.push(`kiosk-week damage rate ${kioskRate.toFixed(1)}% of planned production`);
    if (productWeekDamage >= productWeekThreshold) fired.push(`${prod.name}: ${productWeekDamage} damaged this week`);
    if (submitterWeekCount >= submitterWeekThreshold) fired.push(`${submitterWeekCount} damage submissions by the same submitter this week`);
    if (!fired.length) return;

    ctx.stage = "write owner_action";
    insertRow(TABLES.OWNER_ACTION, {
        owner_action_id: newId(),
        source_submission_id: ctx.submissionId,
        kiosk_id: kioskId,
        category: "DAMAGE_REVIEW",
        title: `Damage review — ${kioskId} — ${prod.name}`,
        status: "OPEN",
        priority: "NORMAL",
        owner_note: fired.join("; "),
        created_at: nowStamp(),
    });
}
