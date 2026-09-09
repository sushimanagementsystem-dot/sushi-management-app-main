/**
 * FormFridgeCount.js — Morning Fridge Count: bootstrap, processor, plan email.
 *
 * Spec §3.2: count usable sellable finished products after expired stock is
 * removed. Zero is valid; the form requires an explicit number per product,
 * so blanks cannot occur. Latest accepted count wins (pipeline delete+rewrite).
 * Processing generates the production plan and emails it to the kiosk.
 */

/** Products this kiosk ever plans (has any par row), for the count form. */
function getFridgeCountData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };
    const bizDate = today();

    const parProductIds = {};
    getRows(TABLES.PRODUCTION_PAR, { kiosk_id: kiosk.kiosk_id }).forEach(
        (r) => (parProductIds[r.product_id] = true),
    );
    const catNames = {};
    getEnumOptions("product_category").forEach((r) => (catNames[r.value] = r.label));
    const products = getRows(
        TABLES.PRODUCT,
        (r) => r.active === true && parProductIds[r.product_id] === true,
    ).map((r) => ({
        id: r.product_id,
        name: r.name,
        cat: catNames[r.product_category_id] || "Other",
    }));

    const existing = {};
    getRows(
        TABLES.FRIDGE_COUNT,
        (r) =>
            r.kiosk_id === kiosk.kiosk_id &&
            asDateStr(r.business_date) === bizDate,
    ).forEach((r) => (existing[r.product_id] = Number(r.counted_qty)));

    return {
        ok: true,
        businessDate: bizDate,
        products: products,
        existingCounts: existing,
        alreadySubmitted: Object.keys(existing).length > 0,
    };
}

function buildFridgeCountKey(ctx) {
    return `FRIDGE_COUNT|${ctx.kiosk.kiosk_id}|${ctx.businessDate}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateFridgeCount(p) {
    const counts = p.counts || {};
    const ids = Object.keys(counts);
    if (!ids.length) throw new Error("No counts submitted.");
    ids.forEach((pid) => {
        const q = Number(counts[pid]);
        if (!Number.isInteger(q) || q < 0)
            throw new Error(
                `"${pid}": count must be a whole number, 0 or more.`,
            );
    });
    if (p.plainRiceCarryoverGrams !== undefined && p.plainRiceCarryoverGrams !== "") {
        const g = Number(p.plainRiceCarryoverGrams);
        if (!Number.isFinite(g) || g < 0)
            throw new Error("Plain rice carryover must be a number, 0 or more.");
    }
}

function processFridgeCount(ctx) {
    const counts = ctx.payload.counts || {};
    const ids = Object.keys(counts);
    const carryoverGrams = Number(ctx.payload.plainRiceCarryoverGrams) || 0;

    ctx.stage = "write fridge_count";
    ids.forEach((pid) => {
        insertRow(TABLES.FRIDGE_COUNT, {
            fridge_count_id: newId(),
            submission_id: ctx.submissionId,
            kiosk_id: ctx.kiosk.kiosk_id,
            business_date: ctx.businessDate,
            product_id: pid,
            counted_qty: Number(counts[pid]),
        });
        ctx.written = true;
    });

    ctx.stage = "compute plan";
    const plan = computeProductionPlan(ctx.kiosk, ctx.businessDate, counts, carryoverGrams);

    ctx.stage = "write production_plan";
    plan.lines.forEach((ln) => {
        if (ln.make <= 0) return;
        insertRow(TABLES.PRODUCTION_PLAN, {
            production_plan_id: newId(),
            kiosk_id: ctx.kiosk.kiosk_id,
            business_date: ctx.businessDate,
            product_id: ln.product_id,
            planned_qty: ln.make,
            submission_id: ctx.submissionId,
            generated_at: nowStamp(),
        });
    });

    ctx.stage = "send production email";
    try {
        sendProductionEmail_(ctx.kiosk, ctx.businessDate, plan, ctx.email);
    } catch (err) {
        console.error("Production email failed:", (err && err.stack) || err);
        // Data write already succeeded above — stays PROCESSED_WITH_WARNING,
        // never ERROR — but still needs to land somewhere visible. Without
        // this, a mail failure (blank/bad kiosk email, quota, auth) left
        // zero trace anywhere a human would see (see recordProcessingErrorLog_).
        recordProcessingErrorLog_(ctx, "FRIDGE_COUNT", err);
        return "PROCESSED_WITH_WARNING";
    }
    return "PROCESSED";
}

/** Takes the SAME plan object already written to production_plan above, not
 * a fresh computeProductionPlan() call — the allocator in
 * EngineSecondaryAllocation.js is stateful (reads recent production_plan
 * history), so recomputing here could diverge from what was just persisted,
 * or even see its own not-yet-committed rows. One computation, threaded
 * through both consumers. */
function sendProductionEmail_(kiosk, bizDate, plan, submitterEmail) {
    if (!kiosk.production_email)
        throw new Error("Kiosk has no production_email.");

    const user = findUserByEmail(
        String(submitterEmail || "")
            .trim()
            .toLowerCase(),
    );
    const model = buildEmailModel(
        kiosk,
        bizDate,
        plan,
        user ? user.name : "",
    );

    const mail = {
        to: kiosk.production_email,
        subject: `Today's Production Plan - ${kiosk.name} - ${model.dateLabel}`,
        htmlBody: renderProductionEmail(model),
        name: "Sushi Production Plan",
    };
    const cc = String(submitterEmail || "").trim();
    if (cc) mail.cc = cc;
    MailApp.sendEmail(mail);
}
