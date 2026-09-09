/**
 * Kpi.js — owner-facing KPI Dashboard, Kiosk Comparison, and Stock Usage
 * View. Same convention as ActionInbox.js/DataTables.js: assumes the caller
 * is already role-checked by Api.js's isOwnerRole_ gate.
 *
 * Scope note (see the KPI Dashboard plan): the spec's financial KPIs
 * (Sales, Operating Profit, Contribution, Food Cost vs. Sales, EBITDA, Net
 * Profit) all depend on the Weekly Sales Import module (spec §22, marked
 * "DEVELOPMENT" in the spec itself), which isn't part of this build. This
 * file only computes what's actually derivable from data that exists
 * today; the frontend renders the financial metrics as explicit
 * "not available" tiles rather than omitting them. Same story for Stock
 * Usage View's "Expected Recipe Usage" — recipe_component maps products to
 * `component` (prep components), never onward to stock_item, so there is
 * no data path for that comparison at all; only the ledger-based actual
 * usage section here is real.
 */

/** Sums valueFn(row) grouped by keyFn(row). */
function sumBy_(rows, keyFn, valueFn) {
    const out = {};
    rows.forEach((r) => {
        const k = keyFn(r);
        out[k] = (out[k] || 0) + (Number(valueFn(r)) || 0);
    });
    return out;
}

/** Rows whose dateCol falls within [startDate, endDate] inclusive, both
 * 'yyyy-MM-dd'. Handles Date-object or string sheet cells via asDateStr. */
function inRange_(rows, dateCol, startDate, endDate) {
    return rows.filter((r) => {
        const d = asDateStr(r[dateCol]);
        return d && d >= startDate && d <= endDate;
    });
}

/** Whole days between two 'yyyy-MM-dd' strings (later - earlier), via
 * manual y/m/d parsing — matches Util.js's addDays/weekdayName convention,
 * not `new Date(dateString)`. */
function daysBetween_(earlierStr, laterStr) {
    const toUtcDays = (s) => {
        const [y, m, d] = s.split("-").map(Number);
        return Date.UTC(y, m - 1, d);
    };
    return Math.round((toUtcDays(laterStr) - toUtcDays(earlierStr)) / 86400000);
}

function statTotals_() {
    return { qty: 0, cost: 0, count: 0, uncostedCount: 0 };
}

/**
 * IN-minus-OUT balance for one stock item, from a pre-fetched movements
 * array (all stock_movement rows for one kiosk — see confirmStocktake in
 * ActionInbox.js, which fetches once per kiosk and calls this per line).
 * asOfDate: inclusive upper bound on movement_date, or falsy for the full
 * ledger to date (confirmStocktake's original behavior, unchanged by this
 * extraction).
 */
function stockBalanceAsOf_(movements, stockItemId, asOfDate) {
    return movements
        .filter((m) => m.stock_item_id === stockItemId && (!asOfDate || asDateStr(m.movement_date) <= asOfDate))
        .reduce((sum, m) => sum + (m.direction === "IN" ? Number(m.qty) : -Number(m.qty)), 0);
}

/** Default range: last 7 days ending today, if not both supplied. */
function resolveKpiRange_(startDate, endDate) {
    const end = endDate || today();
    const start = startDate || addDays(end, -6);
    return { startDate: start, endDate: end };
}

/**
 * Per kiosk × movement_type (EXPIRED_WASTE | DAMAGE | STAFF_FOOD): qty,
 * cost, count, and how many of those rows are uncosted (missing
 * unit_cost) — surfaced separately rather than silently folded into cost,
 * per spec's "uncosted, not zero-value" rule.
 */
function computeProductMovementStats_(kioskIds, startDate, endDate) {
    const rows = inRange_(
        getRows(TABLES.PRODUCT_MOVEMENT, (r) => kioskIds.includes(r.kiosk_id)),
        "movement_date",
        startDate,
        endDate,
    );
    const out = {};
    kioskIds.forEach((k) => (out[k] = { EXPIRED_WASTE: statTotals_(), DAMAGE: statTotals_(), STAFF_FOOD: statTotals_() }));
    rows.forEach((r) => {
        const bucket = out[r.kiosk_id] && out[r.kiosk_id][r.movement_type];
        if (!bucket) return;
        const uncosted = r.cost === "" || r.cost === null || r.cost === undefined;
        bucket.qty += Number(r.qty) || 0;
        bucket.cost += uncosted ? 0 : Number(r.cost);
        bucket.count += 1;
        if (uncosted) bucket.uncostedCount += 1;
    });
    return out;
}

/** Staff Food cost total + a per-date breakdown (for a trend sparkline),
 * per kiosk. Cost lives on product_movement (STAFF_FOOD); the staff_food
 * table itself only attributes person/shift, not needed for this tile. */
function computeStaffFoodBreakdown_(kioskIds, startDate, endDate) {
    const rows = inRange_(
        getRows(TABLES.PRODUCT_MOVEMENT, (r) => kioskIds.includes(r.kiosk_id) && r.movement_type === "STAFF_FOOD"),
        "movement_date",
        startDate,
        endDate,
    );
    const out = {};
    kioskIds.forEach((k) => (out[k] = { total: statTotals_(), byDate: {} }));
    rows.forEach((r) => {
        const bucket = out[r.kiosk_id];
        if (!bucket) return;
        const uncosted = r.cost === "" || r.cost === null || r.cost === undefined;
        const cost = uncosted ? 0 : Number(r.cost);
        bucket.total.qty += Number(r.qty) || 0;
        bucket.total.cost += cost;
        bucket.total.count += 1;
        if (uncosted) bucket.total.uncostedCount += 1;
        const d = asDateStr(r.movement_date);
        bucket.byDate[d] = (bucket.byDate[d] || 0) + cost;
    });
    return out;
}

/**
 * Damage/waste rates using production_plan.planned_qty as the production-
 * volume denominator — the same proxy FormDamagedProduct.js's own threshold
 * check already commits to (real "Confirm Production" tracking was dropped
 * from this system), not a second invented denominator. ratePer100/ratePct
 * are null (not 0) when there's no planned_qty for the period — "rate not
 * available," never a misleading 0%.
 */
function computeDamageWasteRates_(kioskIds, startDate, endDate) {
    const movementStats = computeProductMovementStats_(kioskIds, startDate, endDate);
    const plannedByKiosk = sumBy_(
        inRange_(
            getRows(TABLES.PRODUCTION_PLAN, (r) => kioskIds.includes(r.kiosk_id)),
            "business_date",
            startDate,
            endDate,
        ),
        (r) => r.kiosk_id,
        (r) => r.planned_qty,
    );
    const out = {};
    kioskIds.forEach((k) => {
        const planned = plannedByKiosk[k] || 0;
        const damage = movementStats[k].DAMAGE;
        const waste = movementStats[k].EXPIRED_WASTE;
        out[k] = {
            plannedQty: planned,
            damage: Object.assign({}, damage, {
                ratePer100: planned > 0 ? Math.round((damage.qty / planned) * 10000) / 100 : null,
            }),
            waste: Object.assign({}, waste, {
                ratePct: planned > 0 ? Math.round((waste.qty / planned) * 10000) / 100 : null,
            }),
        };
    });
    return out;
}

/**
 * Per kiosk: latest COMPLETE stocktake + age, FRESH vs STALE (threshold
 * from the STOCKTAKE_STALE_DAYS setting, default 7 days — matches the
 * spec's weekly-frequency expectation) vs MISSING (no complete stocktake
 * ever). hasRecentIncomplete flags a started-but-not-finished stocktake
 * newer than the latest complete one — a distinct "incomplete" signal, not
 * folded into stale/missing.
 */
function computeStocktakeStatus_(kioskIds) {
    const allHeaders = getRows(TABLES.STOCKTAKE_HEADER, (r) => kioskIds.includes(r.kiosk_id));
    const todayStr = today();
    const out = {};
    kioskIds.forEach((kioskId) => {
        const complete = allHeaders
            .filter((h) => h.kiosk_id === kioskId && h.completion_status === "COMPLETE")
            .sort((a, b) => asDateStr(b.stocktake_date).localeCompare(asDateStr(a.stocktake_date)));
        const incomplete = allHeaders.filter((h) => h.kiosk_id === kioskId && h.completion_status === "INCOMPLETE");

        if (!complete.length) {
            out[kioskId] = {
                status: "MISSING",
                lastCompleteDate: "",
                ageDays: null,
                reconciliationStatus: "",
                hasRecentIncomplete: incomplete.length > 0,
            };
            return;
        }
        const latest = complete[0];
        const lastCompleteDate = asDateStr(latest.stocktake_date);
        const ageDays = daysBetween_(lastCompleteDate, todayStr);
        out[kioskId] = {
            status: ageDays > getSettingNum("STOCKTAKE_STALE_DAYS", 7) ? "STALE" : "FRESH",
            lastCompleteDate: lastCompleteDate,
            ageDays: ageDays,
            reconciliationStatus: latest.reconciliation_status,
            hasRecentIncomplete: incomplete.some((h) => asDateStr(h.stocktake_date) > lastCompleteDate),
        };
    });
    return out;
}

/** Delivery/Invoice review-queue stats per kiosk: submissions by status, AI
 * pending/failed files, unmapped (no stock_item_id) non-rejected lines,
 * and approved invoice value for the period. */
function computeDeliveryInvoiceStats_(kioskIds, startDate, endDate) {
    const headers = inRange_(
        getRows(TABLES.DELIVERY_HEADER, (r) => kioskIds.includes(r.kiosk_id)),
        "delivery_date",
        startDate,
        endDate,
    );
    const kioskByHeaderId = {};
    headers.forEach((h) => (kioskByHeaderId[h.delivery_header_id] = h.kiosk_id));
    const headerIds = headers.map((h) => h.delivery_header_id);
    const files = getRows(TABLES.DELIVERY_FILE, (f) => headerIds.includes(f.delivery_header_id));
    const lines = getRows(TABLES.INVOICE_LINE, (l) => headerIds.includes(l.delivery_header_id));

    const out = {};
    kioskIds.forEach((k) => {
        out[k] = { submitted: 0, inReview: 0, reviewed: 0, aiPending: 0, aiFailed: 0, unmappedLines: 0, approvedValue: 0 };
    });
    headers.forEach((h) => {
        const bucket = out[h.kiosk_id];
        if (!bucket) return;
        bucket.submitted += 1;
        if (h.status === "IN_REVIEW") bucket.inReview += 1;
        if (h.status === "REVIEWED") bucket.reviewed += 1;
    });
    files.forEach((f) => {
        const bucket = out[kioskByHeaderId[f.delivery_header_id]];
        if (!bucket) return;
        if (f.ai_status === "PENDING") bucket.aiPending += 1;
        if (f.ai_status === "FAILED") bucket.aiFailed += 1;
    });
    lines.forEach((l) => {
        const bucket = out[kioskByHeaderId[l.delivery_header_id]];
        if (!bucket) return;
        if (l.status === "APPROVED") bucket.approvedValue += l.line_total === "" ? 0 : Number(l.line_total);
        if (l.status !== "REJECTED" && !l.stock_item_id) bucket.unmappedLines += 1;
    });
    return out;
}

/**
 * Actual stock usage for one stock item between two stocktake dates (spec
 * §23.11): Opening + Deliveries In + Transfers In − Transfers Out −
 * Closing. movements: pre-fetched stock_movement rows for one kiosk (fetch
 * once, call this per item — same pattern confirmStocktake already uses).
 * Spec §23.11 also lists "− Returns," but stock_movement has no RETURNS
 * movement_type in the schema — a known spec/schema gap, not invented here.
 */
function computeStockUsageLedger_(movements, stockItemId, openingDate, closingDate) {
    const opening = stockBalanceAsOf_(movements, stockItemId, openingDate);
    const closing = stockBalanceAsOf_(movements, stockItemId, closingDate);

    const between = inRange_(movements, "movement_date", addDays(openingDate, 1), closingDate).filter(
        (m) => m.stock_item_id === stockItemId,
    );
    let deliveriesIn = 0;
    let transfersIn = 0;
    let transfersOut = 0;
    between.forEach((m) => {
        const qty = Number(m.qty) || 0;
        if (m.movement_type === "DELIVERY_IN") deliveriesIn += qty;
        if (m.movement_type === "TRANSFER_IN") transfersIn += qty;
        if (m.movement_type === "TRANSFER_OUT") transfersOut += qty;
    });

    return {
        opening: opening,
        closing: closing,
        deliveriesIn: deliveriesIn,
        transfersIn: transfersIn,
        transfersOut: transfersOut,
        actualUsage: opening + deliveriesIn + transfersIn - transfersOut - closing,
    };
}

/** KPI Dashboard bootstrap — one kiosk (kioskId) or all active kiosks
 * (kioskId falsy), one period. */
function bootstrapKpiDashboard(kioskId, startDate, endDate) {
    const range = resolveKpiRange_(startDate, endDate);
    const kiosks = getRows(TABLES.KIOSK, (r) => r.active === true);
    const kioskIds = kioskId ? [kioskId] : kiosks.map((k) => k.kiosk_id);

    return {
        ok: true,
        startDate: range.startDate,
        endDate: range.endDate,
        kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
        movementStats: computeProductMovementStats_(kioskIds, range.startDate, range.endDate),
        damageWasteRates: computeDamageWasteRates_(kioskIds, range.startDate, range.endDate),
        staffFood: computeStaffFoodBreakdown_(kioskIds, range.startDate, range.endDate),
        stocktakeStatus: computeStocktakeStatus_(kioskIds),
        deliveryInvoice: computeDeliveryInvoiceStats_(kioskIds, range.startDate, range.endDate),
        ownerActionCounts: bootstrapActionInbox().counts,
    };
}

/** Kiosk Comparison bootstrap — always every active kiosk, one shared
 * period (spec §23.3: no per-kiosk period drift when comparing). */
function bootstrapKioskComparison(startDate, endDate) {
    const range = resolveKpiRange_(startDate, endDate);
    const kiosks = getRows(TABLES.KIOSK, (r) => r.active === true);
    const kioskIds = kiosks.map((k) => k.kiosk_id);

    return {
        ok: true,
        startDate: range.startDate,
        endDate: range.endDate,
        kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
        movementStats: computeProductMovementStats_(kioskIds, range.startDate, range.endDate),
        damageWasteRates: computeDamageWasteRates_(kioskIds, range.startDate, range.endDate),
        staffFood: computeStaffFoodBreakdown_(kioskIds, range.startDate, range.endDate),
        stocktakeStatus: computeStocktakeStatus_(kioskIds),
        deliveryInvoice: computeDeliveryInvoiceStats_(kioskIds, range.startDate, range.endDate),
    };
}

/**
 * Stock Usage View bootstrap — one kiosk, bounded by two COMPLETE
 * stocktake_header rows (not a free date range, since the formula is
 * anchored to stocktake events). Defaults to the two most recent complete
 * stocktakes when ids aren't given. available:false (with a reason, not a
 * broken/partial table) when fewer than two complete stocktakes exist.
 */
function bootstrapStockUsage(kioskId, openingStocktakeHeaderId, closingStocktakeHeaderId) {
    // Active kiosk list returned on every call (including the no-kioskId
    // first load) so the page can populate its kiosk picker without a
    // separate round trip to an unrelated bootstrap action.
    const kiosks = getRows(TABLES.KIOSK, (r) => r.active === true).map((k) => ({ id: k.kiosk_id, name: k.name }));

    if (!kioskId) {
        return { ok: true, kiosks: kiosks, kioskId: "", available: false, reason: "Pick a kiosk." };
    }

    const completeHeaders = getRows(
        TABLES.STOCKTAKE_HEADER,
        (r) => r.kiosk_id === kioskId && r.completion_status === "COMPLETE",
    ).sort((a, b) => asDateStr(b.stocktake_date).localeCompare(asDateStr(a.stocktake_date)));

    if (completeHeaders.length < 2) {
        return {
            ok: true,
            kiosks: kiosks,
            kioskId: kioskId,
            available: false,
            reason: "Need at least two complete stocktakes for this kiosk.",
            completeStocktakes: completeHeaders.map((h) => ({ id: h.stocktake_header_id, date: asDateStr(h.stocktake_date) })),
        };
    }

    const closing = closingStocktakeHeaderId
        ? completeHeaders.find((h) => h.stocktake_header_id === closingStocktakeHeaderId)
        : completeHeaders[0];
    const opening = openingStocktakeHeaderId
        ? completeHeaders.find((h) => h.stocktake_header_id === openingStocktakeHeaderId)
        : completeHeaders[1];
    if (!opening || !closing) return { ok: false, error: "Selected stocktake not found." };

    const openingDate = asDateStr(opening.stocktake_date);
    const closingDate = asDateStr(closing.stocktake_date);
    if (openingDate >= closingDate) return { ok: false, error: "Opening stocktake must be before closing stocktake." };

    const movements = getRows(TABLES.STOCK_MOVEMENT, (m) => m.kiosk_id === kioskId);
    const stockItems = getRows(TABLES.STOCK_ITEM, (s) => s.active === true);
    const lines = stockItems.map((item) => {
        const ledger = computeStockUsageLedger_(movements, item.stock_item_id, openingDate, closingDate);
        return Object.assign({ stockItemId: item.stock_item_id, name: item.name, unit: item.count_unit }, ledger);
    });

    return {
        ok: true,
        kiosks: kiosks,
        kioskId: kioskId,
        available: true,
        openingDate: openingDate,
        closingDate: closingDate,
        completeStocktakes: completeHeaders.map((h) => ({ id: h.stocktake_header_id, date: asDateStr(h.stocktake_date) })),
        lines: lines,
    };
}
